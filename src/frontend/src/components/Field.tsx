import type { ReactNode } from 'react';

interface FieldProps {
  /** id of the input inside — ties the label, hint and error to it */
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  wide?: boolean;
  children: ReactNode;
}

/** Label + input + optional hint + error, laid out consistently across forms. */
export function Field({ id, label, required, hint, error, wide, children }: FieldProps) {
  return (
    <div className={`field${wide ? ' field--wide' : ''}`}>
      <label htmlFor={id}>
        {label} {required && <span className="field__required">required</span>}
      </label>
      {children}
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
