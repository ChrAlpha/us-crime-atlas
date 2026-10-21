import { describe, expect, it } from 'vitest';
import { LATEST_RECORD_LOOKBACK_DAYS } from '../data/providers/shared';
import type {
  AnalysisResult,
  CrimeCategory,
  EvidenceBundle,
  EvidenceWindow,
  Incident,
  ProviderMeta,
  UnavailableReason,
} from '../types';
import { analyzeIncidents, evidenceBand, NO_TRUNCATION } from './analysis';
import { CATEGORY_LABELS, categoryGroup, CRIME_GROUPS, isViolentCategory, severityForCategory } from './categories';
import { computeEvidenceWindow, type EvidenceWindowInput } from './evidenceWindow';
import {
  areaCoverageCopy,
  BAND_LABELS,
  clockLabel,
  comparisonRingLabel,
  dataNotes,
  dayCount,
  delayedFeedCopy,
  finding,
  formatCount,
  formatRatio,
  hourLabel,
  hourTick,
  methodLine,
  percent,
  radiusLabel,
  reportTime,
  reportTitle,
  SCALE_BANDS,
  SCALE_MAX,
  SCALE_MIN,
  scalePosition,
  sentenceCase,
  settlingCopy,
  titleCase,
  trendCopy,
  truncationCopy,
  windowRangeLabel,
} from './presentation';
import { DAY_MS, localClockTimestamp } from './time';

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
const NOW = Date.parse('2026-10-21T12:00:00Z');
const LATEST = Date.parse('2026-10-20T23:00:00Z');
const CENTER = [0, 0] as const;
/** ≈111 m east of the center: inside a 1 km circle. */
const INSIDE = [0.001, 0] as const;
/** ≈1.67 km east: inside the 1–3 km comparison ring. */
const NEARBY = [0.015, 0] as const;

const PROVIDER: ProviderMeta = {
  id: 'test',
  city: 'Chicago',
  state: 'IL',
  label: 'Chicago, Illinois',
  agency: 'Chicago Police Department',
  datasetName: 'Crimes',
  endpoint: 'https://example.test/crimes.json',
  sourceUrl: 'https://example.test/crimes',
  timeZone: 'America/Chicago',
  center: [-87.6298, 41.8837],
  zoom: 11,
  bounds: { west: -88, south: 41.6, east: -87.5, north: 42.1 },
  cadence: 'Updated daily',
  delayNote: 'Seven-day hold.',
  settlingDays: 0,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Block level.',
  coverageNote: 'Preliminary.',
  lastVerified: '2026-10-21',
};

/** By default the newest record is from yesterday: a fresh daily feed with no settling days. */
function windowOf(overrides: Partial<EvidenceWindowInput> = {}): EvidenceWindow {
  return computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs: LATEST, ...overrides });
}

function incident(id: string, category: CrimeCategory, coordinates: readonly [number, number], rawCategory = ''): Incident {
  const epoch = LATEST - DAY_MS;
  return {
    id,
    providerId: 'test',
    occurredAt: localClockTimestamp(epoch),
    occurredAtEpochMs: epoch,
    localHour: 12,
    category,
    group: categoryGroup(category),
    rawCategory,
    description: category,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

function many(prefix: string, count: number, category: CrimeCategory, coordinates: readonly [number, number]) {
  return Array.from({ length: count }, (_, index) => (
    incident(`${prefix}-${index}`, category, [coordinates[0] + index * 0.00005, coordinates[1]])
  ));
}

function analyze(incidents: Incident[], options: Partial<Parameters<typeof analyzeIncidents>[0]> = {}): AnalysisResult {
  return analyzeIncidents({
    incidents,
    center: CENTER,
    radiusMeters: 1000,
    window: windowOf(),
    activeGroups: CRIME_GROUPS,
    ...options,
  });
}

function analysisOf(overrides: Partial<AnalysisResult>): AnalysisResult {
  return { ...analyze([]), ...overrides };
}

function bundleOf(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    provider: PROVIDER,
    window: windowOf(),
    incidents: [],
    recordLimit: 20_000,
    truncation: NO_TRUNCATION,
    areaCoverage: { selected: 1, nearby: 1 },
    requestUrls: [],
    fetchedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('number and unit formatting', () => {
  it.each([
    [500, '500 m'],
    [999, '999 m'],
    [1000, '1 km'],
    [1500, '1.5 km'],
    [2000, '2 km'],
  ])('labels a %s m radius as %s', (radius, label) => {
    expect(radiusLabel(radius)).toBe(label);
  });

  it('pluralizes day counts', () => {
    expect(dayCount(0)).toBe('0 days');
    expect(dayCount(1)).toBe('1 day');
    expect(dayCount(30)).toBe('30 days');
  });

  it('groups thousands and marks lower bounds with a plus', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1602)).toBe('1,602');
    expect(formatCount(1602, false)).toBe('1,602');
    expect(formatCount(20_000, true)).toBe('20,000+');
  });

  it.each([
    [0, '0%'],
    [0.0001, '<1%'],
    [0.0049, '<1%'],
    [0.005, '1%'],
    [0.19, '19%'],
    [0.666, '67%'],
    [0.994, '99%'],
    [0.996, '>99%'],
    [1, '100%'],
  ])('formats share %s as %s', (share, label) => {
    expect(percent(share)).toBe(label);
  });

  it.each([
    [0.5, '0.5×'],
    [1, '1.0×'],
    [4.94, '4.9×'],
    [9.94, '9.9×'],
    [9.96, '10×'],
    [0, '0×'],
    [0.04, '<0.1×'],
    [0.05, '0.1×'],
    [10, '10×'],
    [12.4, '12×'],
    [22.77, '23×'],
  ])('formats ratio %s as %s', (ratio, label) => {
    expect(formatRatio(ratio)).toBe(label);
  });

  it('labels the comparison ring compactly in whole kilometres and in mixed units otherwise', () => {
    expect(comparisonRingLabel(1000)).toBe('1–3 km');
    expect(comparisonRingLabel(2000)).toBe('2–6 km');
    expect(comparisonRingLabel(500)).toBe('500 m–1.5 km');
    expect(comparisonRingLabel(1500)).toBe('1.5 km–4.5 km');
  });

  it('labels the window with its first and last included days', () => {
    expect(windowRangeLabel(windowOf())).toBe('Sep 21 – Oct 20, 2026');
    // Two settling days end the window two days earlier.
    expect(windowRangeLabel(windowOf({ settlingDays: 2 }))).toBe('Sep 19 – Oct 18, 2026');
    // A window that spans New Year names both years.
    const newYear = windowOf({ nowEpochMs: day('2026-01-12'), latestRecordEpochMs: day('2026-01-09') });
    expect(windowRangeLabel(newYear)).toBe('Dec 11, 2025 – Jan 9, 2026');
  });
});

describe('finding', () => {
  it('names every band', () => {
    expect(BAND_LABELS).toEqual({
      lower: 'Lower',
      similar: 'Similar',
      elevated: 'Higher',
      'markedly-elevated': 'Much higher',
      insufficient: 'Not enough data',
    });
  });

  it.each<[UnavailableReason, RegExp]>([
    ['record-limit', /more reports than one request can return/],
    ['dataset-start', /dataset does not cover the whole window/],
    ['jurisdiction', /inside city limits/],
  ])('withholds the comparison for the %s reason', (reason, explanation) => {
    const result = finding(analysisOf({ comparisonUnavailableReason: reason, relativeActivity: null, band: 'insufficient' }));
    expect(result).toEqual({
      headline: 'No fair comparison with the surrounding area',
      reason: expect.stringMatching(explanation),
      ratio: null,
      band: 'insufficient',
    });
  });

  it('withholds the comparison from a truncated comparison query even with plenty of reports', () => {
    const incidents = [...many('inside', 6, 'theft', INSIDE), ...many('nearby', 20, 'theft', NEARBY)];
    const analysis = analyze(incidents, { truncation: { ...NO_TRUNCATION, comparison: true } });
    expect(finding(analysis)).toMatchObject({
      headline: 'No fair comparison with the surrounding area',
      reason: 'The surrounding area has more reports than one request can return, so its rate would be understated.',
      ratio: null,
    });
  });

  it('withholds the comparison when too little of the area lies inside the city', () => {
    const incidents = [...many('inside', 6, 'theft', INSIDE), ...many('nearby', 20, 'theft', NEARBY)];
    const analysis = analyze(incidents, { areaCoverage: { selected: 0.2, nearby: 1 } });
    expect(finding(analysis).reason).toBe(
      'Too little of the circle or the surrounding area lies inside city limits for a fair comparison.',
    );
  });

  it('asks for more data when fewer than five reports fall in and around the circle', () => {
    const analysis = analyze([...many('inside', 2, 'theft', INSIDE), ...many('nearby', 2, 'theft', NEARBY)]);
    expect(analysis.band).toBe('insufficient');
    expect(finding(analysis)).toEqual({
      headline: 'Too few reports for a fair comparison',
      reason: 'Fewer than five matching reports in and around the circle over these dates.',
      ratio: null,
      band: 'insufficient',
    });
    // Four reports inside and none around: still too few to blame the empty surroundings.
    expect(finding(analyze(many('inside', 4, 'theft', INSIDE))).reason).toBe(
      'Fewer than five matching reports in and around the circle over these dates.',
    );
  });

  it('explains an empty surrounding area once the circle itself has enough reports', () => {
    const analysis = analyze(many('inside', 5, 'theft', INSIDE));
    expect(analysis.nearbyCurrentIncidents).toEqual([]);
    expect(analysis.relativeActivity).toBeNull();
    expect(finding(analysis)).toEqual({
      headline: 'Too few reports for a fair comparison',
      reason: 'The surrounding area had no matching reports to compare against.',
      ratio: null,
      band: 'insufficient',
    });
  });

  it('treats a missing ratio as insufficient whatever the band says', () => {
    expect(finding(analysisOf({ band: 'similar', relativeActivity: null }))).toMatchObject({
      headline: 'Too few reports for a fair comparison',
      ratio: null,
      band: 'insufficient',
    });
  });

  it('states a lower rate as a percentage', () => {
    // One theft inside and sixteen in the eight-times-larger ring: half the density.
    const analysis = analyze([incident('inside', 'theft', INSIDE), ...many('nearby', 16, 'theft', NEARBY)]);
    expect(analysis.band).toBe('lower');
    expect(finding(analysis)).toEqual({
      headline: '50% fewer reports per km² than the surrounding area',
      reason: null,
      ratio: analysis.relativeActivity,
      band: 'lower',
    });
    expect(finding(analysisOf({ band: 'lower', relativeActivity: 0.004 })).headline).toBe(
      '99% fewer reports per km² than the surrounding area',
    );
    expect(finding(analysisOf({ band: 'lower', relativeActivity: 0 })).headline).toBe(
      'No matching reports in the circle, though the surrounding area had some',
    );
  });

  it('states a similar rate without a number', () => {
    const analysis = analyze([incident('inside', 'theft', INSIDE), ...many('nearby', 8, 'theft', NEARBY)]);
    expect(analysis.band).toBe('similar');
    expect(finding(analysis)).toEqual({
      headline: 'About as many reports per km² as the surrounding area',
      reason: null,
      ratio: analysis.relativeActivity,
      band: 'similar',
    });
  });

  it.each([
    ['elevated', 1.5, '1.5× as many reports per km² as the surrounding area'],
    ['markedly-elevated', 4.94, '4.9× as many reports per km² as the surrounding area'],
    ['markedly-elevated', 12.4, '12× as many reports per km² as the surrounding area'],
  ] as const)('states a %s rate of %s as a multiple', (band, ratio, headline) => {
    expect(finding(analysisOf({ band, relativeActivity: ratio }))).toEqual({ headline, reason: null, ratio, band });
  });

  it('states a realistic concentrated rate as a multiple', () => {
    const analysis = analyze([...many('inside', 4, 'theft', INSIDE), ...many('nearby', 4, 'theft', NEARBY)]);
    expect(analysis.band).toBe('markedly-elevated');
    expect(finding(analysis).headline).toBe('8.0× as many reports per km² as the surrounding area');
  });
});

describe('comparison scale', () => {
  it('places ratios on a logarithmic ¼× to 4× scale with 1× in the middle', () => {
    expect(SCALE_MIN).toBe(0.25);
    expect(SCALE_MAX).toBe(4);
    expect(scalePosition(1)).toBe(0.5);
    expect(scalePosition(0.25)).toBe(0);
    expect(scalePosition(4)).toBe(1);
    expect(scalePosition(0.5)).toBeCloseTo(0.25, 10);
    expect(scalePosition(2)).toBeCloseTo(0.75, 10);
  });

  it('clamps ratios beyond either end', () => {
    expect(scalePosition(0.1)).toBe(0);
    expect(scalePosition(0)).toBe(0);
    expect(scalePosition(10)).toBe(1);
    expect(scalePosition(1000)).toBe(1);
  });

  it('spans the scale with contiguous bands in order', () => {
    expect(SCALE_BANDS.map((step) => step.band)).toEqual(['lower', 'similar', 'elevated', 'markedly-elevated']);
    expect(SCALE_BANDS[0]?.from).toBe(SCALE_MIN);
    expect(SCALE_BANDS.at(-1)?.to).toBe(SCALE_MAX);
    for (let index = 1; index < SCALE_BANDS.length; index += 1) {
      expect(SCALE_BANDS[index]?.from).toBe(SCALE_BANDS[index - 1]?.to);
    }
  });

  it('puts band edges exactly where evidenceBand switches bands', () => {
    for (const [index, step] of SCALE_BANDS.entries()) {
      expect(evidenceBand(step.from, 5)).toBe(step.band);
      expect(evidenceBand(step.to - 1e-9, 5)).toBe(step.band);
      const next = SCALE_BANDS[index + 1];
      if (next) expect(evidenceBand(step.to, 5)).toBe(next.band);
    }
  });

  it('describes the method with the radius, ring and dates', () => {
    expect(methodLine(1000, windowOf())).toBe(
      'Severity-weighted, 1 km circle vs. the 1–3 km ring, Sep 21 – Oct 20, 2026. Not a safety rating.',
    );
    expect(methodLine(500, windowOf({ windowDays: 14 }))).toBe(
      'Severity-weighted, 500 m circle vs. the 500 m–1.5 km ring, Oct 7 – Oct 20, 2026. Not a safety rating.',
    );
  });
});

describe('trendCopy', () => {
  const window = windowOf();

  it('explains why a trend is unavailable', () => {
    expect(trendCopy(analysisOf({ trendDirection: 'unavailable', trendUnavailableReason: 'dataset-start' }), window))
      .toBe('No trend: the dataset starts mid-way');
    expect(trendCopy(analysisOf({ trendDirection: 'unavailable', trendUnavailableReason: 'record-limit' }), window))
      .toBe('No trend: a request hit its record limit');
  });

  it('withholds the trend of a realistic truncated circle query', () => {
    const analysis = analyze(many('inside', 3, 'theft', INSIDE), { truncation: { ...NO_TRUNCATION, selectedPrevious: true } });
    expect(trendCopy(analysis, window)).toBe('No trend: a request hit its record limit');
  });

  it('describes empty and new activity against the previous window', () => {
    expect(trendCopy(analyze([]), window)).toBe('None in the previous 30 days either');
    expect(trendCopy(analyze([incident('new', 'theft', INSIDE)]), window)).toBe('None in the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'none' }), windowOf({ windowDays: 14 })))
      .toBe('None in the previous 14 days either');
  });

  it('describes rising and falling counts as whole percentages', () => {
    expect(trendCopy(analysisOf({ trendDirection: 'up', trendPercent: 100 }), window)).toBe('100% more than the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'down', trendPercent: -50 }), window)).toBe('50% fewer than the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'down', trendPercent: -33.4 }), window)).toBe('33% fewer than the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'up', trendPercent: 0.5 }), window)).toBe('1% more than the previous 30 days');
  });

  it('calls flat counts and changes that round to zero the same', () => {
    expect(trendCopy(analysisOf({ trendDirection: 'flat', trendPercent: 0 }), window)).toBe('Same as the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'up', trendPercent: 0.25 }), window)).toBe('Same as the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'down', trendPercent: -0.4 }), window)).toBe('Same as the previous 30 days');
    expect(trendCopy(analysisOf({ trendDirection: 'up', trendPercent: null }), window)).toBe('Same as the previous 30 days');
  });
});

describe('feed timing copy', () => {
  it('says when nothing was published in the lookback period', () => {
    const window = windowOf({ latestRecordEpochMs: null });
    expect(delayedFeedCopy(window, 'Published quarterly')).toBe(
      `No records were published in the last ${LATEST_RECORD_LOOKBACK_DAYS} days. Published quarterly.`,
    );
  });

  it('names the newest record and the window end when no days are settling', () => {
    const window = windowOf({ latestRecordEpochMs: Date.parse('2026-10-10T08:00:00Z') });
    expect(delayedFeedCopy(window, 'Updated daily')).toBe(
      'The newest published record is from Oct 10, 2026. Updated daily. The window ends Oct 10, 2026. '
        + 'Days the publisher has not released yet are never counted as quiet days.',
    );
  });

  it('explains one or several settling days', () => {
    const latest = Date.parse('2026-10-10T08:00:00Z');
    expect(delayedFeedCopy(windowOf({ latestRecordEpochMs: latest, settlingDays: 1 }), 'Updated daily')).toBe(
      'The newest published record is from Oct 10, 2026. Updated daily. The newest day is still being filled in, '
        + 'so the window ends Oct 9, 2026. Days the publisher has not released yet are never counted as quiet days.',
    );
    expect(delayedFeedCopy(windowOf({ latestRecordEpochMs: latest, settlingDays: 7 }), 'Updated daily')).toContain(
      'The newest 7 days are still being filled in, so the window ends Oct 3, 2026.',
    );
  });

  it('mentions settling days only when some are left out of a published feed', () => {
    expect(settlingCopy(windowOf())).toBeNull();
    expect(settlingCopy(windowOf({ latestRecordEpochMs: null, settlingDays: 2 }))).toBeNull();
    expect(settlingCopy(windowOf({ settlingDays: 1 }))).toBe('Newest 1 day left out while the publisher is still filling them in');
    expect(settlingCopy(windowOf({ settlingDays: 3 }))).toBe('Newest 3 days left out while the publisher is still filling them in');
  });
});

describe('area coverage and truncation copy', () => {
  it('stays quiet when at least 95% of both areas is inside the city', () => {
    expect(areaCoverageCopy({ selected: 1, nearby: 1 }, 'Chicago')).toBeNull();
    expect(areaCoverageCopy({ selected: 0.95, nearby: 0.95 }, 'Chicago')).toBeNull();
  });

  it('names the one area that lies partly outside the city', () => {
    expect(areaCoverageCopy({ selected: 0.94, nearby: 1 }, 'Chicago')).toBe(
      '6% of the circle lies outside Chicago limits, where this feed has no records. '
        + 'Rates use only the area inside the city.',
    );
    expect(areaCoverageCopy({ selected: 1, nearby: 0.6 }, 'New York City')).toBe(
      '40% of the surrounding area lies outside New York City limits, where this feed has no records. '
        + 'Rates use only the area inside the city.',
    );
    // A circle 99.7% inside rounds to 0% outside and is left out of the sentence.
    expect(areaCoverageCopy({ selected: 0.997, nearby: 0.9 }, 'Chicago')).toMatch(/^10% of the surrounding area lies/);
  });

  it('names both areas when both lie partly outside the city', () => {
    expect(areaCoverageCopy({ selected: 0.7, nearby: 0.4 }, 'Chicago')).toBe(
      '30% of the circle and 60% of the surrounding area lie outside Chicago limits, where this feed has no records. '
        + 'Rates use only the area inside the city.',
    );
  });

  it.each(['selectedCurrent', 'selectedPrevious'] as const)('blames the circle request when %s is truncated', (flag) => {
    expect(truncationCopy({ ...NO_TRUNCATION, [flag]: true }, 20_000)).toBe(
      'A request for the circle reached the 20,000-record limit, so counts are minimums and the trend is withheld. '
        + 'A smaller radius or shorter window avoids this.',
    );
  });

  it('blames the comparison request when only it is truncated', () => {
    expect(truncationCopy({ ...NO_TRUNCATION, comparison: true }, 5000)).toBe(
      'The request for the surrounding area reached the 5,000-record limit, so the comparison is withheld. '
        + 'Counts inside the circle are complete.',
    );
  });

  it('prefers the circle explanation when both requests are truncated', () => {
    expect(truncationCopy({ selectedCurrent: true, selectedPrevious: false, comparison: true }, 1000))
      .toMatch(/^A request for the circle reached the 1,000-record limit/);
  });
});

describe('dataNotes', () => {
  it('has nothing to say about a complete, fresh, fully covered view', () => {
    expect(dataNotes(bundleOf())).toEqual([]);
  });

  it('keeps an incomplete count prominent', () => {
    expect(dataNotes(bundleOf({ truncation: { ...NO_TRUNCATION, selectedCurrent: true } }))).toEqual([{
      id: 'truncation',
      title: 'Counts are incomplete',
      body: truncationCopy({ ...NO_TRUNCATION, selectedCurrent: true }, 20_000),
      prominent: true,
    }]);
    const comparison = dataNotes(bundleOf({ truncation: { ...NO_TRUNCATION, comparison: true }, recordLimit: 4000 }));
    expect(comparison.map((note) => note.id)).toEqual(['truncation']);
    expect(comparison[0]?.body).toMatch(/^The request for the surrounding area reached the 4,000-record limit/);
  });

  it('notes a delayed feed with its publication lag', () => {
    const window = windowOf({ latestRecordEpochMs: Date.parse('2026-10-10T08:00:00Z') });
    expect(dataNotes(bundleOf({ window }))).toEqual([{
      id: 'delayed',
      title: 'Feed is 11 days behind',
      body: delayedFeedCopy(window, 'Updated daily'),
      prominent: false,
    }]);
  });

  it('calls a feed delayed from three days behind', () => {
    const threeDays = windowOf({ latestRecordEpochMs: Date.parse('2026-10-18T23:00:00Z') });
    expect(dataNotes(bundleOf({ window: threeDays })).map((note) => note.title)).toEqual(['Feed is 3 days behind']);
    const twoDays = windowOf({ latestRecordEpochMs: Date.parse('2026-10-19T23:00:00Z') });
    expect(dataNotes(bundleOf({ window: twoDays }))).toEqual([]);
  });

  it('explains a feed with no records in the lookback period', () => {
    const notes = dataNotes(bundleOf({ window: windowOf({ latestRecordEpochMs: null }) }));
    expect(notes.map((note) => note.id)).toEqual(['delayed']);
    expect(notes[0]?.title).toBe('No recent records');
    expect(notes[0]?.body).toBe(`No records were published in the last ${LATEST_RECORD_LOOKBACK_DAYS} days. Updated daily.`);
    expect(notes[0]?.prominent).toBe(false);
  });

  it('notes a dataset that starts inside the current window only', () => {
    const partial = dataNotes(bundleOf({ window: windowOf({ datasetStartEpochMs: day('2026-10-01') }) }));
    expect(partial).toEqual([{
      id: 'dataset-start',
      title: 'Partial window',
      body: 'This dataset starts Oct 1, 2026, so earlier days of the window have no published records and are not '
        + 'counted as quiet days.',
      prominent: false,
    }]);
    // Starting inside the previous window only affects the trend, which explains itself.
    expect(dataNotes(bundleOf({ window: windowOf({ datasetStartEpochMs: day('2026-09-01') }) }))).toEqual([]);
  });

  it('notes partial city coverage', () => {
    expect(dataNotes(bundleOf({ areaCoverage: { selected: 0.5, nearby: 1 } }))).toEqual([{
      id: 'area-coverage',
      title: 'Partly outside city limits',
      body: areaCoverageCopy({ selected: 0.5, nearby: 1 }, 'Chicago'),
      prominent: false,
    }]);
  });

  it('notes settling days left out of a fresh feed', () => {
    expect(dataNotes(bundleOf({ window: windowOf({ settlingDays: 2 }) }))).toEqual([{
      id: 'settling',
      title: 'Newest days left out',
      body: 'Newest 2 days left out while the publisher is still filling them in.',
      prominent: false,
    }]);
  });

  it('orders every note from most to least consequential', () => {
    const window = windowOf({
      latestRecordEpochMs: Date.parse('2026-10-10T08:00:00Z'),
      settlingDays: 2,
      datasetStartEpochMs: day('2026-10-01'),
    });
    const notes = dataNotes(bundleOf({
      window,
      truncation: { ...NO_TRUNCATION, selectedCurrent: true },
      areaCoverage: { selected: 0.5, nearby: 1 },
    }));
    expect(notes.map((note) => note.id)).toEqual(['truncation', 'delayed', 'dataset-start', 'area-coverage', 'settling']);
    expect(notes.map((note) => note.prominent)).toEqual([true, false, false, false, false]);
    expect(notes[1]?.title).toBe('Feed is 11 days behind');
  });
});

describe('publisher text', () => {
  it.each([
    ['GRAND LARCENY', 'Grand larceny'],
    ['  ASSAULT 3 & RELATED OFFENSES ', 'Assault 3 & related offenses'],
    ['Theft from Vehicle', 'Theft from Vehicle'],
    ['  already lower  ', 'already lower'],
    ['123', '123'],
    ['', ''],
  ])('sentence-cases %j as %j', (value, expected) => {
    expect(sentenceCase(value)).toBe(expected);
  });

  it.each([
    ['FRONT OF · STREET · MANHATTAN', 'Front of · Street · Manhattan'],
    ['THE CORNER OF 1ST AVE AND E 14TH ST', 'The Corner of 1st Ave and E 14th St'],
    ['1ST AVE', '1st Ave'],
    ['100X BLOCK W/ PARKING', '100x Block w/ Parking'],
    ['STORE W/O SIGN', 'Store w/o Sign'],
    ['OF THE PARK', 'Of the Park'],
    ['WILKES-BARRE AVE', 'Wilkes-Barre Ave'],
    ['LA CIÉNEGA BLVD', 'La Ciénega Blvd'],
    ['ÉCOLE ST', 'École St'],
    ['  Broadway & W 42nd St ', 'Broadway & W 42nd St'],
    ['street', 'street'],
  ])('title-cases %j as %j', (value, expected) => {
    expect(titleCase(value)).toBe(expected);
  });

  it("titles a report with the publisher's offense name, falling back to the atlas category", () => {
    expect(reportTitle(incident('a', 'theft', INSIDE, 'PETIT LARCENY'))).toBe('Petit larceny');
    expect(reportTitle(incident('b', 'theft', INSIDE, 'Theft from motor vehicle'))).toBe('Theft from motor vehicle');
    expect(reportTitle(incident('c', 'vehicle', INSIDE, ''))).toBe(CATEGORY_LABELS.vehicle);
    expect(reportTitle(incident('d', 'weapons', INSIDE, '   '))).toBe('Weapons');
  });
});

describe('times of day', () => {
  it.each([
    [0, 5, '12:05 AM'],
    [1, 0, '1:00 AM'],
    [11, 59, '11:59 AM'],
    [12, 0, '12:00 PM'],
    [13, 7, '1:07 PM'],
    [23, 26, '11:26 PM'],
  ])('reads %s:%s as %s', (hour, minute, label) => {
    expect(clockLabel(hour, minute)).toBe(label);
  });

  it.each([
    [0, '12 AM'],
    [5, '5 AM'],
    [11, '11 AM'],
    [12, '12 PM'],
    [22, '10 PM'],
  ])('labels hour %s as %s', (hour, label) => {
    expect(hourLabel(hour)).toBe(label);
  });

  it('splits a zone-free publisher timestamp into date, year and time', () => {
    expect(reportTime('2026-06-30T23:26:00', true)).toEqual({ date: 'Jun 30', year: '2026', time: '11:26 PM' });
    expect(reportTime('2026-01-05 07:03:00.0000000', true)).toEqual({ date: 'Jan 5', year: '2026', time: '7:03 AM' });
    expect(reportTime('2025-12-01T00:00:00', true)).toEqual({ date: 'Dec 1', year: '2025', time: '12:00 AM' });
  });

  it('leaves the time out when the publisher gave none', () => {
    expect(reportTime('2026-06-30T23:26:00', false)).toEqual({ date: 'Jun 30', year: '2026', time: null });
    expect(reportTime('2026-06-30', true)).toEqual({ date: 'Jun 30', year: '2026', time: null });
  });

  it('passes unreadable timestamps through as the date', () => {
    expect(reportTime('sometime in June', true)).toEqual({ date: 'sometime in June', year: '', time: null });
    expect(reportTime('', false)).toEqual({ date: '', year: '', time: null });
  });

  it.each([
    [0, '12a'],
    [1, '1a'],
    [11, '11a'],
    [12, '12p'],
    [13, '1p'],
    [23, '11p'],
  ])('ticks hour %s as %s', (hour, tick) => {
    expect(hourTick(hour)).toBe(tick);
  });
});
