import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

async function expectMinimumTargetHeight(locator: Locator, minimum = 44): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(minimum);
  }
}

async function expectMapReady(page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await expect(page.getByLabel('Interactive map of published crime incident locations')).toBeVisible();
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-theme', theme);
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-ready', 'true');
}

test('captures primary visual states at each product viewport', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expectMapReady(page);

  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-light.png` });

  const searchPanel = await page.getByLabel('Place and analysis controls').boundingBox();
  const evidencePanel = await page.getByTestId('evidence-panel').boundingBox();
  expect(searchPanel).not.toBeNull();
  expect(evidencePanel).not.toBeNull();
  if (testInfo.project.name.startsWith('desktop')) {
    expect(searchPanel!.height).toBeLessThan(760);
  }
  if (testInfo.project.name === 'tablet-chromium') {
    const mapWorkArea = evidencePanel!.x - (searchPanel!.x + searchPanel!.width);
    expect(mapWorkArea).toBeGreaterThanOrEqual(350);
  }
  if (testInfo.project.name === 'tablet-compact-chromium') {
    const mapStage = await page.locator('.map-stage').boundingBox();
    expect(mapStage).not.toBeNull();
    expect(mapStage!.width).toBeGreaterThanOrEqual(900);
    expect(mapStage!.y).toBeGreaterThanOrEqual(searchPanel!.y + searchPanel!.height);
  }

  if (testInfo.project.name.startsWith('mobile')) {
    expect(evidencePanel!.y).toBeLessThan(page.viewportSize()!.height - 48);
    await expectMinimumTargetHeight(page.locator('.brand-bar .icon-button, .locate-button, .place-search button'));
    await expectMinimumTargetHeight(page.locator('.featured-places button'));
    const settingsToggle = page.getByRole('button', { name: 'Analysis settings' });
    await settingsToggle.click();
    await expectMinimumTargetHeight(page.locator('.analysis-controls button'));
    await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-controls.png` });
    await settingsToggle.click();
  }

  await page.getByRole('button', { name: 'Sources & methodology' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Sources & methodology' })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-sources.png` });
  if (testInfo.project.name.startsWith('mobile')) {
    await page.locator('.formula-card').evaluate((element) => {
      element.scrollIntoView({ block: 'center' });
    });
    await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-source-method.png` });
  }
  await page.getByRole('button', { name: 'Close sources and methodology' }).click();

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectMapReady(page, 'dark');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByTestId('evidence-panel').evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-dark.png` });
});

test('captures source failure and unsupported-place states', async ({ page }, testInfo) => {
  const usesOverlayPanels = testInfo.project.name === 'desktop-chromium'
    || testInfo.project.name === 'tablet-chromium';
  await mockOfficialSources(page, 'error');
  await page.goto('/?e2e=1');
  await expect(page.getByRole('alert')).toContainText('Official data could not be loaded');
  await expect(page.locator('.brand-status')).toContainText('Source unavailable');
  await expect(page.locator('.provider-strip')).toContainText('temporarily unavailable');
  await expectMapReady(page);
  if (usesOverlayPanels) {
    const panel = await page.getByTestId('evidence-panel').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.height).toBeLessThan(400);
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-error.png` });
  if (testInfo.project.name.startsWith('mobile')) {
    await page.locator('.state-card').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-error-detail.png` });
  }

  await page.goto('/?e2e=1&lat=35.4676&lng=-97.5164&place=Oklahoma+City&detail=Oklahoma');
  await expect(page.getByText('No verified local incident feed')).toBeVisible();
  await expect(page.locator('.brand-status')).toContainText('Map only');
  await expectMapReady(page);
  if (usesOverlayPanels) {
    const panel = await page.getByTestId('evidence-panel').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.height).toBeLessThan(400);
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-unsupported.png` });
  if (testInfo.project.name.startsWith('mobile')) {
    await page.locator('.state-card').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-unsupported-detail.png` });
  }
});

test('captures selected raw-report evidence', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expectMapReady(page);
  await page.locator('.incident-list button').first().click();
  const selectedIncident = page.locator('.selected-incident');
  await expect(selectedIncident).toBeVisible();
  await selectedIncident.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-selected-report.png` });
});
