# Utopia — Security Status & Pilot Blockers

Verified directly against all 19 deployed Edge Functions, the dashboard's
client-side code, and the database schema (column names/types only — no
row data was read while compiling this document). This is the honest
current state, not a plan or a set of intentions.

**Status update (2026-09-23, second pass same day): the security-hardening
pass is complete in committed code — every gap this document originally
found has a written fix. Nothing has been deployed or applied to the live
Supabase project.** One part of this *is* already live, though, and the
rest of this document is corrected accordingly: the dashboard's frontend
(`index.html`, `ruta-dashboard-fixed.html`) was already pushed to `main`
in an earlier commit this same day, and GitHub Pages auto-publishes on
push — confirmed by fetching the live hosted URLs directly, not assumed.
**The live, hosted dashboard already presents a real magic-link sign-in
and already sends a real bearer session token on every call.** What is
**not** live is the backend half: none of the 19 deployed Edge Functions
check that token or the `pilot_authorized_emails` allowlist yet, so the
token the dashboard already sends is currently a no-op server-side. See
[`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) for the full file
list, required migrations/secrets, and the ordered release sequence that
closes this gap — `BUILD_LOG.md`'s entries record how each fix was built
and verified, not how to deploy it.

## Edge Function inventory (19 deployed, reconciled)

Two counts have appeared in this document and elsewhere: **19 deployed**
and **17 audited/local**. These were never actually in conflict — they
describe two different sets, and no prior version of this document said
so explicitly:

- **17 functions** have local, git-tracked source under
  `supabase/functions/` in this repository, and were each audited against
  that source (rows 1–17 below).
- **2 functions** are deployed to the live project with **no local
  directory and no git history at all** — `storm-signal` and
  `excel-debug` (rows 18–19 below). They were never missing from "the
  live system," only from "this repository."

17 + 2 = 19, matching `list_edge_functions` exactly. Nothing is
unaccounted for.

| # | Function | Local? | Deployed? | Intended caller | Auth model | Reads customer/personal data? | External side effects? | Repository status | Production status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `decisions-list` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real decision history | No (pure read) | Implemented in repository, tested locally | Deployed (pre-hardening code); auth gating awaiting deployment |
| 2 | `erp-inventory` | Yes | Yes | Dashboard + internal call from `risk-recommendation` (forwards caller's own token) | Supabase authenticated user | Yes — real inventory figures | Yes — calls external ERP APIs; writes refreshed `excel_oauth` token | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 3 | `excel-browse` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real OneDrive file/table names | Yes — calls Microsoft Graph; may write refreshed token | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 4 | `excel-oauth-callback` | Yes | Yes | Microsoft's OAuth redirect (browser navigation — cannot carry a bearer token) | Microsoft OAuth state+PKCE | Yes — reads/stores real connected email | Yes — calls Microsoft's token endpoint + Graph `/me`; writes `oauth_states.used_at`, `excel_oauth`, `erp_config.provider` | Implemented in repository, tested locally (PKCE vs. RFC 7636's own vector) | Deployed (pre-hardening: no state check at all); awaiting deployment |
| 5 | `excel-oauth-start` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | No — only a non-secret `client_id` | Yes — writes a new `oauth_states` row | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 6 | `excel-select-workbook` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real OneDrive file/table names | Yes — calls Microsoft Graph; writes `erp_config`, may write `excel_oauth` | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 7 | `excel-status` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real connected account email | No (pure read) | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 8 | `recommendation-action` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — writes real decision events | Yes — writes a `recommendation_events` row | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 9 | `request-tracking-update` | Yes | Yes | Dashboard (`authedFetch`), manual-button only | Supabase authenticated user | Yes — real driver name/phone | Yes — sends a real WhatsApp message; writes `whatsapp_send_log`, updates `shipments` | Implemented in repository, tested locally (`rateLimit_test.ts`) | Deployed (pre-hardening: no auth, no rate limit); awaiting deployment |
| 10 | `risk-location-settings` | Yes | Yes | Dashboard (`authedFetch`, GET+POST) | Supabase authenticated user | No — generic operating configuration | Yes on POST — writes `risk_location_config` | Implemented in repository (no dedicated unit test for the validation fix) | Deployed (pre-hardening code); awaiting deployment |
| 11 | `risk-recommendation` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — combines weather with real ERP data | Yes — calls Open-Meteo + internal `storm-signal`/`erp-inventory`; writes/upserts `risk_snapshots` | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 12 | `send-whatsapp-alert` | Yes | Yes | No dashboard call site — manual/admin only | Supabase authenticated user | Yes — real or caller-supplied phone number | Yes — sends a real WhatsApp message; writes `whatsapp_send_log` | Implemented in repository, tested locally (`rateLimit_test.ts`, 10/hour/user) | Deployed (pre-hardening: open to any caller/recipient); awaiting deployment — **flag for manual review**: no UI caller exists, confirm still needed |
| 13 | `shipments-create` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real driver PII | Yes — writes a `shipments` row | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 14 | `shipments-list` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real driver PII | No (pure read) | Implemented in repository, tested locally | Deployed (pre-hardening code); awaiting deployment |
| 15 | `whatsapp-setup-tracking-template` | Yes | Yes | No dashboard call site — one-time admin setup | Supabase authenticated user | No — template definition only | Yes — calls Meta's Business Management API to create/check the template | Implemented in repository | Deployed (pre-hardening code); awaiting deployment — **flag for manual review**: template already approved and in use, confirm whether this needs to stay deployed |
| 16 | `whatsapp-webhook` | Yes | Yes | Meta's webhook system (server-to-server — cannot carry a bearer token) | Meta signature (`X-Hub-Signature-256`, verified before parsing; GET handshake via `hub.verify_token`) | Yes — real inbound driver phone/message | Yes — atomically claims/updates `whatsapp_webhook_events` (real processing/completed/failed/gave-up state, not just existence), updates `shipments` on success only | Implemented in repository, tested locally (`crypto_test.ts`, `webhook_idempotency_test.ts`) | **Deployed (pre-hardening: no POST signature check at all, and the old idempotency table can silently lose a failed retry — see "Webhook idempotency" above); awaiting deployment, highest priority** |
| 17 | `whatsapp-webhook-subscription` | Yes | Yes | No dashboard call site — admin diagnostic/fix | Supabase authenticated user | No — WABA subscription status only | Yes — POST changes the live WABA's webhook subscription | Implemented in repository | Deployed (pre-hardening code); awaiting deployment — **flag for manual review**: admin diagnostic tool, confirm still needed |
| 18 | `storm-signal` | **No — no local directory, no git history** | Yes (v2) | Internal call from `risk-recommendation`; public weather relay | Intentionally public — identical, non-customer-specific data for every caller, by design | No | No (read-only relay of NOAA/NHC data) | **Not in repository** | Deployed and in active use. **Flag, do not remove:** its own source comments reference sibling functions (`gmail-summary`, `patrol-summary`, `attendance-feed`) that don't exist anywhere in this project — evidence it was copied from an unrelated project at deploy time. Recommend a future, separate task to back-fill its real source into this repo; not touched in this pass |
| 19 | `excel-debug` | **No — no local directory, no git history** | Yes (v3) | None — fully disabled | Disabled/deprecated (`Deno.serve(() => new Response("disabled", {status:410}))`, unconditionally) | No | No | **Not in repository** | Deployed but inert (HTTP 410 for every request). **Flagged for manual removal** — a one-off OneDrive-path diagnostic from the 2026-09-01 Excel setup; its own code comment already says it's safe to delete via the Supabase dashboard. Not deleted here — deleting a deployed function is a deployment action, out of scope for a documentation pass |

## Authentication status

**The currently-deployed production build presents a real magic-link
sign-in screen, but none of the 19 live Edge Functions enforce it yet.**
Real backend-enforced authentication (Supabase Auth checked against a
`pilot_authorized_emails` allowlist, by every protected function) is
**implemented in repository** and **tested locally**, but is **still open
in production** — no migration, secret, or function redeploy for it has
reached the live Supabase project. Concretely, today:

- `index.html` and `ruta-dashboard-fixed.html` are already deployed with
  real Supabase Auth: a genuine email magic-link sign-in, and an
  `authedFetch()` wrapper that attaches a real bearer session token to
  every protected call. **Verified in production** — confirmed directly
  against the live GitHub Pages URLs (`authedFetch`/`getSession` present,
  no `sessionStorage`/`ruta_authed` gate remaining).
- That real session token is currently a no-op from the backend's point
  of view: every one of the 19 deployed Edge Functions still runs
  pre-hardening code that neither checks the platform-level JWT
  (`verify_jwt: false` on all 19) nor calls `requireAuthorizedUser`.
  Anyone who calls a function's URL directly — no session, no token,
  bypassing the dashboard UI entirely — gets exactly the same response as
  someone who just signed in through the real magic-link flow.
- This is not a documented tradeoff the way the old shared-password gate
  was (see `BUILD_LOG.md`'s earlier entries for that history) — it is a
  mid-migration state: the frontend cutover already landed (pushed to
  `main`, auto-published by GitHub Pages) before the backend redeploy
  that would make it actually enforce anything. See
  [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) for exactly what
  closes this gap, and in what order — seeding `pilot_authorized_emails`
  with the owner's own email *before* any gated function is redeployed is
  the one step that must not be skipped or reordered, to avoid the owner
  locking themselves out.

## Public endpoint exposure

Every one of the 19 Edge Functions is reachable by anyone who has (or
guesses, or finds via the dashboard's own client-side source) its URL, with
**no caller-side secret, signature, or token check of any kind**, except
the one narrow case noted under "Meta webhook signature validation" below.
Grouped by what that actually means in practice. **All of it below is
now closed in committed, undeployed code**: `requireAuthorizedUser` (real
Supabase Auth session + `pilot_authorized_emails` allowlist check) now
gates every function named below except `excel-oauth-callback` and
`whatsapp-webhook`, which are public by design and gated by protocol
verification instead (state+PKCE, and Meta's own signature,
respectively — see their own sections). The live, deployed functions are
still exactly as open as described until redeployed.

**Read-only, genuinely low risk — no customer data, no business detail:**
`storm-signal` only (raw weather/storm data, identical for every caller
regardless of which customer is asking).

**Read-only, but exposes real business/customer data — not "low risk":**

- `risk-recommendation` returns a customer's real inventory shortfall
  figures, sales-exposure estimates, and transfer economics — this is
  business-sensitive operational data, not a generic computed number, and
  requires authentication.
- `decisions-list` returns a customer's real decision history (what was
  approved, dismissed, or ignored, and when) — this is a record of that
  business's own operational judgment calls and requires authentication.
- `excel-browse` returns real OneDrive file and table *names* from the
  connected account — metadata about a customer's actual file/folder
  structure, not public information, and requires authentication.
- `risk-location-settings` (GET) returns the monitored location and
  operating configuration for a specific deployment — operational
  configuration, not a public constant, and requires authentication.
- `shipments-list` returns every shipment's `driver_name`, `driver_phone`,
  and free-text driver reply content to anyone, with no gate at all — real
  PII, requires authentication.
- `excel-status` returns the connected Microsoft account's real email
  address to anyone, with no gate at all — requires authentication.

**Write-capable, no auth, real side effects — operational settings and
shipment endpoints both require authentication:**

- `risk-location-settings` (POST) — anyone can change the monitored
  location/currency, an operational-configuration endpoint that requires
  authentication, not a public form. Also has a real input-validation
  gap: `relevantRadiusKm` has no bounds check at all (a negative or
  absurd value is accepted as-is), and `currencyCode`/`currencySymbol`
  are only length-capped, not validated against a real currency-code
  list.
- `shipments-create` — anyone can create shipment records; shipment data
  requires authentication the same as `shipments-list` above.
- `recommendation-action` — anyone can log approve/dismiss/undo events
  against any real `risk_snapshots.id` they can guess or read from
  `decisions-list`.
- `request-tracking-update` — anyone who supplies a valid shipment ID can
  trigger a **real outbound WhatsApp message** to that shipment's real
  driver, using the project's real Meta credentials. No rate limit in
  the currently deployed version; a race-safe per-shipment cooldown is
  implemented in the repository and awaits deployment (see "Rate
  limiting" below).
- `send-whatsapp-alert` — accepts a caller-supplied recipient number
  (`to`) and will send using the stored access token to **any** phone
  number the caller names, not just the configured test recipient. This is
  a real abuse vector: anyone who finds this URL can make the business's
  own WhatsApp number message an arbitrary third party.
- `whatsapp-webhook` (POST) — see the dedicated finding below; this one
  writes to the `shipments` table based on **unverified** inbound content.

**No rate limiting exists in the currently deployed production
functions.** Race-safe rate limiting is implemented and tested in the
repository but awaits deployment (see "Rate limiting" below). (For
comparison, a sibling project in this same account
recently added a per-IP failed-attempt throttle to two PIN/passcode-gated
functions — the same pattern would directly apply to the write-capable
endpoints above, several of which currently have no gate to even
*throttle*, let alone a secret to guess.)

## Meta webhook signature validation — implemented in repository, tested locally, awaiting deployment

**What follows describes the currently-deployed production behavior**,
which the fix below has not reached yet. `whatsapp-webhook`'s POST
handler (the one that records inbound driver replies) does **not** check
Meta's `X-Hub-Signature-256` header at all —
there is no HMAC computation, no app-secret comparison, and no signature
check of any kind in the POST path. **Any POST request shaped like a
WhatsApp message-delivery payload is trusted and processed as if it came
from Meta.** Concretely, an attacker who finds this URL can:

- Set a shipment's status to `tracking_received` and populate its
  `tracking_number`/`carrier_eta` with arbitrary attacker-chosen content,
  for any shipment whose driver phone number they can guess or already
  know (shipment data is itself exposed via `shipments-list`, above, so
  an attacker doesn't even need to guess).

The **only** secret check anywhere in this function is in the GET handler,
which compares Meta's one-time subscription-verification token
(`hub.verify_token`) against a stored value — that check exists solely for
Meta's initial webhook-registration handshake and provides zero protection
for ongoing inbound message deliveries. **This is a real gap, not a
documented tradeoff** — it should be fixed (verify the signature using the
Meta app secret) before this pipeline is trusted with real customer
shipment data.

**Fixed in committed code as of 2026-09-23, not yet deployed.**
`whatsapp-webhook/index.ts` now reads the raw body via `req.text()`
before any parsing, calls `verifyMetaSignature` against
`whatsapp_config.meta_app_secret`, and returns 401 before touching the
body if the signature is missing or wrong. The live function still has
none of this until it's redeployed.

## Webhook idempotency — a retry-loss bug found and fixed (2026-09-24)

A follow-up audit of the full `whatsapp-webhook` flow, prompted by the
question "if the shipment update fails after the message is recorded,
does a Meta retry actually get reprocessed, or does it get silently
skipped as a duplicate?" — answered by direct code inspection, not
assumption:

**Yes, the retry was lost.** The idempotency table
(`whatsapp_webhook_events`) originally recorded only "have we seen this
`message_id`," never "did we finish processing it." The row was
inserted (`upsert` + `ignoreDuplicates`) *before* the shipment-matching/
update logic ran, and any later delivery of the same `message_id` saw 0
rows back from that insert and was skipped as a duplicate — the update
logic was never re-reached. Separately, the shipment `.update()` call's
own `{error}` result was never checked, and even a thrown exception was
swallowed by a catch block that only logged — the function returned an
unconditional `200` regardless of outcome. **Net effect: a genuine
failure in the shipment update, after the message was already recorded,
was permanently and silently unrecoverable** — Meta was never told to
retry (always 200), and if it had retried anyway for some other reason,
the existing row would have caused that retry to be skipped before the
update ever ran again.

**Implemented in repository, tested locally, awaiting deployment.**
`whatsapp_webhook_events` gains real processing-state tracking (`status`
— `processing`/`completed`/`failed`/`gave_up`/`legacy_unverified` —
plus `claimed_at`, `processed_at`, `attempt_count`, `last_error_category`,
`updated_at`) and a new atomic claim RPC (`claim_webhook_event`, the same
`pg_advisory_xact_lock` idiom `claim_whatsapp_send_slot` already uses)
so a `message_id` alone never implies success: a `completed` duplicate
acks without reprocessing; a `failed` duplicate is retried; an abandoned
`processing` row past a staleness window is recovered and retried;
concurrent duplicate deliveries of the same `message_id` can't both
claim it, so they can't both update the shipment; and a message that
keeps failing past a bounded attempt count is marked `gave_up` (acked,
so Meta stops retrying) rather than retried forever. The shipment
update's own errors are now checked and thrown, so a genuine failure
calls `fail_webhook_event` and returns a retryable `500` — never a `200`
for work that didn't actually complete. See
`supabase/migrations/20260924000000_webhook_idempotency.sql`,
`_shared/webhookIdempotency.ts`, and `whatsapp-webhook/idempotency.ts`
(the pure decision logic, unit-tested in `webhook_idempotency_test.ts`).
Two properties — the advisory lock's actual cross-transaction
concurrency guarantee, and confirming an invalid signature truly never
creates a row — need a live Postgres instance to verify directly and
are flagged as not independently automated in this pass, not silently
claimed tested.

## Microsoft OAuth state validation — weaker than previously documented

Earlier project notes described the OAuth `state` parameter as "a basic
sanity check on the redirect round-trip, not stored and compared server-
side for real CSRF protection" — implying some round-trip check exists.
**Verified against the actual code: it does not.** `excel-oauth-start`
generates a random `state` value and sends it to Microsoft, but
`excel-oauth-callback` never reads the `state` query parameter at all —
it is not referenced anywhere in that function's source. In practice this
provides **zero** CSRF/replay protection, not a "basic" one. For a single-
tenant pilot tool with no per-visitor session to check state against, the
practical exposure is limited (there's only one real user of this
connector today), but the gap is real and should be closed (store `state`
server-side, or in a short-lived signed cookie, and compare it on
callback) before a second real user/tenant is onboarded.

**Fixed in committed code as of 2026-09-23, not yet deployed.**
`excel-oauth-callback/index.ts` now reads `state` off Microsoft's
redirect and atomically consumes the matching `oauth_states` row (a
single conditional `UPDATE ... WHERE state=$1 AND used_at IS NULL AND
expires_at > now()`) — missing, unknown, expired, reused, or wrong-
provider state is rejected the same way, before the authorization
`code` is ever exchanged. The stored PKCE `code_verifier` is included in
the token exchange. Errors redirect with a short generic code
(`invalid_state`, `token_exchange_failed`, etc.), never a token, verifier,
or Microsoft's own error text. The live function still has none of this
until it's redeployed.

## Credential handling — a genuine strength, confirmed

Every table holding a real secret (`whatsapp_config.access_token`,
`excel_oauth.client_secret`/`access_token`/`refresh_token`,
`erp_config.password`/`api_token`) has Row Level Security enabled with
**no policies at all** — service_role only, consistently applied across
every credential-holding table. Reading every function's response-
construction and error-handling code confirms **no function ever returns
a credential, token, or client secret in its response body** — errors are
generic, and successful responses only ever echo the *external* API's own
response (e.g. Meta's message-send confirmation), never the internal
token used to make the call. This part of the system is built correctly
and consistently; it is not a blocker.

## Rate limiting — implemented in repository, tested locally, awaiting deployment

Covered above under "Public endpoint exposure." Worth restating as its
own line item: **in production today**, none of the 19 deployed
functions have any per-caller throttle, on read or write paths. A
race-safe rate limiter (`claim_whatsapp_send_slot`, a Postgres
advisory-lock RPC that closes a TOCTOU gap the original check-then-insert
pattern had) for `request-tracking-update` (60-minute per-shipment
cooldown) and `send-whatsapp-alert` (10/hour/user) is **implemented in
repository** and **tested locally** (`rateLimit_test.ts`), but **still
open in production** until the `20260923000000_atomic_rate_limit.sql`
migration is applied and both functions are redeployed.

## Demo-data separation — fixed in committed code, not yet deployed

`risk_snapshots` records a row on **every** computation, including every
page load during development/testing, with no flag distinguishing "real
usage" from "someone reloading the dashboard while debugging." The
Decisions view's approval-rate figure is consequently a mix of real and
incidental development activity today. This was already disclosed
honestly in the UI copy itself (a caveat was added to the Decisions view
after an external review caught this), but the underlying data still isn't
separated — only the display is caveated.

**Fixed as of 2026-09-22, pending deployment**: `risk_snapshots` gained
`environment`/`computation_source` columns (classified automatically,
not asked of the caller) plus a dedup mechanism so a repeat page load
increments a counter instead of inserting a new row; `decisions-list`
now defaults to pilot-only data and reports which scope was used. See
`BUILD_LOG.md`'s "Data integrity" entry. Existing rows are backfilled
`'unknown'`, not deleted or relabeled as pilot activity they weren't.
None of this is live yet — the migration hasn't been applied.

## Everything required before real customer data flows through this

In priority order, based on actual exposure (not just theoretical risk).
Status as of 2026-09-23, distinguishing six things per item:

- **Implemented in repository** — the code exists in the repository, not
  yet deployed.
- **Tested locally** — covered by a passing automated unit or
  integration test run against the repository, not the live system.
- **Awaiting deployment** — implemented (and, where noted, tested), but
  not yet applied/deployed to the live Supabase project.
- **Deployed** — the code has been redeployed/applied to the live
  project.
- **Verified in production** — deployed, and confirmed working against
  the real live system, not just "should work."
- **Still open** — not implemented at all.

**None of items 1–6 below are "Deployed" or "Verified in production" —
every one of them still describes the live system's actual, unfixed
behavior until the release sequence in
[`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) is run.**

1. **Fix the Meta webhook signature check** — the one concrete, currently-
   exploitable gap that lets an outside party write fabricated data into
   a real customer's shipment records. **Implemented in repository,
   tested locally, awaiting deployment** — `whatsapp-webhook` now calls
   the existing `verifyMetaSignature` verifier and rejects before parsing
   the body; covered by `crypto_test.ts` (valid/wrong-secret/tampered-
   body/missing-header cases).
2. **Real backend-enforced authentication** in front of the dashboard and
   the write-capable Edge Functions — Supabase Auth, checked against a
   `pilot_authorized_emails` allowlist, replacing the plain-JS shared
   password. **Implemented in repository, tested locally, awaiting
   deployment for the backend; the dashboard's own half is already
   Deployed and Verified in production** — written for all 15
   authenticated functions server-side (awaiting deployment); on the
   frontend, `index.html` already does a real email magic-link sign-in
   in production, and `ruta-dashboard-fixed.html` already bootstraps a
   real session, attaches it as a bearer token on every protected call
   via a new `authedFetch()`, handles 401 (session invalid → sign back
   in) and 403 (real session, not on the allowlist → banner), and has a
   working sign-out button — all confirmed live against the hosted URLs;
   covered by a 10-check Playwright test (`dashboard_auth_test.js`)
   locally. The functions it calls don't check any of this yet.
3. **Store and check the OAuth `state` parameter for real** before a
   second Microsoft account is ever connected through this flow.
   **Implemented in repository, tested locally, awaiting deployment** —
   `excel-oauth-start` requires auth and generates real state+PKCE;
   `excel-oauth-callback` now validates and atomically consumes it, PKCE
   included; the PKCE math is covered by `crypto_test.ts` against RFC
   7636's own test vector. The state-consumption race logic itself has
   no live-database test (would require a deployed project) — flagged as
   unverifiable in this pass, see the completion report.
4. **Add rate limiting** to every write-capable endpoint, especially
   `request-tracking-update` and `send-whatsapp-alert` (both spend the
   project's real, limited WhatsApp send allowance and could be used to
   harass a real phone number if abused) and `whatsapp-webhook`.
   **Implemented in repository, tested locally, awaiting deployment** —
   written for `request-tracking-update` (60-min per-shipment cooldown)
   and `send-whatsapp-alert` (10/hour/user), and made race-safe (a
   Postgres advisory-lock RPC replaces the old check-then-insert, closing
   a TOCTOU gap two near-simultaneous requests could have slipped
   through), with the pure counting/cooldown logic covered by
   `rateLimit_test.ts`; `whatsapp-webhook` doesn't need a caller-side
   rate limit now that item 1 (signature verification) gates it instead.
5. **Tighten `risk-location-settings`'s input validation** (bounds-check
   `relevantRadiusKm`, whitelist `currencyCode`). **Implemented in
   repository, awaiting deployment** — no dedicated unit test for this
   specific validation exists (not tested locally in the automated sense).
6. **Separate real usage from test/development data** — add an
   environment or `is_test` marker to `risk_snapshots`, or run a real data
   wipe as part of onboarding, before quoting approval-rate figures to a
   real pilot customer. **Implemented in repository, tested locally,
   awaiting deployment** — see the Demo-data-separation section above;
   covered by `decisions_metrics_test.ts`; pending the migration
   actually being applied.
7. **A real production domain** — not strictly a security fix, but the
   project's own build order already treats this as a pilot prerequisite
   alongside authentication, and it's the natural point to also add TLS/
   access controls a subdomain-of-GitHub-Pages setup doesn't give you.
   **Still open** — a real domain purchase/DNS step, not code.
8. **Formal Meta Business verification**, if/when a general risk-alert
   template (proactive push to a business owner, not the driver-tracking
   flow) is built — separate from, and in addition to, the driver-
   tracking template already approved. **Still open** — no such template
   exists yet, per `UTOPIA_CURRENT_SPEC.md`.
