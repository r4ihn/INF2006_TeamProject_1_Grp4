import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StockPage } from './StockPage';
import { renderWithProviders } from '../test/render';
import { installFakeApi } from '../test/fake-api';

const ITEMS = [
  { name: 'Whole milk', category: 'Dairy', unit: 'L', onHand: 20, reorderPoint: 10 },
  { name: 'Espresso beans', category: 'Coffee', unit: 'kg', onHand: 3 },
  { name: 'Old syrup', category: 'Syrups', unit: 'bottle', onHand: 1, isActive: false },
];

const renderPage = (route = '/stock') => renderWithProviders(<StockPage />, { route });
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

describe('StockPage — stock count', () => {
  it('lists active items with expected stock and shows the difference as you type', async () => {
    installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage();

    const milk = await screen.findByLabelText('Whole milk');
    expect(screen.queryByText('Old syrup')).not.toBeInTheDocument(); // archived
    const row = within(milk.closest('tr')!);
    expect(row.getByText('20 L')).toBeInTheDocument();

    await user.type(milk, '14.5');
    expect(row.getByText('−5.5 L')).toBeInTheDocument();
    expect(row.getByText('used / missing')).toBeInTheDocument();

    await user.clear(milk);
    await user.type(milk, '20');
    expect(row.getByText('Matches')).toBeInTheDocument();

    await user.clear(milk);
    await user.type(milk, '21');
    expect(row.getByText('+1 L')).toBeInTheDocument();
    expect(row.getByText('extra')).toBeInTheDocument();
  });

  it('saves only the items that were counted, and reports usage found', async () => {
    const { fetchMock, itemByName } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Whole milk'), '14.5');
    expect(screen.getByText('1 item counted')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Note for this count'), 'Closing count');
    await user.click(screen.getByRole('button', { name: 'Save count' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved count for 1 item | Recorded as used: 5.5 L Whole milk',
    );
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/stock/counts');
    expect(bodyOf(post?.[1])).toEqual({
      counts: [{ itemId: itemByName('Whole milk'), counted: 14.5 }],
      note: 'Closing count',
    });
    // The sheet refreshes with the new expected figure and clears the inputs
    const milk = await screen.findByLabelText('Whole milk');
    expect(milk).toHaveValue(null);
    expect(within(milk.closest('tr')!).getByText('14.5 L')).toBeInTheDocument();
  });

  it('has − / + buttons beside each count, starting from the expected stock', async () => {
    installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage();
    const milk = await screen.findByLabelText('Whole milk');
    await user.click(screen.getByRole('button', { name: 'Increase count of Whole milk' }));
    expect(milk).toHaveValue(20); // the expected stock
    await user.click(screen.getByRole('button', { name: 'Decrease count of Whole milk' }));
    await user.click(screen.getByRole('button', { name: 'Decrease count of Whole milk' }));
    expect(milk).toHaveValue(18);
    expect(within(milk.closest('tr')!).getByText('−2 L')).toBeInTheDocument();
  });

  it('won’t save a negative or over-precise count', async () => {
    const { fetchMock } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Espresso beans'), '-1');
    expect(screen.getByText('Enter 0 or more, up to 3 decimals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save count' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/stock/counts')).toBe(false);
  });

  it('can narrow the sheet to one category', async () => {
    installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Whole milk');

    await user.selectOptions(screen.getByLabelText('Count category'), 'Coffee');
    expect(screen.queryByLabelText('Whole milk')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Espresso beans')).toBeInTheDocument();
  });
});

describe('StockPage — record a movement', () => {
  it('records a delivery', async () => {
    const { fetchMock, itemByName } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');

    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));
    expect(form.getByLabelText('Delivery received')).toBeChecked();
    await user.selectOptions(form.getByLabelText(/^Item/), 'Whole milk | On hand: 20 L');
    expect(form.getByText('On hand now: 20 L')).toBeInTheDocument();
    await user.type(form.getByLabelText(/^Quantity/), '12');
    await user.type(form.getByLabelText('Note'), 'Invoice #4411');
    await user.click(form.getByRole('button', { name: 'Record delivery' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Whole milk | Delivery recorded: 12 L | On hand now: 32 L');
    // The × closes it without leaving the tab
    await user.click(within(notice).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/stock/movements');
    expect(bodyOf(post?.[1])).toEqual({
      itemId: itemByName('Whole milk'),
      type: 'RECEIVE',
      quantity: 12,
      note: 'Invoice #4411',
    });
  });

  it('records usage and waste', async () => {
    installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));

    await user.click(form.getByLabelText('Used'));
    expect(form.getByText(/This is what the forecast learns from/)).toBeInTheDocument();
    await user.selectOptions(form.getByLabelText(/^Item/), 'Espresso beans | On hand: 3 kg');
    await user.type(form.getByLabelText(/^Quantity/), '0.5');
    await user.click(form.getByRole('button', { name: 'Record used' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Espresso beans | Usage recorded: 0.5 kg | On hand now: 2.5 kg',
    );
  });

  it('sends a negative quantity for an adjustment that removes stock', async () => {
    const { fetchMock } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));

    await user.click(form.getByLabelText('Adjusted'));
    expect(form.getByLabelText('Remove stock')).toBeChecked();
    await user.selectOptions(form.getByLabelText(/^Item/), 'Whole milk | On hand: 20 L');
    await user.type(form.getByLabelText(/^Quantity/), '2');
    await user.click(form.getByRole('button', { name: 'Record adjusted' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Adjustment recorded: −2 L');
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/stock/movements');
    expect(bodyOf(post?.[1])).toMatchObject({ type: 'ADJUSTMENT', quantity: -2 });
  });

  it('shows the server’s message when there isn’t enough stock', async () => {
    installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));

    await user.click(form.getByLabelText('Wasted'));
    await user.selectOptions(form.getByLabelText(/^Item/), 'Espresso beans | On hand: 3 kg');
    await user.type(form.getByLabelText(/^Quantity/), '5');
    await user.click(form.getByRole('button', { name: 'Record wasted' }));

    expect(await form.findByText('Only 3 kg on hand')).toBeInTheDocument();
  });

  it('checks the form before sending', async () => {
    const { fetchMock } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));

    await user.click(form.getByRole('button', { name: 'Record delivery' }));
    expect(form.getByText('Choose an item')).toBeInTheDocument();
    expect(form.getByText('Enter a quantity')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/stock/movements')).toBe(false);
  });

  it('pre-selects the item from the link', async () => {
    const { itemByName } = installFakeApi({ items: ITEMS });
    renderPage(`/stock?tab=record&item=${itemByName('Espresso beans')}`);
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));
    expect(form.getByLabelText(/^Item/)).toHaveDisplayValue('Espresso beans | On hand: 3 kg');
  });
});

describe('StockPage — activity', () => {
  it('shows recorded changes newest first, and daily usage for one item', async () => {
    const { itemByName } = installFakeApi({ items: ITEMS });
    const user = userEvent.setup();
    renderPage('/stock?tab=record');

    // Record two things, then look at the activity tab
    const form = within(await screen.findByRole('form', { name: 'Record stock movement' }));
    await user.selectOptions(form.getByLabelText(/^Item/), 'Whole milk | On hand: 20 L');
    await user.type(form.getByLabelText(/^Quantity/), '10');
    await user.click(form.getByRole('button', { name: 'Record delivery' }));
    await screen.findByRole('status');
    await user.click(form.getByLabelText('Used'));
    await user.selectOptions(form.getByLabelText(/^Item/), 'Whole milk | On hand: 30 L');
    await user.type(form.getByLabelText(/^Quantity/), '4');
    await user.click(form.getByRole('button', { name: 'Record used' }));
    await screen.findByText(/Usage recorded: 4 L/);

    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Used')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('−4 L')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('26 L')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Delivery')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('+10 L')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show activity for'), 'Whole milk');
    const usage = await screen.findByRole('region', { name: 'Daily usage of Whole milk' });
    // Labelled numbers: "Total: 4 L | Average a day: …"
    expect(within(usage).getByText('Total:').nextElementSibling).toHaveTextContent('4 L');
    expect(within(usage).getByText('Average a day:')).toBeInTheDocument();
    expect(itemByName('Whole milk')).toBeTruthy();
  });

  it('explains when there is no activity yet', async () => {
    installFakeApi({ items: ITEMS });
    renderPage('/stock?tab=activity');
    expect(await screen.findByText('No stock activity yet')).toBeInTheDocument();
  });
});

describe('StockPage — no items', () => {
  it('points to the Items page', async () => {
    installFakeApi();
    renderPage();
    expect(await screen.findByRole('link', { name: 'Add the items you stock' })).toHaveAttribute(
      'href',
      '/items',
    );
  });
});
