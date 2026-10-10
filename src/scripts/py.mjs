// Runs the Python forecasting package (forecasting/) the same way on Windows, macOS and Linux.
//
//   node scripts/py.mjs setup      create forecasting/.venv and install requirements.txt
//   node scripts/py.mjs test       run the Python tests
//   node scripts/py.mjs run [...]  python -m cafestock_forecast [...]
//
// Used by the forecast:*, analytics:* and lambda:* npm scripts.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'forecasting');
const VENV = path.join(PKG, '.venv');
const VENV_PYTHON =
  process.platform === 'win32'
    ? path.join(VENV, 'Scripts', 'python.exe')
    : path.join(VENV, 'bin', 'python');
const MIN = [3, 11];

const INSTALL_HELP =
  process.platform === 'win32'
    ? 'Install Python 3.12 or newer from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then open a new terminal.'
    : 'Install Python 3.12 or newer (https://www.python.org/downloads/), then open a new terminal.';

/** Finds a Python ≥ 3.11: the `py` launcher on Windows first (it skips the Microsoft Store stub). */
function findPython() {
  const candidates =
    process.platform === 'win32'
      ? [
          ['py', ['-3']],
          ['python', []],
          ['python3', []],
        ]
      : [
          ['python3', []],
          ['python', []],
        ];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(*sys.version_info[:2])'], {
      encoding: 'utf8',
    });
    if (r.status !== 0 || !r.stdout) continue;
    const [major, minor] = r.stdout.trim().split(' ').map(Number);
    if (major > MIN[0] || (major === MIN[0] && minor >= MIN[1]))
      return [cmd, pre, `${major}.${minor}`];
    console.error(`Found Python ${major}.${minor} (${cmd}), but ${MIN.join('.')}+ is needed.`);
  }
  return null;
}

/**
 * DATABASE_URL (and friends) from backend/.env, read with Node's own .env parser — the same
 * rules the API uses — so Python talks to the same database. Real environment variables win.
 */
function databaseEnv() {
  const envFile = path.join(ROOT, 'backend', '.env');
  if (!existsSync(envFile)) return {};
  const parsed = parseEnv(readFileSync(envFile, 'utf8'));
  const vars = {};
  for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL', 'DEMO_ORG_SLUG']) {
    if (parsed[key] && !process.env[key]) vars[key] = parsed[key];
  }
  return vars;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: PKG,
    env: {
      ...process.env,
      ...databaseEnv(),
      // `import cafestock_forecast` works from forecasting/ and analytics/ alike
      PYTHONPATH: PKG,
      PYTHONUTF8: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    ...opts,
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

/**
 * The database tests use the same cafestock_test database as `npm test`. Bring its tables up to
 * date first with `prisma migrate deploy` — it only adds what's missing and never wipes data —
 * so they don't depend on having run the API's tests. If the database is down, the Python
 * tests say so themselves.
 */
function prepareTestDatabase() {
  const url =
    process.env.TEST_DATABASE_URL ??
    databaseEnv().TEST_DATABASE_URL ??
    'postgresql://cafestock:cafestock@localhost:5433/cafestock_test';
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) return; // never touch a database that isn't clearly a test one
  let prismaCli;
  try {
    const require = createRequire(path.join(ROOT, 'backend', 'package.json'));
    prismaCli = path.join(
      path.dirname(require.resolve('prisma/package.json')),
      'build',
      'index.js',
    );
  } catch {
    return; // `npm install` not run yet; the Python tests explain what's missing
  }
  const r = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.log('(Couldn’t prepare the test database — is it running? `npm run db:up`)\n');
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [task = 'run', ...rest] = process.argv.slice(2);
/**
 * A venv only works on the machine that made it: pyvenv.cfg points at that machine's Python
 * (e.g. C:\Users\<someone else>\…). A copied-in .venv still has python.exe, so check it runs.
 */
function venvWorks() {
  if (!existsSync(VENV_PYTHON)) return false;
  return spawnSync(VENV_PYTHON, ['-c', 'import sys'], { stdio: 'ignore' }).status === 0;
}
const venvExists = existsSync(VENV);
const haveVenv = venvWorks();
const ANALYTICS = path.join(ROOT, '..', 'analytics'); // analytics/ sits beside src/

// ── setup: create the venv (once) and install requirements ──
if (task === 'setup' || task === 'analytics-setup') {
  if (!haveVenv) {
    const found = findPython();
    if (!found) fail(`Python ${MIN.join('.')}+ wasn't found. ${INSTALL_HELP}`);
    const [cmd, pre, version] = found;
    if (venvExists) {
      console.log('forecasting/.venv was made on another computer and does not run here; rebuilding it…');
      rmSync(VENV, { recursive: true, force: true });
    }
    console.log(`Creating forecasting/.venv with Python ${version}…`);
    const code = run(cmd, [...pre, '-m', 'venv', '.venv']);
    if (code !== 0) process.exit(code);
  }
  const analytics = task === 'analytics-setup';
  const requirements = analytics
    ? path.join(ANALYTICS, 'requirements.txt')
    : path.join(PKG, 'requirements.txt');
  if (analytics) console.log('Installing the analytics packages (LightGBM, numpy, pandas, …)…');
  const code = run(VENV_PYTHON, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '-q',
    '-r',
    requirements,
  ]);
  if (code === 0) {
    console.log(
      analytics
        ? 'Analytics environment ready. Try: npm run analytics:test'
        : 'Python forecasting environment ready. Try: npm run forecast:test',
    );
  }
  process.exit(code);
}

// ── forecast tests: work with the venv or a plain Python (database tests then skip) ──
if (task === 'test') {
  let python = VENV_PYTHON;
  let pre = [];
  if (!haveVenv) {
    const found = findPython();
    if (!found) fail(`Python ${MIN.join('.')}+ wasn't found. ${INSTALL_HELP}`);
    [python, pre] = found;
  }
  prepareTestDatabase();
  process.exit(run(python, [...pre, 'run_tests.py', ...rest]));
}

// ── everything else needs the venv ──
if (!haveVenv) {
  fail(
    venvExists
      ? 'forecasting/.venv was made on another computer. Run `npm run forecast:setup` to rebuild it.'
      : 'Run `npm run forecast:setup` first (once) to prepare Python.',
  );
}

const needsAnalytics = ['analytics', 'analytics-test', 'notebook', 'team'].includes(task);
if (needsAnalytics) {
  const probe = spawnSync(VENV_PYTHON, ['-c', 'import lightgbm, numpy, matplotlib'], {
    encoding: 'utf8',
  });
  if (probe.status !== 0) fail('Run `npm run analytics:setup` first (once) to install LightGBM.');
}

const TASKS = {
  // npm run forecast
  run: () => run(VENV_PYTHON, ['-m', 'cafestock_forecast', ...rest]),
  // npm run forecast:publish
  publish: () => run(VENV_PYTHON, ['-m', 'cafestock_forecast.publish', ...rest]),
  // npm run lambda:invoke — the nightly Lambda handler, run here (Task 10)
  'lambda-invoke': () => run(VENV_PYTHON, ['-m', 'cafestock_forecast.aws_lambda', ...rest]),
  // npm run lambda:build — the Lambda's deployment package (Linux wheels, any OS)
  'lambda-build': () =>
    run(VENV_PYTHON, [path.join(PKG, 'lambda', 'build.py'), ...rest], { cwd: ROOT }),
  // npm run analytics:snapshot
  snapshot: () => run(VENV_PYTHON, ['-m', 'cafestock_forecast.snapshot', ...rest]),
  // npm run analytics
  analytics: () =>
    run(VENV_PYTHON, [path.join(ANALYTICS, 'demand_model.py'), ...rest], { cwd: ROOT }),
  // npm run analytics:test
  'analytics-test': () => {
    prepareTestDatabase();
    return run(VENV_PYTHON, ['run_tests.py', path.join(ANALYTICS, 'tests'), ...rest]);
  },
  // npm run analytics:team — the team's weekly analysis (build_ledger → forecast → evaluate_policy)
  team: () => {
    for (const script of ['build_ledger.py', 'forecast.py', 'evaluate_policy.py']) {
      console.log(`\n── analytics/${script} ──`);
      const code = run(VENV_PYTHON, [path.join(ANALYTICS, script)], { cwd: ROOT });
      if (code !== 0) return code;
    }
    return 0;
  },
  // npm run analytics:notebook
  notebook: () =>
    run(VENV_PYTHON, [path.join(ANALYTICS, 'run_notebook.py'), ...rest], { cwd: ROOT }),
};

if (!TASKS[task]) {
  console.error(
    `Unknown task "${task}". Use one of: setup, analytics-setup, test, ${Object.keys(TASKS).join(', ')}.`,
  );
  process.exit(2);
}
process.exit(TASKS[task]());
