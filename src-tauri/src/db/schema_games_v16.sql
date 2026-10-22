-- Append-only migration for the games domain (v16):
-- purchase cost for the $/hour tracker. `purchase_cost` is the amount
-- the user paid (user-entered or prefilled from a price lookup),
-- `purchase_currency` the ISO currency code for that amount. NULL cost
-- = unknown → the game is excluded from value ($/hour) metrics.
-- Read-back lives in `game_row_from_row` and writes in the INSERT
-- statements of `upsert_batch` / `upsert_one`; keep all three in sync.
ALTER TABLE games ADD COLUMN purchase_cost REAL;
ALTER TABLE games ADD COLUMN purchase_currency TEXT;
