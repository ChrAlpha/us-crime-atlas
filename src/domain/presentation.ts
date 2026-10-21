import { LATEST_RECORD_LOOKBACK_DAYS } from '../data/providers/shared';
import type {
  AnalysisResult,
  AreaCoverage,
  EvidenceBand,
  EvidenceBundle,
  EvidenceTruncation,
  EvidenceWindow,
  Incident,
  UnavailableReason,
} from '../types';
import { COMPARISON_RADIUS_MULTIPLIER, isTruncated } from './analysis';
import { CATEGORY_LABELS } from './categories';
import {
  currentWindowPredatesDataset,
  isDelayedFeed,
  lastDayOfWindow,
  publicationLagDays,
} from './evidenceWindow';
import { formatDay, formatDayRange } from './time';

/* Plain-language copy and formatting for the evidence panel. Pure, so every phrase is testable. */

export function radiusLabel(radiusMeters: number): string {
  return radiusMeters < 1000 ? `${radiusMeters} m` : `${radiusMeters / 1000} km`;
}

export function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** `1,602`, or `1,602+` when a query hit its record budget and the count is a lower bound. */
export function formatCount(count: number, lowerBound = false): string {
  return `${count.toLocaleString('en-US')}${lowerBound ? '+' : ''}`;
}

/** `19%`; shares that would round to 0% or 100% without being either read `<1%` and `>99%`. */
export function percent(share: number): string {
  if (share > 0 && share < 0.005) return '<1%';
  if (share < 1 && share >= 0.995) return '>99%';
  return `${Math.round(share * 100)}%`;
}

/** `4.9×` below ten, `12×` from ten up (so 9.96 reads `10×`, not `10.0×`); `<0.1×` near zero. */
export function formatRatio(ratio: number): string {
  if (ratio === 0) return '0×';
  if (ratio < 0.05) return '<0.1×';
  return `${ratio < 9.95 ? ratio.toFixed(1) : Math.round(ratio)}×`;
}

export function comparisonRingLabel(radiusMeters: number): string {
  const outer = radiusMeters * COMPARISON_RADIUS_MULTIPLIER;
  if (radiusMeters % 1000 === 0) return `${radiusMeters / 1000}–${outer / 1000} km`;
  return `${radiusLabel(radiusMeters)}–${radiusLabel(outer)}`;
}

export function windowRangeLabel(window: EvidenceWindow): string {
  return formatDayRange(window.currentStartEpochMs, lastDayOfWindow(window));
}

/* ── The headline finding ─────────────────────────────────────────────────── */

export const BAND_LABELS: Record<EvidenceBand, string> = {
  lower: 'Lower',
  similar: 'Similar',
  elevated: 'Higher',
  'markedly-elevated': 'Much higher',
  insufficient: 'Not enough data',
};

const COMPARISON_UNAVAILABLE: Record<UnavailableReason, string> = {
  'record-limit': 'The surrounding area has more reports than one request can return, so its rate would be understated.',
  'dataset-start': 'The dataset does not cover the whole window, so the two areas would not be comparable.',
  jurisdiction: 'Too little of the circle or the surrounding area lies inside city limits for a fair comparison.',
};

export interface Finding {
  /** The one-sentence answer. */
  headline: string;
  /** Why there is no comparison, when there is none. */
  reason: string | null;
  /** The ratio for the comparison scale, or `null` when no comparison is stated. */
  ratio: number | null;
  band: EvidenceBand;
}

export function finding(analysis: AnalysisResult): Finding {
  const { relativeActivity: ratio, band } = analysis;
  if (analysis.comparisonUnavailableReason) {
    return {
      headline: 'No fair comparison with the surrounding area',
      reason: COMPARISON_UNAVAILABLE[analysis.comparisonUnavailableReason],
      ratio: null,
      band: 'insufficient',
    };
  }
  if (band === 'insufficient' || ratio === null) {
    const nearbyEmpty = analysis.nearbyCurrentIncidents.length === 0 && analysis.currentCount >= 5;
    return {
      headline: 'Too few reports for a fair comparison',
      reason: nearbyEmpty
        ? 'The surrounding area had no matching reports to compare against.'
        : 'Fewer than five matching reports in and around the circle over these dates.',
      ratio: null,
      band: 'insufficient',
    };
  }
  if (band === 'lower') {
    // Never round a quiet-but-not-empty circle up to "100% fewer".
    const fewer = Math.min(99, Math.round((1 - ratio) * 100));
    return {
      headline: ratio === 0
        ? 'No matching reports in the circle, though the surrounding area had some'
        : `${fewer}% fewer reports per km² than the surrounding area`,
      reason: null,
      ratio,
      band,
    };
  }
  if (band === 'similar') {
    return { headline: 'About as many reports per km² as the surrounding area', reason: null, ratio, band };
  }
  return { headline: `${formatRatio(ratio)} as many reports per km² as the surrounding area`, reason: null, ratio, band };
}

/** The comparison scale is logarithmic from ¼× to 4×, so 1× sits in the middle. */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 4;

export function scalePosition(ratio: number): number {
  const position = (Math.log2(ratio) - Math.log2(SCALE_MIN)) / (Math.log2(SCALE_MAX) - Math.log2(SCALE_MIN));
  return Math.min(1, Math.max(0, position));
}

/** Band edges on the scale, matching `evidenceBand`. */
export const SCALE_BANDS: ReadonlyArray<{ band: EvidenceBand; from: number; to: number }> = [
  { band: 'lower', from: SCALE_MIN, to: 0.65 },
  { band: 'similar', from: 0.65, to: 1.25 },
  { band: 'elevated', from: 1.25, to: 2 },
  { band: 'markedly-elevated', from: 2, to: SCALE_MAX },
];

export function methodLine(radiusMeters: number, window: EvidenceWindow): string {
  return `Severity-weighted, ${radiusLabel(radiusMeters)} circle vs. the ${comparisonRingLabel(radiusMeters)} ring, `
    + `${windowRangeLabel(window)}. Not a safety rating.`;
}

/* ── Supporting facts ─────────────────────────────────────────────────────── */

export function trendCopy(analysis: AnalysisResult, window: EvidenceWindow): string {
  const previous = `previous ${window.windowDays} days`;
  if (analysis.trendDirection === 'unavailable') {
    return analysis.trendUnavailableReason === 'dataset-start'
      ? 'No trend: the dataset starts mid-way'
      : 'No trend: a request hit its record limit';
  }
  if (analysis.trendDirection === 'none') return `None in the ${previous} either`;
  if (analysis.trendDirection === 'new') return `None in the ${previous}`;
  const change = Math.abs(Math.round(analysis.trendPercent ?? 0));
  if (analysis.trendDirection === 'flat' || change === 0) return `Same as the ${previous}`;
  return `${change}% ${analysis.trendDirection === 'up' ? 'more' : 'fewer'} than the ${previous}`;
}

/* ── Notes about the data behind this view ────────────────────────────────── */

export function delayedFeedCopy(window: EvidenceWindow, cadence: string): string {
  if (window.latestRecordEpochMs === null) {
    return `No records were published in the last ${LATEST_RECORD_LOOKBACK_DAYS} days. ${cadence}.`;
  }
  const newest = formatDay(window.latestRecordEpochMs);
  const end = formatDay(lastDayOfWindow(window));
  const filling = window.settlingDays === 1 ? 'newest day is' : `newest ${window.settlingDays} days are`;
  const settling = window.settlingDays > 0
    ? ` The ${filling} still being filled in, so the window ends ${end}.`
    : ` The window ends ${end}.`;
  return `The newest published record is from ${newest}. ${cadence}.${settling} `
    + 'Days the publisher has not released yet are never counted as quiet days.';
}

export function settlingCopy(window: EvidenceWindow): string | null {
  if (window.settlingDays === 0 || window.latestRecordEpochMs === null) return null;
  return `Newest ${dayCount(window.settlingDays)} left out while the publisher is still filling them in`;
}

/** Below this covered share of either area, the panel says how much lies outside city limits. */
const AREA_NOTICE_SHARE = 0.95;

export function areaCoverageCopy(coverage: AreaCoverage, city: string): string | null {
  if (coverage.selected >= AREA_NOTICE_SHARE && coverage.nearby >= AREA_NOTICE_SHARE) return null;
  const outsideSelected = Math.round((1 - coverage.selected) * 100);
  const outsideNearby = Math.round((1 - coverage.nearby) * 100);
  const parts = [
    outsideSelected > 0 ? `${outsideSelected}% of the circle` : null,
    outsideNearby > 0 ? `${outsideNearby}% of the surrounding area` : null,
  ].filter(Boolean);
  return `${parts.join(' and ')} ${parts.length > 1 ? 'lie' : 'lies'} outside ${city} limits, where this feed has `
    + 'no records. Rates use only the area inside the city.';
}

export function truncationCopy(truncation: EvidenceTruncation, recordLimit: number): string {
  const limit = `${recordLimit.toLocaleString('en-US')}-record limit`;
  if (truncation.selectedCurrent || truncation.selectedPrevious) {
    return `A request for the circle reached the ${limit}, so counts are minimums and the trend is withheld. `
      + 'A smaller radius or shorter window avoids this.';
  }
  return `The request for the surrounding area reached the ${limit}, so the comparison is withheld. `
    + 'Counts inside the circle are complete.';
}

export type NoteId = 'truncation' | 'delayed' | 'dataset-start' | 'area-coverage' | 'settling';

export interface DataNote {
  id: NoteId;
  title: string;
  body: string;
  /** Changes how the numbers read, so it stays visible rather than folded away. */
  prominent: boolean;
}

export function dataNotes(evidence: EvidenceBundle): DataNote[] {
  const { window, provider } = evidence;
  const notes: DataNote[] = [];
  if (isTruncated(evidence.truncation)) {
    notes.push({
      id: 'truncation',
      title: 'Counts are incomplete',
      body: truncationCopy(evidence.truncation, evidence.recordLimit),
      prominent: true,
    });
  }
  if (isDelayedFeed(window)) {
    notes.push({
      id: 'delayed',
      title: window.latestRecordEpochMs === null
        ? 'No recent records'
        : `Feed is ${dayCount(publicationLagDays(window))} behind`,
      body: delayedFeedCopy(window, provider.cadence),
      prominent: false,
    });
  }
  if (window.datasetStartEpochMs !== null && currentWindowPredatesDataset(window)) {
    notes.push({
      id: 'dataset-start',
      title: 'Partial window',
      body: `This dataset starts ${formatDay(window.datasetStartEpochMs)}, so earlier days of the window have no `
        + 'published records and are not counted as quiet days.',
      prominent: false,
    });
  }
  const coverage = areaCoverageCopy(evidence.areaCoverage, provider.city);
  if (coverage) notes.push({ id: 'area-coverage', title: 'Partly outside city limits', body: coverage, prominent: false });
  const settling = settlingCopy(window);
  if (settling) notes.push({ id: 'settling', title: 'Newest days left out', body: `${settling}.`, prominent: false });
  return notes;
}

/* ── Publisher text ───────────────────────────────────────────────────────── */

const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'w/', 'w/o']);

function isShouting(value: string): boolean {
  return /\p{Lu}/u.test(value) && value === value.toUpperCase();
}

/** `GRAND LARCENY` reads as `Grand larceny`; text already in mixed case is left alone. */
export function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!isShouting(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** `FRONT OF · STREET · MANHATTAN` reads as `Front of · Street · Manhattan`. */
export function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!isShouting(trimmed)) return trimmed;
  let first = true;
  return trimmed.toLowerCase().replace(/[\p{L}\p{N}'/]+/gu, (word) => {
    const keepLower = !first && SMALL_WORDS.has(word);
    first = false;
    if (keepLower) return word;
    // Street suffixes such as `1st` or `100x` keep their letters lowercase.
    if (/^\d/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

/** The publisher's own offense name, falling back to the atlas category. */
export function reportTitle(incident: Incident): string {
  return sentenceCase(incident.rawCategory) || CATEGORY_LABELS[incident.category];
}

const SOURCE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `11:26 PM` */
export function clockLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** `10 PM` */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

/**
 * `{ date: 'Jun 30', year: '2026', time: '11:26 PM' }` from a zone-free publisher timestamp.
 * `time` is `null` when the publisher gave no time of day.
 */
export function reportTime(occurredAt: string, timeKnown: boolean): { date: string; year: string; time: string | null } {
  const match = SOURCE_TIME.exec(occurredAt);
  if (!match) return { date: occurredAt, year: '', time: null };
  const [, year, month, day, hour, minute] = match;
  const date = `${MONTHS[Number(month) - 1]} ${Number(day)}`;
  const time = timeKnown && hour !== undefined ? clockLabel(Number(hour), Number(minute)) : null;
  return { date, year: year!, time };
}

/** Short tick labels for the 24-hour chart. */
export function hourTick(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}
