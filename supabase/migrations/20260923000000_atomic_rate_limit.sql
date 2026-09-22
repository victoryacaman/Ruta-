-- Race-safe rate limiting (2026-09-23).
-- The original request-tracking-update/send-whatsapp-alert rate limiter
-- did a SELECT count(*) then, separately, an INSERT -- two concurrent
-- requests for the same shipment/user could both pass the count check
-- before either one's insert lands (classic TOCTOU race). This function
-- makes the check-and-claim a single atomic operation: an advisory
-- transaction lock keyed by the same scope serializes concurrent callers,
-- so the second one to arrive always sees the first one's already-
-- inserted row.
--
-- Returns true if the caller may proceed (and the slot is now claimed --
-- a log row exists), false if still within the cooldown/limit. On a
-- genuine send failure after claiming, the caller may delete its own row
-- (by returned id) as a best-effort compensation so a failed attempt
-- doesn't burn a real cooldown slot -- see request-tracking-update/
-- send-whatsapp-alert.
create or replace function claim_whatsapp_send_slot(
  p_function_name text,
  p_shipment_id uuid,
  p_sent_by uuid,
  p_window_minutes int,
  p_max_count int default 1
) returns table (allowed boolean, claim_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint;
  v_recent_count int;
  v_claim_id bigint;
begin
  v_lock_key := hashtextextended(
    coalesce(p_function_name, '') || ':' || coalesce(p_shipment_id::text, '') || ':' || coalesce(p_sent_by::text, ''),
    0
  );
  -- Held for the rest of this transaction only -- serializes concurrent
  -- calls for the exact same scope without blocking unrelated ones.
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_recent_count
  from whatsapp_send_log
  where function_name = p_function_name
    and (p_shipment_id is null or shipment_id = p_shipment_id)
    and (p_sent_by is null or sent_by = p_sent_by)
    and sent_at >= now() - (p_window_minutes || ' minutes')::interval;

  if v_recent_count >= p_max_count then
    return query select false, null::bigint;
    return;
  end if;

  insert into whatsapp_send_log (function_name, shipment_id, sent_by)
  values (p_function_name, p_shipment_id, p_sent_by)
  returning id into v_claim_id;

  return query select true, v_claim_id;
end;
$$;

revoke all on function claim_whatsapp_send_slot(text, uuid, uuid, int, int) from public, anon, authenticated;
grant execute on function claim_whatsapp_send_slot(text, uuid, uuid, int, int) to service_role;
