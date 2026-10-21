import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeIncidents, FULL_AREA_COVERAGE } from '../domain/analysis';
import { categoryGroup, CRIME_GROUPS, isViolentCategory, severityForCategory } from '../domain/categories';
import type {
  Coordinates,
  CrimeCategory,
  CrimeGroup,
  Incident,
  IncidentBatch,
  IncidentProvider,
  IncidentQuery,
  ProviderMeta,
} from '../types';
import {
  clearEvidenceCache,
  EVIDENCE_CACHE_TTL_MS,
  EVIDENCE_TIMEOUT_MS,
  evidenceKey,
  useIncidentAnalysis,
  type IncidentAnalysisInput,
} from './useIncidentAnalysis';

const CENTER: Coordinates = [-73.9855, 40.758];
const OTHER_CENTER: Coordinates = [-73.95, 40.78];
/** Well in the past so the window is always anchored to it, never to "now". */
const LATEST = Date.UTC(2025, 5, 15, 12);

const META: ProviderMeta = {
  id: 'test-city',
  city: 'Test City',
  state: 'NY',
  label: 'Test City, New York',
  agency: 'Test Police Department',
  datasetName: 'Test incidents',
  endpoint: 'https://example.test/resource/test.json',
  sourceUrl: 'https://example.test/d/test',
  timeZone: 'UTC',
  center: CENTER,
  zoom: 11,
  bounds: { west: -74.3, south: 40.4, east: -73.6, north: 41 },
  cadence: 'Updated daily',
  delayNote: 'Test delay.',
  settlingDays: 0,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Block level.',
  coverageNote: 'Test coverage.',
  lastVerified: '2026-10-21',
};

function incident(id: string, category: CrimeCategory, epochMs: number, coordinates: Coordinates = CENTER): Incident {
  const occurredAt = new Date(epochMs).toISOString().slice(0, 19);
  return {
    id,
    providerId: META.id,
    occurredAt,
    occurredAtEpochMs: epochMs,
    localHour: new Date(epochMs).getUTCHours(),
    category,
    group: categoryGroup(category),
    rawCategory: category.toUpperCase(),
    description: `${category} report`,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

const CURRENT_DAY = Date.UTC(2025, 5, 10, 14);
const PREVIOUS_DAY = Date.UTC(2025, 4, 1, 14);

const DEFAULT_INCIDENTS = [
  incident('assault-1', 'assault', CURRENT_DAY),
  incident('theft-1', 'theft', CURRENT_DAY - 3_600_000),
  incident('theft-2', 'theft', CURRENT_DAY - 7_200_000),
  incident('previous-1', 'theft', PREVIOUS_DAY),
];

function batch(incidents: Incident[]): IncidentBatch {
  return { incidents, recordLimit: 5000, truncated: false, requestUrls: ['https://example.test/query'] };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

type FakeProvider = IncidentProvider & {
  fetchLatestRecordEpoch: ReturnType<typeof vi.fn<(signal?: AbortSignal) => Promise<number | null>>>;
  fetchIncidents: ReturnType<typeof vi.fn<(query: IncidentQuery) => Promise<IncidentBatch>>>;
};

function fakeProvider(incidents: Incident[] = DEFAULT_INCIDENTS): FakeProvider {
  return {
    meta: META,
    fetchLatestRecordEpoch: vi.fn(async () => LATEST),
    fetchIncidents: vi.fn(async () => batch(incidents)),
  };
}

function input(overrides: Partial<IncidentAnalysisInput> = {}): IncidentAnalysisInput {
  return {
    provider: null,
    center: CENTER,
    radiusMeters: 1000,
    windowDays: 30,
    activeGroups: [...CRIME_GROUPS],
    ...overrides,
  };
}

function renderAnalysis(initial: IncidentAnalysisInput) {
  return renderHook((props: IncidentAnalysisInput) => useIncidentAnalysis(props), { initialProps: initial });
}

beforeEach(() => {
  clearEvidenceCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('evidenceKey', () => {
  it('identifies a provider, rounded center, radius and window', () => {
    expect(evidenceKey(fakeProvider(), [-73.985512, 40.758049], 500, 14)).toBe('test-city:-73.9855:40.7580:500:14');
  });
});

describe('useIncidentAnalysis', () => {
  it('stays idle without a covering provider', () => {
    const { result } = renderAnalysis(input());

    expect(result.current).toMatchObject({ status: 'idle', analysis: null, evidence: null, error: null });
    act(() => result.current.refresh());
    expect(result.current.status).toBe('idle');
  });

  it('loads evidence anchored to the latest record and analyzes it', async () => {
    const provider = fakeProvider();
    const { result } = renderAnalysis(input({ provider }));

    expect(result.current.status).toBe('loading');
    expect(result.current.analysis).toBeNull();

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
    expect(result.current.evidence?.window.endEpochMs).toBe(Date.UTC(2025, 5, 16));
    expect(result.current.analysis).toMatchObject({ currentCount: 3, previousCount: 1, violentCount: 1 });
    expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledOnce();
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
    const radii = provider.fetchIncidents.mock.calls.map(([query]) => query.radiusMeters).sort((a, b) => a - b);
    expect(radii).toEqual([1000, 3000]);
  });

  it('serves a repeated request from the cache without refetching', async () => {
    const provider = fakeProvider();
    const first = renderAnalysis(input({ provider }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();

    const second = renderAnalysis(input({ provider }));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(second.result.current.analysis?.currentCount).toBe(3);
    expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledOnce();
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
  });

  it('refetches once a cached result has expired', async () => {
    const provider = fakeProvider();
    const first = renderAnalysis(input({ provider }));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    first.unmount();

    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + EVIDENCE_CACHE_TTL_MS + 1);
    const second = renderAnalysis(input({ provider }));
    await waitFor(() => expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
  });

  it('keeps showing the previous evidence while a refresh is in flight', async () => {
    const provider = fakeProvider();
    const { result } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstEvidence = result.current.evidence;

    const pending = deferred<IncidentBatch>();
    provider.fetchIncidents.mockImplementation(() => pending.promise);
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.evidence).toBe(firstEvidence);
    expect(result.current.analysis?.currentCount).toBe(3);

    await act(async () => {
      pending.resolve(batch([incident('fresh-1', 'robbery', CURRENT_DAY)]));
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.evidence).not.toBe(firstEvidence);
    expect(result.current.analysis).toMatchObject({ currentCount: 1, violentCount: 1 });
  });

  it('reports a publisher failure with its message', async () => {
    const provider = fakeProvider();
    provider.fetchLatestRecordEpoch.mockRejectedValue(new Error('Test Police Department returned HTTP 503'));
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Test Police Department returned HTTP 503');
    expect(result.current.analysis).toBeNull();
  });

  it('falls back to a generic message for non-Error failures', async () => {
    const provider = fakeProvider();
    provider.fetchIncidents.mockRejectedValue('offline');
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('The official data portal could not be reached.');
  });

  it('recovers from a failure when refreshed', async () => {
    const provider = fakeProvider();
    provider.fetchLatestRecordEpoch.mockRejectedValueOnce(new Error('Temporary outage'));
    const { result } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
  });

  it('times out a portal that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const provider = fakeProvider();
    provider.fetchLatestRecordEpoch.mockImplementation((signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    const { result } = renderAnalysis(input({ provider }));
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVIDENCE_TIMEOUT_MS);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('The official data portal did not respond within 45 seconds.');
  });

  it('never shows a previous place while a new place is loading', async () => {
    const provider = fakeProvider();
    const { result, rerender } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const pending = deferred<IncidentBatch>();
    provider.fetchIncidents.mockImplementation(() => pending.promise);
    rerender(input({ provider, center: OTHER_CENTER }));

    expect(result.current.status).toBe('loading');
    expect(result.current.evidence).toBeNull();
    expect(result.current.analysis).toBeNull();

    await act(async () => {
      pending.resolve(batch([incident('other-1', 'burglary', CURRENT_DAY, OTHER_CENTER)]));
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.analysis?.currentIncidents.map((item) => item.id)).toEqual(['other-1']);
  });

  it('ignores a late response for a request that has been superseded', async () => {
    const provider = fakeProvider();
    const slow = deferred<IncidentBatch>();
    provider.fetchIncidents.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => slow.promise);
    const { result, rerender } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(provider.fetchIncidents).toHaveBeenCalledTimes(2));

    provider.fetchIncidents.mockImplementation(async () => batch([incident('other-1', 'burglary', CURRENT_DAY, OTHER_CENTER)]));
    rerender(input({ provider, center: OTHER_CENTER }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      slow.resolve(batch(DEFAULT_INCIDENTS));
    });
    expect(result.current.analysis?.currentIncidents.map((item) => item.id)).toEqual(['other-1']);

    rerender(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(6);
  });

  it('does not surface an abort caused by unmounting as an error', async () => {
    const provider = fakeProvider();
    let observedSignal: AbortSignal | undefined;
    provider.fetchLatestRecordEpoch.mockImplementation((signal) => new Promise((_resolve, reject) => {
      observedSignal = signal;
      signal?.addEventListener('abort', () => reject(signal.reason));
    }));
    const { result, unmount } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(observedSignal).toBeDefined());

    unmount();

    expect(observedSignal?.aborted).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('re-analyzes for a group change without refetching', async () => {
    const provider = fakeProvider();
    const { result, rerender } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.analysis?.currentCount).toBe(3);

    const propertyOnly: CrimeGroup[] = ['property'];
    rerender(input({ provider, activeGroups: propertyOnly }));

    expect(result.current.status).toBe('ready');
    expect(result.current.analysis).toMatchObject({ currentCount: 2, violentCount: 0 });
    expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledOnce();
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
  });

  it('divides densities by the area inside the provider\'s city limits', async () => {
    // Times Square: the 1–3 km annulus reaches across the Hudson into New Jersey.
    const nearby = incident('nearby-1', 'theft', CURRENT_DAY, [-73.9655, 40.758]);
    const provider = { ...fakeProvider([...DEFAULT_INCIDENTS, nearby]), meta: { ...META, id: 'new-york' } };
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const evidence = result.current.evidence!;
    expect(evidence.areaCoverage.selected).toBe(1);
    expect(evidence.areaCoverage.nearby).toBeLessThan(1);

    const analysisWith = (areaCoverage = evidence.areaCoverage) => analyzeIncidents({
      incidents: evidence.incidents,
      center: CENTER,
      radiusMeters: 1000,
      window: evidence.window,
      activeGroups: CRIME_GROUPS,
      truncation: evidence.truncation,
      areaCoverage,
    });
    expect(result.current.analysis?.relativeActivity).toBe(analysisWith().relativeActivity);
    expect(result.current.analysis?.relativeActivity).toBeCloseTo(
      (analysisWith(FULL_AREA_COVERAGE).relativeActivity ?? Number.NaN) * evidence.areaCoverage.nearby,
      10,
    );
  });

  it('passes truncation into the analysis when every query hit its record limit', async () => {
    const provider = fakeProvider();
    provider.fetchIncidents.mockResolvedValue({ ...batch(DEFAULT_INCIDENTS), truncated: true });
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    // The truncated comparison query triggers a separate selected-circle query.
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(3);
    expect(result.current.evidence?.truncation).toEqual({ selectedCurrent: true, selectedPrevious: true, comparison: true });
    expect(result.current.analysis).toMatchObject({
      confidence: 'low',
      currentCountIsLowerBound: true,
      trendDirection: 'unavailable',
      trendUnavailableReason: 'record-limit',
      relativeActivity: null,
      comparisonUnavailableReason: 'record-limit',
    });
  });

  it('keeps the selected-area trend when only the comparison query hit its limit', async () => {
    const provider = fakeProvider();
    provider.fetchIncidents.mockImplementation(async (query) => ({
      ...batch(DEFAULT_INCIDENTS),
      truncated: query.radiusMeters > 1000,
    }));
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.evidence?.truncation).toEqual({ selectedCurrent: false, selectedPrevious: false, comparison: true });
    expect(result.current.analysis).toMatchObject({
      currentCount: 3,
      currentCountIsLowerBound: false,
      trendDirection: 'up',
      trendUnavailableReason: null,
      relativeActivity: null,
      comparisonUnavailableReason: 'record-limit',
    });
  });

  it('explains a shared load that ran into its own timeout', async () => {
    const provider = fakeProvider();
    provider.fetchLatestRecordEpoch.mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'));
    const { result } = renderAnalysis(input({ provider }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('The official data portal took too long to respond.');
  });

  it('clears the provider cache on refresh so the newest record is checked again', async () => {
    const provider = { ...fakeProvider(), resetCache: vi.fn() };
    const { result } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(provider.resetCache).not.toHaveBeenCalled();

    act(() => result.current.refresh());
    expect(provider.resetCache).toHaveBeenCalledOnce();
    await waitFor(() => expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('returns to idle when the place leaves coverage', async () => {
    const provider = fakeProvider();
    const { result, rerender } = renderAnalysis(input({ provider }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender(input({ provider: null }));

    expect(result.current).toMatchObject({ status: 'idle', evidence: null, analysis: null, error: null });
  });
});
