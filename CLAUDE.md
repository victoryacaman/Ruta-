# Utopia — Supply Resilience Intelligence

AI-assisted supply-chain risk intelligence for Honduran importers/
distributors, built as a thin layer on top of a customer's existing ERP —
not a replacement for it. Origin: San Pedro Sula.

**This file is now a short index.** The full documentation was reorganized
on 2026-09-22 out of a single combined file into four focused documents,
each cross-checked against the live code rather than carried forward
unverified:

- **[`UTOPIA_CURRENT_SPEC.md`](./UTOPIA_CURRENT_SPEC.md)** — what's actually
  true right now, capability by capability, each tagged Live and verified /
  Implemented but not live-validated / Demo-sample data / Planned. Read
  this first for "what does this thing currently do."
- **[`SECURITY_AND_PILOT_BLOCKERS.md`](./SECURITY_AND_PILOT_BLOCKERS.md)** —
  authentication status, every public endpoint's real exposure, the two
  confirmed real gaps (Meta webhook signature validation, Microsoft OAuth
  state handling), and the ordered list of what's required before real
  customer data flows through this. Read this before connecting anything
  to a real customer.
- **[`BUILD_LOG.md`](./BUILD_LOG.md)** — the full chronological history:
  what was built, what broke, what was found, how each fix was verified,
  and every earlier description that's since been superseded.
- **[`PILOT_PLAYBOOK.md`](./PILOT_PLAYBOOK.md)** — product positioning,
  the demonstration sequence, discovery questions, pilot scope, success
  metrics, and per-ERP integration questions to resolve with a prospect.

## Non-negotiable design principles

These constrain every capability described in the four files above and
should not be relaxed without a deliberate conversation:

- **Suggestion, never autonomous action.** The system recommends; a human
  approves. No purchase, transfer, or supplier action fires on its own.
- **Explainable before predictive.** A transparent, rule-based scoring
  function, not an ML model, while local data isn't clean/rich enough to
  trust a black box.
- **Conservative alert volume on purpose.** Fewer, higher-confidence
  suggestions over catching everything.
- **Every suggestion needs a visible "why."** The specific signals behind
  a recommendation are cited inline, not hidden behind a click.

## Rules for whoever (human or AI) works on this next

- Treat the four documents above as a record of claims, not proof the
  implementation matches — verify against the actual code before trusting
  or repeating a claim, the same standard this reorganization was held to.
- Never expose credentials, tokens, private phone numbers, passwords,
  Supabase project references, Meta account identifiers, or other personal
  infrastructure identifiers in any of these documents — redact, don't
  reproduce, even when an internal tool surfaces the real value.
- Update `UTOPIA_CURRENT_SPEC.md` when a capability's real status changes;
  add to `BUILD_LOG.md` rather than editing it retroactively (it's a
  historical record); keep `SECURITY_AND_PILOT_BLOCKERS.md` honest about
  what's still actually unfixed.
