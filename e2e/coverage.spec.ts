import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';
import { expectNoHorizontalOverflow, openTab } from './helpers';

const coveredPlaces = [
  'Times Square',
  'National Mall',
  'Center City',
  'The Loop',
  'Downtown Detroit',
  'Lower Broadway',
  'Downtown Dallas',
  'Downtown Denver',
  'Hollywood',
  'Union Square',
  'Pike Place',
];

const coveredCities = [
  'New York City, New York',
  'Washington, District of Columbia',
  'Philadelphia, Pennsylvania',
  'Chicago, Illinois',
  'Detroit, Michigan',
  'Nashville, Tennessee',
  'Dallas, Texas',
  'Denver, Colorado',
  'Los Angeles, California',
  'San Francisco, California',
  'Seattle, Washington',
];

test('lists every covered city in search and in the source notes', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.locator('#place-query').click();
  const menu = page.getByRole('list', { name: 'Places with official incident data' });
  await expect(menu.getByRole('button')).toHaveCount(coveredPlaces.length);
  for (const label of coveredPlaces) {
    await expect(menu.getByRole('button', { name: new RegExp(`^${label}\\b`) })).toBeAttached();
  }
  await expect(menu.getByRole('button', { name: /^Times Square/ })).toHaveAttribute('aria-current', 'location');

  // Typing narrows the covered places locally, without a network request.
  await page.locator('#place-query').fill('cali');
  await expect(menu.getByRole('button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expectNoHorizontalOverflow(page);

  await openTab(page, testInfo, 'About the data');
  const cities = page.locator('.covered li');
  await expect(cities).toHaveCount(coveredCities.length);
  for (const city of coveredCities) {
    await expect(cities.filter({ hasText: city })).toHaveCount(1);
  }
  await expect(cities.filter({ hasText: 'New York City, New York' })).toContainText('Showing');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-covered-cities.png`, fullPage: true });
});
