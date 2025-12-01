-- Teknikere (lokal auth - ikke Tripletex)
CREATE TABLE technicians (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    initials VARCHAR(10) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Ordrer (synkes fra Tripletex)
CREATE TABLE orders (
    id VARCHAR(50) PRIMARY KEY,
    tripletex_order_id INTEGER UNIQUE,
    customer_name VARCHAR(255),
    customer_data JSONB, -- All Tripletex kunde-info
    description TEXT,
    service_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'scheduled',
    technician_id VARCHAR(50) REFERENCES technicians(id),
    scheduled_date DATE,
    scheduled_time TIME,
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Utstyr
CREATE TABLE equipment (
    id VARCHAR(50) PRIMARY KEY,
    tripletex_customer_id INTEGER,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100),
    location VARCHAR(255),
    serial_number VARCHAR(100),
    data JSONB, -- Fleksibelt for ekstra felter
    created_at TIMESTAMP DEFAULT NOW()
);

-- Servicerapporter (hoveddataene)
CREATE TABLE service_reports (
    id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES orders(id),
    equipment_id VARCHAR(50) REFERENCES equipment(id),
    
    -- Dynamisk innhold som JSONB
    checklist_data JSONB NOT NULL,
    products_used JSONB,
    additional_work JSONB,
    
    -- Metadata
    status VARCHAR(50) DEFAULT 'draft',
    signature_data JSONB,
    photos TEXT[], -- Array av fil-URLer
    
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    sent_to_tripletex BOOLEAN DEFAULT false
);

-- Tilbud
CREATE TABLE quotes (
    id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) REFERENCES orders(id),
    items JSONB NOT NULL,
    total_amount DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'draft',
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sjekkliste-maler (admin-definerte)
CREATE TABLE checklist_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    equipment_type VARCHAR(100),
    template_data JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
    sid VARCHAR PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMP NOT NULL
);

-- Indexes for ytelse
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_date ON orders(scheduled_date);
CREATE INDEX idx_reports_order ON service_reports(order_id);
CREATE INDEX idx_equipment_customer ON equipment(tripletex_customer_id);