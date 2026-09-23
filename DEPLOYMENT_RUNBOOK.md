# Utopia — Deployment Runbook

The actual, ordered steps to take the written-but-undeployed
security-hardening pass live. Derived directly from the current code and
the live Supabase project (`SECURITY_AND_PILOT_BLOCKERS.md` has the full
per-function detail this runbook assumes; `BUILD_LOG.md` records how each
fix was built and verified, not how to deploy it). No secret values
appear anywhere in this document — only names, paths, and commands.

**Before running any of this**, confirm the frontend/backend split
described in `SECURITY_AND_PILOT_BLOCKERS.md` and
`UTOPIA_CURRENT_SPEC.md` is still accurate: as of this writing, the
dashboard's frontend (`index.html`, `ruta-dashboard-fixed.html`) is
**already live** in production with real Supabase Auth — there is no
"publish the dashboard" step in this runbook because that already
happened. Everything below is about the **backend**: four pending
database migrations and 17 Edge Function redeploys that make the
already-live frontend's authentication actually mean something.

## A. Preconditions

Confirm every item below before starting the release sequence in
Section B. None of these steps change anything live by themselves.

1. **Release commit.** Identify the exact commit being released:
   `Release commit: ______`. Working tree must be clean (`git status`)
   at that commit on `main`.
2. **Tests must pass, re-run against that exact commit** (a green run
   from an earlier commit does not satisfy this):
   - `deno test --allow-env tests/unit/` — expect all 81 tests passing
     (`crypto_test.ts`, `cors_test.ts`, `rateLimit_test.ts`,
     `decisions_metrics_test.ts`, `erp_validation_test.ts`,
     `fingerprint_test.ts`, `scoring_test.ts`, `webhook_idempotency_test.ts`).
   - `NODE_PATH=<node_modules path> node tests/integration/dashboard_auth_test.js`
     — expect 10/10 checks passing.
   - Same for `dashboard_null_safety_test.js` (12/12) and
     `dashboard_regression_test.js` (7/7).
   - `deno check` on every modified `supabase/functions/*/index.ts` and
     `_shared/*.ts` — expect no new errors (the pre-existing
     `erp-inventory`/`excel-browse`/`excel-select-workbook` type-inference
     quirk, documented separately, is not a release blocker).
3. **Database backup / recovery plan.** All four pending migrations
   (below) are additive-only — new tables, new nullable/defaulted
   columns, new functions; none drop or destructively alter existing
   data. Still: take a Supabase backup (point-in-time or manual export)
   immediately before Section B, step 1. Record current row counts as a
   baseline to diff against afterward: `erp_config` (1), `risk_snapshots`
   (58 at last check), `recommendation_events` (0), `whatsapp_config` (1),
   `risk_location_config` (1), `shipments` (0), `excel_oauth` (1).
   Recovery: restore from that backup; the migrations were not designed
   to require this in the normal case.
4. **Required Supabase Auth configuration to confirm** (not change)
   before relying on it:
   - Email/OTP sign-in provider is enabled on the project.
   - The project's Site URL and Redirect URL allow-list include both
     hosted dashboard pages (`index.html`, `ruta-dashboard-fixed.html`).
   - Understand that Supabase Auth itself will issue a real session to
     *any* email address that requests one — `pilot_authorized_emails`
     is the sole authorization gate by design, not a signup restriction
     at the Supabase Auth level.
5. **Authorized pilot email setup.** `pilot_authorized_emails` (created
   by migration 1, below) must contain a row for the owner's own sign-in
   email before Section B, step 6. This is the single most
   important precondition in this document — see step 6's own note for
   why skipping or reordering this locks the owner out.
6. **Microsoft redirect URLs.** Confirm (Azure Portal, read-only check,
   no change) that `https://<project-ref>.supabase.co/functions/v1/excel-oauth-callback`
   is still registered as an allowed redirect URI on the Entra ID app
   registration used by `excel-oauth-start`/`excel-oauth-callback`. This
   does not change with this release — only confirm it hasn't drifted.
7. **Production and local CORS origins.** Production default
   (`https://victoryacaman.github.io`) is already baked into
   `_shared/cors.ts` — no secret needed for the standard case. Local dev
   testing needs no `ALLOWED_ORIGINS` change either: a `file://` request
   carries no `Origin` header at all, which `_shared/cors.ts`'s
   `isAllowedOrigin` already treats as allowed. Only set `ALLOWED_ORIGINS`
   (comma-separated) if a genuinely different origin (e.g. a staging
   domain) needs to call these functions directly from a browser.
8. **Required secret names (no values).**
   - Supabase Edge Function secrets: `ALLOWED_ORIGINS` (optional — only
     needed to add a non-default origin, see above). `SUPABASE_URL` and
     `SUPABASE_SERVICE_ROLE_KEY` are auto-provided by the Edge Functions
     runtime for every function — no action needed for either.
   - Database column values that function as secrets but are **not**
     Supabase Function secrets — set via SQL or the Supabase table
     editor, never via `supabase secrets set`: `whatsapp_config.meta_app_secret`,
     `excel_oauth.client_secret` (the latter is already set from the
     existing live Excel connection and does not need to change).
9. **Meta app secret requirement.** `whatsapp_config.meta_app_secret`
   must be populated with the real value from Meta App Dashboard →
   Settings → Basic → App Secret **before** Section B, step 8
   (`whatsapp-webhook`'s redeploy) — see that step for why the order
   matters.
10. **Confirmation that no service-role credential reaches browser
    code.** Run this exact command and confirm empty output:

    ```bash
    grep -i "service_role\|SUPABASE_SERVICE_ROLE" index.html ruta-dashboard-fixed.html
    ```

    Only the publishable/anon key should ever appear in either file.
11. **Dedicated rate-limit test identity exists.** A real Supabase Auth
    user, created via Auth's own invite/admin flow (never through an
    Edge Function), with its email seeded into `pilot_authorized_emails`
    separately from the owner's own row — needed for Section C's safe
    WhatsApp rate-limit test. One-time setup, not per-release, but
    confirm it still exists and its email is still allowlisted.
12. **Mandatory frontend preflight — a hard gate, run immediately before
    starting Section B:**
    - Open the hosted sign-in page (`index.html`'s real URL) in a clean
      or incognito browser session — no cached session, no extension
      state.
    - Complete one real magic-link login as the owner.
    - Confirm the hosted dashboard's *served* source (not the local
      repo) already contains the session-bootstrap code and
      `authedFetch` — e.g. `curl` the live URL and grep for both:

      ```bash
      curl -s <hosted ruta-dashboard-fixed.html URL> | grep -o "authedFetch\|getSession"
      ```

      Expect both to appear.
    - Confirm, via browser devtools' network tab, that a real protected
      request from that session actually carries an
      `Authorization: Bearer ...` header.
    - Record the exact frontend commit hash currently published by
      GitHub Pages (cross-check against `git log` for
      `index.html`/`ruta-dashboard-fixed.html` on `main`).
    - **Stop here — do not proceed to Section B — if the hosted frontend
      is not the expected released version.** Redeploying the backend
      against a stale or unexpected frontend is exactly the "publishing
      a dashboard that calls incompatible functions" failure mode this
      runbook exists to prevent, just in the opposite direction (backend
      catching up to a frontend that isn't what you think it is).

## B. Ordered release sequence

The dashboard is already live (see the note at the top of this
document) — there is no frontend step in this sequence. The entire
remaining risk concentrates on whether `pilot_authorized_emails` is
seeded *before* the functions that check it start enforcing it, and on
not breaking the two protocol-verified integrations (Excel OAuth,
WhatsApp webhook) mid-flight.

1. **Apply the four pending migrations**, in this order (they don't
   depend on each other, but this is their commit order):
   `20260922000000_security_hardening.sql` (creates
   `pilot_authorized_emails`, `oauth_states`, `whatsapp_webhook_events`,
   `whatsapp_send_log`; adds `whatsapp_config.meta_app_secret`),
   `20260922010000_decision_integrity.sql` (adds `risk_snapshots.environment`/
   `computation_source`/`signal_fingerprint`/`computation_count`/
   `last_computed_at`), `20260923000000_atomic_rate_limit.sql` (creates
   the `claim_whatsapp_send_slot` function), `20260924000000_webhook_idempotency.sql`
   (adds real processing-state columns to `whatsapp_webhook_events` and
   the `claim_webhook_event`/`complete_webhook_event`/`fail_webhook_event`
   functions). **Purely additive — no currently-deployed function
   references any of these new objects yet, so this step changes zero
   live behavior by itself.** Safe to run first, in isolation.
2. **Seed `pilot_authorized_emails`** with one row for the owner's sign-in
   email. Also inert until step 6 below — no function checks this table
   yet. **This must happen before step 6, without exception.**
   Reasoning: `requireAuthorizedUser` (`_shared/auth.ts`) requires a
   valid Supabase session *and* a matching row here — a valid session
   alone gets 403. The dashboard is already live and already sends a
   real session on every call. If step 6 landed before this row exists,
   the owner's own first click after the redeploy would 403 them —
   a self-inflicted lockout, with no fallback, since the old
   service-role-bearer-token bypass was deliberately removed in the
   internal auth review. Seeding first closes this window entirely.
3. **Set `whatsapp_config.meta_app_secret`** to the real Meta App Secret.
   Must happen before step 8 — if the new signature-checking code goes
   live first, every real inbound Meta delivery fails `verifyMetaSignature`
   against an empty/wrong secret, silently breaking driver replies with
   no visible failure signal to a human watching the dashboard.
4. **Confirm** (do not change) the Microsoft redirect URI and CORS
   defaults from Section A, items 6–7. No ordering dependency on
   anything else — can happen any time before step 7.
5. *(No dashboard-publish step. Already live — see the top of this
   document.)*
6. **Redeploy the 15 `requireAuthorizedUser`-gated functions as one
   batch**: `decisions-list`, `erp-inventory`, `excel-browse`,
   `excel-oauth-start`, `excel-select-workbook`, `excel-status`,
   `recommendation-action`, `request-tracking-update`,
   `risk-location-settings`, `risk-recommendation`, `send-whatsapp-alert`,
   `shipments-create`, `shipments-list`, `whatsapp-setup-tracking-template`,
   `whatsapp-webhook-subscription`. This is the actual backend cutover
   moment. Because step 2 already seeded the owner's email and the
   dashboard is already sending a real session, the owner should
   experience zero interruption; anyone hitting these functions directly
   without a session or an allowlisted email now correctly gets
   401/403 — the intended effect, not a regression. No sub-ordering
   needed within this batch: `risk-recommendation` forwards the
   *caller's own* Authorization header to `erp-inventory` rather than a
   broad internal credential, so there's no "deploy X before Y"
   constraint between them.
7. **Redeploy `excel-oauth-callback` together with `excel-oauth-start`**
   — i.e., in the same batch as step 6, never separately in either
   direction. `excel-oauth-callback` is never gated by
   `requireAuthorizedUser` (Microsoft's redirect can't carry a Supabase
   session) — its gate is the self-contained `oauth_states` state+PKCE
   row from step 1's migration, so there is no owner-lockout risk here.
   But it does depend on `excel-oauth-start`'s new code actually writing
   real state+PKCE rows: if the new `excel-oauth-callback` went live
   while `excel-oauth-start` still ran old code (which never stores a
   real state at all), every real Microsoft redirect would be rejected
   as `invalid_state` — breaking the currently-working Excel connect
   flow. Deploying both together avoids this.
8. **Redeploy `whatsapp-webhook`** only after step 3 (Meta app secret
   set) and step 1 (migrations created `whatsapp_webhook_events` and its
   `claim_webhook_event`/`complete_webhook_event`/`fail_webhook_event`
   functions) are both done. Also never gated by `requireAuthorizedUser`
   — its gate is Meta's own HMAC signature, self-contained and
   protocol-level, so there's no owner-lockout risk here either. Two
   real risks if deployed before its dependencies: the secret risk named
   in step 3, and — new as of the 2026-09-24 idempotency fix — deploying
   this function before the `20260924000000_webhook_idempotency.sql`
   migration lands would call RPCs that don't exist yet, failing every
   inbound delivery outright (a much louder failure than the old
   silent-loss bug, but still worth sequencing correctly).
9. **After Section C's smoke tests pass**, handle the two deployed-only
   functions from the reconciliation table:
   - `excel-debug`: safe to delete now (its own code returns HTTP 410
     for every request already) — zero callers, zero risk. Do this last,
     purely for tidiness.
   - `storm-signal`: **do not touch** — it's the real, actively-used
     weather relay. Its stray comments referencing an unrelated
     project's functions are a hygiene note for a separate future task,
     not a deployment action.
   Also revisit, as a manual owner decision (not an automatic step):
   whether `send-whatsapp-alert`, `whatsapp-setup-tracking-template`, and
   `whatsapp-webhook-subscription` — all three now correctly auth-gated
   by step 6, but with no dashboard UI caller — should stay deployed as
   admin tools or be formally retired.
10. **Re-run the full Section C smoke-test list end-to-end against
    production**, then fill in Section E's verification record.

## C. Production smoke tests

Run every row below against the live system after Section B completes.
Row 17 (the WhatsApp rate limit) has a full safe procedure in its own
subsection right after the table — do not run the naive "send 11 real
messages" approach.

| # | Test | Steps | Expected result |
| --- | --- | --- | --- |
| 1 | Authorized magic-link login | Request a magic link for the owner's allowlisted email; click it | Real Supabase session issued; dashboard renders |
| 2 | Unauthorized email | Request a magic link for a non-allowlisted email; click it; try any dashboard action | Supabase session issues fine; first protected call returns 403; "not authorized" banner shown |
| 3 | Session restoration | Reload the dashboard tab with an existing valid session | No re-login prompt; dashboard renders directly |
| 4 | Sign-out | Click the sidebar sign-out button | Session cleared; redirected to sign-in; a subsequent reload does not restore the old session |
| 5 | 401 behavior | Call a protected endpoint with an expired/garbage bearer token | 401; dashboard (if triggered from the UI) signs out and redirects to sign-in |
| 6 | 403 behavior | Call a protected endpoint with a valid session for a non-allowlisted email | 403; dashboard shows the "not authorized" banner, does not redirect |
| 7 | Every dashboard view | Visit Command, Risks, Inventory, Decisions, Shipments, Integrations, Settings, Add tools as the authorized owner | Each renders real data with no console errors |
| 8 | Protected operational endpoints | `curl` each of the 15 gated functions directly with no `Authorization` header | Every one returns 401, not 200 |
| 9 | Microsoft OAuth state/PKCE success | Run a real "Connect with Microsoft" flow end to end | Completes; `excel_oauth` row updated; no `invalid_state` error |
| 10 | Expired/reused OAuth state | Replay an already-used or expired `state` value against `excel-oauth-callback` | Redirects with a generic `invalid_state` error, never a token or verifier in the URL |
| 11 | Valid Meta webhook signature | Send a correctly-signed test payload to `whatsapp-webhook` | 200; a `whatsapp_webhook_events` row exists with `status='completed'` and `processed_at` set |
| 12 | Invalid Meta webhook signature | Send a tampered body or wrong-secret signature to `whatsapp-webhook` | 401; **no row created at all** in `whatsapp_webhook_events` (confirm by `message_id`, not just by response code) |
| 13 | Duplicate delivery, completed | Send the same `message_id` payload twice, letting the first fully succeed | Second delivery is a no-op (`duplicate_completed`, matched shipment not touched again); still 200 |
| 14 | Duplicate delivery, failed | Force the shipment update to fail once (e.g. temporarily point `driver_phone` at a value that violates a constraint, or simulate via a broken `shipments.update` for one delivery), redeliver the same `message_id` | First delivery: 500, row status `failed`. Second (retry): reprocessed for real, ends `completed` |
| 15 | Stale-processing recovery | Manually set an existing row to `status='processing'`, `updated_at` older than 5 minutes ago (via SQL), then redeliver that `message_id` | Reclaimed and reprocessed (`attempt_count` incremented), not skipped as in-progress |
| 16 | Concurrent duplicate deliveries | Best-effort only — fire two requests with the identical `message_id` as close to simultaneously as your tooling allows (e.g. two parallel `curl` processes) | At most one reaches `completed` with a real shipment update; the other gets `duplicate_in_progress` (409) or `duplicate_completed` (200), never a second shipment update. **Caveat:** true simultaneity can't be guaranteed by a shell script — this is a best-effort live check, not a proof; the underlying guarantee is the `pg_advisory_xact_lock` in `claim_webhook_event`, not this test |
| 17 | WhatsApp hourly rate limit (safe procedure) | See the dedicated subsection immediately below — **do not send 10 real messages to test this** | `429` on the one real call made, zero real Meta sends during the test |
| 18 | `send-whatsapp-alert` integration still works | One ordinary real send via `send-whatsapp-alert` as the **owner** (not the rate-limit test identity), to `whatsapp_config.test_recipient_number` | Real message arrives; confirms the rate-limit redesign didn't break the actual send path |
| 19 | WhatsApp per-shipment cooldown | Call `request-tracking-update` twice within 60 minutes for the same shipment | Second call blocked with a 429/cooldown response, no duplicate message sent |
| 20 | Decision-history demo/pilot separation | Call `decisions-list` with default params | Response scope excludes `environment` values other than `pilot` by default, matches `decisions_metrics_test.ts`'s expectations |
| 21 | No Origin, no token | Call a protected endpoint with no `Origin` header and no `Authorization` header (e.g. plain `curl`) | `401` — a missing `Origin` only bypasses *browser* CORS evaluation, it is never a substitute for authentication |
| 22 | No Origin, valid token | Call a protected endpoint with no `Origin` header but a valid authorized bearer token (e.g. plain `curl`) | Reaches the endpoint normally, `200` — confirms server-to-server/tooling access still works without a browser |
| 23 | Unauthorized browser origin | Send a preflight `OPTIONS` request with a real `Origin` header not on the allow-list | `403`, no CORS headers at all — the browser aborts before the real request is ever sent |
| 24 | Existing Excel functionality | Browse/select a workbook via the Add Tools picker as the authorized owner | Real OneDrive file/table names returned; selection saves correctly |

### Safe WhatsApp rate-limit test procedure (for row 17)

The naive version of this test — call `send-whatsapp-alert` 11 times and
confirm the 11th is blocked — requires 10 real messages to actually reach
Meta first. This procedure verifies the same limit without ever letting
a test call reach Meta, and without adding any new endpoint parameter
(no `dryRun` flag exists or is added anywhere) — the seeding happens
purely at the database layer, the same way `pilot_authorized_emails` is
already seeded and recovered directly via the SQL editor.

**Precondition (one-time setup, not per release):** a dedicated test
identity exists — a real Supabase Auth user, created via Auth's own
invite/admin flow (never through an Edge Function), with its email
seeded into `pilot_authorized_emails` separately from the owner's own
row. Record its real `auth.users.id`.

1. Sign in as the test identity once (a real magic link) to obtain a
   real session `access_token`. Keep it handy for step 3.
2. Via the Supabase SQL editor (service-role context — the same access
   path already used to seed `pilot_authorized_emails`), seed **exactly
   10** rows — not 9: `claim_whatsapp_send_slot` counts pre-existing rows
   `>= max_count` *before* its own insert, so 10 pre-existing rows makes
   the next real call attempt **#11**, which is what actually gets
   blocked:

   ```sql
   insert into whatsapp_send_log (function_name, shipment_id, sent_by, sent_at)
   select 'send-whatsapp-alert', null, '<test identity's real uuid>', now() - (n || ' minutes')::interval
   from generate_series(1, 10) as n
   returning id;
   ```

   Save the returned `id`s for cleanup in step 4.
3. Make **one** real authenticated call to `send-whatsapp-alert` as the
   test identity. Expected: `HTTP 429` with the exact rate-limit message
   body, and confirm in the function's logs that no request to
   `graph.facebook.com` was made — this is guaranteed by the code itself
   (the claim check runs before any `whatsapp_config` read), not just by
   the test.
4. Clean up **only** the exact seeded rows from step 2's `RETURNING id`:

   ```sql
   delete from whatsapp_send_log where id in (<the ids returned in step 2>);
   ```

   Never delete by a broad time or user-scoped `WHERE` clause that could
   also match a genuine row — this test identity should never be used
   for anything else, but exact-id deletion is the safety net regardless.
5. Row 18 above (a real send as the **owner**, a different identity)
   confirms the send path itself still works — keeping that check
   separate from this synthetic rate-limit test is deliberate.

## D. Rollback plan

- **Edge Functions.** Each of the 17 redeployed functions can be rolled
  back independently to its prior deployed source
  (`supabase functions deploy <name> ...` from the pre-hardening commit
  — record that commit hash at release time, in Section E, not
  hardcoded here). **Rolling back re-opens the exact gaps
  `SECURITY_AND_PILOT_BLOCKERS.md` documents** — no authentication, no
  Meta signature check, no rate limit. This is a known-vulnerability
  reopening, not a neutral action, and should only be done if the
  redeploy itself broke something worse than the gap it closed.
- **Database.** All four migrations are additive; rolling back
  application code does **not** require rolling back the schema — old
  function code simply doesn't reference the new tables/columns/functions.
  If a schema rollback is ever genuinely needed, it must preserve
  `oauth_states` (in-flight OAuth attempts), `whatsapp_send_log`/
  `whatsapp_webhook_events` (audit trail, including each event's real
  processing status/attempt history from the idempotency fix), and must
  never truncate or restore over current data in `risk_snapshots`,
  `shipments`, or `recommendation_events` (real decision history and
  shipment data) — a schema rollback should `DROP` only the new objects,
  never restore a backup that overwrites current rows in the
  pre-existing tables.
- **Dashboard.** The frontend is already live and is not part of this
  release's rollback surface — if it ever needs to roll back
  independently, revert `index.html`/`ruta-dashboard-fixed.html` to the
  pre-hardening commit and push; this reopens the old shared-password
  gate, a separate known tradeoff, not a new one introduced by this
  release.
- **Owner-lockout recovery.** If the owner is ever locked out (e.g., step
  B.2 was skipped or the wrong email was seeded), recovery is a direct
  SQL `INSERT` into `pilot_authorized_emails` via the Supabase SQL editor
  — dashboard access there uses the service-role connection and never
  depends on the Edge Function auth layer. This is the designated escape
  hatch; document it, don't discover it under pressure.
- **Disabling outbound WhatsApp sends immediately.** The fastest safe
  stop, if ever needed, is revoking or rotating the value in
  `whatsapp_config.access_token` directly (a database update, no
  redeploy required) — every send function's call to Meta's API then
  fails immediately. This is faster than redeploying any function and
  doesn't require touching Edge Function code at all.

## E. Post-deployment verification record

Fill in after Section C passes. No secret value of any kind belongs in
this record — only names, paths, hashes, dates, and pass/fail outcomes.

```text
Deployment date:            ______________________
Release commit hash:        ______________________
Migrations applied:
  [ ] 20260922000000_security_hardening.sql
  [ ] 20260922010000_decision_integrity.sql
  [ ] 20260923000000_atomic_rate_limit.sql
  [ ] 20260924000000_webhook_idempotency.sql
Functions redeployed (17):
  [ ] decisions-list                        [ ] risk-location-settings
  [ ] erp-inventory                         [ ] risk-recommendation
  [ ] excel-browse                          [ ] send-whatsapp-alert
  [ ] excel-oauth-callback                  [ ] shipments-create
  [ ] excel-oauth-start                     [ ] shipments-list
  [ ] excel-select-workbook                 [ ] whatsapp-setup-tracking-template
  [ ] excel-status                          [ ] whatsapp-webhook
  [ ] recommendation-action                 [ ] whatsapp-webhook-subscription
  [ ] request-tracking-update
Deployed-only functions (not redeployed, action taken):
  [ ] excel-debug — deleted / left in place (circle one)
  [ ] storm-signal — left in place (no action expected)
Dashboard version/commit already live:  ______________________
Tester name/email:          ______________________
Test outcome (Section C, # 1–24):  ______ / 24 passed
Remaining exceptions or deferred items:
  ______________________________________________________
  ______________________________________________________
```
