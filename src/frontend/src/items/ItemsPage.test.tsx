import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemsPage } from './ItemsPage';
import { validateItem, type ItemFormValues } from './validation';
import { renderWithProviders } from '../test/render';
import { installFakeApi } from '../test/fake-api';

const SUPPLIERS = [
  { name: 'Bean Bros', leadTimeDays: 3 },
  { name: 'Dairy Direct', leadTimeDays: 1 },
];
const ITEMS = [
  {
    name: 'Espresso beans',
    sku: 'COF-001',
    category: 'Coffee',
    unit: 'kg',
    unitCost: 32.5,
    onHand: 2.5,
    reorderPoint: 4,
    spoilageCap: 12,
    supplierName: 'Bean Bros',
  },
  {
    name: 'Whole milk',
    category: 'Dairy',
    unit: 'L',
    unitCost: 2.35,
    onHand: 18,
    reorderPoint: 10,
    supplierName: 'Dairy Direct',
  },
  { name: 'Paper cups 8oz', category: 'Packaging', unit: 'pcs', unitCost: 0.08, onHand: 500 },
];

const renderPage = (route = '/items') => renderWithProviders(<ItemsPage />, { route });

function rowFor(name: string) {
  const row = screen.getByText(name, { selector: '.cell-strong' }).closest('tr');
  if (!row) throw new Error(`No row for ${name}`);
  return within(row);
}

async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '+ Add item' }));
  return within(screen.getByRole('form', { name: 'Add item' }));
}

describe('ItemsPage', () => {
  it('lists items with supplier, stock, reorder point, cost and a low-stock flag', async () => {
    installFakeApi({ suppliers: SUPPLIERS, items: ITEMS });
    renderPage();

    await screen.findByText('Espresso beans');
    expect(screen.getByText(/^3 items/)).toBeInTheDocument();
    expect(screen.getByText('1 low')).toBeInTheDocument();

    const beans = rowFor('Espresso beans');
    expect(beans.getByText('COF-001')).toBeInTheDocument();
    expect(beans.getByText('Bean Bros')).toBeInTheDocument();
    expect(beans.getByText('3 days lead time')).toBeInTheDocument();
    expect(beans.getByText('2.5 kg')).toBeInTheDocument();
    expect(beans.getByText('Low')).toBeInTheDocument();
    expect(beans.getByText('4 kg')).toBeInTheDocument();
    expect(beans.getByText('max 12 kg')).toBeInTheDocument();
    expect(beans.getByText('S$32.50')).toBeInTheDocument();

    expect(rowFor('Whole milk').queryByText('Low')).not.toBeInTheDocument();
    expect(rowFor('Paper cups 8oz').getByText('—')).toBeInTheDocument(); // no supplier
  });

  it('shows an empty state when there are no items', async () => {
    installFakeApi();
    renderPage();
    expect(await screen.findByText('No items yet')).toBeInTheDocument();
  });

  it('adds an item linked to a supplier', async () => {
    const { fetchMock, supplierByName } = installFakeApi({ suppliers: SUPPLIERS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No items yet');

    const form = await openAddForm(user);
    await user.type(form.getByLabelText(/^Name/), 'Oat milk');
    await user.type(form.getByLabelText(/^Category/), 'Dairy');
    await user.type(form.getByLabelText(/^Unit(?! cost)/), 'L');
    await user.selectOptions(form.getByLabelText('Supplier'), 'Dairy Direct (1 day lead time)');
    await user.clear(form.getByLabelText(/^Unit cost/));
    await user.type(form.getByLabelText(/^Unit cost/), '3.9');
    await user.clear(form.getByLabelText(/^Reorder point/));
    await user.type(form.getByLabelText(/^Reorder point/), '6');
    await user.click(form.getByRole('button', { name: 'Add item' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Added Oat milk');
    const row = rowFor('Oat milk');
    expect(row.getByText('Dairy Direct')).toBeInTheDocument();
    expect(row.getByText('S$3.90')).toBeInTheDocument();
    expect(row.getByText('Low')).toBeInTheDocument(); // 0 on hand ≤ 6

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: 'Oat milk',
      sku: '',
      category: 'Dairy',
      unit: 'L',
      supplierId: supplierByName('Dairy Direct'),
      unitCost: 3.9,
      reorderPoint: 6,
      spoilageCap: null,
    });
  });

  it('validates the form before sending anything', async () => {
    const { fetchMock } = installFakeApi({ suppliers: SUPPLIERS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No items yet');

    const form = await openAddForm(user);
    await user.clear(form.getByLabelText(/^Unit cost/));
    await user.type(form.getByLabelText(/^Unit cost/), '1.00005');
    await user.type(form.getByLabelText(/^Spoilage cap/), '-1');
    await user.click(form.getByRole('button', { name: 'Add item' }));

    expect(form.getByText('Name is required')).toBeInTheDocument();
    expect(form.getByText('Category is required')).toBeInTheDocument();
    expect(form.getByText('Unit is required')).toBeInTheDocument();
    expect(form.getByText('Unit cost can have at most 4 decimal places')).toBeInTheDocument();
    expect(form.getByText('Spoilage cap cannot be negative')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows the server’s message for a duplicate name', async () => {
    installFakeApi({ suppliers: SUPPLIERS, items: ITEMS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Espresso beans');

    const form = await openAddForm(user);
    await user.type(form.getByLabelText(/^Name/), 'Whole milk');
    await user.type(form.getByLabelText(/^Category/), 'Dairy');
    await user.type(form.getByLabelText(/^Unit(?! cost)/), 'L');
    await user.click(form.getByRole('button', { name: 'Add item' }));

    expect(await form.findByText('An item with this name already exists')).toBeInTheDocument();
  });

  it('points to the Suppliers page when there are no suppliers yet', async () => {
    installFakeApi();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No items yet');

    const form = await openAddForm(user);
    expect(form.getByRole('link', { name: 'add one on the Suppliers page' })).toHaveAttribute(
      'href',
      '/suppliers',
    );
  });

  it('edits an item', async () => {
    installFakeApi({ suppliers: SUPPLIERS, items: ITEMS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Espresso beans');

    await user.click(screen.getByRole('button', { name: 'Edit Espresso beans' }));
    const form = within(screen.getByRole('form', { name: 'Edit Espresso beans' }));
    expect(form.getByLabelText(/^Unit cost/)).toHaveValue(32.5);
    expect(form.getByLabelText('Supplier')).toHaveDisplayValue('Bean Bros (3 days lead time)');

    await user.clear(form.getByLabelText(/^Reorder point/));
    await user.type(form.getByLabelText(/^Reorder point/), '2');
    await user.click(form.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved Espresso beans');
    expect(rowFor('Espresso beans').queryByText('Low')).not.toBeInTheDocument(); // 2.5 > 2
  });

  it('archives an item, can undo, and shows archived items on request', async () => {
    installFakeApi({ suppliers: SUPPLIERS, items: ITEMS });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Paper cups 8oz');

    await user.click(screen.getByRole('button', { name: 'Archive Paper cups 8oz' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Archived Paper cups 8oz');
    expect(screen.queryByText('Paper cups 8oz')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Paper cups 8oz')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Paper cups 8oz' }));
    await screen.findByText(/Archived Paper cups 8oz/);
    await user.click(screen.getByLabelText('Show archived'));
    expect(rowFor('Paper cups 8oz').getByText('Archived')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore Paper cups 8oz' }));
    expect(await screen.findByText('Restored Paper cups 8oz')).toBeInTheDocument();
  });

  it('deletes an archived item after confirming, unless it has history', async () => {
    installFakeApi({
      items: [
        { name: 'Old syrup', category: 'Syrups', unit: 'bottle', isActive: false },
        { name: 'Used beans', category: 'Coffee', unit: 'kg', isActive: false, hasHistory: true },
      ],
    });
    const user = userEvent.setup();
    renderPage('/items?archived=1');
    await screen.findByText('Old syrup');

    await user.click(screen.getByRole('button', { name: 'Delete Old syrup' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted Old syrup')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Used beans' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Archive it instead');
  });

  it('filters by search, category and supplier, and can clear filters', async () => {
    const { supplierByName } = installFakeApi({ suppliers: SUPPLIERS, items: ITEMS });
    const user = userEvent.setup();
    renderPage(`/items?supplier=${supplierByName('Bean Bros')}`);

    await screen.findByText('Espresso beans');
    expect(screen.queryByText('Whole milk')).not.toBeInTheDocument();
    expect(screen.getByText(/^1 of 3 items/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Whole milk')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by category'), 'Packaging');
    expect(screen.getByText('Paper cups 8oz')).toBeInTheDocument();
    expect(screen.queryByText('Espresso beans')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by category'), '');
    await user.type(screen.getByLabelText('Search items'), 'cof-0');
    expect(screen.getByText('Espresso beans')).toBeInTheDocument(); // matched by SKU
    expect(screen.queryByText('Paper cups 8oz')).not.toBeInTheDocument();
  });
});

describe('validateItem', () => {
  const ok: ItemFormValues = {
    name: 'Milk',
    sku: '',
    category: 'Dairy',
    unit: 'L',
    supplierId: '',
    unitCost: '2.35',
    reorderPoint: '2.5',
    spoilageCap: '',
  };

  it('accepts a valid item', () => {
    expect(validateItem(ok)).toEqual({});
  });

  it.each([
    [{ unitCost: '' }, 'unitCost', 'Unit cost is required'],
    [{ unitCost: 'abc' }, 'unitCost', 'Unit cost must be a number'],
    [{ reorderPoint: '1.2345' }, 'reorderPoint', 'Reorder point can have at most 3 decimal places'],
    [{ spoilageCap: '-1' }, 'spoilageCap', 'Spoilage cap cannot be negative'],
    [{ unit: 'x'.repeat(21) }, 'unit', 'Must be at most 20 characters'],
  ])('rejects %j', (patch, field, message) => {
    expect(validateItem({ ...ok, ...patch })).toMatchObject({ [field]: message });
  });
});
