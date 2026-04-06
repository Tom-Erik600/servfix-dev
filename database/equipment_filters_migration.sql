-- ============================================================
-- Equipment Filters Migration
-- Legger til filter-kolonner på equipment-tabellen
-- Idempotent: trygt å kjøre flere ganger
-- ============================================================

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS has_filters          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filter_supply        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filter_exhaust       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filter_drive_supply  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS filter_drive_exhaust BOOLEAN NOT NULL DEFAULT FALSE;

-- Bekreft
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'equipment'
  AND column_name IN ('has_filters', 'filter_supply', 'filter_exhaust', 'filter_drive_supply', 'filter_drive_exhaust');
