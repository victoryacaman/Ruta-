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
- **The whole Command dashboard is now computed, end to end** (steps 2–4
  done): the risk-brief card, SIGNAL WATCH panel, all four metric tiles,
  and the DECISION QUEUE card (headline, urgency note, recommendation,
  ROI, "why" list, and WhatsApp preview text) are all driven by one live
  scoring-engine call — nothing on the Command view is hardcoded anymore.
  See "Signal ingestion (live)" and "Scoring engine (step 4)" below.
- **What's still sample, and clearly labeled as such:** the underlying
  *inventory numbers* (three mock SKUs) come from the ERP connector's demo
  adapter, not a real customer's ERP — the top bar says "ERP: not
  connected" and the Decision Queue heading carries a "Demo ERP data" tag
  that updates automatically once a real pilot's `provider` is set to
  `odoo`/`sap_b1` in `erp_config`. The *math* combining that inventory with
  the live signal is real, not a demo.

## Signal ingestion (live)

Build order step 2 is done. Two real, keyless public feeds, both scoped to
Puerto Cortés (15.8267, -87.9536) — the port the corridor runs through, not
San Pedro Sula:

- **Open-Meteo** — 7-day daily precipitation/wind/weather-code outlook, no
  auth, sets `Access-Control-Allow-Origin: *`. A day is flagged if its WMO
  weather code indicates heavy rain/thunderstorm (65, 82, 95, 96, 99), or
  precipitation exceeds 20mm, or max wind exceeds 40km/h.
- **NOAA/NHC `CurrentStorms.json`** — sets no CORS header at all, so a
  browser can't fetch it directly (confirmed empirically, not assumed).
  Relayed through a Supabase Edge Function, **`storm-signal`**, in a
  **new, dedicated Supabase project** (name `RUTA`, ref `gcrnarueiybbavmkzhcv`,
  org `COMERSA`, `us-east-1`) — deliberately separate from the Batcomputer/
  attendance project (`bzesypxndifsycgxtpad`) so a future paying pilot
  customer's data never mixes with personal-ops infrastructure. Free tier.
  Read-only, unauthenticated by design (same pattern as Batcomputer's
  `gmail-summary`/`patrol-summary`/`attendance-feed`): fetches NHC's public
  feed server-side, computes haversine distance from each active storm to
  Puerto Cortés, returns only `{ok, fetchedAt, totalActiveGlobal,
  relevantRadiusKm, relevantStorms[], nearestStorm}` — storms are
  "relevant" within 2,500km.
- **As of step 4, neither feed is called directly from the browser
  anymore.** Both are fetched server-side by the `risk-recommendation`
  function (see "Scoring engine (step 4)" below), which is now the single
  source of truth for corridor severity — the dashboard makes one call and
  renders the result, rather than computing severity client-side itself.
  This avoids two implementations of the same rule drifting apart.

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

## Scoring engine (step 4)

Build order step 4 is done: a single Edge Function, **`risk-recommendation`**
(same Supabase project), combines steps 2 and 3 into the actual numbers the
Command dashboard shows — no ML, every figure traceable to a named input,
per the design principles above. Called once by the dashboard on load;
its response drives the risk-brief card, Signal Watch, all four metric
tiles, and the Decision Queue in one pass.

- **Expected delay by severity** (a disclosed modeling assumption, not
  hidden): low → 0 days, medium → 5 days, high → 10 days. Tune once a real
  pilot's actual carrier lead times are known.
- **Per SKU** (skipped if no sales-velocity data exists): `daysOfSafetyStock
  = onHandUnits / avgDailyUnitsSold`. If that's less than the expected
  delay, the gap in days × daily sales = `unitsShort`, and
  `unitsShort × unitPrice` = that SKU's sales exposure. If an alternate
  warehouse has stock, the recommended transfer is
  `min(unitsShort, availableUnits)`, costed at a flat **L45/unit** regional
  trucking assumption (also disclosed, not hidden — replace with a real
  quote before a real pilot).
- **Aggregate**: total exposure, total transfer cost, total transfer units,
  and an **ROI multiple** (`exposure ÷ transfer cost`) — this replaces the
  old mockup's fabricated "84% confidence" badge. A confidence percentage
  with no real basis is exactly the kind of black-box number the design
  principles warn against; a computed cost-benefit ratio is auditable, so
  it's what's shown instead.
- **No recommendation is manufactured when none is warranted** (the
  "conservative alert volume" principle enforced at the data layer, not
  just the UI): if severity is low, or every SKU has enough stock to cover
  the expected delay, `recommendation.applicable` is `false` and the
  Decision Queue shows a calm empty state instead of an invented alert.
- **Honesty fix worth noting**: the first version of this function let a
  fully-failed weather *and* storm fetch silently default to
  severity `"low"` — i.e., "we don't know" rendered identically to "we
  checked and it's calm." Caught in testing, not shipped. Both feeds
  failing now produces a distinct `"unknown"` severity ("SIGNAL
  UNAVAILABLE", grey, `?` icon) that pauses recommendations rather than
  guessing — the same fix was applied to the dashboard's own
  fetch-failure fallback. This is the same "say so plainly rather than
  guessing" rule as everywhere else in this file, just easy to miss when
  two upstream failures combine.
- **Tested**: the real end-to-end demo path was verified against live
  Open-Meteo/NHC/erp-inventory data (result at time of writing: medium
  severity from real forecasted weather, one SKU — the 12V car battery —
  5 units short, L7,250 exposure, L225 transfer cost, 32.2x ROI — numbers
  will legitimately change run to run as real weather/storms change).
  Every rendering branch (calm, elevated/weather-only, elevated/distant
  storm, high/hurricane multi-SKU, an at-risk SKU with no transfer source,
  the endpoint being unreachable, and both upstream feeds failing) was
  verified in an actual headless-Chromium run of the real dashboard file
  with network responses mocked to exact real/representative payloads —
  same sandboxed-Chromium/proxy limitation on live browser network testing
  noted for steps 2–3 applies here too; worth a real live-network check
  once hosted.

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
   and not a blocker for steps 2–4 below (all built generic/demo so a real
   pilot is a config change later, not new code). Still needed before any
   real pilot goes live — see the section below.

2. **~~Real risk signal ingestion.~~ Done.** See "Signal ingestion (live)"
   above for exactly what was built and how it was tested.

3. **~~Read-only ERP connection.~~ Done, in demo mode.** See "ERP
   connector (live, demo mode)" above — generic Odoo/SAP B1 adapters
   exist but are unverified against a live instance; the demo adapter is
   fully real and is what the connector actually returns today.

4. **~~Rule-based scoring engine.~~ Done.** See "Scoring engine (step 4)"
   above — the Decision Queue's numbers are now real math over steps 2–3's
   data, not sample data, though the underlying SKUs are still the demo
   adapter's mock inventory until a real pilot connects.

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
