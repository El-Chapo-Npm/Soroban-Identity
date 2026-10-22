-- TimescaleDB schema for metrics (issue #1112)
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS metrics (
  time   TIMESTAMPTZ      NOT NULL,
  metric TEXT             NOT NULL,
  value  DOUBLE PRECISION NOT NULL,
  tags   JSONB            NOT NULL DEFAULT '{}'::jsonb
);

SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS metrics_metric_time_idx ON metrics (metric, time DESC);
CREATE INDEX IF NOT EXISTS metrics_tags_idx ON metrics USING GIN (tags);

-- Compression for chunks older than 2 days
ALTER TABLE metrics SET (timescaledb.compress, timescaledb.compress_segmentby = 'metric');
SELECT add_compression_policy('metrics', INTERVAL '2 days', if_not_exists => TRUE);

-- Continuous aggregates (downsampling)
CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', time) AS bucket, metric, tags,
       count(*) AS count, sum(value) AS sum, min(value) AS min, max(value) AS max, avg(value) AS avg
  FROM metrics GROUP BY bucket, metric, tags
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS metrics_1h
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket, metric, tags,
       count(*) AS count, sum(value) AS sum, min(value) AS min, max(value) AS max, avg(value) AS avg
  FROM metrics GROUP BY bucket, metric, tags
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1m',
  start_offset => INTERVAL '1 hour', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);
SELECT add_continuous_aggregate_policy('metrics_1h',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);

-- Retention policies
SELECT add_retention_policy('metrics',    INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_retention_policy('metrics_1m', INTERVAL '30 days', if_not_exists => TRUE);
SELECT add_retention_policy('metrics_1h', INTERVAL '365 days', if_not_exists => TRUE);
