# Utopia — Supply Resilience Intelligence

Rule-based supply-chain risk intelligence for Honduran importers/
distributors, built as a thin layer on top of a customer's existing ERP —
not a replacement for it. Origin: San Pedro Sula. (No AI/ML component
currently influences recommendations or message interpretation — see the
"Explainable before predictive" principle below. "AI-assisted" in earlier
versions of this file overstated what's actually implemented.)

**This file is now a short index.** The full documentation was reorganized
on 2026-09-22 out of a single combined file into four focused documents,
with a fifth (the deployment runbook) added 2026-09-23 — each
cross-checked against the live code rather than carried forward
unverified:

- **[`UTOPIA_CURRENT_SPEC.md`](./UTOPIA_CURRENT_SPEC.md)** — what's actually
  true right now, capability by capability, each tagged Live and verified /
  Implemented but not live-validated / Demo-sample data / Planned. Read
  this first for "what does this thing currently do."
- **[`SECURITY_AND_PILOT_BLOCKERS.md`](./SECURITY_AND_PILOT_BLOCKERS.md)** —
  authentication status, every endpoint's real exposure, and the ordered
  list of what's required before real customer data flows through this.
  As of 2026-09-23, a full auth/OAuth-state/webhook-signature hardening
  pass is written, tested, and committed but **not deployed** — the
  document distinguishes what's fixed in the repository from what the
  live system still does today. Read this before connecting anything to
  a real customer.
- **[`BUILD_LOG.md`](./BUILD_LOG.md)** — the full chronological history:
  what was built, what broke, what was found, how each fix was verified,
  and every earlier description that's since been superseded.
- **[`PILOT_PLAYBOOK.md`](./PILOT_PLAYBOOK.md)** — product positioning,
  the demonstration sequence, discovery questions, pilot scope, success
  metrics, and per-ERP integration questions to resolve with a prospect.
- **[`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md)** — the exact,
  ordered steps to take the written-but-undeployed security-hardening
  pass live: preconditions, release sequence, production smoke tests,
  rollback plan, and a verification record. Read this before running any
  deployment — it's the actual plan, not just a narrative description of
  one.

## Non-negotiable design principles

These constrain every capability described in the five files above and
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

- Treat the five documents above as a record of claims, not proof the
  implementation matches — verify against the actual code before trusting
  or repeating a claim, the same standard this reorganization was held to.
- Never describe committed-but-undeployed code as live, and never
  redeploy anything by running `DEPLOYMENT_RUNBOOK.md` without the
  human owner's explicit go-ahead for that specific release.
- Never expose credentials, tokens, private phone numbers, passwords,
  Supabase project references, Meta account identifiers, or other personal
  infrastructure identifiers in any of these documents — redact, don't
  reproduce, even when an internal tool surfaces the real value.
- Update `UTOPIA_CURRENT_SPEC.md` when a capability's real status changes;
  add to `BUILD_LOG.md` rather than editing it retroactively (it's a
  historical record); keep `SECURITY_AND_PILOT_BLOCKERS.md` honest about
  what's still actually unfixed.
