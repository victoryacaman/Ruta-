// Run with: NODE_PATH=/opt/node22/lib/node_modules node tests/integration/dashboard_regression_test.js
// Confirms the EXISTING verified/happy-path behavior still renders
// correctly after Part A/B/C/D's changes -- a real price, a fully
// source-verified transfer, and a real ROI number should render exactly
// as they did before (no "Not available", no candidate tag), so the new
// null-safety code path doesn't accidentally fire for normal data.
const { chromium } = require('playwright');

const RISK_PAYLOAD_NORMAL = {
  ok: true, computedAt: new Date().toISOString(), locationName: 'Puerto Cortés',
  corridor: { severity: 'high', reasons: ['1 active tropical system(s) within 2,500km of Puerto Cortés'], flaggedWeatherDays: 0, relevantStorms: [{ name: 'Storm X', classification: 'HU', distanceKm: 300 }], relevantRadiusKm: 2500, expectedDelayDays: 10, weatherError: null, stormError: null, weatherDays: [] },
  erpProvider: 'excel', erpError: null,
  environment: 'pilot', computationSource: 'test',
  recommendation: {
    applicable: true,
    atRiskSkus: [{
      sku: 'AUT-4410', name: '12V Car Battery 650CCA', daysOfSafetyStock: 4.4, unitsShort: 50,
      salesExposureLps: 72500, exposureUnavailableReason: null,
      transferUnits: 50, verifiedTransferUnits: 50, transferCostLps: 2250,
      targetWarehouse: 'Tegucigalpa', fullyCovered: true, coveragePct: 100, candidateCoveragePct: 100,
      transferStatus: 'verified',
      dataGaps: [],
    }],
    totalExposureLps: 72500, exposureIncomplete: false,
    totalTransferCostLps: 2250, totalTransferUnits: 50, totalVerifiedTransferUnits: 50,
    anyUnverifiedTransfers: false,
    roiMultiple: 32.2, roiUnavailableReason: null,
    avgCoveragePct: 100,
    topWarehouse: { location: 'Tegucigalpa', units: 50 },
    transferCostAssumptionLpsPerUnit: 45,
  },
  snapshotId: 'test-snapshot-2', signalFingerprint: 'cafef00d',
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.addInitScript(() => sessionStorage.setItem('ruta_authed', '1'));
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.route('**/risk-recommendation*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RISK_PAYLOAD_NORMAL) }));
  await page.route('**/risk-location-settings', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, config: { location_name: 'Puerto Cortés', lat: 15.8, lon: -87.9, relevant_radius_km: 2500, currency_code: 'HNL', currency_symbol: 'L' } }) }));
  await page.route('**/excel-status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, connected: false, email: null }) }));
  await page.route('**/erp-inventory*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'excel', fetchedAt: new Date().toISOString(), items: [], rejectedCount: 0 }) }));

  await page.goto('file:///home/user/ruta-/ruta-dashboard-fixed.html');
  await page.waitForFunction(() => document.getElementById('riskSeverityBadge').textContent !== 'LOADING', { timeout: 10000 });

  const checks = [];
  function check(name, condition) { checks.push({ name, pass: Boolean(condition) }); }

  const exposureValue = await page.evaluate(() => document.getElementById('metricExposureValue').textContent);
  check('known exposure renders as a real formatted amount, not "unavailable"', exposureValue === 'L 72,500');

  const roiText = await page.evaluate(() => document.getElementById('roiBadge').textContent);
  check('known ROI renders the real multiple', roiText.includes('32.2x'));

  const recStrongHtml = await page.evaluate(() => document.getElementById('recommendationStrong').innerHTML);
  check('fully verified transfer shows NO candidate/pending tag', !recStrongHtml.includes('CANDIDAT') && !recStrongHtml.includes('PENDIENTE'));
  check('fully verified transfer still shows the transfer amount and location', recStrongHtml.includes('50') && recStrongHtml.includes('Tegucigalpa'));

  const costLine = await page.evaluate(() => document.getElementById('recommendationCostLine').textContent);
  check('cost line renders the real transfer cost', costLine.includes('L 2,250'));

  const whyDetailHtml = await page.evaluate(() => document.getElementById('whyDetail').innerHTML);
  check('why-list shows the real exposure figure for a known price, not "unavailable"', whyDetailHtml.includes('L 72,500') && !whyDetailHtml.includes('Not available'));
  check('why-list has no source-warehouse caveat when the transfer is fully verified', !whyDetailHtml.toLowerCase().includes('source warehouse'));

  const failed = checks.filter((c) => !c.pass);
  checks.forEach((c) => console.log((c.pass ? 'PASS' : 'FAIL') + ' - ' + c.name));
  console.log('');
  console.log(checks.length - failed.length + '/' + checks.length + ' checks passed');
  console.log('PAGE ERRORS:', JSON.stringify(errors));
  await browser.close();
  if (failed.length || errors.length) process.exit(1);
})();
