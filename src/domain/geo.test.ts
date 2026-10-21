import { describe, expect, it } from 'vitest';
import type { Coordinates } from '../types';
import {
  areaShares,
  boundingBoxForRadius,
  circleAreaSquareKilometers,
  circlePolygon,
  destinationPoint,
  haversineDistance,
  pointInRings,
  pointIsWithinBounds,
  type PolygonRings,
} from './geo';

describe('geospatial helpers', () => {
  it('measures one degree of latitude at roughly 111.2 km, symmetrically', () => {
    expect(haversineDistance([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
    expect(haversineDistance([0, 0], [0, 0])).toBe(0);
    const a = [-73.9855, 40.758] as const;
    const b = [-87.6298, 41.8837] as const;
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
    expect(haversineDistance(a, b)).toBeGreaterThan(1_140_000);
    expect(haversineDistance(a, b)).toBeLessThan(1_160_000);
  });

  it('builds a bounding box around the center that spans the radius to within 0.2%', () => {
    const center = [-73.9855, 40.758] as const;
    const box = boundingBoxForRadius(center, 1000);
    expect(box.west).toBeLessThan(center[0]);
    expect(box.east).toBeGreaterThan(center[0]);
    expect(box.south).toBeLessThan(center[1]);
    expect(box.north).toBeGreaterThan(center[1]);
    expect(haversineDistance(center, [center[0], box.north])).toBeGreaterThan(998);
    expect(haversineDistance(center, [box.east, center[1]])).toBeGreaterThan(998);
  });

  it('builds a bounding box that contains every point of the circle', () => {
    const center = [-73.9855, 40.758] as const;
    const box = boundingBoxForRadius(center, 1000);
    for (const position of circlePolygon(center, 1000, 36).geometry.coordinates[0] ?? []) {
      expect(pointIsWithinBounds([position[0]!, position[1]!], box)).toBe(true);
    }
  });

  it('keeps the envelope tight: each edge sits on the circle', () => {
    const center = [-122.3422, 47.6097] as const;
    const box = boundingBoxForRadius(center, 6000);
    expect(haversineDistance(center, [center[0], box.north])).toBeCloseTo(6000, 3);
    expect(haversineDistance(center, [center[0], box.south])).toBeCloseTo(6000, 3);
    const widest = circlePolygon(center, 6000, 3600).geometry.coordinates[0]!.reduce(
      (max, position) => Math.max(max, position[0]!),
      Number.NEGATIVE_INFINITY,
    );
    expect(box.east - widest).toBeGreaterThanOrEqual(0);
    expect(box.east - widest).toBeLessThan(1e-6);
  });

  it('contains circles near the poles and spans every longitude once the cap holds a pole', () => {
    const nearPole = [10, 89.5] as const;
    const box = boundingBoxForRadius(nearPole, 1000);
    for (const position of circlePolygon(nearPole, 1000, 72).geometry.coordinates[0] ?? []) {
      expect(pointIsWithinBounds([position[0]!, position[1]!], box)).toBe(true);
    }
    const aroundPole = boundingBoxForRadius([0, 89.999], 1000);
    expect(aroundPole.east - aroundPole.west).toBe(360);
    expect(boundingBoxForRadius([0, 90], 10).east).toBe(180);
  });

  it('treats coverage bounds as inclusive', () => {
    const bounds = { west: -2, south: -1, east: 2, north: 1 };
    expect(pointIsWithinBounds([-2, -1], bounds)).toBe(true);
    expect(pointIsWithinBounds([2, 1], bounds)).toBe(true);
    expect(pointIsWithinBounds([2.01, 0], bounds)).toBe(false);
    expect(pointIsWithinBounds([0, -1.01], bounds)).toBe(false);
  });

  it('creates a closed circle polygon at the requested radius', () => {
    const polygon = circlePolygon([0, 0], 1000, 12);
    const ring = polygon.geometry.coordinates[0] ?? [];
    expect(polygon).toMatchObject({ type: 'Feature', properties: {}, geometry: { type: 'Polygon' } });
    expect(ring).toHaveLength(13);
    expect(ring[0]).toEqual(ring.at(-1));
    for (const position of ring) {
      expect(haversineDistance([0, 0], [position[0]!, position[1]!])).toBeCloseTo(1000, 3);
    }
    expect(circlePolygon([0, 0], 500).geometry.coordinates[0]).toHaveLength(81);
    expect(circlePolygon([0, 0], 500, 0).geometry.coordinates[0]).toEqual([]);
  });

  it('calculates planar display areas', () => {
    expect(circleAreaSquareKilometers(1000)).toBeCloseTo(Math.PI, 10);
    expect(circleAreaSquareKilometers(500)).toBeCloseTo(Math.PI / 4, 10);
    expect(circleAreaSquareKilometers(0)).toBe(0);
  });
});

describe('destinationPoint', () => {
  const origin: Coordinates = [-87.6298, 41.8837];

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, 1.5 * Math.PI])(
    'lands exactly the requested distance away at bearing %s',
    (bearing) => {
      for (const distance of [0, 500, 3000, 25_000]) {
        expect(haversineDistance(origin, destinationPoint(origin, distance, bearing))).toBeCloseTo(distance, 6);
      }
    },
  );

  it('moves north, east, south and west along the expected axes', () => {
    const north = destinationPoint(origin, 1000, 0);
    const east = destinationPoint(origin, 1000, Math.PI / 2);
    const south = destinationPoint(origin, 1000, Math.PI);
    const west = destinationPoint(origin, 1000, 1.5 * Math.PI);
    expect(north[0]).toBeCloseTo(origin[0], 10);
    expect(north[1]).toBeGreaterThan(origin[1]);
    expect(south[0]).toBeCloseTo(origin[0], 10);
    expect(south[1]).toBeLessThan(origin[1]);
    expect(east[0]).toBeGreaterThan(origin[0]);
    expect(west[0]).toBeLessThan(origin[0]);
    expect(east[1]).toBeCloseTo(origin[1], 4);
    expect(west[1]).toBeCloseTo(origin[1], 4);
  });

  it('returns the origin for a zero distance', () => {
    const [longitude, latitude] = destinationPoint(origin, 0, 1.2);
    expect(longitude).toBeCloseTo(origin[0], 12);
    expect(latitude).toBeCloseTo(origin[1], 12);
  });
});

describe('pointInRings', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] as const satisfies PolygonRings;
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]] as const;
  const island = [[20, 20], [25, 20], [25, 25], [20, 25], [20, 20]] as const;

  it('finds points inside and outside a square', () => {
    expect(pointInRings([5, 5], square)).toBe(true);
    expect(pointInRings([0.001, 9.999], square)).toBe(true);
    expect(pointInRings([-0.001, 5], square)).toBe(false);
    expect(pointInRings([10.001, 5], square)).toBe(false);
    expect(pointInRings([5, 10.001], square)).toBe(false);
    expect(pointInRings([5, -0.001], square)).toBe(false);
  });

  it('treats a nested ring as a hole regardless of orientation', () => {
    const reversedHole = [...hole].reverse();
    for (const inner of [hole, reversedHole]) {
      const rings: PolygonRings = [square[0], inner];
      expect(pointInRings([5, 5], rings)).toBe(false);
      expect(pointInRings([2, 5], rings)).toBe(true);
      expect(pointInRings([8, 5], rings)).toBe(true);
      expect(pointInRings([5, 2.999], rings)).toBe(true);
      expect(pointInRings([5, 3.001], rings)).toBe(false);
    }
  });

  it('accepts multi-part polygons', () => {
    const rings: PolygonRings = [square[0], island];
    expect(pointInRings([5, 5], rings)).toBe(true);
    expect(pointInRings([22, 22], rings)).toBe(true);
    expect(pointInRings([15, 15], rings)).toBe(false);
    expect(pointInRings([22, 5], rings)).toBe(false);
  });

  it('handles rings that are not explicitly closed and slanted edges', () => {
    const triangle: PolygonRings = [[[0, 0], [10, 0], [0, 10]]];
    expect(pointInRings([4.9, 4.9], triangle)).toBe(true);
    expect(pointInRings([5.1, 5.1], triangle)).toBe(false);
  });

  it('finds nothing inside an empty polygon', () => {
    expect(pointInRings([0, 0], [])).toBe(false);
    expect(pointInRings([0, 0], [[]])).toBe(false);
  });
});

describe('areaShares', () => {
  const center: Coordinates = [-87.6298, 41.8837];

  it('is 1 everywhere for a predicate that always holds and 0 for one that never does', () => {
    expect(areaShares(center, 1000, 3, () => true)).toEqual({ inner: 1, outer: 1 });
    expect(areaShares(center, 1000, 3, () => false)).toEqual({ inner: 0, outer: 0 });
  });

  it('estimates half of both areas for the half-plane east of the center', () => {
    const shares = areaShares(center, 1000, 3, ([longitude]) => longitude > center[0]);
    expect(shares.inner).toBeGreaterThan(0.47);
    expect(shares.inner).toBeLessThan(0.53);
    expect(shares.outer).toBeGreaterThan(0.47);
    expect(shares.outer).toBeLessThan(0.53);
  });

  it('samples the disc only inside the radius and the annulus only beyond it', () => {
    const beyondRadius = (point: Coordinates) => haversineDistance(center, point) > 1000;
    expect(areaShares(center, 1000, 3, beyondRadius)).toEqual({ inner: 0, outer: 1 });
    const withinOuter = (point: Coordinates) => haversineDistance(center, point) <= 3000 + 1e-6;
    expect(areaShares(center, 1000, 3, withinOuter)).toEqual({ inner: 1, outer: 1 });
  });

  it('weights samples by area, so a central disc holds its true share', () => {
    // The inner quarter of the disc's radius holds 1/16 of its area.
    const core = (point: Coordinates) => haversineDistance(center, point) <= 250;
    expect(areaShares(center, 1000, 3, core).inner).toBeCloseTo(1 / 16, 2);
    // Up to 2r is (4 − 1) / (9 − 1) of the annulus area.
    const nearRing = (point: Coordinates) => haversineDistance(center, point) <= 2000;
    expect(areaShares(center, 1000, 3, nearRing).outer).toBeCloseTo(3 / 8, 1);
  });
});
