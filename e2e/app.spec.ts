import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockOfficialSources } from './fixtures';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
}

test('renders evidence-first analysis and passes a serious accessibility audit', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');

  await expect(page.getByTestId('reported-count')).toHaveText('5');
  await expect(page.getByTestId('activity-band')).toContainText('nearby density');
  await expect(page.getByText('NYPD Complaint Data Current (YTD)')).toBeVisible();
  await expect(page.getByText('Evidence confidence:')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .exclude('.maplibregl-control-container')
    .exclude('.maplibregl-canvas')
    .analyze();
  const seriousViolations = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(seriousViolations).toEqual([]);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-overview.png`,
    fullPage: true,
  });
});

test('updates provider, filters, radius, URL state, and methodology dialog', async ({ page }, testInfo) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'The Loop' }).click();
  await expect(page.getByText('Chicago Police Department').first()).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('4');

  if (testInfo.project.name.startsWith('mobile')) {
    const settingsToggle = page.getByRole('button', { name: 'Analysis settings' });
    await settingsToggle.click();
    await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
  }

  await page.getByRole('button', { name: 'Property' }).click();
  await expect(page).toHaveURL(/groups=violent%2Cvehicle%2Cweapons%2Cother/);
  await expect(page.getByTestId('reported-count')).toHaveText('3');

  await page.getByRole('button', { name: '500 m' }).click();
  await expect(page).toHaveURL(/radius=500/);

  if (testInfo.project.name.startsWith('desktop')) {
    await page.getByRole('button', { name: 'Sources & methodology' }).click();
    await expect(page.getByRole('dialog', { name: 'Sources & methodology' })).toBeVisible();
    await expect(page.getByText('Transparent local comparison')).toBeVisible();
    await expect(page.getByText('Los Angeles, California')).toBeVisible();
    await expect(page.getByText('Seattle, Washington')).toBeVisible();
    await page.getByRole('button', { name: 'Close sources and methodology' }).click();
  }

  await expectNoHorizontalOverflow(page);
});

test('loads an ArcGIS-backed official city feed', async ({ page }) => {
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  await page.getByRole('button', { name: 'National Mall' }).click();
  await expect(
    page.getByText('Metropolitan Police Department of the District of Columbia').first(),
  ).toBeVisible();
  await expect(page.getByText(`Crime Incidents in ${new Date().getUTCFullYear()}`)).toBeVisible();
  await expect(page.getByTestId('reported-count')).toHaveText('4');
  await expect(page).toHaveURL(/lat=38\.8895/);
  await expectNoHorizontalOverflow(page);
});

test('mobile bottom sheet can expand without layout overflow', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only interaction');
  await mockOfficialSources(page);
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('reported-count')).toHaveText('5');

  const handle = page.getByRole('button', { name: 'Resize evidence panel' });
  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expectNoHorizontalOverflow(page);

  await page.screenshot({
    path: `test-results/${testInfo.project.name}-expanded.png`,
    fullPage: true,
  });
});

test('shows an actionable failure state when an official portal is unavailable', async ({ page }) => {
  await mockOfficialSources(page, 'error');
  await page.goto('/?e2e=1');
  await expect(page.getByRole('alert')).toContainText('Official data could not be loaded');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
