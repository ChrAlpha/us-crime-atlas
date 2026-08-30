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

test('keeps eleven-city navigation and source disclosure usable', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  const featured = page.getByLabel('Featured covered places');
  await expect(featured.getByRole('button')).toHaveCount(11);
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
  await expect(dialog.locator('.provider-cards article')).toHaveCount(11);
  const sectionHeadings = await dialog.locator('.source-dialog__body h3').allTextContents();
  expect(sectionHeadings[0]).toBe('Current source');
  expect(sectionHeadings.indexOf('Current source')).toBeLessThan(
    sectionHeadings.indexOf('How relative activity is calculated'),
  );
  expect(sectionHeadings.indexOf('Read these limitations before acting')).toBeLessThan(
    sectionHeadings.indexOf('Other official local publishers'),
  );
  await expect(dialog.getByText('selected weighted incidents / selected km²')).toBeVisible();
  await expect(dialog.getByText('Philadelphia, Pennsylvania')).toBeVisible();
  await expect(dialog.getByText('Detroit, Michigan')).toBeVisible();
  await expect(dialog.getByText('Nashville, Tennessee')).toBeVisible();
  await expect(dialog.getByText('Denver, Colorado')).toBeVisible();
  await expect(dialog.getByText('Dallas, Texas')).toBeVisible();
  await expect(dialog.getByText('Los Angeles, California')).toBeVisible();
  await expect(dialog.getByText('Washington, District of Columbia')).toBeVisible();
  await expect(dialog.getByText('Seattle, Washington')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-sources.png`,
    fullPage: true,
  });

  const closeButton = page.getByRole('button', { name: 'Close sources and methodology' });
  await expect(closeButton).toBeFocused();
  await expect(page.locator('html')).toHaveClass(/has-open-dialog/);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.locator('#place-query').focus();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await closeButton.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/has-open-dialog/);
  const sourceButton = page.getByRole('button', { name: 'Sources & methodology' });
  await expect(sourceButton).toBeFocused();
  await sourceButton.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(sourceButton).toBeFocused();
});
