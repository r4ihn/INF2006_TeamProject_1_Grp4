import type { RecommendationStatus } from '../api';

/** Status names shown next to the colour, so the state is never colour alone. */
export const STATUS_TEXT: Record<RecommendationStatus, string> = {
  URGENT: 'Urgent',
  REORDER: 'Reorder',
  OK: 'OK',
};

export const STATUS_HELP: Record<RecommendationStatus, string> = {
  URGENT: 'Will run out before a delivery could arrive',
  REORDER: 'Below its reorder point',
  OK: 'Enough stock for now',
};

/** "lgbm-v1" → "LightGBM model (lgbm-v1)", "baseline-ma14" → "14-day average (baseline-ma14)" */
export function describeModel(tag: string | null): string {
  if (!tag) return '—';
  if (tag.startsWith('lgbm')) return `LightGBM model (${tag})`;
  const ma = /^baseline-ma(\d+)$/.exec(tag);
  if (ma) return `${ma[1]}-day average (${tag})`;
  return tag;
}
