# Utopia — Pilot Playbook

Business-facing content: positioning, how to demo this, what to ask a
prospect, what's still needed before a real pilot, and how to judge
whether one worked. Engineering status lives in `UTOPIA_CURRENT_SPEC.md`;
security prerequisites live in `SECURITY_AND_PILOT_BLOCKERS.md`.

## Product positioning

Utopia is rule-based supply-chain risk intelligence for Honduran
importers/distributors, built as a thin layer on top of a customer's
existing ERP — not a replacement for it. No AI/ML component currently
influences its recommendations or message interpretation — earlier
"AI-assisted" framing overstated what's actually implemented. The core
mechanism: Utopia converts weather and storm severity into an
expected-delay assumption, compares that delay with each SKU's days of
safety stock, estimates potential unit shortfall and sales exposure, and
evaluates possible transfer costs — surfacing a small number of
high-confidence recommendations which a human approves or dismisses; the
system never acts autonomously. This is a deliberate trust and liability
choice, not just a UX one, and it's also the honest answer to "why not
just use an ML model": local logistics/customs data isn't clean or
API-rich enough yet to trust a black box, and a rule a human can audit
builds more trust with a first pilot customer than marginal accuracy
gains would.

**Competitive framing:** a competing local company already offers truck-
fleet tracking. The pitch to a prospect already familiar with that needs
to be the risk-scoring + inventory tie-in specifically — not tracking
alone, since tracking by itself may already be solved for them. Separately,
SAP's own licensing fees are frequently cited by prospects as high — worth
keeping in mind when positioning/pricing Utopia against "doing nothing"
as well as against SAP's own tooling.

**Pricing structure worth keeping in mind for a first pilot:** pay only
if it works ("si no funciona no pagas, si funciona pagan") — not a
committed pricing model, but the framing that came out of an early
advisor conversation and is worth carrying into the first real pilot
pitch.

## Demonstration sequence

The strongest demo is proving the product live, in person, rather than
walking through pre-seeded sample history (a static history a prospect has
to take on faith is weaker than watching it happen):

1. Show Command with today's real weather/storm-derived severity and
   whatever real recommendation it produces.
2. Create a shipment on the spot, with a realistic name and PO reference,
   in the Shipments view.
3. Click "Request tracking update" and show the real WhatsApp message
   arrive on a real phone.
4. Reply to that message from the phone and watch the dashboard update
   with the driver's real reply.
5. Run one explicit evaluation or refresh of Command so the prospect
   sees a real computation happen live, then actually approve or dismiss
   the recommendation it produces (or the one from step 1) in the
   Decisions view. **A page reload by itself does not create meaningful
   Decisions history** — the current code deliberately dedups a repeat
   computation of the same signal within a short window into one row
   instead of a fresh entry (see `UTOPIA_CURRENT_SPEC.md`'s Persistence
   section), and a real decision record only comes from an actual
   approve/dismiss/undo action, not from the page loading. Meaningful
   history accumulates the same way it would for a real customer: through
   genuine decisions made over time, not through repeated reloads staged
   for a demo.
6. Walk through Inventory, Risks, and Integrations to show the real
   (or honestly-labeled sample) data behind each number, and Settings to
   show the location/currency are configurable per deployment, not
   hardcoded to one city.

**Presentation hygiene:** always share the hosted link, never the raw
HTML file — an emailed/downloaded copy of the dashboard file can silently
misbehave (a past real bug, since fixed — see `BUILD_LOG.md`, 2026-08-30)
and hands over internal implementation detail a prospect doesn't need to
see.

## Discovery questions

Captured from an early review conversation with a business advisor —
these are business-validation questions, not implementation questions,
and should be asked before or during an early pilot conversation:

- Does the target segment already manage this in-house? Does an existing
  ERP (e.g. SAP) already cover it? Does an integrator already offer this?
  Is there a real, unmet need, or is this solving an already-solved
  problem for this specific prospect?
- What do this prospect's actual vendor/provider costs look like (hosting,
  APIs, any existing tooling) — relevant to how Utopia's own pricing
  should be positioned against their status quo, not just against a
  hypothetical.
- Who is a real prospect that can actually pay, at an accessible cost, for
  a first validation — not necessarily the biggest available logo.

## Pilot scope

**Still needed before pointing this at an actual company's ERP** (the
connector works in demo mode without any of this):

- A confirmed pilot customer.
- Confirmation of their ERP: Odoo, SAP Business One, Excel/OneDrive, or
  ZafraCloud.
- Their 5–10 fastest-moving / most exposed SKUs to track first — don't
  try to sync a whole catalog for a first pilot.

**Build-order status** (detailed technical status lives in
`UTOPIA_CURRENT_SPEC.md`; this is the scope-level view):

1. Pick pilot partner + ERP — business decision, still open, not a
   blocker for anything below (all built generic so a real pilot is a
   config change later).
2. Real risk signal ingestion — done.
3. Read-only ERP connection — done in demo mode; Excel is also live and
   verified against a real account; Odoo/SAP B1/ZafraCloud are built but
   unvalidated against any live instance.
4. Rule-based scoring engine — done.
5. Persistence layer — done.
6. WhatsApp, pilot/fast path — done for the driver-tracking use case and
   Meta's own default template; a general proactive risk-alert template
   to a business owner is not yet built or approved.
7. Before showing this to a real pilot customer: a real production domain
   (non-negotiable before connecting real ERP or carrier credentials —
   still open, not started), and real backend-enforced authentication
   (even single-tenant) before any real ERP data flows through this —
   implemented and tested in the repository as of 2026-09-23, but not
   yet deployed (the dashboard's own sign-in is already live; the
   backend functions are not); see `SECURITY_AND_PILOT_BLOCKERS.md` for
   the specific list and [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md)
   for the deployment plan itself.
8. Driver/provider WhatsApp tracking agent, an extension beyond the
   original 7-step scope — done, proven end-to-end in both directions.

**Natural next steps once a pilot is closer:** automatic/scheduled
tracking requests (deliberately not built yet — manual-button-only,
consistent with "suggestion, never autonomous action"), and a sturdier
tracking-code detector than the current simple pattern match.

## Pilot success metrics

Lead with what's provable in a 4–8 week pilot, not eventual steady-state
numbers:

- Advance warning time on flagged disruptions — directly measurable, no
  attribution problem.
- Suggestion approval/dismissal rate — already queryable today (see the
  Decisions view), though see `SECURITY_AND_PILOT_BLOCKERS.md` for why
  this number needs real/test data separated before quoting it to a
  prospect.
- 1–2 concrete "we flagged X and you avoided it" stories.

Do not cite specific industry-benchmark percentages (forecast error
reduction, inventory reduction, or similar) when discussing expected
steady-state outcomes — no source for a specific range has been
verified for this document, and Utopia itself has no pilot data yet to
support any figure as its own demonstrated outcome. If a specific
benchmark is needed for a prospect conversation, find and cite a real,
checkable source at that time (industry report, named study) rather than
repeating a round number from memory, and be explicit that it describes
the industry in general, not something Utopia has proven. Any steady-
state improvement claim is inherently hard to prove within a 4–8 week
pilot with small SKU counts and short observation periods regardless of
what number is used.

## ERP integration questions to resolve per prospect

- **Licensing** — neither the Odoo nor SAP B1 adapter has confirmed that
  a target company's actual license tier permits third-party API
  integration at all. Ask early; don't assume.
- **SAP B1's data shape** — the current adapter's field mapping was
  written against the documented Service Layer shape; a real instance's
  denormalized data model likely needs more transformation work than
  currently written. Budget engineering time for this, don't assume a
  drop-in fit.
- **SAP Integration Suite is not required** for a typical SAP Business
  One customer — that's a separate enterprise iPaaS product usually
  paired with larger SAP landscapes (S/4HANA, ECC), not something a
  typical SAP B1 shop already has. The existing adapter's direct use of
  SAP B1's own Service Layer REST API is the correct, official, first-
  party integration method for SAP B1 specifically. Only reconsider this
  if a specific prospect runs a bigger SAP landscape whose IT policy
  requires integrations to go through a governed middleware layer — ask
  that prospect's IT team directly if and when it's real, rather than
  building for it speculatively.
- **ZafraCloud cost, if a prospect uses it:** getting a token to actually
  validate the adapter against a live account costs real money — a one-
  time integration fee (quoted at L.575) plus a recurring monthly plan
  (cheapest tier quoted at L.350/month); a separate, pricier webhook
  add-on (quoted at L.920/month) is not needed, since Utopia already
  polls on a schedule rather than requiring push notifications. Don't
  spend this until a specific ZafraCloud-using prospect is validated and
  ready to onboard — at which point they'd likely absorb it as part of
  adopting Utopia, same as any other ERP integration cost.
