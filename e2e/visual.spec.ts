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

  await page.screenshot({ path: `test-results/${testInfo.project.name}-viewport-light.png` });

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
