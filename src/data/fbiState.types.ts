import type { FBI_STATE_CODES } from './fbiState.constants';

export type FbiStateCode = (typeof FBI_STATE_CODES)[number];

export interface FbiCrimeCounts {
  violentCrime: number;
  homicide: number;
  rape: number;
  robbery: number;
  aggravatedAssault: number;
  propertyCrime: number;
  burglary: number;
  larceny: number;
  motorVehicleTheft: number;
}

export type FbiCrimeRates = Record<keyof FbiCrimeCounts, number>;

export interface FbiStateEstimate {
  stateCode: FbiStateCode;
  stateName: string;
  year: number;
  population: number;
  counts: FbiCrimeCounts;
  ratesPer100k: FbiCrimeRates;
  caveats: string | null;
}

export interface FbiStateSnapshot {
  year: number;
  states: FbiStateEstimate[];
}
