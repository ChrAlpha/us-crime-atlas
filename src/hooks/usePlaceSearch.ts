import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadStatus, SelectedPlace } from '../types';

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
export const MIN_QUERY_LENGTH = 3;
export const MAX_RESULTS = 6;

interface NominatimResult {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
}

export interface PlaceSearchState {
  status: LoadStatus;
  results: SelectedPlace[];
  error: string | null;
  search(query: string): Promise<void>;
  clear(): void;
}

const resultCache = new Map<string, SelectedPlace[]>();

export function clearPlaceSearchCache(): void {
  resultCache.clear();
}

function trimmed(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNominatimResult(result: NominatimResult): SelectedPlace | null {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const display = trimmed(result.display_name) || trimmed(result.name);
  if (!display) return null;
  const parts = display.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    label: trimmed(result.name) || parts[0] || 'Selected place',
    detail: parts.slice(1, 5).join(', '),
    coordinates: [longitude, latitude],
  };
}

export function placeSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'us',
    addressdetails: '1',
    limit: String(MAX_RESULTS),
  });
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

/** Explicitly submitted (never per-keystroke) US place search through OpenStreetMap Nominatim. */
export function usePlaceSearch(): PlaceSearchState {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [results, setResults] = useState<SelectedPlace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const clear = useCallback(() => {
    controller.current?.abort();
    setResults([]);
    setError(null);
    setStatus('idle');
  }, []);

  const search = useCallback(async (raw: string) => {
    const query = raw.trim();
    // Any newer search supersedes one still in flight, including answers served from cache.
    controller.current?.abort();
    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError('Enter at least three characters.');
      setStatus('error');
      return;
    }

    const key = query.toLowerCase();
    const cached = resultCache.get(key);
    if (cached) {
      setResults(cached);
      setError(cached.length === 0 ? 'No matching US place was found.' : null);
      setStatus('ready');
      return;
    }

    const current = new AbortController();
    controller.current = current;
    setStatus('loading');
    setError(null);

    try {
      const response = await fetch(placeSearchUrl(query), {
        headers: { Accept: 'application/json' },
        signal: current.signal,
      });
      if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('Place search returned an unexpected response');
      const next = payload
        .map((result) => normalizeNominatimResult(result as NominatimResult))
        .filter((place): place is SelectedPlace => place !== null);
      resultCache.set(key, next);
      setResults(next);
      setError(next.length === 0 ? 'No matching US place was found.' : null);
      setStatus('ready');
    } catch (reason) {
      if (current.signal.aborted) return;
      setResults([]);
      setError(reason instanceof Error ? reason.message : 'Place search failed.');
      setStatus('error');
    }
  }, []);

  return { status, results, error, search, clear };
}
