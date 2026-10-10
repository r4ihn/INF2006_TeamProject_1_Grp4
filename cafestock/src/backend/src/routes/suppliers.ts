import { Router } from 'express';
import type { PrismaClient } from '../db/client.js';
import { PG, pgErrorCode } from '../db/errors.js';
import { HttpError, notFound } from '../http/errors.js';
import { orgIdOf } from '../http/org-context.js';
import { byName, parseId } from '../http/params.js';
import {
  createSupplierSchema,
  listQuerySchema,
  updateSupplierSchema,
} from '../validation/suppliers.js';

// What the API returns for a supplier. org_id is deliberately left out — the client never
// needs it and never gets to choose it.
const supplierSelect = {
  id: true,
  name: true,
  contactName: true,
  email: true,
  phone: true,
  leadTimeDays: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} as const;

type SupplierRow = {
  _count: { items: number };
} & Record<string, unknown>;

function toDto({ _count, ...supplier }: SupplierRow) {
  return { ...supplier, itemCount: _count.items };
}

const DUPLICATE_NAME = () =>
  new HttpError(409, 'CONFLICT', 'A supplier with this name already exists', {
    name: 'A supplier with this name already exists',
  });

const supplierId = (req: Parameters<typeof parseId>[0]) => parseId(req, 'Supplier');

export function suppliersRouter(prisma: PrismaClient): Router {
  const router = Router();

  // GET /api/suppliers?search=bean
  router.get('/', async (req, res) => {
    const orgId = orgIdOf(req);
    const { search } = listQuerySchema.parse(req.query);
    const rows = await prisma.supplier.findMany({
      where: {
        orgId,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      select: supplierSelect,
    });
    rows.sort((a, b) => byName.compare(a.name, b.name));
    res.json(rows.map(toDto));
  });

  // GET /api/suppliers/:id
  router.get('/:id', async (req, res) => {
    const row = await prisma.supplier.findFirst({
      where: { id: supplierId(req), orgId: orgIdOf(req) },
      select: supplierSelect,
    });
    if (!row) throw notFound('Supplier');
    res.json(toDto(row));
  });

  // POST /api/suppliers
  router.post('/', async (req, res) => {
    const orgId = orgIdOf(req);
    const data = createSupplierSchema.parse(req.body);
    try {
      const row = await prisma.supplier.create({
        data: { ...data, orgId },
        select: supplierSelect,
      });
      res.status(201).location(`/api/suppliers/${row.id}`).json(toDto(row));
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) throw DUPLICATE_NAME();
      throw err;
    }
  });

  // PATCH /api/suppliers/:id — only the fields sent are changed
  router.patch('/:id', async (req, res) => {
    const id = supplierId(req);
    const orgId = orgIdOf(req);
    const data = updateSupplierSchema.parse(req.body);
    try {
      // The compound (id, org_id) key means a supplier from another org is simply "not found".
      const row = await prisma.supplier.update({
        where: { id_orgId: { id, orgId } },
        data,
        select: supplierSelect,
      });
      res.json(toDto(row));
    } catch (err) {
      if (pgErrorCode(err) === PG.UNIQUE_VIOLATION) throw DUPLICATE_NAME();
      if ((err as { code?: string }).code === 'P2025') throw notFound('Supplier');
      throw err;
    }
  });

  // DELETE /api/suppliers/:id
  router.delete('/:id', async (req, res) => {
    const id = supplierId(req);
    const orgId = orgIdOf(req);
    try {
      await prisma.supplier.delete({ where: { id_orgId: { id, orgId } } });
      res.status(204).end();
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') throw notFound('Supplier');
      if (pgErrorCode(err) === PG.FOREIGN_KEY_VIOLATION) {
        const itemCount = await prisma.item.count({ where: { orgId, supplierId: id } });
        throw new HttpError(
          409,
          'IN_USE',
          `This supplier still has ${itemCount} item${itemCount === 1 ? '' : 's'}. ` +
            'Move them to another supplier first.',
        );
      }
      throw err;
    }
  });

  return router;
}
