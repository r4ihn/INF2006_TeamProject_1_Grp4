import { Router } from 'express';
import type { PrismaClient } from '../db/client.js';
import { notFound } from '../http/errors.js';
import { authOf } from '../auth/authenticate.js';
import { orgIdOf } from '../http/org-context.js';
import { num } from '../http/params.js';
import { addDays, dateInTimeZone, dbDate, isoDate } from '../lib/dates.js';
import { demandSummary } from '../services/demand.js';
import { applyChanges, type AppliedChange } from '../services/stock.js';
import {
  countSchema,
  demandQuerySchema,
  listMovementsQuerySchema,
  movementSchema,
} from '../validation/stock.js';

const itemSummarySelect = {
  id: true,
  name: true,
  unit: true,
  onHand: true,
  reorderPoint: true,
} as const;

type ItemSummaryRow = {
  id: string;
  name: string;
  unit: string;
  onHand: { toString(): string };
  reorderPoint: { toString(): string };
};

function itemSummary(row: ItemSummaryRow) {
  const onHand = num(row.onHand);
  const reorderPoint = num(row.reorderPoint);
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    onHand,
    isLow: reorderPoint > 0 && onHand <= reorderPoint,
  };
}

function changeDto(a: AppliedChange) {
  return {
    movementId: a.movementId,
    itemId: a.itemId,
    type: a.type,
    before: num(a.before),
    change: num(a.change),
    after: num(a.after),
    demandRecorded: num(a.demand),
    demandDate: a.demandDate,
  };
}

export function stockRouter(prisma: PrismaClient): Router {
  const router = Router();

  const summaries = async (orgId: string, ids: string[]) => {
    const rows = await prisma.item.findMany({
      where: { orgId, id: { in: ids } },
      select: itemSummarySelect,
    });
    return ids.map((id) => itemSummary(rows.find((r) => r.id === id)!));
  };

  // POST /api/stock/movements — one delivery / usage / waste / adjustment
  router.post('/movements', async (req, res) => {
    const orgId = orgIdOf(req);
    const m = movementSchema.parse(req.body);
    const [applied] = await applyChanges(prisma, orgId, [
      {
        itemId: m.itemId,
        type: m.type,
        quantity: m.quantity,
        note: m.note,
        occurredAt: m.occurredAt,
        createdById: authOf(req).userId,
      },
    ]);
    const [item] = await summaries(orgId, [m.itemId]);
    res.status(201).json({ ...changeDto(applied!), item });
  });

  // POST /api/stock/counts — a stocktake: set each item to what was physically counted
  router.post('/counts', async (req, res) => {
    const orgId = orgIdOf(req);
    const body = countSchema.parse(req.body);
    const applied = await applyChanges(
      prisma,
      orgId,
      body.counts.map((c) => ({
        itemId: c.itemId,
        type: 'COUNT' as const,
        quantity: c.counted,
        note: body.note,
        occurredAt: body.occurredAt,
        createdById: authOf(req).userId,
      })),
    );
    const items = await summaries(
      orgId,
      body.counts.map((c) => c.itemId),
    );
    res.status(201).json({
      counted: applied.length,
      changes: applied.map((a, i) => ({ ...changeDto(a), item: items[i] })),
    });
  });

  // GET /api/stock/movements?itemId=…&type=USAGE&limit=50 — newest first
  router.get('/movements', async (req, res) => {
    const orgId = orgIdOf(req);
    const q = listMovementsQuerySchema.parse(req.query);
    const rows = await prisma.inventoryMovement.findMany({
      where: {
        orgId,
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.type ? { type: q.type } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: q.limit,
      select: {
        id: true,
        type: true,
        quantityChange: true,
        quantityAfter: true,
        note: true,
        occurredAt: true,
        createdAt: true,
        item: { select: { id: true, name: true, unit: true } },
        createdBy: { select: { email: true, displayName: true } },
        importId: true,
      },
    });
    res.json(
      rows.map(({ importId, ...r }) => ({
        ...r,
        quantityChange: num(r.quantityChange),
        quantityAfter: num(r.quantityAfter),
        /** From a dataset's stock ledger (Task 7) rather than recorded in the app */
        imported: importId !== null,
      })),
    );
  });

  // GET /api/stock/history — per item: how much demand history there is, and from where
  router.get('/history', async (req, res) => {
    res.json(await demandSummary(prisma, orgIdOf(req)));
  });

  // GET /api/stock/demand?itemId=…&days=14[&to=2025-03-23] — daily demand, oldest first,
  // missing days = 0
  router.get('/demand', async (req, res) => {
    const orgId = orgIdOf(req);
    const q = demandQuerySchema.parse(req.query);
    const [item, org] = await Promise.all([
      prisma.item.findFirst({ where: { id: q.itemId, orgId }, select: { id: true, unit: true } }),
      prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } }),
    ]);
    if (!item) throw notFound('Item');

    const to = q.to ?? dateInTimeZone(new Date(), org.timezone);
    const from = addDays(to, -(q.days - 1));
    const rows = await prisma.demandHistory.findMany({
      where: { orgId, itemId: q.itemId, date: { gte: dbDate(from), lte: dbDate(to) } },
      select: { date: true, quantity: true },
    });
    const byDate = new Map(rows.map((r) => [isoDate(r.date), num(r.quantity)]));
    const days = Array.from({ length: q.days }, (_, i) => {
      const date = addDays(from, i);
      return { date, quantity: byDate.get(date) ?? 0 };
    });
    const total = days.reduce((sum, d) => sum + d.quantity, 0);
    res.json({
      itemId: item.id,
      unit: item.unit,
      from,
      to,
      total: Math.round(total * 1000) / 1000,
      averagePerDay: Math.round((total / q.days) * 1000) / 1000,
      days,
    });
  });

  return router;
}
