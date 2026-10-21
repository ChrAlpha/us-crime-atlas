import { describe, expect, it } from 'vitest';
import type { AtlasState } from '../types';
import {
  DEFAULT_ATLAS_STATE,
  DEFAULT_PLACE,
  droppedPin,
  parseUrlState,
  RADIUS_OPTIONS,
  serializeUrlState,
  WINDOW_OPTIONS,
} from './urlState';

describe('parseUrlState', () => {
  it('parses a valid shared atlas state', () => {
    const state = parseUrlState('?lat=41.8837&lng=-87.6298&place=The+Loop&detail=Chicago&radius=500&days=60&groups=violent,vehicle');
    expect(state).toEqual({
      place: { label: 'The Loop', detail: 'Chicago', coordinates: [-87.6298, 41.8837] },
      radiusMeters: 500,
      windowDays: 60,
      activeGroups: ['violent', 'vehicle'],
    });
  });

  it('returns the default state for an empty query', () => {
    expect(parseUrlState('')).toEqual(DEFAULT_ATLAS_STATE);
    expect(DEFAULT_ATLAS_STATE.place).toBe(DEFAULT_PLACE);
  });

  it('falls back safely for malformed coordinates, controls, and empty groups', () => {
    expect(parseUrlState('?lat=999&lng=nope&radius=750&days=31&groups=not-real&place=')).toEqual(DEFAULT_ATLAS_STATE);
    expect(parseUrlState('?lat=&lng=-87&radius=&days=abc')).toEqual(DEFAULT_ATLAS_STATE);
    expect(parseUrlState('?lat=40&lng=181').place).toBe(DEFAULT_PLACE);
    expect(parseUrlState('?lat=-91&lng=10').place).toBe(DEFAULT_PLACE);
  });

  it('never attaches a shared label to the default coordinates', () => {
    expect(parseUrlState('?place=Pike+Place&detail=Seattle').place).toBe(DEFAULT_PLACE);
  });

  it('labels coordinates without a place name as a dropped pin', () => {
    const state = parseUrlState('?lat=32.7767&lng=-96.797');
    expect(state.place).toEqual({
      label: 'Dropped pin',
      detail: '32.77670, -96.79700',
      coordinates: [-96.797, 32.7767],
    });
    expect(parseUrlState('?lat=32.7767&lng=-96.797&place=%20%20').place.label).toBe('Dropped pin');
  });

  it('trims labels, bounds their length and defaults a missing detail', () => {
    const state = parseUrlState(`?lat=1&lng=2&place=${'x'.repeat(200)}&detail=${'y'.repeat(300)}`);
    expect(state.place.label).toHaveLength(120);
    expect(state.place.detail).toHaveLength(180);
    expect(parseUrlState('?lat=1&lng=2&place=%20Hotel%20').place).toEqual({ label: 'Hotel', detail: '', coordinates: [2, 1] });
  });

  it('accepts only reviewed radius and window options', () => {
    for (const radius of RADIUS_OPTIONS) expect(parseUrlState(`?radius=${radius}`).radiusMeters).toBe(radius);
    for (const days of WINDOW_OPTIONS) expect(parseUrlState(`?days=${days}`).windowDays).toBe(days);
    expect(parseUrlState('?radius=500.5').radiusMeters).toBe(1000);
    expect(parseUrlState('?days=1e1').windowDays).toBe(30);
  });

  it('filters unknown and duplicate groups', () => {
    expect(parseUrlState('?groups=violent,violent,nope,other').activeGroups).toEqual(['violent', 'other']);
    expect(parseUrlState('?groups=').activeGroups).toEqual(DEFAULT_ATLAS_STATE.activeGroups);
  });

  it('returns a fresh group array for every default state', () => {
    const first = parseUrlState('');
    first.activeGroups.pop();
    expect(parseUrlState('').activeGroups).toHaveLength(5);
  });
});

describe('serializeUrlState', () => {
  const state: AtlasState = {
    place: { label: 'Union Square', detail: 'San Francisco, CA', coordinates: [-122.4075, 37.788] },
    radiusMeters: 2000,
    windowDays: 90,
    activeGroups: ['property', 'weapons'],
  };

  it('round-trips coordinates, labels, controls, and groups', () => {
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it('round-trips a dropped pin', () => {
    const pin = { ...state, place: droppedPin([-96.797, 32.7767]) };
    expect(parseUrlState(serializeUrlState(pin)).place).toEqual(pin.place);
  });

  it('rounds coordinates to five decimals and omits an empty detail', () => {
    const search = serializeUrlState({ ...state, place: { label: 'Pin', detail: '', coordinates: [-122.123456789, 37.987654321] } });
    const params = new URLSearchParams(search);
    expect(search.startsWith('?')).toBe(true);
    expect(params.get('lat')).toBe('37.98765');
    expect(params.get('lng')).toBe('-122.12346');
    expect(params.has('detail')).toBe(false);
    expect(params.get('groups')).toBe('property,weapons');
  });

  it('preserves unrelated parameters such as the e2e flag and replaces stale state', () => {
    const search = serializeUrlState(state, '?e2e=1&lat=0&lng=0&detail=old&radius=500');
    const params = new URLSearchParams(search);
    expect(params.get('e2e')).toBe('1');
    expect(params.getAll('lat')).toEqual(['37.78800']);
    expect(params.getAll('detail')).toEqual(['San Francisco, CA']);
    expect(params.get('radius')).toBe('2000');
    expect(parseUrlState(search)).toEqual(state);
  });

  it('drops a stale detail when the new place has none', () => {
    const search = serializeUrlState({ ...state, place: droppedPin([1, 2]) }, '?detail=Old+detail');
    expect(new URLSearchParams(search).get('detail')).toBe('2.00000, 1.00000');
    const noDetail = serializeUrlState({ ...state, place: { label: 'X', detail: '', coordinates: [1, 2] } }, '?detail=Old');
    expect(new URLSearchParams(noDetail).has('detail')).toBe(false);
  });
});
