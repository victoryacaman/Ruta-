// Run with: NODE_PATH=/opt/node22/lib/node_modules node tests/integration/dashboard_auth_test.js
// Real headless-browser test of the SECURITY HARDENING (2026-09-23)
// dashboard auth wiring: real Supabase Auth session bootstrap,
// authedFetch's 401/403 handling, and the sign-in page's own session
// check. Mocks the supabase-js CDN module and the auth REST endpoint
// (never a live deploy) with exactly the shapes the real client
// produces -- no session, an authorized session, and the two auth
// failure responses a protected Edge Function returns.
const { chromium } = require('playwright');

function fakeSupabaseModule(sessionOrNull) {
  const sessionJson = sessionOrNull === null ? 'null' : JSON.stringify(sessionOrNull);
  // Stateful via localStorage (seeded once, same as a real Supabase
  // session persisted client-side) rather than a plain JS global: a
  // plain global resets on every full-page navigation, so signOut()
  // clearing it wouldn't survive the redirect to index.html -- that page
  // would run its OWN getSession() check, see the still-"valid" static
  // session, and bounce straight back into a redirect loop. localStorage
  // survives navigation within the same origin, matching how a real
  // signOut() actually behaves.
  return "if(localStorage.getItem('__mockSeeded') !== '1'){ localStorage.setItem('__mockSession', JSON.stringify(" + sessionJson + ")); localStorage.setItem('__mockSeeded', '1'); } " +
    "window.supabase = { createClient: function(){ return { auth: { " +
    "getSession: function(){ var s = JSON.parse(localStorage.getItem('__mockSession') || 'null'); return Promise.resolve({ data: { session: s }, error: null }); }, " +
    "onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; }, " +
    "signOut: function(){ localStorage.setItem('__mockSession', 'null'); return Promise.resolve({ error: null }); } " +
    "} }; } };";
}

const AUTHORIZED_SESSION = { access_token: 'fake-test-token', user: { id: 'test-user-id', email: 'victoryacaman@gmail.com' } };

const RISK_PAYLOAD_MINIMAL = {
  ok: true, computedAt: new Date().toISOString(), locationName: 'Puerto Cortés',
  corridor: { severity: 'low', reasons: [], flaggedWeatherDays: 0, relevantStorms: [], relevantRadiusKm: 2500, expectedDelayDays: 0, weatherError: null, stormError: null, weatherDays: [] },
  erpProvider: 'excel', erpError: null, environment: 'pilot', computationSource: 'test',
  recommendation: { applicable: false, atRiskSkus: [], totalExposureLps: null, exposureIncomplete: false, totalTransferCostLps: 0, totalTransferUnits: 0, totalVerifiedTransferUnits: 0, anyUnverifiedTransfers: false, roiMultiple: null, roiUnavailableReason: null, avgCoveragePct: null, topWarehouse: null, transferCostAssumptionLpsPerUnit: 45 },
  snapshotId: 'test-snapshot-auth', signalFingerprint: 'auth-test',
};

function routeCommonEndpoints(page) {
  return Promise.all([
    page.route('**/risk-location-settings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { location_name: 'Puerto Cortés', lat: 15.8, lon: -87.9, relevant_radius_km: 2500, currency_code: 'HNL', currency_symbol: 'L' } }) })),
    page.route('**/excel-status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, connected: false, email: null }) })),
    page.route('**/erp-inventory*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'excel', fetchedAt: new Date().toISOString(), items: [], rejectedCount: 0 }) })),
  ]);
}

// Both pages cross-link via ABSOLUTE production URLs by design (see the
// comments in both files -- a relative path resolves to whatever happens
// to share this file's folder, a real bug found before presenting). That
// means a real redirect from one page to the other would otherwise hit
// whatever is CURRENTLY LIVE on GitHub Pages, not this local, possibly
// unpushed copy -- so the round trip is tested by serving these two
// local files for their own production URLs too, entirely offline.
function routeProductionUrlsToLocalFiles(page) {
  return Promise.all([
    page.route('https://victoryacaman.github.io/Ruta-/index.html', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', path: '/home/user/ruta-/index.html' })),
    page.route('https://victoryacaman.github.io/Ruta-/ruta-dashboard-fixed.html', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', path: '/home/user/ruta-/ruta-dashboard-fixed.html' })),
  ]);
}

(async () => {
  // --ignore-certificate-errors: this sandbox's outbound proxy intercepts
  // TLS for real navigations (scenarios that redirect to the actual
  // hosted https://victoryacaman.github.io/... sign-in/dashboard pages),
  // which Chromium otherwise rejects as ERR_CERT_AUTHORITY_INVALID. Not
  // needed in a real browser on the real internet.
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });
  const checks = [];
  function check(name, condition) { checks.push({ name, pass: Boolean(condition) }); }
  const allErrors = [];

  // --- 1. No session at all: dashboard bootstraps auth, finds nothing, redirects to sign-in ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario1 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(null) }));
    await routeCommonEndpoints(page);
    await routeProductionUrlsToLocalFiles(page);
    await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISK_PAYLOAD_MINIMAL) }));
    await page.goto('file:///home/user/ruta-/ruta-dashboard-fixed.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/index\.html/, { timeout: 15000 }).catch(() => {});
    check('no session -> dashboard redirects to the sign-in page', page.url().indexOf('index.html') !== -1);
    await page.close();
  }

  // --- 2. Authorized session: dashboard content becomes visible, no redirect ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario2 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(AUTHORIZED_SESSION) }));
    await routeCommonEndpoints(page);
    await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISK_PAYLOAD_MINIMAL) }));
    await page.goto('file:///home/user/ruta-/ruta-dashboard-fixed.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.style.visibility === 'visible', { timeout: 10000 }).catch(() => {});
    check('authorized session -> dashboard stays on ruta-dashboard-fixed.html (no redirect)', page.url().indexOf('ruta-dashboard-fixed.html') !== -1);
    check('authorized session -> document becomes visible', await page.evaluate(() => document.documentElement.style.visibility === 'visible'));
    const profileEmail = await page.evaluate(() => document.getElementById('profileEmail') && document.getElementById('profileEmail').textContent);
    check('authorized session -> profile panel shows the real signed-in email', profileEmail === 'victoryacaman@gmail.com');
    await page.close();
  }

  // --- 3. A protected call returns 403 (real session, not on the allowlist) -> not-authorized banner ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario3 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(AUTHORIZED_SESSION) }));
    await routeCommonEndpoints(page);
    await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Your account is not authorized for this Utopia deployment' }) }));
    await page.goto('file:///home/user/ruta-/ruta-dashboard-fixed.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#utopiaNotAuthorizedBanner', { timeout: 10000 }).catch(() => {});
    check('403 from a protected endpoint -> not-authorized banner is shown', await page.locator('#utopiaNotAuthorizedBanner').count() > 0);
    await page.close();
  }

  // --- 4. A protected call returns 401 (session invalid/expired) -> signed out and redirected to sign-in ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario4 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(AUTHORIZED_SESSION) }));
    await routeCommonEndpoints(page);
    await routeProductionUrlsToLocalFiles(page);
    await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Invalid or expired session' }) }));
    // Enters at the production dashboard URL (routed to this local file)
    // rather than file://, so the redirect to index.html below stays on
    // one consistent origin and the localStorage-backed mock session
    // signOut() clears is actually visible to index.html's own check --
    // exactly like the real app, where both pages share one origin.
    await page.goto('https://victoryacaman.github.io/Ruta-/ruta-dashboard-fixed.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/index\.html/, { timeout: 15000 }).catch(() => {});
    check('401 from a protected endpoint -> redirects to the sign-in page', page.url().indexOf('index.html') !== -1);
    await page.waitForTimeout(1000);
    check('401 from a protected endpoint -> signOut() actually cleared the session (no bounce back to the dashboard)', page.url().indexOf('index.html') !== -1);
    await page.close();
  }

  // --- 5. Sign-in page (index.html): no session -> shows the email form, doesn't redirect ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario5 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(null) }));
    await page.goto('file:///home/user/ruta-/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    check('sign-in page with no session -> stays on index.html', page.url().indexOf('index.html') !== -1);
    check('sign-in page with no session -> email input is visible', await page.locator('#email').isVisible().catch(() => false));
    await page.close();
  }

  // --- 6. Sign-in page: already has a session -> redirects straight to the dashboard ---
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => allErrors.push('scenario6 pageerror: ' + e.message));
    await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSupabaseModule(AUTHORIZED_SESSION) }));
    await routeCommonEndpoints(page);
    await routeProductionUrlsToLocalFiles(page);
    await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISK_PAYLOAD_MINIMAL) }));
    await page.goto('file:///home/user/ruta-/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/ruta-dashboard-fixed\.html/, { timeout: 15000 }).catch(() => {});
    check('sign-in page with an existing session -> redirects to the dashboard', page.url().indexOf('ruta-dashboard-fixed.html') !== -1);
    await page.close();
  }

  const failed = checks.filter((c) => !c.pass);
  checks.forEach((c) => console.log((c.pass ? 'PASS' : 'FAIL') + ' - ' + c.name));
  console.log('');
  console.log(checks.length - failed.length + '/' + checks.length + ' checks passed');
  console.log('PAGE ERRORS:', JSON.stringify(allErrors));
  await browser.close();
  if (failed.length || allErrors.length) process.exit(1);
})();
