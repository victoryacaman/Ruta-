// Run with: NODE_PATH=/opt/node22/lib/node_modules node tests/integration/dashboard_null_safety_test.js
// Real headless-browser test of the dashboard's null-safety rendering
// (Part A/B/D). Mocks risk-recommendation/decisions-list with exactly the
// shapes the updated scoring engine now produces -- a missing unitPrice,
// an unverified transfer candidate, and demo-included decision history --
// and asserts the dashboard shows "Not available"/"No disponible" and the
// candidate/demo disclosures instead of silently rendering L0 or hiding
// the caveat. Does not require a live deploy: this is entirely local
// (file://) with network calls intercepted via page.route(), same
// pattern as this project's existing test38-41 scripts.
const { chromium } = require('playwright');

const RISK_PAYLOAD_MISSING_PRICE = {
  ok: true, computedAt: new Date().toISOString(), locationName: 'Puerto Cortés',
  corridor: { severity: 'medium', reasons: ['1 day(s) of forecasted heavy rain'], flaggedWeatherDays: 1, relevantStorms: [], relevantRadiusKm: 2500, expectedDelayDays: 5, weatherError: null, stormError: null, weatherDays: [] },
  erpProvider: 'excel', erpError: null,
  environment: 'pilot', computationSource: 'test',
  recommendation: {
    applicable: true,
    atRiskSkus: [{
      sku: 'SKU-NOPRICE', name: 'No Price SKU', daysOfSafetyStock: 1.0, unitsShort: 20,
      salesExposureLps: null, exposureUnavailableReason: 'unitPrice is unavailable from the connected ERP -- sales exposure cannot be calculated for this SKU',
      transferUnits: 15, verifiedTransferUnits: 0, transferCostLps: 675,
      targetWarehouse: 'Tegucigalpa', fullyCovered: false, coveragePct: 40, candidateCoveragePct: 90,
      transferStatus: 'candidate_pending_source_verification',
      dataGaps: ['source-warehouse demand/reorder-point data is not available'],
    }],
    totalExposureLps: null, exposureIncomplete: true,
    totalTransferCostLps: 675, totalTransferUnits: 15, totalVerifiedTransferUnits: 0,
    anyUnverifiedTransfers: true,
    roiMultiple: null, roiUnavailableReason: 'Sales exposure is unknown for at least one at-risk SKU (missing unit price) -- a total ROI multiple would be misleading.',
    avgCoveragePct: 40,
    topWarehouse: { location: 'Tegucigalpa', units: 15 },
    transferCostAssumptionLpsPerUnit: 45,
  },
  snapshotId: 'test-snapshot-1', signalFingerprint: 'deadbeef',
};

const DECISIONS_PAYLOAD_DEMO_INCLUDED = {
  ok: true, fetchedAt: new Date().toISOString(), scope: 'all', demoDataIncluded: true,
  summary: {
    calculationsPerformed: 12, totalSnapshots: 5, applicableRecommendations: 3, recommendationsShown: 3,
    actedUpon: 1, approved: 1, dismissed: 0, noAction: 2, undoneEventCount: 0,
    decisionCoveragePct: 33.3, approvalRatePct: 100,
  },
  history: [
    { id: 's1', computedAt: new Date().toISOString(), severity: 'medium', erpProvider: 'demo', recommendationApplicable: true, totalExposureLps: null, totalTransferCostLps: 100, roiMultiple: null, skuCount: 1, environment: 'demo', computationSource: 'page_load', computationCount: 1, status: 'approved', decidedAt: new Date().toISOString() },
  ],
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  // SECURITY HARDENING (2026-09-23): the old sessionStorage.ruta_authed
  // bypass no longer exists -- the dashboard now bootstraps a real
  // Supabase Auth session via supabase-js. Stub the CDN module itself
  // (rather than fight supabase-js's own localStorage session format)
  // so the dashboard's bootstrap sees a fake, already-authorized session
  // with zero real network dependency, matching this project's own
  // "mock the client, not the wire format" testing convention.
  await page.route('**/@supabase/supabase-js*', (route) => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: "window.supabase = { createClient: function(){ return { auth: { " +
      "getSession: function(){ return Promise.resolve({ data: { session: { access_token: 'fake-test-token', user: { id: 'test-user-id', email: 'victoryacaman@gmail.com' } } }, error: null }); }, " +
      "onAuthStateChange: function(){ return { data: { subscription: { unsubscribe: function(){} } } }; }, " +
      "signOut: function(){ return Promise.resolve({ error: null }); } " +
      "} }; } };",
  }));
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISK_PAYLOAD_MISSING_PRICE) }));
  await page.route('**/decisions-list*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DECISIONS_PAYLOAD_DEMO_INCLUDED) }));
  await page.route('**/risk-location-settings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { location_name: 'Puerto Cortés', lat: 15.8, lon: -87.9, relevant_radius_km: 2500, currency_code: 'HNL', currency_symbol: 'L' } }) }));
  await page.route('**/excel-status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, connected: false, email: null }) }));
  await page.route('**/erp-inventory*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'excel', fetchedAt: new Date().toISOString(), items: [], rejectedCount: 0 }) }));

  await page.goto('file:///home/user/ruta-/ruta-dashboard-fixed.html');
  await page.waitForFunction(() => document.getElementById('riskSeverityBadge').textContent !== 'LOADING', { timeout: 10000 });

  const results = {};
  const checks = [];
  function check(name, condition) {
    checks.push({ name, pass: Boolean(condition) });
  }

  // Dashboard defaults to Spanish (LANG = localStorage.getItem('utopia_lang') || 'es') --
  // verify that FIRST, since it's what a real load actually shows.
  results.exposureValue_ES_default = await page.evaluate(() => document.getElementById('metricExposureValue').textContent);
  results.exposureNote_ES_default = await page.evaluate(() => document.getElementById('metricExposureNote').textContent);
  let whyDetailHtml = await page.evaluate(() => document.getElementById('whyDetail').innerHTML);
  let recStrongHtml = await page.evaluate(() => document.getElementById('recommendationStrong').innerHTML);
  results.roiText_ES_default = await page.evaluate(() => document.getElementById('roiBadge').textContent);

  check('ES default: exposure metric shows "No disponible", never L0', results.exposureValue_ES_default === 'No disponible');
  check('ES default: exposure note discloses partial data', results.exposureNote_ES_default.includes('parcial'));
  check('ES default: why-list shows unavailable exposure with reason, not L0', whyDetailHtml.includes('No disponible (precio unitario desconocido)'));
  check('ES default: ROI badge shows N/D, not a computed number', results.roiText_ES_default.startsWith('N/D'));
  check('ES default: transfer shown as candidate pending verification', recStrongHtml.includes('CANDIDATO') && recStrongHtml.includes('PENDIENTE'));
  check('ES default: why-list explains the missing source-warehouse data', whyDetailHtml.toLowerCase().includes('almacén de origen'));

  // Toggle to English -- the SAME underlying data must render correctly
  // in the other language too, not just happen to work in the default one.
  await page.click('#langToggleBtn');
  await page.waitForTimeout(200);
  results.exposureValue_EN = await page.evaluate(() => document.getElementById('metricExposureValue').textContent);
  whyDetailHtml = await page.evaluate(() => document.getElementById('whyDetail').innerHTML);
  recStrongHtml = await page.evaluate(() => document.getElementById('recommendationStrong').innerHTML);

  check('EN toggle: exposure metric shows "Not available", never L0', results.exposureValue_EN === 'Not available');
  check('EN toggle: why-list shows unavailable exposure with reason, not L0', whyDetailHtml.includes('Not available (unit price unknown)'));
  check('EN toggle: transfer shown as candidate pending verification', recStrongHtml.includes('CANDIDATE') && recStrongHtml.includes('PENDING VERIFICATION'));
  check('EN toggle: why-list explains the missing source-warehouse data', whyDetailHtml.toLowerCase().includes('source warehouse'));

  // --- Part C/D: Decisions view discloses demo data and shows decision coverage ---
  await page.click('.nav-item[data-view="decisions"]');
  await page.waitForTimeout(400);
  results.decisionsCoverageText = await page.evaluate(() => { const el = document.getElementById('decSummaryCoverage'); return el ? el.textContent : null; });
  results.demoBannerVisible = await page.evaluate(() => { const el = document.getElementById('decisionsScopeBanner'); return el && !el.hasAttribute('hidden'); });
  check('Decision coverage metric renders from the server value', results.decisionsCoverageText === '33.3%');
  check('Demo-data-included banner is shown when scope includes non-pilot rows', results.demoBannerVisible === true);

  const failed = checks.filter((c) => !c.pass);
  console.log(JSON.stringify(results, null, 2));
  console.log('');
  checks.forEach((c) => console.log((c.pass ? 'PASS' : 'FAIL') + ' - ' + c.name));
  console.log('');
  console.log(checks.length - failed.length + '/' + checks.length + ' checks passed');
  console.log('PAGE ERRORS:', JSON.stringify(errors));
  await browser.close();
  if (failed.length || errors.length) process.exit(1);
})();
