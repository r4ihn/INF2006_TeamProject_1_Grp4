import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuppliersPage } from './SuppliersPage';
import { cleanPhone, validateSupplier } from './validation';
import { renderWithProviders, jsonResponse } from '../test/render';
import { installFakeSuppliersApi } from '../test/fake-suppliers-api';

const renderPage = () => renderWithProviders(<SuppliersPage />);

function rowFor(name: string) {
  const cell = screen.getByText(name, { selector: '.cell-strong' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`No row for ${name}`);
  return within(row);
}

describe('SuppliersPage', () => {
  it('lists suppliers from the API', async () => {
    installFakeSuppliersApi([
      {
        name: 'Bean Bros',
        contactName: 'Alex Tan',
        email: 'orders@beanbros.sg',
        leadTimeDays: 3,
        itemCount: 4,
      },
      { name: 'Dairy Direct', leadTimeDays: 1 },
    ]);
    renderPage();

    expect(await screen.findByText('Bean Bros')).toBeInTheDocument();
    expect(screen.getByText('2 suppliers')).toBeInTheDocument();
    const bean = rowFor('Bean Bros');
    expect(bean.getByText('Alex Tan')).toBeInTheDocument();
    expect(bean.getByRole('link', { name: 'orders@beanbros.sg' })).toHaveAttribute(
      'href',
      'mailto:orders@beanbros.sg',
    );
    expect(bean.getByText('3 days')).toBeInTheDocument();
    expect(bean.getByText('4')).toBeInTheDocument();
    expect(rowFor('Dairy Direct').getByText('1 day')).toBeInTheDocument();
  });

  it('shows an empty state when there are no suppliers', async () => {
    installFakeSuppliersApi([]);
    renderPage();

    expect(await screen.findByText('No suppliers yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first supplier' })).toBeInTheDocument();
  });

  it('shows an error with a retry button when the list fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { code: 'INTERNAL', message: 'Boom' } }, 500)),
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load suppliers: Boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('adds a supplier', async () => {
    const { fetchMock } = installFakeSuppliersApi([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No suppliers yet');

    await user.click(screen.getByRole('button', { name: '+ Add supplier' }));
    await user.type(screen.getByLabelText(/^Name/), 'FreshCo Produce');
    await user.type(screen.getByLabelText('Contact person'), 'Mei Lin');
    await user.clear(screen.getByLabelText(/^Lead time/));
    await user.type(screen.getByLabelText(/^Lead time/), '1');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Added FreshCo Produce');
    expect(rowFor('FreshCo Produce').getByText('1 day')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      name: 'FreshCo Produce',
      contactName: 'Mei Lin',
      leadTimeDays: 1,
    });
  });

  it('validates the form before sending anything', async () => {
    const { fetchMock } = installFakeSuppliersApi([]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No suppliers yet');

    await user.click(screen.getByRole('button', { name: '+ Add supplier' }));
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.clear(screen.getByLabelText(/^Lead time/));
    await user.type(screen.getByLabelText(/^Lead time/), '-2');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Lead time cannot be negative')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('shows the server’s message next to the field for a duplicate name', async () => {
    installFakeSuppliersApi([{ name: 'Bean Bros' }]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bean Bros');

    await user.click(screen.getByRole('button', { name: '+ Add supplier' }));
    await user.type(screen.getByLabelText(/^Name/), 'Bean Bros');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));

    expect(await screen.findByText('A supplier with this name already exists')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add supplier' })).toBeInTheDocument(); // still open
  });

  it('won’t let letters into the phone number', async () => {
    installFakeSuppliersApi([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: '+ Add supplier' }));
    const form = within(screen.getByRole('form', { name: 'Add supplier' }));
    await user.type(form.getByLabelText('Phone'), '+65 abc 6123 4567');
    expect(form.getByLabelText('Phone')).toHaveValue('+65  6123 4567');
    expect(form.getByLabelText('Phone')).toHaveAccessibleDescription(
      'Digits only (spaces and a leading + are fine)',
    );
  });

  it('edits a supplier', async () => {
    installFakeSuppliersApi([{ name: 'Bean Bros', leadTimeDays: 3, phone: '6123 4567' }]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bean Bros');

    await user.click(screen.getByRole('button', { name: 'Edit Bean Bros' }));
    const form = within(screen.getByRole('form', { name: 'Edit Bean Bros' }));
    expect(form.getByLabelText(/^Name/)).toHaveValue('Bean Bros');
    expect(form.getByLabelText('Phone')).toHaveValue('6123 4567');

    await user.clear(form.getByLabelText(/^Lead time/));
    await user.type(form.getByLabelText(/^Lead time/), '5');
    await user.click(form.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved Bean Bros');
    expect(rowFor('Bean Bros').getByText('5 days')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and can be cancelled', async () => {
    const { db } = installFakeSuppliersApi([{ name: 'Bean Bros' }]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bean Bros');

    await user.click(screen.getByRole('button', { name: 'Delete Bean Bros' }));
    const confirm = within(screen.getByRole('group', { name: 'Confirm deleting Bean Bros' }));
    expect(confirm.getByText('Delete Bean Bros?')).toBeInTheDocument();
    await user.click(confirm.getByRole('button', { name: 'Cancel' }));
    expect(db.size).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Delete Bean Bros' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Deleted Bean Bros');
    expect(await screen.findByText('No suppliers yet')).toBeInTheDocument();
    expect(db.size).toBe(0);
  });

  it('explains why a supplier with items cannot be deleted', async () => {
    installFakeSuppliersApi([{ name: 'Dairy Direct', itemCount: 2 }]);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Dairy Direct');

    await user.click(screen.getByRole('button', { name: 'Delete Dairy Direct' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t delete Dairy Direct: This supplier still has 2 items. Move them to another supplier first.',
    );
    expect(screen.getByText('Dairy Direct')).toBeInTheDocument();
  });
});

describe('validateSupplier', () => {
  const ok = { name: 'X', contactName: '', email: '', phone: '', leadTimeDays: 2, notes: '' };

  it('accepts a minimal supplier', () => {
    expect(validateSupplier(ok)).toEqual({});
  });

  it.each([
    [{ name: '  ' }, 'name', 'Name is required'],
    [{ leadTimeDays: 1.5 }, 'leadTimeDays', 'Lead time must be a whole number of days'],
    [{ leadTimeDays: Number.NaN }, 'leadTimeDays', 'Lead time must be a whole number of days'],
    [{ leadTimeDays: 400 }, 'leadTimeDays', 'Lead time must be 365 days or less'],
    [{ email: 'a@b' }, 'email', 'Enter a valid email address'],
    [{ phone: 'call me' }, 'phone', 'Use digits only (spaces and a leading + are fine)'],
    [{ phone: '6123-4567' }, 'phone', 'Use digits only (spaces and a leading + are fine)'],
    [{ phone: '12345' }, 'phone', 'Enter 8 to 15 digits, e.g. +65 6123 4567'],
  ])('rejects %j', (patch, field, message) => {
    expect(validateSupplier({ ...ok, ...patch })).toMatchObject({ [field]: message });
  });

  it.each(['61234567', '6123 4567', '+65 6123 4567'])('accepts the phone number %j', (phone) => {
    expect(validateSupplier({ ...ok, phone })).toEqual({});
  });
});

describe('cleanPhone', () => {
  it('drops letters and symbols as you type, keeping digits, spaces and a leading +', () => {
    expect(cleanPhone('+65 abc 6123-4567x')).toBe('+65  61234567');
    expect(cleanPhone('6123+4567')).toBe('61234567');
    expect(cleanPhone('tel: 9876 5432')).toBe(' 9876 5432');
  });
});
