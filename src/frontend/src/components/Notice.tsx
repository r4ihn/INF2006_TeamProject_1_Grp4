import type { ReactNode } from 'react';

export type NoticeKind = 'success' | 'error' | 'info';

/**
 * A message shown after something happened ("Delivery recorded…", "Couldn't delete…"), with a
 * × button to close it. Errors are announced straight away by screen readers (role="alert");
 * the rest politely (role="status").
 */
export function Notice({
  kind,
  children,
  onDismiss,
  className,
}: {
  kind: NoticeKind;
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      className={`banner banner--${kind} banner--dismissible${className ? ` ${className}` : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <div className="banner__body">{children}</div>
      <button
        type="button"
        className="banner__close"
        aria-label="Dismiss notification"
        title="Dismiss"
        onClick={onDismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
