import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

test('the production bundle loads every asset, starts the map worker and renders evidence', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const brokenAssets: string[] = [];
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) brokenAssets.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      brokenAssets.push(`${response.url()} HTTP ${response.status()}`);
    }
  });
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));

  await mockOfficialSources(page);
  await page.goto('./?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-ready', 'true');
  // Without its worker MapLibre draws nothing at all: no incidents, circle or base map.
  await expect.poll(() => workers.some((url) => url.includes('maplibre-gl-worker'))).toBe(true);
  expect(brokenAssets).toEqual([]);
});
