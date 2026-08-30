import { FBI_STATE_CODES, FBI_STATE_NAMES } from './fbiState.constants';
import type {
  FbiCrimeCounts,
  FbiCrimeRates,
  FbiStateCode,
  FbiStateEstimate,
  FbiStateSnapshot,
} from './fbiState.types';

const stateCodes = new Set<string>(FBI_STATE_CODES);

function rowRecord(value: unknown, index: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`FBI estimate row ${index + 1} is not an object`);
  }
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, field: string, context: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context} has an invalid ${field}`);
  }
  return value.trim();
}

function nonnegativeInteger(row: Record<string, unknown>, field: string, context: string): number {
  const value = row[field];
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$|^\d{1,3}(?:,\d{3})+$/.test(normalized)) {
    throw new Error(`${context} has an invalid ${field}`);
  }
  const number = typeof normalized === 'string' ? Number(normalized.replaceAll(',', '')) : normalized;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${context} has an invalid ${field}`);
  }
  return number;
}

function sourceYear(row: Record<string, unknown>, context: string): number {
  const value = row.year;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) return Number(value.trim());
  throw new Error(`${context} has an invalid year`);
}

function crimeCounts(row: Record<string, unknown>, context: string): FbiCrimeCounts {
  if (!Object.hasOwn(row, 'rape_legacy')) throw new Error(`${context} is missing rape_legacy`);
  return {
    violentCrime: nonnegativeInteger(row, 'violent_crime', context),
    homicide: nonnegativeInteger(row, 'homicide', context),
    rape: nonnegativeInteger(row, 'rape_revised', context),
    robbery: nonnegativeInteger(row, 'robbery', context),
    aggravatedAssault: nonnegativeInteger(row, 'aggravated_assault', context),
    propertyCrime: nonnegativeInteger(row, 'property_crime', context),
    burglary: nonnegativeInteger(row, 'burglary', context),
    larceny: nonnegativeInteger(row, 'larceny', context),
    motorVehicleTheft: nonnegativeInteger(row, 'motor_vehicle_theft', context),
  };
}

function crimeRates(counts: FbiCrimeCounts, population: number): FbiCrimeRates {
  return Object.fromEntries(
    Object.entries(counts).map(([offense, count]) => [offense, count / population * 100_000]),
  ) as FbiCrimeRates;
}

function caveats(row: Record<string, unknown>, context: string): string | null {
  if (!Object.hasOwn(row, 'caveats')) throw new Error(`${context} is missing caveats`);
  const value = row.caveats;
  if (value === '') return null;
  if (typeof value !== 'string') throw new Error(`${context} has an invalid caveats`);
  return value.trim() || null;
}

function parseRow(row: Record<string, unknown>, year: number, index: number): FbiStateEstimate | null {
  const context = `FBI estimate row ${index + 1}`;
  const rowYear = sourceYear(row, context);
  if (rowYear !== year) return null;

  const stateCode = requiredText(row, 'state_abbr', context).toUpperCase();
  if (!stateCodes.has(stateCode)) throw new Error(`${context} has unexpected jurisdiction ${stateCode}`);
  const typedStateCode = stateCode as FbiStateCode;
  const sourceStateName = requiredText(row, 'state_name', `${context} (${stateCode})`);
  const stateName = FBI_STATE_NAMES[typedStateCode];
  if (sourceStateName.toLocaleLowerCase('en-US') !== stateName.toLocaleLowerCase('en-US')) {
    throw new Error(`${context} (${stateCode}) has an invalid state_name`);
  }
  const population = nonnegativeInteger(row, 'population', `${context} (${stateCode})`);
  if (population === 0) throw new Error(`${context} (${stateCode}) has an invalid population`);
  const counts = crimeCounts(row, `${context} (${stateCode})`);

  return {
    stateCode: typedStateCode,
    stateName,
    year,
    population,
    counts,
    ratesPer100k: crimeRates(counts, population),
    caveats: caveats(row, `${context} (${stateCode})`),
  };
}

export function parseFbiStateEstimates(rows: unknown, year: number): FbiStateSnapshot {
  if (!Array.isArray(rows)) throw new Error('FBI estimate source must be an array of rows');
  if (!Number.isSafeInteger(year) || year < 1979) throw new Error(`Invalid FBI estimate year ${year}`);

  const estimates = new Map<FbiStateCode, FbiStateEstimate>();
  rows.forEach((value, index) => {
    const estimate = parseRow(rowRecord(value, index), year, index);
    if (!estimate) return;
    if (estimates.has(estimate.stateCode)) {
      throw new Error(`FBI estimate source contains duplicate ${estimate.stateCode} rows for ${year}`);
    }
    estimates.set(estimate.stateCode, estimate);
  });

  if (estimates.size !== FBI_STATE_CODES.length) {
    const missing = FBI_STATE_CODES.filter((stateCode) => !estimates.has(stateCode));
    throw new Error(
      `FBI estimate source expected ${FBI_STATE_CODES.length} jurisdictions for ${year}, received ${estimates.size}; missing ${missing.join(', ')}`,
    );
  }

  return {
    year,
    states: FBI_STATE_CODES.map((stateCode) => estimates.get(stateCode)!),
  };
}

export function findFbiStateEstimate(snapshot: FbiStateSnapshot, stateCode: string): FbiStateEstimate | null {
  const normalized = stateCode.trim().toUpperCase();
  return snapshot.states.find((state) => state.stateCode === normalized) ?? null;
}
