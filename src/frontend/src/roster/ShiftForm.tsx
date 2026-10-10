import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, type Shift, type ShiftInput, type TeamMember } from '../api';
import { Field } from '../components/Field';
import { fieldAria } from '../components/fieldAria';
import { dayHeading } from './dates';
import { validateShift, type ShiftErrors as Errors } from './validation';

interface Props {
  /** The shift being edited; undefined when adding one */
  shift?: Shift;
  /** Pre-filled date when adding from a day column */
  date: string;
  team: TeamMember[];
  positions: string[];
  onSubmit: (input: ShiftInput) => Promise<unknown>;
  onCancel: () => void;
  onDelete?: () => Promise<unknown>;
}

export function ShiftForm({ shift, date, team, positions, onSubmit, onCancel, onDelete }: Props) {
  const [values, setValues] = useState<ShiftInput>(() => ({
    date: shift?.date ?? date,
    start: shift?.start ?? '09:00',
    end: shift?.end ?? '15:00',
    position: shift?.position ?? '',
    userId: shift?.assignee?.id ?? '',
    note: shift?.note ?? '',
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const untilMidnight = values.end === '24:00';

  const set = <K extends keyof ShiftInput>(key: K, value: ShiftInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key] || errors.form) setErrors((e) => ({ ...e, [key]: undefined, form: undefined }));
  };

  // Someone removed from the roster can still be shown on a shift being edited
  const people =
    shift?.assignee && !team.some((m) => m.id === shift.assignee!.id)
      ? [...team, { id: shift.assignee.id, name: `${shift.assignee.name} (left the team)` }]
      : team;

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      const fields = err.fields as Errors;
      setErrors({ ...fields, form: Object.keys(fields).length ? undefined : err.message });
    } else {
      setErrors({ form: 'Something went wrong. Please try again.' });
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clientErrors = validateShift(values);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await onSubmit({
        ...values,
        position: values.position.trim(),
        userId: values.userId || null,
      });
    } catch (err) {
      handleError(err);
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setSaving(true);
    try {
      await onDelete();
    } catch (err) {
      handleError(err);
      setSaving(false);
      setConfirmingDelete(false);
    }
  }

  // Opened from a day far down the page (or on a phone): bring the form into view
  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    form?.querySelector('select')?.focus({ preventScroll: true });
  }, []);

  const f = (key: keyof ShiftInput, hint = false) => fieldAria(`${id}-${key}`, errors[key], hint);
  const title = shift ? `Edit shift on ${dayHeading(shift.date)}` : 'Add a shift';

  return (
    <form
      ref={formRef}
      className="card form roster__form"
      onSubmit={submit}
      noValidate
      aria-label={title}
    >
      <h2 className="form__title">{title}</h2>

      {errors.form && (
        <p className="banner banner--error" role="alert">
          {errors.form}
        </p>
      )}

      <div className="form__grid">
        <Field
          id={`${id}-userId`}
          label="Who"
          error={errors.userId}
          hint="Leave open if you haven’t decided yet"
        >
          <select
            {...f('userId', true)}
            value={values.userId ?? ''}
            onChange={(e) => set('userId', e.target.value)}
          >
            <option value="">Open shift (nobody yet)</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id={`${id}-position`}
          label="Position"
          required
          error={errors.position}
          hint="What they do on this shift"
        >
          <input
            {...f('position', true)}
            list={`${id}-positions`}
            value={values.position}
            onChange={(e) => set('position', e.target.value)}
            maxLength={40}
            placeholder="e.g. Barista"
            autoComplete="off"
          />
          <datalist id={`${id}-positions`}>
            {positions.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>

        <Field id={`${id}-date`} label="Date" required error={errors.date}>
          <input
            {...f('date')}
            type="date"
            value={values.date}
            onChange={(e) => set('date', e.target.value)}
          />
        </Field>

        <div className="shift-times">
          <Field id={`${id}-start`} label="Start" required error={errors.start}>
            <input
              {...f('start')}
              type="time"
              step={900}
              value={values.start}
              onChange={(e) => set('start', e.target.value)}
            />
          </Field>
          <Field id={`${id}-end`} label="End" required error={errors.end}>
            <input
              {...f('end')}
              type="time"
              step={900}
              value={untilMidnight ? '' : values.end}
              disabled={untilMidnight}
              onChange={(e) => set('end', e.target.value)}
            />
          </Field>
          <label className="check shift-times__midnight">
            <input
              type="checkbox"
              checked={untilMidnight}
              onChange={(e) => set('end', e.target.checked ? '24:00' : '22:00')}
            />
            Until midnight
          </label>
        </div>

        <Field id={`${id}-note`} label="Note" error={errors.note} wide>
          <input
            {...f('note')}
            value={values.note}
            onChange={(e) => set('note', e.target.value)}
            maxLength={200}
            placeholder="e.g. Opens the café, bring keys"
          />
        </Field>
      </div>

      <div className="form__actions">
        {onDelete &&
          (confirmingDelete ? (
            <span
              className="confirm form__delete"
              role="group"
              aria-label="Confirm deleting this shift"
            >
              <span>Delete this shift?</span>
              <button type="button" onClick={() => setConfirmingDelete(false)} disabled={saving}>
                Keep it
              </button>
              <button type="button" className="button--danger" onClick={remove} disabled={saving}>
                Delete
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="button--ghost-danger form__delete"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              Delete shift
            </button>
          ))}
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="button--primary" disabled={saving}>
          {saving ? 'Saving…' : shift ? 'Save changes' : 'Add shift'}
        </button>
      </div>
    </form>
  );
}
