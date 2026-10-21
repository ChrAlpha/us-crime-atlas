import { describe, expect, it } from 'vitest';
import { COMPARISON_RADIUS_MULTIPLIER, FULL_AREA_COVERAGE } from '../domain/analysis';
import { pointInRings, pointIsWithinBounds } from '../domain/geo';
import type { Coordinates } from '../types';
import {
  areaCoverageFor,
  isWithinJurisdiction,
  JURISDICTION_SOURCE,
  jurisdictionFor,
} from './jurisdictions';
import { FEATURED_PLACES, findProviderForPoint, providerMetadata } from './providers';

/** Neighbors outside a nearby provider's city limits, with that provider's id. */
const NEIGHBORS: ReadonlyArray<readonly [string, string, Coordinates]> = [
  ['Jersey City', 'new-york', [-74.0776, 40.7282]],
  ['Hoboken', 'new-york', [-74.0324, 40.744]],
  ['Beverly Hills', 'los-angeles', [-118.4004, 34.0736]],
  ['Santa Monica', 'los-angeles', [-118.4912, 34.0195]],
  ['Culver City', 'los-angeles', [-118.3965, 34.0211]],
  ['Evanston', 'chicago', [-87.6877, 42.0451]],
  ['Evanston south of Calvary Cemetery', 'chicago', [-87.68, 42.025]],
  ['Oak Park', 'chicago', [-87.7845, 41.885]],
  ['Hamtramck', 'detroit', [-83.0499, 42.3926]],
  ['Highland Park, Michigan', 'detroit', [-83.0963, 42.4059]],
  ['Daly City', 'san-francisco', [-122.4702, 37.6879]],
  ['Daly City at the county line', 'san-francisco', [-122.46, 37.7]],
  ['Piedmont', 'oakland', [-122.2317, 37.8244]],
  ['Emeryville', 'oakland', [-122.2852, 37.8313]],
  ['Belle Meade', 'nashville', [-86.8577, 36.1037]],
  ['Highland Park, Texas', 'dallas', [-96.8003, 32.8343]],
];

/** Edges of city limits that reach beyond the provider's reviewed rectangle by more than this. */
const BOUNDS_TOLERANCE_DEGREES = 0.1;

function limitsOf(providerId: string) {
  const jurisdiction = jurisdictionFor(providerId);
  if (!jurisdiction) throw new Error(`${providerId} has no jurisdiction`);
  return jurisdiction;
}

describe('jurisdiction data', () => {
  it('cites the Census source it was generated from', () => {
    expect(JURISDICTION_SOURCE.source).toMatch(/^U\.S\. Census Bureau TIGERweb, Incorporated Places/);
    expect(JURISDICTION_SOURCE.sourceUrl).toMatch(/^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\//);
    expect(JURISDICTION_SOURCE.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('has city limits for every registered provider and nothing else', () => {
    for (const meta of providerMetadata) {
      const jurisdiction = limitsOf(meta.id);
      expect(jurisdiction.geoid, meta.id).toMatch(/^\d{5}(\d{2})?$/);
      expect(jurisdiction.name.toLowerCase(), meta.id).toContain(meta.city.toLowerCase().replace(/ city$/, ''));
      expect(jurisdiction.rings.length, meta.id).toBeGreaterThan(0);
      for (const ring of jurisdiction.rings) {
        expect(ring.length, meta.id).toBeGreaterThanOrEqual(4);
      }
    }
    expect(jurisdictionFor('springfield')).toBeNull();
  });

  it('derives bounds that enclose every vertex and stay close to the reviewed rectangle', () => {
    for (const meta of providerMetadata) {
      const { bounds, rings } = limitsOf(meta.id);
      for (const vertex of rings.flat()) {
        expect(pointIsWithinBounds(vertex, bounds), meta.id).toBe(true);
      }
      const edges = {
        // San Francisco's limits include the Farallon Islands, 40 km offshore.
        west: meta.id === 'san-francisco' ? 0.7 : BOUNDS_TOLERANCE_DEGREES,
        south: BOUNDS_TOLERANCE_DEGREES,
        east: BOUNDS_TOLERANCE_DEGREES,
        north: BOUNDS_TOLERANCE_DEGREES,
      };
      expect(meta.bounds.west - bounds.west, meta.id).toBeLessThan(edges.west);
      expect(meta.bounds.south - bounds.south, meta.id).toBeLessThan(edges.south);
      expect(bounds.east - meta.bounds.east, meta.id).toBeLessThan(edges.east);
      expect(bounds.north - meta.bounds.north, meta.id).toBeLessThan(edges.north);
      expect(pointIsWithinBounds(meta.center, bounds), meta.id).toBe(true);
    }
  });
});

describe('isWithinJurisdiction', () => {
  it('contains every featured place and provider center in exactly one city', () => {
    for (const point of [...FEATURED_PLACES.map((place) => place.coordinates), ...providerMetadata.map((meta) => meta.center)]) {
      const containing = providerMetadata.filter((meta) => isWithinJurisdiction(point, limitsOf(meta.id)));
      expect(containing, `${point.join(',')}`).toHaveLength(1);
    }
  });

  it.each(NEIGHBORS)('excludes %s from the neighboring city', (_name, providerId, point) => {
    expect(isWithinJurisdiction(point, limitsOf(providerId))).toBe(false);
    expect(findProviderForPoint(point)).toBeNull();
  });

  it('excludes neighbors that the reviewed rectangles alone would have claimed', () => {
    const claimed = NEIGHBORS.filter(([, providerId, point]) => (
      pointIsWithinBounds(point, providerMetadata.find((meta) => meta.id === providerId)?.bounds ?? limitsOf(providerId).bounds)
    )).map(([name]) => name);
    expect(claimed).toEqual(expect.arrayContaining([
      'Jersey City',
      'Hoboken',
      'Beverly Hills',
      'Santa Monica',
      'Culver City',
      'Evanston south of Calvary Cemetery',
      'Oak Park',
      'Hamtramck',
      'Highland Park, Michigan',
      'Daly City at the county line',
      'Belle Meade',
      'Highland Park, Texas',
    ]));
  });

  it('includes in-city edges beyond the reviewed rectangle', () => {
    const dallas = limitsOf('dallas');
    const meta = providerMetadata.find((candidate) => candidate.id === 'dallas');
    const beyond = dallas.rings.flat().find((vertex) => meta && vertex[0] > meta.bounds.east);
    expect(beyond).toBeDefined();
    // Nudge a boundary vertex toward the city center so it lies strictly inside.
    const inside = dallas.rings.flat()
      .map(([longitude, latitude]): Coordinates => [longitude - 0.0005, latitude])
      .find((point) => meta && point[0] > meta.bounds.east && isWithinJurisdiction(point, dallas));
    expect(inside).toBeDefined();
    expect(findProviderForPoint(inside as Coordinates)?.meta.id).toBe('dallas');
  });

  it('rejects points outside the bounds before testing the polygon', () => {
    const jurisdiction = limitsOf('chicago');
    const farAway: Coordinates = [jurisdiction.bounds.east + 1, jurisdiction.bounds.north + 1];
    expect(isWithinJurisdiction(farAway, jurisdiction)).toBe(false);
    expect(pointInRings(farAway, jurisdiction.rings)).toBe(false);
  });
});

describe('areaCoverageFor', () => {
  const featured = (label: string) => {
    const place = FEATURED_PLACES.find((candidate) => candidate.label === label);
    if (!place) throw new Error(label);
    return place.coordinates;
  };

  it('treats a provider without reviewed limits as covering the whole area', () => {
    expect(areaCoverageFor('springfield', [-89.65, 39.8], 1000, COMPARISON_RADIUS_MULTIPLIER)).toBe(FULL_AREA_COVERAGE);
  });

  it('covers a place well inside its city completely', () => {
    expect(areaCoverageFor('san-francisco', featured('Union Square'), 1000, COMPARISON_RADIUS_MULTIPLIER))
      .toEqual({ selected: 1, nearby: 1 });
  });

  it('leaves Lake Michigan out of the Loop comparison area', () => {
    const coverage = areaCoverageFor('chicago', featured('The Loop'), 1000, COMPARISON_RADIUS_MULTIPLIER);
    expect(coverage.selected).toBe(1);
    expect(coverage.nearby).toBeGreaterThan(0.6);
    expect(coverage.nearby).toBeLessThan(0.9);
  });

  it('leaves New Jersey out of the Times Square comparison area', () => {
    const coverage = areaCoverageFor('new-york', featured('Times Square'), 1000, COMPARISON_RADIUS_MULTIPLIER);
    expect(coverage.selected).toBe(1);
    expect(coverage.nearby).toBeGreaterThan(0.8);
    expect(coverage.nearby).toBeLessThan(0.95);
  });

  it('shrinks with distance into a neighbor and grows back toward the city', () => {
    const loop = featured('The Loop');
    const small = areaCoverageFor('chicago', loop, 500, COMPARISON_RADIUS_MULTIPLIER);
    const large = areaCoverageFor('chicago', loop, 2000, COMPARISON_RADIUS_MULTIPLIER);
    expect(large.nearby).toBeLessThan(small.nearby);
    expect(large.selected).toBeLessThanOrEqual(small.selected);
  });
});
