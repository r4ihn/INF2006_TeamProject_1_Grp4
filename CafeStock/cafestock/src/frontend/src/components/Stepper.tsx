import type { InputHTMLAttributes } from 'react';

interface Props {
  /** The field's text (as typed) */
  value: string;
  onChange: (value: string) => void;
  /** What the number is, for the buttons' accessible names, e.g. "count of Fresh milk" */
  label: string;
  step?: number;
  min?: number;
  /** Where the first click starts when the field is empty (e.g. the expected stock) */
  startFrom?: number;
  /** Attributes for the <input> itself (id, aria-*, placeholder, …) */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  /** Unit shown after the + button, e.g. "ml" */
  unit?: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A number field with its own − and + buttons beside it (not the browser's tiny arrows
 * inside the field), big enough to tap on a phone.
 */
export function Stepper({
  value,
  onChange,
  label,
  step = 1,
  min = 0,
  startFrom,
  inputProps,
  unit,
}: Props) {
  const current = value.trim() === '' ? null : Number(value);
  const bump = (direction: 1 | -1) => {
    let next: number;
    if (current === null || Number.isNaN(current)) {
      next = startFrom ?? (direction > 0 ? step : min);
    } else {
      next = current + direction * step;
    }
    onChange(String(Math.max(min, round3(next))));
  };
  const atMin = current !== null && !Number.isNaN(current) && current <= min;

  return (
    <span className="stepper">
      <button
        type="button"
        className="stepper__button"
        aria-label={`Decrease ${label}`}
        disabled={atMin}
        onClick={() => bump(-1)}
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step="any"
        {...inputProps}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="stepper__button"
        aria-label={`Increase ${label}`}
        onClick={() => bump(1)}
      >
        +
      </button>
      {unit !== undefined && <span className="stepper__unit">{unit}</span>}
    </span>
  );
}
