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

**Prospect-presentation pass**: an external checklist for showing this to
an actual pilot prospect flagged several real, verified issues, being
fixed one at a time (this pass covers the first batch):
- Internal build jargon visible in the live UI ("build order step 3,"
  "pending a named pilot," "roadmap," Meta's template-approval status) —
  removed from every user-visible string (mode banner, ERP sync button,
  the three stub-view toasts, the roadmap-placeholder copy). Reworded
  toward what a prospect actually needs to know (e.g. the ERP button now
  says connecting Excel/Odoo/SAP B1 is "a configuration step, not new
  engineering" — turning an honesty note into a selling point) rather
  than just deleting the internal detail.
- **Severity-wording inconsistency, real bug**: sentences like the
  Decision Queue headline printed the raw internal value ("...during the
  medium corridor signal") right next to a badge reading "ELEVATED" —
  same severity, two different words. Fixed with a single
  `severityLabel()` helper used everywhere severity appears in a
  sentence, so the wording always matches the badge.
- **"SKU(s)" grammar** — fixed with a `skuWord(n)` helper (singular vs.
  plural) used in every count-dependent sentence, instead of the
  awkward literal "(s)".
- **Fabricated count on "View all 6"** — there's no real list of 6 cases
  behind it (this build only ever surfaces one live recommendation at a
  time); reworded to "View all cases" rather than inventing a number.
  Same fix applied to a "4" notification badge on the Risks nav item that
  had nothing real behind it either — removed.
- **Hard-coded date** ("WEDNESDAY, AUGUST 26" never changed) — now set
  from `new Date()` on load.
- **Mobile layout bug, real and reproduced**: the live-data mode banner
  collapsed into a squeezed, unreadable narrow column on phone-width
  viewports (confirmed via a Playwright mobile-viewport screenshot before
  and after — banner height dropped from 469px to 180px). Root cause: the
  banner's flex children had no `min-width:0`/`flex-wrap`, so the browser
  compressed the tag and the long copy text into narrow columns instead
  of wrapping normally. Fixed with a mobile media query that stacks the
  banner vertically instead of fighting the flex layout.
- **Real bug: the sign-in redirect used a relative path** (`index.html`),
  which resolves to whatever file happens to share the same folder —
  confirmed as the cause of a reported case where an emailed copy of the
  dashboard file, opened next to an unrelated project's `index.html`,
  silently redirected there instead of Utopia's own sign-in page. Fixed
  by hardcoding the absolute hosted URL
  (`https://victoryacaman.github.io/Ruta-/index.html`) as the redirect
  target, so an unauthenticated visitor always lands on the correct page
  regardless of how the file was opened. The real underlying practice
  fix, though: **present only the hosted link, never the raw HTML file**
  — emailing/downloading the file is what exposes this failure mode (and
  hands over internal endpoint/test details) in the first place.
- **Cleared all development test data** before any prospect sees this:
  both test shipments ("Victor," "Webhook verification" — artifacts from
  proving the WhatsApp send/webhook paths work) and all 19
  `risk_snapshots` / 7 `recommendation_events` rows from today's testing.
  Decided against pre-seeding replacement "clean" sample data — the
  stronger plan (per the user's own call) is proving this live, in
  person: create a shipment with a realistic name/PO on the spot, click
  Request tracking update, show the real WhatsApp message arrive, reply,
  watch the dashboard update — and let a couple of live page reloads
  during the visit naturally seed a few genuinely fresh Decisions
  entries. Watching it happen beats a static history a prospect has to
  take on faith.

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
  `provider` (`demo`|`odoo`|`sap_b1`|`excel`), `base_url`, `database_name`
  (Odoo), `company_db` (SAP B1), `username`, `password`, `sku_shortlist`,
  `excel_workbook_path` (default `/Utopia-Inventory.xlsx`),
  `excel_table_name` (default `InventoryTable`). Currently seeded
  `provider='demo'`. Onboarding Odoo/SAP B1 is one `UPDATE` to this row,
  not a redeploy; onboarding Excel is the real "Connect with Microsoft"
  button — see the dedicated section below.
- **`erp-inventory` Edge Function** — read-only, unauthenticated by design
  (no write capability exists in the function at all). Reads the config
  row, dispatches to one of four adapters, returns only
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
  - **Excel adapter** — real Microsoft Graph read of a named Table in a
    OneDrive workbook, refreshing the OAuth access token first if it's
    near/past expiry. This is the one self-service adapter — no
    credentials to write anywhere, just a real Microsoft sign-in. Full
    detail in the dedicated section below.
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
- **Dashboard Inventory view**: the previously-placeholder Inventory nav
  item now renders this connector's actual data — the same shape the
  scoring engine is measured against, not a mockup. Summary strip (SKUs
  tracked, count below reorder point, total inventory value, fetch time)
  plus a per-SKU row showing on-hand vs. reorder point (flagged if below),
  days of safety stock (same formula as the scoring engine:
  `onHandUnits / avgDailyUnitsSold`), unit price, and alternate-warehouse
  availability. This is the single most important placeholder to have
  fixed before showing anyone this build — ERP/Excel connectivity is the
  actual product thesis, and until this existed a prospect had no way to
  see it working at all. Verified headless with mocked data (math checks
  out: 96×249 + 400×1450 = 603,904) and confirmed live against the real
  deployed `erp-inventory` endpoint.

## Excel / OneDrive connector (Microsoft OAuth, live)

The dashboard's "ERP: not connected" topbar button and its Excel copy
used to be pure promise — clicking it only opened a toast, and no adapter
existed. It's now real: a genuine Microsoft sign-in, no password ever
touching this dashboard, wired to the same `erp_config`/`erp-inventory`
plumbing as Odoo/SAP B1.

- **Azure app registration** — a real app registration in Microsoft Entra
  ID/Azure Portal, created by the user (no tool here can create one).
  Supported account types: "Accounts in any organizational directory and
  personal Microsoft accounts" — matches the `/common` OAuth endpoint, so
  both personal Microsoft accounts (OneDrive personal) and work/school
  Microsoft 365 accounts can sign in through the same app. Redirect URI:
  `https://gcrnarueiybbavmkzhcv.supabase.co/functions/v1/excel-oauth-callback`.
  Delegated Graph permissions: `Files.Read`, `offline_access`,
  `User.Read`.
- **`excel_oauth` table** — RLS enabled, no policies (service_role only,
  same lockdown pattern as `erp_config`/`whatsapp_config`). One row:
  `client_id`, `client_secret` (the Azure app's own credentials — set once
  by a Utopia contact, never through a client form), `access_token`,
  `refresh_token`, `token_expires_at`, `connected_account_email`
  (informational only, shown as "Connected as ...").
- **Three Edge Functions**, all unauthenticated by design (same reasoning
  as every other read/redirect path in this project):
  - **`excel-oauth-start`** — reads `client_id`, builds the Microsoft
    `/common/oauth2/v2.0/authorize` URL, 302-redirects the browser
    straight to Microsoft's own login page. `client_id` never appears in
    the dashboard's own source.
  - **`excel-oauth-callback`** — exchanges the returned code for tokens
    server-side, calls Graph `/me` for the connected account's email,
    stores everything in `excel_oauth`, and sets `erp_config.provider =
    'excel'` — connecting makes Excel the live source immediately, which
    is the actual point of a self-service "Connect" button. Redirects
    back to the dashboard with `?excel=connected` or
    `?excel=error&excel_msg=...` — a status flag only, never a token.
  - **`excel-status`** — read-only `{ok, connected, email}`, backs the
    Add tools card and Integrations row. Never returns tokens.
  - **Known simplification, disclosed rather than hidden:** the OAuth
    `state` parameter is generated and passed through as a basic
    round-trip sanity check, not stored and compared server-side for real
    CSRF protection. This is a single-tenant pilot tool with no
    session/login system yet (build order step 7, below, is still open),
    so there's no per-visitor state to check it against — a real
    multi-tenant deployment would need that piece built first.
- **`erp-inventory`'s Excel adapter** — reads `excel_oauth`, refreshes the
  access token via the stored refresh token when it's within 5 minutes of
  (or past) expiry, then calls Microsoft Graph's named-Table-rows
  endpoint (`GET /v1.0/me/drive/root:{excel_workbook_path}:/workbook/tables('{excel_table_name}')/rows`)
  and maps each row into the same `SkuInventory` shape every other
  adapter returns.
- **Workbook template** — the user creates a OneDrive Excel file matching
  this exact layout (no existing workbook to map to, so this is the
  agreed-on contract): one worksheet, header row, data formatted as a
  **named Table** (Insert → Table / Ctrl+T, then rename via the Table
  Design tab). Columns, in order: `SKU | Name | OnHandUnits |
  ReorderPoint | AvgDailyUnitsSold | UnitCost | UnitPrice |
  AltWarehouseLocation | AltWarehouseUnits`. A SKU with more than one
  alternate-warehouse location gets one extra row per location, same SKU
  repeated — the adapter groups rows by SKU. `erp_config.excel_workbook_path`
  and `excel_table_name` hold the real file path/table name (not
  necessarily the `/Utopia-Inventory.xlsx` / `InventoryTable` defaults —
  see the real pilot values noted below), same "config, not code" pattern
  as Odoo's `base_url`/SAP's `company_db`.
- **Dashboard wiring**: the topbar's "ERP: not connected" button now
  navigates to Add tools instead of showing a toast. Add tools gained a
  real "Microsoft Excel / OneDrive" card — "Connect with Microsoft" when
  not connected, "Connected as {email}" when it is. Integrations gained a
  matching live-status row. Landing back from Microsoft with
  `?excel=connected` shows a toast and jumps straight to Add tools so the
  new connection is visible immediately; `?excel=error` shows the error
  and stays put. Command's Decision Queue ERP tag and the Signal Watch
  "Excel / ERP context" row both read `erpProvider` from
  `risk-recommendation` and now recognize `excel` alongside `odoo`/
  `sap_b1` (an early miss — they only checked for the first two, so a
  genuinely-connected Excel source still showed "unavailable" on Command
  until this was fixed); the Signal Watch row is also clickable through
  to Add tools now, matching the topbar button.
- **Real pilot connection, verified live end-to-end** (not just
  headless-mocked): Azure app registered under the user's **personal**
  Microsoft account — deliberately not their college account, since an
  app registration lives in whoever's tenant creates it and a
  deprovisioned college account could have taken the whole connector down
  with it. (Azure Portal kept routing sign-in to the college SSO session
  even in fresh browsers — fixed with `https://portal.azure.com/?whr=live.com`,
  which forces Microsoft's home-realm-discovery to the personal/consumer
  identity provider instead of guessing at an org one.) Client ID/secret
  stored in `excel_oauth`, confirmed via `excel-oauth-start` 302ing to a
  real `login.microsoftonline.com` URL with the right client_id. Real
  sign-in completed, `excel-status` confirmed `connected: true`.
  `erp-inventory`'s first live call 404'd (`itemNotFound`) — the actual
  OneDrive file had landed as `Utopia-Inventory.xlsx.xlsx` (Excel
  appended its own extension on top of one already typed in the save
  dialog) and the table was still Excel's default name (`Table2`, not
  `Table1` — a table had been deleted and recreated once), not the
  documented `InventoryTable`. Root-caused with a temporary diagnostic
  function (`excel-debug` — lists OneDrive root contents + a target
  file's real worksheets/tables via Graph, no tokens returned) rather
  than guessing further; `erp_config` updated to the real path/table
  name, confirmed `erp-inventory` returns `{ok:true, provider:"excel"}`
  (empty `items[]` until the user adds data rows — headers only so far).
  `excel-debug` has since been disabled (returns 410) since there's no
  tool access to delete an Edge Function outright — **safe to delete
  manually**: Supabase dashboard → Project → Edge Functions →
  `excel-debug`.

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
- **That query is no longer hypothetical.** A **Decisions** nav view
  (previously a generic placeholder, same as Shipments was) now renders
  exactly that join as a real history — every computed signal, its
  severity, and what happened to the recommendation it produced
  (approved/dismissed/no action/not applicable), plus a summary strip
  with the actual approval rate. New **`decisions-list`** Edge Function
  (read-only, unauthenticated, same relay pattern as `shipments-list`):
  fetches up to the last 50 `risk_snapshots`, left-joins the *latest*
  `recommendation_events` row per snapshot (so an approve-then-undo
  correctly reverts to "no action," matching what the live dashboard
  itself shows), and computes the summary server-side. Deliberately built
  with no Meta/WhatsApp dependency — pure use of data this project
  already had sitting unused in Postgres. Verified against real data via
  curl (11 real snapshots, 2 approved/1 dismissed/8 no-action, 66.7%
  approval rate — all genuine usage from this session's own testing, not
  fabricated) and a headless-browser pass with mocked data confirming the
  rendering logic, zero JS errors.
- **Honesty pass, prompted by an external pilot-readiness review**: the
  review correctly flagged that this history — 11 snapshots, 66.7%
  approval — reads as real customer engagement but is actually this
  session's own development testing (a snapshot is recorded on every
  dashboard load, with no distinction between a real decision and a
  reload while debugging). Fixed by adding an explicit caveat directly in
  the Decisions view's intro copy rather than changing what gets
  persisted — the recording behavior itself is correct per step 5's
  design, the problem was purely that nothing disclosed the data's
  actual source. The same review also caught two real copy overclaims,
  both fixed: the WhatsApp preview card claimed **"Also delivered to Ana
  on WhatsApp · 6:02 AM"** — a fabricated specific delivery event that
  never happens (the preview is user-initiated via the wa.me link, not
  auto-delivered) — reworded to "WhatsApp preview · sent when you click
  below"; and the roadmap-placeholder copy for unbuilt nav items claimed
  "real WhatsApp send" unqualified, which overstates what's actually live
  given the tracking-request template is still pending Meta's approval —
  reworded to name that limitation explicitly.

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
  recipient (`50499394433`). The token is a temporary credential from
  Meta's console — **empirically closer to ~1 hour than the 24h
  originally assumed here** (confirmed twice: a token issued ~17:52 UTC
  expired by ~19:00 UTC; a second issued ~22:21 UTC expired by ~00:00
  UTC). `token_issued_at`/`token_expires_at` are tracked but currently
  computed as issued+24h, which is now known to be wrong/over-optimistic.
  Given how often this has already broken automated checks in practice, a
  longer-lived token (via a Meta Business System User) has moved from
  "natural next step" to the actual recommended fix, not just a
  nice-to-have.
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

## Driver/provider WhatsApp tracking agent (extension beyond the original 7-step build order)

Built out the idea documented in "Future connections" below: a WhatsApp
agent that proactively asks a **delivery driver/provider** (not the end
customer) for a tracking number or ETA, replacing the manual "call the
driver to check" pattern. Lives in the dashboard's Shipments nav item,
previously a generic placeholder.

- **`shipments` table** (same project, RLS enabled, no policies —
  service_role only): `driver_name`, `driver_phone`, `description`,
  `deadline`, `status` (`pending`|`tracking_requested`|
  `tracking_received`), `tracking_number`, `carrier_eta`,
  `last_driver_message`, `last_contacted_at`/`last_response_at`. No TMS/ERP
  shipment feed exists yet (same gap as the ERP connector's pilot target),
  so shipments are added manually via a real form on the dashboard — not
  fixed demo data — so the loop can be proven with a real phone number.
- **Four new Edge Functions**, same `verify_jwt: false` reasoning as every
  other function here (each does one narrow, non-destructive thing):
  `shipments-list` (read relay), `shipments-create` (backs the "Add
  shipment" form), `request-tracking-update` (sends the tracking-request
  template to a shipment's driver, manually triggered by a dashboard
  button — **never automatic/scheduled**, consistent with "suggestion,
  never autonomous action"), and **`whatsapp-webhook`** — the first
  **inbound** surface in this project (everything before this was
  outbound-only). GET handles Meta's verification handshake (echoes
  `hub.challenge` if `hub.verify_token` matches); POST receives driver
  replies, matches the sender's phone against the most recently-contacted
  shipment for that number (falling back to that phone's most recent
  shipment if none is awaiting a reply), and records the reply. Always
  returns HTTP 200 even on internal errors (logged server-side instead) —
  required so Meta doesn't disable the webhook after repeated failures.
- **Tracking-number detection is a simple heuristic, not NLP**: a reply
  matching `/^[A-Za-z0-9-]{5,20}$/` (no spaces) is treated as a tracking
  code; anything else (a sentence, "llego en 2 horas") is still recorded
  as the driver's reply (`carrier_eta`) but not copied into
  `tracking_number`. A real pilot would want something sturdier than a
  regex here.
- **`whatsapp_config` gained `webhook_verify_token`** — a random value
  generated here (not by Meta) that the user pastes into Meta's console
  when registering the webhook; the credential flows the opposite
  direction from the phone_number_id/WABA ID/access token.
- **Custom template (`tracking_request`, Spanish, category UTILITY, two
  body variables — driver name and shipment description)**: submitted via
  a direct Graph API call (`whatsapp-setup-tracking-template` function,
  which also supports GET to check status without resubmitting) rather
  than the manual WhatsApp Manager UI. Two real, empirical findings along
  the way: (1) first submission attempt failed on the stored access token
  having expired (same 24h temporary token from step 6's original setup)
  — fixed by the user generating a fresh one via Meta's API Setup screen,
  same walkthrough as before; (2) the first template body — ending in the
  `{{2}}` variable — was rejected (`error_subcode 2388299`: Meta disallows
  a variable as the first or last thing in a template body), fixed by
  adding trailing fixed text ("...? Gracias por tu ayuda."). **Submitted
  successfully — template ID `1000167649703863` — and Meta approved it
  after roughly a day in review, status `APPROVED`.**
- **Real bug found and fixed: webhook URL verification ≠ WABA
  subscription.** After the user registered the callback URL/token in
  Meta's console (confirmed via logs: Meta's own verification GET hit our
  function and succeeded), inbound messages still weren't arriving. Root
  cause, found via `GET /{waba_id}/subscribed_apps`: the WhatsApp Business
  Account was subscribed to *Meta's own internal test app* ("WA DevX
  Webhook Events 1P App"), not to Ruta's app — verifying a callback URL at
  the app level and subscribing a specific WABA to send that app events
  are two separate things, and the console's guided setup didn't do the
  second one automatically. Fixed with a new **`whatsapp-webhook-subscription`**
  function (GET checks current subscribed apps, POST calls
  `POST /{waba_id}/subscribed_apps` to add ours — idempotent, safe to
  re-run). One POST call fixed it for real.
- **Verified end-to-end, for real** (not simulated): after the fix above,
  the user sent an actual WhatsApp message from their own phone to the
  test number; it arrived at `whatsapp-webhook`, matched the test
  shipment by phone number, and correctly recorded it — `status` flipped
  to `tracking_received`, `tracking_number` populated with the driver's
  actual message text (matched the tracking-code heuristic), confirmed by
  querying `shipments-list` directly. This is the first fully real,
  human-triggered proof of the inbound path working.
- **Manual steps still needed from the user**:
  1. ~~Generate a fresh WhatsApp access token.~~ Done.
  2. ~~Register the webhook callback URL + verify token.~~ Done, and
     confirmed via logs that Meta's own verification call succeeded.
  3. ~~Subscribe the app to the WABA's events.~~ Done (see above) — no
     further console action needed for the inbound path.
  4. A test-mode WhatsApp number can only *send* messages to numbers on
     Meta's allowed test-recipient list (max 5) — this only affects
     outbound sends (`request-tracking-update`), not inbound replies,
     which work from any number as just proven.
- **Fully proven end-to-end, both directions — real, not simulated.**
  With the template approved, `request-tracking-update` was called
  against a real test shipment (driver "Victor," the verified test
  number); WhatsApp accepted the send (`message_status: "accepted"`, real
  message ID), and the user confirmed the actual message arrived on their
  phone: *"Hola Victor, ¿podrías compartir tu número de rastreo o la hora
  estimada de entrega para: PO #4021 — 200 unidades a San Pedro Sula?
  Gracias por tu ayuda."* Combined with the inbound proof above, the
  driver/provider WhatsApp tracking agent is no longer pilot-speed-with-
  caveats — both the ask and the reply have been proven working for real,
  human-confirmed, on both ends of the conversation.

## Risks view — the last placeholder, now built

`risk-recommendation` was already computing the full day-by-day 7-day
weather breakdown internally, but only ever returned the count
(`flaggedWeatherDays`) — the actual per-day detail (date, WMO code,
precipitation, wind, flagged or not) was computed and discarded. Fixed
by having `fetchWeatherOutlook` also return `allDays`, now exposed as
`corridor.weatherDays` in the response — purely additive, no change to
existing fields or the severity computation itself. `relevantStorms` was
already full detail (name, classification, distance, movement,
intensity), nothing needed there.

The dashboard's Risks nav item — the last of the eight nav items still
showing the generic placeholder — now renders both: a 7-day weather table
(date, conditions decoded from the WMO code, precip, wind, flagged
badge) and a full storm list. No new math, no new backend beyond
exposing data the function already had. Verified via curl (the live
response now includes real per-day detail alongside the unchanged
severity/reasons) and a headless-browser pass with mocked multi-day/storm
data, zero JS errors.

## Integrations, Settings, Add tools — the last placeholder nav items, now built

Continuing the prospect-presentation pass: the three remaining
placeholder nav items are now real, with one deliberate security
boundary kept in place rather than built around.

- **Integrations** — a real status page listing every live data source
  this build actually uses (Open-Meteo, NOAA/NHC, WhatsApp Cloud API,
  ERP connector with its live current provider fetched from
  `erp-inventory`). Deliberately does **not** list connector logos for
  things that were never built (the original reference mockup included
  NetSuite and a generic "Microsoft" tile) — showing only what's real was
  the entire point of this pass.
- **Settings** — a real, safe config editor, and nothing more. New
  **`risk-location-settings`** function (GET reads, POST updates
  `risk_location_config` — name, lat, lon, radius). This table holds no
  secrets, so an unauthenticated write is an acceptable risk (worst case,
  someone points the monitored location somewhere silly — annoying, not
  a security incident). **Deliberately not editable from this page**:
  `erp_config` and `whatsapp_config`, both of which hold real credentials
  (ERP username/password, WhatsApp access token). Exposing a write path
  to those through an unauthenticated public form would be a real
  vulnerability regardless of demo context, so Settings only shows their
  status read-only — actual ERP/WhatsApp credentials are configured
  directly with a Utopia contact, never through a client-side form. This
  was a deliberate security call, not an oversight.
- **Add tools** — an honest ERP-onboarding page describing all three real
  adapters (Odoo's JSON-RPC, SAP Business One's Service Layer REST, and
  Excel/OneDrive via Microsoft Graph — see "ERP connector" and "Excel /
  OneDrive connector" above), plus the current live provider. Excel is
  the one genuine exception to "no self-service credential form": its
  card has a real "Connect with Microsoft" button, because it never
  collects a credential at all — only a redirect to Microsoft's own login
  page. Odoo/SAP B1 still have no form, same reasoning as Settings above
  — onboarding those is a config change made with a Utopia contact.
- **Verified**: real end-to-end round-trip on `risk-location-settings`
  (POST then GET confirms the write persisted) via curl, and a
  headless-browser pass across all three views (mocked data) confirming
  render logic, the Settings save flow, and status fetches — zero JS
  errors.

## Language toggle (Spanish/English)

The pilot audience is Honduran companies, so the dashboard defaults to
Spanish with a one-click toggle to English (`localStorage.utopia_lang`,
persisted across reloads). Hybrid approach, client-side only:

- A flat exact-string dictionary (`T`, ~150+ entries) covers every static
  label/heading/button across all 8 views. `applyI18n()` walks a subtree's
  text nodes and swaps any exact match; a `MutationObserver` on
  `main.main` re-runs it on every later DOM change (an async fetch
  rendering in, a list re-rendering) so no render site needs a manual
  translation call.
- `tr(en, es)` covers the ~40+ dynamic/interpolated sentences the
  dictionary can't (severity words, counts, names) — called directly at
  each string-building site.
- `localeStr()` (`es-HN`/`en-US`) is threaded through every
  `toLocaleDateString`/`toLocaleTimeString`/`toLocaleString` call so
  dates/times render in the right format, not just the right words.
- Toggling re-renders the current view: Command resets from
  `originalCommandHtml` (a pristine-English snapshot of `main.main`
  captured once at load) then re-runs `renderAll()` on the cached result;
  every sub-view (Shipments, Risks, etc.) just re-runs its own
  `renderXView()` function, which already rebuilds fresh from English
  literals. The sidebar resets from `originalSidebarHtml` the same way,
  since `applyI18n` alone is additive and can't un-translate it.
- **`#langToggleBtn` lives in the sidebar, not the topbar.** The topbar
  (`<header class="topbar">`) is nested inside `main.main`, and every
  sub-view's render function replaces `main.main`'s entire innerHTML —
  so anything placed in the topbar is destroyed the moment you navigate
  away from Command. The sidebar is `main`'s sibling and is never
  replaced wholesale, only reset-and-rebuilt by the language toggle
  itself, so it's the only place a persistent, always-clickable control
  can actually live. Found by testing "toggle language while on a
  sub-view" with Playwright and watching the button vanish from the DOM
  after navigating to Shipments — not a hypothetical edge case, the
  literal first thing a pilot demo would hit.
- **Known limitation, disclosed rather than hidden**: `corridor.reasons`
  strings generated server-side by the `risk-recommendation` Edge
  Function stay in English regardless of the toggle. Bilingual-izing that
  function was scoped out of this pass; a natural follow-up once needed.
- **Verified**: headless-browser pass (mocked `risk-recommendation` /
  `shipments-list`) toggling from every one of the 8 views, confirming
  the button survives navigation, the sidebar and active-nav state are
  both correct after toggling, and zero `pageerror` events — including
  the specific "toggle while on a sub-view" case above.

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

8. **Extension beyond the original 7-step charter: driver/provider
   WhatsApp tracking agent. Done — fully proven end-to-end.** See
   "Driver/provider WhatsApp tracking agent" above: real outbound send
   (approved custom template, human-confirmed delivery) and real inbound
   webhook (human-sent reply correctly matched and recorded), both
   verified live, not simulated.

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

- **Driver/provider WhatsApp tracking agent — built and fully proven,
  both directions.** See "Driver/provider WhatsApp tracking agent" above.
  Natural next steps from here: automatic/scheduled tracking requests
  (e.g. N days before deadline — deliberately not built now, manual
  button only, consistent with "suggestion, never autonomous action"),
  something sturdier than the current tracking-code regex, and a
  longer-lived WhatsApp access token (a Meta Business System User) so
  this stops needing a fresh temporary token roughly every hour — a real
  recurring cost during this build that a real pilot shouldn't inherit.
