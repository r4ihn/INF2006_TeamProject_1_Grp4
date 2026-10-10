import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ForecastPayload, ForecastRunSummary, ItemForecast, Recommendation } from '../api';
import { jsonResponse, renderWithProviders, signedInAs } from '../test/render';
import { ForecastPage } from './ForecastPage';

const RUN: ForecastRunSummary = {
  id: 'run-1',
  modelTag: 'lgbm-v1',
  modelKind: 'ML',
  isFallback: false,
  baselineTag: 'baseline-ma14',
  forecastFrom: '2026-09-26',
  horizonDays: 7,
  reviewDays: 7,
  evalWeeks: 8,
  serviceLevelZ: 1.65,
  maseModel: 1.0878,
  maseBaseline: 1.1261,
  mapeModel: 0.456,
  mapeBaseline: 0.5034,
  modelUri: 'analytics/models/lgbm-v1/model.txt',
  itemsProcessed: 2,
  startedAt: '2026-09-26T01:00:00.000Z',
  finishedAt: '2026-09-26T01:00:05.000Z',
};

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  status: 'OK',
  onHand: 50,
  leadTimeDays: 2,
  avgDailyDemand: 10,
  demandStdDev: 2,
  leadTimeDemand: 20,
  safetyStock: 4.7,
  reorderPoint: 24.7,
  shortfall: 0,
  reviewDemand: 70,
  orderUpTo: 94.7,
  recommendedQty: 0,
  spoilageCapApplied: false,
  coverDays: 5,
  itemMase: 0.81,
  itemMape: 0.25,
  historyDays: 60,
  notes: [],
  ...over,
});

const day = (offset: number) => {
  const d = new Date('2026-09-26T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const item = (id: string, name: string, unit: string, r: Recommendation): ItemForecast => ({
  item: { id, name, unit, category: 'Dry Store 1' },
  recommendation: r,
  history: Array.from({ length: 28 }, (_, i) => ({ date: day(i - 28), quantity: 10 })),
  forecast: Array.from({ length: 7 }, (_, i) => ({
    date: day(i),
    predicted: 10 + i,
    lower: 5,
    upper: 20 + i,
  })),
});

const CUPS = item(
  'cups',
  'Paper cup',
  'pcs',
  rec({
    status: 'URGENT',
    onHand: 10,
    shortfall: 14.7,
    recommendedQty: 84.7,
    coverDays: 1,
    notes: ['No supplier lead time: assumed 2 days.'],
  }),
);
const MILK = item('milk', 'Fresh milk', 'ml', rec());

const PAYLOAD: ForecastPayload = {
  run: RUN,
  summary: { items: 2, urgent: 1, reorder: 0, ok: 1 },
  items: [CUPS, MILK],
};

function install(payload: ForecastPayload = PAYLOAD) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/forecast/latest') return jsonResponse(payload);
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The value shown after a StatLine label, e.g. stat(scope, 'Urgent') → "1" */
const stat = (scope: ReturnType<typeof within>, label: string) =>
  scope.getByText(`${label}:`).nextElementSibling?.textContent;

afterEach(() => vi.unstubAllGlobals());

describe('ForecastPage', () => {
  it('tells staff it is for managers, without asking the server', () => {
    const fetchMock = install();
    renderWithProviders(<ForecastPage />, { route: '/forecast', auth: signedInAs('STAFF') });
    expect(screen.getByRole('alert')).toHaveTextContent('Only managers can see the forecast.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains how to run the first forecast', async () => {
    install({ run: null, summary: null, items: [] });
    renderWithProviders(<ForecastPage />, { route: '/forecast' });
    expect(await screen.findByText('No forecast has run yet')).toBeInTheDocument();
    expect(screen.getByText('npm run forecast:publish')).toBeInTheDocument();
  });

  it('shows the headline numbers: items to order, the error, and which model ran', async () => {
    install();
    renderWithProviders(<ForecastPage />, { route: '/forecast' });

    const order = within(await screen.findByRole('region', { name: 'Items to order' }));
    expect(order.getByText('1', { selector: '.kpi__value' })).toBeInTheDocument();
    expect(stat(order, 'Urgent')).toBe('1');
    expect(stat(order, 'OK')).toBe('1');

    const error = within(screen.getByRole('region', { name: 'Forecast error (MASE)' }));
    expect(error.getByText('1.09', { selector: '.kpi__value' })).toBeInTheDocument();
    expect(stat(error, 'LightGBM')).toBe('1.09');
    expect(stat(error, '14-day average')).toBe('1.13');
    expect(error.getByText(/Last 8 weeks/)).toBeInTheDocument();

    const model = within(screen.getByRole('region', { name: 'Forecast by' }));
    expect(model.getByText('LightGBM model (lgbm-v1)')).toBeInTheDocument();
    expect(model.getByText('Chosen: lower error than the 14-day average')).toBeInTheDocument();
  });

  it('says when the baseline ran because the model could not', async () => {
    install({
      ...PAYLOAD,
      run: {
        ...RUN,
        modelTag: 'baseline-ma14',
        modelKind: 'BASELINE',
        isFallback: true,
        maseModel: null,
      },
    });
    renderWithProviders(<ForecastPage />, { route: '/forecast' });
    const model = within(await screen.findByRole('region', { name: 'Forecast by' }));
    expect(model.getByText('14-day average (baseline-ma14)')).toBeInTheDocument();
    expect(model.getByText(/couldn’t be used, so the baseline ran/)).toBeInTheDocument();
    expect(model.getByText('Fallback')).toBeInTheDocument();
  });

  it('lists items most urgent first, with status in words and the amount to order', async () => {
    install();
    renderWithProviders(<ForecastPage />, { route: '/forecast' });

    const table = within(await screen.findByRole('table', { name: /Recommendations for 2 items/ }));
    const rows = table.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      'Paper cup',
      'Fresh milk',
    ]);

    const cups = within(rows[0]!);
    expect(cups.getByText('Urgent')).toHaveClass('status', 'status--urgent');
    expect(cups.getByText('10 pcs')).toBeInTheDocument();
    expect(cups.getByText('1 days')).toBeInTheDocument();
    expect(cups.getByText('84.7 pcs')).toBeInTheDocument();
    expect(cups.getByText(/Average 10 pcs a day over the last 4 weeks/)).toBeInTheDocument();

    const milk = within(rows[1]!);
    expect(milk.getByText('OK')).toBeInTheDocument();
    expect(milk.getByText('—')).toBeInTheDocument();
  });

  it('shows how the first item’s number was reached, step by step', async () => {
    install();
    renderWithProviders(<ForecastPage />, { route: '/forecast' });

    const breakdown = within(
      await screen.findByRole('region', { name: 'How this number was reached' }),
    );
    const steps = breakdown.getAllByRole('listitem').map((li) => li.textContent);
    expect(steps[0]).toMatch(/^Recent demand10 pcs a day on average/);
    expect(steps).toContainEqual(
      expect.stringMatching(/^Safety stockZ × σ × √lead time = 1.65 × 2 pcs × √2 = 4.7 pcs/),
    );
    expect(steps).toContainEqual(
      expect.stringMatching(/^Reorder point20 pcs \+ 4.7 pcs = 24.7 pcs/),
    );
    expect(steps).toContainEqual(expect.stringMatching(/^Order up to.* = 94.7 pcs/));
    expect(steps).toContainEqual(
      expect.stringMatching(/^Recommended order94.7 pcs − 10 pcs on hand = 84.7 pcs/),
    );
    expect(breakdown.getByText(/Order 84.7 pcs of Paper cup\./)).toBeInTheDocument();
    expect(
      breakdown.getByText(/MASE 0.81 \(better than “same day last week”\)/),
    ).toBeInTheDocument();
    expect(breakdown.getByText('No supplier lead time: assumed 2 days.')).toBeInTheDocument();
  });

  it('switches the chart and breakdown to the item picked', async () => {
    install();
    const user = userEvent.setup();
    renderWithProviders(<ForecastPage />, { route: '/forecast' });

    await user.click(await screen.findByRole('button', { name: 'Fresh milk' }));
    expect(screen.getByRole('button', { name: 'Fresh milk' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: 'Fresh milk — actual and forecast demand' }),
    ).toBeInTheDocument();
    const breakdown = within(screen.getByRole('region', { name: 'How this number was reached' }));
    expect(breakdown.getByText(/Nothing to order/)).toBeInTheDocument();
    expect(breakdown.queryByText('Recommended order')).not.toBeInTheDocument();
  });

  it('reads a day off the chart with the arrow keys', async () => {
    install();
    renderWithProviders(<ForecastPage />, { route: '/forecast?item=cups' });

    const chart = await screen.findByRole('img', {
      name: /Paper cup: actual demand over the 28 days/,
    });
    const readout = within(
      chart.closest('figure')!.querySelector('.chart__readout') as HTMLElement,
    );
    // starts on the first forecast day
    expect(stat(readout, 'Forecast')).toBe('10 pcs');
    expect(stat(readout, 'Likely range')).toBe('5 pcs – 20 pcs');

    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(stat(readout, 'Forecast')).toBe('11 pcs');
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(stat(readout, 'Actual')).toBe('10 pcs');
    expect(readout.queryByText('Likely range:')).not.toBeInTheDocument();
  });

  it('warns when the forecast starts well before the day it ran', async () => {
    install({ ...PAYLOAD, run: { ...RUN, forecastFrom: '2025-03-24' } });
    renderWithProviders(<ForecastPage />, { route: '/forecast' });
    expect(
      await screen.findByText(/the imported dataset keeps its real dates/),
    ).toBeInTheDocument();
  });
});
