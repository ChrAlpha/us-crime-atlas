/**
 * Plain-language copy for the FBI jurisdiction totals that stand in wherever no local
 * incident feed covers a point. Pure functions, like `presentation.ts` for local feeds.
 */
import type { EvidenceBand } from '../types';
import {
  formatMonth,
  MIN_RATE_MONTHS,
  relativeBand,
  SMALL_POPULATION,
  SUMMARY_MONTHS,
  type AgencySummary,
  type StateSummary,
  type TrendPercent,
} from './agencySummary';
import { formatRatio, type DataNote } from './presentation';

/** Months behind the snapshot's newest month before the panel calls the agency out. */
export const STALE_AGENCY_MONTHS = 3;

export function wholeNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Census names carry their legal description: `Jersey City city`, `South Gate-East Los Angeles CCD`,
 * `Nashville-Davidson metropolitan government (balance)`. People call them `Jersey City`.
 */
export function areaLabel(censusName: string): string {
  const plain = censusName
    .replace(/\s+\(balance\)$/, '')
    .replace(/\s+(?:CDP|CCD)$/, '')
    .replace(/(?:\s+[a-z][a-z-]*)+$/, '');
  return plain || censusName;
}

/** `Mar 2025 – Feb 2026`. */
export function monthRangeLabel(startMonth: string, endMonth: string): string {
  return `${formatMonth(startMonth)} – ${formatMonth(endMonth)}`;
}

export interface JurisdictionFinding {
  headline: string;
  reason: string | null;
  /** The agency's violent rate over the state's, when both exist. */
  ratio: number | null;
  band: EvidenceBand;
}

/** The answer for an agency: its violent-offense rate against its state's, in words. */
export function agencyFinding(summary: AgencySummary): JurisdictionFinding {
  const state = summary.stateName;
  const relative = summary.relativeToState?.violent ?? null;
  if (relative !== null) {
    const band = relativeBand(relative);
    let headline: string;
    if (relative === 0) headline = `No violent offenses in the ${summary.reportedMonths} reported months`;
    else if (band === 'lower') {
      // Never round a quiet-but-not-empty jurisdiction up to "100% fewer".
      const fewer = Math.min(99, Math.round((1 - relative) * 100));
      headline = `${fewer}% fewer violent offenses per resident than ${state} overall`;
    } else if (band === 'similar') headline = `About as many violent offenses per resident as ${state} overall`;
    else headline = `${formatRatio(relative)} as many violent offenses per resident as ${state} overall`;
    return { headline, reason: null, ratio: relative, band };
  }
  if (summary.ratesPer100k) {
    return {
      headline: `${wholeNumber(summary.ratesPer100k.violent)} violent offenses per 100,000 residents a year`,
      reason: `No ${state} rate covers the same months, so there is no comparison.`,
      ratio: null,
      band: 'insufficient',
    };
  }
  if (summary.match.agency.population > 0) {
    return {
      headline: 'Too few months reported for a rate',
      reason: `${summary.match.agency.name} sent ${summary.reportedMonths} of ${SUMMARY_MONTHS} months to the FBI.`,
      ratio: null,
      band: 'insufficient',
    };
  }
  return {
    headline: `${wholeNumber(summary.counts.violent)} violent offenses reported`,
    reason: 'The FBI lists no population for this agency, so there is no rate to compare.',
    ratio: null,
    band: 'insufficient',
  };
}

export function agencyMethodLine(summary: AgencySummary): string {
  const range = monthRangeLabel(summary.startMonth, summary.endMonth);
  const versus = summary.relativeToState ? `, per resident vs. ${summary.stateName} overall` : '';
  return `FBI totals for all of ${areaLabel(summary.match.areaName)}, ${range}${versus}. Not a safety rating.`;
}

/** `1,234 per 100k a year · Oklahoma 456`. */
export function rateLine(rate: number | undefined, stateRate: number | undefined, stateName: string): string {
  if (rate === undefined) return 'No rate per resident';
  const state = stateRate === undefined ? '' : ` · ${stateName} ${wholeNumber(stateRate)}`;
  return `${wholeNumber(rate)} per 100k a year${state}`;
}

export function agencyTrendCopy(trend: TrendPercent | null): string {
  if (!trend) return 'No trend: needs two complete years';
  const change = Math.round(trend.total);
  if (change === 0) return 'Same as the 12 months before';
  return `${Math.abs(change)}% ${change > 0 ? 'more' : 'fewer'} than the 12 months before`;
}

export function agencyNotes(summary: AgencySummary): DataNote[] {
  const { match } = summary;
  const notes: DataNote[] = [
    {
      id: 'precision',
      title: 'Lower precision',
      body: `No local incident feed covers this point, so the FBI's totals for all of ${areaLabel(match.areaName)} stand in. `
        + 'They cannot tell one block from another, and the radius, dates, and report types do not apply.',
      prominent: true,
    },
  ];
  if (match.placeWithoutAgency) {
    notes.push({
      id: 'no-city-agency',
      title: 'No city agency matched',
      body: `${areaLabel(match.placeWithoutAgency)} has no police agency of its own in the FBI data, so ${match.agency.name}'s `
        + 'totals are shown. They may not include the city.',
      prominent: true,
    });
  }
  if (summary.smallPopulation) {
    notes.push({
      id: 'small-population',
      title: 'Small population',
      body: `Fewer than ${wholeNumber(SMALL_POPULATION)} residents: a handful of offenses moves this rate a long way.`,
      prominent: true,
    });
  }
  if (summary.reportedMonths < SUMMARY_MONTHS) {
    notes.push({
      id: 'partial-months',
      title: `${summary.reportedMonths} of ${SUMMARY_MONTHS} months reported`,
      body: summary.reportedMonths >= MIN_RATE_MONTHS
        ? 'Rates are annualized from the months that were sent, and the trend is left out.'
        : 'Too few months to annualize into a rate, and the trend is left out.',
      prominent: false,
    });
  }
  if (summary.monthsBehind >= STALE_AGENCY_MONTHS) {
    notes.push({
      id: 'agency-behind',
      title: `Agency is ${summary.monthsBehind} months behind`,
      body: `${match.agency.name}'s newest FBI submission is for ${formatMonth(summary.endMonth)}, `
        + `${summary.monthsBehind} months before the newest month in this snapshot.`,
      prominent: false,
    });
  }
  return notes;
}

/** Where no agency matched or it reported nothing: the state's rate, framed as context only. */
export function stateFinding(summary: StateSummary, agencyName: string | null): { headline: string; reason: string; context: string } {
  const reason = agencyName
    ? `${agencyName} sent no months to the FBI in this snapshot.`
    : 'No city, town, or county police agency in the FBI data matched this point.';
  const national = summary.nationalRatesPer100k ? ` (US: ${wholeNumber(summary.nationalRatesPer100k.violent)})` : '';
  const context = summary.ratesPer100k
    ? `${summary.stateName} overall: ${wholeNumber(summary.ratesPer100k.violent)} violent offenses per 100,000 residents `
      + `a year${national}. That is context only; it says nothing about this area.`
    : `${summary.stateName} has no statewide rate for these months.`;
  return { headline: 'No local police totals for this point', reason, context };
}
