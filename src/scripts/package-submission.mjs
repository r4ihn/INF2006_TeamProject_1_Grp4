// npm run submission -- --group G012 [--draft]
//
// Builds the submission ZIP exactly as the brief requires (section 6), and runs its preflight
// checklist (Appendix A) first. The project folder already has the required layout; this
// script zips it (this src/ folder becomes src/ in the ZIP):
//
//   Group_G012_INF2006_Project.zip
//   ├─ README.md, project_manifest.yaml, report.pdf
//   ├─ TEAM_CONTRIBUTIONS.md, AI_USE_DECLARATION.md, video_link.txt (optional)
//   ├─ tests/  evidence/  data/  analytics/
//   └─ src/    the whole runnable project (without node_modules, builds, secrets)
//
// Checks: required files; every path in project_manifest.yaml exists; no "TO FILL" left;
// no credentials (access keys, private keys, real .env files); evidence redaction hints.
// --draft: build anyway (named …-DRAFT.zip) and report problems as warnings.
import { crc32, deflateRawSync } from 'node:zlib';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // src/
const PROJECT = path.resolve(ROOT, '..'); // the submission root
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const groupArg = (() => {
  const i = args.indexOf('--group');
  return i >= 0 ? args[i + 1] : undefined;
})();

const errors = [];
const warnings = [];
const problem = (msg) => (draft ? warnings : errors).push(msg);

// ── What goes where ──────────────────────────────────────────────────────────
const SKIP_NAMES = new Set([
  'node_modules',
  '.venv',
  '__pycache__',
  '.ipynb_checkpoints',
  '.pytest_cache',
  '.DS_Store',
  'Thumbs.db',
  '.git',
  '.backups',
  'coverage',
  '.setup-manifest.json',
]);
const SKIP_PATHS = new Set([
  'dist',
  'backend/src/generated',
  'backend/dist',
  'frontend/dist',
]);
const isSecretFile = (name) => /^\.env(\..+)?$/.test(name) && name !== '.env.example';

function walk(base, rel, { skipTop = false } = {}) {
  const abs = path.join(base, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  const out = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_NAMES.has(e.name) || e.name.endsWith('.log')) continue;
    if (skipTop && SKIP_PATHS.has(child)) continue;
    if (e.isFile() && isSecretFile(e.name)) {
      warnings.push(`Left out ${child} (a real .env file must never be submitted)`);
      continue;
    }
    out.push(...walk(base, child, { skipTop }));
  }
  return out;
}

const files = new Map(); // zip path → source path (absolute)
const put = (zipPath, src) => files.set(zipPath, src);
for (const zipName of [
  'README.md',
  'project_manifest.yaml',
  'report.pdf',
  'TEAM_CONTRIBUTIONS.md',
  'AI_USE_DECLARATION.md',
  'video_link.txt',
]) {
  if (existsSync(path.join(PROJECT, zipName))) put(zipName, path.join(PROJECT, zipName));
}
for (const top of ['tests', 'evidence', 'data', 'analytics'])
  for (const f of walk(PROJECT, top)) put(f, path.join(PROJECT, f));
for (const f of walk(ROOT, '', { skipTop: true })) put(`src/${f}`, path.join(ROOT, f));

// ── Checks ───────────────────────────────────────────────────────────────────
const manifestText = files.has('project_manifest.yaml')
  ? readFileSync(files.get('project_manifest.yaml'), 'utf8')
  : '';
const groupInManifest = manifestText.match(/group_id:\s*['"]?([^'"\s#]+)/)?.[1] ?? '';
const group = groupArg ?? groupInManifest;
if (!/^G\d{3}$/.test(group)) {
  problem(
    `Group id "${group || '?'}" isn't like G012. Set project.group_id in project_manifest.yaml and pass --group G012.`,
  );
} else if (groupInManifest !== group) {
  problem(`--group ${group} doesn't match project.group_id "${groupInManifest}" in the manifest.`);
}

for (const required of [
  'README.md',
  'project_manifest.yaml',
  'report.pdf',
  'TEAM_CONTRIBUTIONS.md',
  'AI_USE_DECLARATION.md',
  'data/README.md',
  'data/DATA_DICTIONARY.md',
  'analytics/README.md',
  'analytics/requirements.txt',
  'tests/README.md',
  'evidence/architecture.png',
  'src/package.json',
  'src/backend/.env.example',
]) {
  if (!files.has(required)) {
    problem(
      required === 'report.pdf'
        ? 'report.pdf is missing — export the report to report.pdf (project root).'
        : `Missing ${required}.`,
    );
  }
}

// Every path in the manifest must exist in the ZIP
const manifestPaths = [
  ...manifestText.matchAll(/['"]([^'"\s]+\.(?:md|png|pdf|yaml|yml|ipynb|txt|csv))['"]/g),
].map((m) => m[1]);
for (const p of new Set(manifestPaths)) {
  if (!files.has(p)) problem(`project_manifest.yaml points to ${p}, which isn't in the ZIP.`);
}

// Text files we can scan
const TEXT =
  /\.(md|ya?ml|json|txt|ts|tsx|js|mjs|cjs|py|sh|sql|prisma|html|css|csv|toml|ini|cfg|service|conf|example|ipynb)$/i;
const textOf = (abs) => {
  const src = abs;
  if (!TEXT.test(src) || statSync(abs).size > 3_000_000) return null;
  return readFileSync(abs, 'utf8');
};

// Placeholders left in what the marker reads
const placeholderFiles = [...files.keys()].filter(
  (z) =>
    /^(README\.md|project_manifest\.yaml|TEAM_CONTRIBUTIONS\.md|AI_USE_DECLARATION\.md)$/.test(z) ||
    /^(evidence|tests)\/.+\.md$/.test(z) ||
    z === 'data/README.md',
);
for (const z of placeholderFiles) {
  const text = textOf(files.get(z)) ?? '';
  const hits = text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) =>
      /TO FILL|['"]Gxxx['"]|\(Gxxx\)|_\(team member\)_|Draft for the team to check/.test(line),
    );
  if (hits.length) {
    problem(
      `${z}: ${hits.length} place(s) still to fill in (first at line ${hits[0].n}: "${hits[0].line.trim().slice(0, 70)}")`,
    );
  }
}

// Credentials: never allowed
const SECRET_PATTERNS = [
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/aws_secret_access_key\s*[=:]\s*\S{20,}/i, 'an AWS secret access key'],
  [/aws_session_token\s*[=:]\s*\S{20,}/i, 'an AWS session token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'a private key'],
  [
    /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    'a real-looking JWT token',
  ],
];
// Account ids, ARNs and live addresses: should be redacted in evidence
const REDACT_PATTERNS = [
  [/arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/, 'an ARN with an account id'],
  [/\b\d{12}\b/, 'a 12-digit number (an AWS account id?)'],
  [
    /https:\/\/[a-z0-9]{10}\.execute-api\.[a-z0-9-]+\.amazonaws\.com/,
    'the live API Gateway address',
  ],
  [/[a-z0-9-]+\.[a-z0-9]{12}\.[a-z0-9-]+\.rds\.amazonaws\.com/, 'the database address'],
];
const ALLOWED_TOKENS = [
  /src\/backend\/tests\//,
  /src\/frontend\/src\/.*\.test\.tsx$/,
  /src\/scripts\/smoke-test\.mjs$/,
];
for (const [z, src] of files) {
  const text = textOf(src);
  if (text === null) continue;
  for (const [re, what] of SECRET_PATTERNS) {
    if (re.test(text) && !(what.includes('JWT') && ALLOWED_TOKENS.some((a) => a.test(z)))) {
      errors.push(`${z} contains what looks like ${what}. Remove it before submitting.`);
    }
  }
  // Documents a marker reads (not data files, where long numbers are normal)
  if (/^(evidence\/.+|[^/]+)\.(md|txt|yaml)$/.test(z)) {
    for (const [re, what] of REDACT_PATTERNS) {
      if (re.test(text))
        warnings.push(`${z} contains ${what} — redact it (the brief asks for this).`);
    }
  }
}

const screenshots = [...files.keys()].filter((z) =>
  /^evidence\/screenshots\/.+\.(png|jpe?g)$/i.test(z),
);
if (!screenshots.length)
  warnings.push('No screenshots in evidence/screenshots/ yet (the test records ask for some).');
if (
  existsSync(path.join(PROJECT, 'data/raw')) &&
  /Licence\*\* \| TO FILL/.test(readFileSync(path.join(PROJECT, 'data/README.md'), 'utf8'))
) {
  warnings.push(
    'data/raw/ is included but the dataset licence in data/README.md isn’t confirmed yet.',
  );
}

// ── Report, then build ───────────────────────────────────────────────────────
const name = `Group_${/^G\d{3}$/.test(group) ? group : 'Gxxx'}_INF2006_Project${draft ? '-DRAFT' : ''}.zip`;
console.log(`Submission preflight — ${files.size} files\n`);
for (const e of errors) console.log(`  ✗ ${e}`);
for (const w of warnings) console.log(`  ! ${w}`);
if (!errors.length && !warnings.length) console.log('  ✓ All checks passed.');

if (errors.length) {
  console.log(
    `\n${errors.length} problem(s) to fix first — no ZIP was made.${draft ? '' : ' (Use --draft to build a draft anyway.)'}`,
  );
  process.exit(1);
}

/** A standard ZIP (deflate), readable by Windows, macOS and Linux. */
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0; // 00:00:00
  const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 11; // 11 Oct 2026
  for (const [zipPath, data] of entries) {
    const nameBuf = Buffer.from(zipPath, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4); // made by: Unix, zip 3.0
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // rw-r--r--
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const entries = [...files.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([z, src]) => [z, readFileSync(src)]);
const out = path.join(ROOT, 'dist', 'submission');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const blob = zip(entries);
writeFileSync(path.join(out, name), blob);
const mb = (blob.length / 1e6).toFixed(1);
console.log(
  `\n${draft ? 'Draft built' : 'Built'}: dist/submission/${name} (${mb} MB, ${entries.length} files)`,
);
if (draft && (warnings.length || errors.length))
  console.log('Fix the items marked ! before the final build (without --draft).');
