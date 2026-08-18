import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
}

const featuredPlaces = [
  'Times Square',
  'National Mall',
  'The Loop',
  'Hollywood',
  'Union Square',
  'Pike Place',
];

test('keeps six-city navigation and source disclosure usable', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  const featured = page.getByLabel('Featured covered places');
  await expect(featured.getByRole('button')).toHaveCount(6);
  for (const label of featuredPlaces) {
    await expect(featured.getByRole('button', { name: label })).toBeAttached();
  }
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name.startsWith('mobile')) {
    const sourceButton = page.getByRole('button', { name: 'Sources & methodology' });
    await sourceButton.scrollIntoViewIfNeeded();
    await sourceButton.click();
  } else {
    await page.getByRole('button', { name: 'Sources & methodology' }).click();
  }

  const dialog = page.getByRole('dialog', { name: 'Sources & methodology' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.provider-cards article')).toHaveCount(6);
  await expect(dialog.getByText('Los Angeles, California')).toBeVisible();
  await expect(dialog.getByText('Washington, District of Columbia')).toBeVisible();
  await expect(dialog.getByText('Seattle, Washington')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-sources.png`,
    fullPage: true,
  });
});
