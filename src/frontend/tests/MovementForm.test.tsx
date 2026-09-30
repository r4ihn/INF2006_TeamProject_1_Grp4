import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Role } from '../src/auth.ts'
import MovementForm from '../src/components/MovementForm.tsx'
import { batches, makeToken, milk, mockFetch, movement, napkins } from './helpers.ts'

function Harness({ role, onRecorded = () => {} }: { role: Role; onRecorded?: () => void }) {
  const [productId, setProductId] = useState<number | null>(napkins.productId)
  return (
    <MovementForm items={[milk, napkins]} role={role} productId={productId} onProductChange={setProductId} onRecorded={onRecorded} />
  )
}

const signIn = (role: Role) => sessionStorage.setItem('cafestock.token', makeToken(role))

describe('MovementForm', () => {
  it('lets staff receive and sell but not write off or adjust', () => {
    signIn('staff')
    mockFetch({})
    render(<Harness role="staff" />)
    expect(screen.getByRole('option', { name: 'Receive delivery' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Record usage / sale' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Write off spoilage (manager only)' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Stocktake adjustment (manager only)' })).toBeDisabled()
  })

  it('lets managers use every movement type', () => {
    signIn('manager')
    mockFetch({})
    render(<Harness role="manager" />)
    expect(screen.getByRole('option', { name: 'Write off spoilage' })).toBeEnabled()
    expect(screen.getByRole('option', { name: 'Stocktake adjustment' })).toBeEnabled()
  })

  it('sends a receive and reports the new stock level', async () => {
    signIn('staff')
    const api = mockFetch({
      'POST /movements': () => ({
        status: 201,
        body: { movements: [movement({ movementType: 'RECEIVE', quantity: 250 })], onHand: 315 },
      }),
    })
    const onRecorded = vi.fn()
    render(<Harness role="staff" onRecorded={onRecorded} />)

    await userEvent.type(screen.getByLabelText(/^Quantity/), '250')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Napkin now has 315 units on hand')
    expect(api.calls.find((c) => c.method === 'POST')).toMatchObject({
      body: { productId: 2, movementType: 'RECEIVE', quantity: 250 },
      auth: expect.stringMatching(/^Bearer /),
    })
    expect(onRecorded).toHaveBeenCalled()
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue(null) // cleared for the next entry
  })

  it('makes managers pick a batch and give a reason for a write-off', async () => {
    signIn('manager')
    const api = mockFetch({
      'GET /products/2/batches': () => ({ body: batches }),
      'POST /movements': () => ({
        status: 201,
        body: { movements: [movement({ movementType: 'SPOILAGE', quantity: -5, reason: 'Damp' })], onHand: 60 },
      }),
    })
    render(<Harness role="manager" />)
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'SPOILAGE')
    await screen.findByRole('option', { name: /B000242 · 65 units left/ })

    await userEvent.type(screen.getByLabelText(/^Quantity/), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the batch.')

    await userEvent.selectOptions(screen.getByLabelText('Batch'), 'B000242')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason.')
    expect(api.count('POST', '/movements')).toBe(0)

    await userEvent.type(screen.getByLabelText('Reason'), 'Damp')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))
    await screen.findByRole('status')
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      productId: 2,
      movementType: 'SPOILAGE',
      quantity: 5,
      batchId: 'B000242',
      reason: 'Damp',
    })
  })

  it('checks quantities before calling the API', async () => {
    signIn('staff')
    const api = mockFetch({})
    render(<Harness role="staff" />)
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'SELL')
    const submit = screen.getByRole('button', { name: 'Record movement' })

    await userEvent.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a quantity.')
    await userEvent.type(screen.getByLabelText(/^Quantity/), '0')
    await userEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('greater than zero')
    await userEvent.clear(screen.getByLabelText(/^Quantity/))
    await userEvent.type(screen.getByLabelText(/^Quantity/), '2.5')
    await userEvent.click(submit)
    expect(screen.getByRole('alert')).toHaveTextContent('counted in whole units')
    expect(api.count('POST', '/movements')).toBe(0)
  })

  it('shows the API message when a sale is refused', async () => {
    signIn('staff')
    mockFetch({
      'GET /products/2/batches': () => ({ body: batches }),
      'POST /movements': () => ({
        status: 409,
        body: { error: 'INSUFFICIENT_STOCK', message: 'Only 65 in stock, requested 500' },
      }),
    })
    render(<Harness role="staff" />)
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'SELL')
    await userEvent.type(screen.getByLabelText(/^Quantity/), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 65 in stock, requested 500')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record movement' })).toBeEnabled())
  })

  it('says how many batches a sale was taken from', async () => {
    signIn('staff')
    mockFetch({
      'GET /products/2/batches': () => ({ body: batches }),
      'POST /movements': () => ({
        status: 201,
        body: { movements: [movement({ quantity: -50 }), movement({ movementId: 2, quantity: -20, batchId: 'B2' })], onHand: 10 },
      }),
    })
    render(<Harness role="staff" />)
    await userEvent.selectOptions(screen.getByLabelText('What happened?'), 'SELL')
    await userEvent.type(screen.getByLabelText(/^Quantity/), '70')
    await userEvent.click(screen.getByRole('button', { name: 'Record movement' }))
    expect(await screen.findByRole('status')).toHaveTextContent('70 units (across 2 batches)')
  })
})
