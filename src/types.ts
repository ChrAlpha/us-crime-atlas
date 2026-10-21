export type Coordinates = readonly [longitude: number, latitude: number];

export type CrimeCategory =
  | 'homicide'
  | 'sexual'
  | 'robbery'
  | 'assault'
  | 'burglary'
  | 'theft'
  | 'vehicle'
  | 'weapons'
  | 'other';

export type CrimeGroup = 'violent' | 'property' | 'vehicle' | 'weapons' | 'other';

export type LocationPrecision = 'exact' | 'block' | 'intersection' | 'approximate';

/**
 * A normalized incident row.
 *
 * `occurredAt` is the publisher's local wall-clock time without a zone suffix.
 * `occurredAtEpochMs` encodes that same wall-clock time as if it were UTC, so every
 * provider shares one comparable "local clock" frame regardless of the viewer's zone.
 */
export interface Incident {
  id: string;
  providerId: string;
  occurredAt: string;
  occurredAtEpochMs: number;
  localHour: number | null;
  category: CrimeCategory;
  group: CrimeGroup;
  rawCategory: string;
  description: string;
  locationLabel: string;
  coordinates: Coordinates;
  severity: number;
  isViolent: boolean;
  precision: LocationPrecision;
}

export interface CoverageBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ProviderMeta {
  id: string;
  city: string;
  state: string;
  label: string;
  agency: string;
  datasetName: string;
  endpoint: string;
  sourceUrl: string;
  /** IANA zone of the publisher's local clock. */
  timeZone: string;
  center: Coordinates;
  zoom: number;
  bounds: CoverageBounds;
  cadence: string;
  delayNote: string;
  /**
   * Trailing published days that are still filling in (reviewed from daily counts). The
   * evidence window ends this many days before the newest record's day.
   */
  settlingDays: number;
  /**
   * First day the dataset can contain: an ISO date for annual or "to present" layers,
   * `calendar-year` for year-to-date files that restart every January, or `null` for
   * long-running datasets.
   */
  datasetStart: string | 'calendar-year' | null;
  precision: LocationPrecision;
  precisionNote: string;
  coverageNote: string;
  lastVerified: string;
}

/** A half-open `[startEpochMs, endEpochMs)` range in the provider's local-clock frame. */
export interface IncidentQuery {
  center: Coordinates;
  radiusMeters: number;
  startEpochMs: number;
  endEpochMs: number;
  signal?: AbortSignal | undefined;
}

export interface IncidentBatch {
  incidents: Incident[];
  recordLimit: number;
  truncated: boolean;
  requestUrls: string[];
}

export interface IncidentProvider {
  meta: ProviderMeta;
  /** Latest published occurrence time (local-clock frame), or `null` when the feed has no rows. */
  fetchLatestRecordEpoch(signal?: AbortSignal): Promise<number | null>;
  fetchIncidents(query: IncidentQuery): Promise<IncidentBatch>;
  /** Forgets cached one-off lookups (newest record) so a refresh asks the publisher again. */
  resetCache?(): void;
}

export interface SelectedPlace {
  label: string;
  detail: string;
  coordinates: Coordinates;
}

/**
 * Equal current and previous windows, anchored to the provider's latest published record
 * rather than to "now" so publication lag never reads as quiet days.
 */
export interface EvidenceWindow {
  windowDays: number;
  previousStartEpochMs: number;
  currentStartEpochMs: number;
  /** Exclusive end of the current window, `settlingDays` before the midnight after the latest record. */
  endEpochMs: number;
  latestRecordEpochMs: number | null;
  settlingDays: number;
  /** Whole days between the window end and the end of today in the provider's zone. */
  lagDays: number;
  /** First day the dataset covers, or `null` when it predates any selectable window. */
  datasetStartEpochMs: number | null;
}

/** Which parts of an evidence request hit a record budget, so older rows may be missing. */
export interface EvidenceTruncation {
  /** Current window inside the selected circle. */
  selectedCurrent: boolean;
  /** Previous window inside the selected circle. */
  selectedPrevious: boolean;
  /** Current window across the whole comparison area (the nearby annulus). */
  comparison: boolean;
}

/**
 * Fractions of the analysis areas inside the provider's jurisdiction. The feed has no
 * records beyond city limits, so densities divide by the covered area only.
 */
export interface AreaCoverage {
  /** Share of the selected circle. */
  selected: number;
  /** Share of the nearby annulus. */
  nearby: number;
}

export interface EvidenceBundle {
  provider: ProviderMeta;
  window: EvidenceWindow;
  incidents: Incident[];
  recordLimit: number;
  truncation: EvidenceTruncation;
  areaCoverage: AreaCoverage;
  requestUrls: string[];
  fetchedAt: string;
}

export type EvidenceBand = 'lower' | 'similar' | 'elevated' | 'markedly-elevated' | 'insufficient';

export type EvidenceConfidence = 'low' | 'medium' | 'high';

export interface CategoryBreakdownItem {
  category: CrimeCategory;
  count: number;
  share: number;
}

export interface GroupBreakdownItem {
  group: CrimeGroup;
  count: number;
  share: number;
}

export interface DailyActivity {
  date: string;
  count: number;
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'new' | 'none' | 'unavailable';

/** Why a trend or comparison cannot be stated rather than shown with a biased number. */
export type UnavailableReason = 'record-limit' | 'dataset-start' | 'jurisdiction';

export interface AnalysisResult {
  currentIncidents: Incident[];
  previousIncidents: Incident[];
  nearbyCurrentIncidents: Incident[];
  mapIncidents: Incident[];
  currentCount: number;
  previousCount: number;
  violentCount: number;
  nightCount: number;
  violentShare: number;
  /** Share of selected-area reports with a known time that occurred 10 PM–4:59 AM. */
  nightShare: number;
  /** Selected-area reports published with a date but no time of day. */
  untimedCount: number;
  trendPercent: number | null;
  trendDirection: TrendDirection;
  trendUnavailableReason: UnavailableReason | null;
  /** The selected-circle count may be incomplete because its query reached a record budget. */
  currentCountIsLowerBound: boolean;
  innerWeightedDensity: number;
  nearbyWeightedDensity: number;
  relativeActivity: number | null;
  comparisonUnavailableReason: UnavailableReason | null;
  band: EvidenceBand;
  confidence: EvidenceConfidence;
  categoryBreakdown: CategoryBreakdownItem[];
  /** Selected-area reports per incident group, in `CRIME_GROUPS` order, zero counts included. */
  groupBreakdown: GroupBreakdownItem[];
  dailyActivity: DailyActivity[];
  /** Selected-area reports with a known time, by local hour 0–23. */
  hourlyActivity: number[];
  latestObservedAt: string | null;
}

export type RadiusMeters = 500 | 1000 | 2000;
export type WindowDays = 14 | 30 | 60 | 90;

export interface AtlasState {
  place: SelectedPlace;
  radiusMeters: RadiusMeters;
  windowDays: WindowDays;
  activeGroups: CrimeGroup[];
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
