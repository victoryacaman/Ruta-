-- Explicit deny-all policies for the 11 service_role-only tables
-- (2026-09-29).
--
-- PROVENANCE, stated honestly: this migration was already applied
-- directly to the "Utopia Staging" Supabase project (tldbuhwutvmaruaqeywk,
-- remote migration version 20260929205531) before this file existed --
-- it was never committed to this repository and was never applied to
-- production (gcrnarueiybbavmkzhcv). This file was written afterward by
-- reading the live policies back out of Staging's own pg_policies (every
-- one of the 11 tables below carries exactly the one RESTRICTIVE,
-- USING(false)/WITH CHECK(false), ALL-command, {anon,authenticated}
-- policy reproduced here) so the real state is finally captured in git
-- rather than left as undocumented drift. It has NOT been applied to
-- production yet -- that is a separate, explicit decision for the owner,
-- not bundled into this commit.
--
-- WHY: SECURITY_AND_PILOT_BLOCKERS.md item 7 (post-deployment Security
-- Advisor audit, 2026-09-24) flagged these 11 tables as "RLS Enabled No
-- Policy" -- INFO severity, not currently exploitable (anon/authenticated
-- hold broad table-level grants, but neither role has rolbypassrls, so
-- Postgres's RLS default-deny already blocks all their row access with
-- zero policies), but fragile: any future policy added without care
-- would immediately activate those pre-existing broad grants. These
-- RESTRICTIVE policies make the "deny everything to anon/authenticated"
-- intent explicit and durable, rather than relying on the absence of a
-- policy to keep doing the job.
--
-- Every one of these tables is read/written exclusively by Edge
-- Functions running as service_role, which bypasses RLS entirely by
-- Postgres design -- these policies change nothing about how the
-- application behaves today; they only remove the fragility the audit
-- called out.

alter table erp_config enable row level security;
create policy "deny direct client access" on erp_config
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table excel_oauth enable row level security;
create policy "deny direct client access" on excel_oauth
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table oauth_states enable row level security;
create policy "deny direct client access" on oauth_states
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table pilot_authorized_emails enable row level security;
create policy "deny direct client access" on pilot_authorized_emails
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table recommendation_events enable row level security;
create policy "deny direct client access" on recommendation_events
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table risk_location_config enable row level security;
create policy "deny direct client access" on risk_location_config
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table risk_snapshots enable row level security;
create policy "deny direct client access" on risk_snapshots
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table shipments enable row level security;
create policy "deny direct client access" on shipments
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table whatsapp_config enable row level security;
create policy "deny direct client access" on whatsapp_config
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table whatsapp_send_log enable row level security;
create policy "deny direct client access" on whatsapp_send_log
  as restrictive for all to anon, authenticated
  using (false) with check (false);

alter table whatsapp_webhook_events enable row level security;
create policy "deny direct client access" on whatsapp_webhook_events
  as restrictive for all to anon, authenticated
  using (false) with check (false);
