const number = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 3 })

export function formatQuantity(value: number, unit: string): string {
  return `${number.format(value)} ${unit === 'unit' ? (Math.abs(value) === 1 ? 'unit' : 'units') : unit}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
}
