/** Monthly offense counts or rates aligned with `AgencySnapshot.months`; `null` marks an unreported month. */
export type MonthlySeries = ReadonlyArray<number | null>;

export interface OffenseSeries {
  violent: MonthlySeries;
  property: MonthlySeries;
}

export interface AgencyRecord {
  name: string;
  type: string;
  /** Population the agency served in its newest reported month (0 when the FBI lists none). */
  population: number;
  /** `null` when the agency submitted nothing in the snapshot's months. */
  violent: MonthlySeries | null;
  property: MonthlySeries | null;
}

/** One state's FBI Crime Data Explorer snapshot (regenerate with scripts/fetch-agency-stats.mjs). */
export interface AgencySnapshot {
  state: string;
  stateName: string;
  stateFips: string;
  source: string;
  sourceUrl: string;
  /** Crime Data Explorer refresh date, `MM/DD/YYYY`. */
  refreshed: string;
  retrieved: string;
  /** First and last month (`YYYY-MM`) of every monthly series. */
  months: readonly [first: string, last: string];
  /** Offenses per 100,000 residents of reporting agencies, per month. */
  stateRates: OffenseSeries;
  nationalRates: OffenseSeries;
  agencies: Record<string, AgencyRecord>;
  /** Census incorporated place GEOID → agency ORI. */
  places: Record<string, string>;
  /** Census county subdivision GEOID (towns and townships) → agency ORI. */
  countySubdivisions: Record<string, string>;
  /** Census county GEOID → agency ORI for areas outside any city or town agency. */
  counties: Record<string, string>;
  countyNames: Record<string, string>;
}

export interface CensusArea {
  geoid: string;
  name: string;
}

/** The Census geography containing a point. */
export interface CensusGeography {
  stateFips: string;
  countyFips: string;
  place: CensusArea | null;
  countySubdivision: CensusArea | null;
}

/** Which Census area tied the point to its agency. */
export type AgencyBasis = 'place' | 'county-subdivision' | 'county';

export interface AgencyMatch {
  ori: string;
  agency: AgencyRecord;
  basis: AgencyBasis;
  /** The city, town or county the agency's totals describe. */
  areaName: string;
  /** An incorporated place around the point for which no agency of its own was found. */
  placeWithoutAgency: string | null;
}
