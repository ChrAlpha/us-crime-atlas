import { NEW_YORK_META } from '../data/providers/socrataCities';
import { analyzeIncidents, FULL_AREA_COVERAGE, NO_TRUNCATION } from '../domain/analysis';
import { categoryGroup, CRIME_GROUPS, isViolentCategory, severityForCategory } from '../domain/categories';
import { computeEvidenceWindow } from '../domain/evidenceWindow';
import type {
  AnalysisResult,
  Coordinates,
  CrimeCategory,
  EvidenceBundle,
  EvidenceTruncation,
  EvidenceWindow,
  Incident,
  IncidentProvider,
  ProviderMeta,
  SelectedPlace,
} from '../types';

/* Shared, deterministic fixtures for the place panel and its parts. */

export const DAY = 86_400_000;
/** Times Square, inside New York City limits. */
export const CENTER: Coordinates = [-73.9855, 40.758];
/** About 1.7 km east of the center: inside the 1–3 km comparison ring of a 1 km circle. */
export const NEARBY: Coordinates = [-73.9655, 40.758];
/** Oct 21, 2026, midday in the provider's local-clock frame. */
export const NOW = Date.UTC(2026, 9, 21, 12);

export const META: ProviderMeta = NEW_YORK_META;

export const PROVIDER: IncidentProvider = {
  meta: META,
  fetchLatestRecordEpoch: async () => null,
  fetchIncidents: async () => ({ incidents: [], recordLimit: 0, truncated: false, requestUrls: [] }),
};

export const PLACE: SelectedPlace = { label: 'Times Square', detail: 'Manhattan · New York City', coordinates: CENTER };

export function evidenceWindow(
  latestRecordEpochMs: number | null,
  settlingDays = 0,
  windowDays = 30,
): EvidenceWindow {
  return computeEvidenceWindow({ windowDays, nowEpochMs: NOW, latestRecordEpochMs, settlingDays });
}

/** Newest record yesterday, two settling days: Sep 19 – Oct 18, 2026, one day behind today. */
export const CURRENT_WINDOW = evidenceWindow(Date.UTC(2026, 9, 20, 18), 2);
/** Newest record today, nothing settling: Sep 22 – Oct 21, 2026, not behind at all. */
export const FRESH_WINDOW = evidenceWindow(Date.UTC(2026, 9, 21, 8), 0);
/** Quarterly-style feed: Jun 1 – Jun 30, 2026, 113 days behind. */
export const DELAYED_WINDOW = evidenceWindow(Date.UTC(2026, 5, 30, 9), 0);
/** A feed with no records in the lookback period. */
export const EMPTY_WINDOW = evidenceWindow(null, 0);

export interface IncidentOptions {
  coordinates?: Coordinates;
  /** Local hour, or `null` for a report published without a time of day. */
  hour?: number | null;
  rawCategory?: string;
  description?: string;
  locationLabel?: string;
}

export function incident(id: string, category: CrimeCategory, epochMs: number, options: IncidentOptions = {}): Incident {
  const hour = options.hour === undefined ? 14 : options.hour;
  const clock = hour === null ? '00:00:00' : `${String(hour).padStart(2, '0')}:30:00`;
  const occurredAt = `${new Date(epochMs).toISOString().slice(0, 10)}T${clock}`;
  return {
    id,
    providerId: META.id,
    occurredAt,
    occurredAtEpochMs: Date.parse(`${occurredAt}Z`),
    localHour: hour,
    category,
    group: categoryGroup(category),
    rawCategory: options.rawCategory ?? category.toUpperCase(),
    description: options.description ?? `${category} on the sidewalk`,
    locationLabel: options.locationLabel ?? `${id} block`,
    coordinates: options.coordinates ?? CENTER,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

/** The last day inside a window, at midnight. */
export function lastDayOf(window: EvidenceWindow): number {
  return window.endEpochMs - DAY;
}

/**
 * Five reports in the circle over five consecutive days ending on the window's last day
 * (two at night), two in the comparison ring, and one in the previous window.
 */
export function incidentsFor(window: EvidenceWindow): Incident[] {
  const lastDay = lastDayOf(window);
  return [
    incident('assault-1', 'assault', lastDay, { hour: 23 }),
    incident('theft-1', 'theft', lastDay - DAY),
    incident('theft-2', 'theft', lastDay - 2 * DAY),
    incident('vehicle-1', 'vehicle', lastDay - 3 * DAY, { hour: 2 }),
    incident('robbery-1', 'robbery', lastDay - 4 * DAY),
    incident('nearby-1', 'theft', lastDay - DAY, { coordinates: NEARBY }),
    incident('nearby-2', 'theft', lastDay - 2 * DAY, { coordinates: NEARBY }),
    incident('previous-1', 'theft', window.currentStartEpochMs - 5 * DAY),
  ];
}

export function truncation(overrides: Partial<EvidenceTruncation> = {}): EvidenceTruncation {
  return { ...NO_TRUNCATION, ...overrides };
}

export function evidenceFor(window: EvidenceWindow = CURRENT_WINDOW, overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    provider: META,
    window,
    incidents: incidentsFor(window),
    recordLimit: 20_000,
    truncation: NO_TRUNCATION,
    areaCoverage: FULL_AREA_COVERAGE,
    requestUrls: [],
    fetchedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

export function analysisFor(evidence: EvidenceBundle, radiusMeters = 1000): AnalysisResult {
  return analyzeIncidents({
    incidents: evidence.incidents,
    center: CENTER,
    radiusMeters,
    window: evidence.window,
    activeGroups: CRIME_GROUPS,
    truncation: evidence.truncation,
    areaCoverage: evidence.areaCoverage,
  });
}

/** `count` thefts in the circle, spread over the window's last 30 days at varied hours. */
export function manyIncidents(count: number, window: EvidenceWindow = CURRENT_WINDOW): Incident[] {
  const lastDay = lastDayOf(window);
  return Array.from({ length: count }, (_, index) => (
    incident(`theft-${index}`, 'theft', lastDay - (index % 30) * DAY, { hour: index % 24 })
  ));
}

/** Stubs an element's box so pointer positions map onto it. */
export function stubBox(element: Element, box: { left: number; width: number; top?: number; height?: number }): void {
  const top = box.top ?? 0;
  const height = box.height ?? 100;
  const rect = {
    left: box.left,
    width: box.width,
    top,
    height,
    right: box.left + box.width,
    bottom: top + height,
    x: box.left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => rect;
}
