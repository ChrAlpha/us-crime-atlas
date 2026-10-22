import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith('mobile');
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
}

export async function expectMinimumTargetHeight(locator: Locator, minimum = 44): Promise<void> {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(minimum);
  }
}

export async function expectMapReady(page: Page, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await expect(page.getByLabel('Interactive map of published crime incident locations')).toBeVisible();
  await expect(page.locator('.map-canvas')).toHaveCSS('position', 'absolute');
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-theme', theme);
  await expect(page.locator('.map-stage')).toHaveAttribute('data-map-ready', 'true');
}

/** Types a covered place's name, which filters the search menu locally, then picks it. */
export async function goToCoveredPlace(page: Page, label: string): Promise<void> {
  await page.locator('#place-query').fill(label);
  const menu = page.getByRole('region', { name: 'Search suggestions' });
  await menu.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label);
}

/** Opens a settings chip ("Within 1 km", "Last 30 days", "All types", …). */
export async function openFilter(page: Page, chip: RegExp): Promise<void> {
  await page.getByRole('group', { name: 'Analysis settings' }).getByRole('button', { name: chip }).click();
}

/** On phones, raises the evidence sheet all the way; elsewhere the panel is always open. */
export async function raisePanel(page: Page, testInfo: TestInfo): Promise<void> {
  if (!isMobile(testInfo)) return;
  const handle = page.locator('.sheet__handle');
  for (let step = 0; step < 3; step += 1) {
    if ((await handle.getAttribute('aria-label')) === 'Collapse the evidence panel') return;
    await handle.click();
  }
  await expect(handle).toHaveAttribute('aria-label', 'Collapse the evidence panel');
}

export async function openTab(page: Page, testInfo: TestInfo, name: 'Overview' | 'Reports' | 'About the data') {
  await raisePanel(page, testInfo);
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

/** Expands the folded notes about the data, if any. */
export async function openDataNotes(page: Page): Promise<void> {
  const summary = page.locator('.notes__more summary');
  if (await summary.count()) await summary.click();
}
