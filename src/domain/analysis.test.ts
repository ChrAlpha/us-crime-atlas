import { describe, expect, it } from 'vitest';
import type { AreaCoverage, CrimeCategory, CrimeGroup, EvidenceTruncation, EvidenceWindow, Incident } from '../types';
import {
  analyzeIncidents,
  BAND_COPY,
  COMPARISON_RADIUS_MULTIPLIER,
  evidenceBand,
  evidenceConfidence,
  FULL_AREA_COVERAGE,
  isTruncated,
  MAX_DAILY_ACTIVITY_DAYS,
  MIN_COMPARISON_AREA_SHARE,
  NO_TRUNCATION,
} from './analysis';
import { categoryGroup, CRIME_GROUPS, isViolentCategory, severityForCategory } from './categories';
import { DAY_MS, isoDate, localClockTimestamp } from './time';

const END = Date.parse('2026-08-17T00:00:00Z');
const CENTER = [0, 0] as const;
/** ≈111 m east of the center: inside a 1 km circle. */
const INSIDE = [0.001, 0] as const;
/** ≈1.67 km east: inside the 1–3 km annulus. */
const NEARBY = [0.015, 0] as const;
/** ≈4.4 km east: outside the comparison area. */
const FAR = [0.04, 0] as const;

function windowOf(windowDays: number, endEpochMs = END, datasetStartEpochMs: number | null = null): EvidenceWindow {
  return {
    windowDays,
    endEpochMs,
    currentStartEpochMs: endEpochMs - windowDays * DAY_MS,
    previousStartEpochMs: endEpochMs - 2 * windowDays * DAY_MS,
    latestRecordEpochMs: endEpochMs - 1,
    settlingDays: 0,
    lagDays: 0,
    datasetStartEpochMs,
  };
}

function truncation(overrides: Partial<EvidenceTruncation>): EvidenceTruncation {
  return { ...NO_TRUNCATION, ...overrides };
}

function incident(
  id: string,
  category: CrimeCategory,
  epoch: number,
  coordinates: readonly [number, number],
  localHour: number | null = 12,
): Incident {
  return {
    id,
    providerId: 'test',
    occurredAt: localClockTimestamp(epoch),
    occurredAtEpochMs: epoch,
    localHour,
    category,
    group: categoryGroup(category),
    rawCategory: category.toUpperCase(),
    description: `${category} test`,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

/** An incident `days` (fractional allowed) before the window end. */
function daysBefore(
  id: string,
  category: CrimeCategory,
  days: number,
  coordinates: readonly [number, number],
  localHour: number | null = 12,
) {
  return incident(id, category, END - days * DAY_MS, coordinates, localHour);
}

function analyze(
  incidents: Incident[],
  options: {
    truncation?: EvidenceTruncation;
    areaCoverage?: AreaCoverage;
    windowDays?: number;
    activeGroups?: CrimeGroup[];
    datasetStartEpochMs?: number | null;
  } = {},
) {
  return analyzeIncidents({
    incidents,
    center: CENTER,
    radiusMeters: 1000,
    window: windowOf(options.windowDays ?? 30, END, options.datasetStartEpochMs ?? null),
    activeGroups: options.activeGroups ?? [...CRIME_GROUPS],
    ...(options.truncation === undefined ? {} : { truncation: options.truncation }),
    ...(options.areaCoverage === undefined ? {} : { areaCoverage: options.areaCoverage }),
  });
}

describe('evidence bands and confidence', () => {
  it.each([
    [null, 50, 'insufficient'],
    [3, 4, 'insufficient'],
    [0.64, 5, 'lower'],
    [0.65, 5, 'similar'],
    [1.24, 5, 'similar'],
    [1.25, 5, 'elevated'],
    [1.99, 5, 'elevated'],
    [2, 5, 'markedly-elevated'],
  ] as const)('labels relative activity %s with sample %s as %s', (relative, sample, band) => {
    expect(evidenceBand(relative, sample)).toBe(band);
  });

  it.each([
    [11, false, 'low'],
    [12, false, 'medium'],
    [39, false, 'medium'],
    [40, false, 'high'],
    [400, true, 'low'],
  ] as const)('grades sample %s (truncated %s) as %s', (sample, truncated, confidence) => {
    expect(evidenceConfidence(sample, truncated)).toBe(confidence);
  });

  it('documents every band', () => {
    for (const band of ['lower', 'similar', 'elevated', 'markedly-elevated', 'insufficient'] as const) {
      expect(BAND_COPY[band].label).toBeTruthy();
      expect(BAND_COPY[band].detail).toBeTruthy();
    }
  });
});

describe('analyzeIncidents', () => {
  it('labels strongly concentrated selected-area activity as markedly elevated', () => {
    const inside = Array.from({ length: 4 }, (_, index) => daysBefore(`inside-${index}`, 'assault', index + 1, INSIDE, 23));
    const outside = Array.from({ length: 4 }, (_, index) => daysBefore(`outside-${index}`, 'theft', index + 1, NEARBY));
    const result = analyze([...inside, ...outside]);

    expect(result.currentCount).toBe(4);
    expect(result.nearbyCurrentIncidents).toHaveLength(4);
    expect(result.violentCount).toBe(4);
    expect(result.violentShare).toBe(1);
    expect(result.nightCount).toBe(4);
    expect(result.nightShare).toBe(1);
    expect(result.band).toBe('markedly-elevated');
    expect(result.relativeActivity).toBeGreaterThan(2);
    expect(result.confidence).toBe('low');
    expect(BAND_COPY[result.band].label).toContain('Markedly');
  });

  it('returns similar when inner and annulus weighted density match', () => {
    // The annulus is eight times the circle's area, so eight equal reports there match one inside.
    const inside = [daysBefore('inside', 'theft', 1, INSIDE)];
    const outside = Array.from({ length: 8 }, (_, index) => daysBefore(`outside-${index}`, 'theft', 2, [0.015 + index * 0.0001, 0]));
    const result = analyze([...inside, ...outside]);
    expect(COMPARISON_RADIUS_MULTIPLIER).toBe(3);
    expect(result.relativeActivity).toBeCloseTo(1, 1);
    expect(result.innerWeightedDensity).toBeCloseTo(1.3 / Math.PI, 6);
    expect(result.nearbyWeightedDensity).toBeCloseTo((8 * 1.3) / (8 * Math.PI), 6);
    expect(result.band).toBe('similar');
  });

  it('returns lower when the surrounding annulus has greater density', () => {
    const inside = [daysBefore('inside', 'theft', 1, INSIDE)];
    const outside = Array.from({ length: 16 }, (_, index) => daysBefore(`outside-${index}`, 'theft', 2, [0.015 + index * 0.00005, 0]));
    const result = analyze([...inside, ...outside]);
    expect(result.relativeActivity).toBeCloseTo(0.5, 1);
    expect(result.band).toBe('lower');
    expect(result.confidence).toBe('medium');
  });

  it('uses insufficient evidence and low confidence for tiny or truncated samples', () => {
    const tiny = analyze([daysBefore('inside', 'robbery', 1, INSIDE), daysBefore('outside', 'theft', 1, NEARBY)]);
    expect(tiny.band).toBe('insufficient');
    expect(tiny.confidence).toBe('low');

    const many = Array.from({ length: 45 }, (_, index) => daysBefore(`many-${index}`, 'theft', 1, index < 5 ? INSIDE : NEARBY));
    expect(analyze(many).confidence).toBe('high');
    expect(analyze(many, { truncation: NO_TRUNCATION }).confidence).toBe('high');
    for (const flag of ['selectedCurrent', 'selectedPrevious', 'comparison'] as const) {
      expect(analyze(many, { truncation: truncation({ [flag]: true }) }).confidence).toBe('low');
    }
  });

  it('treats both windows as half-open and counts previous reports only inside the circle', () => {
    const window = windowOf(30);
    const result = analyze([
      incident('at-end', 'theft', window.endEpochMs, INSIDE),
      incident('just-before-end', 'theft', window.endEpochMs - 1, INSIDE),
      incident('at-current-start', 'theft', window.currentStartEpochMs, INSIDE),
      incident('just-before-current', 'theft', window.currentStartEpochMs - 1, INSIDE),
      incident('at-previous-start', 'theft', window.previousStartEpochMs, INSIDE),
      incident('just-before-previous', 'theft', window.previousStartEpochMs - 1, INSIDE),
      incident('previous-nearby', 'theft', window.currentStartEpochMs - DAY_MS, NEARBY),
      incident('current-nearby', 'theft', window.endEpochMs - DAY_MS, NEARBY),
    ]);

    expect(result.currentIncidents.map((item) => item.id)).toEqual(['just-before-end', 'at-current-start']);
    expect(result.previousIncidents.map((item) => item.id).sort()).toEqual(['at-previous-start', 'just-before-current']);
    expect(result.nearbyCurrentIncidents.map((item) => item.id)).toEqual(['current-nearby']);
    expect(result.mapIncidents.map((item) => item.id).sort()).toEqual(['at-current-start', 'current-nearby', 'just-before-end']);
  });

  it('compares non-overlapping equal windows and reports a falling trend', () => {
    const result = analyze([
      daysBefore('current', 'theft', 2, INSIDE),
      daysBefore('previous-1', 'theft', 31, INSIDE),
      daysBefore('previous-2', 'robbery', 45, INSIDE),
      daysBefore('too-old', 'theft', 61, INSIDE),
      daysBefore('too-far', 'theft', 2, FAR),
    ]);
    expect(result.currentCount).toBe(1);
    expect(result.previousCount).toBe(2);
    expect(result.trendDirection).toBe('down');
    expect(result.trendPercent).toBe(-50);
    expect(result.mapIncidents).toHaveLength(1);
  });

  it('reports a rising trend', () => {
    const result = analyze([
      daysBefore('current-1', 'theft', 1, INSIDE),
      daysBefore('current-2', 'theft', 2, INSIDE),
      daysBefore('current-3', 'theft', 3, INSIDE),
      daysBefore('previous', 'theft', 40, INSIDE),
    ]);
    expect(result.trendDirection).toBe('up');
    expect(result.trendPercent).toBe(200);
  });

  it('returns none, new and flat trends and a null comparison where appropriate', () => {
    const empty = analyze([]);
    expect(empty.trendDirection).toBe('none');
    expect(empty.trendPercent).toBeNull();
    expect(empty.relativeActivity).toBeNull();
    expect(empty.latestObservedAt).toBeNull();
    expect(empty.violentShare).toBe(0);
    expect(empty.nightShare).toBe(0);
    expect(empty.categoryBreakdown).toEqual([]);

    expect(analyze([daysBefore('current', 'theft', 1, INSIDE)]).trendDirection).toBe('new');

    const flat = analyze([
      daysBefore('current', 'other', 1, INSIDE),
      daysBefore('previous', 'other', 31, INSIDE),
      ...Array.from({ length: 8 }, (_, index) => daysBefore(`outer-${index}`, 'other', 1, [0.015, index * 0.0001])),
    ]);
    expect(flat.trendDirection).toBe('flat');
    expect(flat.trendPercent).toBe(0);
  });

  it('counts 10 PM through 4:59 AM as night and leaves unknown hours out of the share', () => {
    const hours = [21, 22, 23, 0, 4, 5, null, null];
    const result = analyze(hours.map((hour, index) => daysBefore(`hour-${index}`, 'theft', 1, INSIDE, hour)));
    expect(result.nightCount).toBe(4);
    expect(result.untimedCount).toBe(2);
    expect(result.nightShare).toBeCloseTo(4 / 6, 10);
  });

  it('reports no night share when no selected-area report has a time', () => {
    const result = analyze([daysBefore('date-only', 'theft', 1, INSIDE, null), daysBefore('nearby', 'theft', 1, NEARBY, 23)]);
    expect(result.untimedCount).toBe(1);
    expect(result.nightCount).toBe(0);
    expect(result.nightShare).toBe(0);
    expect(analyze([]).untimedCount).toBe(0);
  });

  it('drops inactive groups and unreadable timestamps everywhere', () => {
    const result = analyze([
      daysBefore('robbery', 'robbery', 1, INSIDE),
      daysBefore('vehicle', 'vehicle', 1, INSIDE),
      daysBefore('vehicle-nearby', 'vehicle', 1, NEARBY),
      daysBefore('vehicle-previous', 'vehicle', 40, INSIDE),
      { ...daysBefore('invalid-time', 'theft', 1, INSIDE), occurredAtEpochMs: Number.NaN },
    ], { activeGroups: ['violent', 'property'] });
    expect(result.currentIncidents.map((item) => item.id)).toEqual(['robbery']);
    expect(result.nearbyCurrentIncidents).toEqual([]);
    expect(result.previousCount).toBe(0);
    expect(result.mapIncidents.map((item) => item.id)).toEqual(['robbery']);
  });

  it('sorts current reports newest first and exposes the latest observation', () => {
    const result = analyze([
      daysBefore('older', 'theft', 5, INSIDE),
      daysBefore('newest', 'theft', 0.5, INSIDE),
      daysBefore('middle', 'theft', 2, INSIDE),
    ]);
    expect(result.currentIncidents.map((item) => item.id)).toEqual(['newest', 'middle', 'older']);
    expect(result.latestObservedAt).toBe(localClockTimestamp(END - 0.5 * DAY_MS));
  });

  it('orders category composition by count, then by label', () => {
    const result = analyze([
      daysBefore('robbery', 'robbery', 1, INSIDE),
      daysBefore('assault', 'assault', 1, INSIDE),
      daysBefore('theft-1', 'theft', 1, INSIDE),
      daysBefore('theft-2', 'theft', 2, INSIDE),
    ]);
    expect(result.categoryBreakdown).toEqual([
      { category: 'theft', count: 2, share: 0.5 },
      { category: 'assault', count: 1, share: 0.25 },
      { category: 'robbery', count: 1, share: 0.25 },
    ]);
  });

  it('reports zero densities and no comparison for a degenerate zero radius', () => {
    const result = analyzeIncidents({
      incidents: [incident('at-center', 'theft', END - DAY_MS, CENTER)],
      center: CENTER,
      radiusMeters: 0,
      window: windowOf(30),
      activeGroups: CRIME_GROUPS,
    });
    expect(result.currentCount).toBe(1);
    expect(result.innerWeightedDensity).toBe(0);
    expect(result.nearbyWeightedDensity).toBe(0);
    expect(result.relativeActivity).toBeNull();
    expect(result.band).toBe('insufficient');
  });

  it('aligns the daily rhythm with the window end and caps it at thirty days', () => {
    const twoWeeks = analyze([
      daysBefore('last-day', 'theft', 0.25, INSIDE),
      daysBefore('last-day-2', 'theft', 0.75, INSIDE),
      daysBefore('first-day', 'theft', 13.5, INSIDE),
    ], { windowDays: 14 });
    expect(twoWeeks.dailyActivity).toHaveLength(14);
    expect(twoWeeks.dailyActivity[0]).toEqual({ date: isoDate(END - 14 * DAY_MS), count: 1 });
    expect(twoWeeks.dailyActivity.at(-1)).toEqual({ date: isoDate(END - DAY_MS), count: 2 });
    expect(twoWeeks.dailyActivity.filter((day) => day.count === 0)).toHaveLength(12);

    const quarter = analyze([daysBefore('early', 'theft', 80, INSIDE)], { windowDays: 90 });
    expect(quarter.currentCount).toBe(1);
    expect(quarter.dailyActivity).toHaveLength(MAX_DAILY_ACTIVITY_DAYS);
    expect(quarter.dailyActivity[0]?.date).toBe(isoDate(END - 30 * DAY_MS));
    expect(quarter.dailyActivity.every((day) => day.count === 0)).toBe(true);
  });
});

describe('truncation and dataset limits', () => {
  const trendSample = () => [
    daysBefore('current-1', 'theft', 1, INSIDE),
    daysBefore('current-2', 'theft', 2, INSIDE),
    daysBefore('previous', 'theft', 40, INSIDE),
    ...Array.from({ length: 8 }, (_, index) => daysBefore(`outer-${index}`, 'theft', 1, [0.015, index * 0.0001])),
  ];

  it('recognises any truncated query', () => {
    expect(isTruncated(NO_TRUNCATION)).toBe(false);
    expect(isTruncated(truncation({ selectedCurrent: true }))).toBe(true);
    expect(isTruncated(truncation({ selectedPrevious: true }))).toBe(true);
    expect(isTruncated(truncation({ comparison: true }))).toBe(true);
  });

  it('states the trend, comparison and exact count when nothing was truncated', () => {
    const result = analyze(trendSample(), { truncation: NO_TRUNCATION });
    expect(result.trendDirection).toBe('up');
    expect(result.trendPercent).toBe(100);
    expect(result.trendUnavailableReason).toBeNull();
    expect(result.comparisonUnavailableReason).toBeNull();
    expect(result.currentCountIsLowerBound).toBe(false);
    expect(result.relativeActivity).not.toBeNull();
  });

  it.each(['selectedCurrent', 'selectedPrevious'] as const)('withholds the trend when the %s query is truncated', (flag) => {
    const result = analyze(trendSample(), { truncation: truncation({ [flag]: true }) });
    expect(result.trendDirection).toBe('unavailable');
    expect(result.trendUnavailableReason).toBe('record-limit');
    expect(result.trendPercent).toBeNull();
    expect(result.currentCount).toBe(2);
    expect(result.previousCount).toBe(1);
    // The nearby comparison only depends on the comparison query.
    expect(result.comparisonUnavailableReason).toBeNull();
    expect(result.relativeActivity).not.toBeNull();
  });

  it('marks the current count as a lower bound only when the selected current query is truncated', () => {
    expect(analyze(trendSample(), { truncation: truncation({ selectedCurrent: true }) }).currentCountIsLowerBound).toBe(true);
    expect(analyze(trendSample(), { truncation: truncation({ selectedPrevious: true }) }).currentCountIsLowerBound).toBe(false);
    expect(analyze(trendSample(), { truncation: truncation({ comparison: true }) }).currentCountIsLowerBound).toBe(false);
  });

  it('withholds the nearby comparison when the comparison query is truncated, but keeps the trend', () => {
    const result = analyze(trendSample(), { truncation: truncation({ comparison: true }) });
    expect(result.relativeActivity).toBeNull();
    expect(result.comparisonUnavailableReason).toBe('record-limit');
    expect(result.band).toBe('insufficient');
    expect(result.confidence).toBe('low');
    expect(result.nearbyWeightedDensity).toBeGreaterThan(0);
    expect(result.trendDirection).toBe('up');
    expect(result.trendUnavailableReason).toBeNull();
  });

  it('withholds the trend when the previous window predates the dataset', () => {
    const window = windowOf(30);
    const result = analyze(trendSample(), { datasetStartEpochMs: window.previousStartEpochMs + DAY_MS });
    expect(result.trendDirection).toBe('unavailable');
    expect(result.trendUnavailableReason).toBe('dataset-start');
    expect(result.trendPercent).toBeNull();
    expect(result.relativeActivity).not.toBeNull();
  });

  it('keeps the trend when the dataset starts exactly at the previous window', () => {
    const window = windowOf(30);
    const result = analyze(trendSample(), { datasetStartEpochMs: window.previousStartEpochMs });
    expect(result.trendDirection).toBe('up');
    expect(result.trendUnavailableReason).toBeNull();
  });

  it('prefers the record-limit reason over the dataset start', () => {
    const window = windowOf(30);
    const result = analyze(trendSample(), {
      datasetStartEpochMs: window.currentStartEpochMs,
      truncation: truncation({ selectedPrevious: true }),
    });
    expect(result.trendUnavailableReason).toBe('record-limit');
  });

  it('withholds the trend even when both windows are empty', () => {
    const result = analyze([], { truncation: truncation({ selectedCurrent: true }) });
    expect(result.trendDirection).toBe('unavailable');
    expect(result.trendPercent).toBeNull();
  });
});

describe('jurisdiction area coverage', () => {
  // One theft inside and eight in the annulus: equal densities over the full areas.
  const sample = () => [
    daysBefore('inside', 'theft', 1, INSIDE),
    daysBefore('previous', 'theft', 40, INSIDE),
    ...Array.from({ length: 8 }, (_, index) => daysBefore(`outer-${index}`, 'theft', 2, [0.015 + index * 0.0001, 0])),
  ];

  it('covers the whole area by default', () => {
    expect(FULL_AREA_COVERAGE).toEqual({ selected: 1, nearby: 1 });
    expect(analyze(sample())).toEqual(analyze(sample(), { areaCoverage: FULL_AREA_COVERAGE }));
  });

  it('divides each density by the area inside city limits only', () => {
    const full = analyze(sample());
    const partial = analyze(sample(), { areaCoverage: { selected: 0.8, nearby: 0.5 } });
    expect(partial.innerWeightedDensity).toBeCloseTo(full.innerWeightedDensity / 0.8, 10);
    expect(partial.nearbyWeightedDensity).toBeCloseTo(full.nearbyWeightedDensity / 0.5, 10);
    expect(partial.relativeActivity).toBeCloseTo((full.relativeActivity ?? Number.NaN) * (0.5 / 0.8), 10);
    expect(full.band).toBe('similar');
    expect(partial.band).toBe('lower');
    expect(partial.comparisonUnavailableReason).toBeNull();
  });

  it('leaves counts, shares and the trend unchanged', () => {
    const full = analyze(sample());
    const partial = analyze(sample(), { areaCoverage: { selected: 0.3, nearby: 0.4 } });
    expect(partial.currentCount).toBe(full.currentCount);
    expect(partial.previousCount).toBe(full.previousCount);
    expect(partial.nearbyCurrentIncidents).toEqual(full.nearbyCurrentIncidents);
    expect(partial.trendDirection).toBe(full.trendDirection);
    expect(partial.trendPercent).toBe(full.trendPercent);
    expect(partial.trendUnavailableReason).toBeNull();
    expect(partial.confidence).toBe(full.confidence);
  });

  it.each([
    ['the selected circle', { selected: 0.249, nearby: 1 }],
    ['the nearby area', { selected: 1, nearby: 0.249 }],
    ['both areas', { selected: 0.1, nearby: 0 }],
  ])('withholds the comparison when too little of %s lies inside the city', (_label, areaCoverage) => {
    const result = analyze(sample(), { areaCoverage });
    expect(result.comparisonUnavailableReason).toBe('jurisdiction');
    expect(result.relativeActivity).toBeNull();
    expect(result.band).toBe('insufficient');
    expect(result.trendDirection).toBe('flat');
    expect(result.trendUnavailableReason).toBeNull();
  });

  it('keeps the comparison at exactly the minimum covered share', () => {
    expect(MIN_COMPARISON_AREA_SHARE).toBe(0.25);
    const result = analyze(sample(), { areaCoverage: { selected: 0.25, nearby: 0.25 } });
    expect(result.comparisonUnavailableReason).toBeNull();
    expect(result.relativeActivity).toBeCloseTo(analyze(sample()).relativeActivity ?? Number.NaN, 10);
  });

  it('reports the record limit ahead of thin coverage', () => {
    const result = analyze(sample(), {
      areaCoverage: { selected: 0.1, nearby: 0.1 },
      truncation: truncation({ comparison: true }),
    });
    expect(result.comparisonUnavailableReason).toBe('record-limit');
  });

  it('yields zero densities when no area is covered at all', () => {
    const result = analyze(sample(), { areaCoverage: { selected: 0, nearby: 0 } });
    expect(result.innerWeightedDensity).toBe(0);
    expect(result.nearbyWeightedDensity).toBe(0);
    expect(result.relativeActivity).toBeNull();
  });
});
