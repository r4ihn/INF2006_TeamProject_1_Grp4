import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import StockTable from '../src/components/StockTable.tsx'
import { milk, napkins } from './helpers.ts'

describe('StockTable', () => {
  it('flags items below their reorder level and stock past its expiry', () => {
    render(<StockTable items={[milk, napkins]} onRecord={() => {}} />)
    const napkinRow = screen.getByRole('row', { name: /Napkin/ })
    expect(within(napkinRow).getByText('Reorder now')).toBeInTheDocument()
    expect(within(napkinRow).getByText('65 units')).toBeInTheDocument()
    expect(within(napkinRow).getByText('125 units')).toBeInTheDocument()

    const milkRow = screen.getByRole('row', { name: /Fresh milk/ })
    expect(within(milkRow).getByText('OK')).toBeInTheDocument()
    expect(within(milkRow).getByText('5,700 ml expired')).toBeInTheDocument()
  })

  it('can show low stock only', async () => {
    render(<StockTable items={[milk, napkins]} onRecord={() => {}} />)
    await userEvent.click(screen.getByLabelText('Low stock only'))
    expect(screen.queryByText('Fresh milk')).not.toBeInTheDocument()
    expect(screen.getByText('Napkin')).toBeInTheDocument()
  })

  it('says so when nothing is low', async () => {
    render(<StockTable items={[milk]} onRecord={() => {}} />)
    await userEvent.click(screen.getByLabelText('Low stock only'))
    expect(screen.getByText('Nothing is below its reorder level.')).toBeInTheDocument()
  })

  it('reports which item the Record button belongs to', async () => {
    const onRecord = vi.fn()
    render(<StockTable items={[milk, napkins]} onRecord={onRecord} />)
    await userEvent.click(screen.getByRole('button', { name: 'Record movement for Napkin' }))
    expect(onRecord).toHaveBeenCalledWith(2)
  })
})
