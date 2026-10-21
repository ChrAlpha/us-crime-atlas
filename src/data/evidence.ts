import { COMPARISON_RADIUS_MULTIPLIER, NO_TRUNCATION } from '../domain/analysis';
import { computeEvidenceWindow, datasetStartEpoch } from '../domain/evidenceWindow';
import { toLocalClockEpoch } from '../domain/time';
import type { Coordinates, EvidenceBundle, EvidenceTruncation, IncidentBatch, IncidentProvider } from '../types';
import { areaCoverageFor } from './jurisdictions';
import { uniqueIncidents } from './providers/shared';

export interface EvidenceRequest {
  center: Coordinates;
  radiusMeters: number;
  windowDays: number;
  now: Date;
  signal?: AbortSignal | undefined;
}

/**
 * Loads everything one analysis needs from a provider.
 *
 * 1. Find the newest published record and anchor equal windows to it, excluding the
 *    provider's trailing days that are still filling in.
 * 2. In parallel, fetch the current window across the whole comparison area (selected circle
 *    plus nearby annulus) and the previous window across the selected circle only.
 * 3. If the comparison query hit its record budget, its oldest rows are missing for the
 *    selected circle too, so the circle's current window is fetched again on its own budget.
 *    The trend therefore always compares two complete, or explicitly truncated, circle windows.
 */
export async function loadEvidence(
  provider: IncidentProvider,
  { center, radiusMeters, windowDays, now, signal }: EvidenceRequest,
): Promise<EvidenceBundle> {
  const { meta } = provider;
  const latestRecordEpochMs = await provider.fetchLatestRecordEpoch(signal);
  const nowEpochMs = toLocalClockEpoch(now.getTime(), meta.timeZone);
  const window = computeEvidenceWindow({
    windowDays,
    nowEpochMs,
    latestRecordEpochMs,
    settlingDays: meta.settlingDays,
    datasetStartEpochMs: datasetStartEpoch(meta.datasetStart, latestRecordEpochMs, nowEpochMs),
  });

  const areaCoverage = areaCoverageFor(meta.id, center, radiusMeters, COMPARISON_RADIUS_MULTIPLIER);

  const bundle = (batches: IncidentBatch[], truncation: EvidenceTruncation): EvidenceBundle => ({
    provider: meta,
    window,
    incidents: uniqueIncidents(batches.flatMap((batch) => batch.incidents)),
    // Only meaningful when a request was made; an empty bundle has no limit to report.
    recordLimit: batches.length > 0 ? Math.min(...batches.map((batch) => batch.recordLimit)) : 0,
    truncation,
    areaCoverage,
    requestUrls: batches.flatMap((batch) => batch.requestUrls),
    fetchedAt: now.toISOString(),
  });

  // Nothing was published in the lookback period, so there is nothing to query or compare.
  if (latestRecordEpochMs === null) return bundle([], NO_TRUNCATION);

  const [comparison, previous] = await Promise.all([
    provider.fetchIncidents({
      center,
      radiusMeters: radiusMeters * COMPARISON_RADIUS_MULTIPLIER,
      startEpochMs: window.currentStartEpochMs,
      endEpochMs: window.endEpochMs,
      signal,
    }),
    provider.fetchIncidents({
      center,
      radiusMeters,
      startEpochMs: window.previousStartEpochMs,
      endEpochMs: window.currentStartEpochMs,
      signal,
    }),
  ]);

  const selectedCurrent = comparison.truncated
    ? await provider.fetchIncidents({
        center,
        radiusMeters,
        startEpochMs: window.currentStartEpochMs,
        endEpochMs: window.endEpochMs,
        signal,
      })
    : null;

  return bundle(selectedCurrent ? [selectedCurrent, comparison, previous] : [comparison, previous], {
    selectedCurrent: selectedCurrent?.truncated ?? false,
    selectedPrevious: previous.truncated,
    comparison: comparison.truncated,
  });
}
