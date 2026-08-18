import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SEVERITY,
  categoryGroup,
  isViolentCategory,
  normalizeCategory,
  severityForCategory,
} from './categories';

describe('category normalization', () => {
  it.each([
    ['MURDER', 'homicide'],
    ['Criminal Sexual Assault', 'sexual'],
    ['ROBBERY', 'robbery'],
    ['Aggravated Battery', 'assault'],
    ['BURGLARY', 'burglary'],
    ['Grand Larceny of Motor Vehicle', 'vehicle'],
    ['Weapons Violation', 'weapons'],
    ['Petit Larceny', 'theft'],
    ['Fraud', 'other'],
  ] as const)('maps %s to %s', (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });

  it('groups categories and exposes explicit salience weights', () => {
    expect(categoryGroup('homicide')).toBe('violent');
    expect(categoryGroup('burglary')).toBe('property');
    expect(categoryGroup('vehicle')).toBe('vehicle');
    expect(categoryGroup('weapons')).toBe('weapons');
    expect(categoryGroup('other')).toBe('other');
    expect(isViolentCategory('robbery')).toBe(true);
    expect(isViolentCategory('theft')).toBe(false);
    expect(severityForCategory('sexual')).toBe(CATEGORY_SEVERITY.sexual);
  });
});
