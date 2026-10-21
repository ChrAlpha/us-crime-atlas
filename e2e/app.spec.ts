import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';
import {
  expectNoHorizontalOverflow,
  goToCoveredPlace,
  isMobile,
  openDataNotes,
  openFilter,
  openTab,
  raisePanel,
} from './helpers';

test('answers first in plain words and passes a serious accessibility audit', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  // 12% of the 1–3 km ring lies across the Hudson in New Jersey and is left out of the rate.
  await expect(page.getByTestId('finding')).toContainText('3.8× as many reports per km² as the surrounding area');
  await expect(page.getByTestId('evidence-window')).toContainText('1 km circle vs. the 1–3 km ring');
  await openDataNotes(page);
  await expect(page.getByTestId('note-area-coverage')).toContainText(
    '12% of the surrounding area lies outside New York City limits',
  );
  await expect(page.locator('.place__source')).toContainText('New York City police records');
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .exclude('.maplibregl-control-container')
    .exclude('.maplibregl-canvas')
    .analyze();
  const seriousViolations = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(seriousViolations).toEqual([]);

  await openTab(page, testInfo, 'About the data');
  await expect(page.getByRole('link', { name: /NYPD Complaint Data Current \(YTD\)/ })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-overview.png` });
});

test('updates place, report types, radius, and URL state', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await goToCoveredPlace(page, 'The Loop');
  await expect(page.locator('.place__source')).toContainText('Chicago police records');
  await expect(page.getByTestId('reported-count')).toHaveText('4');

  await openFilter(page, /^All types/);
  await page.locator('.filter__popover').getByRole('button', { name: /^Property/ }).click();
  await expect(page).toHaveURL(/groups=violent%2Cvehicle%2Cweapons%2Cother/);
  await expect(page.getByTestId('reported-count')).toHaveText('3');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Analysis settings' }).getByRole('button', { name: /^4 of 5 types/ }))
    .toHaveAttribute('aria-expanded', 'false');

  await openFilter(page, /^Within 1 km/);
  await page.locator('.filter__popover').getByRole('button', { name: /^500 m/ }).click();
  await expect(page).toHaveURL(/radius=500/);
  await expect(page.getByRole('group', { name: 'Analysis settings' }).getByRole('button', { name: /^Within 500 m/ }))
    .toBeVisible();

  await openFilter(page, /^Last 30 days/);
  await page.locator('.filter__popover').getByRole('button', { name: /^90 days/ }).click();
  await expect(page).toHaveURL(/days=90/);

  await openTab(page, testInfo, 'About the data');
  await expect(page.getByRole('heading', { name: 'How the comparison works' })).toBeVisible();
  await expect(page.getByText('Los Angeles, California')).toBeVisible();
  await expect(page.getByText('Seattle, Washington')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('loads an ArcGIS-backed official city feed', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await goToCoveredPlace(page, 'National Mall');
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await expect(page).toHaveURL(/lat=38\.8895/);
  await openTab(page, testInfo, 'About the data');
  await expect(page.getByText('Metropolitan Police Department of the District of Columbia').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Crime Incidents - 2026/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('opens a report from the list in place and shows it on the map', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await openTab(page, testInfo, 'Reports');
  const first = page.locator('.report').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.report__details')).toContainText('Location is approximate.');
  await first.click();
  await expect(page.locator('.report__details')).toHaveCount(0);
});

test('phones get a full-screen map with a three-position evidence sheet', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), 'Phone layout');
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.locator('.map-stage[data-map-ready]')).toBeVisible();

  const viewport = page.viewportSize()!;
  const mapBox = await page.locator('.map-stage').boundingBox();
  expect(mapBox!.height).toBe(viewport.height);

  const handle = page.locator('.sheet__handle');
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  const peek = await handle.boundingBox();
  // The answer is visible without touching the sheet, and most of the screen is map.
  await expect(page.locator('.finding__headline')).toBeInViewport();
  expect(peek!.y).toBeGreaterThan(viewport.height * 0.5);

  await handle.click();
  await expect(handle).toHaveAttribute('aria-label', 'Expand the evidence panel');
  await handle.click();
  await expect(handle).toHaveAttribute('aria-label', 'Collapse the evidence panel');
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeInViewport();
  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await expectNoHorizontalOverflow(page);
});

test('keeps phones within the viewport under wide system fonts', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), 'Phone layout');
  // CI runners fall back to wider sans-serif fonts than most desktops; force one so
  // single-line labels that cannot shrink show up locally too.
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

  await goToCoveredPlace(page, 'The Loop');
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await openFilter(page, /^Within 1 km/);
  await page.locator('.filter__popover').getByRole('button', { name: /^500 m/ }).click();
  await expect(page).toHaveURL(/radius=500/);
  await raisePanel(page, testInfo);
  await expectNoHorizontalOverflow(page);
});

test('anchors the window to a delayed publisher instead of showing empty recent days', async ({ page }) => {
  await mockOfficialSources(page, { nycLagDays: 100 });
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByTestId('delayed-feed-tag')).toHaveText('100 days behind');
  await openDataNotes(page);
  await expect(page.getByTestId('note-delayed')).toContainText('Feed is 100 days behind.');
  await expect(page.getByTestId('note-delayed')).toContainText('Published quarterly');
  await expect(page.getByTestId('finding')).toContainText('3.8× as many reports per km²');
});

test('says when a feed has no recent records instead of reporting zero incidents', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await goToCoveredPlace(page, 'Union Square');
  await expect(page.getByTestId('no-records-state')).toContainText('No records were published in the last 400 days.');
  await expect(page.getByTestId('reported-count')).toHaveCount(0);
  await expect(page.getByTestId('finding')).toHaveCount(0);
});

test('marks counts as minimums and withholds the comparison when a query hits its record limit', async ({ page }) => {
  await mockOfficialSources(page, { nycReportedTotal: 25_000 });
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5+');
  await expect(page.getByTestId('trend')).toHaveText('No trend: a request hit its record limit');
  await expect(page.getByTestId('note-truncation')).toContainText('20,000-record limit');
  await expect(page.getByTestId('finding')).toContainText('No fair comparison with the surrounding area');
});

test('resolves an adaptive Socrata schema from live metadata under StrictMode', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await goToCoveredPlace(page, 'Downtown Dallas');
  await expect(page.locator('.place__source')).toContainText('Dallas police records');
  await expect(page.getByTestId('reported-count')).toHaveText('3');
  await openDataNotes(page);
  await expect(page.getByTestId('note-settling')).toContainText('Newest 2 days left out');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('labels shared coordinates without a place name as a dropped pin', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1&lat=41.8837&lng=-87.6298');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dropped pin');
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await expect(page).toHaveURL(/e2e=1/);
});

test('treats a neighboring city inside a feed\'s bounding box as uncovered', async ({ page }) => {
  await mockOfficialSources(page);
  // Jersey City sits inside the NYC rectangle but outside New York City limits.
  await page.goto('/?e2e=1&lat=40.7282&lng=-74.0776&place=Jersey+City&detail=New+Jersey');
  await expect(page.getByTestId('no-feed-state')).toContainText('No official incident feed here yet');
  await expect(page.getByTestId('reported-count')).toHaveCount(0);
});

test('shows an actionable failure state when an official portal is unavailable', async ({ page }) => {
  await mockOfficialSources(page, 'error');
  await page.goto('/?e2e=1');
  await expect(page.getByRole('alert')).toContainText("Couldn't load New York City police records");
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('.place__source')).toContainText('unavailable');
});

test('focuses place search with the slash key', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'Keyboard shortcut');
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.locator('#place-query')).toBeFocused();
  await expect(page.getByRole('region', { name: 'Search suggestions' })).toBeVisible();
});
