import { describe, expect, it } from 'vitest';
import type { ProviderMeta } from '../../types';
import { buildIncident, joinLabels, roundCoordinates } from './incident';
import { CHICAGO_META } from './socrataCities';

const meta: ProviderMeta = { ...CHICAGO_META, id: 'test-city', precision: 'intersection' };

const fields = {
  sourceId: 'R-1',
  occurredAt: '2026-08-10T22:15:00',
  rawCategory: 'BATTERY',
  description: 'AGGRAVATED',
  locationLabel: '001XX N STATE ST',
  coordinates: [-87.6298, 41.8837] as const,
};

describe('buildIncident', () => {
  it('builds a provider-namespaced, normalized incident', () => {
    expect(buildIncident(meta, fields)).toEqual({
      id: 'test-city:R-1',
      providerId: 'test-city',
      occurredAt: '2026-08-10T22:15:00',
      occurredAtEpochMs: Date.parse('2026-08-10T22:15:00Z'),
      localHour: 22,
      category: 'assault',
      group: 'violent',
      rawCategory: 'BATTERY',
      description: 'AGGRAVATED',
      locationLabel: '001XX N STATE ST',
      coordinates: [-87.6298, 41.8837],
      severity: 3.7,
      isViolent: true,
      precision: 'intersection',
    });
  });

  it('classifies from category plus description unless explicit text is given', () => {
    expect(buildIncident(meta, { ...fields, rawCategory: 'OTHER', description: 'PICKPOCKET' })?.category).toBe('theft');
    expect(buildIncident(meta, { ...fields, classificationText: 'MOTOR VEHICLE THEFT' })).toMatchObject({
      category: 'vehicle',
      group: 'vehicle',
      isViolent: false,
      severity: 2.1,
    });
    expect(buildIncident(meta, { ...fields, classificationText: undefined })?.category).toBe('assault');
  });

  it('rejects rows without identity or a readable timestamp', () => {
    expect(buildIncident(meta, { ...fields, sourceId: '' })).toBeNull();
    expect(buildIncident(meta, { ...fields, occurredAt: 'not a date' })).toBeNull();
  });

  it('keeps a null hour for date-only timestamps', () => {
    expect(buildIncident(meta, { ...fields, occurredAt: '2026-08-10' })?.localHour).toBeNull();
  });

  it('drops the hour of a midnight placeholder when the publisher gave no time', () => {
    const untimed = buildIncident(meta, { ...fields, occurredAt: '2026-08-10T00:00:00', timeKnown: false });
    expect(untimed).toMatchObject({
      occurredAt: '2026-08-10T00:00:00',
      occurredAtEpochMs: Date.parse('2026-08-10T00:00:00Z'),
      localHour: null,
    });
    expect(buildIncident(meta, { ...fields, timeKnown: false })?.localHour).toBeNull();
  });

  it('reads the hour when the time is known or not specified', () => {
    expect(buildIncident(meta, { ...fields, occurredAt: '2026-08-10T00:00:00', timeKnown: true })?.localHour).toBe(0);
    expect(buildIncident(meta, { ...fields, timeKnown: undefined })?.localHour).toBe(22);
    expect(buildIncident(meta, fields)?.localHour).toBe(22);
  });
});

describe('label and coordinate helpers', () => {
  it('joins non-empty labels or falls back', () => {
    expect(joinLabels(['FRONT OF', '', 'MANHATTAN'], 'Block midpoint')).toBe('FRONT OF · MANHATTAN');
    expect(joinLabels(['', ''], 'Block midpoint')).toBe('Block midpoint');
    expect(joinLabels([], 'Fallback')).toBe('Fallback');
  });

  it('rounds coordinates to the requested precision', () => {
    expect(roundCoordinates([-96.79187, 32.68458], 3)).toEqual([-96.792, 32.685]);
    expect(roundCoordinates([-104.99072735, 39.75419794], 0)).toEqual([-105, 40]);
  });
});
