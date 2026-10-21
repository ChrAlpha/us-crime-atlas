import { describe, expect, it } from 'vitest';
import {
  combineDateAndTime,
  DAY_MS,
  formatDay,
  formatDayRange,
  formatSourceTimestamp,
  hourFromTimestamp,
  isoDate,
  localClockTimestamp,
  sourceTimestampToEpoch,
  startOfDay,
  toLocalClockEpoch,
} from './time';

const utc = (value: string) => Date.parse(`${value}Z`);

describe('sourceTimestampToEpoch', () => {
  it.each([
    ['2026-08-17T13:45:00.000', '2026-08-17T13:45:00.000'],
    ['2026-08-17T13:45:00', '2026-08-17T13:45:00.000'],
    ['2026-08-17T13:45', '2026-08-17T13:45:00.000'],
    ['2026-08-17', '2026-08-17T00:00:00.000'],
    ['2026-10-19 00:00:00.0000000', '2026-10-19T00:00:00.000'],
    ['2026-08-17T13:45:00.123456789', '2026-08-17T13:45:00.123'],
    ['2026-08-17T13:45:00.5', '2026-08-17T13:45:00.500'],
    ['  2026-08-17T13:45:00  ', '2026-08-17T13:45:00.000'],
  ])('reads zone-free %j as local wall-clock time', (value, expected) => {
    expect(sourceTimestampToEpoch(value)).toBe(utc(expected));
  });

  it('keeps explicit zones as true instants', () => {
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00.000Z')).toBe(Date.parse('2026-08-17T13:45:00.000Z'));
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00-04:00')).toBe(Date.parse('2026-08-17T17:45:00Z'));
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00.25+0530')).toBe(Date.parse('2026-08-17T08:15:00.250Z'));
  });

  it.each(['', 'garbage', '2026-02-30T00:00:00', '2026-13-01', '2026-08-17T25:00:00', '2026-08-17T23:60:00', '17/08/2026'])(
    'rejects %j',
    (value) => {
      expect(Number.isNaN(sourceTimestampToEpoch(value))).toBe(true);
    },
  );

  it('rejects impossible calendar dates even when a zone is present', () => {
    expect(Number.isNaN(sourceTimestampToEpoch('2026-02-30T00:00:00Z'))).toBe(true);
  });
});

describe('combineDateAndTime', () => {
  it('joins NYC date and time fields without applying the viewer zone', () => {
    expect(combineDateAndTime('2026-08-17T00:00:00.000', '23:15:00')).toBe('2026-08-17T23:15:00');
    expect(combineDateAndTime('2026-08-17T00:00:00.000', '23:15')).toBe('2026-08-17T23:15:00');
    expect(combineDateAndTime('2026-08-17 00:00:00.0000000', '01:10:00.000')).toBe('2026-08-17T01:10:00');
  });

  it('falls back to midnight for missing or malformed times', () => {
    expect(combineDateAndTime('2026-08-17T00:00:00.000', 'bad')).toBe('2026-08-17T00:00:00');
    expect(combineDateAndTime('2026-08-17T00:00:00.000', '')).toBe('2026-08-17T00:00:00');
    expect(combineDateAndTime('2026-08-17T00:00:00.000')).toBe('2026-08-17T00:00:00');
  });
});

describe('hourFromTimestamp', () => {
  it('extracts the local hour from T- and space-separated timestamps', () => {
    expect(hourFromTimestamp('2026-08-17T04:30:00')).toBe(4);
    expect(hourFromTimestamp('2026-08-17 23:59:00')).toBe(23);
    expect(hourFromTimestamp('2026-08-17T00:00:00')).toBe(0);
  });

  it('rejects missing and out-of-range hours', () => {
    expect(hourFromTimestamp('2026-08-17')).toBeNull();
    expect(hourFromTimestamp('2026-08-17T99:30:00')).toBeNull();
    expect(hourFromTimestamp('2026-08-17T24:00:00')).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('formats stable source timestamps', () => {
    expect(formatSourceTimestamp('2026-08-17T04:30:00.000')).toBe('08/17/2026 · 04:30');
    expect(formatSourceTimestamp('2026-08-17 04:30:00')).toBe('08/17/2026 · 04:30');
    expect(formatSourceTimestamp('unknown')).toBe('unknown');
  });

  it('formats local-clock days and day ranges in the UTC frame', () => {
    expect(formatDay(utc('2026-06-30T23:59:59'))).toBe('Jun 30, 2026');
    expect(formatDayRange(utc('2026-06-01T00:00:00'), utc('2026-06-30T00:00:00'))).toBe('Jun 1 – Jun 30, 2026');
    expect(formatDayRange(utc('2025-12-15T00:00:00'), utc('2026-01-13T00:00:00'))).toBe('Dec 15, 2025 – Jan 13, 2026');
  });

  it('derives day keys, zone-free timestamps and day starts from local-clock epochs', () => {
    const epoch = utc('2026-08-17T20:15:30.987');
    expect(isoDate(epoch)).toBe('2026-08-17');
    expect(localClockTimestamp(epoch)).toBe('2026-08-17T20:15:30');
    expect(startOfDay(epoch)).toBe(utc('2026-08-17T00:00:00'));
    expect(startOfDay(utc('2026-08-17T00:00:00'))).toBe(utc('2026-08-17T00:00:00'));
    expect(DAY_MS).toBe(86_400_000);
  });
});

describe('toLocalClockEpoch', () => {
  it.each([
    ['2026-01-15T12:00:00.000Z', 'America/New_York', '2026-01-15T07:00:00.000'],
    ['2026-07-01T12:00:00.000Z', 'America/New_York', '2026-07-01T08:00:00.000'],
    ['2026-07-01T12:00:00.000Z', 'America/Chicago', '2026-07-01T07:00:00.000'],
    ['2026-07-01T12:00:00.000Z', 'America/Denver', '2026-07-01T06:00:00.000'],
    ['2026-07-01T12:00:00.000Z', 'America/Los_Angeles', '2026-07-01T05:00:00.000'],
    ['2026-07-01T03:30:00.000Z', 'America/Los_Angeles', '2026-06-30T20:30:00.000'],
    ['2026-07-01T12:00:00.000Z', 'UTC', '2026-07-01T12:00:00.000'],
  ])('converts %s to wall-clock time in %s', (instant, timeZone, expected) => {
    expect(toLocalClockEpoch(Date.parse(instant), timeZone)).toBe(utc(expected));
  });

  it('follows daylight-saving transitions', () => {
    // Spring forward in New York: 01:59:59 EST is followed by 03:00:00 EDT.
    expect(toLocalClockEpoch(Date.parse('2026-03-08T06:59:59Z'), 'America/New_York')).toBe(utc('2026-03-08T01:59:59'));
    expect(toLocalClockEpoch(Date.parse('2026-03-08T07:00:00Z'), 'America/New_York')).toBe(utc('2026-03-08T03:00:00'));
    // Fall back: 01:30 occurs twice, first in EDT then in EST.
    expect(toLocalClockEpoch(Date.parse('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(utc('2026-11-01T01:30:00'));
    expect(toLocalClockEpoch(Date.parse('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(utc('2026-11-01T01:30:00'));
  });

  it('reports midnight as hour zero and preserves milliseconds, including before 1970', () => {
    expect(toLocalClockEpoch(Date.parse('2026-03-08T05:00:00.250Z'), 'America/New_York')).toBe(utc('2026-03-08T00:00:00.250'));
    expect(toLocalClockEpoch(-1, 'UTC')).toBe(-1);
  });
});
