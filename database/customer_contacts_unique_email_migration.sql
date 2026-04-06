-- ============================================================
-- Customer Contacts Unique Email Migration
-- Legger til unik constraint på (customer_id, email) i
-- customer_contacts, nødvendig for ON CONFLICT upsert.
--
-- Håndterer duplikater først (beholder nyeste rad per par).
-- Idempotent: trygt å kjøre flere ganger.
-- ============================================================

-- 1. Fjern eventuelle duplikater (behold rad med høyest id per customer_id+email)
DELETE FROM customer_contacts
WHERE id NOT IN (
    SELECT MAX(id)
    FROM customer_contacts
    GROUP BY customer_id, email
);

-- 2. Legg til unik constraint (idempotent via IF NOT EXISTS-tilnærming)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_contacts_customer_id_email_key'
    ) THEN
        ALTER TABLE customer_contacts
            ADD CONSTRAINT customer_contacts_customer_id_email_key
            UNIQUE (customer_id, email);
    END IF;
END;
$$;

-- Bekreft
SELECT conname, contype
FROM pg_constraint
WHERE conname = 'customer_contacts_customer_id_email_key';
