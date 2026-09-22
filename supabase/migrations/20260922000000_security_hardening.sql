-- Security hardening pass (2026-09-22).
-- All new tables follow this project's existing lockdown pattern: RLS
-- enabled, no policies at all -- service_role only, same as
-- gmail_oauth/oracle_config/erp_config/whatsapp_config/excel_oauth.
-- NOT applied automatically by this change -- reviewed here first.

-- 1. Pilot user allowlist. A valid Supabase Auth session is necessary but
--    not sufficient: the authenticated user's email must also appear
--    here. Checked on every request by supabase/functions/_shared/auth.ts.
create table if not exists pilot_authorized_emails (
  email text primary key,
  added_at timestamptz not null default now(),
  added_by text
);
alter table pilot_authorized_emails enable row level security;

-- 2. Microsoft OAuth CSRF + PKCE state, single-use. Replaces the old
--    excel-oauth-start state that was generated and sent to Microsoft but
--    never read back on callback (verified directly against the code --
--    zero protection, not the "basic round-trip check" earlier notes
--    described).
create table if not exists oauth_states (
  state text primary key,
  provider text not null default 'microsoft',
  user_id uuid not null references auth.users(id),
  code_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists oauth_states_expires_idx on oauth_states (expires_at);
alter table oauth_states enable row level security;

-- 3. Meta WhatsApp webhook idempotency. One row per Meta message id, so a
--    retried delivery (Meta retries on anything but a prompt 2xx) is a
--    no-op instead of reprocessing and double-updating a shipment.
create table if not exists whatsapp_webhook_events (
  message_id text primary key,
  shipment_id uuid,
  received_at timestamptz not null default now()
);
alter table whatsapp_webhook_events enable row level security;

-- 4. Outbound WhatsApp send log. Backs both the per-shipment resend
--    cooldown (request-tracking-update) and generic per-user rate
--    limiting (send-whatsapp-alert).
create table if not exists whatsapp_send_log (
  id bigint generated always as identity primary key,
  function_name text not null,
  shipment_id uuid,
  sent_by uuid,
  sent_at timestamptz not null default now()
);
create index if not exists whatsapp_send_log_shipment_idx
  on whatsapp_send_log (function_name, shipment_id, sent_at);
create index if not exists whatsapp_send_log_user_idx
  on whatsapp_send_log (function_name, sent_by, sent_at);
alter table whatsapp_send_log enable row level security;

-- 5. Meta app secret, needed to verify X-Hub-Signature-256 on inbound
--    webhook POSTs -- never collected before this pass. Get it from Meta
--    App Dashboard -> Settings -> Basic -> App Secret; set it directly
--    via the Supabase dashboard once this migration is applied, never
--    through chat.
alter table whatsapp_config add column if not exists meta_app_secret text;
