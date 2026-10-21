import type { EvidenceWindow, ProviderMeta } from '../types';
import { DAY_MS, sourceTimestampToEpoch, startOfDay } from './time';

/** A feed whose newest record is at least this many days old is called out as delayed. */
export const DELAYED_FEED_DAYS = 3;

export interface EvidenceWindowInput {
  windowDays: number;
  /** Now in the provider's local-clock frame. */
  nowEpochMs: number;
  latestRecordEpochMs: number | null;
  /** Trailing published days still filling in; see `ProviderMeta.settlingDays`. */
  settlingDays?: number;
  /** First day the dataset covers; see `datasetStartEpoch`. */
  datasetStartEpochMs?: number | null;
}

/**
 * Resolves `ProviderMeta.datasetStart` to a local-clock epoch. Year-to-date files restart
 * on January 1 of the newest record's year.
 */
export function datasetStartEpoch(
  datasetStart: ProviderMeta['datasetStart'],
  latestRecordEpochMs: number | null,
  nowEpochMs: number,
): number | null {
  if (datasetStart === null) return null;
  if (datasetStart === 'calendar-year') {
    return Date.UTC(new Date(latestRecordEpochMs ?? nowEpochMs).getUTCFullYear(), 0, 1);
  }
  const epoch = sourceTimestampToEpoch(datasetStart);
  if (!Number.isFinite(epoch)) throw new Error(`Invalid dataset start ${datasetStart}`);
  return epoch;
}

/**
 * Anchors equal current and previous windows to the provider's publication horizon.
 *
 * Publishers release on different schedules (NYPD quarterly, Chicago with a seven-day hold,
 * others daily), and the newest days of a daily feed are still filling in. Ending the window
 * "now" would count unpublished days as quiet days and bias the equal-window trend downward,
 * so the window ends `settlingDays` before the end of the newest record's day.
 * Future-dated rows never push the window past today.
 */
export function computeEvidenceWindow({
  windowDays,
  nowEpochMs,
  latestRecordEpochMs,
  settlingDays = 0,
  datasetStartEpochMs = null,
}: EvidenceWindowInput): EvidenceWindow {
  const endOfToday = startOfDay(nowEpochMs) + DAY_MS;
  const usableLatest = latestRecordEpochMs !== null && Number.isFinite(latestRecordEpochMs)
    ? Math.min(latestRecordEpochMs, nowEpochMs)
    : null;
  const horizon = usableLatest === null ? endOfToday : startOfDay(usableLatest) + DAY_MS;
  const endEpochMs = horizon - Math.max(0, Math.trunc(settlingDays)) * DAY_MS;
  const currentStartEpochMs = endEpochMs - windowDays * DAY_MS;
  return {
    windowDays,
    previousStartEpochMs: currentStartEpochMs - windowDays * DAY_MS,
    currentStartEpochMs,
    endEpochMs,
    latestRecordEpochMs: usableLatest,
    settlingDays: Math.round((horizon - endEpochMs) / DAY_MS),
    lagDays: Math.round((endOfToday - endEpochMs) / DAY_MS),
    datasetStartEpochMs,
  };
}

/** The last calendar day included in the current window. */
export function lastDayOfWindow(window: EvidenceWindow): number {
  return window.endEpochMs - DAY_MS;
}

/** Whole days between the end of the newest record's day and the end of today. */
export function publicationLagDays(window: EvidenceWindow): number {
  return window.lagDays - window.settlingDays;
}

/** True when the publisher itself is behind; routine settling days alone do not count. */
export function isDelayedFeed(window: EvidenceWindow): boolean {
  return window.latestRecordEpochMs === null || publicationLagDays(window) >= DELAYED_FEED_DAYS;
}

/** The previous window reaches back before the dataset's first day, so it is incomplete. */
export function previousWindowPredatesDataset(window: EvidenceWindow): boolean {
  return window.datasetStartEpochMs !== null && window.previousStartEpochMs < window.datasetStartEpochMs;
}

/** The current window itself starts before the dataset's first day. */
export function currentWindowPredatesDataset(window: EvidenceWindow): boolean {
  return window.datasetStartEpochMs !== null && window.currentStartEpochMs < window.datasetStartEpochMs;
}
