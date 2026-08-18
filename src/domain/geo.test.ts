import { describe, expect, it } from 'vitest';
import {
  boundingBoxForRadius,
  circleAreaSquareKilometers,
  circlePolygon,
  haversineDistance,
  pointIsWithinBounds,
} from './geo';

describe('geospatial helpers', () => {
  it('measures one degree of latitude at roughly 111.2 km', () => {
    expect(haversineDistance([0, 0], [0, 1])).toBeCloseTo(111_195, -1);
    expect(haversineDistance([0, 0], [0, 0])).toBe(0);
  });

  it('builds a bounding box that contains cardinal points at the radius', () => {
    const box = boundingBoxForRadius([-73.9855, 40.758], 1000);
    expect(box.west).toBeLessThan(-73.9855);
    expect(box.east).toBeGreaterThan(-73.9855);
    expect(box.south).toBeLessThan(40.758);
    expect(box.north).toBeGreaterThan(40.758);
  });

  it('guards longitude delta near the poles', () => {
    const box = boundingBoxForRadius([0, 89.99], 1000);
    expect(Number.isFinite(box.west)).toBe(true);
    expect(box.east - box.west).toBeGreaterThan(0.1);
  });

  it('treats coverage bounds as inclusive', () => {
    const bounds = { west: -2, south: -1, east: 2, north: 1 };
    expect(pointIsWithinBounds([-2, -1], bounds)).toBe(true);
    expect(pointIsWithinBounds([2, 1], bounds)).toBe(true);
    expect(pointIsWithinBounds([2.01, 0], bounds)).toBe(false);
  });

  it('creates a closed circle polygon and calculates its planar display area', () => {
    const polygon = circlePolygon([0, 0], 1000, 12);
    const ring = polygon.geometry.coordinates[0];
    expect(ring).toHaveLength(13);
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    expect(circleAreaSquareKilometers(1000)).toBeCloseTo(Math.PI, 10);
  });
});
