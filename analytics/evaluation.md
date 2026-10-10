# Forecast evaluation

Produced by `analytics/forecast.py`. Re-run with `python3 forecast.py`.
Raw predictions in `forecast_backtest.csv` (2,632 rows), scores in
`method_comparison.csv` and `method_comparison_by_ingredient.csv`.

## Method

Weekly demand per ingredient, predicted one week ahead by a moving average
over the last N complete weeks. Seven methods were compared, including two
baselines and a trend-fitting method.

A moving average was chosen deliberately as the engineering default: a method
explainable in one sentence is one whose failures can be diagnosed. A machine-
learning model (LightGBM) is evaluated against a moving-average baseline in
`demand_model.ipynb`; see the analytics README for the comparison.

## Evaluation design

**Walk-forward, not a single hold-out.** For each week *t*, the model sees only
weeks up to *t-1* and predicts week *t*. This mirrors how the forecast would be
used and prevents future data leaking into the training window. 47 weeks are
scored per ingredient, after an 8-week warm-up so every method is scored on
identical weeks.

**Headline metric is MASE**, the mean absolute error divided by the naive
forecast's error on the same weeks. The naive baseline is therefore exactly
1.000 and every other number reads directly as a fraction of it. Below 1 beats
naive; above 1 does not.

**MAPE was deliberately not used.** Three ingredients have weeks with zero
demand, which makes MAPE either undefined or explosive.

## Results

```
method                   MAE      RMSE    MASE
MA-2                   265.6     801.8   0.963
Naive (last week)      254.4     784.2   1.000
MA-3                   285.9     839.2   1.004
MA-4                   308.1     889.1   1.079
Linear trend (8wk)     329.9     950.7   1.171
MA-8                   357.3    1024.9   1.232
Mean of all history    384.4    1148.5   1.338
```

MA-2 is the best method, but the margin is small: it reduces error by 3.7%
against simply assuming next week equals last week.

### Three findings worth stating plainly

**1. The improvement over naive is marginal.** A two-week moving average beats
the naive baseline by under 4%. Any claim that the forecast is a substantial
advance over doing nothing would not be supported by this evidence.

Note also that MAE and MASE disagree on the ranking: naive has the lower raw
MAE (254 against 266) while MA-2 has the lower MASE. This is not a
contradiction. Raw MAE pools every ingredient, so it is dominated by milk,
which is measured in millilitres and is numerically largest. MASE weights each
ingredient equally. MASE is the right metric here because the business question
is per-ingredient ordering, not total volume.

**2. Longer windows are monotonically worse.** MA-2 beats MA-3 beats MA-4 beats
MA-8, and the mean of all history is worst of all. The series has no stable
level to average toward: demand roughly doubles across the year, so older weeks
actively mislead. This is why the reorder policy in `build_ledger.py` uses a
trailing 28-day window rather than a whole-period average.

**3. Fitting the trend made things worse, not better.** Demand doubling across
the year makes a trend term look like an obvious improvement. It is not. The
8-week linear trend scored MASE 1.171, worse than naive and much worse than
MA-2. On milk its MAE was 2.22 L/week against naive's 1.65 L.

The reason is that the growth is not a smooth trend. It is noisy week-to-week
variation around a slowly rising level, and an 8-week line fit picks up the
noise and extrapolates it. This is a useful negative result: the more
sophisticated method lost to the simpler one, and the backtest is what revealed
it.

### Per-ingredient results

MASE for MA-2, against the naive baseline of 1.000:

```
Cocoa powder           0.790     clear improvement
Espresso beans         0.956
Drinking chocolate     0.965
Napkin                 0.970
Paper cup 12oz         0.975
Cup lid 12oz           0.975
Paper cup 8oz          1.000     no difference
Fresh milk             1.072     WORSE than naive
```

**Milk is the exception, and it is the item that matters most.** It is the only
perishable, the only one that ever spoils, and the largest by volume. For milk,
every method tested was worse than naive (MAE in litres per week, converted from
the stored millilitres for readability; the conversion does not change MASE):

```
Naive (last week)      1.65 L/week
MA-2                   1.77
MA-3                   1.92
MA-4                   2.07
Linear trend (8wk)     2.22
MA-8                   2.42
Mean of all history    2.61
```

In business terms: the best available milk forecast is off by roughly 1.8 litres
a week against average consumption of about 7.3 litres. That is an error of
around a quarter of weekly demand, which is why the safety stock term matters
more than the point forecast for this ingredient.

Milk demand is volatile week to week and any averaging smooths away real
movement. The honest conclusion is that on this dataset a moving average does
not improve milk forecasting, and the single most valuable ingredient to
forecast is the one the method helps least with.

Two defensible responses. Either use MA-2 for the seven ingredients where it
helps and naive for milk, which is a per-item method choice that should be
stated in the report rather than hidden. Or use MA-2 throughout for
consistency and record milk as a known limitation. The current
`forecast.py` does the latter; switching is a two-line change.

## Units

The ledger stores milk in millilitres and beans in grams, because recipe
quantities are integers at that scale (a latte uses 220 ml, an americano with
milk 60 ml) and `SUM(quantity)` therefore stays exact integer arithmetic.

Litres and kilograms are used for display only, in the plot and in the milk MAE
figures above. This is a linear rescale, so MASE is unchanged at 1.072.
Ordering is already expressed in whole supplier packs: the current
recommendation for milk is 5 one-litre bottles, not 5,000 ml.

Rounding the forecast itself to whole bottles was considered and rejected. It
adds quantization error on top of forecast error and would need re-scoring, for
no practical gain at roughly 10 bottles a week. The forecast runs in
millilitres; rounding happens once, at the ordering step.

## Visual result

`forecast_plot.png` shows actual against forecast for four ingredients, with
milk in litres and beans in kilograms. The
visible pattern is a one-week lag: the forecast tracks demand but arrives a
step behind. This is inherent to a moving average and is not a bug.

It matters for inventory, because the lag is asymmetric in cost. When demand
rises the forecast under-predicts and the shop risks a stockout. When demand
falls it over-predicts and the shop risks waste. This is exactly what the
safety stock term in the reorder calculation exists to absorb, and it is why
the recommendation adds roughly 1.65 standard deviations of recent variability
on top of the point forecast.

## From forecast to order

`reorder_recommendations.csv` converts the forecast into an order quantity:

```
order = (forecast x cover weeks) + safety stock - current stock
```

rounded up to the supplier's pack size, then capped so no perishable is ordered
in a quantity exceeding half its shelf life in demand. Without that cap the
policy buys five weeks of milk, which then expires. Current stock is read from
the ledger as `SUM(quantity)`, not from a stored value.

## Limitations

**The data is partly simulated.** Sales are real; recipes, deliveries and
wastage are generated. A forecast scored against this data is partly being
scored on predicting a process whose rules are known.

**One year of history, one location.** There is no second year to check annual
seasonality against, so any apparent seasonal pattern cannot be distinguished
from a one-off.

**Three ingredients have intermittent demand.** Cocoa powder, drinking
chocolate and 8 oz cups are each tied to a single low-volume drink and record
zero in many weeks. Weekly aggregation makes them forecastable, which is why
everything is forecast weekly, but their intervals remain wide.

**No promotions, weather or holiday data.** Several large spikes in the series
are unexplained by anything available. A real deployment would want those
inputs before expecting better accuracy.

**The forecast does not know about stockouts.** If the shop ran out and lost
sales, demand is recorded lower than true demand, and the forecast learns the
censored number. Six such events exist in this ledger, so the effect is small
here, but the mechanism is worth naming.

## What to claim in the report

Claim that a two-week moving average modestly outperforms a naive baseline
overall, that it does not help for milk, and that a trend-fitting method was
tested and rejected on evidence. That is a credible, defensible result.

Do not claim the forecast substantially improves ordering accuracy. The
measured improvement is under 4%, and the backtest is in the repository for a
marker to check.

---

# Part 2: does the forecast actually prevent stockouts?

Produced by `analytics/evaluate_policy.py`. Results in
`analytics/policy_comparison.csv`, chart in `analytics/policy_tradeoff.png`.

## Why a second evaluation was needed

Part 1 measured how close the forecast gets (MAE, MASE). That is the wrong
question for this service. The stated purpose of the forecast is to tell staff
to reorder before stock runs out, so what matters is:

- how often the shop ran out anyway
- how much demand went unmet
- how much stock expired waiting to be sold

A forecast can have excellent MAE and still cause stockouts if it errs
downward, and poor MAE while causing none if it errs upward. Accuracy and
service level are different things, and only the second is the goal.

**Direction of error matters more than size.** Every method tested
under-forecasts on average, because demand rises across the year. MA-2
under-forecasts milk by 210 ml per week and is short in 49% of weeks. No
accuracy metric reports that, and for stockout prevention it is the dangerous
direction.

## Method

The full year is replayed day by day under each policy. On each review day the
policy forecasts ahead and places an order; deliveries arrive after the lead
time; real daily demand is consumed first-expiry-first-out; expired batches are
written off. Demand is held fixed across policies, so any difference in outcome
comes from the ordering decision alone.

Unmet demand is counted as a stockout, not back-ordered. A customer who cannot
have a latte does not come back for it on Thursday.

Four policies are compared, including a no-forecast baseline that orders to a
level fixed once from the first eight weeks. That baseline stands in for what a
shop does with no analytics at all, and is the thing the forecast must beat.

## Results (safety factor z = 1.65, all 8 ingredients)

```
policy                       stockout days   service    waste   cover
MA-4                                   158    95.91%    0.56%    16.7
Naive (last week)                      166    95.66%    0.50%    17.4
MA-2                                   172    95.42%    0.46%    17.1
Fixed level (no forecast)              264    91.65%    0.28%    13.0
```

## Three findings, in order of how much they matter

**1. Review frequency dominates everything else.**

An earlier version of this simulation reviewed every ingredient weekly. Milk
collapsed to a 53.8% service level. The cause was structural, not statistical:
a 7-day perishable ordered once a week has to hold a full week of stock, and
the oldest of it expires on the day the next order lands.

Switching milk to a twice-weekly review cycle, changing nothing else:

```
milk, weekly review          82.5% service, 89 stockout days
milk, twice-weekly review    91.4% service, 56 stockout days
```

Nearly nine points of service level from a scheduling decision. No change of
forecast method came close to that.

**2. Having any forecast beats having none, by about four points.**

The no-forecast baseline reaches 91.65%. Every forecasting policy reaches
95.4% to 95.9%. That is the actual value of the analytics feature and it is
worth claiming: roughly 100 fewer stockout days across the year.

**3. Which forecast method barely matters: about half a point.**

Naive 95.66%, MA-2 95.42%, MA-4 95.91%. The spread across methods is smaller
than the spread from changing the safety factor, and far smaller than the
review-frequency effect.

This reframes Part 1. MA-2 winning on MASE by 3.7% translates to almost nothing
in service level, and MA-2 losing to naive on milk costs almost nothing either.
The forecast method is close to irrelevant; having a forecast at all, and
ordering often enough, are what matter.

## Waste stays low throughout

Waste ranges from 0.28% to 0.61% of demand across every policy and safety
setting. Only milk ever expires. Raising the safety factor from 0 to 2.5 buys
service level at a waste cost that stays under one percent, so on this data the
service-waste trade-off is not the binding constraint. Review frequency is.

## What to claim in the report

Claim that the forecasting feature raises service level from 91.7% to about
95.5%, roughly 100 fewer stockout days a year, and that the analysis also
identified a twice-weekly milk order cycle worth a further nine points on that
ingredient.

Do not claim that the choice of forecasting method is important. The evidence
says it is worth about half a percentage point, and the simulation is in the
repository for a marker to check.

## Limitations specific to this simulation

**Demand is treated as independent of stock.** In reality a stockout may push a
customer to a different drink, which would change demand for other ingredients.
The simulation does not model substitution.

**Lead times are fixed and deliveries always arrive.** No supplier failures, no
late deliveries, no partial shipments.

**The 8-week warm-up uses actual demand** to set opening stock, which slightly
flatters every policy in the first weeks.

**Recipes are invented**, so ingredient-level demand inherits that assumption,
as noted in `data/DATA_DICTIONARY.md`.
