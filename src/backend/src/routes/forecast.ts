import { Router } from 'express';
import type { PrismaClient } from '../db/client.js';
import { requireRole } from '../auth/authenticate.js';
import { orgIdOf } from '../http/org-context.js';
import { num } from '../http/params.js';
import { addDays, dbDate, isoDate } from '../lib/dates.js';

/** Days of actual demand sent with each item, for the trend line and chart */
export const HISTORY_DAYS = 28;

const STATUS_ORDER = { URGENT: 0, REORDER: 1, OK: 2 } as const;

const runSelect = {
  id: true,
  modelTag: true,
  modelKind: true,
  isFallback: true,
  baselineTag: true,
  forecastFrom: true,
  horizonDays: true,
  reviewDays: true,
  evalWeeks: true,
  serviceLevelZ: true,
  maseModel: true,
  maseBaseline: true,
  mapeModel: true,
  mapeBaseline: true,
  modelUri: true,
  itemsProcessed: true,
  startedAt: true,
  finishedAt: true,
} as const;

type RunRow = {
  [K in keyof typeof runSelect]: unknown;
} & {
  forecastFrom: Date;
  serviceLevelZ: { toString(): string };
  maseModel: { toString(): string } | null;
  maseBaseline: { toString(): string } | null;
  mapeModel: { toString(): string } | null;
  mapeBaseline: { toString(): string } | null;
};

function runDto(run: RunRow) {
  return {
    ...run,
    forecastFrom: isoDate(run.forecastFrom),
    serviceLevelZ: num(run.serviceLevelZ),
    maseModel: num(run.maseModel),
    maseBaseline: num(run.maseBaseline),
    mapeModel: num(run.mapeModel),
    mapeBaseline: num(run.mapeBaseline),
  };
}

/**
 * Forecast endpoints — managers only (staff get 403). They only read: the forecast tables are
 * written by the forecast job (`npm run forecast:publish`, nightly in AWS from Task 10).
 */
export function forecastRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireRole('MANAGER'));

  const latestRun = (orgId: string) =>
    prisma.forecastRun.findFirst({
      where: { orgId, status: 'SUCCEEDED' },
      orderBy: { startedAt: 'desc' },
      select: runSelect,
    });

  // GET /api/forecast/latest-run — just the run: model, errors, when
  router.get('/latest-run', async (req, res) => {
    const run = await latestRun(orgIdOf(req));
    res.json({ run: run && runDto(run as RunRow) });
  });

  // GET /api/forecast/latest — everything the forecast page shows, for the latest run
  router.get('/latest', async (req, res) => {
    const orgId = orgIdOf(req);
    const run = await latestRun(orgId);
    if (!run) {
      res.json({ run: null, summary: null, items: [] });
      return;
    }
    const from = isoDate(run.forecastFrom);
    const historyFrom = addDays(from, -HISTORY_DAYS);

    const [recs, forecasts] = await Promise.all([
      prisma.reorderRecommendation.findMany({
        where: { orgId, runId: run.id },
        include: { item: { select: { id: true, name: true, unit: true, category: true } } },
      }),
      prisma.forecast.findMany({
        where: { orgId, runId: run.id },
        orderBy: { forecastDate: 'asc' },
        select: {
          itemId: true,
          forecastDate: true,
          predictedQty: true,
          lowerQty: true,
          upperQty: true,
        },
      }),
    ]);
    const demand = await prisma.demandHistory.findMany({
      where: {
        orgId,
        itemId: { in: recs.map((r) => r.itemId) },
        date: { gte: dbDate(historyFrom), lt: dbDate(from) },
      },
      select: { itemId: true, date: true, quantity: true },
    });

    const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(historyFrom, i));
    const byName = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
    const items = recs
      .map((r) => {
        const observed = new Map(
          demand
            .filter((d) => d.itemId === r.itemId)
            .map((d) => [isoDate(d.date), num(d.quantity)]),
        );
        return {
          item: r.item,
          recommendation: {
            status: r.status,
            onHand: num(r.onHand),
            leadTimeDays: r.leadTimeDays,
            avgDailyDemand: num(r.avgDailyDemand),
            demandStdDev: num(r.demandStdDev),
            leadTimeDemand: num(r.leadTimeDemand),
            safetyStock: num(r.safetyStock),
            reorderPoint: num(r.reorderPoint),
            shortfall: num(r.shortfall),
            reviewDemand: num(r.reviewDemand),
            orderUpTo: num(r.orderUpTo),
            recommendedQty: num(r.recommendedQty),
            spoilageCapApplied: r.spoilageCapApplied,
            coverDays: num(r.coverDays),
            itemMase: num(r.itemMase),
            itemMape: num(r.itemMape),
            historyDays: r.historyDays,
            notes: r.notes,
          },
          forecast: forecasts
            .filter((f) => f.itemId === r.itemId)
            .map((f) => ({
              date: isoDate(f.forecastDate),
              predicted: num(f.predictedQty),
              lower: num(f.lowerQty),
              upper: num(f.upperQty),
            })),
          // Days with no row had no demand (or predate the item): 0
          history: days.map((date) => ({ date, quantity: observed.get(date) ?? 0 })),
        };
      })
      .sort(
        (a, b) =>
          STATUS_ORDER[a.recommendation.status] - STATUS_ORDER[b.recommendation.status] ||
          byName.compare(a.item.name, b.item.name),
      );

    const count = (s: keyof typeof STATUS_ORDER) =>
      items.filter((i) => i.recommendation.status === s).length;
    res.json({
      run: runDto(run as RunRow),
      summary: {
        items: items.length,
        urgent: count('URGENT'),
        reorder: count('REORDER'),
        ok: count('OK'),
      },
      items,
    });
  });

  return router;
}
