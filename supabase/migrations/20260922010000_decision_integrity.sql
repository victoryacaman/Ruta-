-- Decision-history integrity (2026-09-22, Part C).
-- risk_snapshots currently gets a new row on EVERY computation, including
-- every page load with nothing new to report -- inflating "how many
-- times has this recommendation appeared" without distinguishing it from
-- "how many distinct recommendation situations occurred", and mixing
-- development/demo activity into what would read as pilot metrics.
--
-- Existing rows are NOT deleted or reclassified as something they
-- weren't -- every new column below has a DEFAULT, so Postgres backfills
-- every pre-existing row with the honest "we don't know" value
-- automatically when the column is added. No data loss, no pretending
-- history is pilot activity it never was.

-- Which kind of activity produced this computation. Classified by the
-- caller (risk-recommendation) from erp_config.provider at compute time:
-- 'demo' when the demo adapter is active, 'pilot' for any real ERP
-- connection attempt (even an unvalidated one), 'unknown' for anything
-- that can't be classified (including every pre-existing row -- the
-- honest default, not a guess). 'development' is available for local/
-- test-harness use but nothing sets it automatically today.
alter table risk_snapshots
  add column if not exists environment text not null default 'unknown'
  check (environment in ('development', 'demo', 'pilot', 'unknown'));

-- Why this computation happened. The dashboard's real call sites are all
-- page loads today, so 'page_load' is both the default AND currently the
-- only value any real caller sends -- 'manual_refresh'/'scheduled' are
-- available for when those trigger points exist; 'test' is for this
-- project's own verification calls, so they never pollute pilot metrics.
alter table risk_snapshots
  add column if not exists computation_source text not null default 'unknown'
  check (computation_source in ('page_load', 'manual_refresh', 'scheduled', 'test', 'unknown'));

-- Deterministic hash over the material recommendation inputs (severity,
-- location, expected delay, ERP provider, and each at-risk SKU's
-- shortfall/transfer amount) -- see risk-recommendation/fingerprint.ts.
-- Two computations with the same fingerprint within a short window are
-- the same underlying situation recomputed, not a new one.
alter table risk_snapshots add column if not exists signal_fingerprint text;
create index if not exists risk_snapshots_fingerprint_idx on risk_snapshots (signal_fingerprint, computed_at desc);

-- How many times this exact signal was recomputed (deduped -- see
-- index.ts) rather than creating a new row each time. Existing rows all
-- represent exactly one real computation each, hence default 1.
alter table risk_snapshots add column if not exists computation_count integer not null default 1;
alter table risk_snapshots add column if not exists last_computed_at timestamptz;
update risk_snapshots set last_computed_at = computed_at where last_computed_at is null;
alter table risk_snapshots alter column last_computed_at set not null;
alter table risk_snapshots alter column last_computed_at set default now();
