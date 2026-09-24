# Utopia — Current Specification

Rule-based supply-chain risk intelligence for Honduran importers/
distributors, built as a thin layer on top of a customer's existing ERP —
not a replacement for it. Origin: San Pedro Sula. No AI/ML component
currently influences recommendations or message interpretation (see
"Design principles" below); "AI-assisted" in earlier versions of this
document overstated what's actually implemented.

This document states only what the current code actually does, verified
directly against the repository's dashboard file, Edge Functions, and
database schema, cross-checked against what is actually live where the
two differ (not against prior documentation's claims — see `BUILD_LOG.md`
for the history of how each piece was built and what earlier docs got
wrong along the way). Every capability below is tagged:

- **Live and verified** — real, deployed, and confirmed working against a
  live endpoint/service, not just plausible from reading the code.
- **Implemented but not live-validated** — real code, written against a
  documented API contract, but never exercised against a live account/
  instance of that external system.
- **Demo/sample data** — functions correctly, but the data behind it is
  synthetic, not a real customer's.
- **Planned** — not built yet.

## Repository status vs. deployed status (as of 2026-09-23, deployed and verified)

A full authentication/authorization hardening pass — real Supabase
Auth, a `pilot_authorized_emails` allowlist gating 15 of the 17
local/repo Edge Functions, real Microsoft OAuth `state`+PKCE
validation, real Meta webhook signature verification, a race-safe rate
limit, and a race-safe webhook idempotency/retry-recovery state machine
for `whatsapp-webhook` (fixing a confirmed retry-loss bug — see
`SECURITY_AND_PILOT_BLOCKERS.md`'s "Webhook idempotency" section) — was
written, unit- and integration-tested, committed, **and has since been
deployed to production and verified live** (4 migrations applied, all
17 local functions redeployed with the hardened code, the dashboard's
frontend already live beforehand needed no redeploy). All 21 of
`DEPLOYMENT_RUNBOOK.md` Section C's production smoke tests pass, plus a
2026-09-24 post-deployment read-only security audit (Security Advisor,
RLS/grants, function privileges — see `SECURITY_AND_PILOT_BLOCKERS.md`
and `BUILD_LOG.md` for the full evidence). Production now has: real
auth on every gated function, real Meta signature verification, real
rate limiting, and the webhook idempotency fix — none of it is
theoretical or pending anymore.

Two low-severity items surfaced by the post-deployment audit remain
genuinely open (not blocking the pilot, not hidden behind a blanket "all
clear"): 11 tables have RLS enabled with no explicit policy written
(currently safe, since `anon`/`authenticated` lack RLS-bypass privilege,
but fragile against a future mistake), and Supabase Auth's
leaked-password-protection toggle is off. See
`SECURITY_AND_PILOT_BLOCKERS.md`'s priority list, items 7–8, for both.

The tags below (Live and verified / Deployed / Planned) describe each
capability's actual current state, not a snapshot from before this
deployment.

## Legacy names

"Utopia" is the current product brand. The name "RUTA" (and its
capitalization variants) predates the rebrand and still surfaces in places
that would need a separate, deliberate rename to change — none of this is a
current bug, just naming debt:

| Where "RUTA"/"Ruta" still appears | Why it wasn't renamed |
| --- | --- |
| GitHub repository name/URL slug (`Ruta-`) | Renaming a GitHub repo changes every clone URL and hosted Pages link already shared; deferred until there's a reason to. |
| Dashboard filename `ruta-dashboard-fixed.html` | Same reasoning — the file is linked directly from the sign-in gate and from the OAuth callback's redirect target. |
| Supabase project display name ("RUTA") | Cosmetic label inside the Supabase dashboard only; not user-facing. |
| Meta for Developers app name ("Ruta") | Renaming a Meta app is a manual console step with no functional benefit yet. |
| `sessionStorage` key `ruta_authed` and the `Access-Control` origin string in a couple of Edge Functions | Internal variable/key names, invisible to a user. |

Everywhere a real person (customer, prospect, driver) would see the product
— the dashboard UI, WhatsApp messages, the hosted page's visible branding —
it already says **Utopia**.

## Design principles (non-negotiable)

These govern what "current capability" is allowed to mean here, and should
not be relaxed without a deliberate conversation:

- **Suggestion, never autonomous action.** The system recommends; a human
  approves. No purchase, transfer, or supplier action fires on its own.
- **Explainable before predictive.** A transparent, rule-based scoring
  function, not an ML model: Utopia converts weather and storm severity
  into an expected-delay assumption, compares that delay with each SKU's
  days of safety stock, estimates potential unit shortfall and sales
  exposure, and evaluates possible transfer costs. See "Scoring engine"
  below for the exact mechanism, verified directly against
  `risk-recommendation/scoring.ts` and `index.ts`.
- **Conservative alert volume on purpose.** Fewer, higher-confidence
  suggestions over catching everything.
- **Every suggestion needs a visible "why."** The specific signals behind a
  recommendation are cited inline, not hidden behind a click.

## Geography model — one configurable point, not a route or network

**Correction to earlier framing:** the system monitors weather/storm
conditions at exactly **one configurable operational point** (a single
lat/lon in `risk_location_config` — confirmed only one row exists in the
live table today), used as a proxy for that location's corridor risk. It is
**not** a multi-stop route model and **not** a multi-warehouse network
model — there is no concept of "monitor these five warehouses" or "track
this shipment's whole route" in the weather/storm signal itself. The UI's
use of the word "corridor" refers to this single point's surrounding risk
exposure, not a modeled path between two places. Moving the point (e.g. to
a different city) is one `UPDATE` to that row.

## Capabilities

### Signal ingestion — **Live and verified**

Two real, keyless public feeds, both scoped to the one configured location:

- **Open-Meteo** — 7-day daily precipitation/wind/weather-code outlook.
- **NOAA/NHC storm data** — relayed through a dedicated Edge Function
  (browsers can't fetch NOAA's feed directly, no CORS header on their end).

Both are fetched server-side by the scoring engine (below), which is the
single source of truth for corridor severity — the dashboard no longer
computes this client-side.

### ERP connector — mixed, see per-adapter status below

One Edge Function reads a server-side config row and dispatches to one of
five adapters, returning only `{ok, provider, fetchedAt, items[]}` — never
credentials, confirmed by reading every response-construction and error
path in the function.

- **Demo adapter — Live and verified, Demo/sample data.** A functional and
  tested adapter using sample inventory: three fixed SKUs (a headlight kit,
  brake pads, a car battery), whose alternate-warehouse units deliberately
  total a round number matching the dashboard's original reference-UI
  figure. This is what the connector actually returns when no real ERP is
  connected, and it is fully exercised end-to-end today.
- **Odoo adapter — Implemented but not live-validated.** Calls Odoo's
  documented JSON-RPC 2.0 external API (a single `/jsonrpc` endpoint,
  `service`/`method`/`args` envelope — not XML-RPC; no `/xmlrpc/2/...` path
  exists anywhere in this codebase) using the standard `common.authenticate`
  and `object.execute_kw` methods against `product.product`, plus a
  best-effort `sale.order.line` query for trailing-30-day sales velocity.
  **Specific limitation:** does not fetch alternate-warehouse stock at all
  — `alternateWarehouseUnits` is hardcoded empty pending a
  `stock.quant`-by-location query once a real pilot's warehouse layout is
  known. Never tested against a live Odoo instance.
- **SAP Business One adapter — Implemented but not live-validated.** Calls
  SAP B1's documented Service Layer REST API (session-cookie login, `Items`
  endpoint, `ItemWarehouseInfoCollection` expansion). **Specific
  limitation:** the inverse of Odoo — it does return real alternate-
  warehouse units, but computes no sales velocity at all
  (`avgDailyUnitsSold` is hardcoded `null` pending an invoice-line query).
  Never tested against a live SAP B1 instance; a real instance's
  denormalized data model likely needs more mapping work than currently
  written, and third-party API licensing hasn't been confirmed for a real
  target account.
- **Excel/OneDrive adapter — Live and verified** (the integration
  mechanism, a real Microsoft/Graph account), **unverified row-content
  classification** (the data — see below, not a mock but not confirmed
  operational data either). A genuine Microsoft sign-in (delegated Graph
  permissions, no password ever touching this dashboard), a real in-app
  workbook/table picker, and column resolution by header name (not fixed
  position) so a customer's own column order doesn't silently scramble
  data — all verified against a real, live Microsoft account and a real
  OneDrive workbook. The 20 rows worked with (first headers-only, then
  populated, including a fix for a real "shows $0" bug) confirm the
  integration mechanism against that real, live-connected account — not
  a mock. **The workbook belongs to a personal development account with
  no confirmed pilot customer. Its row contents were not inspected; for
  documentation and metric classification, they are treated as
  test/sample data rather than verified operational company data.**
  (Background: per `BUILD_LOG.md`'s 2026-09-01 entry, the Microsoft
  account is a personal one registered for building/testing this
  connector; see `PILOT_PLAYBOOK.md`'s "Pilot scope" for the current lack
  of a confirmed pilot customer.) This is the only adapter exercised
  against a real, live-connected account of any kind — the other three
  (below) have never been tried against a live instance at all — but
  "real account and real integration" should not be read as "real
  operational company data."
- **ZafraCloud adapter — Implemented but not live-validated.** Built
  directly from ZafraCloud's own published API documentation (found by
  reading the docs page's bundled JS to locate its machine-readable spec,
  not guessed), with real technical confirmation from a ZafraCloud contact.
  Bearer-token REST against two documented endpoints; capped at 50 SKUs per
  request with 10-way concurrent batching and automatic retry-with-backoff
  on HTTP 429. Verified via a standalone algorithm simulation (fake SKUs,
  simulated rate-limiting), not against a real account — getting a real
  token to test against costs money, and no ZafraCloud-using prospect is
  confirmed yet (see `PILOT_PLAYBOOK.md`).

**Onboarding note, qualified:** connecting Excel is genuinely low-effort —
a self-service OAuth "Connect" button, no engineering per customer. Odoo,
SAP B1, and ZafraCloud onboarding is a `erp_config` row update rather than
new code *in the common case*, but a specific customer's real data shape
(denormalized SAP fields, non-standard Odoo product taxonomy, a ZafraCloud
account structured differently than the documented example payloads) may
still require real engineering time to validate and map correctly — this
has not been tested against any live instance of any of the three, so the
actual effort for a first real customer on any of them is unproven, not
"zero."

### Scoring engine — **Live and verified** (math), mixed inputs

One Edge Function combines the weather/storm signal with the ERP inventory
data into the dashboard's numbers. No ML — every figure traces to a named
input:

1. **Severity** — `low`/`medium`/`high`, from flagged forecast days and
   nearby storm activity (or `unknown` if both live feeds fail — this
   deliberately does not default to "calm" when the system genuinely
   doesn't know).
2. **Expected delay by severity** — a disclosed modeling assumption (0 / 5 /
   10 days), not yet tuned to a real pilot's actual carrier lead times.
3. **Per SKU** (skipped if on-hand units or sales velocity is unknown; a
   genuine zero sales velocity correctly resolves to "infinite safety
   stock, not at risk" rather than being treated as missing data): if
   `onHandUnits / avgDailyUnitsSold` is less than the expected delay, the
   shortfall in units × unit price = that SKU's sales exposure — **or
   `null` with a stated reason if unit price itself is unknown, never a
   silent L0** (see `BUILD_LOG.md`'s 2026-09-22 "Data integrity" entry;
   deployed with the rest of `risk-recommendation` on 2026-09-23). If an alternate warehouse has
   stock, a candidate transfer of `min(shortfall, available)` units is
   costed at a **per-unit trucking rate read from config**
   (`risk_location_config.transfer_cost_per_unit_lps`). That transfer is
   only ever labeled **verified** when the source warehouse's own
   reorder point is known and wouldn't be breached — no adapter supplies
   that today, so every transfer currently reports **"candidate pending
   source-warehouse verification"** rather than being presented as ready
   to act on.
4. **Aggregate** — total exposure (or a stated "incomplete" flag if any
   SKU's exposure is unknown), total transfer cost, total transfer
   units, and an ROI multiple (exposure ÷ transfer cost) — suppressed to
   `null` with a reason rather than computed from a partial sum when
   exposure is incomplete. A computed, auditable ratio when available,
   never a fabricated confidence percentage.
5. **No recommendation is manufactured when none is warranted** — if
   severity is low, or every SKU has enough stock to cover the expected
   delay, the response says so plainly instead of inventing an alert.

This math has been verified against real live weather/storm data. The
*inventory* half of the input has only ever been exercised against a
real, live-connected source (Excel/OneDrive) with test/sample rows, not
an operating company's actual inventory — with the demo adapter or an
unvalidated Odoo/SAP B1/ZafraCloud connection, the math is real but the
numbers it's operating on are synthetic or entirely untested, not yet
proven against any customer's real data.

### Persistence — **Live and verified** (core save/read), mixed on the fix below

Every computed signal is saved (`risk_snapshots`), and every approve/
dismiss/undo click is saved as its own event (`recommendation_events`),
service_role-only tables. A Decisions view renders the real join of both
as history, with a real approval-rate figure.

- **Repository status:** fixed. `risk_snapshots` gained `environment`/
  `computation_source` columns (classified automatically) and a
  fingerprint-based dedup so a repeat page load increments a counter
  instead of inserting a new row; `decisions-list` now defaults to
  pilot-only data, adds a "decision coverage" metric, and reports which
  scope was used. Written, unit-tested (`decisions_metrics_test.ts`), and
  committed.
- **Production status:** deployed and verified live (2026-09-23). The
  migration adding those columns is applied; `decisions-list` defaults
  to pilot-only data. Confirmed via a real authenticated call during a
  2026-09-24 post-deployment audit: default params return
  `scope="pilot"`, `demoDataIncluded=false`, no non-pilot `environment`
  value anywhere in the response — see `SECURITY_AND_PILOT_BLOCKERS.md`.

### WhatsApp — mixed, template-by-template

A real Meta for Developers app and a free test WhatsApp number exist. What
"real" covers depends on which message. **`send-whatsapp-alert` and
`request-tracking-update` now require an authorized session, and
`whatsapp-webhook` now requires a verified Meta signature — all three
deployed and verified live (2026-09-23)**, per
`SECURITY_AND_PILOT_BLOCKERS.md` and `DEPLOYMENT_RUNBOOK.md` Section C
rows 11–16. This doesn't change whether a message actually sends, only
who's now allowed to trigger it.

- **`hello_world` (Meta's own generic default template) — Live and
  verified** (the send/receive mechanism and template), **current token
  validity not rechecked this review.** Previously verified working with
  a token configured without scheduled expiration; current token
  validity was not rechecked during this review. The token can still be
  revoked or invalidated (a Meta Business System User token, generated
  with expiration set to "Never" — not a guarantee against revocation,
  and not the previous short-lived console token that broke the send
  pipeline twice). No template approval needed; it's Meta's own
  pre-approved template.
- **A custom driver-tracking template (Spanish, asks a driver for a
  tracking number/ETA) — Live and verified, both directions.** Submitted
  to Meta, **approved**, and proven with a real outbound send and a real
  human reply correctly matched back to a shipment record. The specific
  template ID and the WhatsApp Business Account/phone-number identifiers
  are recorded in `whatsapp_config` and Meta's own console, intentionally
  not reproduced in this documentation.
- **A general risk-alert template (proactively pushing Utopia's own
  computed recommendation text to a business owner) — Planned, not built.**
  No such template has been submitted or approved. The send function
  already accepts a free-form-text code path for a 24-hour post-reply
  session window, but nothing calls it yet — sending arbitrary custom text
  today would go through a channel Meta hasn't approved for that purpose.
  This is a distinct, still-open item from the driver-tracking template
  above; the two should not be conflated.
- **Click-to-chat button in the dashboard — Live and verified, uses a real
  number.** This is a real verified test recipient number (not a
  placeholder), even though a stale code comment in
  `ruta-dashboard-fixed.html` still reads like a TODO to replace it — that
  comment is outdated, not the number itself. (Not fixed here: correcting
  a code comment is an application-code change, out of scope for this
  documentation pass.)

### Driver/provider WhatsApp tracking agent — **Live and verified, both directions**

A dashboard "Shipments" view backed by a real table, a real outbound send
(the approved custom template above), and a real **inbound** webhook that
matches a driver's reply back to the correct shipment and records it
(tracking number via a simple regex heuristic, or free-text as an ETA
note). Proven with a real phone conversation in both directions.

- **Repository status:** the signature-validation gap is fixed, and a
  second gap found and fixed on 2026-09-24 — the original message-ID
  idempotency only recorded "have we seen this id," not "did we finish
  processing it," so a real shipment-update failure after a successful
  delivery was silently and permanently lost (Meta was never told to
  retry, and a later retry would have been skipped as a duplicate
  before the update ran again). `whatsapp-webhook` now verifies Meta's
  `X-Hub-Signature-256` against `whatsapp_config.meta_app_secret` before
  parsing anything, and claims each message through a real
  processing/completed/failed/gave-up state machine (a
  `pg_advisory_xact_lock`-backed RPC, `claim_webhook_event`) so a
  message-ID alone never implies success, a genuine failure is
  retryable, an abandoned in-flight claim recovers, and concurrent
  duplicate deliveries can't both update the same shipment. Written,
  committed, and unit-tested (`webhook_idempotency_test.ts`).
- **Production status:** deployed and verified live (2026-09-23). The
  live webhook now rejects any POST without a valid `X-Hub-Signature-256`
  before parsing anything, and runs the real processing/completed/
  failed/gave-up state machine. Confirmed via `DEPLOYMENT_RUNBOOK.md`
  Section C rows 11–13: a valid signature is accepted and marked
  `completed`, an invalid one is rejected with zero row created, and a
  duplicate delivery of an already-completed message is a safe no-op.
  See `SECURITY_AND_PILOT_BLOCKERS.md`.

### Dashboard views — **Live and verified**

All eight sidebar views render real logic against real (or honestly-
labeled sample) data: Command, Inventory, Risks (7-day weather table + full
storm list), Decisions, Shipments, Integrations (real live-source status,
no logos for anything not actually built), Settings (location/radius/
currency editor — see below), and Add tools (ERP onboarding, with the
qualification above). Currency display (not conversion — no exchange-rate
math anywhere) is configurable per deployment.

**Language toggle — corrected claim.** Client-generated interface text
(nav labels, buttons, static copy, and dynamic sentences built from a
translation dictionary via the dashboard's own `tr()` helper) is fully
bilingual, Spanish/English. Server-generated severity explanations —
`corridor.reasons`, the plain-language sentences `risk-recommendation`
computes and the dashboard renders verbatim in the "why" panel — remain
**English-only regardless of the toggle**, confirmed directly in the
dashboard's own source (a comment at the render site already says this
comes from the server in English) and in `risk-recommendation/index.ts`
(the reason strings are hardcoded English, never localized). An earlier
version of this document's "covers every static and dynamic string"
claim did not draw this distinction and has been corrected here; it's
already listed correctly under "Planned" below.

**Authentication — deployed and verified, both frontend and backend.**
`index.html` and `ruta-dashboard-fixed.html` use a real Supabase Auth
magic-link sign-in and an `authedFetch()` wrapper on every protected
call, live since before this pass. As of 2026-09-23, all 15
`requireAuthorizedUser`-gated Edge Functions also check that real
session and the `pilot_authorized_emails` allowlist server-side — the
bearer token the dashboard sends is no longer a no-op. Verified live
via `DEPLOYMENT_RUNBOOK.md` Section C (rows 2, 5, 6, 7, 8) and a
2026-09-24 post-deployment audit; see `SECURITY_AND_PILOT_BLOCKERS.md`
for the full evidence.

### Hosting — **Live and verified**

Served via GitHub Pages on the public repository; confirmed live today (the
hosted root and the dashboard file both return a normal successful
response). The sign-in in front of it is a real Supabase Auth
magic-link login — see "Authentication — deployed and verified, both
frontend and backend" above and `SECURITY_AND_PILOT_BLOCKERS.md` for
the full picture of what it now protects, confirmed live.

### Visual design — **Live and verified**

Dark, monochrome UI. The accent color used for routine, on-every-load
informational states (a demo-data banner, a below-reorder flag) is a calm
amber — **this supersedes an earlier, contradictory description that
called the same variable "reserved strictly for danger" and gave it a
brighter alarm-red value; that description was accurate at an earlier point
in the project's history and is now stale, not current.** Genuine
high-severity/urgent states use a separate, independently-defined red that
was not affected by that change (confirmed by reading the CSS rule
directly, not inferred from a code comment claiming the two are linked —
see "Claims that could not be confirmed" in the task summary for this
review).

## Planned (not built)

- A real production domain (currently GitHub Pages' own subdomain).
- Formal Meta Business verification + an approved general risk-alert
  template for proactively messaging a business owner.
- Automatic/scheduled tracking-update requests (currently manual-button
  only, by design — "suggestion, never autonomous action").
- A sturdier tracking-code detector than the current regex heuristic.
- Bilingual server-side severity-reason strings (currently English-only
  regardless of the UI language toggle).
- Real ERP validation: an actual live Odoo instance, SAP B1 instance, or
  ZafraCloud account to test the three unvalidated adapters against.
