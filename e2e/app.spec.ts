import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
}

test('renders evidence-first analysis and passes a serious accessibility audit', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  // 12% of the 1–3 km annulus lies across the Hudson in New Jersey and is left out of the density.
  await expect(page.getByTestId('activity-band')).toContainText('3.81× nearby weighted report density');
  await expect(page.getByTestId('area-coverage-notice')).toContainText(
    '12% of the nearby area lies outside New York City limits',
  );
  await expect(page.getByTestId('activity-band')).toContainText('1 km circle · 1 to 3 km nearby · 30 days');
  await expect(page.getByText('NYPD Complaint Data Current (YTD)')).toBeVisible();
  await expect(page.getByText('Confidence: medium')).toBeVisible();
  await expect(page.locator('.provider-strip')).toHaveRole('button');
  await expect(page.locator('.method-button')).toHaveCount(0);
  const evidenceHeadings = await page.locator('.evidence-section h3').allTextContents();
  expect(evidenceHeadings.indexOf('Most recent selected-area reports')).toBeLessThan(
    evidenceHeadings.indexOf('Recent rhythm'),
  );
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .exclude('.maplibregl-control-container')
    .exclude('.maplibregl-canvas')
    .analyze();
  const seriousViolations = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(seriousViolations).toEqual([]);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
});

test('updates provider, filters, radius, URL state, and methodology dialog', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'The Loop' }).click();
  await expect(page.getByText('Chicago Police Department').first()).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('4');

  if (
    testInfo.project.name.startsWith('mobile')
    || testInfo.project.name.startsWith('tablet-compact')
  ) {
    const settingsToggle = page.getByRole('button', { name: 'Analysis settings' });
    await settingsToggle.click();
    await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
  }

  await page.getByRole('button', { name: 'Property' }).click();
  await expect(page).toHaveURL(/groups=violent%2Cvehicle%2Cweapons%2Cother/);
  await expect(page.getByTestId('reported-count')).toHaveText('3');

  await page.getByRole('button', { name: '500 m' }).click();
  await expect(page).toHaveURL(/radius=500/);

  if (testInfo.project.name.startsWith('desktop')) {
    await page.getByRole('button', { name: 'Sources & methodology' }).click();
    await expect(page.getByRole('dialog', { name: 'Sources & methodology' })).toBeVisible();
    await expect(page.getByText('Transparent local comparison')).toBeVisible();
    await expect(page.getByText('Los Angeles, California')).toBeVisible();
    await expect(page.getByText('Seattle, Washington')).toBeVisible();
    await page.getByRole('button', { name: 'Close sources and methodology' }).click();
  }

  await expectNoHorizontalOverflow(page);
});

test('loads an ArcGIS-backed official city feed', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'National Mall' }).click();
  await expect(
    page.getByText('Metropolitan Police Department of the District of Columbia').first(),
  ).toBeVisible();
  await expect(page.getByText('Crime Incidents - 2026')).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await expect(page).toHaveURL(/lat=38\.8895/);
  await expectNoHorizontalOverflow(page);
});

test('mobile layout keeps the map and evidence in a readable document flow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only interaction');
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  // The lazy map replaces its loading placeholder; measure the real stage, not the swap.
  await expect(page.locator('.map-stage[data-map-ready]')).toBeVisible();

  const mapBox = await page.locator('.map-stage').boundingBox();
  const evidenceBox = await page.getByTestId('evidence-panel').boundingBox();
  expect(mapBox).not.toBeNull();
  expect(evidenceBox).not.toBeNull();
  expect(evidenceBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height);
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-expanded.png`,
    fullPage: true,
  });
});

test('keeps the mobile document within the viewport under wide system fonts', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only layout');
  // CI runners fall back to wider sans-serif fonts than most desktops; force one so
  // single-line summaries that cannot shrink show up locally too.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '* { font-family: "DejaVu Sans", Verdana, sans-serif !important; }';
      document.head.append(style);
    });
  });
  await mockOfficialSources(page, { nycLagDays: 100 });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'The Loop' }).click();
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await page.getByRole('button', { name: 'Analysis settings' }).click();
  await page.getByRole('button', { name: '500 m' }).click();
  await expect(page).toHaveURL(/radius=500/);
  await expectNoHorizontalOverflow(page);
});

test('anchors the window to a delayed publisher instead of showing empty recent days', async ({ page }) => {
  await mockOfficialSources(page, { nycLagDays: 100 });
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByTestId('delayed-feed-notice')).toContainText('Feed is 100 days behind.');
  await expect(page.getByTestId('delayed-feed-notice')).toContainText('Published quarterly');
  await expect(page.getByTestId('evidence-window')).toBeVisible();
  await expect(page.getByTestId('activity-band')).toContainText('3.81× nearby weighted report density');
});

test('says when a feed has no recent records instead of reporting zero incidents', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'Union Square' }).click();
  await expect(page.getByTestId('no-records-state')).toContainText('No records were published in the last 400 days.');
  await expect(page.getByTestId('reported-count')).toHaveCount(0);
  await expect(page.getByTestId('activity-band')).toHaveCount(0);
});

test('marks counts as lower bounds and withholds the trend when a query hits its record limit', async ({ page }) => {
  await mockOfficialSources(page, { nycReportedTotal: 25_000 });
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5+');
  await expect(page.getByText('No trend: a window reached the record limit')).toBeVisible();
  await expect(page.getByTestId('truncation-warning')).toContainText('20,000-record limit');
  await expect(page.getByTestId('activity-band')).toContainText('Nearby comparison unavailable');
});

test('resolves an adaptive Socrata schema from live metadata under StrictMode', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'Downtown Dallas' }).click();
  await expect(page.getByText('Dallas Police Department').first()).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('3');
  await expect(page.getByTestId('evidence-window')).toContainText('Newest 2 days excluded');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('labels shared coordinates without a place name as a dropped pin', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1&lat=41.8837&lng=-87.6298');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dropped pin');
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await expect(page).toHaveURL(/e2e=1/);
});

test('gives a neighboring city inside a feed\'s bounding box its own agency totals', async ({ page }) => {
  await mockOfficialSources(page);
  // Jersey City sits inside the NYC rectangle but outside New York City limits.
  await page.goto('/?e2e=1&lat=40.7282&lng=-74.0776&place=Jersey+City&detail=New+Jersey');
  await expect(page.getByTestId('jurisdiction-band')).toContainText('Jersey City Police Department');
  await expect(page.getByTestId('precision-notice')).toBeVisible();
  await expect(page.locator('.brand-status')).toContainText('FBI jurisdiction totals');
  await expect(page.getByTestId('reported-count')).toHaveCount(0);
});

test('summarizes the agency that polices an unincorporated area', async ({ page }) => {
  await mockOfficialSources(page);
  // East Los Angeles is unincorporated Los Angeles County, policed by the Sheriff.
  await page.goto('/?e2e=1&lat=34.0239&lng=-118.1728&place=East+Los+Angeles&detail=California');
  await expect(page.getByTestId('jurisdiction-band')).toContainText("Los Angeles County Sheriff's Office");
  await expect(page.getByTestId('jurisdiction-band')).toContainText('Los Angeles County');
});

test('marks a point outside the states as map-only', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1&lat=43.6532&lng=-79.3832&place=Toronto');
  await expect(page.getByTestId('outside-coverage')).toBeVisible();
  await expect(page.locator('.brand-status')).toContainText('Map only');
});

test('shows an actionable failure state when an official portal is unavailable', async ({ page }) => {
  await mockOfficialSources(page, 'error');
  await page.goto('/?e2e=1');
  await expect(page.getByRole('alert')).toContainText('Official data could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
