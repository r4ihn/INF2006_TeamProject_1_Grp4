import type { PrismaClient } from '../db/client.js';
import { addDays, dbDate, localTimeToInstant } from '../lib/dates.js';
import { toMilli, type Dataset, type Ingredient, type LedgerRow } from './coffee-dataset.js';
import { ImportError } from './errors.js';

export interface ImportOptions {
  orgId: string;
  dataset: Dataset;
  /** Provenance, in words */
  source: string;
  /** Whole days added to every date (a multiple of 7 keeps weekdays); 0 = real dates */
  shiftDays?: number;
  /** Remove data from earlier imports first */
  replace?: boolean;
  /** Check everything and report, then roll back */
  dryRun?: boolean;
}

export interface ImportResult {
  importId: string | null;
  dryRun: boolean;
  dateFrom: string;
  dateTo: string;
  dayCount: number;
  shiftDays: number;
  items: { created: number; matched: number };
  suppliersCreated: number;
  demand: { inserted: number; updated: number; unchanged: number; skipped: number };
  movementsInserted: number;
  /** Items whose stock ledger wasn't imported, and why */
  ledgerSkipped: { item: string; reason: string }[];
  replaced: { demandRows: number; movements: number } | null;
}

/** How the dataset's movement types map onto the app's. */
const MOVEMENT_TYPE = {
  RECEIVE: 'RECEIVE',
  SELL: 'USAGE',
  SPOILAGE: 'WASTE',
  ADJUST: 'ADJUSTMENT',
} as const;

/** "unit" in the dataset reads oddly next to a number in the app ("8 unit"), so use "pcs". */
const appUnit = (unit: string) => (unit.toLowerCase() === 'unit' ? 'pcs' : unit);

/**
 * The dataset gives each ingredient a lead time (1 day for chilled, 3 for ambient) but no
 * supplier, so one supplier is created per lead time, named after how its items are stored.
 */
export function supplierNames(ingredients: Ingredient[]): Map<number, string> {
  const leads = [...new Set(ingredients.map((i) => i.leadTimeDays))].sort((a, b) => a - b);
  const base = new Map(
    leads.map((lead) => {
      const stored = ingredients.filter((i) => i.leadTimeDays === lead);
      const chilled = stored.every((i) => /chill|fridge|freez|cold/i.test(i.storageLocation));
      return [lead, chilled ? 'Chilled goods supplier' : 'Dry goods supplier'] as const;
    }),
  );
  const clash = (name: string) => [...base.values()].filter((n) => n === name).length > 1;
  return new Map(
    leads.map((lead) => {
      const name = base.get(lead)!;
      return [lead, clash(name) ? `${name} (${lead}-day)` : name];
    }),
  );
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * The dataset's ordering rule caps an order at half the shelf life's worth of demand, so a
 * perishable is never bought in a quantity it can't sell through. That is exactly what the
 * app's spoilage cap means (DATA_DICTIONARY.md, "Simulation notes").
 */
export const spoilageCapOf = (i: Ingredient) =>
  Math.floor((i.shelfLifeDays / 2) * i.avgDailyDemand);

/** Values for a new item created from an ingredient row. */
export function itemFromIngredient(i: Ingredient) {
  return {
    sku: i.sku,
    name: i.name,
    category: i.storageLocation,
    unit: appUnit(i.unit),
    unitCost: round(i.unitCost, 4),
    reorderPoint: round(i.reorderThreshold, 3),
    spoilageCap: spoilageCapOf(i),
  };
}

/** The ledger note shown in the app's Activity list. */
export function movementNote(m: LedgerRow): string {
  if (m.type === 'SELL') {
    const sale = m.saleId !== null ? `Sale #${m.saleId}` : 'Sale';
    return m.drink ? `${sale} — ${m.drink}` : sale;
  }
  const reason = m.reason || m.type.toLowerCase();
  return m.source === 'synthetic' ? `${reason} (simulated)` : reason;
}

class DryRunRollback extends Error {}

const CHUNK = 5000;
function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * Writes a checked dataset into one organisation, in a single transaction:
 *
 *  1. items — matched to existing ones by SKU, then by name (case-insensitive); only missing
 *     ones are created. Existing items are never changed.
 *  2. demand_history — one IMPORT row per item per day. Re-running updates changed values and
 *     leaves identical ones alone. Days the app itself recorded (source MOVEMENTS) are never
 *     overwritten.
 *  3. inventory_movements — the ledger, for items with no stock history yet; items.on_hand
 *     becomes the ledger's closing balance. Items already imported are skipped, which is
 *     what makes re-running safe.
 *  4. dataset_imports — a provenance row for this run.
 */
export async function importDataset(
  prisma: PrismaClient,
  options: ImportOptions,
): Promise<ImportResult> {
  const { orgId, dataset, dryRun = false, replace = false } = options;
  const shiftDays = options.shiftDays ?? 0;
  const source = options.source.trim();
  if (source === '') throw new ImportError('Say where the data came from (--source).');
  const shift = (date: string) => (shiftDays ? addDays(date, shiftDays) : date);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  if (!org) throw new ImportError('That organisation doesn’t exist.');

  const run = async (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => {
    // One import at a time per organisation
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dataset-import:${orgId}`}))`;

    const previous = await tx.datasetImport.findFirst({
      where: { orgId },
      orderBy: { importedAt: 'desc' },
      select: { dateShiftDays: true },
    });
    if (previous && previous.dateShiftDays !== shiftDays && !replace) {
      throw new ImportError(
        `The last import ${previous.dateShiftDays ? `moved dates by ${previous.dateShiftDays} days` : 'kept the real dates'}, ` +
          `but this one ${shiftDays ? `moves them by ${shiftDays}` : 'keeps the real dates'}. ` +
          'Mixing the two would put the same history on two sets of dates. Run again with --replace.',
      );
    }

    // ── 0. --replace: remove earlier imported data ──
    let replaced: ImportResult['replaced'] = null;
    if (replace) {
      const tangled = await tx.$queryRaw<{ name: string }[]>`
        SELECT DISTINCT i.name FROM inventory_movements m JOIN items i ON i.id = m.item_id
        WHERE m.org_id = ${orgId}::uuid AND m.import_id IS NULL
          AND m.item_id IN (SELECT item_id FROM inventory_movements
                            WHERE org_id = ${orgId}::uuid AND import_id IS NOT NULL)
        ORDER BY i.name`;
      if (tangled.length > 0) {
        throw new ImportError(
          `Can’t replace the import: ${tangled.map((t) => t.name).join(', ')} ` +
            `${tangled.length === 1 ? 'has' : 'have'} stock changes recorded in the app on top of the ` +
            'imported ledger, and removing the ledger would leave their stock history wrong.',
        );
      }
      const importedItems = await tx.inventoryMovement.findMany({
        where: { orgId, importId: { not: null } },
        distinct: ['itemId'],
        select: { itemId: true },
      });
      const movements = await tx.inventoryMovement.deleteMany({
        where: { orgId, importId: { not: null } },
      });
      await tx.item.updateMany({
        where: { orgId, id: { in: importedItems.map((i) => i.itemId) } },
        data: { onHand: 0 },
      });
      const demandRows = await tx.demandHistory.deleteMany({
        where: { orgId, source: 'IMPORT' },
      });
      replaced = { demandRows: demandRows.count, movements: movements.count };
    }

    // ── 1. suppliers and items ──
    let suppliersCreated = 0;
    const supplierIds = new Map<number, string>();
    for (const [lead, name] of supplierNames(dataset.ingredients)) {
      const existing = await tx.supplier.findFirst({
        where: { orgId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        supplierIds.set(lead, existing.id);
        continue;
      }
      const created = await tx.supplier.create({
        data: {
          orgId,
          name,
          leadTimeDays: lead,
          notes:
            `Created by the dataset import. The dataset gives each ingredient a lead time (${lead} day${lead === 1 ? '' : 's'} for these) ` +
            'but no supplier, so rename this or move the items to your real supplier.',
        },
        select: { id: true },
      });
      supplierIds.set(lead, created.id);
      suppliersCreated++;
    }

    const existingItems = await tx.item.findMany({
      where: { orgId },
      select: { id: true, sku: true, name: true, unit: true },
    });
    const itemIds = new Map<number, string>(); // ingredient id → item id
    let created = 0;
    for (const ing of dataset.ingredients) {
      const match =
        existingItems.find((i) => i.sku === ing.sku) ??
        existingItems.find((i) => i.name.toLowerCase() === ing.name.toLowerCase());
      if (match) {
        // Quantities are only meaningful in the dataset's unit: 1,559 g must not become 1,559 kg
        const unit = appUnit(ing.unit);
        if (match.unit.trim().toLowerCase() !== unit.toLowerCase()) {
          throw new ImportError(
            `Your item "${match.name}" is measured in ${match.unit}, but the dataset measures ` +
              `${ing.name} in ${unit}, so its history and stock would be wrong. Change the item's unit ` +
              `to ${unit} or rename it on the Items page, or start clean with \`npm run db:reset\`.`,
          );
        }
        itemIds.set(ing.id, match.id);
        continue;
      }
      const row = await tx.item.create({
        data: { orgId, supplierId: supplierIds.get(ing.leadTimeDays)!, ...itemFromIngredient(ing) },
        select: { id: true },
      });
      itemIds.set(ing.id, row.id);
      created++;
    }

    // ── 4 (first, for the id). provenance ──
    const record = await tx.datasetImport.create({
      data: {
        orgId,
        source,
        files: dataset.files.map((f) => ({ ...f })),
        itemCount: dataset.ingredients.length,
        dayCount: dataset.dayCount,
        dateFrom: dbDate(shift(dataset.dateFrom)),
        dateTo: dbDate(shift(dataset.dateTo)),
        dateShiftDays: shiftDays,
        itemsCreated: created,
        demandInserted: 0,
        demandUpdated: 0,
        demandUnchanged: 0,
        demandSkipped: 0,
        movementsInserted: 0,
        ledgerItemsSkipped: 0,
        replaced: replace,
      },
      select: { id: true },
    });

    // ── 2. demand history ──
    const demand = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
    for (const part of chunks(dataset.demand)) {
      const items = part.map((d) => itemIds.get(d.ingredientId)!);
      const dates = part.map((d) => shift(d.date));
      const quantities = part.map((d) => String(d.units));
      const [{ skipped }] = await tx.$queryRaw<[{ skipped: number }]>`
        SELECT count(*)::int AS skipped
        FROM demand_history d
        JOIN unnest(${items}::uuid[], ${dates}::date[]) AS k(item_id, date)
          ON d.item_id = k.item_id AND d.date = k.date
        WHERE d.org_id = ${orgId}::uuid AND d.source = 'MOVEMENTS'`;
      const written = await tx.$queryRaw<{ inserted: boolean }[]>`
        INSERT INTO demand_history (org_id, item_id, date, quantity, source, import_id)
        SELECT ${orgId}::uuid, k.item_id, k.date, k.quantity, 'IMPORT', ${record.id}::uuid
        FROM unnest(${items}::uuid[], ${dates}::date[], ${quantities}::numeric[])
          AS k(item_id, date, quantity)
        ON CONFLICT (org_id, item_id, date) DO UPDATE
          SET quantity = EXCLUDED.quantity, import_id = EXCLUDED.import_id, updated_at = now()
          WHERE demand_history.source = 'IMPORT' AND demand_history.quantity <> EXCLUDED.quantity
        RETURNING (xmax = 0) AS inserted`;
      const inserted = written.filter((w) => w.inserted).length;
      demand.inserted += inserted;
      demand.updated += written.length - inserted;
      demand.skipped += skipped;
      demand.unchanged += part.length - written.length - skipped;
    }

    // ── 3. stock ledger ──
    let movementsInserted = 0;
    const ledgerSkipped: ImportResult['ledgerSkipped'] = [];
    if (dataset.ledger) {
      const history = await tx.inventoryMovement.groupBy({
        by: ['itemId'],
        where: { orgId, itemId: { in: [...itemIds.values()] } },
        _count: { importId: true, _all: true },
      });
      const historyOf = new Map(history.map((h) => [h.itemId, h._count]));
      const byIngredient = new Map<number, LedgerRow[]>();
      for (const m of dataset.ledger) {
        const rows = byIngredient.get(m.ingredientId) ?? [];
        rows.push(m);
        byIngredient.set(m.ingredientId, rows);
      }

      for (const ing of dataset.ingredients) {
        const itemId = itemIds.get(ing.id)!;
        const rows = byIngredient.get(ing.id) ?? [];
        const counts = historyOf.get(itemId);
        if (counts && counts._all > 0) {
          ledgerSkipped.push({
            item: ing.name,
            reason:
              counts.importId === counts._all
                ? 'ledger already imported'
                : 'has stock changes recorded in the app',
          });
          continue;
        }
        if (rows.length === 0) continue;

        let balance = 0; // thousandths
        const types: string[] = [];
        const changes: string[] = [];
        const afters: string[] = [];
        const notes: string[] = [];
        const times: string[] = [];
        for (const m of rows) {
          balance += toMilli(m.quantity);
          const local = shiftDays
            ? `${shift(m.occurredAt.slice(0, 10))}${m.occurredAt.slice(10)}`
            : m.occurredAt;
          const at = localTimeToInstant(local, org.timezone);
          if (!at) throw new ImportError(`Movement ${m.movementId} has an unreadable time.`);
          types.push(MOVEMENT_TYPE[m.type]);
          changes.push(String(m.quantity));
          afters.push(String(balance / 1000));
          notes.push(movementNote(m));
          times.push(at.toISOString());
        }
        for (let i = 0; i < rows.length; i += CHUNK) {
          const s = (a: string[]) => a.slice(i, i + CHUNK);
          movementsInserted += await tx.$executeRaw`
            INSERT INTO inventory_movements
              (org_id, item_id, type, quantity_change, quantity_after, note, occurred_at, import_id)
            SELECT ${orgId}::uuid, ${itemId}::uuid, k.type::movement_type, k.change, k.after,
                   k.note, k.at, ${record.id}::uuid
            FROM unnest(${s(types)}::text[], ${s(changes)}::numeric[], ${s(afters)}::numeric[],
                        ${s(notes)}::text[], ${s(times)}::timestamptz[])
              AS k(type, change, after, note, at)`;
        }
        await tx.item.update({ where: { id: itemId }, data: { onHand: String(balance / 1000) } });
      }
    }

    await tx.datasetImport.update({
      where: { id: record.id },
      data: {
        demandInserted: demand.inserted,
        demandUpdated: demand.updated,
        demandUnchanged: demand.unchanged,
        demandSkipped: demand.skipped,
        movementsInserted,
        ledgerItemsSkipped: ledgerSkipped.length,
      },
    });

    const result: ImportResult = {
      importId: record.id,
      dryRun,
      dateFrom: shift(dataset.dateFrom),
      dateTo: shift(dataset.dateTo),
      dayCount: dataset.dayCount,
      shiftDays,
      items: { created, matched: dataset.ingredients.length - created },
      suppliersCreated,
      demand,
      movementsInserted,
      ledgerSkipped,
      replaced,
    };
    if (dryRun) throw new DryRunRollback(JSON.stringify(result));
    return result;
  };

  try {
    return await prisma.$transaction(run, { timeout: 180_000, maxWait: 15_000 });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      return { ...(JSON.parse(err.message) as ImportResult), importId: null };
    }
    throw err;
  }
}
