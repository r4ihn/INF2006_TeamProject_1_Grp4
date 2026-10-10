import { useId, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, recordMovement, type Item, type MovementInput } from '../api';
import { Field } from '../components/Field';
import { Stepper } from '../components/Stepper';
import { fieldAria } from '../components/fieldAria';
import { formatQty, hasAtMostDecimals, parseNumber } from '../format';
import { MOVEMENT_HELP, MOVEMENT_LABEL, STOCK_KEYS } from './labels';

type Kind = MovementInput['type'];
const KINDS: Kind[] = ['RECEIVE', 'USAGE', 'WASTE', 'ADJUSTMENT'];
type Errors = Partial<Record<'itemId' | 'quantity' | 'occurredAt' | 'form', string>>;

interface Props {
  items: Item[];
  initialItemId?: string;
  onSaved: (message: string) => void;
}

/** Record one delivery, usage, waste or adjustment. */
export function RecordForm({ items, initialItemId, onSaved }: Props) {
  const queryClient = useQueryClient();
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;

  const [kind, setKind] = useState<Kind>('RECEIVE');
  const [itemId, setItemId] = useState(
    initialItemId && items.some((i) => i.id === initialItemId) ? initialItemId : '',
  );
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'add' | 'remove'>('remove'); // adjustments only
  const [when, setWhen] = useState(''); // datetime-local; "" = now
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const item = items.find((i) => i.id === itemId);
  const byCategory = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const i of items) groups.set(i.category, [...(groups.get(i.category) ?? []), i]);
    return [...groups.entries()];
  }, [items]);

  const save = useMutation({
    mutationFn: recordMovement,
    onSuccess: async (result) => {
      await Promise.all(
        Object.values(STOCK_KEYS).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      const qty = formatQty(Math.abs(result.change), result.item.unit);
      const verb: Record<Kind, string> = {
        RECEIVE: `Delivery recorded: ${qty}`,
        USAGE: `Usage recorded: ${qty}`,
        WASTE: `Waste recorded: ${qty}`,
        ADJUSTMENT: `Adjustment recorded: ${result.change > 0 ? '+' : '−'}${qty}`,
      };
      onSaved(
        `${result.item.name} | ${verb[result.type as Kind]} | On hand now: ${formatQty(result.after, result.item.unit)}`,
      );
      setQuantity('');
      setNote('');
      setWhen('');
      setErrors({});
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const fields = err.fields as Errors;
        setErrors(Object.keys(fields).length ? fields : { form: err.message });
      } else {
        setErrors({ form: 'Couldn’t save. Try again.' });
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const e: Errors = {};
    const q = parseNumber(quantity);
    if (!itemId) e.itemId = 'Choose an item';
    if (q === null) e.quantity = 'Enter a quantity';
    else if (Number.isNaN(q) || q <= 0) e.quantity = 'Enter a number more than 0';
    else if (!hasAtMostDecimals(q, 3)) e.quantity = 'Use at most 3 decimal places';
    let occurredAt: string | undefined;
    if (when) {
      const d = new Date(when);
      if (Number.isNaN(d.getTime())) e.occurredAt = 'Enter a valid date and time';
      else if (d.getTime() > Date.now() + 60_000) e.occurredAt = 'Can’t be in the future';
      else occurredAt = d.toISOString();
    }
    setErrors(e);
    if (Object.keys(e).length) return;

    const signed = kind === 'ADJUSTMENT' && direction === 'remove' ? -q! : q!;
    save.mutate({
      itemId,
      type: kind,
      quantity: signed,
      note: note.trim() || undefined,
      occurredAt,
    });
  }

  return (
    <form className="card form" onSubmit={submit} noValidate aria-label="Record stock movement">
      {errors.form && (
        <p className="banner banner--error" role="alert">
          {errors.form}
        </p>
      )}

      <fieldset className="segmented">
        <legend>What happened?</legend>
        {KINDS.map((k) => (
          <label key={k} className={`segmented__option${kind === k ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={id('kind')}
              value={k}
              checked={kind === k}
              onChange={() => setKind(k)}
            />
            {k === 'RECEIVE' ? 'Delivery received' : MOVEMENT_LABEL[k]}
          </label>
        ))}
      </fieldset>
      <p className="field__hint segmented__help">{MOVEMENT_HELP[kind]}</p>

      <div className="form__grid">
        <Field id={id('item')} label="Item" required error={errors.itemId} wide>
          <select
            {...fieldAria(id('item'), errors.itemId)}
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              setErrors((x) => ({ ...x, itemId: undefined, quantity: undefined }));
            }}
          >
            <option value="">Choose an item…</option>
            {byCategory.map(([category, list]) => (
              <optgroup key={category} label={category}>
                {list.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} | On hand: {formatQty(i.onHand, i.unit)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {kind === 'ADJUSTMENT' && (
          <fieldset className="segmented segmented--small field--wide">
            <legend>Direction</legend>
            {(['remove', 'add'] as const).map((d) => (
              <label
                key={d}
                className={`segmented__option${direction === d ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name={id('direction')}
                  checked={direction === d}
                  onChange={() => setDirection(d)}
                />
                {d === 'remove' ? 'Remove stock' : 'Add stock'}
              </label>
            ))}
          </fieldset>
        )}

        <Field
          id={id('quantity')}
          label={`Quantity${item ? ` (${item.unit})` : ''}`}
          required
          error={errors.quantity}
          hint={item ? `On hand now: ${formatQty(item.onHand, item.unit)}` : undefined}
        >
          <Stepper
            value={quantity}
            onChange={(v) => {
              setQuantity(v);
              setErrors((x) => ({ ...x, quantity: undefined }));
            }}
            label="quantity"
            unit={item?.unit ?? ''}
            inputProps={fieldAria(id('quantity'), errors.quantity, Boolean(item))}
          />
        </Field>

        <Field
          id={id('when')}
          label="When"
          error={errors.occurredAt}
          hint="Leave empty for now. You can back-date up to 90 days."
        >
          <input
            {...fieldAria(id('when'), errors.occurredAt, true)}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>

        <Field id={id('note')} label="Note" wide>
          <input
            id={id('note')}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === 'RECEIVE' ? 'e.g. Invoice #4411' : kind === 'WASTE' ? 'e.g. Expired' : ''
            }
          />
        </Field>
      </div>

      <div className="form__actions">
        <button type="submit" className="button--primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : `Record ${MOVEMENT_LABEL[kind].toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
