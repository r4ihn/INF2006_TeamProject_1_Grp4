import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Stepper } from './Stepper';

function Harness({ startFrom, initial = '' }: { startFrom?: number; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="q">Quantity</label>
      <Stepper
        value={value}
        onChange={setValue}
        label="quantity"
        unit="L"
        startFrom={startFrom}
        inputProps={{ id: 'q' }}
      />
    </>
  );
}

describe('Stepper', () => {
  it('has its own − and + buttons beside the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Quantity');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(input).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(input).toHaveValue(2);
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(input).toHaveValue(1);
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('never goes below zero', async () => {
    const user = userEvent.setup();
    render(<Harness initial="0.5" />);
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(screen.getByLabelText('Quantity')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
  });

  it('starts from a suggested value when empty', async () => {
    const user = userEvent.setup();
    render(<Harness startFrom={20} />);
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(screen.getByLabelText('Quantity')).toHaveValue(20);
  });

  it('still accepts typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Quantity'), '12.5');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByLabelText('Quantity')).toHaveValue(13.5);
  });
});
