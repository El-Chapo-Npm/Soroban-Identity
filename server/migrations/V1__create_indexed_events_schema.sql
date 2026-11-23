-- Flyway migration for the indexed event store (BE-15).
CREATE TABLE IF NOT EXISTS identities (
  id BIGSERIAL PRIMARY KEY,
  stellar_address VARCHAR(56) NOT NULL UNIQUE,
  did TEXT NOT NULL UNIQUE,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attestations (
  id BIGSERIAL PRIMARY KEY,
  identity_id BIGINT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  attestation_type TEXT NOT NULL,
  issuer VARCHAR(56) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  tx_hash TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identity_id, attestation_type, issuer, tx_hash)
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  ledger BIGINT,
  transaction_hash TEXT,
  contract_id VARCHAR(56),
  identity_id BIGINT REFERENCES identities(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_hash, event_type, ledger)
);

CREATE INDEX IF NOT EXISTS identities_updated_at_idx ON identities (updated_at DESC);
CREATE INDEX IF NOT EXISTS attestations_identity_id_idx ON attestations (identity_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS attestations_issuer_idx ON attestations (issuer, issued_at DESC);
CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_contract_ledger_idx ON events (contract_id, ledger DESC);
CREATE INDEX IF NOT EXISTS events_payload_idx ON events USING GIN (payload);
