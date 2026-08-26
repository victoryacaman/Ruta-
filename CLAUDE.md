# RUTA — Import Resilience Intelligence

AI-assisted supply-chain risk intelligence for Honduran importers/distributors,
built as a thin layer on top of a customer's existing ERP — not a replacement
for it. Origin: San Pedro Sula, targeting the Puerto Cortés / CAFTA-DR import
corridor.

## Non-negotiable design principles

These came out of real back-and-forth on the idea and should not be relaxed
without a deliberate conversation:

- **Suggestion, never autonomous action.** The system recommends; a human
  approves. No purchase, transfer, or supplier action fires on its own. This
  is a trust and liability decision, not just a UX choice.
- **Explainable before predictive.** Start with a transparent, rule-based
  scoring function (e.g. storm severity × days of safety stock × transfer
  cost) rather than an ML model. Local logistics/customs data isn't clean or
  API-rich enough yet to trust a black box, and a rule a human can audit
  builds more trust with a first pilot customer than higher accuracy would.
- **Conservative alert volume on purpose.** Owner/manager approval fatigue is
  a real failure mode. Prefer fewer, higher-confidence suggestions over
  catching everything. Track approval/dismissal rate as a core product
  metric, not just an afterthought — it's both the feedback loop and the
  proof-of-value story for the next customer.
- **Every suggestion needs a visible "why."** Cite the specific signals
  behind a recommendation (which storm advisory, which SKU's stock level,
  which cost comparison) inline, not hidden behind a click.

## Current state

- `ruta-dashboard-fixed.html` — the dashboard UI, extended with: a
  live-vs-sample-data banner, an expandable "why this recommendation," a
  dismiss/undo flow, an urgency deadline on the decision card, and a
  WhatsApp click-to-chat button (`wa.me` link, currently a placeholder
  number).
- **Corridor risk signal is live** (build order step 2, done): the top
  risk-brief card and the SIGNAL WATCH panel's weather/tropical-system rows
  are computed from real data, not hardcoded. See "Signal ingestion
  (live)" below for exactly how.
- **ERP connector backend exists (step 3, done) but the dashboard still
  shows sample data.** The DECISION QUEUE card (PO-184, Tegucigalpa
  transfer, the L 1.24M exposure figure, the WhatsApp preview text) and the
  four top metric tiles are still illustrative — the connector isn't wired
  into the UI yet (that's step 4, which combines it with the live signal
  above). The dashboard labels this explicitly (a "Sample data" tag on the
  Decision Queue heading, and "ERP: not connected" in the top bar) so the
  two are never confused. See "ERP connector (live, demo mode)" below.

## Signal ingestion (live)

Build order step 2 is done. Two real, keyless public feeds, both scoped to
Puerto Cortés (15.8267, -87.9536) — the port the corridor runs through, not
San Pedro Sula:

- **Open-Meteo** — fetched directly client-side in
  `ruta-dashboard-fixed.html` (`fetchWeatherOutlook()`). Sets
  `Access-Control-Allow-Origin: *`, so no relay is needed. 7-day daily
  precipitation/wind/weather-code outlook; a day is flagged if its WMO
  weather code indicates heavy rain/thunderstorm (65, 82, 95, 96, 99), or
  precipitation exceeds 20mm, or max wind exceeds 40km/h.
- **NOAA/NHC `CurrentStorms.json`** — sets no CORS header at all, so a
  browser can't fetch it directly (confirmed empirically, not assumed).
  Relayed through a new Supabase Edge Function, **`storm-signal`**, in a
  **new, dedicated Supabase project** (name `RUTA`, ref `gcrnarueiybbavmkzhcv`,
  org `COMERSA`, `us-east-1`) — deliberately separate from the Batcomputer/
  attendance project (`bzesypxndifsycgxtpad`) so a future paying pilot
  customer's data never mixes with personal-ops infrastructure. Free tier.
  The function is read-only and unauthenticated by design (same pattern as
  Batcomputer's `gmail-summary`/`patrol-summary`/`attendance-feed`): it
  fetches NHC's public feed server-side, computes haversine distance from
  each active storm to Puerto Cortés, and returns only
  `{ok, fetchedAt, totalActiveGlobal, relevantRadiusKm, relevantStorms[],
  nearestStorm}` — storms are "relevant" within 2,500km. Called from the
  dashboard as `fetchStormSignal()`.
- **Combined severity rule** (transparent, auditable — no ML, per the
  design principles above): LOW/"MONITORING" by default; escalates to
  MEDIUM/"ELEVATED" if any weather day is flagged or any storm is within
  2,500km; escalates to HIGH/"HIGH EXPOSURE" if a relevant storm is
  classified HU (hurricane) or is within 500km. Every escalation names its
  exact trigger in the risk card's evidence row and copy.
- Tested against real feed responses (curled directly) and, since this
  session's sandboxed Chromium couldn't reach the public internet through
  its network policy in a way suitable for live browser testing, verified
  in an actual headless-Chromium run of the real dashboard file with the
  network layer mocked to return those real payloads — covering calm,
  elevated (weather-only), elevated (distant storm), escalation to high
  (nearby hurricane), and both-feeds-failing branches. All passed with zero
  JS errors. Worth a real live-network browser check once this is opened
  from an actual hosted URL rather than this dev sandbox.

## ERP connector (live, demo mode)

Build order step 3 is done, ahead of a named pilot: picking the actual
pilot customer and ERP is a business decision no AI agent can make, so
rather than block on it, the connector was built generic — a real pilot
later is a config change, not new code.

- **`erp_config` table** (Supabase project `RUTA`, same project as
  `storm-signal`) — RLS enabled, no policies (service_role only, same
  locked-down pattern as `gmail_oauth`/`oracle_config`). One row:
  `provider` (`demo`|`odoo`|`sap_b1`), `base_url`, `database_name` (Odoo),
  `company_db` (SAP B1), `username`, `password`, `sku_shortlist`. Currently
  seeded `provider='demo'`. Onboarding a real pilot is one `UPDATE` to this
  row, not a redeploy.
- **`erp-inventory` Edge Function** — read-only, unauthenticated by design
  (no write capability exists in the function at all). Reads the config
  row, dispatches to one of three adapters, returns only
  `{ok, provider, fetchedAt, items[]}` — never credentials.
  - **Demo adapter** (fully real, fully tested): three fixed mock SKUs
    (`AUT-2201` 12V LED headlight kit, `AUT-3387` ceramic brake pads,
    `AUT-4410` car battery) whose alternate-warehouse units deliberately
    total exactly 420 — matching the existing Decision Queue's "420 units
    from Tegucigalpa," so step 4's wiring will visibly reproduce
    continuity with today's reference UI.
  - **Odoo adapter** — JSON-RPC (`common.authenticate` +
    `object.execute_kw` on `product.product`, plus a best-effort
    `sale.order.line` query for trailing-30-day sales velocity). Written
    against Odoo's documented, stable external API shape.
  - **SAP B1 adapter** — Service Layer REST (`POST /b1s/v1/Login` for a
    session cookie, `GET /b1s/v1/Items` filtered by `ItemCode`, expanding
    `ItemWarehouseInfoCollection` for multi-warehouse units). Written
    against the documented Service Layer OData shape.
  - **Honest caveat:** the demo adapter is proven — called directly and
    verified end-to-end. The Odoo and SAP B1 adapters are **not** —
    there's no live pilot ERP to test against yet, so their correctness
    rests on documented API contracts, not an empirical test. Validate
    against a real instance before trusting them with a real pilot.
  - Neither real adapter queries per-warehouse stock or sales velocity as
    completely as the demo data does (Odoo returns no alternate-warehouse
    units yet; SAP B1's sales velocity isn't implemented yet) — noted as
    a refinement once a real pilot's warehouse/sales-history layout is
    known, not built blind.

## Pilot target — still needed before a REAL pilot goes live

The connector above works in demo mode without this. It's still needed
before pointing it at an actual company's ERP:

- Pilot customer: ______
- Their ERP: Odoo (XML-RPC/REST API) or SAP Business One (Service Layer REST
  API)? ______
- 5–10 fastest-moving / most exposed SKUs to track first (don't try to sync
  the whole catalog): ______

## Build order

1. **Pick pilot partner + ERP** — business decision, not a coding task,
   and not a blocker for steps 2–3 below (both were built generic/demo so
   a real pilot is a config change later, not new code). Still needed
   before any real pilot goes live — see the section below.

2. **~~Real risk signal ingestion.~~ Done.** See "Signal ingestion (live)"
   above for exactly what was built and how it was tested.

3. **~~Read-only ERP connection.~~ Done, in demo mode.** See "ERP
   connector (live, demo mode)" above — generic Odoo/SAP B1 adapters
   exist but are unverified against a live instance; the demo adapter is
   fully real and is what the connector actually returns today.

4. **Rule-based scoring engine**, not ML (see principles above). Combine the
   signal from step 2 with the inventory data from step 3 into a real
   "inventory at risk" number and a ranked recommendation, replacing the
   sample data in the UI.

5. **Persistence layer.** Store risk scores, recommendations, and — most
   importantly — every approve/dismiss/timestamp event. Supabase is a
   reasonable default (Postgres, instant REST API, fast to stand up for a
   single-customer pilot); use it unless there's a reason not to.

6. **WhatsApp, real path, two speeds:**
   - Fast/pilot: Meta's Cloud API gives a free test WhatsApp number and a
     pre-approved `hello_world` template instantly, no business verification
     needed. Enough to actually message a known test recipient (e.g. the
     pilot's procurement lead) during the pilot.
   - Later/production: full Meta Business verification (2–10 business days,
     needs tax ID/incorporation docs) + a custom approved message template,
     once messaging real customers beyond a known test list.

7. **Before showing this to the real pilot customer:**
   - Real domain (not an AI-builder default subdomain) — non-negotiable
     before connecting real ERP or carrier credentials.
   - Basic auth — even single-tenant — before any real ERP data flows
     through this.

## Pilot success metrics (already agreed on)

Lead with what's provable in a 4–8 week pilot, not the eventual steady-state
numbers:

- Advance warning time on flagged disruptions (directly measurable, no
  attribution problem).
- Suggestion approval/dismissal rate.
- 1–2 concrete "we flagged X and you avoided it" stories.

Treat published industry benchmarks (e.g. 10–20% forecast error reduction,
5–12% inventory reduction) as the expected steady-state outcome after 6–12
months of live use, not something to promise inside the pilot window itself
— they're hard to prove with small SKU counts and short observation periods.
