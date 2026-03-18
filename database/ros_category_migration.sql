-- ============================================================
-- ROS Category Migration
-- Legger til category-kolonne på hms_ros for kobling mot SJA
-- Idempotent: trygt å kjøre flere ganger
-- ============================================================

ALTER TABLE hms_ros
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Bekreft
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'hms_ros'
ORDER BY ordinal_position;
