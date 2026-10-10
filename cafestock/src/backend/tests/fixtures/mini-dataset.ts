import type { FileContents } from '../../src/import/coffee-dataset.js';

const INGREDIENT_HEADER =
  'ingredient_id,sku,ingredient_name,unit,unit_cost,shelf_life_days,storage_location,lead_time_days,pack_size,pack_description,reorder_threshold,reorder_quantity,avg_daily_demand_derived';
const LEDGER_HEADER =
  'movement_id,occurred_at,ingredient_id,movement_type,quantity,batch_id,expiry_date,storage_location,sale_id,caused_by_drink,sale_price,payment_method,reason,source';

/**
 * A three-day, two-ingredient copy of the team dataset's format — small enough to reason
 * about by hand. Milk: 440, 0, 200 ml sold; cups: 2, 1, 1 sold.
 */
export function miniDataset(
  overrides: { ingredients?: string[]; demand?: string[]; ledger?: string[] } = {},
) {
  const ingredients = overrides.ingredients ?? [
    '1,ING-001,Fresh milk,ml,0.0021,7,Chiller,1,1000,1 L bottle,3120,4000,213.33',
    '2,ING-002,Paper cup 12oz,unit,0.11,730,Dry Store 1,3,50,sleeve of 50,49,100,1.33',
  ];
  const demand = overrides.demand ?? [
    '2024-03-01,1,440,Friday,False,3,Fresh milk,ml',
    '2024-03-01,2,2,Friday,False,3,Paper cup 12oz,unit',
    '2024-03-02,1,0,Saturday,True,3,Fresh milk,ml',
    '2024-03-02,2,1,Saturday,True,3,Paper cup 12oz,unit',
    '2024-03-03,1,200,Sunday,True,3,Fresh milk,ml',
    '2024-03-03,2,1,Sunday,True,3,Paper cup 12oz,unit',
  ];
  const ledger = overrides.ledger ?? [
    '1,2024-02-29 08:00:00.000,1,RECEIVE,1000,B1,2024-03-07,Chiller,,,,,Opening stock,synthetic',
    '2,2024-02-29 08:00:00.000,2,RECEIVE,50,B2,2026-02-28,Dry Store 1,,,,,Opening stock,synthetic',
    '3,2024-03-01 10:15:50.520,1,SELL,-220,B1,2024-03-07,Chiller,1.0,Latte,38.7,card,Counter sale,derived',
    '4,2024-03-01 10:15:50.520,2,SELL,-1,B2,2026-02-28,Dry Store 1,1.0,Latte,38.7,card,Counter sale,derived',
    '5,2024-03-01 23:30:00.000,1,SELL,-220,B1,2024-03-07,Chiller,2.0,Latte,38.7,card,Counter sale,derived',
    '6,2024-03-01 23:30:00.000,2,SELL,-1,B2,2026-02-28,Dry Store 1,2.0,Latte,38.7,card,Counter sale,derived',
    '7,2024-03-02 21:00:00.000,2,ADJUST,-3,B2,2026-02-28,Dry Store 1,,,,,Stocktake correction,synthetic',
    '8,2024-03-02 22:00:00.000,2,SELL,-1,B2,2026-02-28,Dry Store 1,3.0,Espresso,20,cash,Counter sale,derived',
    '9,2024-03-03 07:30:00.000,1,SPOILAGE,-300,B1,2024-03-07,Chiller,,,,,"Expired, written off",synthetic',
    '10,2024-03-03 09:00:00.000,1,RECEIVE,1000,B3,2024-03-10,Chiller,,,,,Supplier delivery,synthetic',
    '11,2024-03-03 12:00:00.000,1,SELL,-200,B3,2024-03-10,Chiller,4.0,Hot Chocolate,38.7,card,Counter sale,derived',
    '12,2024-03-03 12:00:00.000,2,SELL,-1,B2,2026-02-28,Dry Store 1,4.0,Hot Chocolate,38.7,card,Counter sale,derived',
  ];
  const file = (name: string, header: string, rows: string[]): FileContents => ({
    file: name,
    text: `${header}\n${rows.join('\n')}\n`,
  });
  return {
    ingredients: file('ingredients.csv', INGREDIENT_HEADER, ingredients),
    demand: file(
      'daily_demand.csv',
      'date,ingredient_id,units,weekday,is_weekend,month,ingredient_name,unit',
      demand,
    ),
    ledger: file('stock_movements.csv', LEDGER_HEADER, ledger),
  };
}
