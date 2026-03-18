-- ============================================================
-- SJA Category Migration
-- Legger til category og subcategory på hms_sja-tabellen
-- Idempotent: trygt å kjøre flere ganger (IF NOT EXISTS)
-- ============================================================

ALTER TABLE hms_sja
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- Bekreft resultatet
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hms_sja'
ORDER BY ordinal_position;
