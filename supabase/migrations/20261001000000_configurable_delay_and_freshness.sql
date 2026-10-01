-- Configurable delay-by-severity assumptions and a workbook-freshness
-- staleness threshold (2026-10-01).
--
-- WHY: risk-recommendation/index.ts has always hardcoded
-- EXPECTED_DELAY_DAYS = { low: 0, medium: 5, high: 10 } -- a disclosed
-- modeling assumption (see UTOPIA_CURRENT_SPEC.md's scoring-engine
-- section), never tuned to any real pilot's actual carrier lead times,
-- and identical across every deployment. There is also currently no
-- concept anywhere of how stale a connected workbook's data is -- a
-- recommendation can be computed from a workbook nobody has touched in
-- weeks with no warning at all. Both become per-deployment config here,
-- defaulting to today's existing hardcoded values so this is a pure
-- behavior-preserving addition until someone deliberately changes them.

alter table risk_location_config
  add column if not exists expected_delay_low_days numeric not null default 0,
  add column if not exists expected_delay_medium_days numeric not null default 5,
  add column if not exists expected_delay_high_days numeric not null default 10,
  add column if not exists freshness_stale_after_days numeric not null default 3;

comment on column risk_location_config.expected_delay_low_days is
  'Expected carrier delay (days) assumed for corridor severity=low. Default matches the prior hardcoded constant; not yet validated against any real carrier.';
comment on column risk_location_config.expected_delay_medium_days is
  'Expected carrier delay (days) assumed for corridor severity=medium. Default matches the prior hardcoded constant; not yet validated against any real carrier.';
comment on column risk_location_config.expected_delay_high_days is
  'Expected carrier delay (days) assumed for corridor severity=high. Default matches the prior hardcoded constant; not yet validated against any real carrier.';
comment on column risk_location_config.freshness_stale_after_days is
  'How many days since a connected workbook''s own last-modified timestamp before its inventory data is flagged stale in a recommendation. Only applies to providers with a real file-modification timestamp (currently: excel).';
