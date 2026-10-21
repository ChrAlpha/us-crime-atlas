import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadEvidence } from '../data/evidence';
import { analyzeIncidents } from '../domain/analysis';
import type {
  AnalysisResult,
  Coordinates,
  CrimeGroup,
  EvidenceBundle,
  IncidentProvider,
  LoadStatus,
} from '../types';

export const EVIDENCE_CACHE_TTL_MS = 5 * 60_000;
export const EVIDENCE_TIMEOUT_MS = 45_000;

interface CachedEvidence {
  evidence: EvidenceBundle;
  storedAt: number;
}

const evidenceCache = new Map<string, CachedEvidence>();

export function clearEvidenceCache(): void {
  evidenceCache.clear();
}

export interface IncidentAnalysisInput {
  provider: IncidentProvider | null;
  center: Coordinates;
  radiusMeters: number;
  windowDays: number;
  activeGroups: readonly CrimeGroup[];
}

export interface IncidentAnalysisState {
  status: LoadStatus;
  analysis: AnalysisResult | null;
  evidence: EvidenceBundle | null;
  error: string | null;
  refresh(): void;
}

export function evidenceKey(provider: IncidentProvider, center: Coordinates, radiusMeters: number, windowDays: number) {
  return [provider.meta.id, center[0].toFixed(4), center[1].toFixed(4), radiusMeters, windowDays].join(':');
}

function failureMessage(reason: unknown, timedOut: boolean) {
  if (timedOut) {
    return `The official data portal did not respond within ${EVIDENCE_TIMEOUT_MS / 1000} seconds.`;
  }
  // A shared load (dataset metadata, newest record) ran into its own timeout.
  if (reason instanceof DOMException && reason.name === 'TimeoutError') {
    return 'The official data portal took too long to respond.';
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return 'The official data portal could not be reached.';
}

/**
 * Loads official evidence for the selected place and analyzes it.
 *
 * Results are keyed by request, so a result for a previous place is never re-analyzed
 * around a new center while the new request is in flight. Changing incident groups only
 * re-runs the analysis.
 */
export function useIncidentAnalysis({
  provider,
  center,
  radiusMeters,
  windowDays,
  activeGroups,
}: IncidentAnalysisInput): IncidentAnalysisState {
  const key = provider ? evidenceKey(provider, center, radiusMeters, windowDays) : null;
  const [loaded, setLoaded] = useState<{ key: string; evidence: EvidenceBundle } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latestRequest = useRef(0);

  const refresh = useCallback(() => {
    if (key) evidenceCache.delete(key);
    // Also re-check the newest published record and dataset metadata.
    provider?.resetCache?.();
    setVersion((value) => value + 1);
  }, [key, provider]);

  useEffect(() => {
    const request = ++latestRequest.current;
    if (!provider || !key) {
      setPendingKey(null);
      return undefined;
    }

    const cached = evidenceCache.get(key);
    if (cached && Date.now() - cached.storedAt < EVIDENCE_CACHE_TTL_MS) {
      setLoaded({ key, evidence: cached.evidence });
      setFailure(null);
      setPendingKey(null);
      return undefined;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EVIDENCE_TIMEOUT_MS);

    setPendingKey(key);
    setFailure(null);
    loadEvidence(provider, { center, radiusMeters, windowDays, now: new Date(), signal: controller.signal })
      .then((evidence) => {
        if (request !== latestRequest.current) return;
        evidenceCache.set(key, { evidence, storedAt: Date.now() });
        setLoaded({ key, evidence });
        setPendingKey(null);
      })
      .catch((reason: unknown) => {
        if (request !== latestRequest.current || (controller.signal.aborted && !timedOut)) return;
        setFailure({ key, message: failureMessage(reason, timedOut) });
        setPendingKey(null);
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
    // `center`, `radiusMeters` and `windowDays` are captured by `key`; depending on the
    // coordinate tuple's identity would refetch on every render.
  }, [key, provider, version]);

  const evidence = loaded && loaded.key === key ? loaded.evidence : null;
  const groupsKey = activeGroups.join(',');
  const analysis = useMemo(() => {
    if (!evidence) return null;
    return analyzeIncidents({
      incidents: evidence.incidents,
      center,
      radiusMeters,
      window: evidence.window,
      activeGroups,
      truncation: evidence.truncation,
      areaCoverage: evidence.areaCoverage,
    });
    // `groupsKey` stands in for `activeGroups`; `center` and `radiusMeters` belong to the evidence key.
  }, [evidence, groupsKey]);

  let status: LoadStatus = 'idle';
  if (provider) {
    if (pendingKey === key) status = 'loading';
    else if (failure?.key === key) status = 'error';
    else if (evidence) status = 'ready';
    else status = 'loading';
  }

  return {
    status,
    analysis,
    evidence,
    error: failure?.key === key ? failure.message : null,
    refresh,
  };
}
