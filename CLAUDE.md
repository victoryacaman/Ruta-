# Utopia — Supply Resilience Intelligence

AI-assisted supply-chain risk intelligence for Honduran importers/
distributors, built as a thin layer on top of a customer's existing ERP —
not a replacement for it. Origin: San Pedro Sula. The scoring engine
(weather/storm severity × days-of-safety-stock × transfer cost) isn't
port-specific — it applies just as well to a regional/national
distributor's real exposure (a flooded highway between warehouse and
stores, severe weather at a domestic supplier's city) as to an importer's
Puerto Cortés / CAFTA-DR corridor. **As of the geography generalization
below, the monitored location is a config value (`risk_location_config`),
not a hardcoded assumption** — Puerto Cortés is the seeded default, one
valid example configuration, not the whole premise.

**Visual identity**: renamed from RUTA to Utopia (display text only — repo,
filenames, and all Supabase infra names are unchanged, see the git history
for exact scope). Theme is a monochrome dark UI (near-black surfaces, off-
white text, `--teal` repurposed as a near-white primary accent) with exactly
one reserved color, `--orange` (`#ff4444`), kept strictly for genuine
danger/urgency signals (the high-severity risk card, the inventory-at-risk
metric, the alert badge count) — everything else (medium/warning states,
generic status pills) uses grayscale shades instead of hue, so the one red
in the UI always means something real.

**Live-proof pass**: after showing this to people who needed convincing the
tool is real, not a mockup, a few things were tightened so the live parts
are unmistakably live and the unbuilt parts stop reading as broken:
- `WHATSAPP_NUMBER` now points at the real verified test recipient
  (`50499394433`) instead of the placeholder fake number the original
  reference build shipped with — the click-to-chat button actually opens a
  real conversation now.
- **Approve is no longer a fire-and-forget toast.** Clicking it now
  disables the button, relabels it `✓ Approved · <time>`, and disables
  the neighboring Compare/Not now buttons — a persistent, visible
  confirmation that the decision was recorded (matches what `dismissCard()`
  already did), not just a message that vanishes in 2.4 seconds. Backed
  by the same real `recordEvent()` → `recommendation-action` write from
  step 5.
- The notification bell now calls `showNotificationSummary()`, which
  builds its message from the same `lastResult` the rest of the page
  renders from (severity, at-risk count, last-computed time) — real data,
  not a decorative dead end.
- The remaining unbuilt pieces (Compare all options, View all 6, Open
  signal center, and every sidebar nav item other than Command) were
  reworded from "Not wired in this reference build" — which reads as
  *broken* — to explicit roadmap framing ("X is on the roadmap next; here's
  what's live today"). Nothing was actually built out for these; only the
  honesty of what they say changed. Building any of them out for real is
  still open, scoped by whatever a real pilot actually needs first.

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
- **Approve/dismiss/undo are real events now, not just UI state** (step 5,
  done): every click is persisted. See "Persistence (step 5)" below.
- **A real WhatsApp send pipeline exists** (step 6, pilot path, done): a
  free Meta test number can actually deliver messages to a verified
  recipient today. See "WhatsApp (step 6, pilot path)" below for exactly
  what that does and doesn't cover yet.

## Signal ingestion (live)

Build order step 2 is done. Two real, keyless public feeds, both scoped to
a **configurable monitored location** (see "Geography: configurable risk
location" below) — Puerto Cortés (15.8267, -87.9536) is the seeded
default, not a hardcoded assumption:

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
  the configured location, returns only `{ok, fetchedAt, locationName,
  totalActiveGlobal, relevantRadiusKm, relevantStorms[], nearestStorm}` —
  storms are "relevant" within `relevantRadiusKm` (2,500km default).
- **As of step 4, neither feed is called directly from the browser
  anymore.** Both are fetched server-side by the `risk-recommendation`
  function (see "Scoring engine (step 4)" below), which is now the single
  source of truth for corridor severity — the dashboard makes one call and
  renders the result, rather than computing severity client-side itself.
  This avoids two implementations of the same rule drifting apart.

### Geography: configurable risk location

Originally both functions hardcoded Puerto Cortés' coordinates — fine for
a single-port pilot, wrong as a product assumption once a medium-sized
national/regional distributor is the target too. Fixed by a new
**`risk_location_config`** table (RLS enabled, no policies —
service_role only, same lockdown pattern as `erp_config`/`whatsapp_config`):
`location_name`, `lat`, `lon`, `relevant_radius_km` (default 2500).
`storm-signal` and `risk-recommendation` both read the single row
server-side instead of a hardcoded constant (falling back to the Puerto
Cortés default if the table is ever empty/unreachable, so a transient
config issue never breaks the feed); `risk-recommendation`'s response
carries `locationName` so the dashboard renders whatever location a given
deployment is configured for instead of hardcoding "Puerto Cortés."
Onboarding a new deployment to a different city is now one `UPDATE`, not
a code change.

**Honest caveat**: `relevant_radius_km` was calibrated for coastal/port
tropical-storm relevance. An inland business's real exposure leans much
more on the Open-Meteo weather signal than on distance to a tropical
system — the storm-distance number is less meaningful the further inland
the configured location is. Not tuned per-location yet; a real inland
pilot would be the forcing function to revisit this.

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

## Persistence (step 5)

Build order step 5 is done: two tables (same Supabase project), RLS
enabled with **no policies on either** — service_role only, same lockdown
pattern as `gmail_oauth`/`oracle_config`/`erp_config`, applied here even
though neither table holds secrets, so there's one consistent access model
for the whole project rather than a special case for "data that happens to
be non-sensitive." The dashboard never talks to Postgres directly; it only
calls Edge Functions.

- **`risk_snapshots`** — one row per `risk-recommendation` computation
  (`computed_at`, `severity`, `erp_provider`, `total_exposure_lps`,
  `roi_multiple`, `sku_count`, plus the full response as `full_response`
  jsonb for a complete audit trail / "why" reconstruction later).
  `risk-recommendation` writes this itself before responding, and returns
  the new row's id as `snapshotId`. Persistence is best-effort: a write
  failure is logged server-side but doesn't block the dashboard from
  showing today's signal.
- **`recommendation_events`** — one row per approve/dismiss/undo click,
  referencing a `risk_snapshots.id`. Written by a new function,
  **`recommendation-action`** (`POST {snapshotId, eventType, note?}`,
  `eventType` one of `approved`/`dismissed`/`undone`). Unauthenticated by
  design for now (no login system exists yet — step 7's "basic auth" is
  still pending a real pilot) and deliberately narrow: it can only append
  an event row referencing a snapshot that already exists — it cannot
  read, modify, or fire any purchase/transfer/supplier action itself,
  enforcing "suggestion, never autonomous action" at the infrastructure
  level, not just in the UI copy.
- **Dashboard wiring**: dismiss ("✕ Not now"), undo, and the decision
  card's primary button (renamed **"Approve recommendation"**, since it
  now actually logs an approval rather than being a no-op "Review" label)
  all call `recordEvent()`, which fires-and-forgets a call to
  `recommendation-action` using the current page load's `snapshotId`
  before updating the UI. A logging failure doesn't block the human's
  dismiss/undo from working — recorded via `console.error`, not surfaced
  as a blocking error.
- **Deliberately out of scope for this pass**: dismissing a recommendation
  doesn't make it "smart-sticky" across reloads (e.g. suppressing it until
  the storm track changes, as the mockup's original placeholder copy
  claimed) — each page load computes a fresh snapshot, so a dismiss only
  covers that one snapshot's card for that session. Making dismissal
  persist across reloads based on whether the underlying signal actually
  changed is a reasonable future refinement, not something the build
  order's step 5 text requires ("store... every approve/dismiss/timestamp
  event" — which this does).
- **Verified**: called `risk-recommendation` for a real `snapshotId`,
  posted a real `dismissed` event against it via `recommendation-action`,
  confirmed an invalid `eventType` is rejected cleanly, and read both rows
  back directly from Postgres to confirm they match. Separately verified
  in a real headless-browser click-through (approve → dismiss → undo) that
  all three actions fire the correct request body and the UI transitions
  correctly, with zero JS errors.
- This is also what makes "suggestion approval/dismissal rate" (one of
  the pilot success metrics below) an actual query away, once there's
  enough real usage to query — `recommendation_events` joined to
  `risk_snapshots` — rather than a metric with nothing behind it.

## WhatsApp (step 6, pilot path)

Build order step 6 is done for the pilot/fast path: a real Meta for
Developers app ("Ruta") exists, with WhatsApp added as a use case and a
free test number set up through Meta's own console (that part needs a
human's Facebook login — not something done from this repo). The result:

- **`whatsapp_config` table** (same Supabase project) — RLS enabled, no
  policies (service_role only, same lockdown pattern as
  `gmail_oauth`/`oracle_config`/`erp_config`). Holds the test number's
  `phone_number_id` (`1224515280752830`), `whatsapp_business_account_id`
  (`1598150905037308`), the live access token, and the verified test
  recipient (`50499394433`). The token is a **temporary, 24h credential**
  from Meta's console — `token_issued_at`/`token_expires_at` are tracked
  so it's visible when it's likely gone stale; getting a longer-lived
  token (via a Meta Business System User) is a natural next step once
  this needs to run unattended rather than be triggered manually.
- **`send-whatsapp-alert` Edge Function** — read-only-in-scope,
  unauthenticated by design (same reasoning as `recommendation-action`:
  it can only send using the config already on file, nothing else, and
  sending a message isn't a purchase/transfer/supplier action under the
  non-negotiable principles). Calls the real WhatsApp Cloud API
  (`graph.facebook.com/v25.0/{phone_number_id}/messages`) with the stored
  token.
- **Real constraint, not glossed over**: WhatsApp's Cloud API only allows
  two kinds of outbound messages — a **pre-approved template** (right now,
  only the generic `hello_world` template that Meta provides by default;
  a *custom* template carrying Utopia's actual alert wording needs formal
  Meta Business verification, which this project has deliberately
  deferred), or **free-form text**, but only within a 24-hour window after
  the recipient has messaged the business number first. So this pipeline
  is proven end-to-end for `hello_world` — it does **not** yet let Utopia
  proactively push its real computed recommendation text over WhatsApp.
  The function already accepts a `mode:"text"` path for the session-window
  case, but nothing calls it yet, since using it today would mean sending
  arbitrary custom text through a channel Meta hasn't approved for that —
  exactly the "later/production" distinction this build order's step 6
  text already drew.
- **Not wired to the dashboard's UI** — the existing WhatsApp preview
  card's `wa.me` click-to-chat link still works as before (user-initiated,
  no template restriction) and is untouched. `send-whatsapp-alert` is a
  separate, proactive-push capability; deliberately not hooked up to a
  dashboard button or a schedule yet, since firing it automatically needs
  either the custom-template approval above or an explicit trigger policy
  neither of which exists yet.
- **Verified for real**: called the function live, got `{ok:true}` back
  from the actual WhatsApp Cloud API, and the user confirmed receiving the
  `hello_world` message on the verified test number.

## Hosting & access gate

With no real pilot yet, buying a domain (part of build order step 7) is
premature — nothing was worth gating or spending money on. Once the user
decided to prep for demoing this to a prospect, the pragmatic middle
ground: host it free, add a lightweight gate, skip the domain purchase
until there's an actual prospect to justify it.

- **Hosting**: GitHub Pages on this repo, same pattern as the Batcomputer
  attendance panel. The repo is already public (`has_pages` still needs
  the one-time manual toggle in **Settings → Pages → source: branch
  `main`, folder `/`** — no API for this, has to be a human clicking it).
  Once enabled: `https://victoryacaman.github.io/Ruta-/`.
- **`index.html`** — a new sign-in gate page (the file GitHub Pages serves
  at the bare root URL). Checks a password against a constant in its own
  script, and on success sets `sessionStorage.ruta_authed` and redirects
  to `ruta-dashboard-fixed.html`. Current code: `PuertoCortes2026` —
  trivially changed by editing the `ACCESS_CODE` constant in `index.html`.
- **Guard script in `ruta-dashboard-fixed.html`** — checks the same
  session flag on load and bounces back to `index.html` if it's not set,
  so the dashboard isn't reachable by just guessing its filename.
- **Honest about what this is not**: this is a client-side deterrent, not
  real access control. The password lives in plain JS anyone can read via
  view-source, and `sessionStorage` is trivially spoofable from devtools.
  It's a reasonable bar while the dashboard only shows demo ERP data to a
  handful of people previewing the pilot pitch. It is **not** the "basic
  auth" build-order step 7 means before real ERP data flows through this
  — that still needs real backend-enforced auth (e.g. Supabase Auth
  gating the Edge Functions themselves, or a proper reverse-proxy auth
  layer) once an actual pilot's data is involved. Step 7 stays open.
- **Verified locally** (headless-browser test, network mocked): direct
  navigation to the dashboard without auth bounces to the gate; a wrong
  code shows an error and stays there; the right code redirects through
  and the dashboard renders; reloading within the same session stays
  authenticated. Not yet verified against the live hosted URL, since
  Pages isn't enabled yet.

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

5. **~~Persistence layer.~~ Done.** See "Persistence (step 5)" above —
   `risk_snapshots` + `recommendation_events`, written by
   `risk-recommendation` and a new `recommendation-action` function.

6. **~~WhatsApp.~~ Fast/pilot speed done.** See "WhatsApp (step 6, pilot
   path)" above — real send pipeline, verified live, limited to the
   `hello_world` template or a 24h session-window reply until:
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

## Future connections — to wire up

Not started. Documented here so they aren't lost, not because either is
scheduled next.

- **Driver/provider WhatsApp tracking agent.** Idea: a WhatsApp agent that
  proactively messages the **delivery driver/provider** (confirmed — not
  the end customer) asking for a tracking number or ETA (e.g. "¿Te
  gustaría enviar un número de seguimiento con código de rastreo?"),
  replacing the common Honduran pattern of manually calling a carrier to
  check status against a delivery deadline. Natural home: the currently-
  unbuilt "Shipments" nav item. Explicitly **not built**: everything today
  (`send-whatsapp-alert`) is outbound-only — this needs (1) inbound
  WhatsApp webhook handling (a new capability, not an extension of the
  existing send pipeline), and (2) a new shipments/deliveries data model
  (carrier, deadline, status) that doesn't exist yet. Also gated by the
  same Meta template-approval/24h-window constraint already deferred in
  the WhatsApp section above, since a proactive outbound prompt is
  free-form text outside an existing session window.
