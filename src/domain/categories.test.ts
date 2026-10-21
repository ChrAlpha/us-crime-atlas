import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABELS,
  CATEGORY_SEVERITY,
  categoryGroup,
  CRIME_GROUPS,
  GROUP_LABELS,
  isViolentCategory,
  normalizeCategory,
  severityForCategory,
} from './categories';
import type { CrimeCategory } from '../types';

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as CrimeCategory[];

describe('category normalization', () => {
  it.each([
    ['MURDER', 'homicide'],
    ['Manslaughter 2nd', 'homicide'],
    ['Criminal Sexual Assault', 'sexual'],
    ['RAPE', 'sexual'],
    ['ROBBERY', 'robbery'],
    ['Carjacking', 'robbery'],
    ['Aggravated Battery', 'assault'],
    ['AGGRAVATED ASSAULT', 'assault'],
    ['SIMPLE ASSAULT', 'assault'],
    ['BATTERY', 'assault'],
    ['AGGRAVATED HARASSMENT', 'other'],
    ['AGGRAVATED HARASSMENT 2', 'other'],
    ['BURGLARY', 'burglary'],
    ['Breaking and Entering', 'burglary'],
    ['Grand Larceny of Motor Vehicle', 'vehicle'],
    ['MOTOR VEHICLE THEFT', 'vehicle'],
    ['Stolen Vehicle', 'vehicle'],
    ['Weapons Violation', 'weapons'],
    ['FIREARM POSSESSION', 'weapons'],
    ['Petit Larceny', 'theft'],
    ['SHOPLIFTING', 'theft'],
    ['  Pickpocket  ', 'theft'],
    ['Fraud', 'other'],
    ['', 'other'],
  ] as const)('maps %j to %s', (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });

  it('prefers the more specific offense when several patterns match', () => {
    expect(normalizeCategory('ROBBERY WITH ASSAULT')).toBe('robbery');
    expect(normalizeCategory('AUTO THEFT')).toBe('vehicle');
  });

  it('groups categories and flags violent offenses', () => {
    expect(ALL_CATEGORIES.map((category) => categoryGroup(category))).toEqual([
      'violent', 'violent', 'violent', 'violent', 'property', 'property', 'vehicle', 'weapons', 'other',
    ]);
    expect(ALL_CATEGORIES.filter((category) => isViolentCategory(category))).toEqual(['homicide', 'sexual', 'robbery', 'assault']);
  });

  it('exposes labels and explicit salience weights for every category and group', () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
      expect(severityForCategory(category)).toBe(CATEGORY_SEVERITY[category]);
      expect(severityForCategory(category)).toBeGreaterThanOrEqual(1);
    }
    expect(CRIME_GROUPS).toEqual(['violent', 'property', 'vehicle', 'weapons', 'other']);
    for (const group of CRIME_GROUPS) expect(GROUP_LABELS[group]).toBeTruthy();
    expect(CATEGORY_SEVERITY.homicide).toBeGreaterThan(CATEGORY_SEVERITY.theft);
  });
});
