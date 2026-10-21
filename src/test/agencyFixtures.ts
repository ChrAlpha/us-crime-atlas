import type { AgencyMatch, AgencyRecord, AgencySnapshot, CensusGeography } from '../data/agencyStats.types';

/** 24 months, 2024-08 through 2026-07. */
export const FIXTURE_MONTHS = ['2024-08', '2026-07'] as const;
const MONTH_COUNT = 24;

function constant(value: number | null, length = MONTH_COUNT): Array<number | null> {
  return Array.from({ length }, () => value);
}

/** Previous year 10 violent / 40 property a month; current year 12 / 30. */
export const FULL_AGENCY: AgencyRecord = {
  name: 'Fixture City Police Department',
  type: 'City',
  population: 120_000,
  violent: [...constant(10, 12), ...constant(12, 12)],
  property: [...constant(40, 12), ...constant(30, 12)],
};

/** Stops reporting after 2025-12, and skipped 2025-06. */
export const LAGGING_AGENCY: AgencyRecord = {
  name: 'Lagging Town Police Department',
  type: 'City',
  population: 8_000,
  violent: [...constant(2, 10), null, ...constant(2, 6), ...constant(null, 7)],
  property: [...constant(5, 10), null, ...constant(5, 6), ...constant(null, 7)],
};

export const UNPOPULATED_AGENCY: AgencyRecord = {
  name: 'Fixture County Sheriff\'s Office',
  type: 'County',
  population: 0,
  violent: constant(3),
  property: constant(9),
};

export const SILENT_AGENCY: AgencyRecord = {
  name: 'Silent City Police Department',
  type: 'City',
  population: 50_000,
  violent: null,
  property: null,
};

export function fixtureSnapshot(overrides: Partial<AgencySnapshot> = {}): AgencySnapshot {
  return {
    state: 'CA',
    stateName: 'California',
    stateFips: '06',
    source: 'FBI Crime Data Explorer, summarized SRS and NIBRS offenses known to law enforcement',
    sourceUrl: 'https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend',
    refreshed: '10/15/2026',
    retrieved: '2026-10-21',
    months: FIXTURE_MONTHS,
    // 40 violent and 150 property per 100k a year.
    stateRates: { violent: constant(40 / 12), property: constant(150 / 12) },
    nationalRates: { violent: constant(30 / 12), property: constant(130 / 12) },
    agencies: {
      CA0000001: FULL_AGENCY,
      CA0000002: LAGGING_AGENCY,
      CA0000003: UNPOPULATED_AGENCY,
      CA0000004: SILENT_AGENCY,
    },
    places: { '0600001': 'CA0000001', '0600004': 'CA0000004' },
    countySubdivisions: { '0600190002': 'CA0000002' },
    counties: { '06001': 'CA0000003' },
    countyNames: { '06001': 'Fixture County', '06003': 'Empty County' },
    ...overrides,
  };
}

export function geography(overrides: Partial<CensusGeography> = {}): CensusGeography {
  return {
    stateFips: '06',
    countyFips: '06001',
    place: { geoid: '0600001', name: 'Fixture city' },
    countySubdivision: { geoid: '0600190001', name: 'Fixture CCD' },
    ...overrides,
  };
}

export function matchFor(agency: AgencyRecord, overrides: Partial<AgencyMatch> = {}): AgencyMatch {
  return {
    ori: 'CA0000001',
    agency,
    basis: 'place',
    areaName: 'Fixture city',
    placeWithoutAgency: null,
    ...overrides,
  };
}
