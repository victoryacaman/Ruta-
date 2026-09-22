# Utopia — Build Log

Chronological record of what was built, what broke, what was found, and how
each thing was verified. This is the historical record moved out of the old
combined `CLAUDE.md` — nothing here is deleted, only relocated and organized
by date. Current-state claims live in `UTOPIA_CURRENT_SPEC.md`; this file is
the "how we got there," including superseded descriptions that were true at
the time and are no longer current. Dates are commit dates from the repo's
own history. Operational identifiers (access codes, phone numbers, WABA/
phone-number IDs, template IDs, Supabase project references) are redacted
here even where they appeared in the original notes, per this project's
credential-handling standard — see `SECURITY_AND_PILOT_BLOCKERS.md`.

## 2026-08-26 — Project seed and steps 2–3

- Repo seeded under the original name "RUTA": project charter plus a static
  reference-mockup dashboard.
- **Step 2, signal ingestion.** Open-Meteo (7-day precipitation/wind/
  weather-code forecast) confirmed to work directly from a browser (sets
  `Access-Control-Allow-Origin: *`). NOAA/NHC's `CurrentStorms.json` does
  **not** set any CORS header at all — confirmed empirically, not assumed
  — so a browser can't fetch it directly. Fixed with a relay Edge Function,
  `storm-signal`, deployed to a **new, dedicated Supabase project**
  (deliberately separate from an existing personal-ops project in the same
  account, so a future paying pilot's data never mixes with unrelated
  infrastructure — project reference redacted here per this project's own
  standard).
- **Step 3, ERP connector, demo mode.** A generic `erp_config` table (one
  row, `provider` switch) plus a demo adapter and first-draft Odoo/SAP B1
  adapters, built against each system's documented external API shape
  without a live account to test against — a deliberate choice: picking a
  real pilot customer/ERP is a business decision, not a coding task, so the
  connector was built generic rather than blocking on that decision.

## 2026-08-27 — Scoring engine, persistence, WhatsApp, hosting, rebrand

- **Step 4, scoring engine.** First version of `risk-recommendation`:
  combines the weather/storm signal with ERP inventory into real exposure/
  transfer-cost/ROI numbers, replacing the mockup's sample Decision Queue
  data. Explainable-rule design from the start (no ML), per the project's
  non-negotiable principles.
- **Step 5, persistence.** `risk_snapshots` (one row per computation) and
  `recommendation_events` (one row per approve/dismiss/undo) added, both
  service_role-only. A new `recommendation-action` function writes events;
  it can only append a row referencing an existing snapshot — it cannot
  read, modify, or fire any purchase/transfer action itself, enforcing
  "suggestion, never autonomous action" at the infrastructure level.
- **Step 6, WhatsApp (pilot/fast path).** A real Meta for Developers app
  and a free test WhatsApp number set up through Meta's own console (a
  human login step, not something scriptable from this repo).
  `whatsapp_config` (service_role-only) holds the test number's account
  identifiers and access token — all redacted from this log. `send-
  whatsapp-alert` calls the real WhatsApp Cloud API using the stored
  token. **Real constraint documented from day one:** WhatsApp's Cloud API
  only allows a pre-approved template or free-form text within a 24-hour
  post-reply window — not arbitrary proactive text.
- **Hosting prep.** GitHub Pages targeted as the host, plus a lightweight
  client-side sign-in gate (`index.html`, a shared password constant —
  value redacted here — setting a `sessionStorage` flag that a guard
  script in the dashboard checks). Documented from the start as a
  deterrent, not real access control, appropriate only while the dashboard
  shows demo data to a small preview audience.
- **Rebrand: RUTA → Utopia.** Display name and color palette changed
  (repo/filenames/infra names deliberately left as-is — see the Legacy
  Names table in `UTOPIA_CURRENT_SPEC.md`). New monochrome dark theme,
  with `--orange` (`#ff4444` at the time) framed as reserved strictly for
  genuine danger/urgency signals. **This framing changed later — see
  2026-09-07 below; it is not the current state.**
- **Live-proof pass.** The click-to-chat WhatsApp number switched from a
  placeholder to the real verified test recipient. The Approve button
  stopped being a fire-and-forget toast — clicking it now visibly disables
  and relabels itself, backed by the real persistence write from step 5.
  The notification bell switched from decorative to reading real data.
  Every still-unbuilt sidebar item was reworded from "not wired in this
  reference build" (reads as broken) to explicit roadmap framing — nothing
  was actually built out in this pass, only the honesty of what the copy
  claimed.
- **Geography generalization.** Both `storm-signal` and the scoring engine
  originally hardcoded one port's coordinates. Replaced with a
  `risk_location_config` table (one row: name/lat/lon/radius), read
  server-side by both functions, falling back to the original port's
  coordinates if the table is ever empty/unreachable. Onboarding a new
  location became one `UPDATE`, not a code change. Disclosed caveat at the
  time (still true): the storm-relevance radius was calibrated for a
  coastal/port location; an inland deployment's real exposure leans more
  on the weather signal than on distance to a tropical system, and this
  hasn't been tuned per-location yet.
- **Driver/provider WhatsApp tracking agent, extension beyond the original
  build order.** A new `shipments` table plus four new Edge Functions:
  `shipments-list`, `shipments-create`, `request-tracking-update` (sends
  the tracking-request template, manual-button-triggered only), and
  `whatsapp-webhook` — the project's first **inbound** surface. GET handles
  Meta's verification handshake; POST matches an inbound reply's phone
  number against the most recently-contacted shipment and records it.
  Always returns HTTP 200 even on internal errors (required so Meta
  doesn't disable the webhook after repeated failures) — errors are
  logged server-side instead.
- **Custom template submission.** A driver-tracking template (Spanish,
  two body variables) submitted via a direct Graph API call. Two real
  findings along the way: the stored access token had already expired
  (the original short-lived console token, not yet the permanent one —
  see 2026-08-28/2026-09-21 below) — fixed by generating a fresh one; and
  the first template draft was rejected because it ended in a variable
  placeholder (Meta disallows a variable as the first or last thing in a
  template body) — fixed by adding trailing fixed text.
- **Webhook subscription bug, found and fixed same day.** After
  registering the callback URL in Meta's console and confirming (via
  logs) that Meta's own verification GET succeeded, inbound messages
  still weren't arriving. Root cause, found via the WhatsApp Business
  Account's subscribed-apps list: the account was subscribed to Meta's
  own internal test app, not this project's app — verifying a callback
  URL and subscribing a specific account to send that app events are two
  separate steps, and the console's guided setup only did the first one.
  Fixed with a dedicated function that calls the subscribe endpoint
  directly; idempotent, safe to re-run.

## 2026-08-28 — Token lifetime correction, Decisions view, honesty pass

- **Token lifetime correction.** The originally-issued short-lived WhatsApp
  token was found to expire in roughly **one hour**, not the ~24 hours
  first assumed — corrected in the documentation of the time (this whole
  problem class was later closed for good by the permanent-token migration
  on 2026-09-21, below).
- **Decisions view.** A new `decisions-list` function joins `risk_snapshots`
  with the latest `recommendation_events` row per snapshot (so an
  approve-then-undo correctly reverts to "no action"), plus a real
  approval-rate figure computed server-side. Verified against real data
  from that day's own testing (a specific snapshot/approval count was
  recorded at the time; since superseded by more testing — see the
  current caveat in `UTOPIA_CURRENT_SPEC.md`/`SECURITY_AND_PILOT_BLOCKERS.md`
  rather than quoting a now-stale number here).
- **Honesty pass, prompted by an external pilot-readiness review.** The
  review correctly flagged that the Decisions history reads as real
  customer engagement but was actually this project's own development
  testing — fixed by adding an explicit caveat directly in the view's
  intro copy (the recording behavior itself was already correct per step
  5's design; the problem was that nothing disclosed the data's real
  source). Two real copy overclaims fixed in the same pass: a WhatsApp
  preview card claimed a message had already been auto-delivered to a
  named recipient at a specific time — that never happens (the preview is
  user-initiated via a click-to-chat link) — reworded to describe it
  accurately; and roadmap-placeholder copy claimed unqualified "real
  WhatsApp send" for unbuilt items, overstating what was live given the
  driver-tracking template's approval was still pending at that point.

## 2026-08-29 — Driver-tracking template approved, proven end-to-end

The custom driver-tracking template was **approved** by Meta after review.
With approval in hand, `request-tracking-update` was called against a real
test shipment; WhatsApp accepted the send with a real message ID, and the
real recipient confirmed the message arrived with the correct driver name
and shipment description filled in. Combined with the earlier-proven
inbound path, this closed the loop as fully proven in both directions —
not simulated, human-confirmed on both ends of a real conversation.

## 2026-08-30 — Prospect-presentation pass; Inventory, Integrations, Settings, Add tools, Risks views

An external checklist for showing the build to an actual pilot prospect
flagged several real issues, fixed the same day:

- Internal build jargon ("build order step 3," "pending a named pilot,"
  "roadmap," a Meta template-approval status string) removed from every
  user-visible string, reworded toward what a prospect actually needs
  ("connecting your ERP is a configuration step, not new engineering" —
  turning an honesty note into a selling point; **note: `UTOPIA_CURRENT_SPEC.md`
  now qualifies this claim rather than repeating it unchanged, since it
  hasn't been tested against a real Odoo/SAP B1/ZafraCloud account**).
- A real wording bug: internal severity values ("medium") were printed
  raw right next to a differently-worded badge ("ELEVATED") in the same
  sentence. Fixed with one shared label helper used everywhere severity
  appears in a sentence.
- Awkward literal "(s)" pluralization fixed with a proper singular/plural
  helper.
- A fabricated "View all 6" link and an unbacked "4" notification badge —
  neither had a real list of 6 or a real count of 4 behind it — removed;
  the link reworded to "View all cases" with an honest one-line disclosure
  that this build only ever surfaces the single highest-priority
  recommendation live. **Confirmed still current: neither the old numbers
  nor any replacement fake count exist in the code today.**
- A hard-coded date string that never changed, now set from the real
  current date on load.
- **Mobile layout bug, reproduced then fixed.** The live-data mode banner
  collapsed into an unreadable narrow column on phone-width viewports
  (confirmed via a before/after screenshot at a specific mobile viewport
  size). Root cause: missing `min-width:0`/`flex-wrap` on the banner's
  flex children. Fixed with a mobile media query stacking the banner
  vertically.
- **Real bug: the sign-in redirect used a relative path**, which resolves
  to whatever file happens to share the same folder — confirmed as the
  cause of a real reported case where an emailed copy of the dashboard,
  opened next to an unrelated project's own `index.html`, silently
  redirected there instead. Fixed by hardcoding the absolute hosted URL as
  the redirect target. The underlying practice fix: present only the
  hosted link, never the raw HTML file — emailing/downloading it is what
  exposes this failure mode (and hands over internal endpoint details) in
  the first place.
- **Cleared all development test data** before any prospect would see it
  — both test shipment records and that day's `risk_snapshots`/
  `recommendation_events` rows. Deliberately decided against pre-seeding
  "clean" replacement sample data — the plan instead is proving the
  product live, in person, letting a couple of real page reloads during
  an actual visit naturally seed a few genuinely fresh Decisions entries.
- **Inventory view built** — the previously-placeholder nav item now
  renders the ERP connector's real output: summary strip plus a per-SKU
  row (on-hand vs. reorder point, days of safety stock, unit price,
  alternate-warehouse availability). Verified headless with mocked data
  (specific arithmetic check passed) and confirmed live against the
  deployed connector. Called "the single most important placeholder to
  have fixed before showing anyone this build."
- **Integrations, Settings, Add tools built** — Integrations lists only
  real live data sources (no logos for things never built). Settings
  gained a real, safe config editor for location/lat/lon/radius via a new
  `risk-location-settings` function — deliberately **not** editable from
  this page: `erp_config`/`whatsapp_config`, both of which hold real
  credentials, stay read-only-status-only here; a write path to those
  through an unauthenticated public form would be a real vulnerability
  regardless of demo context — a deliberate security call. Add tools
  describes all three non-Excel adapters honestly, with Excel getting a
  real "Connect with Microsoft" button since it never collects a
  credential at all.
- **Risks view built** — the last placeholder nav item. `risk-recommendation`
  was already computing the full 7-day weather breakdown internally but
  only ever returning a count; fixed to also expose the full per-day
  detail, purely additive, no change to the severity computation itself.

## 2026-08-31 — Spanish/English language toggle

A flat exact-string dictionary plus a separate helper for dynamic/
interpolated sentences, covering all 8 views; a `MutationObserver` re-
applies translation on later DOM changes so no render site needs a manual
call. Found and fixed during testing: the toggle button was originally
placed in the topbar, which gets destroyed on every view navigation
(each sub-view replaces the main content wholesale) — moved to the
sidebar, which is only ever reset-and-rebuilt by the toggle itself, never
replaced wholesale. **Known limitation, disclosed then and still current:**
server-side severity-reason strings from the scoring engine stay in
English regardless of the toggle — scoped out of this pass.

## 2026-09-01 — Excel/OneDrive connector goes live

- Made the Excel adapter real: a genuine Microsoft Entra ID app
  registration (created by the user, no tool can create one), delegated
  Graph permissions (`Files.Read`, `offline_access`, `User.Read`), a new
  `excel_oauth` table, and three Edge Functions (`excel-oauth-start`,
  `excel-oauth-callback`, `excel-status`). The OAuth `state` parameter was
  documented at the time as "a basic round-trip sanity check, not stored
  and compared server-side" — **this description has since been found to
  be inaccurate: the callback does not read `state` at all, providing zero
  protection rather than a "basic" one. See `SECURITY_AND_PILOT_BLOCKERS.md`
  for the corrected finding.**
- Fixed Command/Signal Watch only recognizing `odoo`/`sap_b1` as "real ERP
  connected," so a genuinely-connected Excel source still showed
  "unavailable" until added.
- **Real pilot connection, verified live end-to-end.** The Azure app was
  registered under a personal Microsoft account rather than an
  institutional one (Azure Portal kept routing sign-in to an unrelated
  organizational SSO session even in fresh browsers — fixed by forcing
  Microsoft's home-realm-discovery to the personal/consumer identity
  provider via a specific query parameter on the Azure Portal URL). Real
  sign-in completed; the first live inventory call 404'd — the actual
  OneDrive file had landed with a double file extension (Excel appended
  its own on top of one already typed in the save dialog), and the table
  name didn't match what was configured. Root-caused with a temporary
  diagnostic function (listing OneDrive contents/tables, no tokens
  returned) rather than guessing further; config corrected; confirmed
  working with headers-only data. That diagnostic function has since been
  disabled (returns a fixed inert response) since there's no tool access
  to delete an Edge Function outright — flagged for manual deletion.
- **Workbook/table picker built**, so a real user connecting without an
  engineer in the loop has a way to see and fix a mismatch themselves
  rather than silently landing on "connected" with wrong data. New
  `excel-browse` (lists files/tables) and `excel-select-workbook` (re-
  verifies the choice against Microsoft Graph before saving) functions;
  `erp_config` gained a stable Graph drive-item id field so a rename or a
  double-appended extension doesn't break the connection again. Verified
  via direct calls against the real connected account, and a headless-
  browser pass covering the happy path and several failure states.

## 2026-09-07 — Visual design polish pass

Specific execution issues found by actually screenshotting the rendered
dashboard (not guessed from the CSS):

- **`--orange` changed from a full-alarm red (`#ff4444`) to a calm amber.**
  This directly supersedes the 2026-08-27 rebrand's framing of the same
  variable as "reserved strictly for genuine danger" — by this point it
  was clear the variable was actually styling routine, every-load
  informational states (a demo-data banner, a below-reorder flag), which
  read as needlessly alarming at that intensity for something that isn't
  an error. Genuine high-severity states were intended to use their own
  separately-hardcoded red, unaffected by this change — **verified
  directly against the current CSS for this documentation pass: that
  separation does hold in the actual rule (`.severity-high`/`.tag-urgent`
  use an independently-hardcoded color, not the `--orange` variable),
  though a code comment near the `--orange` declaration claims those
  states "reference `--orange` too," which does not match the actual CSS
  rule — an inconsistency between a comment and the code it describes,
  not a behavior bug. Not corrected here since it's an application-code
  comment, out of scope for this documentation pass.**
- Elevation scale widened (card/border color tokens adjusted) so cards
  read as distinct surfaces instead of flattening into the near-black
  page background.
- A real inconsistency fixed: one form's inputs were unstyled browser-
  default white fields while another view's were already dark-themed;
  unified with one global input/select style rule.
- Metric-card accent colors made value-driven instead of hardcoded by
  position (a zero-risk-meaning timestamp card had been hardcoded to look
  alarming regardless of its actual value).

## 2026-09-12 — Advisor review: pilot-validation questions and adapter gaps

A review meeting with a business advisor raised validation questions
(captured here as historical record — the live, current version of this
content lives in `PILOT_PLAYBOOK.md`) and surfaced concrete technical
gaps in the already-built adapters:

- SAP B1 data is denormalized in ways the current adapter's field mapping
  may not fully account for — not yet revisited against a real instance.
- Neither the Odoo nor SAP B1 adapter has confirmed that a target
  company's actual license tier permits third-party API integration at
  all — assumed, not checked.
- The Odoo adapter remains untested against any live instance.
- **SAP Integration Suite clarified as a non-gap**, following up on the
  advisor's "does it actually connect properly" concern: SAP's
  Integration Suite is a separate enterprise iPaaS product typically
  paired with larger SAP landscapes, not something a typical SAP Business
  One customer already has. The existing adapter's direct use of SAP B1's
  own documented Service Layer REST API is SAP's correct, official,
  first-party integration method for SAP B1 specifically — not a
  workaround Integration Suite would replace. Requiring it on top would
  likely add unnecessary cost/complexity for a prospect. One legitimate
  future nuance, not acted on: a prospect running a bigger SAP landscape
  with an IT policy requiring integrations to go through a governed layer
  could make this relevant later — a question for that prospect's IT
  team if and when it's real.

## 2026-09-16 — Inventory polling, Excel column mapping, currency, cost/price bug

- **Auto-refresh added to the Inventory view** (previously fetched once
  per load) after a real gap was found directly: editing the connected
  Excel workbook produced no visible change until a manual refresh click.
  Fixed with a 25-second poll, paused while the tab is hidden, and
  properly cleared on navigating away — deliberately scoped to Inventory
  only, since recomputing the full scoring engine on the same cadence
  would mean unnecessary repeated calls to the external weather/storm
  APIs for data that doesn't need sub-minute freshness.
- **Real onboarding trap found and documented:** Microsoft Graph's table
  API only recognizes an actual Excel Table object (Insert → Table), not
  cells manually styled to merely look like one — confirmed by hitting
  exactly this with a real user's new sheet.
- **Real second bug in the same test, more serious:** once a sheet *was*
  recognized as a table, its data came through scrambled — a $100 "unit
  cost" that was actually a reorder level, a warehouse "location" that
  was actually a dollar total, and so on. Root cause: the adapter read
  columns by fixed position, assuming one exact documented column order,
  while the real user's sheet had different columns in a different order.
  Fixed by reading the table's real header row and resolving each field
  by header-name matching (case/punctuation/spacing-insensitive) instead
  of position; a field with no matching header is left honestly empty
  rather than guessing from an unrelated column. Verified against the
  real workbook: all rows mapped correctly on a spot check.
- **Currency made configurable.** Every monetary value had been hardcoded
  to Lempira formatting, mislabeling numbers for any business pricing in
  a different currency. This is a display-label fix only — no exchange-
  rate conversion exists or is intended; the source data already reports
  costs in whatever currency that business uses. `risk_location_config`
  gained currency code/symbol columns (defaulted to match existing
  behavior); Settings gained a preset-plus-custom currency field.
- **Follow-up bug, found right after the header-name fix:** the dashboard
  still showed $0 for every item and for the inventory-value total, even
  though the header-name fix had correctly resolved the underlying cost
  field server-side. Root cause: every adapter has always returned two
  distinct money fields (cost basis vs. sale/list price), but the
  dashboard only ever read the sale-price field for both the per-row
  stat and the inventory-value summary — and this particular real user's
  sheet had no "unit price"/"selling price" column at all, only cost, so
  the sale-price field correctly (honestly) resolved to zero, masking
  real data sitting unused in the cost field. Fixed by switching both
  displays to the cost field, which is also the conceptually correct
  field for an "inventory value" metric under standard accounting
  regardless of any particular customer's column naming. The scoring
  engine's own use of sale price for sales-exposure math was correct as-
  is and left unchanged (a lost sale is properly valued at sale price,
  not cost). Verified via a direct comparison against the live connector
  response and a headless-browser pass with data shaped like this user's
  real sheet.

## 2026-09-18 — ZafraCloud adapter built, verification deliberately deferred

- **Adapter built** from ZafraCloud's own public developer documentation
  (the docs page is a JS shell; its real machine-readable spec was found
  by reading the page's own bundled JS to locate where it's actually
  served from — not guessed or brute-forced). A real ZafraCloud contact
  answered technical questions directly, confirming the public API
  exists, uses Bearer auth, and that sandbox access requires already
  being a paying customer.
- **Real cost decision, recorded rather than acted on:** getting a token
  to actually test the adapter against a live account costs real money
  (a one-time integration fee plus a recurring monthly plan, quoted
  directly by a ZafraCloud sales representative — figures kept in
  `PILOT_PLAYBOOK.md`, not repeated here). Decision: don't spend that
  money yet — there's no confirmed ZafraCloud-using prospect lined up,
  and paying to verify a connector nobody has asked for yet would repeat
  the same mistake the SAP Integration Suite question above already
  warned against. Same posture as Odoo/SAP B1: built from a real,
  documented contract, deliberately left unverified until an actual
  prospect on that system exists.

## 2026-09-21 — Permanent WhatsApp token; ZafraCloud scaling guardrails; configurable transfer cost

- **WhatsApp token migrated to a permanent Meta Business System User
  token.** The original console-issued token had already been confirmed
  short-lived in practice (roughly one hour, not the ~24h first assumed —
  see 2026-08-28 above) and had broken the send pipeline more than once.
  Replaced by generating a System User token with expiration set to
  "Never" in Meta Business Suite (a real, free, standard Business Manager
  feature — confirmed against Meta's own docs before doing it, no paid
  tier or business verification needed for this specific step). Real
  friction along the way: a mandatory two-factor-authentication gate on
  the admin's personal account blocked initial access from a new browser
  (resolved by completing 2FA, after some initial confusion about which
  settings tab actually holds that option); and this business had already
  hit Meta's cap of one admin-role System User account, so the existing
  one was reused rather than creating a new one (the cap is on accounts,
  not on tokens generated from one). `send-whatsapp-alert`'s error
  handling was also updated to treat Meta's "invalid/expired token" error
  code as a genuinely-wrong-credential signal now that expiry shouldn't
  happen on its own, rather than a routine, expected occurrence. **Verified
  for real**: called live, returned success, and a real message was
  confirmed arriving on the verified test number.
- **ZafraCloud adapter scaling guardrails added**, ahead of any real
  account to test against: a hard cap on how many SKUs get the expensive
  per-SKU enrichment call, that work run in concurrent batches instead of
  one at a time, and automatic retry-with-backoff on HTTP 429 so a rate
  limit degrades gracefully. Verified with a standalone simulation
  (synthetic SKUs, simulated 429 responses) rather than a live account,
  since none exists yet.
- **`risk-recommendation`'s per-unit trucking-cost assumption made
  configurable.** Previously a flat hardcoded constant, disclosed as a
  placeholder from the start but only replaceable via a code change and
  redeploy. `risk_location_config` gained a numeric column for it
  (defaulted to match the prior hardcoded value, so this shipped with
  zero output change); the scoring engine now reads it from config the
  same way location/currency already were. Verified: the migration was
  confirmed applied with the expected default value, the redeployed
  function was confirmed still computing correctly end-to-end against
  live weather data, and the arithmetic itself was checked against
  several different constant values in isolation. (`recommendation.
  applicable` was `false` at verification time for an unrelated, pre-
  existing reason — the connected inventory source had no sales-velocity
  data for any item, which the scoring loop already skipped before this
  change.)

## 2026-09-22 — Documentation reorganization

The single combined `CLAUDE.md` covering the entire project history above
was split into this file plus `UTOPIA_CURRENT_SPEC.md`,
`SECURITY_AND_PILOT_BLOCKERS.md`, and `PILOT_PLAYBOOK.md`, cross-checked
against the live code rather than carried forward as previously written.
See the task summary delivered alongside this change for the full list of
corrections made and claims that could not be confirmed either way.

## 2026-09-22 — Security hardening: real auth, OAuth/webhook fixes (written, not deployed)

A full pass to close the gaps `SECURITY_AND_PILOT_BLOCKERS.md` had just
documented, implemented as code and migrations committed to the repo
(`supabase/` tree) but **deliberately not deployed or applied** —
correct on request from a task that explicitly said not to touch
production without confirmation first. This entry documents what was
built; `SECURITY_AND_PILOT_BLOCKERS.md` has been updated to say what's
now fixed-in-code vs. still-live-as-before pending that deployment.

- **Real Supabase Auth, replacing the client-side access code.** A new
  `pilot_authorized_emails` allowlist table (service_role only) plus a
  shared Edge Function helper (`supabase/functions/_shared/auth.ts`)
  that every protected function calls first: reads the bearer token,
  verifies it with Supabase Auth, checks the authenticated email against
  the allowlist, returns 401 for missing/invalid auth and 403 for a
  valid-but-unauthorized account. A second path lets this project's own
  Edge Functions call each other using the shared `SUPABASE_SERVICE_ROLE_KEY`
  as a trusted internal credential (e.g. `risk-recommendation` calling
  `erp-inventory`) — reusing the existing stack rather than inventing a
  new internal secret. Chosen sign-in method: email magic-link
  (Supabase Auth's built-in OTP), a deliberate default (no password to
  manage, fits a small pilot-user list) rather than something asked for
  and not yet confirmed with the user.
- **12 of the functions that read customer data, change config, record
  actions, or send messages** now call that guard:
  `erp-inventory`, `risk-recommendation`, `excel-status`, `excel-browse`,
  `excel-select-workbook`, `risk-location-settings`, `shipments-list`,
  `shipments-create`, `request-tracking-update`, `decisions-list`,
  `recommendation-action`, `send-whatsapp-alert`. Three more identified
  as needing the same treatment
  (`excel-oauth-start`, `whatsapp-setup-tracking-template`,
  `whatsapp-webhook-subscription`) were not yet rewritten when this pass
  was paused to do the data-integrity work in the next entry — open.
- **Restricted CORS** (`supabase/functions/_shared/cors.ts`) replacing
  the old blanket `Access-Control-Allow-Origin: *` on every function
  above: an explicit allow-list (the real production origin, plus
  configured local-dev origins via an `ALLOWED_ORIGINS` secret), with a
  disallowed origin's preflight getting a 403 and no CORS headers at all
  rather than a wrong-but-present header.
- **Microsoft OAuth state/PKCE, real this time.** New `oauth_states`
  table (state, requesting user, PKCE code_verifier, expiry, used-once
  flag). `excel-oauth-start` now requires an authorized user's bearer
  token to even generate a state, and returns the Microsoft authorize
  URL as JSON (a fetch response) rather than 302-redirecting itself —
  necessary so the initiating call can carry an Authorization header at
  all, which a plain link click never could. (`excel-oauth-callback`
  itself was not yet rewritten to validate/consume that state when this
  pass paused — still reads the old code, so the actual CSRF fix isn't
  live yet even in the written-but-undeployed code. Tracked as open,
  not silently assumed done.)
- **Meta webhook signature verification, designed but not yet written
  into `whatsapp-webhook` itself** — `_shared/crypto.ts` has the
  constant-time HMAC-SHA256 verifier (`verifyMetaSignature`, checked
  against the raw request body) ready to wire in, plus a
  `whatsapp_webhook_events` idempotency table (one row per Meta message
  id) and a `whatsapp_config.meta_app_secret` column via migration. The
  actual rewrite of `whatsapp-webhook`'s `Deno.serve` handler to call
  `verifyMetaSignature` before parsing anything, and to only ack 200
  after a durable, deduplicated write, was not reached before this pass
  paused — the live function's real gap (documented in
  `SECURITY_AND_PILOT_BLOCKERS.md`) is not actually closed yet, only
  scaffolded.
- **Outbound-messaging rate limiting, done.** `_shared/rateLimit.ts` plus
  a `whatsapp_send_log` table: `request-tracking-update` now enforces a
  60-minute per-shipment resend cooldown (bypassable only by an
  authorized caller explicitly passing `confirmResend:true`, not by an
  anonymous one — the auth gate above is what actually makes that safe);
  `send-whatsapp-alert` gets a generic 10-sends-per-hour-per-user limit
  as defense-in-depth once it's auth-gated. Both also validate the
  recipient as a plausible phone number server-side now.
- **Not started this pass**: the dashboard's own frontend (`index.html`,
  `ruta-dashboard-fixed.html`) still uses the old shared access-code gate
  — no `supabase-js` wiring, no per-request bearer token on any `fetch()`
  call site, no sign-out flow. Every function above already requires
  auth in code, so once deployed, the dashboard would break until this
  is done. This is the single biggest remaining piece of this pass.

## 2026-09-22 — Data integrity, conservative transfers, decision-metrics honesty

Built on top of the (paused, undeployed) security pass above rather
than the older deployed functions, since both changes need to land in
the same files eventually. Also not deployed.

- **Null vs. zero, enforced in one place.** New
  `erp-inventory/validation.ts`: every adapter's raw output — including
  the pre-existing `?? 0`/`|| 0` fallbacks in the SAP B1, Excel, and
  ZafraCloud adapters that had already caused one real "$0" bug (see the
  2026-09-16 entry above) — now passes through untouched, and this one
  module decides null (genuinely unknown) vs. a real number, rejects
  malformed SKUs outright, and flags negative/non-finite values instead
  of trusting them.
- **Scoring engine stops coercing null to 0.** New
  `risk-recommendation/scoring.ts` (extracted from the inline
  `Deno.serve` logic specifically so it's unit-testable without a live
  project): `unitsShort * item.unitPrice` used to silently become `0`
  when `unitPrice` was `null` — plain JS arithmetic makes that easy to
  miss. Sales exposure is now `null` with a stated reason on that
  specific SKU when its price is unknown; the aggregate flags
  `exposureIncomplete` and suppresses `roiMultiple` (returns `null` with
  `roiUnavailableReason`) rather than compute a ratio from a partial sum.
  Also fixed a related latent bug: `avgDailyUnitsSold === 0` (a SKU that
  genuinely never sells) was being treated identically to
  `avgDailyUnitsSold == null` (`if(!item.avgDailyUnitsSold) continue`,
  both falsy) — now `0` correctly resolves to "infinite safety stock,
  not at risk" instead of "no data, skip".
- **Transfers now distinguish verified-safe from merely candidate.** No
  adapter has ever fetched a source (alternate) warehouse's own reorder
  point, so every transfer recommendation was silently treating "has
  units on hand" as "safe to take those units" with no check against
  that warehouse's own needs. `scoring.ts` now only marks a transfer
  `"verified"` when that source-side reorder point is known and the
  proposed amount wouldn't breach it; otherwise (today: always, for
  every adapter) it's `"candidate_pending_source_verification"`, capped
  at whatever amount actually is confirmed safe if partial data exists.
  The alternate-warehouse shape gained optional
  `sourceReorderPoint`/`sourceAvgDailyUnitsSold` fields for this — all
  five adapters currently emit `null` for both, honestly, rather than a
  guessed value; Excel's header-matching (already the mechanism for
  every other field) was extended with aliases for these two in case a
  customer's own sheet already tracks them.
- **Decision-history stops inflating itself.** `risk_snapshots` gained
  `environment` (demo/pilot/development/unknown, classified from
  `erp_config.provider` at compute time — not asked of the caller, who
  has no more insight into this than the server does),
  `computation_source` (page_load/manual_refresh/scheduled/test, from a
  `?source=` param the dashboard doesn't send yet — defaults to
  page_load, matching every real caller today), a deterministic
  `signal_fingerprint` (SHA-256 over the material inputs: location,
  severity, expected delay, ERP provider, and each at-risk SKU's
  shortfall/transfer amount — deliberately not the full response, so
  timestamps/raw weather arrays don't make every call look unique), and
  a `computation_count`/`last_computed_at` pair. A repeat computation
  with the same fingerprint within 5 minutes now increments that counter
  on the existing row instead of inserting a new one. Existing rows get
  `environment='unknown'`/`computation_source='unknown'` via the
  migration's own column defaults — not deleted, not relabeled as
  something they weren't.
- **`decisions-list` reports a real "decision coverage" metric**
  (acted-upon applicable recommendations ÷ distinct recommendations
  shown) alongside the pre-existing approval rate, and now defaults to
  `environment='pilot'` rows only (always excluding
  `computation_source='test'` regardless of scope) rather than counting
  every demo/dev computation as if it were real pilot activity. A
  `?scope=all` param recovers everything for exploring engagement
  pre-pilot; the response says which scope was used and whether
  non-pilot data is included (`demoDataIncluded`), and the dashboard's
  Decisions view now shows a "demo data included" banner when that's
  true instead of blending it in silently.
- **Dashboard copy corrected to match actual scope** (the mode banner
  and Settings intro both used to imply more than a single configurable
  point is monitored, and that ERP integration is pure configuration
  with no engineering risk) — both now state the real scope plainly, in
  both languages.
- **Dashboard rendering**: `formatMoneyOrUnavailable`/
  `formatExposureOrUnavailable` helpers render "Not available"/"No
  disponible" (with a stated reason for the per-SKU case) instead of
  `L 0` whenever the underlying value is genuinely unknown; the Decision
  Queue card shows a **CANDIDATE — PENDING VERIFICATION** tag and an
  explanatory "why" line whenever `anyUnverifiedTransfers` is true; the
  Decisions view gained a "decision coverage" metric tile and the demo-
  data-included banner above.
- **Verified**: 34 Deno unit tests (validation, scoring, fingerprint
  determinism, decision-metrics denominators) plus two real headless-
  browser passes against the actual dashboard file — one exercising the
  new null-safety/candidate-transfer rendering in both languages, one
  confirming a normal fully-known-data case still renders exactly as
  before (no regression). All passing.
- **Not done this pass**: nothing here was deployed or applied to the
  live Supabase project, matching the task's own instruction not to
  without confirmation first. The security pass's own unfinished pieces
  (listed above) remain unfinished — this data-integrity work was built
  on top of that pass's partial code, not instead of finishing it.

## 2026-09-23 — Security hardening completion (dashboard auth, remaining functions, OAuth state/PKCE, webhook signatures, internal auth review)

Closes out every gap the previous two passes left open, as one internally
consistent release. Continued the existing implementation throughout —
no second authentication architecture, no restart.

- **Dashboard authentication wired up for real.** `index.html` replaced
  its plain-text `ACCESS_CODE` gate with a Supabase Auth email magic-link
  sign-in (`signInWithOtp`); a session already present redirects straight
  to the dashboard. `ruta-dashboard-fixed.html` replaced its
  `sessionStorage.ruta_authed` bypass with a real session bootstrap
  (hides the page via `document.documentElement.style.visibility` until
  `getSession()` confirms one exists, redirecting to sign-in otherwise),
  an `onAuthStateChange` listener for expiry/refresh while the tab stays
  open, a persistent sign-out button in the sidebar, and a new
  `authedFetch()` wrapper — attaches the session's `access_token` as a
  Bearer header, redirects to sign-in on 401 (after calling `signOut()`),
  and shows a "not authorized for this deployment" banner on 403. Every
  one of the dashboard's ~20 `fetch()` call sites now goes through it,
  including a rewritten `connectExcel()` (can no longer be a plain `<a
  href>` navigation now that `excel-oauth-start` requires auth — it calls
  the function via `authedFetch`, gets back `{authorizeUrl}` as JSON, and
  navigates the browser there itself). Only the anon/publishable key ever
  reaches the browser; the profile panel shows the real signed-in email.
- **The 5 functions still missing from the security-hardening pass are
  written.** `excel-oauth-start` (already written before this entry)
  requires an authorized session and mints a real `state` + PKCE
  `code_verifier`/`code_challenge` pair per attempt, stored server-side in
  a new `oauth_states` table. `excel-oauth-callback` (new) atomically
  consumes that row (`UPDATE ... WHERE state=$1 AND used_at IS NULL AND
  expires_at > now()`) before exchanging Microsoft's code — missing,
  unknown, expired, reused, and wrong-provider state are all rejected the
  same way; the stored PKCE verifier goes into the token-exchange body;
  errors redirect with a short generic code, never a token, verifier, or
  Microsoft's own error text (logged server-side instead). `whatsapp-
  webhook` (new) reads the raw POST body via `req.text()` and verifies
  Meta's `X-Hub-Signature-256` against `whatsapp_config.meta_app_secret`
  *before* any `JSON.parse`, rejecting with 401 first; a new
  `whatsapp_webhook_events` table (message_id primary key,
  insert-before-ack) makes redelivery a no-op instead of reprocessing,
  and a genuine insert failure returns 500 so Meta retries rather than
  silently dropping the message. `whatsapp-setup-tracking-template` and
  `whatsapp-webhook-subscription` (both administrative, previously
  unauthenticated) gained the standard `requireAuthorizedUser` guard with
  no other logic change.
- **Full function-authorization audit** (17 functions total): every one
  requires an authorized session except two, both public by protocol-
  level design rather than an oversight — `excel-oauth-callback`
  (Microsoft's own redirect, no way to carry a bearer token; gated by
  state+PKCE instead) and `whatsapp-webhook` (Meta's own server-to-server
  call; gated by the signature above instead).
- **Internal auth review.** The service-role-key-as-bearer-token special
  case in `_shared/auth.ts` (added so `risk-recommendation` could call
  `erp-inventory` internally) is removed outright — no current caller
  needs a credential broader than this. `risk-recommendation` now
  forwards the original caller's own `Authorization` header to
  `erp-inventory`, which independently re-verifies that same real user
  the same way a direct call would. No scheduled/cron job exists yet
  that would need a narrower server-initiated credential; noted for if
  one ever does.
- **Rate limiting made race-safe.** The original check-then-insert
  (`isShipmentInCooldown` + `logSend` as two round-trips) had a TOCTOU
  gap two near-simultaneous requests could both slip through. A new
  `claim_whatsapp_send_slot` Postgres function
  (`pg_advisory_xact_lock`, `security definer`, `service_role`-only)
  checks the window and inserts the log row as one atomic call;
  `_shared/rateLimit.ts` gained `claimSendSlot`/`releaseSendSlot`
  (compensates a claimed slot if the actual send then fails) built on
  it, used by both `request-tracking-update` and `send-whatsapp-alert`.
- **Tests.** 4 new Deno unit test files (36 new cases: `crypto_test.ts` —
  `verifyMetaSignature` against a real HMAC-SHA256 including a wrong
  secret/tampered body/missing header/malformed hex, PKCE against RFC
  7636 Appendix B's own worked test vector, `randomToken`/`base64url`;
  `cors_test.ts` — allowed/disallowed origin, preflight 204 vs 403, the
  `ALLOWED_ORIGINS` override; `rateLimit_test.ts` — the pure cooldown/
  claim-counting logic at and around window boundaries) plus a new
  Playwright integration test (`dashboard_auth_test.js`, 10 checks): no
  session → redirect to sign-in; an authorized session → dashboard
  visible, profile shows the real email; a mocked 403 → banner shown; a
  mocked 401 → signed out and redirected, confirmed the mock session was
  actually cleared (not just a same-page flag) so index.html's own check
  doesn't bounce straight back; the sign-in page's own two cases (no
  session shows the form, an existing session redirects onward). The two
  pre-existing integration tests (`dashboard_null_safety_test.js`,
  `dashboard_regression_test.js`) had their now-obsolete
  `sessionStorage.ruta_authed` bypass replaced with a stub of the
  supabase-js CDN module and still pass exactly as before (12/12, 7/7) —
  confirming the auth rewrite didn't regress the null-safety/regression
  rendering work from the previous two passes. All 70 Deno unit tests and
  all 29 integration checks pass. `deno check` is clean on every file
  touched this pass; the same pre-existing type-inference gap documented
  for `erp-inventory`'s `excelAdapter` parameter (a bare
  `ReturnType<typeof createClient>` losing inference across a function
  boundary without a generated Database type) was hit newly by
  `_shared/rateLimit.ts`'s two new exported functions once
  `request-tracking-update`/`send-whatsapp-alert` started calling them —
  fixed there (not just documented, since it was blocking `deno test`
  from running at all) by loosening `SupabaseAdmin` to `any`; left
  undisturbed in `erp-inventory`/`excel-browse`/`excel-select-workbook`,
  which this pass didn't touch.
- **Not done this pass**: nothing was deployed, no migration was applied
  to the live Supabase project, no credential was rotated, and no
  external Meta/Microsoft configuration was changed, matching the task's
  explicit instruction. The live system remains exactly as described in
  `SECURITY_AND_PILOT_BLOCKERS.md` until the deployment plan there is
  actually run.

## 2026-09-23 — Documentation accuracy pass (no code changed)

A full re-verification of `CLAUDE.md`, `UTOPIA_CURRENT_SPEC.md`,
`SECURITY_AND_PILOT_BLOCKERS.md`, `PILOT_PLAYBOOK.md` (this file's own
entries were only appended to, never rewritten, per this project's own
standing rule for `BUILD_LOG.md`) against the actual code, correcting
several claims that had drifted from what the repository and the live
system actually do. No application code was modified and nothing was
deployed as part of this pass.

- **"AI-assisted" corrected to "rule-based."** Confirmed by re-reading
  the scoring engine, the WhatsApp reply-matching regex, and a repo-wide
  search for any AI/ML/LLM library or API call: none exists anywhere in
  this codebase. "AI-assisted supply-chain risk intelligence" (the
  product tagline in `CLAUDE.md`, `UTOPIA_CURRENT_SPEC.md`, and
  `PILOT_PLAYBOOK.md`) overstated this and is now "rule-based
  supply-chain risk intelligence," consistent with the project's own
  long-standing "Explainable before predictive... not an ML model"
  principle.
- **Scoring-formula shorthand corrected.** "Storm severity × days of
  safety stock × transfer cost" (in `UTOPIA_CURRENT_SPEC.md`'s and
  `PILOT_PLAYBOOK.md`'s design-principles framing) was a misleading
  compression of the real mechanism — verified directly against
  `risk-recommendation/scoring.ts` and `index.ts`'s
  `EXPECTED_DELAY_DAYS` mapping. Replaced with: "Utopia converts weather
  and storm severity into an expected-delay assumption, compares that
  delay with each SKU's days of safety stock, estimates potential unit
  shortfall and sales exposure, and evaluates possible transfer costs."
  The detailed "Scoring engine" section of `UTOPIA_CURRENT_SPEC.md`
  already described the real mechanism correctly — only the shorthand
  echoes elsewhere were wrong.
- **Repository vs. deployed status made explicit throughout
  `UTOPIA_CURRENT_SPEC.md`.** Added a top-level section stating the
  general divergence (the 2026-09-22/23 security-hardening pass is
  implemented and tested but not deployed), plus explicit "Repository
  status" / "Production status" pairs on Persistence, WhatsApp, and the
  driver-tracking webhook sections specifically — the capabilities whose
  described behavior actually differs live vs. in the repo. Capabilities
  whose behavior is identical either way (the scoring math, the WhatsApp
  send/receive mechanics themselves) were left tagged as they were.
- **Endpoint risk reclassified in `SECURITY_AND_PILOT_BLOCKERS.md`.**
  `risk-recommendation`, `decisions-list`, `excel-browse`, the shipment
  endpoints, and `risk-location-settings` were previously grouped as
  "low risk" alongside a genuinely public endpoint (`storm-signal`).
  Corrected: each now states plainly what it exposes (real inventory
  shortfall/exposure figures, real decision history, real OneDrive
  file/table metadata, real shipment PII, real operating configuration)
  and that this requires authentication — `storm-signal` is now the only
  endpoint described as genuinely low-risk, since it returns identical,
  non-customer-specific data to every caller.
- **Security-status labels mapped onto four explicit categories**
  (Implemented / Tested / Awaiting deployment / Deployed and verified /
  Still open) in `SECURITY_AND_PILOT_BLOCKERS.md`'s priority list,
  replacing the previous informal "written"/"not started" language with
  a stated definition for each label and which specific test (if any)
  covers each item.
- **Demonstration sequence corrected in `PILOT_PLAYBOOK.md`.** Step 5
  previously instructed letting "a couple of live page reloads...
  naturally seed a few genuinely fresh Decisions entries." Verified
  against `risk_snapshots`' fingerprint-based dedup (added 2026-09-22):
  a repeat page load with an unchanged signal increments an existing
  row's counter rather than creating a new entry, and Decisions history
  is actually built from `recommendation_events` (real approve/dismiss/
  undo actions), not from snapshots alone — so "reload to seed history"
  was never quite accurate even before that dedup existed. Replaced with
  one explicit evaluation/refresh followed by an actual approve/dismiss
  action, with an explanation that meaningful history comes from genuine
  decisions, not reloads.
- **Language-toggle claim corrected in `UTOPIA_CURRENT_SPEC.md`.** The
  Dashboard views section claimed the Spanish/English toggle "covers
  every static and dynamic string in the UI," directly contradicting
  that same document's own "Planned" section two headings later (which
  correctly listed bilingual server-side severity strings as not yet
  built) — an internal inconsistency, not just an external one. Verified
  directly: `corridor.reasons` (the severity explanation text rendered
  in the dashboard's "why" panel) is generated server-side in
  `risk-recommendation/index.ts` as hardcoded English strings and passed
  through the dashboard's `tr()` translation layer untouched. Corrected
  to state plainly that client-generated interface text is bilingual
  while server-generated severity explanations remain English-only.
- **"Permanent" WhatsApp token language corrected going forward.**
  "Permanent (non-expiring) access token" (`UTOPIA_CURRENT_SPEC.md`)
  replaced with "a token with no scheduled expiration; it can still be
  revoked or invalidated" — accurate to what a Meta System User token
  with expiration set to "Never" actually guarantees (no *scheduled*
  expiry, not immunity from revocation). This project's own historical
  entries above (2026-09-21 and earlier, describing the actual migration
  as it happened) are left as originally written, per this file's
  standing rule against rewriting history — only current-state documents
  were corrected.
- **Excel/OneDrive data reclassified.** `UTOPIA_CURRENT_SPEC.md`
  described the Excel adapter's verification data as "real,
  non-synthetic data" and "20 real inventory rows." Verified against
  this file's own 2026-09-01 entry: the connected Microsoft account is a
  personal account registered for building/testing this connector, and
  `PILOT_PLAYBOOK.md`'s own "Pilot scope" section confirms no pilot
  customer is confirmed yet. Corrected to describe this as a real,
  live-connected integration (genuine OAuth, a genuine Microsoft
  account, genuine Graph API calls) exercised against test/sample rows,
  not an operating company's actual inventory — the mechanism is real,
  the data content is not "real operational company data."
- **Unsourced benchmark ranges removed from `PILOT_PLAYBOOK.md`.**
  "10–20% forecast error reduction, 5–12% inventory reduction," cited as
  "published industry benchmarks" with no actual source named, were
  removed rather than re-sourced — no citation for these specific ranges
  could be verified in this pass, and inventing one would have been
  worse than removing the numbers. Replaced with guidance to find and
  cite a real, checkable source at the time it's actually needed for a
  prospect conversation, and to be explicit that any such figure
  describes the industry in general, not something Utopia has itself
  demonstrated.
- **Claims that could not be verified either way** (carried forward,
  not newly discovered this pass — see `UTOPIA_CURRENT_SPEC.md`'s
  Visual design section): a code comment near the `--orange` CSS
  variable's declaration claims genuine high-severity states
  "reference `--orange` too," which does not match the actual CSS rule
  as read directly; left as an application-code inconsistency, out of
  scope to fix in a documentation-only pass.
- **Markdown validated**: `markdownlint-cli` run against all five files;
  all four relative links in `CLAUDE.md` (to the other four documents)
  confirmed resolving to files that exist in this same directory. Full
  lint output is in the task summary delivered alongside this change,
  not reproduced here.

## 2026-09-23 — Documentation-consistency and deployment-readiness pass (no code changed)

A further documentation-only pass, following the same-day "Documentation
accuracy pass" above: reconciled the Edge Function inventory, corrected
wording that still overstated or understated deployment reality, and
added the deployment runbook two other documents had been pointing at
without the file actually existing.

- **Edge Function inventory reconciled to all 19.**
  `SECURITY_AND_PILOT_BLOCKERS.md` gained a full 19-row table: the 17
  functions with local, git-tracked source, plus `storm-signal` and
  `excel-debug`, both deployed directly to the live project with no local
  directory and no git history at all. The "19 deployed vs. 17 audited"
  phrasing in earlier notes was never a real contradiction — it
  described two different sets without saying so; the new table names
  both sets explicitly, with per-function caller/auth-model/data-
  sensitivity/side-effect detail for all 19. `excel-debug` (fully
  disabled, HTTP 410 for every request, its own code comment already
  says safe to delete) is flagged for manual removal, not deleted.
  `storm-signal`'s source comments reference an unrelated project's
  functions (`gmail-summary`, `patrol-summary`, `attendance-feed`) that
  don't exist here — flagged for a future cleanup task, left untouched.
  Three functions with no dashboard call site at all
  (`send-whatsapp-alert`, `whatsapp-setup-tracking-template`,
  `whatsapp-webhook-subscription`) are flagged for the owner's manual
  review on whether to keep them as admin tools or retire them, not
  removed.
- **Confirmed live, by directly fetching the hosted URLs rather than
  assuming from the git log: the dashboard's frontend security fix has
  already shipped.** `index.html` already serves the real magic-link
  sign-in form; `ruta-dashboard-fixed.html` already contains
  `authedFetch`/`getSession`, with no `sessionStorage`/`ruta_authed` gate
  remaining. `SECURITY_AND_PILOT_BLOCKERS.md`'s "single shared
  password... `sessionStorage` flag" bullets and `UTOPIA_CURRENT_SPEC.md`'s
  "the live dashboard has not been redeployed" line were both accurate
  when written and are now stale — corrected in both documents. The real
  remaining gap is entirely backend: none of the 19 deployed Edge
  Functions check the session/allowlist the already-live dashboard
  sends.
- **"Not implemented" headings renamed where the work is actually
  implemented in the repository.** `SECURITY_AND_PILOT_BLOCKERS.md`'s
  "Meta webhook signature validation — not implemented" and "Rate
  limiting — not implemented anywhere" headings both described only the
  live/deployed state; the rate-limiting body text never mentioned that
  a race-safe limiter already exists in committed, tested, undeployed
  code. Both headings and the rate-limiting body now state
  Implemented-in-repository/Tested-locally/Awaiting-deployment
  explicitly, and the priority list's status legend was expanded from
  three informal labels to the six precise ones this pass standardized
  on: Implemented in repository / Tested locally / Awaiting deployment /
  Deployed / Verified in production / Still open.
- **Excel-data classification tightened further.** The prior pass
  already corrected "real, non-synthetic data" to "test/sample rows,"
  but still stated that classification more confidently than this
  project's own no-row-reading policy supports. `UTOPIA_CURRENT_SPEC.md`
  now states explicitly, in the exact required wording: the workbook
  belongs to a personal development account with no confirmed pilot
  customer, its row contents were not inspected by this or any prior
  documentation pass, and "test/sample data" is a documentation and
  metric-classification treatment applied in that absence, not a claim
  about what the cells actually contain.
- **Meta-token wording corrected a third time, more precisely.** The
  prior pass's "a token with no scheduled expiration; it can still be
  revoked or invalidated" still opened with "works today," which implied
  validity had just been rechecked. `UTOPIA_CURRENT_SPEC.md` now states
  explicitly, in the exact required wording: the token was previously
  verified working, its current validity was not rechecked during this
  specific review, and it remains revocable — never described as
  permanent or guaranteed non-expiring at any point.
- **`DEPLOYMENT_RUNBOOK.md` created**, filling a gap four separate
  passages (in `CLAUDE.md`, `SECURITY_AND_PILOT_BLOCKERS.md` twice, and
  `PILOT_PLAYBOOK.md`) already pointed at without the file existing:
  preconditions (clean commit, the exact test suite that must pass, a
  DB backup/recovery plan, Supabase Auth/Microsoft/CORS configuration to
  confirm, secret names with no values, a literal grep command
  confirming no service-role credential reaches browser code); an
  ordered release sequence reasoned explicitly around the one real
  lockout risk this project has (seed `pilot_authorized_emails` with the
  owner's own email *before* redeploying any function that gates on it,
  since the dashboard already sends a real session in production and
  would otherwise 403 the owner on first use) and around not breaking
  the currently-working Excel/WhatsApp pipelines (redeploying
  `excel-oauth-start`/`excel-oauth-callback` together, never separately;
  setting `whatsapp_config.meta_app_secret` before `whatsapp-webhook`'s
  redeploy); a 19-row production smoke-test table; a per-layer rollback
  plan naming exactly what reopens a known vulnerability if rolled back,
  plus an explicit owner-lockout recovery path and a fast outbound-
  WhatsApp kill switch; and a blank post-deployment verification record.
  Linked from `CLAUDE.md`'s index and from every prior "deployment plan"
  reference across the other documents.
- **Not done this pass:** nothing was deployed, no migration was applied
  to the live Supabase project, no credential was rotated, no external
  Meta/Microsoft/Supabase configuration was changed, and the dashboard
  was not (re-)published — its current live state was only verified,
  not altered, by this pass.
- **Markdown validated**: `markdownlint-cli` run against all six files
  (the five existing documents plus the new `DEPLOYMENT_RUNBOOK.md`);
  every relative link across all six (`CLAUDE.md`'s five,
  `SECURITY_AND_PILOT_BLOCKERS.md`'s two, `PILOT_PLAYBOOK.md`'s one,
  `UTOPIA_CURRENT_SPEC.md`'s one) confirmed resolving to a file that
  exists in this same directory. All six packaged into
  `UTOPIA_DOCUMENTATION_FINAL_REVIEW.zip`.
