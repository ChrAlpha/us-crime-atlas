import type { Incident, IncidentQuery } from '../../types';

/** Upper bound for one-off loads that are shared between callers (metadata, latest record). */
export const SHARED_LOAD_TIMEOUT_MS = 40_000;

/**
 * The latest-record lookup only scans this far back. A bounded date predicate is markedly
 * faster on large layers, and a feed with nothing newer is treated as having no recent records.
 */
export const LATEST_RECORD_LOOKBACK_DAYS = 400;

export function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Lets one caller stop waiting on `promise` without cancelling it for anyone else.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export interface SharedResourceOptions {
  /** Successful values expire after this many milliseconds. Omit to keep them for the session. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Memoizes an async load across callers.
 *
 * The load runs with its own timeout signal instead of the first caller's, so a cancelled
 * request (React StrictMode, a quick place change) can never poison the shared promise.
 * Failures are not cached.
 */
export function sharedResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { ttlMs, now = Date.now }: SharedResourceOptions = {},
) {
  let entry: { promise: Promise<T>; storedAt: number } | null = null;

  const get = (signal?: AbortSignal): Promise<T> => {
    const expired = entry && ttlMs !== undefined && now() - entry.storedAt >= ttlMs;
    if (!entry || expired) {
      const promise = load(AbortSignal.timeout(SHARED_LOAD_TIMEOUT_MS));
      const current = { promise, storedAt: now() };
      entry = current;
      promise.catch(() => {
        if (entry === current) entry = null;
      });
    }
    return abortable(entry.promise, signal);
  };

  return Object.assign(get, {
    reset() {
      entry = null;
    },
  });
}

export async function fetchJson(url: string, label: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: signal ?? null });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned a response that is not JSON`);
  }
}

export interface PagedResult<Row> {
  rows: Row[];
  /** True when the final permitted page was full, so older rows may be missing. */
  truncated: boolean;
}

export interface PageResult<Row> {
  rows: Row[];
  /** The service says more rows exist beyond this page. */
  hasMore?: boolean;
}

function range(start: number, end: number) {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

/**
 * Fetches up to `maxPages` pages of a query.
 *
 * With `fetchCount`, the count runs alongside the first page and the exact remaining pages
 * start as soon as it resolves; empty pages past the end are never requested (some
 * services take as long to answer an empty page as a full one). Without a count, or if it
 * fails, the remaining pages are requested in parallel only when the first page was full.
 */
export async function fetchPages<Row>(
  fetchPage: (offset: number) => Promise<PageResult<Row>>,
  pageSize: number,
  maxPages: number,
  fetchCount?: () => Promise<number>,
): Promise<PagedResult<Row>> {
  const isFull = (page: PageResult<Row>) => page.rows.length >= pageSize || page.hasMore === true;
  const firstPage = fetchPage(0);
  // The first page is awaited below on every path; this only keeps an early rejection
  // from being reported as unhandled while the count is pending.
  firstPage.catch(() => undefined);

  if (fetchCount && maxPages > 1) {
    const total = await fetchCount().then(
      (count) => (Number.isSafeInteger(count) && count >= 0 ? count : null),
      () => null,
    );
    if (total !== null) {
      const pageCount = Math.min(maxPages, Math.max(1, Math.ceil(total / pageSize)));
      const pages = await Promise.all([
        firstPage,
        ...range(1, pageCount).map((index) => fetchPage(index * pageSize)),
      ]);
      const rows = pages.flatMap((page) => page.rows);
      // Fewer rows than counted means the service served smaller pages than assumed (or
      // rows moved between requests); either way some rows were skipped.
      return { rows, truncated: total > pageSize * maxPages || rows.length < Math.min(total, pageSize * maxPages) };
    }
  }

  const first = await firstPage;
  if (!isFull(first) || maxPages <= 1) {
    return { rows: first.rows, truncated: isFull(first) };
  }

  const rest = await Promise.all(range(1, maxPages).map((index) => fetchPage(index * pageSize)));
  const pages = [first];
  let last = first;
  for (const page of rest) {
    pages.push(page);
    last = page;
    if (!isFull(page)) break;
  }
  return {
    rows: pages.flatMap((page) => page.rows),
    truncated: pages.length === maxPages && isFull(last),
  };
}

/** Keeps the first occurrence of each id. */
export function uniqueIncidents(incidents: Iterable<Incident>): Incident[] {
  const byId = new Map<string, Incident>();
  for (const incident of incidents) {
    if (!byId.has(incident.id)) byId.set(incident.id, incident);
  }
  return [...byId.values()];
}

/** Applies the authoritative half-open time range after the service's coarser predicate. */
export function incidentsInRange(incidents: Iterable<Incident>, query: IncidentQuery): Incident[] {
  return uniqueIncidents(
    [...incidents].filter((incident) => (
      incident.occurredAtEpochMs >= query.startEpochMs && incident.occurredAtEpochMs < query.endEpochMs
    )),
  );
}

export function isNonNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Placeholders some publishers (NYPD) emit instead of an empty value. */
const NULL_TOKEN = /^\(?null\)?$/i;

export function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim() && !NULL_TOKEN.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Validates a published coordinate pair. Rejects null-island zeros, sentinels and
 * out-of-range values that some portals use for redacted locations.
 */
export function publicCoordinates(longitude: unknown, latitude: unknown): readonly [number, number] | null {
  const lon = numberValue(longitude);
  const lat = numberValue(latitude);
  if (lon === null || lat === null) return null;
  if (Math.abs(lon) < 0.0001 && Math.abs(lat) < 0.0001) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}
