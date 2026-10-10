import { Router } from 'express';
import type { PrismaClient } from '../db/client.js';
import { PG, pgConstraint, pgErrorCode } from '../db/errors.js';
import { HttpError, notFound } from '../http/errors.js';
import { orgIdOf } from '../http/org-context.js';
import { byName, num, parseId } from '../http/params.js';
import { createItemSchema, listItemsQuerySchema, updateItemSchema } from '../validation/items.js';

// org_id is deliberately left out of responses.
const itemSelect = {
  id: true,
  name: true,
  sku: true,
  category: true,
  unit: true,
  unitCost: true,
  onHand: true,
  reorderPoint: true,
  spoilageCap: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true, leadTimeDays: true } },
} as const;

type Decimalish = { toString(): string };
interface ItemRow {
  unitCost: Decimalish;
  onHand: Decimalish;
  reorderPoint: Decimalish;
  spoilageCap: Decimalish | null;
  [key: string]: unknown;
}

function toDto(row: ItemRow) {
  const onHand = num(row.onHand);
  const reorderPoint = num(row.reorderPoint);
  return {
    ...row,
    unitCost: num(row.unitCost),
    onHand,
    reorderPoint,
    spoilageCap: num(row.spoilageCap),
    /** At or below the reorder point (and a reorder point is set) */
    isLow: reorderPoint > 0 && onHand <= reorderPoint,
  };
}

const itemId = (req: Parameters<typeof parseId>[0]) => parseId(req, 'Item');

const SUPPLIER_NOT_FOUND = () =>
  new HttpError(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
    supplierId: 'Choose one of your own suppliers',
  });

/** Turns database constraint errors on items into precise, per-field messages. */
function mapWriteError(err: unknown): never {
  const code = pgErrorCode(err);
  if (code === PG.UNIQUE_VIOLATION) {
    const constraint = pgConstraint(err) ?? '';
    if (constraint.includes('sku')) {
      throw new HttpError(409, 'CONFLICT', 'Another item already uses this SKU', {
        sku: 'Another item already uses this SKU',
      });
    }
    throw new HttpError(409, 'CONFLICT', 'An item with this name already exists', {
      name: 'An item with this name already exists',
    });
  }
  // The composite (supplier_id, org_id) foreign key: supplier missing or in another org
  if (code === PG.FOREIGN_KEY_VIOLATION) throw SUPPLIER_NOT_FOUND();
  throw err;
}

export function itemsRouter(prisma: PrismaClient): Router {
  const router = Router();

  /** Friendly early check; the database's composite foreign key is the real guarantee. */
  async function assertOwnSupplier(orgId: string, supplierId: string | null | undefined) {
    if (!supplierId) return;
    const found = await prisma.supplier.count({ where: { id: supplierId, orgId } });
    if (!found) throw SUPPLIER_NOT_FOUND();
  }

  /** "dairy" becomes "Dairy" if that category already exists, so lists don't split. */
  async function canonicalCategory(orgId: string, category: string | undefined) {
    if (category === undefined) return undefined;
    const existing = await prisma.item.findFirst({
      where: { orgId, category: { equals: category, mode: 'insensitive' } },
      select: { category: true },
    });
    return existing?.category ?? category;
  }

  // GET /api/items?search=milk&category=Dairy&supplierId=…&includeArchived=true
  router.get('/', async (req, res) => {
    const orgId = orgIdOf(req);
    const q = listItemsQuerySchema.parse(req.query);
    const rows = await prisma.item.findMany({
      where: {
        orgId,
        ...(q.includeArchived ? {} : { isActive: true }),
        ...(q.category ? { category: { equals: q.category, mode: 'insensitive' as const } } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' as const } },
                { sku: { contains: q.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: itemSelect,
    });
    rows.sort((a, b) => byName.compare(a.category, b.category) || byName.compare(a.name, b.name));
    res.json(rows.map(toDto));
  });

  // GET /api/items/categories — distinct categories in use, for the form's suggestions
  router.get('/categories', async (req, res) => {
    const rows = await prisma.item.findMany({
      where: { orgId: orgIdOf(req) },
      distinct: ['category'],
      select: { category: true },
    });
    res.json(rows.map((r) => r.category).sort(byName.compare));
  });

  // GET /api/items/:id
  router.get('/:id', async (req, res) => {
    const row = await prisma.item.findFirst({
      where: { id: itemId(req), orgId: orgIdOf(req) },
      select: itemSelect,
    });
    if (!row) throw notFound('Item');
    res.json(toDto(row));
  });

  // POST /api/items — new items start with 0 on hand; stock changes come from Task 5
  router.post('/', async (req, res) => {
    const orgId = orgIdOf(req);
    const data = createItemSchema.parse(req.body);
    await assertOwnSupplier(orgId, data.supplierId);
    data.category = (await canonicalCategory(orgId, data.category)) ?? data.category;
    try {
      const row = await prisma.item.create({ data: { ...data, orgId }, select: itemSelect });
      res.status(201).location(`/api/items/${row.id}`).json(toDto(row));
    } catch (err) {
      mapWriteError(err);
    }
  });

  // PATCH /api/items/:id — only the fields sent change; { isActive: false } archives
  router.patch('/:id', async (req, res) => {
    const id = itemId(req);
    const orgId = orgIdOf(req);
    const data = updateItemSchema.parse(req.body);
    await assertOwnSupplier(orgId, data.supplierId);
    data.category = await canonicalCategory(orgId, data.category);
    try {
      const row = await prisma.item.update({
        where: { id_orgId: { id, orgId } },
        data,
        select: itemSelect,
      });
      res.json(toDto(row));
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') throw notFound('Item');
      mapWriteError(err);
    }
  });

  // DELETE /api/items/:id — only for items with no history; otherwise archive them
  router.delete('/:id', async (req, res) => {
    const id = itemId(req);
    const orgId = orgIdOf(req);
    try {
      await prisma.item.delete({ where: { id_orgId: { id, orgId } } });
      res.status(204).end();
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') throw notFound('Item');
      if (pgErrorCode(err) === PG.FOREIGN_KEY_VIOLATION) {
        throw new HttpError(
          409,
          'IN_USE',
          'This item has stock or forecast history, so it can’t be deleted. Archive it instead.',
        );
      }
      throw err;
    }
  });

  return router;
}
