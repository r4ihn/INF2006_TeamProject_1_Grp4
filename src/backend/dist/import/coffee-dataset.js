import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addDays, isIsoDate } from '../lib/dates.js';
import { parseCsv } from './csv.js';
import { ImportError } from './errors.js';
/**
 * Reader for the team's café dataset (the `data/` folder, built by the analytics script from
 * a Kaggle coffee-shop sales export — see data/DATA_DICTIONARY.md):
 *
 *   ingredients.csv      the 8 stock items               → items (+ a supplier per lead time)
 *   daily_demand.csv     day × ingredient, explicit 0s   → demand_history (source IMPORT)
 *   stock_movements.csv  the append-only stock ledger    → inventory_movements (optional)
 *
 * Nothing here touches the database: it reads, validates and cross-checks the files, so a
 * broken dataset is refused before anything is written.
 */
export const DATASET_FILES = {
    ingredients: 'ingredients.csv',
    demand: 'daily_demand.csv',
    ledger: 'stock_movements.csv',
};
/** The provenance line recorded when none is given on the command line. */
export const DEFAULT_SOURCE = 'Kaggle coffee-shop point-of-sale export (Coffe_sales.csv: 3,547 real transactions, ' +
    '1 Mar 2024 – 23 Mar 2025), expanded into 8 ingredients through a recipe table by the ' +
    'team’s analytics script (seed 2006). Sales are real; recipe quantities, costs, pack sizes, ' +
    'deliveries and wastage are simulated. See data/DATA_DICTIONARY.md.';
export const LEDGER_TYPES = ['RECEIVE', 'SELL', 'SPOILAGE', 'ADJUST'];
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fmt = (n) => n.toLocaleString('en');
/** Column access for one CSV file, with errors that name the file, line and column. */
function sheet(file, table, required) {
    const index = new Map(table.header.map((h, i) => [h, i]));
    const missing = required.filter((c) => !index.has(c));
    if (missing.length > 0) {
        throw new ImportError(`${file} is missing the column${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. ` +
            `It has: ${table.header.join(', ')}.`);
    }
    return table.rows.map((row, i) => {
        const line = table.lines[i];
        const fail = (col, what) => {
            throw new ImportError(`${file} line ${line}: ${col} ${what} (got "${row[index.get(col)]}").`);
        };
        const raw = (col) => row[index.get(col)].trim();
        return {
            line,
            text: (col, max = 200) => {
                const v = raw(col);
                if (v === '')
                    fail(col, 'is blank');
                if (v.length > max)
                    fail(col, `is longer than ${max} characters`);
                return v;
            },
            optionalText: (col) => raw(col) || null,
            num: (col, { min = 0, integer = false } = {}) => {
                const v = raw(col);
                const n = v === '' ? Number.NaN : Number(v);
                if (!Number.isFinite(n))
                    fail(col, 'isn’t a number');
                if (integer && !Number.isInteger(n))
                    fail(col, 'isn’t a whole number');
                if (n < min)
                    fail(col, `must be at least ${min}`);
                return n;
            },
            /** "12" or "12.0" (pandas writes whole-number ids with a .0 when the column has blanks) */
            optionalId: (col) => {
                const v = raw(col);
                if (v === '')
                    return null;
                const n = Number(v);
                if (!Number.isInteger(n) || n < 0)
                    fail(col, 'isn’t a whole number');
                return n;
            },
            date: (col) => {
                const v = raw(col);
                if (!isIsoDate(v))
                    fail(col, 'isn’t a date in YYYY-MM-DD form');
                return v;
            },
        };
    });
}
function readIngredients(file, table) {
    const rows = sheet(file, table, [
        'ingredient_id',
        'sku',
        'ingredient_name',
        'unit',
        'unit_cost',
        'shelf_life_days',
        'storage_location',
        'lead_time_days',
        'pack_size',
        'pack_description',
        'reorder_threshold',
        'reorder_quantity',
        'avg_daily_demand_derived',
    ]);
    const ingredients = rows.map((r) => ({
        id: r.num('ingredient_id', { integer: true }),
        sku: r.text('sku', 40),
        name: r.text('ingredient_name', 120),
        unit: r.text('unit', 20),
        unitCost: r.num('unit_cost'),
        shelfLifeDays: r.num('shelf_life_days', { integer: true, min: 1 }),
        storageLocation: r.text('storage_location', 60),
        leadTimeDays: r.num('lead_time_days', { integer: true }),
        packSize: r.num('pack_size', { min: 0 }),
        packDescription: r.text('pack_description'),
        reorderThreshold: r.num('reorder_threshold'),
        reorderQuantity: r.num('reorder_quantity'),
        avgDailyDemand: r.num('avg_daily_demand_derived'),
    }));
    const dupe = (key, label) => {
        const seen = new Set();
        for (const i of ingredients) {
            const k = key(i);
            if (seen.has(k))
                throw new ImportError(`${file} lists ${label} "${k}" twice.`);
            seen.add(k);
        }
    };
    dupe((i) => String(i.id), 'ingredient_id');
    dupe((i) => i.sku, 'sku');
    dupe((i) => i.name.toLowerCase(), 'ingredient');
    for (const i of ingredients) {
        if (i.leadTimeDays > 365) {
            throw new ImportError(`${file}: ${i.name} has a lead time over 365 days.`);
        }
    }
    return ingredients;
}
function readDemand(file, table, ids) {
    const rows = sheet(file, table, ['date', 'ingredient_id', 'units']);
    const seen = new Set();
    return rows.map((r) => {
        const row = {
            date: r.date('date'),
            ingredientId: r.num('ingredient_id', { integer: true }),
            units: r.num('units'),
        };
        if (!ids.has(row.ingredientId)) {
            throw new ImportError(`${file} line ${r.line}: ingredient_id ${row.ingredientId} isn’t in ingredients.csv.`);
        }
        const key = `${row.date}|${row.ingredientId}`;
        if (seen.has(key)) {
            throw new ImportError(`${file} line ${r.line}: ingredient ${row.ingredientId} already has a row for ${row.date}.`);
        }
        seen.add(key);
        return row;
    });
}
function readLedger(file, table, ids) {
    const rows = sheet(file, table, [
        'movement_id',
        'occurred_at',
        'ingredient_id',
        'movement_type',
        'quantity',
        'sale_id',
        'caused_by_drink',
        'reason',
        'source',
    ]);
    return rows.map((r) => {
        const type = r.text('movement_type');
        if (!LEDGER_TYPES.includes(type)) {
            throw new ImportError(`${file} line ${r.line}: movement_type "${type}" isn’t one of ${LEDGER_TYPES.join(', ')}.`);
        }
        const occurredAt = r.text('occurred_at');
        if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(occurredAt) ||
            !isIsoDate(occurredAt.slice(0, 10))) {
            throw new ImportError(`${file} line ${r.line}: occurred_at "${occurredAt}" isn’t a date-time.`);
        }
        const row = {
            movementId: r.num('movement_id', { integer: true }),
            occurredAt,
            ingredientId: r.num('ingredient_id', { integer: true }),
            type,
            quantity: r.num('quantity', { min: -Infinity }),
            saleId: r.optionalId('sale_id'),
            drink: r.optionalText('caused_by_drink'),
            reason: r.optionalText('reason') ?? '',
            source: r.text('source'),
        };
        if (!ids.has(row.ingredientId)) {
            throw new ImportError(`${file} line ${r.line}: ingredient_id ${row.ingredientId} isn’t in ingredients.csv.`);
        }
        const sign = Math.sign(row.quantity);
        const ok = type === 'RECEIVE' ? sign > 0 : type === 'ADJUST' ? sign !== 0 : sign < 0; // SELL, SPOILAGE
        if (!ok) {
            throw new ImportError(`${file} line ${r.line}: a ${type} movement can’t have quantity ${row.quantity}.`);
        }
        return row;
    });
}
/** Ledger rows in the order they happened (the file's own order breaks ties). */
export function ledgerInOrder(ledger) {
    return [...ledger].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.movementId - b.movementId);
}
/** Exact decimal running totals: quantities have at most 3 places, so work in thousandths. */
export const toMilli = (n) => Math.round(n * 1000);
/**
 * Reads and cross-checks the dataset. Refuses it (ImportError) if a file is malformed,
 * refers to an unknown ingredient, lets stock go below zero, or if the ledger's sales don't
 * add up to daily_demand.csv — that match is what makes the demand history traceable to
 * real transactions.
 */
export function readDataset(files) {
    const warnings = [];
    const tables = {
        ingredients: parseCsv(files.ingredients.text),
        demand: parseCsv(files.demand.text),
        ledger: files.ledger ? parseCsv(files.ledger.text) : null,
    };
    const ingredients = readIngredients(files.ingredients.file, tables.ingredients);
    const ids = new Set(ingredients.map((i) => i.id));
    const nameOf = new Map(ingredients.map((i) => [i.id, i.name]));
    const demand = readDemand(files.demand.file, tables.demand, ids);
    if (demand.length === 0)
        throw new ImportError(`${files.demand.file} has no rows.`);
    let dateFrom = demand[0].date;
    let dateTo = dateFrom;
    for (const d of demand) {
        if (d.date < dateFrom)
            dateFrom = d.date;
        if (d.date > dateTo)
            dateTo = d.date;
    }
    const allDays = [];
    for (let d = dateFrom; d <= dateTo; d = addDays(d, 1))
        allDays.push(d);
    // Every ingredient should have every day, with explicit zeros (DATA_DICTIONARY.md)
    const byIngredient = new Map();
    for (const d of demand) {
        let m = byIngredient.get(d.ingredientId);
        if (!m)
            byIngredient.set(d.ingredientId, (m = new Map()));
        m.set(d.date, d.units);
    }
    for (const i of ingredients) {
        const have = byIngredient.get(i.id)?.size ?? 0;
        if (have === 0)
            warnings.push(`${i.name} has no rows in ${files.demand.file}.`);
        else if (have < allDays.length) {
            warnings.push(`${i.name} has ${fmt(allDays.length - have)} missing day(s) in ${files.demand.file}; ` +
                'they are left out, not treated as zero.');
        }
    }
    let ledger = null;
    if (files.ledger && tables.ledger) {
        ledger = ledgerInOrder(readLedger(files.ledger.file, tables.ledger, ids));
        const file = files.ledger.file;
        // Stock must never go below zero
        const balance = new Map();
        for (const m of ledger) {
            const after = (balance.get(m.ingredientId) ?? 0) + toMilli(m.quantity);
            if (after < 0) {
                throw new ImportError(`${file}: movement ${m.movementId} (${m.occurredAt}) takes ${nameOf.get(m.ingredientId)} below zero.`);
            }
            balance.set(m.ingredientId, after);
        }
        // Sales in the ledger must add up to daily_demand.csv, day by day
        const sold = new Map();
        for (const m of ledger) {
            if (m.type !== 'SELL')
                continue;
            const key = `${m.occurredAt.slice(0, 10)}|${m.ingredientId}`;
            sold.set(key, (sold.get(key) ?? 0) - toMilli(m.quantity));
        }
        const mismatches = [];
        for (const d of demand) {
            const key = `${d.date}|${d.ingredientId}`;
            const fromLedger = sold.get(key) ?? 0;
            if (fromLedger !== toMilli(d.units)) {
                mismatches.push(`${nameOf.get(d.ingredientId)} on ${d.date}: ${d.units} in ${files.demand.file}, ${fromLedger / 1000} sold in ${file}`);
            }
            sold.delete(key);
        }
        for (const [key, qty] of sold) {
            const [date, id] = key.split('|');
            mismatches.push(`${nameOf.get(Number(id))} on ${date}: no row in ${files.demand.file}, ${qty / 1000} sold in ${file}`);
        }
        if (mismatches.length > 0) {
            throw new ImportError(`The sales in ${file} don’t add up to ${files.demand.file} on ${fmt(mismatches.length)} day(s), ` +
                `so the demand history couldn’t be traced back to the sales. First: ${mismatches.slice(0, 3).join('; ')}.`);
        }
    }
    const info = (role, f, table) => ({
        role,
        file: f.file,
        rows: table.rows.length,
        sha256: sha256(f.text),
        columns: table.header,
    });
    const fileInfo = [
        info('ingredients', files.ingredients, tables.ingredients),
        info('demand', files.demand, tables.demand),
        ...(files.ledger && tables.ledger ? [info('ledger', files.ledger, tables.ledger)] : []),
    ];
    return {
        ingredients,
        demand,
        ledger,
        files: fileInfo,
        dateFrom,
        dateTo,
        dayCount: allDays.length,
        warnings,
    };
}
/** Reads the dataset files from a folder (e.g. the repo's data/). */
export async function loadDataset(dir, { ledger = true } = {}) {
    const load = async (role) => {
        const name = DATASET_FILES[role];
        const full = path.join(dir, name);
        try {
            return { file: name, text: await readFile(full, 'utf8') };
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                throw new ImportError(`Can’t find ${name} in ${dir}. Point --dir at the dataset folder.`);
            }
            throw err;
        }
    };
    return readDataset({
        ingredients: await load('ingredients'),
        demand: await load('demand'),
        ledger: ledger ? await load('ledger') : null,
    });
}
//# sourceMappingURL=coffee-dataset.js.map