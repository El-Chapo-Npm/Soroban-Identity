-- Migration 002: Contract events and indexer cursors
-- Stores Horizon contract events and persists paging cursors per contract.
-- Idempotent: uses IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS contract_events (
    event_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    ledger BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    topic JSONB NOT NULL DEFAULT '[]'::jsonb,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_events_contract_id
    ON contract_events (contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_events_ledger
    ON contract_events (ledger);

CREATE INDEX IF NOT EXISTS idx_contract_events_observed_at
    ON contract_events (observed_at);

CREATE TABLE IF NOT EXISTS indexer_cursors (
    contract_id TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);