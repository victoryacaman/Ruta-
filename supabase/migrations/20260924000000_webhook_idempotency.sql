-- Webhook idempotency, made honest (2026-09-24).
--
-- The original whatsapp_webhook_events table (message_id primary key,
-- shipment_id, received_at -- see 20260922000000_security_hardening.sql)
-- only ever recorded "have we seen this message_id," never "did we
-- finish processing it." whatsapp-webhook/index.ts inserted that row
-- BEFORE the shipment-matching/update logic ran, then treated any later
-- delivery of the same message_id as "already handled, skip" -- with no
-- column anywhere distinguishing "recorded" from "recorded and actually
-- processed." Combined with the function always acking 200 regardless of
-- outcome, a genuine failure in the shipment update (a real Postgres
-- error, silently discarded since the update's own {error} was never
-- checked) was permanently and silently unrecoverable: Meta was never
-- told to retry, and even if it had retried anyway, the existing row
-- would have caused the retry to be skipped before the update logic ever
-- ran again.
--
-- This migration adds real processing-state tracking and an atomic
-- claim mechanism (mirroring claim_whatsapp_send_slot's own
-- pg_advisory_xact_lock idiom from 20260923000000_atomic_rate_limit.sql)
-- so a message_id alone never implies successful completion, concurrent
-- deliveries of the same message can't both process it, and a delivery
-- that failed or was abandoned mid-processing can be safely retried.

alter table whatsapp_webhook_events
  add column if not exists status text not null default 'legacy_unverified',
  add column if not exists claimed_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists attempt_count int not null default 1,
  add column if not exists last_error_category text,
  add column if not exists updated_at timestamptz not null default now();

-- No separate "received" state: this function is synchronous end-to-end
-- (no queue, no background worker), so "received" and "processing" are
-- the same instant -- a row only ever exists once processing has
-- started. 'legacy_unverified' exists purely for any row that predates
-- this migration (none do in this project today, since the base table
-- itself was never applied to the live database before this migration
-- was written -- but this is written defensively, the same way the
-- decision-integrity migration backfilled unknown environments rather
-- than assuming): it is deliberately NOT 'completed', since whether a
-- pre-existing row's shipment update actually succeeded can't be
-- verified after the fact.
alter table whatsapp_webhook_events
  drop constraint if exists whatsapp_webhook_events_status_check;
alter table whatsapp_webhook_events
  add constraint whatsapp_webhook_events_status_check
  check (status in ('processing', 'completed', 'failed', 'gave_up', 'legacy_unverified'));

comment on column whatsapp_webhook_events.status is
  'processing = claimed, work not yet finished; completed = shipment update (or a confirmed no-match) finished successfully; failed = the update threw, safe to retry; gave_up = exceeded max_attempts, stopped retrying to avoid a storm; legacy_unverified = pre-existing row from before this column existed, success unverifiable.';
comment on column whatsapp_webhook_events.last_error_category is
  'A short, safe category string only (e.g. "db_error", "unknown_error") -- never a raw error message, stack trace, or any WhatsApp message content.';

-- Atomic claim: the only place this table's write path should be
-- driven from. Advisory-locks on a hash of the message_id so two
-- concurrent deliveries of the SAME message can never both receive
-- 'proceed' -- exactly the same technique claim_whatsapp_send_slot
-- already uses for the same class of problem (see that migration for
-- the fuller explanation of why an advisory transaction lock, not a
-- plain check-then-insert, is required here).
create or replace function claim_webhook_event(
  p_message_id text,
  p_stale_after_minutes int default 5,
  p_max_attempts int default 5
) returns table (action text, attempt_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_row whatsapp_webhook_events;
begin
  v_lock_key := hashtextextended('whatsapp_webhook_events:' || p_message_id, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select * into v_row from whatsapp_webhook_events where message_id = p_message_id for update;

  if v_row.message_id is null then
    insert into whatsapp_webhook_events (message_id, status, attempt_count, claimed_at, updated_at)
    values (p_message_id, 'processing', 1, now(), now())
    returning * into v_row;
    return query select 'proceed'::text, v_row.attempt_count;
    return;
  end if;

  if v_row.status = 'completed' then
    return query select 'duplicate_completed'::text, v_row.attempt_count;
    return;
  end if;

  if v_row.status = 'gave_up' then
    -- Already stopped retrying this one on purpose -- ack without
    -- reprocessing, same HTTP outcome as duplicate_completed but kept
    -- as its own action so callers/tests can tell the two apart.
    return query select 'duplicate_gave_up'::text, v_row.attempt_count;
    return;
  end if;

  if v_row.status = 'processing' and v_row.updated_at > now() - (p_stale_after_minutes || ' minutes')::interval then
    -- Someone else (or this same message, moments ago) is actively
    -- working on it and hasn't gone stale yet -- don't double-process.
    return query select 'duplicate_in_progress'::text, v_row.attempt_count;
    return;
  end if;

  -- Reachable only for: status in ('failed','legacy_unverified'), or a
  -- 'processing' row old enough to be considered abandoned (a crash/
  -- timeout/deploy-restart between claiming and finishing). Both are
  -- legitimately retryable.
  if v_row.attempt_count >= p_max_attempts then
    update whatsapp_webhook_events
    set status = 'gave_up', updated_at = now()
    where message_id = p_message_id;
    return query select 'gave_up'::text, v_row.attempt_count;
    return;
  end if;

  update whatsapp_webhook_events
  set status = 'processing', attempt_count = v_row.attempt_count + 1, claimed_at = now(), updated_at = now()
  where message_id = p_message_id
  returning * into v_row;

  return query select 'proceed'::text, v_row.attempt_count;
end;
$$;

create or replace function complete_webhook_event(
  p_message_id text,
  p_shipment_id uuid default null
) returns void
language sql
security definer
set search_path = public
as $$
  update whatsapp_webhook_events
  set status = 'completed', processed_at = now(), updated_at = now(), shipment_id = coalesce(p_shipment_id, shipment_id)
  where message_id = p_message_id;
$$;

create or replace function fail_webhook_event(
  p_message_id text,
  p_error_category text
) returns void
language sql
security definer
set search_path = public
as $$
  update whatsapp_webhook_events
  set status = 'failed', updated_at = now(), last_error_category = p_error_category
  where message_id = p_message_id;
$$;

revoke all on function claim_webhook_event(text, int, int) from public, anon, authenticated;
grant execute on function claim_webhook_event(text, int, int) to service_role;
revoke all on function complete_webhook_event(text, uuid) from public, anon, authenticated;
grant execute on function complete_webhook_event(text, uuid) to service_role;
revoke all on function fail_webhook_event(text, text) from public, anon, authenticated;
grant execute on function fail_webhook_event(text, text) to service_role;
