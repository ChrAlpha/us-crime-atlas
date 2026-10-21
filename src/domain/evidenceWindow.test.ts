import { describe, expect, it } from 'vitest';
import {
  computeEvidenceWindow,
  currentWindowPredatesDataset,
  datasetStartEpoch,
  DELAYED_FEED_DAYS,
  isDelayedFeed,
  lastDayOfWindow,
  previousWindowPredatesDataset,
  publicationLagDays,
} from './evidenceWindow';
import { DAY_MS } from './time';

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
const NOW = Date.parse('2026-10-21T10:15:00Z');

describe('computeEvidenceWindow', () => {
  it('ends at midnight after the latest record day for a current feed', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.parse('2026-10-21T08:00:00Z'),
    });
    expect(window).toEqual({
      windowDays: 30,
      previousStartEpochMs: day('2026-08-23'),
      currentStartEpochMs: day('2026-09-22'),
      endEpochMs: day('2026-10-22'),
      latestRecordEpochMs: Date.parse('2026-10-21T08:00:00Z'),
      settlingDays: 0,
      lagDays: 0,
      datasetStartEpochMs: null,
    });
    expect(lastDayOfWindow(window)).toBe(day('2026-10-21'));
    expect(isDelayedFeed(window)).toBe(false);
  });

  it('anchors a quarterly feed to its newest published record instead of today', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: day('2026-06-30'),
    });
    expect(window.endEpochMs).toBe(day('2026-07-01'));
    expect(window.currentStartEpochMs).toBe(day('2026-06-01'));
    expect(window.previousStartEpochMs).toBe(day('2026-05-02'));
    expect(lastDayOfWindow(window)).toBe(day('2026-06-30'));
    expect(window.lagDays).toBe(113);
    expect(publicationLagDays(window)).toBe(113);
    expect(isDelayedFeed(window)).toBe(true);
  });

  it('excludes trailing settling days before the newest record day', () => {
    const window = computeEvidenceWindow({
      windowDays: 14,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.parse('2026-10-19T20:49:00Z'),
      settlingDays: 6,
    });
    expect(window.endEpochMs).toBe(day('2026-10-14'));
    expect(window.currentStartEpochMs).toBe(day('2026-09-30'));
    expect(window.previousStartEpochMs).toBe(day('2026-09-16'));
    expect(window.settlingDays).toBe(6);
    expect(window.lagDays).toBe(8);
    expect(publicationLagDays(window)).toBe(2);
    expect(isDelayedFeed(window)).toBe(false);
  });

  it('normalizes negative and fractional settling days', () => {
    const latestRecordEpochMs = Date.parse('2026-10-20T12:00:00Z');
    expect(computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs, settlingDays: -3 }).settlingDays).toBe(0);
    expect(computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs, settlingDays: 2.9 }).settlingDays).toBe(2);
  });

  it('never lets future-dated rows push the window past today', () => {
    const window = computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: Date.parse('2062-01-01T00:00:00Z'),
    });
    expect(window.latestRecordEpochMs).toBe(NOW);
    expect(window.endEpochMs).toBe(day('2026-10-22'));
    expect(window.lagDays).toBe(0);
  });

  it('ends today and flags the feed when it has no records', () => {
    for (const latestRecordEpochMs of [null, Number.NaN]) {
      const window = computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs, settlingDays: 2 });
      expect(window.latestRecordEpochMs).toBeNull();
      expect(window.endEpochMs).toBe(day('2026-10-20'));
      expect(window.settlingDays).toBe(2);
      expect(publicationLagDays(window)).toBe(0);
      expect(isDelayedFeed(window)).toBe(true);
    }
  });

  it('keeps current and previous windows equal, adjacent and non-overlapping', () => {
    for (const windowDays of [14, 30, 60, 90]) {
      const window = computeEvidenceWindow({ windowDays, nowEpochMs: NOW, latestRecordEpochMs: NOW, settlingDays: 1 });
      expect(window.endEpochMs - window.currentStartEpochMs).toBe(windowDays * DAY_MS);
      expect(window.currentStartEpochMs - window.previousStartEpochMs).toBe(windowDays * DAY_MS);
      expect(window.endEpochMs % DAY_MS).toBe(0);
    }
  });

  it('calls a feed delayed only from the delay threshold onward', () => {
    const at = (lag: number) => computeEvidenceWindow({
      windowDays: 30,
      nowEpochMs: NOW,
      latestRecordEpochMs: NOW - lag * DAY_MS,
    });
    expect(isDelayedFeed(at(DELAYED_FEED_DAYS - 1))).toBe(false);
    expect(isDelayedFeed(at(DELAYED_FEED_DAYS))).toBe(true);
  });
});

describe('datasetStartEpoch', () => {
  it('has no start for a dataset that covers prior years', () => {
    expect(datasetStartEpoch(null, day('2026-06-30'), NOW)).toBeNull();
  });

  it('restarts a year-to-date file on January 1 of the newest record', () => {
    expect(datasetStartEpoch('calendar-year', Date.parse('2026-06-30T18:00:00Z'), NOW)).toBe(day('2026-01-01'));
    // A file still holding last year's records starts on last year's January 1.
    expect(datasetStartEpoch('calendar-year', day('2025-12-31'), NOW)).toBe(day('2025-01-01'));
  });

  it('falls back to the current year when the file has no records', () => {
    expect(datasetStartEpoch('calendar-year', null, NOW)).toBe(day('2026-01-01'));
  });

  it('reads a fixed first day', () => {
    expect(datasetStartEpoch('2026-01-01', day('2026-10-20'), NOW)).toBe(day('2026-01-01'));
    expect(datasetStartEpoch('2025-07-15', null, NOW)).toBe(day('2025-07-15'));
  });

  it('rejects an unreadable configured start', () => {
    expect(() => datasetStartEpoch('2026-13-01', day('2026-10-20'), NOW)).toThrow('Invalid dataset start 2026-13-01');
    expect(() => datasetStartEpoch('soon', null, NOW)).toThrow('Invalid dataset start soon');
  });
});

describe('dataset start and the evidence windows', () => {
  const at = (datasetStartEpochMs: number | null) => computeEvidenceWindow({
    windowDays: 30,
    nowEpochMs: NOW,
    latestRecordEpochMs: day('2026-03-10'),
    datasetStartEpochMs,
  });

  it('passes the dataset start through and defaults it to null', () => {
    expect(at(day('2026-01-01')).datasetStartEpochMs).toBe(day('2026-01-01'));
    expect(computeEvidenceWindow({ windowDays: 30, nowEpochMs: NOW, latestRecordEpochMs: NOW }).datasetStartEpochMs).toBeNull();
  });

  it('never predates an unbounded dataset', () => {
    const window = at(null);
    expect(previousWindowPredatesDataset(window)).toBe(false);
    expect(currentWindowPredatesDataset(window)).toBe(false);
  });

  it('flags a previous window that reaches back before the first day', () => {
    // Current Feb 9 – Mar 10, previous Jan 10 – Feb 8.
    const window = at(day('2026-01-01'));
    expect(window.previousStartEpochMs).toBe(day('2026-01-10'));
    expect(previousWindowPredatesDataset(window)).toBe(false);
    expect(previousWindowPredatesDataset(at(day('2026-01-10')))).toBe(false);
    expect(previousWindowPredatesDataset(at(day('2026-01-11')))).toBe(true);
    expect(currentWindowPredatesDataset(at(day('2026-01-11')))).toBe(false);
  });

  it('flags a current window that itself starts before the first day', () => {
    const window = at(day('2026-02-09'));
    expect(window.currentStartEpochMs).toBe(day('2026-02-09'));
    expect(currentWindowPredatesDataset(window)).toBe(false);
    expect(currentWindowPredatesDataset(at(day('2026-02-10')))).toBe(true);
    expect(previousWindowPredatesDataset(at(day('2026-02-10')))).toBe(true);
  });
});
