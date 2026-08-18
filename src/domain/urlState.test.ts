import { describe, expect, it } from 'vitest';
import { DEFAULT_ATLAS_STATE, parseUrlState, serializeUrlState } from './urlState';

describe('URL state', () => {
  it('parses a valid shared atlas state', () => {
    const state = parseUrlState('?lat=41.8837&lng=-87.6298&place=The+Loop&detail=Chicago&radius=500&days=60&groups=violent,vehicle');
    expect(state).toEqual({
      place: { label: 'The Loop', detail: 'Chicago', coordinates: [-87.6298, 41.8837] },
      radiusMeters: 500,
      windowDays: 60,
      activeGroups: ['violent', 'vehicle'],
    });
  });

  it('falls back safely for malformed coordinates, controls, and empty groups', () => {
    const state = parseUrlState('?lat=999&lng=nope&radius=750&days=31&groups=not-real&place=');
    expect(state).toEqual(DEFAULT_ATLAS_STATE);
  });

  it('round-trips coordinates, labels, controls, and groups', () => {
    const input = {
      place: { label: 'Union Square', detail: 'San Francisco, CA', coordinates: [-122.4075, 37.788] as const },
      radiusMeters: 2000,
      windowDays: 90,
      activeGroups: ['property', 'weapons'] as const,
    };
    const parsed = parseUrlState(serializeUrlState({ ...input, activeGroups: [...input.activeGroups] }));
    expect(parsed).toEqual({ ...input, activeGroups: [...input.activeGroups] });
  });
});
