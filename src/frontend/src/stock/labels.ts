import type { MovementType } from '../api';

/** How each movement type is named in the UI. */
export const MOVEMENT_LABEL: Record<MovementType, string> = {
  RECEIVE: 'Delivery',
  USAGE: 'Used',
  WASTE: 'Wasted',
  ADJUSTMENT: 'Adjusted',
  COUNT: 'Counted',
};

export const MOVEMENT_HELP: Record<Exclude<MovementType, 'COUNT'>, string> = {
  RECEIVE: 'Stock that arrived from a supplier.',
  USAGE: 'Stock used to make and sell things. This is what the forecast learns from.',
  WASTE: 'Spoiled, expired or spilled. Not counted as demand.',
  ADJUSTMENT: 'Fix a mistake without a full count. Not counted as demand.',
};

/** Query keys shared by every page that shows stock numbers. */
export const STOCK_KEYS = {
  items: ['items'],
  movements: ['movements'],
  demand: ['demand'],
  history: ['history'],
} as const;

/** Dataset imports only change when `npm run db:import` runs. */
export const IMPORTS_KEY = ['imports'] as const;
