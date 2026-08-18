import { describe, expect, it } from 'vitest';
import { categoryGroup, isViolentCategory, severityForCategory } from './categories';
import { analyzeIncidents, BAND_COPY } from './analysis';
import type { CrimeCategory, Incident } from '../types';

const NOW = new Date('2026-08-17T12:00:00.000Z');
const CENTER = [0, 0] as const;

function incident(
  id: string,
  category: CrimeCategory,
  daysAgo: number,
  coordinates: readonly [number, number],
  localHour = 12,
): Incident {
  const epoch = NOW.getTime() - daysAgo * 86_400_000;
  return {
    id,
    providerId: 'test',
    occurredAt: new Date(epoch).toISOString().replace(/Z$/, ''),
    occurredAtEpochMs: epoch,
    localHour,
    category,
    group: categoryGroup(category),
    rawCategory: category,
    description: `${category} test`,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

function analyze(incidents: Incident[], truncated = false) {
  return analyzeIncidents({
    incidents,
    center: CENTER,
    radiusMeters: 1000,
    windowDays: 30,
    activeGroups: ['violent', 'property', 'vehicle', 'weapons', 'other'],
    now: NOW,
    truncated,
  });
}

describe('incident evidence analysis', () => {
  it('labels strongly concentrated selected-area activity as markedly elevated', () => {
    const inside = Array.from({ length: 4 }, (_, index) => incident(`inside-${index}`, 'assault', index + 1, [0.001, 0], 23));
    const outside = Array.from({ length: 4 }, (_, index) => incident(`outside-${index}`, 'theft', index + 1, [0.015, 0]));
    const result = analyze([...inside, ...outside]);

    expect(result.currentCount).toBe(4);
    expect(result.nearbyCurrentIncidents).toHaveLength(4);
    expect(result.violentCount).toBe(4);
    expect(result.nightCount).toBe(4);
    expect(result.band).toBe('markedly-elevated');
    expect(result.relativeActivity).toBeGreaterThan(2);
    expect(result.confidence).toBe('low');
    expect(BAND_COPY[result.band].label).toContain('Markedly');
  });

  it('returns similar when inner and annulus weighted density match', () => {
    const inside = [incident('inside', 'theft', 1, [0.001, 0])];
    const outside = Array.from({ length: 8 }, (_, index) => incident(`outside-${index}`, 'theft', 2, [0.015 + index * 0.0001, 0]));
    const result = analyze([...inside, ...outside]);
    expect(result.relativeActivity).toBeCloseTo(1, 1);
    expect(result.band).toBe('similar');
  });

  it('returns lower when the surrounding annulus has greater density', () => {
    const inside = [incident('inside', 'theft', 1, [0.001, 0])];
    const outside = Array.from({ length: 16 }, (_, index) => incident(`outside-${index}`, 'theft', 2, [0.015 + index * 0.00005, 0]));
    const result = analyze([...inside, ...outside]);
    expect(result.relativeActivity).toBeCloseTo(0.5, 1);
    expect(result.band).toBe('lower');
    expect(result.confidence).toBe('medium');
  });

  it('uses insufficient evidence and low confidence for tiny or truncated samples', () => {
    const result = analyze([
      incident('inside', 'robbery', 1, [0.001, 0]),
      incident('outside', 'theft', 1, [0.015, 0]),
    ]);
    expect(result.band).toBe('insufficient');
    expect(result.confidence).toBe('low');

    const many = Array.from({ length: 45 }, (_, index) => incident(`many-${index}`, 'theft', 1, index < 5 ? [0.001, 0] : [0.015, 0]));
    expect(analyze(many).confidence).toBe('high');
    expect(analyze(many, true).confidence).toBe('low');
  });

  it('compares non-overlapping equal windows and reports a falling trend', () => {
    const result = analyze([
      incident('current', 'theft', 2, [0.001, 0]),
      incident('previous-1', 'theft', 31, [0.001, 0]),
      incident('previous-2', 'robbery', 45, [0.001, 0]),
      incident('too-old', 'theft', 61, [0.001, 0]),
      incident('too-far', 'theft', 2, [0.04, 0]),
    ]);
    expect(result.currentCount).toBe(1);
    expect(result.previousCount).toBe(2);
    expect(result.trendDirection).toBe('down');
    expect(result.trendPercent).toBe(-50);
    expect(result.mapIncidents).toHaveLength(1);
  });

  it('handles no previous reports, inactive groups, category ordering, and daily gaps', () => {
    const result = analyzeIncidents({
      incidents: [
        incident('robbery', 'robbery', 0, [0.001, 0]),
        incident('theft-1', 'theft', 1, [0.001, 0]),
        incident('theft-2', 'theft', 2, [0.001, 0]),
        { ...incident('invalid-time', 'theft', 1, [0.001, 0]), occurredAtEpochMs: Number.NaN },
      ],
      center: CENTER,
      radiusMeters: 1000,
      windowDays: 14,
      activeGroups: ['violent', 'property'],
      now: NOW,
    });

    expect(result.trendDirection).toBe('new');
    expect(result.trendPercent).toBeNull();
    expect(result.categoryBreakdown[0]).toMatchObject({ category: 'theft', count: 2 });
    expect(result.dailyActivity).toHaveLength(14);
    expect(result.dailyActivity.some((day) => day.count === 0)).toBe(true);
    expect(result.latestObservedAt).toBeTruthy();
  });

  it('returns a none/flat trend and null comparison where appropriate', () => {
    const empty = analyze([]);
    expect(empty.trendDirection).toBe('none');
    expect(empty.relativeActivity).toBeNull();
    expect(empty.latestObservedAt).toBeNull();

    const flat = analyze([
      incident('current', 'other', 1, [0.001, 0]),
      incident('previous', 'other', 31, [0.001, 0]),
      ...Array.from({ length: 8 }, (_, index) => incident(`outer-${index}`, 'other', 1, [0.015, index * 0.0001])),
    ]);
    expect(flat.trendDirection).toBe('flat');
    expect(flat.trendPercent).toBe(0);
  });
});
