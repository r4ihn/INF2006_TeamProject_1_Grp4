import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { renderWithProviders, signedInAs } from './test/render';
import { installFakeApi } from './test/fake-api';

describe('App', () => {
  it('opens on the Stock page', async () => {
    installFakeApi({ items: [{ name: 'Whole milk', category: 'Dairy', unit: 'L' }] });
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByRole('heading', { name: 'Stock', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock' })).toHaveClass('nav__link--active');
    expect(await screen.findByLabelText('Whole milk')).toBeInTheDocument();
  });

  it('links an item’s stock level to its stock history', async () => {
    installFakeApi({ items: [{ name: 'Whole milk', category: 'Dairy', unit: 'L', onHand: 8 }] });
    renderWithProviders(<App />, { route: '/items' });

    await userEvent.click(await screen.findByRole('link', { name: /8 L of Whole milk on hand/ }));
    expect(await screen.findByRole('tab', { name: 'Activity' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByRole('region', { name: 'Daily usage of Whole milk' }),
    ).toBeInTheDocument();
  });

  it('links a supplier’s item count to that supplier’s items', async () => {
    installFakeApi({
      suppliers: [{ name: 'Dairy Direct' }, { name: 'Bean Bros' }],
      items: [
        { name: 'Whole milk', category: 'Dairy', unit: 'L', supplierName: 'Dairy Direct' },
        { name: 'Espresso beans', category: 'Coffee', unit: 'kg', supplierName: 'Bean Bros' },
      ],
    });
    renderWithProviders(<App />, { route: '/suppliers' });

    await userEvent.click(await screen.findByRole('link', { name: '1 items from Dairy Direct' }));
    expect(await screen.findByRole('heading', { name: 'Items', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Whole milk')).toBeInTheDocument();
    expect(screen.queryByText('Espresso beans')).not.toBeInTheDocument();
  });

  it('keeps System status out of the main menu, as a link at the bottom of the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderWithProviders(<App />, { route: '/stock' });

    const menu = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(menu.queryByRole('link', { name: 'System status' })).not.toBeInTheDocument();
    const footer = within(screen.getByRole('contentinfo'));
    await userEvent.click(footer.getByRole('link', { name: 'System status' }));
    expect(screen.getByRole('heading', { name: 'System status' })).toBeInTheDocument();
    expect(screen.getByText('Checking API…')).toBeInTheDocument();
  });

  it('shows the signed-in user, their café and role, and signs out', async () => {
    installFakeApi();
    const auth = signedInAs('MANAGER');
    renderWithProviders(<App />, { route: '/items', auth });

    expect(screen.getByText('Mia (manager)')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText(/Demo Café/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('shows the Forecast tab to managers only', () => {
    installFakeApi();
    const { unmount } = renderWithProviders(<App />, { route: '/items' });
    expect(screen.getByRole('link', { name: 'Forecast' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<App />, { route: '/items', auth: signedInAs('STAFF') });
    expect(screen.queryByRole('link', { name: 'Forecast' })).not.toBeInTheDocument();
  });

  it('tells staff who open the forecast address that it is for managers', () => {
    renderWithProviders(<App />, { route: '/forecast', auth: signedInAs('STAFF') });
    expect(screen.getByText('Only managers can see the forecast.')).toBeInTheDocument();
  });

  it('shows the manager an empty forecast until one has run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ run: null }), { status: 200 })),
    );
    renderWithProviders(<App />, { route: '/forecast' });
    expect(await screen.findByText('No forecast has run yet')).toBeInTheDocument();
  });

  it('shows the login page when signed out', () => {
    renderWithProviders(<App />, {
      route: '/stock',
      auth: signedInAs('STAFF', { status: 'signed-out', me: null }),
    });
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue as staff/ })).toBeInTheDocument();
  });

  it('shows a friendly page for unknown addresses', () => {
    renderWithProviders(<App />, { route: '/nope' });

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to items' })).toBeInTheDocument();
  });
});
