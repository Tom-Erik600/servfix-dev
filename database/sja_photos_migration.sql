-- ============================================================
-- SJA Photos Migration
-- Legger til photos-kolonne på hms_sja-tabellen
-- Idempotent: trygt å kjøre flere ganger
-- ============================================================

ALTER TABLE hms_sja
  ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Bekreft
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hms_sja'
  AND column_name = 'photos';
