import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, type Item, type ItemInput, type Supplier } from '../api';
import { Field } from '../components/Field';
import { fieldAria } from '../components/fieldAria';
import { parseNumber } from '../format';
import { UNIT_SUGGESTIONS, validateItem, type ItemErrors, type ItemFormValues } from './validation';

const EMPTY: ItemFormValues = {
  name: '',
  sku: '',
  category: '',
  unit: '',
  supplierId: '',
  unitCost: '0',
  reorderPoint: '0',
  spoilageCap: '',
};

function fromItem(item: Item): ItemFormValues {
  return {
    name: item.name,
    sku: item.sku ?? '',
    category: item.category,
    unit: item.unit,
    supplierId: item.supplier?.id ?? '',
    unitCost: String(item.unitCost),
    reorderPoint: String(item.reorderPoint),
    spoilageCap: item.spoilageCap === null ? '' : String(item.spoilageCap),
  };
}

function toInput(v: ItemFormValues): ItemInput {
  return {
    name: v.name.trim(),
    sku: v.sku.trim(),
    category: v.category.trim(),
    unit: v.unit.trim(),
    supplierId: v.supplierId,
    unitCost: parseNumber(v.unitCost) ?? 0,
    reorderPoint: parseNumber(v.reorderPoint) ?? 0,
    spoilageCap: parseNumber(v.spoilageCap),
  };
}

interface Props {
  item?: Item;
  suppliers: Supplier[];
  categories: string[];
  onSubmit: (input: ItemInput) => Promise<unknown>;
  onCancel: () => void;
}

export function ItemForm({ item, suppliers, categories, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<ItemFormValues>(item ? fromItem(item) : EMPTY);
  const [errors, setErrors] = useState<ItemErrors>({});
  const [saving, setSaving] = useState(false);
  const uid = useId();
  const id = (key: string) => `${uid}-${key}`;

  const set = (key: keyof ItemFormValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clientErrors = validateItem(values);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await onSubmit(toInput(values));
    } catch (err) {
      if (err instanceof ApiError) {
        const hasFields = Object.keys(err.fields).length > 0;
        setErrors({ ...err.fields, form: hasFields ? undefined : err.message });
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' });
      }
      setSaving(false);
    }
  }

  const title = item ? `Edit ${item.name}` : 'Add an item';

  return (
    <form
      className="card form"
      onSubmit={submit}
      noValidate
      aria-label={item ? `Edit ${item.name}` : 'Add item'}
    >
      <h2 className="form__title">{title}</h2>

      {errors.form && (
        <p className="banner banner--error" role="alert">
          {errors.form}
        </p>
      )}

      <div className="form__grid">
        <Field id={id('name')} label="Name" required error={errors.name}>
          <input
            {...fieldAria(id('name'), errors.name)}
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            maxLength={120}
            autoFocus
            placeholder="e.g. Espresso beans"
          />
        </Field>

        <Field id={id('sku')} label="SKU / code" error={errors.sku}>
          <input
            {...fieldAria(id('sku'), errors.sku)}
            value={values.sku}
            onChange={(e) => set('sku', e.target.value)}
            maxLength={40}
            placeholder="Optional"
          />
        </Field>

        <Field id={id('category')} label="Category" required error={errors.category}>
          <input
            {...fieldAria(id('category'), errors.category)}
            value={values.category}
            onChange={(e) => set('category', e.target.value)}
            list={id('categories')}
            maxLength={60}
            placeholder="e.g. Coffee, Dairy, Bakery"
          />
          <datalist id={id('categories')}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>

        <Field
          id={id('unit')}
          label="Unit"
          required
          error={errors.unit}
          hint="How you count it: kg, L, pcs, box…"
        >
          <input
            {...fieldAria(id('unit'), errors.unit, true)}
            value={values.unit}
            onChange={(e) => set('unit', e.target.value)}
            list={id('units')}
            maxLength={20}
          />
          <datalist id={id('units')}>
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>

        <Field
          id={id('supplierId')}
          label="Supplier"
          error={errors.supplierId}
          wide
          hint={
            suppliers.length === 0 ? (
              <>
                No suppliers yet — <Link to="/suppliers">add one on the Suppliers page</Link>.
              </>
            ) : undefined
          }
        >
          <select
            {...fieldAria(id('supplierId'), errors.supplierId, suppliers.length === 0)}
            value={values.supplierId}
            onChange={(e) => set('supplierId', e.target.value)}
          >
            <option value="">— No supplier —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.leadTimeDays} day{s.leadTimeDays === 1 ? '' : 's'} lead time)
              </option>
            ))}
          </select>
        </Field>

        <Field id={id('unitCost')} label="Unit cost (S$)" required error={errors.unitCost}>
          <input
            {...fieldAria(id('unitCost'), errors.unitCost)}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={values.unitCost}
            onChange={(e) => set('unitCost', e.target.value)}
          />
        </Field>

        <Field
          id={id('reorderPoint')}
          label={`Reorder point${values.unit.trim() ? ` (${values.unit.trim()})` : ''}`}
          required
          error={errors.reorderPoint}
          hint="Flag the item as low when stock drops to this"
        >
          <input
            {...fieldAria(id('reorderPoint'), errors.reorderPoint, true)}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={values.reorderPoint}
            onChange={(e) => set('reorderPoint', e.target.value)}
          />
        </Field>

        <Field
          id={id('spoilageCap')}
          label={`Spoilage cap${values.unit.trim() ? ` (${values.unit.trim()})` : ''}`}
          error={errors.spoilageCap}
          wide
          hint="The most you'd hold before it spoils. Caps suggested order sizes. Leave empty for no limit."
        >
          <input
            {...fieldAria(id('spoilageCap'), errors.spoilageCap, true)}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={values.spoilageCap}
            onChange={(e) => set('spoilageCap', e.target.value)}
            placeholder="No limit"
          />
        </Field>
      </div>

      <div className="form__actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="button--primary" disabled={saving}>
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </form>
  );
}
