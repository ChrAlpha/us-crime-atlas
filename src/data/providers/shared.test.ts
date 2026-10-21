import { describe, expect, it, vi } from 'vitest';
import type { Incident, IncidentQuery } from '../../types';
import {
  abortable,
  abortError,
  fetchJson,
  fetchPages,
  incidentsInRange,
  isNonNull,
  numberValue,
  publicCoordinates,
  sharedResource,
  textValue,
  uniqueIncidents,
  type PageResult,
} from './shared';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function incident(id: string, occurredAtEpochMs: number): Incident {
  return {
    id,
    providerId: 'test',
    occurredAt: new Date(occurredAtEpochMs).toISOString().slice(0, 19),
    occurredAtEpochMs,
    localHour: 12,
    category: 'theft',
    group: 'property',
    rawCategory: 'THEFT',
    description: 'THEFT',
    locationLabel: 'Block',
    coordinates: [0, 0],
    severity: 1.3,
    isViolent: false,
    precision: 'block',
  };
}

describe('abortError', () => {
  it('uses the signal reason when there is one', () => {
    const controller = new AbortController();
    controller.abort('stop');
    expect(abortError(controller.signal)).toBe('stop');
  });

  it('falls back to a DOM AbortError', () => {
    const error = abortError();
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('abortable', () => {
  it('returns the original promise without a signal', () => {
    const promise = Promise.resolve(1);
    expect(abortable(promise)).toBe(promise);
  });

  it('rejects immediately for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops one caller waiting without settling the shared promise', async () => {
    const shared = deferred<string>();
    const controller = new AbortController();
    const waiting = abortable(shared.promise, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    shared.resolve('still delivered');
    await expect(shared.promise).resolves.toBe('still delivered');
  });

  it('passes values and errors through and ignores a later abort', async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.resolve('value'), controller.signal)).resolves.toBe('value');
    await expect(abortable(Promise.reject(new Error('failed')), controller.signal)).rejects.toThrow('failed');
    controller.abort();
  });
});

describe('sharedResource', () => {
  it('runs one load for overlapping callers', async () => {
    const load = vi.fn(async () => 'fields');
    const get = sharedResource(load);
    await expect(Promise.all([get(), get(), get()])).resolves.toEqual(['fields', 'fields', 'fields']);
    expect(load).toHaveBeenCalledOnce();
  });

  it('is not poisoned when the first caller aborts (React StrictMode double effect)', async () => {
    const pending = deferred<string>();
    const loadSignals: AbortSignal[] = [];
    const get = sharedResource((signal) => {
      loadSignals.push(signal);
      return pending.promise;
    });

    const firstEffect = new AbortController();
    const first = get(firstEffect.signal);
    const secondEffect = new AbortController();
    const second = get(secondEffect.signal);
    firstEffect.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadSignals).toHaveLength(1);
    expect(loadSignals[0]).not.toBe(firstEffect.signal);
    expect(loadSignals[0]?.aborted).toBe(false);

    pending.resolve('resolved fields');
    await expect(second).resolves.toBe('resolved fields');
    await expect(get()).resolves.toBe('resolved fields');
    expect(loadSignals).toHaveLength(1);
  });

  it('does not cache failures', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('metadata returned HTTP 503'))
      .mockResolvedValueOnce('recovered');
    const get = sharedResource(load);
    await expect(get()).rejects.toThrow('HTTP 503');
    await expect(get()).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('expires successful values after the TTL', async () => {
    let now = 1_000;
    const load = vi.fn(async () => now);
    const get = sharedResource(load, { ttlMs: 100, now: () => now });
    await expect(get()).resolves.toBe(1_000);
    now = 1_099;
    await expect(get()).resolves.toBe(1_000);
    now = 1_100;
    await expect(get()).resolves.toBe(1_100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps values for the session without a TTL and reloads after reset', async () => {
    const load = vi.fn(async () => 'value');
    const get = sharedResource(load);
    await get();
    await get();
    expect(load).toHaveBeenCalledOnce();
    get.reset();
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale failure evict a newer load', async () => {
    const stale = deferred<string>();
    const fresh = deferred<string>();
    const load = vi.fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const get = sharedResource(load);

    const first = get();
    get.reset();
    const second = get();
    stale.reject(new Error('stale'));
    await expect(first).rejects.toThrow('stale');

    fresh.resolve('fresh');
    await expect(second).resolves.toBe('fresh');
    await expect(get()).resolves.toBe('fresh');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('fetchJson', () => {
  it('requests JSON and returns the parsed payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await expect(fetchJson('https://example.test/a', 'Example', controller.signal)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/a', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    await fetchJson('https://example.test/b', 'Example');
    expect(fetchMock).toHaveBeenLastCalledWith('https://example.test/b', {
      headers: { Accept: 'application/json' },
      signal: null,
    });
  });

  it('names the source on HTTP and parse failures', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>', { status: 200 })));
    await expect(fetchJson('https://example.test', 'NYPD')).rejects.toThrow('NYPD returned HTTP 503');
    await expect(fetchJson('https://example.test', 'NYPD')).rejects.toThrow('NYPD returned a response that is not JSON');
  });
});

describe('fetchPages', () => {
  const pageOf = (offset: number, size: number): PageResult<number> => ({
    rows: Array.from({ length: size }, (_, index) => offset + index),
  });

  /** A paged source with `total` rows. */
  function source(total: number, pageSize: number) {
    return vi.fn(async (offset: number) => pageOf(offset, Math.max(0, Math.min(pageSize, total - offset))));
  }

  it('returns a single short page without further requests', async () => {
    const fetchPage = source(3, 10);
    await expect(fetchPages(fetchPage, 10, 4)).resolves.toEqual({ rows: [0, 1, 2], truncated: false });
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('marks a full page as truncated when only one page is permitted', async () => {
    const fetchPage = source(50, 10);
    const fetchCount = vi.fn(async () => 50);
    const result = await fetchPages(fetchPage, 10, 1, fetchCount);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(10);
    expect(fetchCount).not.toHaveBeenCalled();
  });

  it('requests exactly the pages a count calls for', async () => {
    const fetchPage = source(25, 10);
    const result = await fetchPages(fetchPage, 10, 5, async () => 25);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 10, 20]);
    expect(result.rows).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(result.truncated).toBe(false);
  });

  it('requests only the first page for a small or empty count', async () => {
    for (const total of [0, 7, 10]) {
      const fetchPage = source(total, 10);
      const result = await fetchPages(fetchPage, 10, 5, async () => total);
      expect(fetchPage).toHaveBeenCalledOnce();
      expect(result).toEqual({ rows: pageOf(0, total).rows, truncated: false });
    }
  });

  it('caps counted pages at the budget and reports truncation', async () => {
    const fetchPage = source(65, 10);
    const result = await fetchPages(fetchPage, 10, 5, async () => 65);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 10, 20, 30, 40]);
    expect(result.rows).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('reports truncation when the service serves smaller pages than counted', async () => {
    // A layer whose own cap (4) is below the assumed page size skips rows at each counted offset.
    const fetchPage = source(25, 4);
    const result = await fetchPages(fetchPage, 10, 5, async () => 25);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 10, 20]);
    expect(result.rows).toHaveLength(12);
    expect(result.truncated).toBe(true);
  });

  it('reports truncation when rows disappear between the count and the pages', async () => {
    const result = await fetchPages(source(18, 10), 10, 5, async () => 20);
    expect(result.rows).toHaveLength(18);
    expect(result.truncated).toBe(true);
  });

  it('is not truncated when the pages return exactly the counted rows or more', async () => {
    expect((await fetchPages(source(20, 10), 10, 5, async () => 20)).truncated).toBe(false);
    // A row published after the count was taken does not hide anything.
    const grown = await fetchPages(source(21, 10), 10, 5, async () => 20);
    expect(grown.rows).toHaveLength(20);
    expect(grown.truncated).toBe(false);
  });

  it('starts the first page before the count resolves', async () => {
    const count = deferred<number>();
    const fetchPage = source(15, 10);
    const result = fetchPages(fetchPage, 10, 5, () => count.promise);
    expect(fetchPage).toHaveBeenCalledWith(0);
    count.resolve(15);
    await expect(result).resolves.toMatchObject({ truncated: false });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a failed count', () => Promise.reject(new Error('count failed'))],
    ['an invalid count', async () => Number.NaN],
    ['a negative count', async () => -1],
  ])('falls back to speculative pages after %s', async (_label, fetchCount) => {
    const fetchPage = source(25, 10);
    const result = await fetchPages(fetchPage, 10, 5, fetchCount);
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 10, 20, 30, 40]);
    expect(result.rows).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(result.truncated).toBe(false);
  });

  it('reports truncation when every speculative page is full', async () => {
    const result = await fetchPages(source(1_000, 10), 10, 3);
    expect(result.rows).toHaveLength(30);
    expect(result.truncated).toBe(true);
  });

  it('treats a service "more rows" flag as a full page', async () => {
    const fetchPage = vi.fn(async (offset: number): Promise<PageResult<number>> => (
      offset === 0 ? { rows: [1], hasMore: true } : { rows: [2] }
    ));
    const result = await fetchPages(fetchPage, 10, 3);
    expect(result).toEqual({ rows: [1, 2], truncated: false });
    const single = await fetchPages(async () => ({ rows: [1], hasMore: true }), 10, 1);
    expect(single.truncated).toBe(true);
  });

  it('propagates a first-page failure while the count is pending', async () => {
    const count = deferred<number>();
    const result = fetchPages(() => Promise.reject(new Error('page failed')), 10, 5, () => count.promise);
    count.resolve(30);
    await expect(result).rejects.toThrow('page failed');
  });

  it('propagates a first-page failure without a usable count', async () => {
    await expect(
      fetchPages(() => Promise.reject(new Error('page failed')), 10, 5, () => Promise.reject(new Error('count failed'))),
    ).rejects.toThrow('page failed');
  });
});

describe('incident collections', () => {
  it('keeps the first incident for each id', () => {
    const first = incident('a', 1);
    expect(uniqueIncidents([first, incident('b', 2), incident('a', 3)])).toEqual([first, incident('b', 2)]);
  });

  it('applies the half-open query range and de-duplicates', () => {
    const query: IncidentQuery = { center: [0, 0], radiusMeters: 1000, startEpochMs: 100, endEpochMs: 200 };
    const kept = incidentsInRange(
      [incident('before', 99), incident('start', 100), incident('start', 100), incident('last', 199), incident('end', 200)],
      query,
    );
    expect(kept.map((item) => item.id)).toEqual(['start', 'last']);
  });
});

describe('value helpers', () => {
  it('detects present values', () => {
    expect([0, '', null, undefined, false].filter(isNonNull)).toEqual([0, '', false]);
  });

  it('reads trimmed text and finite numbers as text', () => {
    expect(textValue('  THEFT ')).toBe('THEFT');
    expect(textValue(42)).toBe('42');
    expect(textValue('   ', 'fallback')).toBe('fallback');
    expect(textValue(Number.NaN, 'fallback')).toBe('fallback');
    expect(textValue(null)).toBe('');
    expect(textValue({ value: 'x' }, 'fallback')).toBe('fallback');
  });

  it.each([
    [12.5, 12.5],
    ['12.5', 12.5],
    [' -87.6 ', -87.6],
    [0, 0],
    ['', null],
    ['   ', null],
    ['abc', null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [null, null],
    [undefined, null],
    [true, null],
    [{}, null],
  ])('reads %j as number %j', (value, expected) => {
    expect(numberValue(value)).toBe(expected);
  });

  it('accepts published coordinates and rejects sentinels and out-of-range values', () => {
    expect(publicCoordinates('-87.6298', '41.8837')).toEqual([-87.6298, 41.8837]);
    expect(publicCoordinates(-180, 90)).toEqual([-180, 90]);
    expect(publicCoordinates(0, 0)).toBeNull();
    expect(publicCoordinates('0.00001', '-0.00001')).toBeNull();
    expect(publicCoordinates(-87.6, 91)).toBeNull();
    expect(publicCoordinates(-181, 41)).toBeNull();
    expect(publicCoordinates('REDACTED', '41')).toBeNull();
    expect(publicCoordinates(null, 41)).toBeNull();
    expect(publicCoordinates(-87, '')).toBeNull();
  });
});
