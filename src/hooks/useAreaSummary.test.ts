import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSnapshot, geography } from '../test/agencyFixtures';
import type { Coordinates } from '../types';

vi.mock('../data/agencyStats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/agencyStats')>()),
  lookupCensusGeography: vi.fn(),
  loadAgencySnapshot: vi.fn(),
}));

const { loadAgencySnapshot, lookupCensusGeography } = await import('../data/agencyStats');
const { AREA_SUMMARY_TIMEOUT_MS, clearAreaSummaryCache, loadAreaSummary, useAreaSummary } = await import('./useAreaSummary');

const mockedLookup = vi.mocked(lookupCensusGeography);
const mockedSnapshot = vi.mocked(loadAgencySnapshot);
const POINT: Coordinates = [-122.27, 37.8];

beforeEach(() => {
  vi.clearAllMocks();
  clearAreaSummaryCache();
  mockedLookup.mockResolvedValue(geography());
  mockedSnapshot.mockResolvedValue(fixtureSnapshot());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadAreaSummary', () => {
  it('summarizes the matched agency', async () => {
    const result = await loadAreaSummary(POINT);
    expect(result.kind).toBe('agency');
    if (result.kind === 'agency') expect(result.summary.match.ori).toBe('CA0000001');
  });

  it('falls back to the state when no agency matches or the agency is silent', async () => {
    mockedLookup.mockResolvedValueOnce(geography({ place: null, countyFips: '06003', countySubdivision: null }));
    await expect(loadAreaSummary(POINT)).resolves.toMatchObject({ kind: 'state', agencyName: null });

    mockedLookup.mockResolvedValueOnce(geography({ place: { geoid: '0600004', name: 'Silent city' } }));
    await expect(loadAreaSummary(POINT)).resolves.toMatchObject({
      kind: 'state',
      agencyName: 'Silent City Police Department',
    });
  });

  it('reports points outside the states', async () => {
    mockedLookup.mockResolvedValueOnce(null);
    await expect(loadAreaSummary(POINT)).resolves.toEqual({ kind: 'outside' });

    mockedSnapshot.mockResolvedValueOnce(null);
    await expect(loadAreaSummary(POINT)).resolves.toEqual({ kind: 'outside' });
  });
});

describe('useAreaSummary', () => {
  it('stays idle while a local feed covers the point', () => {
    const { result } = renderHook(() => useAreaSummary(POINT, false));
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('loads, caches, and refreshes a summary', async () => {
    const { result, rerender } = renderHook(({ center }) => useAreaSummary(center, true), {
      initialProps: { center: POINT },
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result?.kind).toBe('agency');

    rerender({ center: [-122.27, 37.8] as Coordinates });
    expect(mockedLookup).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(mockedLookup).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('serves a cached summary to a new consumer', async () => {
    await loadAreaSummary(POINT);
    const first = renderHook(() => useAreaSummary(POINT, true));
    await waitFor(() => expect(first.result.current.status).toBe('ready'));
    const second = renderHook(() => useAreaSummary(POINT, true));
    expect(second.result.current.status).toBe('ready');
    expect(mockedLookup).toHaveBeenCalledTimes(2);
  });

  it('reports failures and recovers on refresh', async () => {
    mockedLookup.mockRejectedValueOnce(new Error('Census TIGERweb returned HTTP 503'));
    const { result } = renderHook(() => useAreaSummary(POINT, true));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Census TIGERweb returned HTTP 503');

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
  });

  it('names a generic failure', async () => {
    mockedLookup.mockRejectedValueOnce('offline');
    const { result } = renderHook(() => useAreaSummary(POINT, true));
    await waitFor(() => expect(result.current.error).toBe('The Census geography service could not be reached.'));
  });

  it('times out a slow geography lookup', async () => {
    vi.useFakeTimers();
    mockedLookup.mockImplementationOnce((_point, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { result } = renderHook(() => useAreaSummary(POINT, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AREA_SUMMARY_TIMEOUT_MS);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('The Census geography service did not respond within 20 seconds.');
  });

  it('ignores a request cancelled by a new point', async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined;
    mockedLookup.mockImplementationOnce((_point, signal) => new Promise((_resolve, reject) => {
      rejectFirst = reject;
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { result, rerender } = renderHook(({ center }) => useAreaSummary(center, true), {
      initialProps: { center: POINT },
    });
    rerender({ center: [-122.4, 37.7] as Coordinates });
    rejectFirst(new Error('late failure'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeNull();
  });
});
