"""CafeStock baseline forecast engine (Task 8).

Pure Python, standard library only: daily demand forecasts, reorder recommendations and
forecast-error measures. It is the evaluation baseline for the ML model (Task 8b) and the
nightly Lambda's fallback when the model is unavailable (Task 10). The Node API never
imports it; it only reads what gets written to the forecast tables.
"""

__version__ = "0.1.0"
