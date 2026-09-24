# Utopia — Security Status & Pilot Blockers

Verified directly against all 18 currently deployed Edge Functions, the
dashboard's client-side code, and the database schema (column
names/types only — no row data was read while compiling this document).
This is the honest current state, not a plan or a set of intentions.

**Status update (2026-09-23, deployed and verified): the full
security-hardening pass — everything this document originally flagged —
is now live in production, not just committed.** All 4 migrations are
applied, all 15 `requireAuthorizedUser`-gated functions plus the 2
unauthenticated-by-design callbacks (`excel-oauth-callback`,
`whatsapp-webhook`) were redeployed with the hardened code, and Section
C of [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) — all 21
production smoke tests — has passed, including a post-deployment
read-only security audit (Security Advisor, RLS/grants, function
privileges) recorded there and in `BUILD_LOG.md`. The dashboard's
frontend (`index.html`, `ruta-dashboard-fixed.html`) has been live since
before this pass and needed no redeploy. **Every gap this document
originally described is now closed in production, not just in committed
code** — the sections below are updated accordingly rather than left in
their pre-deployment "awaiting deployment" framing. Two genuinely open,
low-severity items surfaced by the post-deployment audit are called out
explicitly where relevant, rather than folded into a blanket "all clear."

## Edge Function inventory (18 deployed, reconciled)

Two counts have appeared in this document and elsewhere: **18 deployed**
and **17 audited/local**. These were never actually in conflict — they
describe two different sets:

- **17 functions** have local, git-tracked source under
  `supabase/functions/` in this repository, and were each audited against
  that source (rows 1–17 below).
- **1 function** is deployed to the live project with **no local
  directory and no git history at all** — `storm-signal` (row 18 below).
  It was never missing from "the live system," only from "this
  repository." `excel-debug` (previously row 19, also no local source)
  has since been deleted by the owner via the Supabase dashboard — it no
  longer appears in this inventory at all.

17 + 1 = 18, matching `list_edge_functions` exactly. Nothing is
unaccounted for. Of the 17 local functions, exactly **15** are gated by
`requireAuthorizedUser` (confirmed by a line-numbered grep of every real
call site, excluding one false-positive match inside that guard's own
header comment) — `excel-oauth-callback` and `whatsapp-webhook` are the
2 exceptions, each gated by its own mechanism (state+PKCE, and Meta's
HMAC signature, respectively) instead.

| # | Function | Local? | Deployed? | Intended caller | Auth model | Reads customer/personal data? | External side effects? | Repository status | Production status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `decisions-list` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real decision history | No (pure read) | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production — Section C row 17 confirmed live (default `scope="pilot"`, no non-pilot data leaked) |
| 2 | `erp-inventory` | Yes | Yes | Dashboard + internal call from `risk-recommendation` (forwards caller's own token) | Supabase authenticated user | Yes — real inventory figures | Yes — calls external ERP APIs; writes refreshed `excel_oauth` token | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 3 | `excel-browse` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real OneDrive file/table names | Yes — calls Microsoft Graph; may write refreshed token | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 4 | `excel-oauth-callback` | Yes | Yes | Microsoft's OAuth redirect (browser navigation — cannot carry a bearer token) | Microsoft OAuth state+PKCE | Yes — reads/stores real connected email | Yes — calls Microsoft's token endpoint + Graph `/me`; writes `oauth_states.used_at`, `excel_oauth`, `erp_config.provider` | Implemented in repository, tested locally (PKCE vs. RFC 7636's own vector) | Deployed (hardened code, live since 2026-09-23); verified in production — Section C row 9 confirmed a real Microsoft connect flow live (state minted, consumed exactly once, tokens repopulated) |
| 5 | `excel-oauth-start` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | No — only a non-secret `client_id` | Yes — writes a new `oauth_states` row | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 6 | `excel-select-workbook` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real OneDrive file/table names | Yes — calls Microsoft Graph; writes `erp_config`, may write `excel_oauth` | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 7 | `excel-status` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real connected account email | No (pure read) | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 8 | `recommendation-action` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — writes real decision events | Yes — writes a `recommendation_events` row | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 9 | `request-tracking-update` | Yes | Yes | Dashboard (`authedFetch`), manual-button only | Supabase authenticated user | Yes — real driver name/phone | Yes — sends a real WhatsApp message; writes `whatsapp_send_log`, updates `shipments` | Implemented in repository, tested locally (`rateLimit_test.ts`) | Deployed (hardened code, live since 2026-09-23); verified in production — Section C row 16 confirmed the per-shipment cooldown live (second call within 60 minutes correctly blocked) |
| 10 | `risk-location-settings` | Yes | Yes | Dashboard (`authedFetch`, GET+POST) | Supabase authenticated user | No — generic operating configuration | Yes on POST — writes `risk_location_config` | Implemented in repository (no dedicated unit test for the validation fix) | Deployed (hardened code, live since 2026-09-23); verified in production |
| 11 | `risk-recommendation` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — combines weather with real ERP data | Yes — calls Open-Meteo + internal `storm-signal`/`erp-inventory`; writes/upserts `risk_snapshots` | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 12 | `send-whatsapp-alert` | Yes | Yes | No dashboard call site — manual/admin only | Supabase authenticated user | Yes — real or caller-supplied phone number | Yes — sends a real WhatsApp message; writes `whatsapp_send_log` | Implemented in repository, tested locally (`rateLimit_test.ts`, 10/hour/user) | Deployed (hardened code, live since 2026-09-23); verified in production — Section C rows 14/15 confirmed the 10/hour limit and the send path itself live. **Flag for manual review still stands**: no UI caller exists, confirm still needed |
| 13 | `shipments-create` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real driver PII | Yes — writes a `shipments` row | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 14 | `shipments-list` | Yes | Yes | Dashboard (`authedFetch`) | Supabase authenticated user | Yes — real driver PII | No (pure read) | Implemented in repository, tested locally | Deployed (hardened code, live since 2026-09-23); verified in production |
| 15 | `whatsapp-setup-tracking-template` | Yes | Yes | No dashboard call site — one-time admin setup | Supabase authenticated user | No — template definition only | Yes — calls Meta's Business Management API to create/check the template | Implemented in repository | Deployed (hardened code, live since 2026-09-23); verified in production. **Flag for manual review still stands**: template already approved and in use, confirm whether this needs to stay deployed |
| 16 | `whatsapp-webhook` | Yes | Yes | Meta's webhook system (server-to-server — cannot carry a bearer token) | Meta signature (`X-Hub-Signature-256`, verified before parsing; GET handshake via `hub.verify_token`) | Yes — real inbound driver phone/message | Yes — atomically claims/updates `whatsapp_webhook_events` (real processing/completed/failed/gave-up state, not just existence), updates `shipments` on success only | Implemented in repository, tested locally (`crypto_test.ts`, `webhook_idempotency_test.ts`) | **Deployed (hardened code, live since 2026-09-23); verified in production — Section C rows 11/12/13 confirmed a valid signature is accepted, an invalid one is rejected with zero row created, and duplicate delivery of a completed message is a safe no-op** |
| 17 | `whatsapp-webhook-subscription` | Yes | Yes | No dashboard call site — admin diagnostic/fix | Supabase authenticated user | No — WABA subscription status only | Yes — POST changes the live WABA's webhook subscription | Implemented in repository | Deployed (hardened code, live since 2026-09-23); verified in production. **Flag for manual review still stands**: admin diagnostic tool, confirm still needed |
| 18 | `storm-signal` | **No — no local directory, no git history** | Yes (v2) | Internal call from `risk-recommendation`; public weather relay | Intentionally public — identical, non-customer-specific data for every caller, by design | No | No (read-only relay of NOAA/NHC data) | **Not in repository** | Deployed and in active use. **Flag, do not remove:** its own source comments reference sibling functions (`gmail-summary`, `patrol-summary`, `attendance-feed`) that don't exist anywhere in this project — evidence it was copied from an unrelated project at deploy time. Recommend a future, separate task to back-fill its real source into this repo; not touched in this pass |

`excel-debug` (previously row 19, no local directory, deployed but
inert) has been **deleted** by the owner via the Supabase dashboard,
per `BUILD_LOG.md`'s Section B entry. It no longer exists in the live
project and is removed from this inventory rather than left as a
stale row.

## Authentication status

**Real backend-enforced authentication is now live and verified, both
halves.** This section originally described a mid-migration state (the
frontend's magic-link sign-in already live, but none of the deployed
functions enforcing it yet) — that gap is closed as of 2026-09-23:

- `index.html` and `ruta-dashboard-fixed.html` present a genuine email
  magic-link sign-in, with an `authedFetch()` wrapper that attaches a
  real bearer session token to every protected call. **Verified in
  production** — confirmed directly against the live GitHub Pages URLs
  (`authedFetch`/`getSession` present, no `sessionStorage`/
  `ruta_authed` gate remaining).
- All 15 `requireAuthorizedUser`-gated functions now check that real
  session token and the `pilot_authorized_emails` allowlist
  server-side. **Verified in production** — Section C rows 2/6 confirm
  an authenticated-but-unauthorized email gets a real session but a
  403 + banner on its first protected call (not a silent pass-through);
  rows 5/8 confirm a garbage or missing token gets 401 on every gated
  function; row 7 confirms every dashboard view renders correctly for
  the authorized owner.
- `pilot_authorized_emails` was seeded with the owner's own email
  *before* any gated function was redeployed, exactly as
  [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) required, avoiding
  a self-lockout — confirmed by the owner successfully signing in and
  using the dashboard immediately after redeploy.

## Public endpoint exposure — historical description, now closed and verified live

**Everything described in this section is the pre-hardening behavior
this project has since fixed and deployed** — kept here as the record
of what was exposed and why it mattered, not as the current state.
`requireAuthorizedUser` (real Supabase Auth session +
`pilot_authorized_emails` allowlist check) now gates every function
named below except `excel-oauth-callback` and `whatsapp-webhook`,
which are public by design and gated by protocol verification instead
(state+PKCE, and Meta's own signature, respectively — see their own
sections). Confirmed live, not just deployed: Section C row 8 (every
one of the 15 gated functions returns 401 with no/garbage auth, not
200) and rows 18/20 (a missing `Origin` header is never a substitute
for a real token; an unauthorized browser origin is rejected at the
CORS preflight) directly retest the exposure this section originally
described.

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
  driver, using the project's real Meta credentials. This was the
  pre-hardening behavior; a race-safe per-shipment cooldown is now
  deployed and verified live (see "Rate limiting" below).
- `send-whatsapp-alert` — accepts a caller-supplied recipient number
  (`to`) and will send using the stored access token to **any** phone
  number the caller names, not just the configured test recipient. This is
  a real abuse vector: anyone who finds this URL can make the business's
  own WhatsApp number message an arbitrary third party.
- `whatsapp-webhook` (POST) — see the dedicated finding below; this one
  writes to the `shipments` table based on **unverified** inbound content.

**Race-safe rate limiting is now live in the deployed production
functions** (see "Rate limiting" below) — verified via Section C rows
14/16 of `DEPLOYMENT_RUNBOOK.md` (the 10/hour per-user limit and the
per-shipment cooldown both confirmed blocking a real over-limit call).
(For comparison, a sibling project in this same account
recently added a per-IP failed-attempt throttle to two PIN/passcode-gated
functions — the same pattern would directly apply to the write-capable
endpoints above, several of which currently have no gate to even
*throttle*, let alone a secret to guess.)

## Meta webhook signature validation — implemented, tested, deployed, verified live

**What follows describes the pre-hardening production behavior this
fix has since closed** — kept here for the historical record of what
the gap was and why it mattered, not as the current state.
`whatsapp-webhook`'s POST
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

**Fixed in committed code as of 2026-09-23, deployed and verified live
the same day.** `whatsapp-webhook/index.ts` now reads the raw body via
`req.text()` before any parsing, calls `verifyMetaSignature` against
`whatsapp_config.meta_app_secret`, and returns 401 before touching the
body if the signature is missing or wrong. Confirmed live via Section
C rows 11/12 of `DEPLOYMENT_RUNBOOK.md`: a correctly-signed payload is
accepted (`200`, `status='completed'`), and a tampered/wrong-secret
payload is rejected with `401` and **zero** row created in
`whatsapp_webhook_events` — confirmed by `message_id`, not just the
response code.

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

**Implemented, tested, deployed, verified live as of 2026-09-23.**
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
One property — the advisory lock's actual cross-transaction concurrency
guarantee under real concurrent load — genuinely needs staging-only
stress testing (`DEPLOYMENT_RUNBOOK.md` Section F) and remains
unverified; not silently claimed tested. The other property this
section originally flagged as needing a live instance — confirming an
invalid signature truly never creates a row — **has since been
verified live** (Section C row 12: a tampered/wrong-secret payload
returns `401` with zero row created, confirmed by `message_id`).

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

**Fixed in committed code as of 2026-09-23, deployed and verified live
the same day.** `excel-oauth-callback/index.ts` now reads `state` off
Microsoft's redirect and atomically consumes the matching
`oauth_states` row (a single conditional `UPDATE ... WHERE state=$1
AND used_at IS NULL AND expires_at > now()`) — missing, unknown,
expired, reused, or wrong-provider state is rejected the same way,
before the authorization `code` is ever exchanged. The stored PKCE
`code_verifier` is included in the token exchange. Errors redirect
with a short generic code (`invalid_state`, `token_exchange_failed`,
etc.), never a token, verifier, or Microsoft's own error text.
Confirmed live via Section C row 9 (a real connect flow: state minted,
consumed exactly once, tokens repopulated) and row 10 (a replayed/
expired state correctly redirects with the generic `invalid_state`
code, never a token or verifier).

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

## Rate limiting — implemented, tested, deployed, verified live

Covered above under "Public endpoint exposure" — updated there. A
race-safe rate limiter (`claim_whatsapp_send_slot`, a Postgres
advisory-lock RPC that closes a TOCTOU gap the original check-then-insert
pattern had) for `request-tracking-update` (60-minute per-shipment
cooldown) and `send-whatsapp-alert` (10/hour/user) is now **live in
production**, confirmed via Section C rows 14 and 16 respectively (a
real over-limit call correctly blocked in each case, with zero Meta
call made for the rate-limited one).

## Demo-data separation — fixed in committed code, deployed and verified live

`risk_snapshots` records a row on **every** computation, including every
page load during development/testing, with no flag distinguishing "real
usage" from "someone reloading the dashboard while debugging." The
Decisions view's approval-rate figure is consequently a mix of real and
incidental development activity today. This was already disclosed
honestly in the UI copy itself (a caveat was added to the Decisions view
after an external review caught this), but the underlying data still isn't
separated — only the display is caveated.

**Fixed as of 2026-09-22, deployed 2026-09-23, verified live**:
`risk_snapshots` gained `environment`/`computation_source` columns
(classified automatically, not asked of the caller) plus a dedup
mechanism so a repeat page load increments a counter instead of
inserting a new row; `decisions-list` now defaults to pilot-only data
and reports which scope was used. See `BUILD_LOG.md`'s "Data
integrity" entry. Existing rows are backfilled `'unknown'`, not
deleted or relabeled as pilot activity they weren't. Confirmed live,
for real, via a post-deployment audit (2026-09-24) that made an actual
authenticated call to `decisions-list` with default params — not just
the earlier data-level check — and got back `scope="pilot"`,
`demoDataIncluded=false`, and no non-`pilot` `environment` value
anywhere in the response.

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

**Items 1–6 below are now all "Deployed" and "Verified in production"**
— the release sequence in
[`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) has been run, and
Section C's 21 production smoke tests (plus the 2026-09-24 post-
deployment security audit) confirm each fix behaves as intended
against the real live system, not just "should work."

1. **Fix the Meta webhook signature check** — the one concrete gap that
   used to let an outside party write fabricated data into a real
   customer's shipment records. **Deployed, verified in production** —
   `whatsapp-webhook` now calls the existing `verifyMetaSignature`
   verifier and rejects before parsing the body; covered by
   `crypto_test.ts` locally and confirmed live via Section C rows
   11/12 (valid signature accepted, invalid signature rejected with
   zero row created).
2. **Real backend-enforced authentication** in front of the dashboard and
   the write-capable Edge Functions — Supabase Auth, checked against a
   `pilot_authorized_emails` allowlist, replacing the plain-JS shared
   password. **Deployed, verified in production, both halves.** All 15
   `requireAuthorizedUser`-gated functions now check the real session
   and allowlist server-side; the frontend's `index.html`/
   `ruta-dashboard-fixed.html` do a real email magic-link sign-in,
   bootstrap a real session, attach it as a bearer token via
   `authedFetch()`, and handle 401 (sign back in) and 403 (banner)
   correctly. Confirmed live via Section C rows 1-8: an unauthorized
   email gets a real session but a 403 + banner on its first protected
   call (rows 2/6), garbage/missing tokens get 401 (rows 5/8), and the
   full dashboard renders correctly for the authorized owner (row 7).
3. **Store and check the OAuth `state` parameter for real** before a
   second Microsoft account is connected through this flow. **Deployed,
   verified in production** — `excel-oauth-start` requires auth and
   generates real state+PKCE; `excel-oauth-callback` validates and
   atomically consumes it, PKCE included; the PKCE math is covered by
   `crypto_test.ts` against RFC 7636's own test vector, and the
   single-use consumption itself is confirmed live via Section C row 9
   (a real connect: state created, consumed exactly once) and row 10
   (a replayed/expired state correctly rejected). The advisory lock's
   concurrent-race guarantee specifically (two simultaneous callbacks
   for the same state) still needs staging-only stress testing
   (`DEPLOYMENT_RUNBOOK.md` Section F) and remains unverified under
   real concurrency — not claimed tested beyond single-use correctness.
4. **Add rate limiting** to every write-capable endpoint, especially
   `request-tracking-update` and `send-whatsapp-alert` (both spend the
   project's real, limited WhatsApp send allowance and could be used to
   harass a real phone number if abused) and `whatsapp-webhook`.
   **Deployed, verified in production** — `request-tracking-update`
   (60-min per-shipment cooldown, Section C row 16) and
   `send-whatsapp-alert` (10/hour/user, Section C row 14) both
   confirmed blocking a real over-limit call, with the rate-limited
   call never reaching Meta's API; `whatsapp-webhook` doesn't need a
   caller-side rate limit now that item 1 (signature verification)
   gates it instead.
5. **Tighten `risk-location-settings`'s input validation** (bounds-check
   `relevantRadiusKm`, whitelist `currencyCode`). **Deployed** — no
   dedicated unit test for this specific validation exists (not tested
   locally in the automated sense), and it wasn't singled out for a
   dedicated Section C row, but the function itself is live with every
   other redeployed function and reachable via the normal Settings
   flow.
6. **Separate real usage from test/development data** — add an
   environment or `is_test` marker to `risk_snapshots`, or run a real data
   wipe as part of onboarding, before quoting approval-rate figures to a
   real pilot customer. **Deployed, verified in production** — see the
   Demo-data-separation section above; covered by
   `decisions_metrics_test.ts` locally and confirmed live via Section C
   row 17 (default params return `scope="pilot"`, no non-pilot data).
7. **Write an explicit RLS policy** (or an explicit deny-all policy, to
   state the intent rather than rely on Postgres's implicit behavior)
   for the 11 hardened tables the 2026-09-24 post-deployment Security
   Advisor flagged as "RLS Enabled No Policy." **Still open, INFO
   severity, not currently exploitable** — `anon`/`authenticated` hold
   broad table-level grants on these tables, but neither role has
   `rolbypassrls`, so RLS's default-deny with zero policies currently
   blocks all their row access regardless. Fragile, not broken: any
   future policy added without care would immediately activate those
   pre-existing broad grants. Worth a real policy pass before scaling
   past the pilot.
8. **Enable Supabase Auth's leaked-password-protection setting**
   (checks against HaveIBeenPwned.org). **Still open, WARN severity,
   unrelated to the tables/functions above** — a one-click toggle in
   Auth settings, off by default, not yet turned on.
9. **A real production domain** — not strictly a security fix, but the
   project's own build order already treats this as a pilot prerequisite
   alongside authentication, and it's the natural point to also add TLS/
   access controls a subdomain-of-GitHub-Pages setup doesn't give you.
   **Still open** — a real domain purchase/DNS step, not code.
10. **Formal Meta Business verification**, if/when a general risk-alert
   template (proactive push to a business owner, not the driver-tracking
   flow) is built — separate from, and in addition to, the driver-
   tracking template already approved. **Still open** — no such template
   exists yet, per `UTOPIA_CURRENT_SPEC.md`.
