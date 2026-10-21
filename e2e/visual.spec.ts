import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';
import {
  expectMapReady,
  expectMinimumTargetHeight,
  isMobile,
  openFilter,
  openTab,
  raisePanel,
} from './helpers';

test('captures primary visual states at each product viewport', async ({ page }, testInfo) => {
  const name = testInfo.project.name;
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expectMapReady(page);
  await page.screenshot({ path: `test-results/${name}-viewport-light.png` });

  const panel = await page.getByTestId('evidence-panel').boundingBox();
  const map = await page.locator('.map-stage').boundingBox();
  expect(panel).not.toBeNull();
  expect(map).not.toBeNull();
  if (isMobile(testInfo)) {
    // The map fills the screen; the sheet rests over its lower part.
    expect(map!.width).toBe(page.viewportSize()!.width);
    await expectMinimumTargetHeight(page.locator('.search__submit, .filter__chip, .locate-button'));
    await expectMinimumTargetHeight(page.locator('.sheet__handle'), 24);
  } else {
    // A docked panel beside a map that keeps most of the width.
    expect(map!.x).toBeGreaterThanOrEqual(panel!.x + panel!.width - 1);
    expect(map!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.6);
    await expect(page.getByRole('group', { name: 'Map key' })).toBeVisible();
  }

  await openFilter(page, /^All types/);
  if (isMobile(testInfo)) await expectMinimumTargetHeight(page.locator('.filter__option'));
  await page.screenshot({ path: `test-results/${name}-viewport-filters.png` });
  await page.keyboard.press('Escape');

  await page.locator('#place-query').click();
  await expect(page.getByRole('region', { name: 'Search suggestions' })).toBeVisible();
  await page.screenshot({ path: `test-results/${name}-viewport-search.png` });
  await page.keyboard.press('Escape');

  await openTab(page, testInfo, 'Overview');
  await page.screenshot({ path: `test-results/${name}-viewport-overview.png` });

  await openTab(page, testInfo, 'About the data');
  if (isMobile(testInfo)) {
    await expectMinimumTargetHeight(page.locator('.covered .button, .segmented button'));
  }
  await page.screenshot({ path: `test-results/${name}-viewport-about.png` });

  await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectMapReady(page, 'dark');
  await openTab(page, testInfo, 'Overview');
  await page.screenshot({ path: `test-results/${name}-viewport-dark.png` });
});

test('captures source failure and unsupported-place states', async ({ page }, testInfo) => {
  const name = testInfo.project.name;
  await mockOfficialSources(page, 'error');
  await page.goto('/?e2e=1');
  await expect(page.getByRole('alert')).toContainText("Couldn't load New York City police records");
  await expectMapReady(page);
  // On phones the retry action is reachable without raising the sheet.
  await expect(page.getByRole('button', { name: 'Try again' })).toBeInViewport();
  await page.screenshot({ path: `test-results/${name}-viewport-error.png` });

  await page.goto('/?e2e=1&lat=35.4676&lng=-97.5164&place=Oklahoma+City&detail=Oklahoma');
  await expect(page.locator('.place__source')).toContainText('Oklahoma City Police Department');
  await expect(page.getByTestId('jurisdiction-finding')).toBeVisible();
  await expectMapReady(page);
  await expect(page.getByRole('group', { name: 'Map key' })).toHaveCount(0);
  // On phones the answer is readable without raising the sheet.
  await expect(page.locator('.finding__headline')).toBeInViewport();
  await page.screenshot({ path: `test-results/${name}-viewport-jurisdiction.png` });
  await raisePanel(page, testInfo);
  await expect(page.getByRole('heading', { name: 'Month by month' })).toBeAttached();
  await page.screenshot({ path: `test-results/${name}-viewport-jurisdiction-detail.png` });

  await page.goto('/?e2e=1&lat=43.6532&lng=-79.3832&place=Toronto&detail=Ontario');
  await expect(page.getByTestId('outside-coverage')).toBeVisible();
  await expect(page.locator('.place__source')).toContainText('Map only');
  await expectMapReady(page);
  await page.screenshot({ path: `test-results/${name}-viewport-outside.png` });
  await raisePanel(page, testInfo);
  // Without any data here, the list of covered cities is unfolded.
  await expect(page.getByRole('button', { name: 'Go to Times Square' })).toBeVisible();
  await page.screenshot({ path: `test-results/${name}-viewport-outside-detail.png` });
});

test('captures an expanded report', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expectMapReady(page);
  await openTab(page, testInfo, 'Reports');
  await page.locator('.report').first().click();
  await expect(page.locator('.report__details')).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-selected-report.png` });
});

test('keeps the product shell usable when the map chunk fails', async ({ page }, testInfo) => {
  await page.route('**/src/components/AtlasMap.tsx*', (route) => (
    route.fulfill({ status: 503, body: 'Map chunk unavailable' })
  ));
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByText('Map unavailable')).toBeVisible();
  await expect(page.getByRole('search')).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByRole('button', { name: 'Reload map' })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-map-failure.png` });
});

test('captures the lazy map loading state without layout shift', async ({ page }, testInfo) => {
  await page.route('**/src/components/AtlasMap.tsx*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByText('Loading map')).toBeVisible();
  const loadingStage = await page.locator('.map-stage--loading').boundingBox();
  expect(loadingStage).not.toBeNull();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-map-loading.png` });
  await expectMapReady(page);
  const readyStage = await page.locator('.map-stage').boundingBox();
  expect(readyStage).not.toBeNull();
  expect(readyStage!.width).toBe(loadingStage!.width);
  expect(readyStage!.height).toBe(loadingStage!.height);
});

test('captures the report-type guardrail toast', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await openFilter(page, /^All types/);
  const options = page.locator('.filter__popover');
  for (const group of ['Property', 'Vehicle', 'Weapons', 'Other']) {
    await options.getByRole('button', { name: new RegExp(`^${group}`) }).click();
  }
  await options.getByRole('button', { name: /^Violent/ }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Keep at least one type of report selected.' });
  await expect(toast).toBeVisible();
  if (isMobile(testInfo)) await expectMinimumTargetHeight(toast.getByRole('button', { name: 'Dismiss message' }));
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-guardrail-toast.png` });
});
