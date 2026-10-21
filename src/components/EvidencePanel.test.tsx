import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { analyzeIncidents, FULL_AREA_COVERAGE, NO_TRUNCATION } from '../domain/analysis';
import { categoryGroup, CRIME_GROUPS, isViolentCategory, severityForCategory } from '../domain/categories';
import { computeEvidenceWindow } from '../domain/evidenceWindow';
import type {
  AnalysisResult,
  AreaCoverage,
  Coordinates,
  CrimeCategory,
  EvidenceBundle,
  EvidenceTruncation,
  EvidenceWindow,
  Incident,
  IncidentProvider,
  ProviderMeta,
} from '../types';
import {
  areaCoverageCopy,
  delayedFeedCopy,
  EvidencePanel,
  settlingCopy,
  truncationCopy,
  windowRangeLabel,
  type EvidencePanelProps,
} from './EvidencePanel';
import { summarizeAgency } from '../domain/agencySummary';
import { FULL_AGENCY, fixtureSnapshot, matchFor } from '../test/agencyFixtures';

const CENTER: Coordinates = [-73.9855, 40.758];
/** About 1.7 km east of the center: inside the 1 km comparator annulus. */
const NEARBY: Coordinates = [-73.9655, 40.758];
const NOW = Date.UTC(2026, 9, 21, 12);
const DAY = 86_400_000;

const META: ProviderMeta = {
  id: 'test-city',
  city: 'Test City',
  state: 'NY',
  label: 'Test City, New York',
  agency: 'Test Police Department',
  datasetName: 'Test Complaint Data',
  endpoint: 'https://example.test/resource/test.json',
  sourceUrl: 'https://example.test/d/test',
  timeZone: 'UTC',
  center: CENTER,
  zoom: 11,
  bounds: { west: -74.3, south: 40.4, east: -73.6, north: 41 },
  cadence: 'Updated daily',
  delayNote: 'Test delay.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Block level.',
  coverageNote: 'Test coverage.',
  lastVerified: '2026-10-21',
};

const PROVIDER: IncidentProvider = {
  meta: META,
  fetchLatestRecordEpoch: async () => null,
  fetchIncidents: async () => ({ incidents: [], recordLimit: 0, truncated: false, requestUrls: [] }),
};

const PLACE = { label: 'Times Square', detail: 'Manhattan', coordinates: CENTER };

/** Daily feed: newest record yesterday, two settling days. */
const CURRENT_WINDOW = computeEvidenceWindow({
  windowDays: 30,
  nowEpochMs: NOW,
  latestRecordEpochMs: Date.UTC(2026, 9, 20, 18),
  settlingDays: 2,
});

/** Quarterly feed: newest record months ago, nothing settling. */
const DELAYED_WINDOW = computeEvidenceWindow({
  windowDays: 30,
  nowEpochMs: NOW,
  latestRecordEpochMs: Date.UTC(2026, 5, 30, 9),
  settlingDays: 0,
});

function incident(
  id: string,
  category: CrimeCategory,
  epochMs: number,
  coordinates: Coordinates = CENTER,
  hour = 14,
): Incident {
  const occurredAt = `${new Date(epochMs).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:30:00`;
  return {
    id,
    providerId: META.id,
    occurredAt,
    occurredAtEpochMs: Date.parse(`${occurredAt}Z`),
    localHour: hour,
    category,
    group: categoryGroup(category),
    rawCategory: category.toUpperCase(),
    description: `${category} on the sidewalk`,
    locationLabel: `${id} block`,
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

function incidentsFor(window: EvidenceWindow): Incident[] {
  const lastDay = window.endEpochMs - DAY;
  return [
    incident('assault-1', 'assault', lastDay, CENTER, 23),
    incident('theft-1', 'theft', lastDay - DAY),
    incident('theft-2', 'theft', lastDay - 2 * DAY),
    incident('vehicle-1', 'vehicle', lastDay - 3 * DAY, CENTER, 2),
    incident('robbery-1', 'robbery', lastDay - 4 * DAY),
    incident('nearby-1', 'theft', lastDay - DAY, NEARBY),
    incident('nearby-2', 'theft', lastDay - 2 * DAY, NEARBY),
    incident('previous-1', 'theft', window.currentStartEpochMs - 5 * DAY),
  ];
}

function evidenceFor(window: EvidenceWindow, overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
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

function analysisFor(evidence: EvidenceBundle, radiusMeters = 1000): AnalysisResult {
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

const IDLE_AREA_SUMMARY = { status: 'idle', result: null, error: null, refresh: vi.fn() } as const;

function props(overrides: Partial<EvidencePanelProps> = {}): EvidencePanelProps {
  const evidence = overrides.evidence === undefined ? evidenceFor(CURRENT_WINDOW) : overrides.evidence;
  return {
    place: PLACE,
    provider: PROVIDER,
    areaSummary: IDLE_AREA_SUMMARY,
    status: 'ready',
    analysis: evidence ? analysisFor(evidence, overrides.radiusMeters) : null,
    evidence,
    error: null,
    radiusMeters: 1000,
    windowDays: 30,
    selectedIncident: null,
    onIncidentSelect: vi.fn(),
    onRefresh: vi.fn(),
    onOpenSources: vi.fn(),
    ...overrides,
  };
}

function panel() {
  return screen.getByTestId('evidence-panel');
}

describe('EvidencePanel states', () => {
  it('shows FBI jurisdiction totals for an uncovered place', () => {
    const snapshot = fixtureSnapshot();
    const summary = summarizeAgency(matchFor(FULL_AGENCY), snapshot)!;
    render(<EvidencePanel {...props({
      provider: null,
      status: 'idle',
      evidence: null,
      analysis: null,
      areaSummary: { status: 'ready', result: { kind: 'agency', summary, snapshot }, error: null, refresh: vi.fn() },
    })} />);

    expect(panel()).not.toHaveClass('evidence-panel--compact');
    expect(panel()).toHaveTextContent('Jurisdiction totals · 12 months · FBI Crime Data Explorer');
    expect(screen.getByTestId('jurisdiction-band')).toHaveTextContent('Fixture City Police Department');
    expect(screen.queryByRole('button', { name: 'Refresh official incident data' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('reported-count')).not.toBeInTheDocument();
  });

  it('waits for the jurisdiction lookup, and retries a failed one', async () => {
    const refresh = vi.fn();
    const user = userEvent.setup();
    const base = { provider: null, status: 'idle' as const, evidence: null, analysis: null };
    const { rerender } = render(<EvidencePanel {...props({
      ...base,
      areaSummary: { status: 'loading', result: null, error: null, refresh },
    })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading official incident records');

    rerender(<EvidencePanel {...props({
      ...base,
      areaSummary: { status: 'error', result: null, error: 'Census TIGERweb returned HTTP 503', refresh },
    })} />);
    expect(panel()).toHaveClass('evidence-panel--compact');
    expect(screen.getByRole('alert')).toHaveTextContent('Census TIGERweb returned HTTP 503');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps a place outside the states compact', () => {
    render(<EvidencePanel {...props({
      provider: null,
      status: 'idle',
      evidence: null,
      analysis: null,
      areaSummary: { status: 'ready', result: { kind: 'outside' }, error: null, refresh: vi.fn() },
    })} />);
    expect(panel()).toHaveClass('evidence-panel--compact');
    expect(panel()).toHaveTextContent('Outside United States coverage');
  });

  it('shows a source-specific failure with a retry action', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    render(<EvidencePanel {...props({ status: 'error', error: 'Test Police Department returned HTTP 503', onRefresh })} />);

    expect(panel()).toHaveClass('evidence-panel--compact');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Official data could not be loaded');
    expect(alert).toHaveTextContent('Test Police Department returned HTTP 503');
    expect(screen.getByRole('heading', { level: 2 }).nextElementSibling).not.toHaveTextContent('ending');
    expect(screen.queryByTestId('reported-count')).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('falls back to a generic failure message', () => {
    render(<EvidencePanel {...props({ status: 'error', error: null, evidence: null })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The official publisher did not return a usable response.');
  });

  it('shows a loading skeleton before the first result', () => {
    render(<EvidencePanel {...props({ status: 'loading', evidence: null, analysis: null })} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading official incident records');
    expect(panel()).not.toHaveClass('evidence-panel--compact');
    const refresh = screen.getByRole('button', { name: 'Refresh official incident data' });
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector('svg')).toHaveClass('is-spinning');
  });

  it('keeps the previous result visible while refreshing', () => {
    render(<EvidencePanel {...props({ status: 'loading' })} />);

    expect(screen.getByText('Refreshing official records…')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('reported-count')).toHaveTextContent('5');
  });
});

describe('EvidencePanel analysis', () => {
  it('summarizes the selected area against its surroundings', async () => {
    const onRefresh = vi.fn();
    const user = userEvent.setup();
    const view = props({ onRefresh });
    render(<EvidencePanel {...view} />);
    const analysis = view.analysis!;

    expect(screen.getByRole('heading', { level: 2, name: 'Times Square' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('1 km · 30 days ending Oct 18, 2026 · published incidents');

    const band = screen.getByTestId('activity-band');
    expect(band).toHaveTextContent(`${analysis.relativeActivity!.toFixed(2)}× nearby weighted report density`);
    expect(band).toHaveTextContent('This describes published reporting activity, not a safety grade.');
    expect(band).toHaveTextContent('Confidence: low · 7 observations');
    expect(band).toHaveTextContent('1 km circle · 1 to 3 km nearby · 30 days');
    expect(screen.getByTestId('evidence-window')).toHaveTextContent(
      'Sep 19 – Oct 18, 2026 · Newest 2 days excluded while still being filled in',
    );

    expect(screen.getByTestId('reported-count')).toHaveTextContent('5');
    expect(panel()).toHaveTextContent('400% higher than previous equal window');
    expect(panel()).toHaveTextContent('40% of selected-area reports');
    expect(panel()).toHaveTextContent('40% occurred 10 PM–4:59 AM');
    expect(panel()).toHaveTextContent('Between 1 km and 3 km');

    const timeline = screen.getByRole('img', { name: /Daily report count timeline/ });
    expect(timeline).toHaveAccessibleName('Daily report count timeline for the last 30 days. 5 reports total.');
    expect(timeline.querySelectorAll('.timeline__bar')).toHaveLength(30);

    const link = screen.getByRole('link', { name: 'Open official Test Complaint Data source' });
    expect(link).toHaveAttribute('href', META.sourceUrl);
    expect(panel()).toHaveTextContent('Newest in feedOct 20, 2026');
    expect(panel()).toHaveTextContent('Latest here10/18/2026 · 23:30');

    await user.click(screen.getByRole('button', { name: 'Refresh official incident data' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('lists the most recent reports and selects one', async () => {
    const onIncidentSelect = vi.fn();
    const user = userEvent.setup();
    const view = props({ onIncidentSelect });
    render(<EvidencePanel {...view} />);

    const list = within(screen.getByText('Most recent selected-area reports').closest('section')!);
    const rows = list.getAllByRole('button');
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Assault · ASSAULT');
    expect(rows[0]).toHaveTextContent('assault-1 block');
    expect(rows[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-10-18T23:30:00');
    expect(rows[0]).toHaveTextContent('10/18/2026');

    await user.click(rows[1]!);
    expect(onIncidentSelect).toHaveBeenCalledWith(view.analysis!.currentIncidents[1]);
  });

  it('caps the report list at eight rows', () => {
    const lastDay = CURRENT_WINDOW.endEpochMs - DAY;
    const incidents = Array.from({ length: 12 }, (_, index) => incident(`theft-${index}`, 'theft', lastDay - index * DAY));
    render(<EvidencePanel {...props({ evidence: evidenceFor(CURRENT_WINDOW, { incidents }) })} />);

    const list = within(screen.getByText('Most recent selected-area reports').closest('section')!);
    expect(list.getAllByRole('button')).toHaveLength(8);
    expect(list.getByText('12 total')).toBeInTheDocument();
  });

  it('shows the category composition', () => {
    render(<EvidencePanel {...props()} />);

    const composition = screen.getByText('Category composition').closest('section')!;
    const rows = [...composition.querySelectorAll('.category-list > div')].map((row) => row.textContent);
    expect(rows).toEqual(['Theft2', 'Assault1', 'Robbery1', 'Vehicle theft1']);
  });

  it('details the selected incident', () => {
    const view = props();
    const selected = view.analysis!.currentIncidents[0]!;
    render(<EvidencePanel {...props({ selectedIncident: selected })} />);

    const detail = screen.getByRole('heading', { level: 3, name: 'Assault · ASSAULT' }).closest('section')!;
    expect(detail).toHaveTextContent('assault on the sidewalk');
    expect(detail).toHaveTextContent('10/18/2026 · 23:30 · assault-1 block. Public point precision: block.');
  });

  it('explains empty results without inventing a comparison', () => {
    render(<EvidencePanel {...props({ evidence: evidenceFor(CURRENT_WINDOW, { incidents: [] }) })} />);

    expect(screen.getByTestId('reported-count')).toHaveTextContent('0');
    expect(screen.getByTestId('activity-band')).toHaveTextContent('No stable nearby comparison');
    expect(screen.getByTestId('activity-band')).toHaveTextContent('Not enough evidence');
    expect(panel()).toHaveTextContent('No reports in either equal window');
    expect(panel()).toHaveTextContent(
      'No reports in the selected radius match the active categories between Sep 19 – Oct 18, 2026.',
    );
    expect(panel()).toHaveTextContent('No selected categories were observed in this radius and date window.');
    expect(panel()).toHaveTextContent('Latest hereNo observation in window');
  });

  it.each([
    [500, '500 m circle · 500 m to 1.5 km nearby', 'Between 500 m and 1.5 km', '500 m · 30 days'],
    [1000, '1 km circle · 1 to 3 km nearby', 'Between 1 km and 3 km', '1 km · 30 days'],
    [2000, '2 km circle · 2 to 6 km nearby', 'Between 2 km and 6 km', '2 km · 30 days'],
  ])('labels a %i m radius and its comparator', (radiusMeters, circle, comparator, header) => {
    render(<EvidencePanel {...props({ radiusMeters })} />);

    expect(screen.getByTestId('activity-band')).toHaveTextContent(circle);
    expect(panel()).toHaveTextContent(comparator);
    expect(panel()).toHaveTextContent(header);
  });
});

describe('EvidencePanel trend copy', () => {
  const base = props();

  it.each<[Partial<AnalysisResult>, string]>([
    [{ trendDirection: 'none', trendPercent: null }, 'No reports in either equal window'],
    [{ trendDirection: 'new', trendPercent: null }, 'Previous equal window had no reports'],
    [{ trendDirection: 'flat', trendPercent: 0 }, 'Unchanged from previous equal window'],
    [{ trendDirection: 'up', trendPercent: 24.6 }, '25% higher than previous equal window'],
    [{ trendDirection: 'down', trendPercent: -31.2 }, '31% lower than previous equal window'],
    [{ trendDirection: 'up', trendPercent: 0.4 }, 'Within 1% of previous equal window'],
    [{ trendDirection: 'down', trendPercent: -0.2 }, 'Within 1% of previous equal window'],
    [{ trendDirection: 'up', trendPercent: null }, 'Within 1% of previous equal window'],
    [
      { trendDirection: 'unavailable', trendPercent: null, trendUnavailableReason: 'record-limit' },
      'No trend: a window reached the record limit',
    ],
    // Without a known start date the dataset reason is still named, just not dated.
    [
      { trendDirection: 'unavailable', trendPercent: null, trendUnavailableReason: 'dataset-start' },
      'No trend: the previous equal window predates this dataset',
    ],
  ])('describes %o', (trend, copy) => {
    render(<EvidencePanel {...base} analysis={{ ...base.analysis!, ...trend }} />);
    expect(screen.getByTestId('reported-count').nextElementSibling).toHaveTextContent(copy);
  });
});

describe('EvidencePanel publication disclosures', () => {
  it('does not call out a daily feed whose only gap is settling days', () => {
    render(<EvidencePanel {...props()} />);
    expect(screen.queryByTestId('delayed-feed-notice')).not.toBeInTheDocument();
  });

  it('calls out a feed whose publisher is behind', () => {
    render(<EvidencePanel {...props({ evidence: evidenceFor(DELAYED_WINDOW) })} />);

    const notice = screen.getByTestId('delayed-feed-notice');
    expect(notice).toHaveTextContent('Feed is 113 days behind.');
    expect(notice).toHaveTextContent('The newest published record is from Jun 30, 2026. Updated daily.');
    expect(notice).toHaveTextContent('The window ends Jun 30, 2026. Unpublished days are never counted as quiet days.');
    expect(screen.getByTestId('evidence-window')).toHaveTextContent(/^Jun 1 – Jun 30, 2026$/);
    expect(panel()).toHaveTextContent('30 days ending Jun 30, 2026');
  });

  it('explains settling days inside a delayed-feed notice', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.UTC(2026, 9, 13, 8),
      settlingDays: 2,
    });
    render(<EvidencePanel {...props({ evidence: evidenceFor(window) })} />);

    const notice = screen.getByTestId('delayed-feed-notice');
    expect(notice).toHaveTextContent('Feed is 8 days behind.');
    expect(notice).toHaveTextContent('The newest 2 days are still being filled in, so the window ends Oct 11, 2026.');
  });

  it('uses a singular day for a one-day publication lag', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.UTC(2026, 9, 20, 8),
      settlingDays: 0,
    });
    expect(settlingCopy(window)).toBeNull();
    expect(delayedFeedCopy(window, 'Updated daily')).toContain('The window ends Oct 20, 2026.');
    expect(windowRangeLabel(window)).toBe('Sep 21 – Oct 20, 2026');
  });

  it('labels a single settling day in the window line', () => {
    const window = computeEvidenceWindow({
      windowDays: 14,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.UTC(2026, 9, 20, 8),
      settlingDays: 1,
    });
    expect(settlingCopy(window)).toBe('Newest 1 day excluded while still being filled in');
  });

  it('spans years in a window label when needed', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: Date.UTC(2027, 0, 20),
      latestRecordEpochMs: Date.UTC(2027, 0, 10, 8),
      settlingDays: 0,
    });
    expect(windowRangeLabel(window)).toBe('Dec 12, 2026 – Jan 10, 2027');
  });

  it('shows no figures for a feed with no recent records', async () => {
    const onOpenSources = vi.fn();
    const user = userEvent.setup();
    const window = computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs: null, settlingDays: 2 });
    render(<EvidencePanel {...props({ evidence: evidenceFor(window, { incidents: [] }), onOpenSources })} />);

    const state = screen.getByTestId('no-records-state');
    expect(state).toHaveTextContent('No recent records from Test Police Department');
    expect(state).toHaveTextContent('No records were published in the last 400 days. Updated daily.');
    expect(state).toHaveTextContent('Without published records there is nothing to count or compare, so no figures are shown.');
    expect(panel()).toHaveClass('evidence-panel--compact');
    expect(panel()).toHaveTextContent('1 km · 30 days · published incidents');
    expect(panel()).not.toHaveTextContent('ending');
    expect(panel()).not.toHaveTextContent('0 days behind');
    expect(screen.queryByTestId('delayed-feed-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reported-count')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-band')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh official incident data' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Review source status' }));
    expect(onOpenSources).toHaveBeenCalledOnce();
  });

  it('describes a feed with no recent records', () => {
    const window = computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs: null, settlingDays: 2 });
    expect(delayedFeedCopy(window, 'Published quarterly')).toBe(
      'No records were published in the last 400 days. Published quarterly.',
    );
    expect(settlingCopy(window)).toBeNull();
  });

  it('uses singular grammar for one settling day', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.UTC(2026, 9, 13, 8),
      settlingDays: 1,
    });
    expect(delayedFeedCopy(window, 'Updated daily')).not.toContain('1 day are');
    expect(delayedFeedCopy(window, 'Updated daily')).toContain('The newest day is still being filled in');
  });

  it('omits the truncation warning for complete queries', () => {
    render(<EvidencePanel {...props()} />);
    expect(panel()).not.toHaveTextContent('record limit');
    expect(screen.queryByTestId('truncation-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-start-notice')).not.toBeInTheDocument();
  });

  it('notes reports published without a time of day', () => {
    const lastDay = CURRENT_WINDOW.endEpochMs - DAY;
    const untimed = { ...incident('untimed-1', 'theft', lastDay - 6 * DAY, CENTER, 0), localHour: null };
    const evidence = evidenceFor(CURRENT_WINDOW, { incidents: [...incidentsFor(CURRENT_WINDOW), untimed] });
    render(<EvidencePanel {...props({ evidence })} />);

    expect(screen.getByTestId('reported-count')).toHaveTextContent('6');
    // Two of the five timed reports were at night; the untimed one is not counted either way.
    expect(panel()).toHaveTextContent('40% occurred 10 PM–4:59 AM · 1 without a published time');
  });

  it('omits the untimed note when every report has a time', () => {
    render(<EvidencePanel {...props()} />);
    expect(panel()).not.toHaveTextContent('without a published time');
  });
});

describe('EvidencePanel record limits', () => {
  const truncated = (truncation: Partial<EvidenceTruncation>) => (
    evidenceFor(CURRENT_WINDOW, { truncation: { ...NO_TRUNCATION, ...truncation } })
  );

  it('shows lower bounds and withholds the trend and comparison when every query hit the limit', () => {
    render(<EvidencePanel {...props({ evidence: truncated({ selectedCurrent: true, selectedPrevious: true, comparison: true }) })} />);

    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5\+$/);
    expect(screen.getByTestId('reported-count').nextElementSibling).toHaveTextContent(
      'No trend: a window reached the record limit',
    );
    expect(panel()).toHaveTextContent('5+ total');
    expect(screen.getByRole('img', { name: /Daily report count timeline/ })).toHaveAccessibleName(
      'Daily report count timeline for the last 30 days. 5+ reports total.',
    );
    const nearby = screen.getByText('Nearby comparator').closest('article')!;
    expect(within(nearby).getByText('2+')).toBeInTheDocument();

    const band = screen.getByTestId('activity-band');
    expect(band).toHaveTextContent('Nearby comparison unavailable');
    expect(band).toHaveTextContent('Comparison withheld');
    expect(band).toHaveTextContent('The nearby area has more reports than one query can return');
    expect(band).not.toHaveTextContent('×');
    expect(band).toHaveTextContent('Confidence: low · 7+ observations');

    expect(screen.getByTestId('truncation-warning')).toHaveTextContent(
      'A selected-area query reached the 20,000-record limit. Counts are lower bounds, the trend is withheld',
    );
  });

  it('keeps selected-area figures exact when only the comparison query hit the limit', () => {
    const view = props({ evidence: truncated({ comparison: true }) });
    render(<EvidencePanel {...view} />);

    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5$/);
    expect(panel()).toHaveTextContent('400% higher than previous equal window');
    expect(panel()).toHaveTextContent('5 total');
    const nearby = screen.getByText('Nearby comparator').closest('article')!;
    expect(within(nearby).getByText('2+')).toBeInTheDocument();
    expect(screen.getByTestId('activity-band')).toHaveTextContent('Nearby comparison unavailable');
    expect(screen.getByTestId('activity-band')).toHaveTextContent('7+ observations');
    expect(screen.getByTestId('truncation-warning')).toHaveTextContent(
      'The nearby comparison query reached the 20,000-record limit, so the nearby comparison is withheld. '
        + 'Selected-area counts are complete.',
    );
  });

  it('withholds only the trend when the previous window hit the limit', () => {
    const view = props({ evidence: truncated({ selectedPrevious: true }) });
    render(<EvidencePanel {...view} />);

    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5$/);
    expect(screen.getByTestId('reported-count').nextElementSibling).toHaveTextContent(
      'No trend: a window reached the record limit',
    );
    expect(screen.getByTestId('activity-band')).toHaveTextContent(
      `${view.analysis!.relativeActivity!.toFixed(2)}× nearby weighted report density`,
    );
    expect(screen.getByTestId('activity-band')).toHaveTextContent('Confidence: low · 7 observations');
    expect(screen.getByTestId('truncation-warning')).toHaveTextContent('A selected-area query reached the 20,000-record limit.');
  });

  it.each<[Partial<EvidenceTruncation>, number, string]>([
    [{ selectedCurrent: true }, 20_000, 'A selected-area query reached the 20,000-record limit.'],
    [{ selectedPrevious: true }, 5000, 'A selected-area query reached the 5,000-record limit.'],
    [{ comparison: true }, 10_000, 'The nearby comparison query reached the 10,000-record limit'],
  ])('words the warning for %o', (truncation, limit, copy) => {
    const text = truncationCopy({ ...NO_TRUNCATION, ...truncation }, limit);
    expect(text).toContain(copy);
    expect(text).toContain('A smaller radius or shorter window avoids this.');
  });
});

describe('EvidencePanel dataset start', () => {
  const withDatasetStart = (datasetStartEpochMs: number) => evidenceFor({ ...CURRENT_WINDOW, datasetStartEpochMs });

  it('flags a current window that starts before the dataset and withholds the trend', () => {
    render(<EvidencePanel {...props({ evidence: withDatasetStart(Date.UTC(2026, 9, 1)) })} />);

    expect(screen.getByTestId('dataset-start-notice')).toHaveTextContent(
      'Partial window. This dataset starts Oct 1, 2026, so earlier days of the window have no published records '
        + 'and are not counted as quiet days.',
    );
    expect(screen.getByTestId('reported-count').nextElementSibling).toHaveTextContent(
      'No trend: the previous equal window predates this dataset (starts Oct 1, 2026)',
    );
  });

  it('withholds only the trend when just the previous window predates the dataset', () => {
    render(<EvidencePanel {...props({ evidence: withDatasetStart(Date.UTC(2026, 8, 1)) })} />);

    expect(screen.queryByTestId('dataset-start-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('reported-count').nextElementSibling).toHaveTextContent(
      'No trend: the previous equal window predates this dataset (starts Sep 1, 2026)',
    );
  });

  it('shows the trend when both windows fall inside the dataset', () => {
    render(<EvidencePanel {...props({ evidence: withDatasetStart(Date.UTC(2026, 0, 1)) })} />);

    expect(screen.queryByTestId('dataset-start-notice')).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent('400% higher than previous equal window');
  });

  it('opens the methodology from the source card', async () => {
    const onOpenSources = vi.fn();
    const user = userEvent.setup();
    render(<EvidencePanel {...props({ onOpenSources })} />);

    await user.click(screen.getByRole('button', { name: 'Read source caveats and methodology' }));
    expect(onOpenSources).toHaveBeenCalledOnce();
  });
});

describe('EvidencePanel city-limit coverage', () => {
  const covered = (areaCoverage: AreaCoverage) => evidenceFor(CURRENT_WINDOW, { areaCoverage });

  it.each<[AreaCoverage, string | null]>([
    [{ selected: 1, nearby: 1 }, null],
    [{ selected: 0.951, nearby: 0.95 }, null],
    [
      { selected: 0.7, nearby: 1 },
      '30% of the selected circle lies outside Test City limits, where this feed has no records. '
        + 'Densities use only the area inside the city.',
    ],
    [
      { selected: 1, nearby: 0.884 },
      '12% of the nearby area lies outside Test City limits, where this feed has no records. '
        + 'Densities use only the area inside the city.',
    ],
    [
      { selected: 0.7, nearby: 0.59 },
      '30% of the selected circle and 41% of the nearby area lie outside Test City limits, where this feed has no '
        + 'records. Densities use only the area inside the city.',
    ],
    [
      { selected: 0.996, nearby: 0.9 },
      '10% of the nearby area lies outside Test City limits, where this feed has no records. '
        + 'Densities use only the area inside the city.',
    ],
  ])('describes coverage %j', (coverage, expected) => {
    expect(areaCoverageCopy(coverage, 'Test City')).toBe(expected);
  });

  it('notes how much of the area lies outside city limits', () => {
    render(<EvidencePanel {...props({ evidence: covered({ selected: 0.9, nearby: 0.6 }) })} />);

    const notice = screen.getByTestId('area-coverage-notice');
    expect(notice).toHaveTextContent('Partly outside city limits.');
    expect(notice).toHaveTextContent('10% of the selected circle and 40% of the nearby area lie outside Test City limits');
    expect(screen.getByTestId('activity-band')).not.toHaveTextContent('Comparison withheld');
    expect(screen.getByTestId('activity-band')).toHaveTextContent('× nearby weighted report density');
  });

  it('adds no notice when the area lies inside the city', () => {
    render(<EvidencePanel {...props()} />);
    expect(screen.queryByTestId('area-coverage-notice')).not.toBeInTheDocument();
  });

  it('withholds the comparison when too little of the area lies inside the city', () => {
    render(<EvidencePanel {...props({ evidence: covered({ selected: 1, nearby: 0.2 }) })} />);

    const band = screen.getByTestId('activity-band');
    expect(band).toHaveTextContent('Nearby comparison unavailable');
    expect(band).toHaveTextContent('Comparison withheld');
    expect(band).toHaveTextContent(
      'Too little of the selected circle or nearby area lies inside city limits for a stable comparison.',
    );
    expect(band).not.toHaveTextContent('more reports than one query can return');
    expect(screen.getByTestId('area-coverage-notice')).toHaveTextContent('80% of the nearby area lies outside');
    // Coverage does not make counts lower bounds or trigger the record-limit warning.
    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5$/);
    expect(screen.queryByTestId('truncation-warning')).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent('400% higher than previous equal window');
  });
});
