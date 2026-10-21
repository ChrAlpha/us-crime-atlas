import { describe, expect, it } from 'vitest';
import {
  FULL_AGENCY,
  LAGGING_AGENCY,
  SILENT_AGENCY,
  UNPOPULATED_AGENCY,
  fixtureSnapshot,
  matchFor,
} from '../test/agencyFixtures';
import {
  formatMonth,
  monthIndex,
  monthLabel,
  relativeBand,
  summarizeAgency,
  summarizeState,
} from './agencySummary';

describe('month helpers', () => {
  it('round-trips month labels through indexes', () => {
    expect(monthLabel(monthIndex('2026-07'))).toBe('2026-07');
    expect(monthIndex('2026-01') - monthIndex('2025-12')).toBe(1);
    expect(formatMonth('2026-07')).toBe('Jul 2026');
  });
});

describe('summarizeAgency', () => {
  it('totals the trailing twelve months and compares them with the state', () => {
    const summary = summarizeAgency(matchFor(FULL_AGENCY), fixtureSnapshot())!;

    expect(summary.startMonth).toBe('2025-08');
    expect(summary.endMonth).toBe('2026-07');
    expect(summary.reportedMonths).toBe(12);
    expect(summary.counts).toEqual({ violent: 144, property: 360 });
    expect(summary.ratesPer100k!.violent).toBeCloseTo(120);
    expect(summary.ratesPer100k!.property).toBeCloseTo(300);
    expect(summary.stateRatesPer100k!.violent).toBeCloseTo(40);
    expect(summary.nationalRatesPer100k!.property).toBeCloseTo(130);
    expect(summary.relativeToState!.violent).toBeCloseTo(3);
    expect(summary.relativeToState!.property).toBeCloseTo(2);
    expect(summary.trendPercent!.violent).toBeCloseTo(20);
    expect(summary.trendPercent!.property).toBeCloseTo(-25);
    expect(summary.trendPercent!.total).toBeCloseTo((504 / 600 - 1) * 100);
    expect(summary.monthly).toHaveLength(12);
    expect(summary.monthly[0]).toEqual({ month: '2025-08', violent: 12, property: 30 });
    expect(summary.monthsBehind).toBe(0);
    expect(summary.smallPopulation).toBe(false);
  });

  it('ends a lagging agency at its own newest month and annualizes partial windows', () => {
    const summary = summarizeAgency(matchFor(LAGGING_AGENCY), fixtureSnapshot())!;

    expect(summary.endMonth).toBe('2025-12');
    expect(summary.startMonth).toBe('2025-01');
    expect(summary.monthsBehind).toBe(7);
    // 2025-06 is missing.
    expect(summary.reportedMonths).toBe(11);
    expect(summary.counts).toEqual({ violent: 22, property: 55 });
    expect(summary.ratesPer100k!.violent).toBeCloseTo((22 * 12 / 11 / 8_000) * 100_000);
    expect(summary.trendPercent).toBeNull();
    expect(summary.smallPopulation).toBe(true);
    expect(summary.monthly.find((month) => month.month === '2025-06')).toEqual({
      month: '2025-06',
      violent: null,
      property: null,
    });
  });

  it('withholds rates without a population, and the trend before the snapshot starts', () => {
    const unpopulated = summarizeAgency(matchFor(UNPOPULATED_AGENCY), fixtureSnapshot())!;
    expect(unpopulated.ratesPer100k).toBeNull();
    expect(unpopulated.relativeToState).toBeNull();
    expect(unpopulated.smallPopulation).toBe(false);

    const short = summarizeAgency(matchFor(FULL_AGENCY), fixtureSnapshot({ months: ['2025-08', '2026-07'] }))!;
    expect(short.trendPercent).toBeNull();
  });

  it('withholds rates from too few months, and the trend after a quiet previous year', () => {
    const fewMonths = {
      ...FULL_AGENCY,
      violent: [...Array.from({ length: 19 }, () => null), 1, 1, 1, 1, 1],
      property: [...Array.from({ length: 19 }, () => null), 1, 1, 1, 1, 1],
    };
    const summary = summarizeAgency(matchFor(fewMonths), fixtureSnapshot())!;
    expect(summary.reportedMonths).toBe(5);
    expect(summary.ratesPer100k).toBeNull();

    const quietYear = {
      ...FULL_AGENCY,
      violent: [...Array.from({ length: 12 }, () => 0), ...Array.from({ length: 12 }, () => 2)],
    };
    expect(summarizeAgency(matchFor(quietYear), fixtureSnapshot())!.trendPercent).toBeNull();
  });

  it('returns null for an agency that never reported', () => {
    expect(summarizeAgency(matchFor(SILENT_AGENCY), fixtureSnapshot())).toBeNull();
    const allMissing = { ...FULL_AGENCY, violent: Array.from({ length: 24 }, () => null) };
    expect(summarizeAgency(matchFor(allMissing), fixtureSnapshot())).toBeNull();
  });

  it('drops the state comparison when the state has too few rated months', () => {
    const snapshot = fixtureSnapshot({
      stateRates: { violent: Array.from({ length: 24 }, () => null), property: Array.from({ length: 24 }, () => 1) },
    });
    const summary = summarizeAgency(matchFor(FULL_AGENCY), snapshot)!;
    expect(summary.stateRatesPer100k).toBeNull();
    expect(summary.relativeToState).toBeNull();
    expect(summary.ratesPer100k).not.toBeNull();
  });

  it('cannot compare with a zero state rate', () => {
    const snapshot = fixtureSnapshot({
      stateRates: { violent: Array.from({ length: 24 }, () => 0), property: Array.from({ length: 24 }, () => 1) },
    });
    expect(summarizeAgency(matchFor(FULL_AGENCY), snapshot)!.relativeToState).toBeNull();
  });
});

describe('relativeBand', () => {
  it('uses the local comparison thresholds', () => {
    expect(relativeBand(null)).toBe('insufficient');
    expect(relativeBand(0.5)).toBe('lower');
    expect(relativeBand(1)).toBe('similar');
    expect(relativeBand(1.5)).toBe('elevated');
    expect(relativeBand(2)).toBe('markedly-elevated');
  });
});

describe('summarizeState', () => {
  it('reports the state rate over the newest twelve months', () => {
    const summary = summarizeState(fixtureSnapshot());
    expect(summary.stateName).toBe('California');
    expect(summary.startMonth).toBe('2025-08');
    expect(summary.endMonth).toBe('2026-07');
    expect(summary.ratesPer100k!.violent).toBeCloseTo(40);
    expect(summary.nationalRatesPer100k!.violent).toBeCloseTo(30);
  });
});
