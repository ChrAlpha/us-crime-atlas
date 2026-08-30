import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

test('captures primary visual states at each product viewport', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByLabel('Interactive map of published crime incident locations')).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.waitForTimeout(500);

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
    await page.getByRole('button', { name: 'Analysis settings' }).click();
    await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-controls.png` });
  }

  await page.getByRole('button', { name: 'Sources & methodology' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Sources & methodology' })).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-sources.png` });
  await page.getByRole('button', { name: 'Close sources and methodology' }).click();

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-dark.png` });
});
