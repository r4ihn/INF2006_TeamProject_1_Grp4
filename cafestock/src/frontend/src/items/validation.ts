import { hasAtMostDecimals, parseNumber } from '../format';

/** What the form holds while editing: numbers are kept as the text the user typed. */
export interface ItemFormValues {
  name: string;
  sku: string;
  category: string;
  unit: string;
  supplierId: string;
  unitCost: string;
  reorderPoint: string;
  spoilageCap: string;
}

export type ItemErrors = Partial<Record<keyof ItemFormValues | 'form', string>>;

function checkAmount(
  errors: ItemErrors,
  key: 'unitCost' | 'reorderPoint' | 'spoilageCap',
  label: string,
  text: string,
  places: number,
  optional = false,
) {
  const value = parseNumber(text);
  if (value === null) {
    if (!optional) errors[key] = `${label} is required`;
    return;
  }
  if (Number.isNaN(value)) errors[key] = `${label} must be a number`;
  else if (value < 0) errors[key] = `${label} cannot be negative`;
  else if (!hasAtMostDecimals(value, places))
    errors[key] = `${label} can have at most ${places} decimal places`;
}

/** Same rules as the API (backend/src/validation/items.ts), checked early for quick feedback. */
export function validateItem(v: ItemFormValues): ItemErrors {
  const e: ItemErrors = {};
  if (!v.name.trim()) e.name = 'Name is required';
  else if (v.name.trim().length > 120) e.name = 'Must be at most 120 characters';
  if (v.sku.trim().length > 40) e.sku = 'Must be at most 40 characters';
  if (!v.category.trim()) e.category = 'Category is required';
  else if (v.category.trim().length > 60) e.category = 'Must be at most 60 characters';
  if (!v.unit.trim()) e.unit = 'Unit is required';
  else if (v.unit.trim().length > 20) e.unit = 'Must be at most 20 characters';
  checkAmount(e, 'unitCost', 'Unit cost', v.unitCost, 4);
  checkAmount(e, 'reorderPoint', 'Reorder point', v.reorderPoint, 3);
  checkAmount(e, 'spoilageCap', 'Spoilage cap', v.spoilageCap, 3, true);
  return e;
}

/** Common units offered as suggestions (any text is allowed). */
export const UNIT_SUGGESTIONS = [
  'kg',
  'g',
  'L',
  'ml',
  'pcs',
  'box',
  'bag',
  'bottle',
  'pack',
  'tray',
  'carton',
  'can',
];
