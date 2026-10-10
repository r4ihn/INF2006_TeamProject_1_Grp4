// npm run evidence:tests — runs every automated test suite and saves the output as dated
// evidence (Task 12): evidence/test-runs/<date>/<suite>.txt plus evidence/test-runs/SUMMARY.md.
//
// Needs the local database (npm run db:up) and the Python set-up (npm run forecast:setup,
// npm run analytics:setup). Your home folder is replaced by ~ in the saved logs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const date = new Date().toISOString().slice(0, 10);
const PROJECT = path.resolve(ROOT, '..'); // evidence/ sits beside src/
const dir = path.join(PROJECT, 'evidence', 'test-runs', date);
mkdirSync(dir, { recursive: true });

const SUITES = [
  {
    id: 'check',
    command: 'npm run check',
    what: 'Formatting, lint, type checks, backend + frontend tests',
  },
  {
    id: 'forecast-test',
    command: 'npm run forecast:test',
    what: 'Python forecast engine, publish, Lambda handler',
  },
  {
    id: 'analytics-test',
    command: 'npm run analytics:test',
    what: 'Demand model (LightGBM) evaluation and reproducibility',
  },
];

const clean = (text) =>
  text
    // eslint-disable-next-line no-control-regex -- removes terminal colour codes
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // colours
    .replaceAll(os.homedir(), '~')
    .replaceAll(PROJECT, '<project>');

function npm(args) {
  const [cmd, pre] = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
  const started = Date.now();
  const r = spawnSync(cmd, [...pre, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: !process.env.npm_execpath && process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? 1,
    output: clean(`${r.stdout ?? ''}${r.stderr ?? ''}`),
    seconds: (Date.now() - started) / 1000,
  };
}

/** "Tests  238 passed (238)" lines from Vitest, "Ran 85 tests … OK" from Python */
function counts(output) {
  const vitest = [
    ...output.matchAll(
      /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)? \((\d+)\)/g,
    ),
  ].map((m) => `${m[2]}/${m[4]} passed${m[1] ? `, ${m[1]} failed` : ''}`);
  const py = output.match(/Ran (\d+) tests?[\s\S]*?\n(OK[^\n]*|FAILED[^\n]*)/);
  return [...vitest, ...(py ? [`${py[1]} ran, ${py[2].trim()}`] : [])].join('; ') || '—';
}

const python = spawnSync(process.platform === 'win32' ? 'py' : 'python3', ['--version'], {
  encoding: 'utf8',
});
const rows = [];
let allPassed = true;
for (const s of SUITES) {
  process.stdout.write(`Running ${s.command} … `);
  const r = npm(s.command.replace(/^npm /, '').split(' '));
  const file = path.join(dir, `${s.id}.txt`);
  writeFileSync(
    file,
    `$ ${s.command}\n# ${new Date().toISOString()}\n\n${r.output}\nexit code ${r.code}\n`,
  );
  const passed = r.code === 0;
  allPassed &&= passed;
  console.log(`${passed ? 'passed' : 'FAILED'} (${r.seconds.toFixed(0)} s)`);
  rows.push(
    `| \`${s.command}\` | ${s.what} | ${passed ? 'PASS' : 'FAIL'} | ${counts(r.output)} | ${r.seconds.toFixed(0)} s | [${date}/${s.id}.txt](${date}/${s.id}.txt) |`,
  );
}

const summary = [
  '# Automated test runs',
  '',
  `Recorded ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC with \`npm run evidence:tests\`.`,
  `Environment: ${os.type()} ${os.release()} · Node.js ${process.version} · ${(python.stdout || python.stderr || 'Python ?').trim()}`,
  '',
  '| Command | What it covers | Result | Tests | Time | Full output |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows,
  '',
  allPassed ? 'All suites passed.' : '**At least one suite failed — see its output.**',
  '',
  'Where the tests are: `src/backend/tests/` (API + database), `src/frontend/src/**/*.test.tsx`',
  '(web app), `src/forecasting/tests/` (forecast engine, Lambda), `src/analytics/tests/` (ML model).',
  '',
].join('\n');
writeFileSync(path.join(PROJECT, 'evidence', 'test-runs', 'SUMMARY.md'), summary);
console.log(`\nSaved evidence/test-runs/SUMMARY.md and evidence/test-runs/${date}/`);
process.exit(allPassed ? 0 : 1);
