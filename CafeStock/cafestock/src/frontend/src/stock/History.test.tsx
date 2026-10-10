import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DatasetImport, ItemHistory } from '../api';
import { jsonResponse, renderWithProviders } from '../test/render';
import { StockPage } from './StockPage';

const history = (over: Partial<ItemHistory>): ItemHistory => ({
  itemId: 'x',
  name: 'X',
  unit: 'pcs',
  category: 'Dry Store 1',
  isActive: true,
  onHand: 0,
  days: 14,
  importedDays: 14,
  recordedDays: 0,
  zeroDays: 0,
  firstDate: '2025-03-10',
  lastDate: '2025-03-23',
  total: 0,
  averagePerDay: 0,
  ...over,
});

const ITEMS: ItemHistory[] = [
  history({ itemId: 'cocoa', name: 'Cocoa powder', unit: 'g', zeroDays: 9, averagePerDay: 15.399 }),
  history({
    itemId: 'milk',
    name: 'Fresh milk',
    unit: 'ml',
    onHand: 5700,
    zeroDays: 1,
    averagePerDay: 1039.742,
    recordedDays: 2,
  }),
];

const IMPORT: DatasetImport = {
  id: 'imp-1',
  source: 'Kaggle coffee-shop point-of-sale export (test)',
  files: [
    { role: 'ingredients', file: 'ingredients.csv', rows: 8, sha256: 'a'.repeat(64), columns: [] },
    { role: 'demand', file: 'daily_demand.csv', rows: 3104, sha256: 'b'.repeat(64), columns: [] },
  ],
  itemCount: 8,
  dayCount: 388,
  dateFrom: '2024-03-01',
  dateTo: '2025-03-23',
  dateShiftDays: 0,
  itemsCreated: 8,
  demandInserted: 3104,
  demandUpdated: 0,
  demandUnchanged: 0,
  demandSkipped: 0,
  movementsInserted: 17049,
  ledgerItemsSkipped: 0,
  replaced: false,
  importedAt: '2026-09-25T07:05:00.000Z',
};

/** 14 days of demand ending 23 Mar 2025: 100, 200, …, with day 3 empty */
const series = (itemId: string, unit: string) => {
  const days = Array.from({ length: 14 }, (_, i) => ({
    date: `2025-03-${String(10 + i).padStart(2, '0')}`,
    quantity: i === 2 ? 0 : (i + 1) * 100,
  }));
  return {
    itemId,
    unit,
    from: days[0]!.date,
    to: days[13]!.date,
    total: 0,
    averagePerDay: 0,
    days,
  };
};

function install({ items = ITEMS, imports = [IMPORT] } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/items?includeArchived=true') return jsonResponse([]);
    if (url === '/api/stock/history') return jsonResponse(items);
    if (url === '/api/imports') return jsonResponse(imports);
    if (url.startsWith('/api/stock/demand?')) {
      const qs = new URLSearchParams(url.split('?')[1]);
      const item = items.find((i) => i.itemId === qs.get('itemId'))!;
      return jsonResponse(series(item.itemId, item.unit));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('StockPage — history', () => {
  it('shows where the data came from', async () => {
    install();
    const user = userEvent.setup();
    renderWithProviders(<StockPage />, { route: '/stock?tab=history' });

    const card = within(await screen.findByRole('region', { name: 'Where this data came from' }));
    expect(card.getByText(/Kaggle coffee-shop point-of-sale export/)).toBeInTheDocument();
    expect(card.getByText('1 Mar 2024 – 23 Mar 2025 (388 days)')).toBeInTheDocument();
    await user.click(card.getByText('Files and checksums'));
    expect(card.getByText('daily_demand.csv')).toBeInTheDocument();
    expect(card.getByText(/3,104 rows/)).toBeInTheDocument();
    expect(card.getByText('bbbbbbbbbbbb…')).toBeInTheDocument();
  });

  it('explains how to import when nothing has been imported', async () => {
    install({ items: [], imports: [] });
    renderWithProviders(<StockPage />, { route: '/stock?tab=history' });
    expect(await screen.findByText('No dataset imported yet')).toBeInTheDocument();
    expect(screen.getByText('npm run db:import')).toBeInTheDocument();
    expect(await screen.findByText('No demand history yet')).toBeInTheDocument();
  });

  it('lists each item’s history and charts the steadiest one first', async () => {
    install();
    renderWithProviders(<StockPage />, { route: '/stock?tab=history' });

    // Fresh milk has fewer days with no demand than cocoa, so it's charted first
    expect(
      await screen.findByRole('heading', { name: 'Fresh milk — daily demand' }),
    ).toBeInTheDocument();
    const table = within(screen.getByRole('table', { name: /History for 2 items/ }));
    const milk = within(table.getByRole('button', { name: 'Fresh milk' }).closest('tr')!);
    expect(milk.getByText('1,039.7 ml')).toBeInTheDocument();
    expect(milk.getByText('(7%)')).toBeInTheDocument();
    expect(milk.getByText('Dataset + app')).toBeInTheDocument();
    expect(table.getByRole('button', { name: 'Fresh milk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The chart describes itself for screen readers, and reads out the latest day
    expect(
      await screen.findByRole('img', {
        name: /Daily demand for Fresh milk, 10 Mar 2025 to 23 Mar 2025/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('1,400 ml')).toBeInTheDocument();
  });

  it('switches item, and asks for the history up to the item’s last day', async () => {
    const fetchMock = install();
    const user = userEvent.setup();
    renderWithProviders(<StockPage />, { route: '/stock?tab=history' });

    await user.click(await screen.findByRole('button', { name: 'Cocoa powder' }));
    expect(
      await screen.findByRole('heading', { name: 'Cocoa powder — daily demand' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stock/demand?itemId=cocoa&days=14&to=2025-03-23',
      expect.anything(),
    );
  });

  it('reads any day with the arrow keys, and offers the numbers as a table', async () => {
    install();
    const user = userEvent.setup();
    renderWithProviders(<StockPage />, { route: '/stock?tab=history&item=milk' });

    const chart = await screen.findByRole('img', { name: /Daily demand for Fresh milk/ });
    chart.focus();
    // The readout is labelled: "Day: … | Demand: … | 7-day average: …"
    const readout = (label: string) => screen.getByText(`${label}:`).nextElementSibling;
    await user.keyboard('{Home}');
    expect(readout('Day')).toHaveTextContent('Mon 10 Mar 2025');
    expect(readout('Demand')).toHaveTextContent('100 ml');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(readout('Day')).toHaveTextContent('Wed 12 Mar 2025');
    expect(readout('Demand')).toHaveTextContent('0 ml');

    await user.click(screen.getByText('Show as a table (weekly totals)'));
    const weeks = within(screen.getByRole('table', { name: '' }));
    // Week of Mon 10 Mar: 100 + 200 + 0 + 400 + 500 + 600 + 700
    expect(weeks.getByText('2,500 ml')).toBeInTheDocument();
  });
});
