import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemStatus } from './SystemStatus';
import { jsonResponse } from './test/render';

const healthy = {
  status: 'ok',
  service: 'cafestock-api',
  uptimeSeconds: 42,
  timestamp: '2026-09-24T12:00:00.000Z',
};
const ready = { status: 'ok', database: 'up', latencyMs: 3 };
const notReady = { status: 'error', database: 'down' };

/** A fake fetch that answers each URL with a canned response (or throws). */
function fakeApi(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`Unexpected fetch: ${url}`);
    return handler();
  });
}

describe('SystemStatus', () => {
  it('shows both checks as in progress at first', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<SystemStatus />);

    expect(screen.getByText('Checking API…')).toBeInTheDocument();
    expect(screen.getByText('Checking database…')).toBeInTheDocument();
  });

  it('calls /health and /health/ready and shows both healthy', async () => {
    const fetchMock = fakeApi({
      '/health': () => jsonResponse(healthy),
      '/health/ready': () => jsonResponse(ready),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SystemStatus startupRetries={0} />);

    expect(await screen.findByText('API healthy')).toBeInTheDocument();
    expect(screen.getByText(/cafestock-api · up 42s/)).toBeInTheDocument();
    expect(await screen.findByText('Database connected')).toBeInTheDocument();
    expect(screen.getByText(/responded in 3 ms/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/health', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('/health/ready', expect.anything());
  });

  it('shows the database as unreachable when the API answers 503', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/health': () => jsonResponse(healthy),
        '/health/ready': () => jsonResponse(notReady, 503),
      }),
    );

    render(<SystemStatus startupRetries={0} />);

    expect(await screen.findByText('API healthy')).toBeInTheDocument();
    expect(await screen.findByText('Database unreachable')).toBeInTheDocument();
    expect(screen.getByText(/Is Docker Desktop running/)).toBeInTheDocument();
  });

  it('says to run db:setup when the database has no tables yet', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/health': () => jsonResponse(healthy),
        '/health/ready': () =>
          jsonResponse({ status: 'error', database: 'up', tables: 'missing' }, 503),
      }),
    );

    render(<SystemStatus startupRetries={0} />);

    expect(await screen.findByText('Database unreachable')).toBeInTheDocument();
    expect(screen.getByText(/tables are missing. Run: npm run db:setup/)).toBeInTheDocument();
  });

  it('shows "API unreachable" when the API returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/health': () => jsonResponse({ error: 'boom' }, 500),
        '/health/ready': () => jsonResponse({ error: 'boom' }, 500),
      }),
    );

    render(<SystemStatus startupRetries={0} />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    expect(screen.getByText('Database status unknown')).toBeInTheDocument();
  });

  it('waits for the API while it is still starting, instead of showing an error', async () => {
    let calls = 0;
    const starting = () => {
      calls += 1;
      return calls <= 2 ? jsonResponse(null, 502) : jsonResponse(healthy); // like Vite's proxy
    };
    vi.stubGlobal(
      'fetch',
      fakeApi({ '/health': starting, '/health/ready': () => jsonResponse(ready) }),
    );

    render(<SystemStatus startupRetries={5} retryDelayMs={5} />);

    expect(await screen.findByText('Waiting for the API to start…')).toBeInTheDocument();
    expect(await screen.findByText('API healthy')).toBeInTheDocument();
    expect(screen.queryByText('API unreachable')).not.toBeInTheDocument();
  });

  it('gives up and shows the error once the startup retries run out', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/health': () => jsonResponse(null, 502),
        '/health/ready': () => jsonResponse(null, 502),
      }),
    );

    render(<SystemStatus startupRetries={2} retryDelayMs={5} />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    expect(screen.getByText(/not responding/)).toBeInTheDocument();
  });

  it('recovers on Re-check after a network failure', async () => {
    let apiUp = false;
    const maybe = (body: unknown) => () => {
      if (!apiUp) throw new TypeError('Failed to fetch');
      return jsonResponse(body);
    };
    vi.stubGlobal('fetch', fakeApi({ '/health': maybe(healthy), '/health/ready': maybe(ready) }));

    render(<SystemStatus startupRetries={0} />);
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();

    apiUp = true;
    await userEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    expect(await screen.findByText('API healthy')).toBeInTheDocument();
    expect(await screen.findByText('Database connected')).toBeInTheDocument();
  });
});
