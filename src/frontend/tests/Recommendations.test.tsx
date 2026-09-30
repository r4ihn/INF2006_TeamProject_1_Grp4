import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Recommendations from '../src/components/Recommendations.tsx'
import { beansRec, makeToken, milkRec, mockFetch, run } from './helpers.ts'

const signIn = () => sessionStorage.setItem('cafestock.token', makeToken('manager'))

describe('Recommendations', () => {
  it('lists items that need ordering first, in whole packs', async () => {
    signIn()
    mockFetch({ 'GET /recommendations': () => ({ body: { run, items: [beansRec, milkRec] } }) })
    render(<Recommendations refreshKey={0} />)

    await screen.findByText('Reorder plan')
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('Fresh milk')).toBeInTheDocument() // needs an order, so it comes first
    expect(within(rows[0]!).getByText('5 × 1 L bottle')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('5,000 ml')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Espresso beans')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('No order needed')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 items to order')).toBeInTheDocument()
  })

  it('explains the caveats on each row', async () => {
    signIn()
    mockFetch({ 'GET /recommendations': () => ({ body: { run, items: [milkRec, beansRec] } }) })
    render(<Recommendations refreshKey={0} />)
    const milk = (await screen.findByText('Fresh milk')).closest('tr')!
    expect(within(milk).getByText('Limited by shelf life')).toBeInTheDocument()
    expect(within(milk).getByText('Weak forecast')).toBeInTheDocument()
    expect(within(milk).getByText(/Includes 5,700 ml expired/)).toBeInTheDocument()
    const beans = screen.getByText('Espresso beans').closest('tr')!
    expect(within(beans).queryByText('Weak forecast')).not.toBeInTheDocument()
    expect(within(beans).getByText('1.4 wk')).toBeInTheDocument()
  })

  it('says when the forecast is from, and reports its reliability honestly', async () => {
    signIn()
    mockFetch({ 'GET /recommendations': () => ({ body: { run, items: [milkRec, beansRec] } }) })
    render(<Recommendations refreshKey={0} />)
    expect(await screen.findByRole('note')).toHaveTextContent('Based on sales up to 23 Mar 2025')
    const reliable = screen.getByRole('region', { name: 'How reliable is this?' })
    expect(reliable).toHaveTextContent('0.963 against 1.000')
    expect(reliable).toHaveTextContent('3.7% less error')
    expect(reliable).toHaveTextContent('172 stock-out days instead of 264')
    expect(reliable).toHaveTextContent('91.7% → 95.4%')
    expect(reliable).toHaveTextContent('Weaker than repeating last week: Fresh milk')
    expect(reliable).toHaveTextContent('simulated')
  })

  it('handles an empty state and a refused request', async () => {
    signIn()
    mockFetch({ 'GET /recommendations': () => ({ body: { run: null, items: [] } }) })
    const { unmount } = render(<Recommendations refreshKey={0} />)
    expect(await screen.findByText('No forecast has been loaded yet.')).toBeInTheDocument()
    unmount()

    mockFetch({
      'GET /recommendations': () => ({ status: 403, body: { error: 'FORBIDDEN', message: 'This needs the manager role' } }),
    })
    render(<Recommendations refreshKey={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This needs the manager role')
  })
})
