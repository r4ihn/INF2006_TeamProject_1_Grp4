// The one place stock levels change.
//
// Every change — delivery, usage, waste, adjustment or physical count — does three things
// inside a single database transaction:
//   1. locks the item row (SELECT … FOR UPDATE) so two people recording at the same time
//      can't both read "10 on hand" and overwrite each other,
//   2. updates items.on_hand and appends an inventory_movements row with the result,
//   3. adds any demand to demand_history for the café's calendar day.
//
// What counts as demand (what the forecast learns from):
//   • USAGE                      — the quantity used
//   • COUNT that finds less stock than expected — the shortfall (usage nobody logged)
//   • WASTE, ADJUSTMENT, deliveries, and counts that find extra stock — not demand
import { Prisma, type MovementType } from '../generated/prisma/client.js';
import type { PrismaClient } from '../db/client.js';
import { HttpError } from '../http/errors.js';
import { dateInTimeZone, dbDate } from '../lib/dates.js';

type Tx = Prisma.TransactionClient;
const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

export interface StockChange {
  itemId: string;
  type: MovementType;
  /** RECEIVE/USAGE/WASTE: amount (> 0). ADJUSTMENT: signed amount. COUNT: counted total. */
  quantity: number;
  note?: string | null;
  occurredAt: Date;
  createdById?: string | null;
}

export interface AppliedChange {
  movementId: string;
  itemId: string;
  type: MovementType;
  before: Decimal;
  change: Decimal;
  after: Decimal;
  demand: Decimal;
  demandDate: string | null;
}

const ITEM_NOT_FOUND = () =>
  new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
    itemId: 'Choose one of your own items',
  });

/** Applies one change inside an existing transaction. The caller owns the transaction. */
export async function applyChange(
  tx: Tx,
  orgId: string,
  timeZone: string,
  c: StockChange,
): Promise<AppliedChange> {
  const [item] = await tx.$queryRaw<
    { on_hand: string; is_active: boolean; name: string; unit: string }[]
  >`SELECT on_hand::text, is_active, name, unit
      FROM items
     WHERE id = ${c.itemId}::uuid AND org_id = ${orgId}::uuid
       FOR UPDATE`;
  if (!item) throw ITEM_NOT_FOUND();
  if (!item.is_active) {
    throw new HttpError(
      409,
      'ITEM_ARCHIVED',
      `${item.name} is archived. Restore it on the Items page before recording stock.`,
    );
  }

  const before = new Decimal(item.on_hand);
  const q = new Decimal(c.quantity);
  let change: Decimal;
  switch (c.type) {
    case 'RECEIVE':
      change = q;
      break;
    case 'USAGE':
    case 'WASTE':
      change = q.negated();
      break;
    case 'ADJUSTMENT':
      change = q;
      break;
    case 'COUNT':
      change = q.minus(before);
      break;
  }
  const after = before.plus(change);

  if (after.isNegative()) {
    const onHand = `${before.toString()} ${item.unit}`;
    throw new HttpError(
      409,
      'INSUFFICIENT_STOCK',
      `Only ${onHand} of ${item.name} on hand. If that's wrong, record a stock count first.`,
      { quantity: `Only ${onHand} on hand` },
    );
  }

  await tx.item.update({
    where: { id_orgId: { id: c.itemId, orgId } },
    data: { onHand: after },
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      orgId,
      itemId: c.itemId,
      type: c.type,
      quantityChange: change,
      quantityAfter: after,
      note: c.note ?? null,
      occurredAt: c.occurredAt,
      createdById: c.createdById ?? null,
    },
    select: { id: true },
  });

  let demand = new Decimal(0);
  if (c.type === 'USAGE') demand = q;
  else if (c.type === 'COUNT' && change.isNegative()) demand = change.negated();

  let demandDate: string | null = null;
  if (demand.greaterThan(0)) {
    demandDate = dateInTimeZone(c.occurredAt, timeZone);
    await tx.demandHistory.upsert({
      where: {
        orgId_itemId_date: { orgId, itemId: c.itemId, date: dbDate(demandDate) },
      },
      create: {
        orgId,
        itemId: c.itemId,
        date: dbDate(demandDate),
        quantity: demand,
        source: 'MOVEMENTS',
      },
      update: { quantity: { increment: demand } },
    });
  }

  return {
    movementId: movement.id,
    itemId: c.itemId,
    type: c.type,
    before,
    change,
    after,
    demand,
    demandDate,
  };
}

/** Runs several changes atomically: all are saved, or none are. */
export async function applyChanges(
  prisma: PrismaClient,
  orgId: string,
  changes: StockChange[],
): Promise<AppliedChange[]> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { timezone: true },
  });
  // Lock items in a fixed order so two stocktakes over the same items can't deadlock.
  const ordered = [...changes].sort((a, b) => a.itemId.localeCompare(b.itemId));
  const applied = await prisma.$transaction(
    async (tx) => {
      const out: AppliedChange[] = [];
      for (const c of ordered) out.push(await applyChange(tx, orgId, org.timezone, c));
      return out;
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
  // Return in the order the caller sent them
  const byItem = new Map(applied.map((a) => [a.itemId, a]));
  return changes.map((c) => byItem.get(c.itemId)!);
}
