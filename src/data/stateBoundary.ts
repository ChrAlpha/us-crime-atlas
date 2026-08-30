import type { Position } from 'geojson';
import type { Coordinates } from '../types';
import type { StateBoundaryCollection, StateJurisdiction } from './stateBoundary.types';

type RingPosition = 'boundary' | 'inside' | 'outside';
type NormalizedPosition = readonly [longitude: number, latitude: number];

const EPSILON = 1e-9;

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validPosition(position: Position | undefined): position is Position {
  return Array.isArray(position)
    && position.length >= 2
    && typeof position[0] === 'number'
    && Number.isFinite(position[0])
    && typeof position[1] === 'number'
    && Number.isFinite(position[1])
    && position[1] >= -90
    && position[1] <= 90;
}

function unwrapRing(ring: Position[]): NormalizedPosition[] | null {
  if (ring.length < 4 || !ring.every((position) => validPosition(position))) return null;

  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return null;
  const closesLongitude = Math.abs(normalizeLongitude(first[0]! - last[0]!)) <= EPSILON;
  const closesLatitude = Math.abs(first[1]! - last[1]!) <= EPSILON;
  if (!closesLongitude || !closesLatitude) return null;

  const unwrapped: NormalizedPosition[] = [];
  for (const position of ring) {
    let longitude = normalizeLongitude(position[0]!);
    const previousLongitude = unwrapped.at(-1)?.[0];
    if (previousLongitude !== undefined) {
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
    }
    unwrapped.push([longitude, position[1]!]);
  }

  const twiceArea = unwrapped.slice(1).reduce((area, position, index) => {
    const previous = unwrapped[index];
    return previous ? area + previous[0] * position[1] - position[0] * previous[1] : area;
  }, 0);
  return Math.abs(twiceArea) > EPSILON ? unwrapped : null;
}

function pointNearRing(point: Coordinates, ring: NormalizedPosition[]): Coordinates {
  const longitude = normalizeLongitude(point[0]);
  const reference = ring[0]?.[0] ?? longitude;
  return [longitude + Math.round((reference - longitude) / 360) * 360, point[1]];
}

function pointIsOnSegment(
  point: Coordinates,
  start: NormalizedPosition,
  end: NormalizedPosition,
): boolean {
  const cross = (point[1] - start[1]) * (end[0] - start[0])
    - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > EPSILON) return false;

  return point[0] >= Math.min(start[0], end[0]) - EPSILON
    && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON
    && point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function positionInRing(point: Coordinates, ring: NormalizedPosition[]): RingPosition {
  let inside = false;
  const normalizedPoint = pointNearRing(point, ring);

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    if (!current || !previous) continue;

    if (pointIsOnSegment(normalizedPoint, previous, current)) return 'boundary';

    const crossesLatitude = (current[1] > normalizedPoint[1]) !== (previous[1] > normalizedPoint[1]);
    if (crossesLatitude) {
      const crossingLongitude = ((previous[0] - current[0]) * (normalizedPoint[1] - current[1]))
        / (previous[1] - current[1]) + current[0];
      if (normalizedPoint[0] < crossingLongitude) inside = !inside;
    }
  }

  return inside ? 'inside' : 'outside';
}

function pointIsInPolygon(point: Coordinates, rings: Position[][]): boolean {
  if (!Array.isArray(rings)) return false;
  const normalizedRings = rings.map((ring) => (
    Array.isArray(ring) ? unwrapRing(ring as Position[]) : null
  ));
  if (normalizedRings.some((ring) => ring === null)) return false;
  const [outer, ...holes] = normalizedRings as NormalizedPosition[][];
  if (!outer || positionInRing(point, outer) === 'outside') return false;
  return holes.every((hole) => positionInRing(point, hole) === 'outside');
}

function featureParts(feature: unknown): {
  jurisdiction: StateJurisdiction;
  polygons: Position[][][];
} | null {
  if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) return null;
  const { code: rawCode, name: rawName } = feature.properties;
  if (typeof rawCode !== 'string' || typeof rawName !== 'string') return null;
  const jurisdiction = { code: rawCode.trim().toUpperCase(), name: rawName.trim() };
  if (!jurisdiction.code || !jurisdiction.name || !Array.isArray(feature.geometry.coordinates)) return null;

  if (feature.geometry.type === 'Polygon') {
    return { jurisdiction, polygons: [feature.geometry.coordinates as Position[][]] };
  }
  if (feature.geometry.type === 'MultiPolygon') {
    return { jurisdiction, polygons: feature.geometry.coordinates as Position[][][] };
  }
  return null;
}

export function findStateForPoint(
  point: Coordinates,
  boundaries: StateBoundaryCollection,
): StateJurisdiction | null {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90) return null;
  if (!boundaries || !Array.isArray(boundaries.features)) return null;

  for (const feature of boundaries.features as unknown[]) {
    const parts = featureParts(feature);
    if (parts?.polygons.some((polygon) => pointIsInPolygon(point, polygon))) {
      return parts.jurisdiction;
    }
  }
  return null;
}
