import { useId, useState, type FormEvent } from 'react';
import { ApiError, type Supplier, type SupplierInput } from '../api';
import { cleanPhone, validateSupplier, type SupplierErrors as Errors } from './validation';

const EMPTY: SupplierInput = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  leadTimeDays: 2,
  notes: '',
};

function fromSupplier(s: Supplier): SupplierInput {
  return {
    name: s.name,
    contactName: s.contactName ?? '',
    email: s.email ?? '',
    phone: s.phone ?? '',
    leadTimeDays: s.leadTimeDays,
    notes: s.notes ?? '',
  };
}

interface Props {
  /** Supplier being edited, or undefined when adding a new one. */
  supplier?: Supplier;
  onSubmit: (values: SupplierInput) => Promise<unknown>;
  onCancel: () => void;
}

export function SupplierForm({ supplier, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<SupplierInput>(supplier ? fromSupplier(supplier) : EMPTY);
  const [leadTimeText, setLeadTimeText] = useState(String(values.leadTimeDays));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const id = useId();

  const set = <K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clientErrors = validateSupplier(values);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await onSubmit({ ...values, name: values.name.trim() });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({
          ...err.fields,
          form: Object.keys(err.fields).length ? undefined : err.message,
        });
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' });
      }
      setSaving(false);
    }
  }

  const field = (key: keyof SupplierInput) => ({
    id: `${id}-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id}-${key}-error` : undefined,
  });
  const errorFor = (key: keyof SupplierInput) =>
    errors[key] ? (
      <p className="field__error" id={`${id}-${key}-error`}>
        {errors[key]}
      </p>
    ) : null;

  return (
    <form
      className="card form"
      onSubmit={submit}
      noValidate
      aria-label={supplier ? `Edit ${supplier.name}` : 'Add supplier'}
    >
      <h2 className="form__title">{supplier ? `Edit ${supplier.name}` : 'Add a supplier'}</h2>

      {errors.form && (
        <p className="banner banner--error" role="alert">
          {errors.form}
        </p>
      )}

      <div className="form__grid">
        <div className="field field--wide">
          <label htmlFor={`${id}-name`}>
            Name <span className="field__required">required</span>
          </label>
          <input
            {...field('name')}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus
            maxLength={120}
          />
          {errorFor('name')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-contactName`}>Contact person</label>
          <input
            {...field('contactName')}
            value={values.contactName}
            onChange={(e) => set('contactName', e.target.value)}
            maxLength={120}
          />
          {errorFor('contactName')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-leadTimeDays`}>
            Lead time (days) <span className="field__required">required</span>
          </label>
          <input
            {...field('leadTimeDays')}
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            step={1}
            value={leadTimeText}
            onChange={(e) => {
              setLeadTimeText(e.target.value);
              set('leadTimeDays', e.target.value === '' ? Number.NaN : Number(e.target.value));
            }}
          />
          <p className="field__hint">Days between ordering and delivery</p>
          {errorFor('leadTimeDays')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            {...field('email')}
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
          />
          {errorFor('email')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-phone`}>Phone</label>
          <input
            {...field('phone')}
            aria-describedby={[`${id}-phone-hint`, errors.phone && `${id}-phone-error`]
              .filter(Boolean)
              .join(' ')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+65 6123 4567"
            value={values.phone}
            onChange={(e) => set('phone', cleanPhone(e.target.value))}
            maxLength={40}
          />
          <p className="field__hint" id={`${id}-phone-hint`}>
            Digits only (spaces and a leading + are fine)
          </p>
          {errorFor('phone')}
        </div>

        <div className="field field--wide">
          <label htmlFor={`${id}-notes`}>Notes</label>
          <textarea
            {...field('notes')}
            rows={2}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={1000}
            placeholder="e.g. Delivers Tue & Fri, order before 3pm"
          />
          {errorFor('notes')}
        </div>
      </div>

      <div className="form__actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="button--primary" disabled={saving}>
          {saving ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}
        </button>
      </div>
    </form>
  );
}
