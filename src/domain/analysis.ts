import type {
  AnalysisResult,
  AreaCoverage,
  CategoryBreakdownItem,
  Coordinates,
  CrimeCategory,
  CrimeGroup,
  DailyActivity,
  EvidenceBand,
  EvidenceConfidence,
  EvidenceTruncation,
  EvidenceWindow,
  GroupBreakdownItem,
  Incident,
  TrendDirection,
  UnavailableReason,
} from '../types';
import { CATEGORY_LABELS, CRIME_GROUPS } from './categories';
import { previousWindowPredatesDataset } from './evidenceWindow';
import { circleAreaSquareKilometers, haversineDistance } from './geo';
import { DAY_MS, isoDate } from './time';

/** The nearby comparator is the annulus from 1× to this multiple of the selected radius. */
export const COMPARISON_RADIUS_MULTIPLIER = 3;
/** The rhythm chart shows at most this many trailing days. */
export const MAX_DAILY_ACTIVITY_DAYS = 30;
/** Below this share of either area inside the jurisdiction, the density comparison is withheld. */
export const MIN_COMPARISON_AREA_SHARE = 0.25;

export interface AnalysisInput {
  incidents: Incident[];
  center: Coordinates;
  radiusMeters: number;
  window: EvidenceWindow;
  activeGroups: readonly CrimeGroup[];
  truncation?: EvidenceTruncation;
  areaCoverage?: AreaCoverage;
}

export const NO_TRUNCATION: EvidenceTruncation = {
  selectedCurrent: false,
  selectedPrevious: false,
  comparison: false,
};

/** Both analysis areas lie entirely inside the provider's jurisdiction. */
export const FULL_AREA_COVERAGE: AreaCoverage = { selected: 1, nearby: 1 };

export function isTruncated(truncation: EvidenceTruncation): boolean {
  return truncation.selectedCurrent || truncation.selectedPrevious || truncation.comparison;
}

/**
 * A trend is only stated when both selected-circle windows are complete: a record budget
 * drops the oldest rows of a window, and a dataset that starts mid-window has no rows before it.
 */
function trendUnavailableReason(window: EvidenceWindow, truncation: EvidenceTruncation): UnavailableReason | null {
  if (truncation.selectedCurrent || truncation.selectedPrevious) return 'record-limit';
  if (previousWindowPredatesDataset(window)) return 'dataset-start';
  return null;
}

function isNightHour(hour: number | null) {
  return hour !== null && (hour >= 22 || hour < 5);
}

export function evidenceBand(relativeActivity: number | null, sample: number): EvidenceBand {
  if (relativeActivity === null || sample < 5) return 'insufficient';
  if (relativeActivity < 0.65) return 'lower';
  if (relativeActivity < 1.25) return 'similar';
  if (relativeActivity < 2) return 'elevated';
  return 'markedly-elevated';
}

export function evidenceConfidence(sample: number, truncated: boolean): EvidenceConfidence {
  if (truncated || sample < 12) return 'low';
  if (sample < 40) return 'medium';
  return 'high';
}

function trendDirection(currentCount: number, previousCount: number, unavailable: boolean): TrendDirection {
  if (unavailable) return 'unavailable';
  if (previousCount === 0) return currentCount > 0 ? 'new' : 'none';
  if (currentCount === previousCount) return 'flat';
  return currentCount > previousCount ? 'up' : 'down';
}

function categoryBreakdown(incidents: Incident[]): CategoryBreakdownItem[] {
  const counts = new Map<CrimeCategory, number>();
  for (const incident of incidents) {
    counts.set(incident.category, (counts.get(incident.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count, share: count / incidents.length }))
    .sort((left, right) => (
      right.count - left.count
      || CATEGORY_LABELS[left.category].localeCompare(CATEGORY_LABELS[right.category])
    ));
}

function groupBreakdown(incidents: Incident[]): GroupBreakdownItem[] {
  return CRIME_GROUPS.map((group) => {
    const count = incidents.filter((incident) => incident.group === group).length;
    return { group, count, share: incidents.length > 0 ? count / incidents.length : 0 };
  });
}

function hourlyActivity(incidents: Incident[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const incident of incidents) {
    if (incident.localHour !== null) hours[incident.localHour]! += 1;
  }
  return hours;
}

function dailyActivity(incidents: Incident[], window: EvidenceWindow): DailyActivity[] {
  const days = Math.min(window.windowDays, MAX_DAILY_ACTIVITY_DAYS);
  const counts = new Map<string, number>();
  for (const incident of incidents) {
    const date = isoDate(incident.occurredAtEpochMs);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = isoDate(window.endEpochMs - (days - index) * DAY_MS);
    return { date, count: counts.get(date) ?? 0 };
  });
}

function weightedSeverity(incidents: Incident[]) {
  return incidents.reduce((sum, incident) => sum + incident.severity, 0);
}

export function analyzeIncidents({
  incidents,
  center,
  radiusMeters,
  window,
  activeGroups,
  truncation = NO_TRUNCATION,
  areaCoverage = FULL_AREA_COVERAGE,
}: AnalysisInput): AnalysisResult {
  const active = new Set(activeGroups);
  const comparisonRadius = radiusMeters * COMPARISON_RADIUS_MULTIPLIER;
  const inCurrent = (epoch: number) => epoch >= window.currentStartEpochMs && epoch < window.endEpochMs;
  const inPrevious = (epoch: number) => epoch >= window.previousStartEpochMs && epoch < window.currentStartEpochMs;

  const candidates = incidents
    .filter((incident) => active.has(incident.group) && Number.isFinite(incident.occurredAtEpochMs))
    .map((incident) => ({ incident, distance: haversineDistance(center, incident.coordinates) }))
    .filter(({ distance }) => distance <= comparisonRadius);

  const currentIncidents: Incident[] = [];
  const previousIncidents: Incident[] = [];
  const nearbyCurrentIncidents: Incident[] = [];
  const mapIncidents: Incident[] = [];
  for (const { incident, distance } of candidates) {
    const epoch = incident.occurredAtEpochMs;
    const inside = distance <= radiusMeters;
    if (inCurrent(epoch)) {
      mapIncidents.push(incident);
      (inside ? currentIncidents : nearbyCurrentIncidents).push(incident);
    } else if (inside && inPrevious(epoch)) {
      previousIncidents.push(incident);
    }
  }
  currentIncidents.sort((left, right) => right.occurredAtEpochMs - left.occurredAtEpochMs);

  // The feed has no records beyond city limits, so only the covered area counts.
  const circleArea = circleAreaSquareKilometers(radiusMeters);
  const innerArea = circleArea * areaCoverage.selected;
  const nearbyArea = (circleAreaSquareKilometers(comparisonRadius) - circleArea) * areaCoverage.nearby;
  const innerWeightedDensity = innerArea > 0 ? weightedSeverity(currentIncidents) / innerArea : 0;
  const nearbyWeightedDensity = nearbyArea > 0 ? weightedSeverity(nearbyCurrentIncidents) / nearbyArea : 0;
  // A truncated comparison query undercounts the annulus and would inflate the ratio; a
  // sliver of covered area makes either density too unstable to compare.
  let comparisonUnavailableReason: UnavailableReason | null = null;
  if (truncation.comparison) comparisonUnavailableReason = 'record-limit';
  else if (Math.min(areaCoverage.selected, areaCoverage.nearby) < MIN_COMPARISON_AREA_SHARE) {
    comparisonUnavailableReason = 'jurisdiction';
  }
  const relativeActivity = !comparisonUnavailableReason && nearbyWeightedDensity > 0
    ? innerWeightedDensity / nearbyWeightedDensity
    : null;

  const currentCount = currentIncidents.length;
  const previousCount = previousIncidents.length;
  const violentCount = currentIncidents.filter((incident) => incident.isViolent).length;
  const nightCount = currentIncidents.filter((incident) => isNightHour(incident.localHour)).length;
  const untimedCount = currentIncidents.filter((incident) => incident.localHour === null).length;
  const timedCount = currentCount - untimedCount;
  const sample = currentCount + nearbyCurrentIncidents.length;
  const unavailableTrend = trendUnavailableReason(window, truncation);

  return {
    currentIncidents,
    previousIncidents,
    nearbyCurrentIncidents,
    mapIncidents,
    currentCount,
    previousCount,
    violentCount,
    nightCount,
    violentShare: currentCount > 0 ? violentCount / currentCount : 0,
    nightShare: timedCount > 0 ? nightCount / timedCount : 0,
    untimedCount,
    trendPercent: !unavailableTrend && previousCount > 0 ? ((currentCount - previousCount) / previousCount) * 100 : null,
    trendDirection: trendDirection(currentCount, previousCount, unavailableTrend !== null),
    trendUnavailableReason: unavailableTrend,
    currentCountIsLowerBound: truncation.selectedCurrent,
    innerWeightedDensity,
    nearbyWeightedDensity,
    relativeActivity,
    comparisonUnavailableReason,
    band: evidenceBand(relativeActivity, sample),
    confidence: evidenceConfidence(sample, isTruncated(truncation)),
    categoryBreakdown: categoryBreakdown(currentIncidents),
    groupBreakdown: groupBreakdown(currentIncidents),
    dailyActivity: dailyActivity(currentIncidents, window),
    hourlyActivity: hourlyActivity(currentIncidents),
    latestObservedAt: currentIncidents[0]?.occurredAt ?? null,
  };
}
