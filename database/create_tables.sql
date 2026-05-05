-- =============================================================================
-- create_tables.sql
-- Idempotent baseline schema for airtech_db
-- Generated from live dev database snapshot (2026-05-04)
-- Safe to run on existing databases: uses IF NOT EXISTS and existence checks
-- Does NOT drop, truncate, or alter existing data
-- =============================================================================

-- =============================================================================
-- Sequences
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS checklist_instructions_id_seq;
CREATE SEQUENCE IF NOT EXISTS checklist_templates_id_seq;
CREATE SEQUENCE IF NOT EXISTS customer_contacts_id_seq;
CREATE SEQUENCE IF NOT EXISTS customers_id_seq;
CREATE SEQUENCE IF NOT EXISTS equipment_id_seq;
CREATE SEQUENCE IF NOT EXISTS equipment_clusters_id_seq;
CREATE SEQUENCE IF NOT EXISTS hms_ros_id_seq;
CREATE SEQUENCE IF NOT EXISTS hms_sja_id_seq;
CREATE SEQUENCE IF NOT EXISTS tenant_integrations_id_seq;

-- -----------------------------------------------------------------------------
-- avvik_images: Images attached to avvik (deviations) on service reports
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avvik_images (
    id VARCHAR(255) DEFAULT (gen_random_uuid())::text NOT NULL,
    service_report_id VARCHAR(255),
    avvik_number INTEGER NOT NULL,
    checklist_item_id VARCHAR(255),
    image_url TEXT NOT NULL,
    image_type VARCHAR(50) DEFAULT 'avvik'::character varying,
    description TEXT,
    metadata JSONB,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    uploaded_by VARCHAR(255),
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- checklist_instructions: Instructions for individual checklist items per template
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_instructions (
    id INTEGER DEFAULT nextval('checklist_instructions_id_seq'::regclass) NOT NULL,
    checklist_item_id VARCHAR(255) NOT NULL,
    template_name VARCHAR(255) NOT NULL,
    instruction_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT checklist_instructions_checklist_item_id_template_name_key UNIQUE (checklist_item_id, template_name)
);

-- -----------------------------------------------------------------------------
-- checklist_templates: Checklist templates used in service reports
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_templates (
    id INTEGER DEFAULT nextval('checklist_templates_id_seq'::regclass) NOT NULL,
    name VARCHAR(255) NOT NULL,
    equipment_type VARCHAR(255),
    template_data JSONB,
    PRIMARY KEY (id),
    CONSTRAINT checklist_templates_name_key UNIQUE (name)
);

-- -----------------------------------------------------------------------------
-- customer_contacts: Contact persons associated with customers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_contacts (
    id INTEGER DEFAULT nextval('customer_contacts_id_seq'::regclass) NOT NULL,
    customer_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    role VARCHAR(100),
    is_report_recipient BOOLEAN DEFAULT false,
    notes TEXT,
    is_primary BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT customer_contacts_customer_id_email_key UNIQUE (customer_id, email)
);

-- -----------------------------------------------------------------------------
-- customers: Customer accounts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER DEFAULT nextval('customers_id_seq'::regclass) NOT NULL,
    name VARCHAR(255) NOT NULL,
    organization_number VARCHAR(20),
    customer_number VARCHAR(50),
    physical_address TEXT,
    postal_address TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    invoice_email VARCHAR(255),
    external_source VARCHAR(50),
    external_id VARCHAR(100),
    last_synced_at TIMESTAMP,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- equipment: Equipment/systems registered per customer
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER DEFAULT nextval('equipment_id_seq'::regclass) NOT NULL,
    customer_id INTEGER NOT NULL,
    systemtype VARCHAR(100) NOT NULL,
    systemnummer VARCHAR(100) NOT NULL,
    systemnavn VARCHAR(255) NOT NULL,
    plassering TEXT NOT NULL,
    betjener TEXT,
    location TEXT,
    status VARCHAR(20) DEFAULT 'active'::character varying,
    notater TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    local_customer_id INTEGER,
    cluster_id INTEGER,
    has_filters BOOLEAN DEFAULT false NOT NULL,
    filter_supply BOOLEAN DEFAULT false NOT NULL,
    filter_exhaust BOOLEAN DEFAULT false NOT NULL,
    filter_drive_supply BOOLEAN DEFAULT false NOT NULL,
    filter_drive_exhaust BOOLEAN DEFAULT false NOT NULL,
    filter_supply_text TEXT,
    filter_exhaust_text TEXT,
    filter_drive_supply_text TEXT,
    filter_drive_exhaust_text TEXT,
    PRIMARY KEY (id),
    CONSTRAINT unique_systemnummer_per_customer UNIQUE (customer_id, systemnummer)
);

-- -----------------------------------------------------------------------------
-- equipment_clusters: Logical groupings of equipment per customer
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipment_clusters (
    id INTEGER DEFAULT nextval('equipment_clusters_id_seq'::regclass) NOT NULL,
    customer_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    notes TEXT,
    tripletex_project_id INTEGER,
    tripletex_project_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT equipment_clusters_customer_id_name_key UNIQUE (customer_id, name)
);

-- -----------------------------------------------------------------------------
-- hms_ros: HMS Risk and Opportunity assessments (ROS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hms_ros (
    id INTEGER DEFAULT nextval('hms_ros_id_seq'::regclass) NOT NULL,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    title TEXT NOT NULL,
    project_type TEXT,
    form_data JSONB DEFAULT '{}'::jsonb NOT NULL,
    status VARCHAR(20) DEFAULT 'draft'::character varying,
    pdf_url TEXT,
    version INTEGER DEFAULT 1,
    category TEXT,
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- hms_sja: HMS Safe Job Analysis (SJA) records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hms_sja (
    id INTEGER DEFAULT nextval('hms_sja_id_seq'::regclass) NOT NULL,
    order_id VARCHAR(50),
    technician_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT now(),
    job_description TEXT NOT NULL,
    location TEXT,
    identified_risks TEXT,
    safety_measures TEXT,
    approved_by VARCHAR(100),
    signature_data TEXT,
    status VARCHAR(20) DEFAULT 'draft'::character varying,
    pdf_url TEXT,
    category TEXT,
    subcategory TEXT,
    photos TEXT[] DEFAULT ARRAY[]::text[],
    ros_id INTEGER,
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- orders: Work orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(50) NOT NULL,
    tripletex_order_id INTEGER,
    customer_name VARCHAR(255),
    customer_data JSONB,
    description TEXT,
    service_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'scheduled'::character varying,
    technician_id VARCHAR(50),
    scheduled_date DATE,
    scheduled_time TIME WITHOUT TIME ZONE,
    created_at TIMESTAMP DEFAULT now(),
    customer_id INTEGER,
    included_equipment_ids JSONB,
    local_customer_id INTEGER,
    pdf_path TEXT,
    pdf_generated BOOLEAN DEFAULT false,
    sent_til_fakturering BOOLEAN DEFAULT false,
    pdf_sent_timestamp TIMESTAMP,
    is_invoiced BOOLEAN DEFAULT false,
    invoice_number VARCHAR(100),
    invoice_date DATE,
    invoice_comment TEXT,
    service_address_street VARCHAR(255),
    service_address_postal_code VARCHAR(20),
    service_address_city VARCHAR(100),
    PRIMARY KEY (id),
    CONSTRAINT orders_tripletex_order_id_key UNIQUE (tripletex_order_id)
);

-- -----------------------------------------------------------------------------
-- quotes: Quotes/offers sent to customers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotes (
    id VARCHAR(50) NOT NULL,
    order_id VARCHAR(50),
    items JSONB NOT NULL,
    total_amount NUMERIC(10,2),
    status VARCHAR(50) DEFAULT 'draft'::character varying,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now(),
    pdf_path VARCHAR(500),
    sent_to_customer BOOLEAN DEFAULT false,
    sent_date TIMESTAMP,
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- service_reports: Service reports created by technicians
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_reports (
    id VARCHAR(255) NOT NULL,
    order_id VARCHAR(50),
    equipment_id INTEGER,
    checklist_data JSONB NOT NULL,
    products_used JSONB,
    additional_work JSONB,
    status VARCHAR(50) DEFAULT 'draft'::character varying,
    signature_data JSONB,
    photos TEXT[],
    created_at TIMESTAMP DEFAULT now(),
    completed_at TIMESTAMP,
    sent_til_fakturering BOOLEAN DEFAULT false,
    avvik_counter INTEGER DEFAULT 0,
    pdf_path VARCHAR(500),
    pdf_generated BOOLEAN DEFAULT false,
    is_invoiced BOOLEAN DEFAULT false,
    invoice_comment TEXT,
    invoice_date TIMESTAMP,
    pdf_sent_timestamp TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invoice_number VARCHAR(50),
    PRIMARY KEY (id)
);

-- -----------------------------------------------------------------------------
-- session: User sessions (connect-pg-simple)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL,
    sess JSON NOT NULL,
    expire TIMESTAMP NOT NULL,
    PRIMARY KEY (sid)
);

-- -----------------------------------------------------------------------------
-- technicians: Technician/user accounts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technicians (
    id VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    initials VARCHAR(10) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT now(),
    stilling VARCHAR(100),
    PRIMARY KEY (id),
    CONSTRAINT technicians_initials_key UNIQUE (initials)
);

-- -----------------------------------------------------------------------------
-- tenant_integrations: Third-party integrations per tenant
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_integrations (
    id INTEGER DEFAULT nextval('tenant_integrations_id_seq'::regclass) NOT NULL,
    tenant_id VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}'::jsonb NOT NULL,
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50),
    sync_error TEXT,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (id)
);

-- =============================================================================
-- Foreign Key Constraints
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'avvik_images_service_report_id_fkey' AND table_name = 'avvik_images') THEN
    ALTER TABLE avvik_images ADD CONSTRAINT avvik_images_service_report_id_fkey
      FOREIGN KEY (service_report_id) REFERENCES service_reports (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'avvik_images_uploaded_by_fkey' AND table_name = 'avvik_images') THEN
    ALTER TABLE avvik_images ADD CONSTRAINT avvik_images_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES technicians (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'customer_contacts_customer_id_fkey' AND table_name = 'customer_contacts') THEN
    ALTER TABLE customer_contacts ADD CONSTRAINT customer_contacts_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'equipment_cluster_id_fkey' AND table_name = 'equipment') THEN
    ALTER TABLE equipment ADD CONSTRAINT equipment_cluster_id_fkey
      FOREIGN KEY (cluster_id) REFERENCES equipment_clusters (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'equipment_local_customer_id_fkey' AND table_name = 'equipment') THEN
    ALTER TABLE equipment ADD CONSTRAINT equipment_local_customer_id_fkey
      FOREIGN KEY (local_customer_id) REFERENCES customers (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'equipment_clusters_customer_id_fkey' AND table_name = 'equipment_clusters') THEN
    ALTER TABLE equipment_clusters ADD CONSTRAINT equipment_clusters_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'hms_sja_order_id_fkey' AND table_name = 'hms_sja') THEN
    ALTER TABLE hms_sja ADD CONSTRAINT hms_sja_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'hms_sja_ros_id_fkey' AND table_name = 'hms_sja') THEN
    ALTER TABLE hms_sja ADD CONSTRAINT hms_sja_ros_id_fkey
      FOREIGN KEY (ros_id) REFERENCES hms_ros (id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'orders_local_customer_id_fkey' AND table_name = 'orders') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_local_customer_id_fkey
      FOREIGN KEY (local_customer_id) REFERENCES customers (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'orders_technician_id_fkey' AND table_name = 'orders') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_technician_id_fkey
      FOREIGN KEY (technician_id) REFERENCES technicians (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'quotes_order_id_fkey' AND table_name = 'quotes') THEN
    ALTER TABLE quotes ADD CONSTRAINT quotes_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_equipment' AND table_name = 'service_reports') THEN
    ALTER TABLE service_reports ADD CONSTRAINT fk_equipment
      FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'service_reports_order_id_fkey' AND table_name = 'service_reports') THEN
    ALTER TABLE service_reports ADD CONSTRAINT service_reports_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders (id);
  END IF;
END $$;

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_avvik_images_avvik_number ON avvik_images USING btree (service_report_id, avvik_number);
CREATE INDEX IF NOT EXISTS idx_avvik_images_report_id ON avvik_images USING btree (service_report_id);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_instructions_checklist_item_id_template_name_key ON checklist_instructions USING btree (checklist_item_id, template_name);
CREATE INDEX IF NOT EXISTS idx_instructions_item_template ON checklist_instructions USING btree (checklist_item_id, template_name);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_templates_name_key ON checklist_templates USING btree (name);
CREATE UNIQUE INDEX IF NOT EXISTS customer_contacts_customer_id_email_key ON customer_contacts USING btree (customer_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON customer_contacts USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_contacts_report ON customer_contacts USING btree (customer_id, is_report_recipient) WHERE (is_report_recipient = true);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_customers_external ON customers USING btree (external_source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_external_unique ON customers USING btree (external_source, external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers USING btree (name);
CREATE INDEX IF NOT EXISTS idx_equipment_cluster ON equipment USING btree (cluster_id);
CREATE INDEX IF NOT EXISTS idx_equipment_customer_id ON equipment USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_equipment_local_customer ON equipment USING btree (local_customer_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment USING btree (status);
CREATE INDEX IF NOT EXISTS idx_equipment_systemnummer ON equipment USING btree (systemnummer);
CREATE INDEX IF NOT EXISTS idx_equipment_systemtype ON equipment USING btree (systemtype);
CREATE UNIQUE INDEX IF NOT EXISTS unique_systemnummer_per_customer ON equipment USING btree (customer_id, systemnummer);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_clusters_customer_id_name_key ON equipment_clusters USING btree (customer_id, name);
CREATE INDEX IF NOT EXISTS idx_clusters_customer ON equipment_clusters USING btree (customer_id);
CREATE INDEX IF NOT EXISTS idx_hms_ros_status ON hms_ros USING btree (status);
CREATE INDEX IF NOT EXISTS idx_hms_sja_order_id ON hms_sja USING btree (order_id);
CREATE INDEX IF NOT EXISTS idx_hms_sja_technician_id ON hms_sja USING btree (technician_id);
CREATE INDEX IF NOT EXISTS idx_orders_local_customer ON orders USING btree (local_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_tripletex_order_id_key ON orders USING btree (tripletex_order_id);
CREATE INDEX IF NOT EXISTS idx_service_reports_invoice_number ON service_reports USING btree (invoice_number);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session USING btree (expire);
CREATE UNIQUE INDEX IF NOT EXISTS technicians_initials_key ON technicians USING btree (initials);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_tenant_provider ON tenant_integrations USING btree (tenant_id, provider);

-- =============================================================================
-- Views
-- =============================================================================

-- View: active_equipment
CREATE OR REPLACE VIEW active_equipment AS
SELECT equipment.id,
    equipment.customer_id,
    equipment.systemtype,
    equipment.systemnummer,
    equipment.systemnavn,
    equipment.plassering,
    equipment.betjener,
    equipment.location,
    equipment.status,
    equipment.notater,
    equipment.created_at,
    equipment.updated_at
   FROM equipment
  WHERE ((equipment.status)::text = 'active'::text);

-- View: avvik_images_formatted
CREATE OR REPLACE VIEW avvik_images_formatted AS
SELECT ai.id,
    ai.service_report_id,
    ai.avvik_number,
    ai.checklist_item_id,
    ai.image_url,
    ai.image_type,
    ai.description,
    ai.metadata,
    ai.uploaded_at,
    ai.uploaded_by,
    format_avvik_number(ai.avvik_number) AS formatted_avvik_number,
    sr.order_id,
    sr.equipment_id
   FROM (avvik_images ai
     JOIN service_reports sr ON (((ai.service_report_id)::text = (sr.id)::text)));

