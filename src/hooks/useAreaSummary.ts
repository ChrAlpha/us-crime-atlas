import { useCallback, useEffect, useState } from 'react';
import { loadAgencySnapshot, lookupCensusGeography, matchAgency } from '../data/agencyStats';
import type { AgencySnapshot } from '../data/agencyStats.types';
import { summarizeAgency, summarizeState, type AgencySummary, type StateSummary } from '../domain/agencySummary';
import type { Coordinates, LoadStatus } from '../types';

export const AREA_SUMMARY_TIMEOUT_MS = 20_000;

export type AreaSummary =
  | { kind: 'agency'; summary: AgencySummary; snapshot: AgencySnapshot }
  /** No agency in the snapshot covers the point, or it reported nothing; `agencyName` names a silent agency. */
  | { kind: 'state'; summary: StateSummary; snapshot: AgencySnapshot; agencyName: string | null }
  | { kind: 'outside' };

export interface AreaSummaryState {
  status: LoadStatus;
  result: AreaSummary | null;
  error: string | null;
  refresh(): void;
}

export async function loadAreaSummary(point: Coordinates, signal?: AbortSignal): Promise<AreaSummary> {
  const geography = await lookupCensusGeography(point, signal);
  if (!geography) return { kind: 'outside' };
  const snapshot = await loadAgencySnapshot(geography.stateFips);
  if (!snapshot) return { kind: 'outside' };

  const match = matchAgency(geography, snapshot);
  const summary = match ? summarizeAgency(match, snapshot) : null;
  if (summary) return { kind: 'agency', summary, snapshot };
  return { kind: 'state', summary: summarizeState(snapshot), snapshot, agencyName: match?.agency.name ?? null };
}

const summaryCache = new Map<string, AreaSummary>();

export function clearAreaSummaryCache(): void {
  summaryCache.clear();
}

function failureMessage(reason: unknown, timedOut: boolean): string {
  if (timedOut) return `The Census geography service did not respond within ${AREA_SUMMARY_TIMEOUT_MS / 1000} seconds.`;
  if (reason instanceof Error && reason.message) return reason.message;
  return 'The Census geography service could not be reached.';
}

/**
 * Jurisdiction-wide FBI totals for a point outside every local incident feed. Disabled
 * (idle) while a local provider covers the point.
 */
export function useAreaSummary(center: Coordinates, enabled: boolean): AreaSummaryState {
  const key = enabled ? `${center[0].toFixed(4)}:${center[1].toFixed(4)}` : null;
  const [loaded, setLoaded] = useState<{ key: string; result: AreaSummary } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => {
    if (key) summaryCache.delete(key);
    setVersion((value) => value + 1);
  }, [key]);

  useEffect(() => {
    if (!key) return undefined;
    const cached = summaryCache.get(key);
    if (cached) {
      setLoaded({ key, result: cached });
      return undefined;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AREA_SUMMARY_TIMEOUT_MS);
    setFailure(null);
    loadAreaSummary([center[0], center[1]], controller.signal)
      .then((result) => {
        summaryCache.set(key, result);
        setLoaded({ key, result });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        setFailure({ key, message: failureMessage(reason, timedOut) });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // `center` is captured by `key`.
  }, [key, version]);

  const result = loaded?.key === key ? loaded.result : null;
  let status: LoadStatus = 'idle';
  if (key) {
    if (failure?.key === key) status = 'error';
    else if (result) status = 'ready';
    else status = 'loading';
  }
  return { status, result: key ? result : null, error: failure?.key === key ? failure.message : null, refresh };
}
