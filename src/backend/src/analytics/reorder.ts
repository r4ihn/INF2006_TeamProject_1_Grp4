// The ordering rule from the analytics work (forecast_script.py, `recommend`), applied to live stock:
//
//   need   = forecast x cover weeks + safety stock
//   packs  = ceil(max(0, need - on hand) / pack size)
//   cap    = never order more than half a shelf life's worth of forecast sales
//
// The forecast (moving average of recent complete weeks) and the safety stock (z x spread of recent
// weeks) come from the analytics run; only the stock-dependent part is recomputed here.

export interface OrderInputs {
  forecast: number;
  safetyStock: number;
  onHand: number;
  packSize: number;
  // null when the item has no shelf life: then nothing limits the order size.
  shelfLifeDays: number | null;
  coverWeeks: number;
}

export interface OrderSuggestion {
  packs: number;
  units: number;
  cappedByShelfLife: boolean;
  weeksOfCover: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function suggestOrder(i: OrderInputs): OrderSuggestion {
  const need = i.forecast * i.coverWeeks + i.safetyStock;
  const gap = Math.max(0, need - i.onHand);
  let packs = gap > 0 ? Math.ceil(gap / i.packSize) : 0;

  let cappedByShelfLife = false;
  if (i.shelfLifeDays !== null) {
    const maxWeeks = (i.shelfLifeDays / 7) * 0.5;
    const capPacks = i.forecast
      ? Math.floor((i.forecast * maxWeeks) / i.packSize)
      : 0;
    const allowed = Math.max(capPacks, 1);
    cappedByShelfLife = packs > allowed;
    if (packs) packs = Math.min(packs, allowed);
  }

  return {
    packs,
    units: packs * i.packSize,
    cappedByShelfLife,
    weeksOfCover: i.forecast
      ? round1((i.onHand + packs * i.packSize) / i.forecast)
      : null,
  };
}
