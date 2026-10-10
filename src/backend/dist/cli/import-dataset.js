// Imports the team's café dataset (data/ at the repo root) into one organisation.
//
//   npm run db:import                          real dates, into the demo café
//   npm run db:import -- --dry-run             check the files and show what would change
//   npm run db:import -- --shift-to-recent     move dates forward so the history ends yesterday
//   npm run db:import -- --help                all options
//
// Safe to run again: nothing already imported is duplicated.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPrismaClient } from '../db/client.js';
import { dateInTimeZone } from '../lib/dates.js';
import { DEFAULT_SOURCE, loadDataset } from '../import/coffee-dataset.js';
import { ImportError } from '../import/errors.js';
import { importDataset } from '../import/import-dataset.js';
import { recentShiftDays } from '../import/shift.js';
import { demandSummary } from '../services/demand.js';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const HELP = `Import the café dataset into CafeStock.

Usage: npm run db:import -- [options]

  --dir <folder>       Dataset folder with ingredients.csv, daily_demand.csv and
                       stock_movements.csv (default: the repo's data folder)
  --org <slug>         Organisation to import into (default: ${'$'}DEMO_ORG_SLUG or demo-cafe)
  --source "<text>"    Where the data came from, saved with the import
                       (default: the team dataset's description)
  --shift-to-recent    Move every date forward in whole weeks so the history ends
                       in the last 7 days (weekdays are kept; the shift is recorded)
  --no-ledger          Import items and daily demand only, not the stock ledger
  --replace            Remove data from earlier imports first
  --dry-run            Check everything and show what would change, without saving
  --if-empty           Do nothing if this organisation already has an import (used when
                       a new server starts on AWS, so the demo data is loaded only once)
  --help               Show this help
`;
const n = (v) => v.toLocaleString('en');
const qty = (v, unit) => `${v.toLocaleString('en', { maximumFractionDigits: 2 })} ${unit}`;
function table(rows, rightAlign) {
    const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
    return rows.map((r) => r
        .map((cell, c) => rightAlign.includes(c) ? cell.padStart(widths[c]) : cell.padEnd(widths[c]))
        .join('  ')
        .trimEnd());
}
function report(io, result) {
    const d = result.demand;
    io.log(`  Dates     ${result.dateFrom} → ${result.dateTo} (${n(result.dayCount)} days)`);
    if (result.shiftDays) {
        io.log(`            moved forward ${n(result.shiftDays)} days (${result.shiftDays / 7} weeks) from the real dates`);
    }
    io.log(`  Items     ${result.items.created} created, ${result.items.matched} already there`);
    if (result.suppliersCreated)
        io.log(`  Suppliers ${result.suppliersCreated} created`);
    io.log(`  Demand    ${n(d.inserted)} new, ${n(d.updated)} changed, ${n(d.unchanged)} unchanged` +
        (d.skipped ? `, ${n(d.skipped)} kept (recorded in the app)` : ''));
    io.log(`  Ledger    ${n(result.movementsInserted)} stock changes added`);
    for (const s of result.ledgerSkipped)
        io.log(`            ${s.item}: skipped, ${s.reason}`);
    if (result.replaced) {
        io.log(`  Replaced  removed ${n(result.replaced.demandRows)} demand rows and ${n(result.replaced.movements)} stock changes from earlier imports`);
    }
}
/** Runs the import with command-line arguments. Returns the process exit code. */
export async function main(argv, { prisma, io = { log: console.log, error: console.error }, } = {}) {
    let args;
    try {
        args = parseArgs({
            args: argv,
            options: {
                dir: { type: 'string' },
                org: { type: 'string' },
                source: { type: 'string' },
                'shift-to-recent': { type: 'boolean', default: false },
                'no-ledger': { type: 'boolean', default: false },
                replace: { type: 'boolean', default: false },
                'dry-run': { type: 'boolean', default: false },
                'if-empty': { type: 'boolean', default: false },
                help: { type: 'boolean', default: false },
            },
            strict: true,
            allowPositionals: false,
        }).values;
    }
    catch (err) {
        io.error(`${err.message}\n\n${HELP}`);
        return 2;
    }
    if (args.help) {
        io.log(HELP);
        return 0;
    }
    // npm runs this from backend/, so resolve --dir against where the command was typed
    const cwd = process.env.INIT_CWD ?? process.cwd();
    const dir = args.dir ? path.resolve(cwd, args.dir) : path.join(REPO_ROOT, 'data');
    const config = loadConfig();
    const slug = args.org ?? config.demoOrgSlug;
    const db = prisma ?? createPrismaClient(config.databaseUrl);
    try {
        const org = await db.organization.findUnique({ where: { slug } });
        if (!org) {
            throw new ImportError(`There’s no organisation "${slug}". Run \`npm run db:setup\` first, or pass --org <slug>.`);
        }
        if (args['if-empty']) {
            const earlier = await db.datasetImport.count({ where: { orgId: org.id } });
            if (earlier > 0) {
                io.log(`${org.name} already has ${earlier} dataset import${earlier === 1 ? '' : 's'} — nothing to do (--if-empty).`);
                return 0;
            }
        }
        io.log(`Reading ${dir}`);
        const dataset = await loadDataset(dir, { ledger: !args['no-ledger'] });
        for (const f of dataset.files) {
            io.log(`  ${f.file.padEnd(20)} ${n(f.rows).padStart(7)} rows   sha256 ${f.sha256.slice(0, 12)}…`);
        }
        io.log(`  Checked: ${dataset.ingredients.length} ingredients, ${n(dataset.dayCount)} days` +
            (dataset.ledger ? ', ledger never below zero, sales match daily demand' : ''));
        for (const w of dataset.warnings)
            io.log(`  Note: ${w}`);
        const today = dateInTimeZone(new Date(), org.timezone);
        const shiftDays = args['shift-to-recent'] ? recentShiftDays(dataset.dateTo, today) : 0;
        const result = await importDataset(db, {
            orgId: org.id,
            dataset,
            source: args.source ?? DEFAULT_SOURCE,
            shiftDays,
            replace: args.replace,
            dryRun: args['dry-run'],
        });
        io.log('');
        io.log(result.dryRun
            ? `Dry run for ${org.name} (${org.slug}) — nothing was saved:`
            : `Imported into ${org.name} (${org.slug}):`);
        report(io, result);
        if (!result.dryRun) {
            const summary = await demandSummary(db, org.id);
            io.log('');
            const rows = [
                ['Item', 'Days', 'From', 'To', 'Avg/day', 'On hand'],
                ...summary.map((s) => [
                    s.name,
                    n(s.days),
                    s.firstDate,
                    s.lastDate,
                    qty(s.averagePerDay, s.unit),
                    qty(s.onHand, s.unit),
                ]),
            ];
            for (const line of table(rows, [1, 4, 5]))
                io.log(`  ${line}`);
            io.log('');
            io.log('See it in the app: npm run dev → Stock → History.');
        }
        return 0;
    }
    catch (err) {
        if (err instanceof ImportError) {
            io.error(`\nImport stopped: ${err.message}\nNothing was saved.`);
            return 1;
        }
        throw err;
    }
    finally {
        if (!prisma)
            await db.$disconnect();
    }
}
// Run when called directly (not when imported by a test)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.loadEnvFile();
    }
    catch {
        // No .env — use defaults.
    }
    process.exitCode = await main(process.argv.slice(2));
}
//# sourceMappingURL=import-dataset.js.map