import type { AgencyMatch, AgencySnapshot, MonthlySeries } from '../data/agencyStats.types';
import type { EvidenceBand } from '../types';

export const SUMMARY_MONTHS = 12;
/** Fewer reported months than this cannot be annualized into a rate. */
export const MIN_RATE_MONTHS = 6;
/** Below this population, a handful of offenses moves the rate a long way. */
export const SMALL_POPULATION = 10_000;

export interface OffenseTotals {
  violent: number;
  property: number;
}

export interface TrendPercent extends OffenseTotals {
  /** Violent and property offenses together. */
  total: number;
}

export interface MonthlyOffenses {
  month: string;
  violent: number | null;
  property: number | null;
}

export interface AgencySummary {
  match: AgencyMatch;
  stateName: string;
  /** First and last month of the trailing window, `YYYY-MM`. */
  startMonth: string;
  endMonth: string;
  /** Months in the window for which the agency submitted counts. */
  reportedMonths: number;
  counts: OffenseTotals;
  /** Annualized offenses per 100,000 residents, or `null` without a population or enough months. */
  ratesPer100k: OffenseTotals | null;
  /** The state's rate over the same months, per 100,000 residents of reporting agencies. */
  stateRatesPer100k: OffenseTotals | null;
  nationalRatesPer100k: OffenseTotals | null;
  relativeToState: OffenseTotals | null;
  /** Change from the preceding twelve months, only when both windows are complete. */
  trendPercent: TrendPercent | null;
  monthly: MonthlyOffenses[];
  /** Months between the window end and the newest month in the snapshot. */
  monthsBehind: number;
  smallPopulation: boolean;
}

export function monthIndex(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return year! * 12 + value! - 1;
}

export function monthLabel(index: number): string {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function formatMonth(month: string): string {
  const index = monthIndex(month);
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1))
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function reportedAt(violent: MonthlySeries, property: MonthlySeries, index: number): boolean {
  return typeof violent[index] === 'number' && typeof property[index] === 'number';
}

function windowTotals(violent: MonthlySeries, property: MonthlySeries, start: number, end: number) {
  let months = 0;
  const totals = { violent: 0, property: 0 };
  for (let index = Math.max(0, start); index <= end; index += 1) {
    if (!reportedAt(violent, property, index)) continue;
    months += 1;
    totals.violent += violent[index]!;
    totals.property += property[index]!;
  }
  return { months, totals };
}

/** Sum of monthly per-100k rates over the window, annualized over the months that have one. */
function annualRate(series: MonthlySeries, start: number, end: number): number | null {
  let months = 0;
  let total = 0;
  for (let index = Math.max(0, start); index <= end; index += 1) {
    const value = series[index];
    if (typeof value !== 'number') continue;
    months += 1;
    total += value;
  }
  return months >= MIN_RATE_MONTHS ? (total / months) * SUMMARY_MONTHS : null;
}

function pairRates(rates: AgencySnapshot['stateRates'], start: number, end: number): OffenseTotals | null {
  const violent = annualRate(rates.violent, start, end);
  const property = annualRate(rates.property, start, end);
  return violent === null || property === null ? null : { violent, property };
}

function ratio(value: number, reference: number): number | null {
  return reference > 0 ? value / reference : null;
}

/**
 * Twelve-month totals for the matched agency, ending at its newest reported month (agencies
 * submit on their own schedules), compared with the state over the same months.
 * Returns `null` when the agency reported nothing in the snapshot.
 */
export function summarizeAgency(match: AgencyMatch, snapshot: AgencySnapshot): AgencySummary | null {
  const { violent, property, population } = match.agency;
  if (!violent || !property) return null;
  const firstMonth = monthIndex(snapshot.months[0]);
  const lastIndex = monthIndex(snapshot.months[1]) - firstMonth;

  let end = lastIndex;
  while (end >= 0 && !reportedAt(violent, property, end)) end -= 1;
  if (end < 0) return null;
  const start = end - SUMMARY_MONTHS + 1;

  const current = windowTotals(violent, property, start, end);
  const previous = windowTotals(violent, property, start - SUMMARY_MONTHS, start - 1);
  const annualize = SUMMARY_MONTHS / current.months;
  const ratesPer100k = population > 0 && current.months >= MIN_RATE_MONTHS
    ? {
        violent: (current.totals.violent * annualize / population) * 100_000,
        property: (current.totals.property * annualize / population) * 100_000,
      }
    : null;
  const stateRatesPer100k = pairRates(snapshot.stateRates, start, end);
  const relativeViolent = ratesPer100k && stateRatesPer100k ? ratio(ratesPer100k.violent, stateRatesPer100k.violent) : null;
  const relativeProperty = ratesPer100k && stateRatesPer100k ? ratio(ratesPer100k.property, stateRatesPer100k.property) : null;
  const bothComplete = current.months === SUMMARY_MONTHS && previous.months === SUMMARY_MONTHS;
  const trendPercent = bothComplete && previous.totals.violent > 0 && previous.totals.property > 0
    ? {
        violent: ((current.totals.violent - previous.totals.violent) / previous.totals.violent) * 100,
        property: ((current.totals.property - previous.totals.property) / previous.totals.property) * 100,
        total: ((current.totals.violent + current.totals.property) / (previous.totals.violent + previous.totals.property) - 1) * 100,
      }
    : null;

  return {
    match,
    stateName: snapshot.stateName,
    startMonth: monthLabel(firstMonth + start),
    endMonth: monthLabel(firstMonth + end),
    reportedMonths: current.months,
    counts: current.totals,
    ratesPer100k,
    stateRatesPer100k,
    nationalRatesPer100k: pairRates(snapshot.nationalRates, start, end),
    relativeToState: relativeViolent === null || relativeProperty === null
      ? null
      : { violent: relativeViolent, property: relativeProperty },
    trendPercent,
    monthly: Array.from({ length: SUMMARY_MONTHS }, (_, offset) => {
      const index = start + offset;
      const reported = index >= 0 && reportedAt(violent, property, index);
      return {
        month: monthLabel(firstMonth + index),
        violent: reported ? violent[index]! : null,
        property: reported ? property[index]! : null,
      };
    }),
    monthsBehind: lastIndex - end,
    smallPopulation: population > 0 && population < SMALL_POPULATION,
  };
}

/** The local comparison's bands, applied to the ratio of the agency's rate to its state's. */
export function relativeBand(relative: number | null): EvidenceBand {
  if (relative === null) return 'insufficient';
  if (relative < 0.65) return 'lower';
  if (relative < 1.25) return 'similar';
  if (relative < 2) return 'elevated';
  return 'markedly-elevated';
}

export interface StateSummary {
  stateName: string;
  startMonth: string;
  endMonth: string;
  ratesPer100k: OffenseTotals | null;
  nationalRatesPer100k: OffenseTotals | null;
}

/** The state's own twelve-month rate, for points no agency in the snapshot covers. */
export function summarizeState(snapshot: AgencySnapshot): StateSummary {
  const firstMonth = monthIndex(snapshot.months[0]);
  const end = monthIndex(snapshot.months[1]) - firstMonth;
  const start = end - SUMMARY_MONTHS + 1;
  return {
    stateName: snapshot.stateName,
    startMonth: monthLabel(firstMonth + start),
    endMonth: snapshot.months[1],
    ratesPer100k: pairRates(snapshot.stateRates, start, end),
    nationalRatesPer100k: pairRates(snapshot.nationalRates, start, end),
  };
}
