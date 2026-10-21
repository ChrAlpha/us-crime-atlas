import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaceSearchCache,
  MAX_RESULTS,
  normalizeNominatimResult,
  NOMINATIM_SEARCH_URL,
  placeSearchUrl,
  usePlaceSearch,
} from './usePlaceSearch';

const TIMES_SQUARE = {
  display_name: 'Times Square, Manhattan, New York County, New York, 10036, United States',
  lat: '40.758',
  lon: '-73.9855',
  name: 'Times Square',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A fetch that only settles when aborted. */
function hangingFetch() {
  const signals: AbortSignal[] = [];
  const fetchMock = stubFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal) {
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }
  }));
  return { fetchMock, signals };
}

beforeEach(() => {
  clearPlaceSearchCache();
});

describe('normalizeNominatimResult', () => {
  it('uses the place name and the next address parts', () => {
    expect(normalizeNominatimResult(TIMES_SQUARE)).toEqual({
      label: 'Times Square',
      detail: 'Manhattan, New York County, New York, 10036',
      coordinates: [-73.9855, 40.758],
    });
  });

  it('falls back to the first display part when the result has no name', () => {
    expect(normalizeNominatimResult({ display_name: '350 5th Ave, Manhattan, New York', lat: '40.7484', lon: '-73.9857' }))
      .toEqual({ label: '350 5th Ave', detail: 'Manhattan, New York', coordinates: [-73.9857, 40.7484] });
  });

  it('uses the name as the display text when there is no display name', () => {
    expect(normalizeNominatimResult({ name: ' Pike Place ', lat: '47.6097', lon: '-122.3422' }))
      .toEqual({ label: 'Pike Place', detail: '', coordinates: [-122.3422, 47.6097] });
  });

  it('labels a result whose display name has no usable parts', () => {
    expect(normalizeNominatimResult({ display_name: ' , ,', lat: '1', lon: '2' }))
      .toEqual({ label: 'Selected place', detail: '', coordinates: [2, 1] });
  });

  it('rejects results without usable coordinates or text', () => {
    expect(normalizeNominatimResult({ ...TIMES_SQUARE, lat: 'north' })).toBeNull();
    expect(normalizeNominatimResult({ ...TIMES_SQUARE, lon: undefined })).toBeNull();
    expect(normalizeNominatimResult({ lat: '1', lon: '2', display_name: '  ', name: 42 })).toBeNull();
  });
});

describe('placeSearchUrl', () => {
  it('limits search to a few US results in JSON', () => {
    const url = new URL(placeSearchUrl('Union Square'));
    expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_SEARCH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Union Square',
      format: 'jsonv2',
      countrycodes: 'us',
      addressdetails: '1',
      limit: String(MAX_RESULTS),
    });
  });
});

describe('usePlaceSearch', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => usePlaceSearch());
    expect(result.current).toMatchObject({ status: 'idle', results: [], error: null });
  });

  it('asks for at least three characters without calling the service', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('  ab '));

    expect(result.current).toMatchObject({ status: 'error', results: [], error: 'Enter at least three characters.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns normalized US places and skips unusable rows', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([TIMES_SQUARE, { lat: 'x', lon: 'y', name: 'Broken' }]));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('  Times Square '));

    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.results).toEqual([normalizeNominatimResult(TIMES_SQUARE)]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get('q')).toBe('Times Square');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
  });

  it('reports loading while the request is in flight', async () => {
    let respond!: (response: Response) => void;
    stubFetch(() => new Promise<Response>((resolve) => {
      respond = resolve;
    }));
    const { result } = renderHook(() => usePlaceSearch());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.search('Times Square');
    });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      respond(jsonResponse([TIMES_SQUARE]));
      await pending;
    });
    expect(result.current.status).toBe('ready');
  });

  it('serves a repeated query from the cache, ignoring case and spacing', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([TIMES_SQUARE]));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Times Square'));
    await act(() => result.current.search('  times square'));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.results).toHaveLength(1);
    expect(result.current.status).toBe('ready');
  });

  it('explains an empty result, including when it comes from the cache', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Nowhere Special'));
    expect(result.current).toMatchObject({ status: 'ready', results: [], error: 'No matching US place was found.' });

    await act(() => result.current.search('nowhere special'));
    expect(result.current.error).toBe('No matching US place was found.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports an HTTP failure', async () => {
    stubFetch(async () => jsonResponse({ error: 'busy' }, 503));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Times Square'));

    expect(result.current).toMatchObject({ status: 'error', results: [], error: 'Place search returned HTTP 503' });
  });

  it('rejects a payload that is not a result list', async () => {
    stubFetch(async () => jsonResponse({ results: [] }));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Times Square'));

    expect(result.current).toMatchObject({ status: 'error', error: 'Place search returned an unexpected response' });
  });

  it('uses a generic message for non-Error failures', async () => {
    stubFetch(() => Promise.reject('offline'));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Times Square'));

    expect(result.current).toMatchObject({ status: 'error', error: 'Place search failed.' });
  });

  it('does not cache failures', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({}, 500));
    const { result } = renderHook(() => usePlaceSearch());

    await act(() => result.current.search('Times Square'));
    fetchMock.mockImplementation(async () => jsonResponse([TIMES_SQUARE]));
    await act(() => result.current.search('Times Square'));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it('aborts the in-flight request and resets when cleared', async () => {
    const { signals } = hangingFetch();
    const { result } = renderHook(() => usePlaceSearch());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.search('Times Square');
    });
    await waitFor(() => expect(signals).toHaveLength(1));

    await act(async () => {
      result.current.clear();
      await pending;
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(result.current).toMatchObject({ status: 'idle', results: [], error: null });
  });

  it('aborts a superseded search when a new one starts', async () => {
    const { signals, fetchMock } = hangingFetch();
    const { result } = renderHook(() => usePlaceSearch());

    act(() => {
      void result.current.search('Times Square');
    });
    act(() => {
      void result.current.search('Union Square');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(result.current.status).toBe('loading');
  });

  it('lets a cached answer supersede a slower request still in flight', async () => {
    const union = { display_name: 'Union Square, Manhattan, New York, United States', lat: '40.7359', lon: '-73.9911', name: 'Union Square' };
    const slowSignals: AbortSignal[] = [];
    stubFetch((input, init) => {
      if (String(input).includes('Union')) return Promise.resolve(jsonResponse([union]));
      return new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        slowSignals.push(signal);
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const { result } = renderHook(() => usePlaceSearch());
    await act(async () => {
      await result.current.search('Union Square');
    });

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.search('Times Square');
    });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await result.current.search('union square');
      await pending;
    });

    expect(slowSignals[0]?.aborted).toBe(true);
    expect(result.current.status).toBe('ready');
    expect(result.current.results.map((place) => place.label)).toEqual(['Union Square']);
  });

  it('aborts an in-flight request when the next query is too short', async () => {
    const { signals } = hangingFetch();
    const { result } = renderHook(() => usePlaceSearch());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.search('Times Square');
    });
    await act(async () => {
      await result.current.search('ab');
      await pending;
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(result.current).toMatchObject({ status: 'error', results: [], error: 'Enter at least three characters.' });
  });

  it('aborts the in-flight request on unmount', async () => {
    const { signals } = hangingFetch();
    const { result, unmount } = renderHook(() => usePlaceSearch());

    act(() => {
      void result.current.search('Times Square');
    });
    unmount();

    expect(signals[0]?.aborted).toBe(true);
  });
});
