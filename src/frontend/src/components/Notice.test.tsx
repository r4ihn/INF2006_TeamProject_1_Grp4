import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Notice } from './Notice';

describe('Notice', () => {
  it('shows the message with a × that closes it', async () => {
    const onDismiss = vi.fn();
    render(
      <Notice kind="success" onDismiss={onDismiss}>
        Saved Fresh milk
      </Notice>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved Fresh milk');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('announces errors straight away', () => {
    render(
      <Notice kind="error" onDismiss={() => {}}>
        Couldn’t delete Napkin
      </Notice>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t delete Napkin');
  });
});
