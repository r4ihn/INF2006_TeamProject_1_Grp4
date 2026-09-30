import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../src/App.tsx'
import { batches, makeToken, milk, milkRec, mockFetch, movement, napkins, run } from './helpers.ts'

const routes = {
  'GET /health': () => ({ body: { status: 'ok' } }),
  'GET /stock': () => ({ body: [milk, napkins] }),
  'GET /movements': () => ({ body: [movement()] }),
  'GET /products/2/batches': () => ({ body: batches }),
  'GET /recommendations': () => ({ body: { run, items: [milkRec] } }),
}

describe('App', () => {
  it('asks for a token first, and rejects one that is not valid', async () => {
    mockFetch(routes)
    render(<App />)
    expect(screen.getByRole('heading', { name: 'CafeStock' })).toBeInTheDocument()
    expect(screen.queryByText('Current stock')).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Access token'), 'not-a-token')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid')
  })

  it('shows the dashboard once signed in, with the summary counts', async () => {
    mockFetch(routes)
    render(<App />)
    await userEvent.type(screen.getByLabelText('Access token'), makeToken('manager'))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Current stock')).toBeInTheDocument()
    const summary = screen.getByRole('list', { name: 'Stock summary' })
    expect(within(summary).getByText('below reorder level').closest('li')).toHaveTextContent('1')
    expect(screen.getByText('test-manager')).toBeInTheDocument()
    expect(await screen.findByText('API online')).toBeInTheDocument()
  })

  it('records a movement for the item chosen in the table, then refreshes', async () => {
    sessionStorage.setItem('cafestock.token', makeToken('staff'))
    const api = mockFetch({
      ...routes,
      'POST /movements': () => ({ status: 201, body: { movements: [movement()], onHand: 60 } }),
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Record movement for Napkin' }))
    expect(screen.getByLabelText('Item')).toHaveValue('2')

    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'SELL')
    await userEvent.type(screen.getByLabelText(/^Quantity/), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Napkin now has 60 units on hand')
    await waitFor(() => expect(api.count('GET', '/stock')).toBe(2))
    expect(api.count('GET', '/movements')).toBe(2)
  })

  it('returns to sign-in when the API rejects the token', async () => {
    sessionStorage.setItem('cafestock.token', makeToken('staff'))
    mockFetch({ ...routes, 'GET /stock': () => ({ status: 401, body: { error: 'UNAUTHENTICATED', message: 'Authentication required' } }) })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('rejected or has expired')
    expect(screen.getByLabelText('Access token')).toBeInTheDocument()
    expect(sessionStorage.getItem('cafestock.token')).toBeNull()
  })

  it('signs out', async () => {
    sessionStorage.setItem('cafestock.token', makeToken('staff'))
    mockFetch(routes)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect(screen.getByLabelText('Access token')).toBeInTheDocument()
    expect(sessionStorage.getItem('cafestock.token')).toBeNull()
  })

  it('explains when the server cannot be reached', async () => {
    sessionStorage.setItem('cafestock.token', makeToken('staff'))
    mockFetch(routes)
    const real = globalThis.fetch
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch
    render(<App />)
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Cannot reach the server')
    expect(await screen.findByText('API unreachable')).toBeInTheDocument()
    globalThis.fetch = real
  })

  it('gives managers a Reorder plan tab and keeps it from staff', async () => {
    sessionStorage.setItem('cafestock.token', makeToken('staff'))
    const api = mockFetch(routes)
    const staff = render(<App />)
    await screen.findByText('Current stock')
    expect(screen.queryByRole('button', { name: 'Reorder plan' })).not.toBeInTheDocument()
    staff.unmount()

    sessionStorage.setItem('cafestock.token', makeToken('manager'))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Reorder plan' }))
    expect(await screen.findByText('5 × 1 L bottle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder plan' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByText('Current stock')).not.toBeInTheDocument()
    expect(api.count('GET', '/recommendations')).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Stock' }))
    expect(await screen.findByText('Current stock')).toBeInTheDocument()
  })
})
