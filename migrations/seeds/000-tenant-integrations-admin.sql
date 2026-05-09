-- migrations/seeds/000-tenant-integrations-admin.sql
--
-- Bootstrap-seed for servfix_admin.tenant_integrations.
-- Kjøres én gang per nytt admin-miljø (ikke per tenant-DB).
-- migration 002 kjører dette automatisk via ADMIN_CREATE_SQL;
-- dette seedfilen er for manuell bootstrap av rene miljøer.
--
-- NB: Opprett faktiske tenant-rader via admin-UI (/admin/integrations)
-- etter at tenants er seeded i servfix_admin.tenants-tabellen.

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id              SERIAL PRIMARY KEY,
  tenant_id       VARCHAR NOT NULL,
  provider        VARCHAR NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_version  INTEGER NOT NULL DEFAULT 1,
  last_sync_at    TIMESTAMP,
  sync_status     VARCHAR,
  sync_error      TEXT,
  created_at      TIMESTAMP DEFAULT now(),
  updated_at      TIMESTAMP DEFAULT now(),
  CONSTRAINT uq_tenant_integrations_tenant_provider UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_integrations_lookup
  ON tenant_integrations (tenant_id, provider)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION trg_tenant_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.config IS DISTINCT FROM OLD.config THEN
    NEW.config_version = OLD.config_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'tenant_integrations_updated_at'
      AND event_object_table = 'tenant_integrations'
  ) THEN
    CREATE TRIGGER tenant_integrations_updated_at
      BEFORE UPDATE ON tenant_integrations
      FOR EACH ROW EXECUTE FUNCTION trg_tenant_integrations_updated_at();
  END IF;
END;
$$;
