import type { AtlasState, Coordinates, CrimeGroup, RadiusMeters, SelectedPlace, WindowDays } from '../types';
import { CRIME_GROUPS } from './categories';

export const RADIUS_OPTIONS: readonly RadiusMeters[] = [500, 1000, 2000];
export const WINDOW_OPTIONS: readonly WindowDays[] = [14, 30, 60, 90];

const MAX_LABEL_LENGTH = 120;
const MAX_DETAIL_LENGTH = 180;

export const DEFAULT_PLACE: SelectedPlace = {
  label: 'Times Square',
  detail: 'Manhattan · New York City',
  coordinates: [-73.9855, 40.758],
};

export const DEFAULT_ATLAS_STATE: AtlasState = {
  place: DEFAULT_PLACE,
  radiusMeters: 1000,
  windowDays: 30,
  activeGroups: [...CRIME_GROUPS],
};

export function droppedPin(coordinates: Coordinates): SelectedPlace {
  return {
    label: 'Dropped pin',
    detail: `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`,
    coordinates,
  };
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function oneOf<T extends number>(options: readonly T[], value: number | null, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function parsePlace(params: URLSearchParams): SelectedPlace {
  const longitude = finiteNumber(params.get('lng'));
  const latitude = finiteNumber(params.get('lat'));
  const validCoordinates = longitude !== null
    && latitude !== null
    && Math.abs(longitude) <= 180
    && Math.abs(latitude) <= 90;
  if (!validCoordinates) return DEFAULT_PLACE;

  const coordinates: Coordinates = [longitude, latitude];
  const label = params.get('place')?.trim().slice(0, MAX_LABEL_LENGTH);
  if (!label) return droppedPin(coordinates);
  return {
    label,
    detail: params.get('detail')?.trim().slice(0, MAX_DETAIL_LENGTH) ?? '',
    coordinates,
  };
}

function parseGroups(value: string | null): CrimeGroup[] {
  const groups = (value ?? '')
    .split(',')
    .filter((group): group is CrimeGroup => (CRIME_GROUPS as readonly string[]).includes(group));
  const unique = [...new Set(groups)];
  return unique.length > 0 ? unique : [...DEFAULT_ATLAS_STATE.activeGroups];
}

export function parseUrlState(search: string): AtlasState {
  const params = new URLSearchParams(search);
  return {
    place: parsePlace(params),
    radiusMeters: oneOf(RADIUS_OPTIONS, finiteNumber(params.get('radius')), DEFAULT_ATLAS_STATE.radiusMeters),
    windowDays: oneOf(WINDOW_OPTIONS, finiteNumber(params.get('days')), DEFAULT_ATLAS_STATE.windowDays),
    activeGroups: parseGroups(params.get('groups')),
  };
}

/** Serializes state, preserving unrelated parameters such as the `e2e` test flag. */
export function serializeUrlState(state: AtlasState, existingSearch = ''): string {
  const params = new URLSearchParams(existingSearch);
  for (const key of ['lat', 'lng', 'place', 'detail', 'radius', 'days', 'groups']) params.delete(key);
  params.set('lat', state.place.coordinates[1].toFixed(5));
  params.set('lng', state.place.coordinates[0].toFixed(5));
  params.set('place', state.place.label);
  if (state.place.detail) params.set('detail', state.place.detail);
  params.set('radius', String(state.radiusMeters));
  params.set('days', String(state.windowDays));
  params.set('groups', state.activeGroups.join(','));
  return `?${params.toString()}`;
}
