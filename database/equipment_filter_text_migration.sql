-- ============================================================
-- Equipment Filter Text Migration
-- Legger til filter-tekstkolonner på equipment-tabellen
-- Idempotent: trygt å kjøre flere ganger
-- ============================================================

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS filter_supply_text        TEXT,
  ADD COLUMN IF NOT EXISTS filter_exhaust_text       TEXT,
  ADD COLUMN IF NOT EXISTS filter_drive_supply_text  TEXT,
  ADD COLUMN IF NOT EXISTS filter_drive_exhaust_text TEXT;

-- Bekreft
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'equipment'
  AND column_name IN ('filter_supply_text', 'filter_exhaust_text', 'filter_drive_supply_text', 'filter_drive_exhaust_text');
