// npm run smoke -- <app address> [--out evidence/smoke-aws.md] [--watch <seconds>] [--show-host]
//
// Repeatable checks against a running CafeStock (local or on AWS). Used as evidence for the
// functional and security tests (Task 12). Prints a Markdown report, or writes it with --out.
//
//   npm run smoke -- http://localhost:3000
//   npm run smoke -- https://abc123.execute-api.us-east-1.amazonaws.com --out evidence/smoke-aws.md
//
// --watch <seconds>: instead, asks /health once a second for that long and records every
// failure — run it while you terminate a server to measure availability (resilience test).
//
// The address is replaced by <app-address> in the report unless --show-host is given (the
// brief asks for private URLs to be redacted).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const out = flag('--out');
const watch = flag('--watch');
const showHost = args.includes('--show-host') && args.splice(args.indexOf('--show-host'), 1);
const base = (args[0] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error(
    'Usage: npm run smoke -- <app address, e.g. http://localhost:3000> [--out file.md]',
  );
  process.exit(2);
}
const label = showHost ? base : '<app-address>';
const now = () =>
  new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');

async function get(pathname, init = {}) {
  const started = performance.now();
  try {
    const res = await fetch(base + pathname, { redirect: 'manual', ...init });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      status: 0,
      headers: new Headers(),
      text: String(err.cause?.code ?? err.message),
      ms: 0,
    };
  }
}
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// A well-formed but fake token: right shape, wrong signature
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FORGED = `${b64({ alg: 'RS256', kid: 'forged', typ: 'JWT' })}.${b64({
  sub: 'attacker',
  'cognito:groups': ['manager'],
  token_use: 'access',
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.c2lnbmF0dXJl`;

async function checks() {
  const rows = [];
  const add = (name, expected, actual, ok, info = false) =>
    rows.push({ name, expected, actual, result: ok ? 'PASS' : info ? 'INFO' : 'FAIL' });

  const live = await get('/health');
  add(
    'Liveness `GET /health`',
    '200, status ok',
    `${live.status} (${live.ms} ms)`,
    live.status === 200 && json(live.text)?.status === 'ok',
  );

  const ready = await get('/health/ready');
  const r = json(ready.text) ?? {};
  add(
    'Database reachable `GET /health/ready`',
    '200, database up, tables ok',
    `${ready.status}, database ${r.database ?? '?'}, tables ${r.tables ?? '?'} (${ready.ms} ms)`,
    ready.status === 200 && r.database === 'up',
  );

  const page = await get('/stock', { headers: { Accept: 'text/html' } });
  add(
    'Web app page `GET /stock`',
    '200, the CafeStock page',
    `${page.status}${page.text.includes('<title>CafeStock</title>') ? ', CafeStock page' : ''}`,
    page.status === 200 && page.text.includes('<title>CafeStock</title>'),
    base.includes('localhost:3000') && page.status === 404, // dev API alone doesn't serve pages
  );

  const cfg = json((await get('/auth/config')).text) ?? {};
  add(
    'Sign-in method `GET /auth/config`',
    'cognito on AWS (dev locally)',
    String(cfg.mode ?? 'unreadable'),
    cfg.mode === 'cognito',
    cfg.mode === 'dev',
  );

  const anon = await get('/api/items');
  add(
    'Anonymous API call is refused `GET /api/items`',
    '401 AUTH_REQUIRED',
    `${anon.status} ${json(anon.text)?.error?.code ?? ''}`.trim(),
    anon.status === 401,
  );

  const forged = await get('/api/forecast/latest', {
    headers: { Authorization: `Bearer ${FORGED}` },
  });
  add(
    'Forged "manager" token is refused `GET /api/forecast/latest`',
    '401',
    `${forged.status} ${json(forged.text)?.error?.code ?? ''}`.trim(),
    forged.status === 401,
  );

  const h = page.status ? page.headers : live.headers;
  const csp = h.get('content-security-policy') ?? '';
  add(
    'Content-Security-Policy header',
    "script-src 'self', no inline scripts",
    csp ? (csp.match(/script-src[^;]*/)?.[0] ?? 'present') : 'missing',
    /script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp.match(/script-src[^;]*/)?.[0] ?? ''),
  );
  add(
    'X-Content-Type-Options header',
    'nosniff',
    h.get('x-content-type-options') ?? 'missing',
    h.get('x-content-type-options') === 'nosniff',
  );
  add(
    'HTTPS',
    'https:// address',
    base.startsWith('https://') ? 'https' : 'http',
    base.startsWith('https://'),
    base.startsWith('http://localhost') || base.startsWith('http://127.'),
  );

  const probe = await get('/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E', {
    headers: { Accept: 'text/html' },
  });
  add(
    'Firewall blocks a cross-site-scripting probe `/?q=<script>…`',
    '403 (AWS WAF on AWS)',
    String(probe.status),
    probe.status === 403,
    probe.status !== 403 && !base.startsWith('https://'), // no WAF locally
  );
  return rows;
}

async function watchHealth(seconds) {
  const results = [];
  const end = Date.now() + seconds * 1000;
  process.stderr.write(`Watching ${label}/health for ${seconds} s (Ctrl+C stops early)…\n`);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
  while (Date.now() < end && !stop) {
    const t = Date.now();
    const res = await get('/health', { signal: AbortSignal.timeout(3000) });
    results.push({ at: new Date(t), ok: res.status === 200, status: res.status, ms: res.ms });
    if (!results.at(-1).ok) process.stderr.write(`  ${now()}  ${res.status || 'no answer'}\n`);
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - t))));
  }
  const failed = results.filter((r) => !r.ok);
  let longest = 0;
  let run = 0;
  for (const r of results) {
    run = r.ok ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  const avail = results.length ? (100 * (results.length - failed.length)) / results.length : 0;
  const lines = [
    `# Availability watch — ${now()}`,
    '',
    `Target: \`${label}/health\`, one request per second for ${results.length} s.`,
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Requests | ${results.length} |`,
    `| Answered 200 | ${results.length - failed.length} |`,
    `| Failed | ${failed.length} |`,
    `| Availability | ${avail.toFixed(2)}% |`,
    `| Longest outage | ${longest} s |`,
    `| Slowest answer | ${Math.max(0, ...results.map((r) => r.ms))} ms |`,
    '',
    failed.length ? '## Failed requests' : 'No failed requests.',
    '',
    ...failed.map((f) => `- ${f.at.toISOString()} — ${f.status || 'no answer (timeout/refused)'}`),
    '',
  ];
  return { text: lines.join('\n'), ok: true };
}

let report;
let ok;
if (watch) {
  ({ text: report, ok } = await watchHealth(Number(watch)));
} else {
  const rows = await checks();
  ok = rows.every((r) => r.result !== 'FAIL');
  report = [
    `# Smoke test — ${now()}`,
    '',
    `Target: \`${label}\` · Node.js ${process.version} · command: \`npm run smoke -- ${label}\``,
    '',
    '| Check | Expected | Actual | Result |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (r) => `| ${r.name} | ${r.expected} | ${r.actual.replaceAll('|', '/')} | ${r.result} |`,
    ),
    '',
    `**${rows.filter((r) => r.result === 'PASS').length} passed, ${rows.filter((r) => r.result === 'FAIL').length} failed, ${rows.filter((r) => r.result === 'INFO').length} not applicable here (INFO).**`,
    '',
    'INFO = expected to differ on this target (e.g. no HTTPS or WAF when running locally).',
    '',
  ].join('\n');
}

if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, report);
  console.log(`Saved ${out}`);
}
console.log(report);
process.exit(ok ? 0 : 1);
