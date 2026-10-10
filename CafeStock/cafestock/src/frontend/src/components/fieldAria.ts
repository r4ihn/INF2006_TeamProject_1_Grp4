/** ARIA attributes for an input rendered inside <Field>. */
export function fieldAria(id: string, error: string | undefined, hasHint = false) {
  const describedBy = [error ? `${id}-error` : '', hasHint ? `${id}-hint` : '']
    .filter(Boolean)
    .join(' ');
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const;
}
