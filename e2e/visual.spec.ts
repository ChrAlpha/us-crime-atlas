import { expect, test, type Locator } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

async function expectMinimumTargetHeight(locator: Locator, minimum = 44): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(minimum);
  }
}

test('captures primary visual states at each product viewport', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByLabel('Interactive map of published crime incident locations')).toBeVisible();
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-ready', 'true');
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-theme', 'light');

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
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-theme', 'dark');
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-ready', 'true');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByTestId('evidence-panel').evaluate((element) => {
      element.scrollIntoView({ block: 'start' });
    });
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-dark.png` });
});
