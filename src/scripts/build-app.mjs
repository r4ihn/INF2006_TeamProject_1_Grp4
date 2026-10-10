// npm run app:build — the web app + API as one release file for the AWS app servers (Task 11).
//
// Builds the frontend (Vite) and the backend (TypeScript → JavaScript), then packs what a
// server needs into dist/app/cafestock-app-<hash>.tgz:
//
//   package.json, package-lock.json, */package.json   so `npm ci` installs exactly these versions
//   backend/dist, backend/prisma, prisma.config.ts     the API, the migrations, the seed/import tools
//   frontend/dist                                      the web app (the API serves it)
//   data/   (from ../data)                             the café dataset (loaded on first start)
//   deploy/ec2/                                        the server set-up script and its config
//
// The hash in the name changes whenever the contents do, so CloudFormation sees a new release.
// Works the same on Windows, macOS and Linux (no tar or zip program needed).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.resolve(ROOT, '..'); // data/ sits beside src/
const OUT = path.join(ROOT, 'dist', 'app');
const FIXED_MTIME = Date.UTC(2026, 0, 1) / 1000; // same bytes for the same contents

const INCLUDE = [
  'package.json',
  'package-lock.json',
  'backend/package.json',
  'backend/prisma.config.ts',
  'backend/prisma',
  'backend/dist',
  'frontend/package.json',
  'frontend/dist',
  'deploy/ec2',
];
// Text files the Linux server runs or reads: always LF line endings, whatever the OS
const LF_ONLY = /\.(sh|service|json|conf|sql|prisma|ts|js|html|css|csv|md|txt)$/;

function npm(args) {
  // Inside `npm run`, npm_execpath points at npm's own script: run it with this Node
  const [cmd, pre] = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
  const r = spawnSync(cmd, [...pre, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: !process.env.npm_execpath && process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\n\`npm ${args.join(' ')}\` failed — fix the error above, then try again.`);
    process.exit(r.status ?? 1);
  }
}

function listFiles(rel, base = ROOT) {
  const abs = path.join(base, rel);
  if (!existsSync(abs)) throw new Error(`Missing ${rel} — did the build run?`);
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => !['node_modules', '__pycache__', '.DS_Store'].includes(e.name))
    .flatMap((e) => listFiles(`${rel}/${e.name}`, base));
}

/** One file in a POSIX (ustar) tar archive. */
function tarEntry(name, data, mode) {
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (Buffer.byteLength(base) > 100 || cut < 0) throw new Error(`Path too long for tar: ${name}`);
  }
  const h = Buffer.alloc(512);
  const put = (text, offset, length) => h.write(text, offset, length, 'utf8');
  put(base, 0, 100);
  h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  h.write('0000000\0', 108); // uid
  h.write('0000000\0', 116); // gid
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write(FIXED_MTIME.toString(8).padStart(11, '0') + '\0', 136);
  h.write('        ', 148); // checksum placeholder
  h.write('0', 156); // regular file
  h.write('ustar\0', 257);
  h.write('00', 263);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return [h, data, pad];
}

console.log('Building the web app and the API…');
npm(['run', 'build', '-w', 'frontend']);
npm(['run', 'build', '-w', 'backend']);

const files = [...new Set(INCLUDE.flatMap((r) => listFiles(r)))].sort();
const dataFiles = listFiles('data', PROJECT).sort(); // packed as data/ at the app root
const parts = [];
let bytes = 0;
for (const [rel, base] of [...files.map((f) => [f, ROOT]), ...dataFiles.map((f) => [f, PROJECT])]) {
  let data = readFileSync(path.join(base, rel));
  if (LF_ONLY.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  bytes += data.length;
  parts.push(...tarEntry(`cafestock/${rel}`, data, rel.endsWith('.sh') ? 0o755 : 0o644));
}
parts.push(Buffer.alloc(1024)); // end of archive
const tgz = gzipSync(Buffer.concat(parts), { level: 9 });
const sha256 = createHash('sha256').update(tgz).digest('hex');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const name = `cafestock-app-${sha256.slice(0, 12)}.tgz`;
writeFileSync(path.join(OUT, name), tgz);
writeFileSync(
  path.join(OUT, 'latest.json'),
  JSON.stringify({ file: name, sha256, bytes: tgz.length, files: files.length + dataFiles.length }, null, 2) + '\n',
);

console.log(`
Release   dist/app/${name}
Size      ${(tgz.length / 1e6).toFixed(1)} MB (${(bytes / 1e6).toFixed(1)} MB unpacked), ${files.length + dataFiles.length} files
SHA-256   ${sha256}

Next: upload it to your S3 bucket's app/ folder — see docs/aws-deploy.md.`);
