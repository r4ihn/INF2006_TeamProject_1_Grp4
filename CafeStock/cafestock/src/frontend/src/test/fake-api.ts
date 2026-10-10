import { vi } from 'vitest';
import type { Item, Movement, Supplier } from '../api';
import { jsonResponse } from './render';

type FakeItem = Omit<Item, 'supplier' | 'isLow'> & {
  supplierId: string | null;
  hasHistory?: boolean;
};

/**
 * A small in-memory stand-in for the real /api endpoints, installed as `fetch`.
 * It mimics the rules the UI relies on (duplicate names → 409, unknown supplier → 400,
 * records still in use can't be deleted → 409) so tests exercise real user flows.
 */
export function installFakeApi({
  suppliers = [],
  items = [],
}: {
  suppliers?: Partial<Supplier>[];
  items?: (Partial<FakeItem> & { supplierName?: string })[];
} = {}) {
  let nextId = 1;
  const newId = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
  const stamp = { createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z' };

  const supplierDb = new Map<string, Supplier>();
  for (const s of suppliers) {
    const full: Supplier = {
      id: newId(),
      name: 'Unnamed',
      contactName: null,
      email: null,
      phone: null,
      leadTimeDays: 2,
      notes: null,
      itemCount: 0,
      ...stamp,
      ...s,
    };
    supplierDb.set(full.id, full);
  }
  const supplierByName = (name?: string) =>
    [...supplierDb.values()].find((s) => s.name === name)?.id ?? null;

  const itemDb = new Map<string, FakeItem>();
  for (const { supplierName, ...i } of items) {
    const full: FakeItem = {
      id: newId(),
      name: 'Unnamed',
      sku: null,
      category: 'General',
      unit: 'pcs',
      unitCost: 0,
      onHand: 0,
      reorderPoint: 0,
      spoilageCap: null,
      isActive: true,
      ...stamp,
      ...i,
      supplierId: i.supplierId ?? supplierByName(supplierName),
    };
    itemDb.set(full.id, full);
  }

  const itemDto = ({ supplierId, hasHistory: _h, ...i }: FakeItem): Item => {
    const s = supplierId ? supplierDb.get(supplierId) : undefined;
    return {
      ...i,
      supplier: s ? { id: s.id, name: s.name, leadTimeDays: s.leadTimeDays } : null,
      isLow: i.reorderPoint > 0 && i.onHand <= i.reorderPoint,
    };
  };
  const supplierDto = (s: Supplier): Supplier => ({
    ...s,
    // Items linked in this fake, or the count a test preset
    itemCount: Math.max(
      s.itemCount,
      [...itemDb.values()].filter((i) => i.supplierId === s.id).length,
    ),
  });

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
  const clean = <T>(body: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, k === 'name' ? String(v).trim() : blank(v)]),
    ) as Partial<T>;
  const error = (status: number, code: string, message: string, fields?: object) =>
    jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) } }, status);

  const movements: Movement[] = [];
  const demandToday = new Map<string, number>();
  function applyStock(item: FakeItem, type: Movement['type'], change: number, note: string | null) {
    const before = item.onHand;
    const after = Math.round((before + change) * 1000) / 1000;
    item.onHand = after;
    const demand = type === 'USAGE' ? -change : type === 'COUNT' && change < 0 ? -change : 0;
    if (demand > 0) demandToday.set(item.id, (demandToday.get(item.id) ?? 0) + demand);
    const m: Movement = {
      id: newId(),
      type,
      quantityChange: change,
      quantityAfter: after,
      note,
      occurredAt: '2026-09-25T01:30:00.000Z',
      createdAt: '2026-09-25T01:30:00.000Z',
      item: { id: item.id, name: item.name, unit: item.unit },
      createdBy: { email: 'staff@demo.cafe', displayName: 'Sam (staff)' },
      imported: false,
    };
    movements.push(m);
    const dto = itemDto(item);
    return {
      movementId: m.id,
      itemId: item.id,
      type,
      before,
      change,
      after,
      demandRecorded: demand,
      demandDate: demand > 0 ? '2026-09-25' : null,
      item: { id: item.id, name: item.name, unit: item.unit, onHand: after, isLow: dto.isLow },
    };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    // ── suppliers ──
    const sId = url.match(/^\/api\/suppliers\/([^/?]+)$/)?.[1];
    if (url === '/api/suppliers' && method === 'GET') {
      return jsonResponse([...supplierDb.values()].sort(byName).map(supplierDto));
    }
    if (url === '/api/suppliers' && method === 'POST') {
      const data = clean<Supplier>(body);
      if ([...supplierDb.values()].some((s) => s.name === data.name)) {
        const msg = 'A supplier with this name already exists';
        return error(409, 'CONFLICT', msg, { name: msg });
      }
      const s: Supplier = {
        id: newId(),
        name: '',
        contactName: null,
        email: null,
        phone: null,
        leadTimeDays: 2,
        notes: null,
        itemCount: 0,
        ...stamp,
        ...data,
      };
      supplierDb.set(s.id, s);
      return jsonResponse(supplierDto(s), 201);
    }
    if (sId && method === 'PATCH') {
      const existing = supplierDb.get(sId);
      if (!existing) return error(404, 'NOT_FOUND', 'Supplier not found');
      const data = clean<Supplier>(body);
      if ([...supplierDb.values()].some((s) => s.name === data.name && s.id !== sId)) {
        const msg = 'A supplier with this name already exists';
        return error(409, 'CONFLICT', msg, { name: msg });
      }
      const s = { ...existing, ...data };
      supplierDb.set(sId, s);
      return jsonResponse(supplierDto(s));
    }
    if (sId && method === 'DELETE') {
      const s = supplierDb.get(sId);
      if (!s) return error(404, 'NOT_FOUND', 'Supplier not found');
      const count = supplierDto(s).itemCount;
      if (count > 0) {
        return error(
          409,
          'IN_USE',
          `This supplier still has ${count} items. Move them to another supplier first.`,
        );
      }
      supplierDb.delete(sId);
      return jsonResponse(null, 204);
    }

    // ── items ──
    const iId = url.match(/^\/api\/items\/([^/?]+)$/)?.[1];
    if (url === '/api/items?includeArchived=true' && method === 'GET') {
      return jsonResponse([...itemDb.values()].map(itemDto));
    }
    if ((url === '/api/items' && method === 'POST') || (iId && method === 'PATCH')) {
      const existing = iId ? itemDb.get(iId) : undefined;
      if (iId && !existing) return error(404, 'NOT_FOUND', 'Item not found');
      const data = clean<FakeItem>(body);
      if (data.supplierId && !supplierDb.has(data.supplierId)) {
        return error(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
          supplierId: 'Choose one of your own suppliers',
        });
      }
      if ([...itemDb.values()].some((i) => i.name === data.name && i.id !== iId)) {
        const msg = 'An item with this name already exists';
        return error(409, 'CONFLICT', msg, { name: msg });
      }
      const item: FakeItem = existing
        ? { ...existing, ...data }
        : {
            id: newId(),
            name: '',
            sku: null,
            category: '',
            unit: '',
            unitCost: 0,
            onHand: 0,
            reorderPoint: 0,
            spoilageCap: null,
            isActive: true,
            supplierId: null,
            ...stamp,
            ...data,
          };
      itemDb.set(item.id, item);
      return jsonResponse(itemDto(item), existing ? 200 : 201);
    }
    if (iId && method === 'DELETE') {
      const item = itemDb.get(iId);
      if (!item) return error(404, 'NOT_FOUND', 'Item not found');
      if (item.hasHistory) {
        return error(
          409,
          'IN_USE',
          'This item has stock or forecast history, so it can’t be deleted. Archive it instead.',
        );
      }
      itemDb.delete(iId);
      return jsonResponse(null, 204);
    }

    // ── stock ──
    if (url === '/api/stock/movements' && method === 'POST') {
      const item = itemDb.get(String(body.itemId));
      if (!item) {
        return error(400, 'VALIDATION_ERROR', 'Some fields are invalid', {
          itemId: 'Choose one of your own items',
        });
      }
      const q = Number(body.quantity);
      const type = String(body.type) as Movement['type'];
      const change = type === 'USAGE' || type === 'WASTE' ? -q : q;
      if (item.onHand + change < 0) {
        const msg = `Only ${item.onHand} ${item.unit} on hand`;
        return error(409, 'INSUFFICIENT_STOCK', `${msg} of ${item.name}.`, { quantity: msg });
      }
      const result = applyStock(item, type, change, (body.note as string) ?? null);
      return jsonResponse(result, 201);
    }
    if (url === '/api/stock/counts' && method === 'POST') {
      const counts = body.counts as { itemId: string; counted: number }[];
      const changes = counts.map((c) => {
        const item = itemDb.get(c.itemId)!;
        return applyStock(item, 'COUNT', c.counted - item.onHand, (body.note as string) ?? null);
      });
      return jsonResponse({ counted: changes.length, changes }, 201);
    }
    if (url.startsWith('/api/stock/movements?') && method === 'GET') {
      const qs = new URLSearchParams(url.split('?')[1]);
      const itemId = qs.get('itemId');
      return jsonResponse(
        movements
          .filter((m) => !itemId || m.item.id === itemId)
          .slice()
          .reverse(),
      );
    }
    if (url.startsWith('/api/stock/demand?') && method === 'GET') {
      const qs = new URLSearchParams(url.split('?')[1]);
      const item = itemDb.get(qs.get('itemId') ?? '');
      if (!item) return error(404, 'NOT_FOUND', 'Item not found');
      const days = Number(qs.get('days') ?? 14);
      const series = Array.from({ length: days }, (_, i) => ({
        date: `2026-09-${String(12 + i).padStart(2, '0')}`,
        quantity: i === days - 1 ? (demandToday.get(item.id) ?? 0) : 0,
      }));
      const total = series.reduce((sum, d) => sum + d.quantity, 0);
      return jsonResponse({
        itemId: item.id,
        unit: item.unit,
        from: series[0]!.date,
        to: series.at(-1)!.date,
        total,
        averagePerDay: total / days,
        days: series,
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  const itemByName = (name: string) => [...itemDb.values()].find((i) => i.name === name)?.id ?? '';
  return { fetchMock, suppliers: supplierDb, items: itemDb, movements, supplierByName, itemByName };
}
