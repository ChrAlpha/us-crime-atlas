import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';
import { expectNoHorizontalOverflow, openTab } from './helpers';

const firstReleaseCities = [
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
  'Oakland, California',
  'Seattle, Washington',
];

test('lists the nearest covered places in search and every covered city in the source notes', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.locator('#place-query').click();
  const menu = page.getByRole('list', { name: 'Places with official incident data' });
  // Six at a time, nearest first: Times Square itself leads from Times Square.
  await expect(menu.getByRole('button')).toHaveCount(6);
  await expect(menu.getByRole('button').first()).toHaveAttribute('aria-current', 'location');
  await expect(menu.getByRole('button').first()).toContainText('Times Square');
  const more = page.locator('.search__more');
  await expect(more).toContainText(/^Nearest 6 of \d+\. Type a city or state to find the rest\.$/);
  const total = Number((await more.textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(firstReleaseCities.length);

  // Typing filters every covered place locally, without a network request.
  await page.locator('#place-query').fill('seattle');
  await expect(menu.getByRole('button')).toHaveCount(1);
  await expect(menu.getByRole('button', { name: /^Pike Place\b/ })).toBeVisible();
  await page.locator('#place-query').fill('california');
  await expect(menu.getByRole('button')).toHaveCount(6);
  await expect(more).toContainText(/more places? match/);
  await page.keyboard.press('Escape');
  await expectNoHorizontalOverflow(page);

  await openTab(page, testInfo, 'About the data');
  const section = page.locator('.covered-section');
  await expect(section).not.toHaveAttribute('open');
  await expect(section.locator('.covered-section__count')).toHaveText(String(total));
  await section.locator('summary').click();
  const cities = section.locator('.covered li');
  await expect(cities).toHaveCount(total);
  for (const city of firstReleaseCities) {
    await expect(cities.filter({ hasText: city })).toHaveCount(1);
  }
  await expect(cities.filter({ hasText: 'New York City, New York' })).toContainText('Showing');
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-covered-cities.png`, fullPage: true });
});
