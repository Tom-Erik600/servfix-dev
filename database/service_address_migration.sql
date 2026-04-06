-- ============================================================
-- Service Address Migration
-- Legger til serviceadresse-kolonner på orders-tabellen
-- Idempotent: trygt å kjøre flere ganger
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS service_address_street VARCHAR(255),
  ADD COLUMN IF NOT EXISTS service_address_postal_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS service_address_city VARCHAR(100);

-- Bekreft
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('service_address_street', 'service_address_postal_code', 'service_address_city');
