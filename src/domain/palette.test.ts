import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrimeGroup } from '../types';
import { CRIME_GROUPS } from './categories';
import { GROUP_COLORS, MAP_INK, type ThemeName } from './palette';

const TOKENS = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const opening = `${selector} {`;
  const start = TOKENS.indexOf(opening);
  if (start < 0) throw new Error(`tokens.css has no "${opening}" rule`);
  const end = TOKENS.indexOf('}', start);
  return TOKENS.slice(start + opening.length, end);
}

function groupTokens(selector: string): Partial<Record<CrimeGroup, string>> {
  const tokens: Partial<Record<CrimeGroup, string>> = {};
  for (const [, group, value] of ruleBody(selector).matchAll(/--group-([a-z]+)\s*:\s*([^;]+);/g)) {
    tokens[group as CrimeGroup] = value!.trim().toLowerCase();
  }
  return tokens;
}

const THEME_SELECTORS: ReadonlyArray<readonly [ThemeName, string]> = [
  ['light', ':root'],
  ['dark', ':root[data-theme="dark"]'],
];

describe('group palette', () => {
  it.each(THEME_SELECTORS)('declares the %s group colors in tokens.css exactly as the map palette', (theme, selector) => {
    const css = groupTokens(selector);
    expect(Object.keys(css).sort()).toEqual([...CRIME_GROUPS].sort());
    for (const group of CRIME_GROUPS) {
      expect(css[group], `--group-${group} in ${selector}`).toBe(GROUP_COLORS[theme][group].toLowerCase());
    }
  });

  it.each(THEME_SELECTORS)('gives every group a distinct hex color in the %s theme', (theme) => {
    const colors = CRIME_GROUPS.map((group) => GROUP_COLORS[theme][group]);
    expect(new Set(colors).size).toBe(CRIME_GROUPS.length);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('declares only the five groups in the palette', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(Object.keys(GROUP_COLORS[theme]).sort()).toEqual([...CRIME_GROUPS].sort());
    }
  });
});

describe('map ink', () => {
  it('pairs a dark ink on a light surface and the reverse in the dark theme', () => {
    const luminance = (hex: string) => Number.parseInt(hex.slice(1, 3), 16)
      + Number.parseInt(hex.slice(3, 5), 16)
      + Number.parseInt(hex.slice(5, 7), 16);
    for (const theme of ['light', 'dark'] as const) {
      expect(MAP_INK[theme].ink).toMatch(/^#[0-9a-f]{6}$/);
      expect(MAP_INK[theme].surface).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(luminance(MAP_INK.light.ink)).toBeLessThan(luminance(MAP_INK.light.surface));
    expect(luminance(MAP_INK.dark.ink)).toBeGreaterThan(luminance(MAP_INK.dark.surface));
  });
});
