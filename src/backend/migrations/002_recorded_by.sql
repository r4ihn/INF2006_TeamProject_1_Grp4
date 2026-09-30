-- Audit trail: which authenticated user recorded each movement made through the API.
-- NULL for rows loaded from the synthetic dataset. The column is added, not updated: the ledger
-- stays append-only.
ALTER TABLE stock_movements ADD COLUMN recorded_by text CHECK (length(btrim(recorded_by)) > 0);
