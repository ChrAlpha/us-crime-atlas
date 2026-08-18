import { describe, expect, it } from 'vitest';
import {
  combineDateAndTime,
  formatSourceTimestamp,
  hourFromTimestamp,
  isoDate,
  sourceTimestampToEpoch,
} from './time';

describe('source time handling', () => {
  it('parses timezone-free publisher timestamps as pseudo-UTC', () => {
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00.000')).toBe(Date.parse('2026-08-17T13:45:00.000Z'));
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00.000Z')).toBe(Date.parse('2026-08-17T13:45:00.000Z'));
    expect(sourceTimestampToEpoch('2026-08-17T13:45:00-04:00')).toBe(Date.parse('2026-08-17T13:45:00-04:00'));
    expect(Number.isNaN(sourceTimestampToEpoch(''))).toBe(true);
  });

  it('combines NYC date and time fields without applying viewer timezone', () => {
    expect(combineDateAndTime('2026-08-17T00:00:00.000', '23:15:00')).toBe('2026-08-17T23:15:00');
    expect(combineDateAndTime('2026-08-17T00:00:00.000', 'bad')).toBe('2026-08-17T00:00:00');
    expect(combineDateAndTime('2026-08-17T00:00:00.000')).toBe('2026-08-17T00:00:00');
  });

  it('extracts local hours and rejects malformed values', () => {
    expect(hourFromTimestamp('2026-08-17T04:30:00')).toBe(4);
    expect(hourFromTimestamp('2026-08-17')).toBeNull();
    expect(hourFromTimestamp('2026-08-17T99:30:00')).toBeNull();
  });

  it('formats stable source timestamps and ISO day keys', () => {
    expect(formatSourceTimestamp('2026-08-17T04:30:00.000')).toBe('08/17/2026 · 04:30');
    expect(formatSourceTimestamp('unknown')).toBe('unknown');
    expect(isoDate(Date.parse('2026-08-17T20:00:00Z'))).toBe('2026-08-17');
  });
});
