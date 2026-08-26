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

- A static UI reference (`ruta-dashboard-fixed.html` in this repo, if
  included) — real HTML/CSS extracted from an earlier AI-builder mockup,
  extended with: a demo-vs-live data banner, an expandable "why this
  recommendation," a dismiss/undo flow, an urgency deadline on the decision
  card, and a WhatsApp click-to-chat button (`wa.me` link, currently a
  placeholder number).
- **No backend exists yet.** Every number in that file is hardcoded sample
  data. Nothing is connected to a real ERP, weather feed, or messaging
  channel.

## Pilot target — FILL THIS IN FIRST

Everything downstream depends on this. Do not build ERP integration code
until this is answered:

- Pilot customer: ______
- Their ERP: Odoo (XML-RPC/REST API) or SAP Business One (Service Layer REST
  API)? ______
- 5–10 fastest-moving / most exposed SKUs to track first (don't try to sync
  the whole catalog): ______

## Build order

1. **~~Pick pilot partner + ERP~~** — business decision, not a coding task.
   Answer the section above before starting step 2.

2. **Real risk signal ingestion.** Start here — free, keyless, immediately
   provable:
   - Open-Meteo (7-day operational outlook) — no auth required.
   - NOAA/NHC active-storm feed — public, has GIS/RSS feeds.
   - This alone replaces the hardcoded "72% confidence" tropical-system card
     with something computed from real data. Easiest, highest-confidence win
     for a first pilot demo.

3. **Read-only ERP connection** for the SKU shortlist above (inventory
   levels, reorder points). Odoo or SAP B1 API depending on the answer
   above. Read-only — no write access needed yet.

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
