# Utopia — Security Status & Pilot Blockers

Verified directly against all 19 deployed Edge Functions, the dashboard's
client-side code, and the database schema (column names/types only — no
row data was read while compiling this document). This is the honest
current state, not a plan or a set of intentions.

**Status update (2026-09-22, later the same day): fixes for most of this
have been written and committed (`supabase/` tree), but nothing has been
deployed or applied to the live project.** Everything below describes
what the *live, running* system actually does today — that has not
changed. See each section's own note for what's fixed in code and still
pending deployment, and `BUILD_LOG.md`'s "Security hardening" entry for
the full detail. Left genuinely open even in the unpicked code:
`excel-oauth-callback`'s state validation, `whatsapp-webhook`'s signature
check, and the dashboard's own auth wiring — none of those were reached
before this pass paused to do other work.

## Authentication status

**There is no user login system anywhere in this project.** Specifically:

- All 19 Supabase Edge Functions are deployed with `verify_jwt: false` —
  none require a Supabase Auth session/JWT to invoke.
- The dashboard's own "sign-in" is a single shared password, hardcoded as
  a plain-text constant in `index.html`'s own JavaScript (readable via
  view-source by anyone), which on success sets a `sessionStorage` flag
  that a guard script checks before rendering the dashboard.
- That `sessionStorage` flag is trivially set from a browser's devtools
  console without ever knowing the password — this is a **deterrent**,
  not access control. It stops a casual visitor from stumbling onto the
  live URL; it stops nothing else.
- This was a deliberate, disclosed tradeoff while showing the product to a
  handful of people previewing a pilot pitch with demo/sample ERP data. It
  is explicitly **not** sufficient once real customer ERP data is
  connected.

## Public endpoint exposure

Every one of the 19 Edge Functions is reachable by anyone who has (or
guesses, or finds via the dashboard's own client-side source) its URL, with
**no caller-side secret, signature, or token check of any kind**, except
the one narrow case noted under "Meta webhook signature validation" below.
Grouped by what that actually means in practice:

**Read-only, low risk — returns only non-sensitive computed data:**
`storm-signal`, `risk-recommendation`, `decisions-list`, `excel-browse`
(file/table *names* only, not contents), `risk-location-settings` (GET).

**Read-only, real PII exposure to any anonymous caller:**

- `shipments-list` returns every shipment's `driver_name`, `driver_phone`,
  and free-text driver reply content to anyone, with no gate at all.
- `excel-status` returns the connected Microsoft account's real email
  address to anyone, with no gate at all.

**Write-capable, no auth, real side effects:**

- `risk-location-settings` (POST) — anyone can change the monitored
  location/currency. Low blast radius (no credential exposure), but also
  has a real input-validation gap: `relevantRadiusKm` has no bounds check
  at all (a negative or absurd value is accepted as-is), and
  `currencyCode`/`currencySymbol` are only length-capped, not validated
  against a real currency-code list.
- `shipments-create` — anyone can create shipment records.
- `recommendation-action` — anyone can log approve/dismiss/undo events
  against any real `risk_snapshots.id` they can guess or read from
  `decisions-list`.
- `request-tracking-update` — anyone who supplies a valid shipment ID can
  trigger a **real outbound WhatsApp message** to that shipment's real
  driver, using the project's real Meta credentials. No rate limit.
- `send-whatsapp-alert` — accepts a caller-supplied recipient number
  (`to`) and will send using the stored access token to **any** phone
  number the caller names, not just the configured test recipient. This is
  a real abuse vector: anyone who finds this URL can make the business's
  own WhatsApp number message an arbitrary third party.
- `whatsapp-webhook` (POST) — see the dedicated finding below; this one
  writes to the `shipments` table based on **unverified** inbound content.

**No rate limiting exists anywhere in this project**, on any endpoint,
read or write. (For comparison, a sibling project in this same account
recently added a per-IP failed-attempt throttle to two PIN/passcode-gated
functions — the same pattern would directly apply to the write-capable
endpoints above, several of which currently have no gate to even
*throttle*, let alone a secret to guess.)

## Meta webhook signature validation — not implemented

`whatsapp-webhook`'s POST handler (the one that records inbound driver
replies) does **not** check Meta's `X-Hub-Signature-256` header at all —
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

**Not yet fixed even in the unpicked code.** The verifier itself
(`verifyMetaSignature`, constant-time HMAC-SHA256 over the raw body) and
a `whatsapp_config.meta_app_secret` column/idempotency table exist as of
2026-09-22, but `whatsapp-webhook`'s own handler was never rewritten to
call it — this gap is real in both the live function and the latest
committed code.

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

**Half-fixed in committed, undeployed code.** An `oauth_states` table
(state + PKCE `code_verifier` + requesting user + expiry + used-once
flag) exists, and `excel-oauth-start` now requires an authorized user's
session to even generate one. But `excel-oauth-callback` was never
rewritten to actually read, validate, and consume that state — so the
real fix (closing the gap this section describes) isn't done yet,
in code or live.

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

## Rate limiting — not implemented anywhere

Covered above under "Public endpoint exposure." Worth restating as its own
line item since it's one of the more mechanical, fastest-to-fix gaps: none
of the 19 functions have any per-caller throttle, on read or write paths.

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
Status as of 2026-09-22 noted per item — **"written" means committed to
the repo, not deployed; the live system still behaves as described
above in every case.**

1. **Fix the Meta webhook signature check** — the one concrete, currently-
   exploitable gap that lets an outside party write fabricated data into
   a real customer's shipment records. *Not written yet — the verifier
   exists in `_shared/crypto.ts` but `whatsapp-webhook` doesn't call it.*
2. **Real backend-enforced authentication** in front of the dashboard and,
   ideally, the write-capable Edge Functions — Supabase Auth or a proper
   reverse-proxy auth layer, replacing the plain-JS shared password.
   *Written for 12 of ~17 functions server-side; the dashboard's own
   frontend auth wiring (supabase-js, per-request tokens, sign-out) was
   not started.*
3. **Store and check the OAuth `state` parameter for real** before a
   second Microsoft account is ever connected through this flow. *Half
   written — `excel-oauth-start` requires auth and generates real
   state+PKCE now; `excel-oauth-callback` still doesn't validate it.*
4. **Add rate limiting** to every write-capable endpoint, especially
   `request-tracking-update` and `send-whatsapp-alert` (both spend the
   project's real, limited WhatsApp send allowance and could be used to
   harass a real phone number if abused) and `whatsapp-webhook`. *Written
   for `request-tracking-update` (60-min per-shipment cooldown) and
   `send-whatsapp-alert` (10/hour/user); `whatsapp-webhook` itself has
   none, and can't sensibly until item 1 exists.*
5. **Tighten `risk-location-settings`'s input validation** (bounds-check
   `relevantRadiusKm`, whitelist `currencyCode`). *Written.*
6. **Separate real usage from test/development data** — add an
   environment or `is_test` marker to `risk_snapshots`, or run a real data
   wipe as part of onboarding, before quoting approval-rate figures to a
   real pilot customer. *Written (see the Demo-data-separation section
   above), pending the migration actually being applied.*
7. **A real production domain** — not strictly a security fix, but the
   project's own build order already treats this as a pilot prerequisite
   alongside authentication, and it's the natural point to also add TLS/
   access controls a subdomain-of-GitHub-Pages setup doesn't give you.
   *Not started — a real domain purchase/DNS step, not code.*
8. **Formal Meta Business verification**, if/when a general risk-alert
   template (proactive push to a business owner, not the driver-tracking
   flow) is built — separate from, and in addition to, the driver-
   tracking template already approved. *Not started — no such template
   exists yet, per `UTOPIA_CURRENT_SPEC.md`.*
