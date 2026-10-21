import { FULL_AREA_COVERAGE } from '../domain/analysis';
import { areaShares, pointInRings, pointIsWithinBounds, type PolygonRings } from '../domain/geo';
import type { AreaCoverage, Coordinates, CoverageBounds } from '../types';
import data from './jurisdictions.json';

/** City limits of a provider's police jurisdiction (regenerate with scripts/fetch-jurisdictions.mjs). */
export interface Jurisdiction {
  /** Census place GEOID. */
  geoid: string;
  name: string;
  rings: PolygonRings;
  bounds: CoverageBounds;
}

export const JURISDICTION_SOURCE = {
  source: data.source,
  sourceUrl: data.sourceUrl,
  retrieved: data.retrieved,
} as const;

function boundsOf(rings: PolygonRings): CoverageBounds {
  const vertices = rings.flat();
  return {
    west: Math.min(...vertices.map(([longitude]) => longitude)),
    south: Math.min(...vertices.map(([, latitude]) => latitude)),
    east: Math.max(...vertices.map(([longitude]) => longitude)),
    north: Math.max(...vertices.map(([, latitude]) => latitude)),
  };
}

const jurisdictions = new Map<string, Jurisdiction>(
  Object.entries(data.places).map(([providerId, place]) => {
    const rings = place.rings as unknown as PolygonRings;
    return [providerId, { geoid: place.geoid, name: place.name, rings, bounds: boundsOf(rings) }];
  }),
);

export function jurisdictionFor(providerId: string): Jurisdiction | null {
  return jurisdictions.get(providerId) ?? null;
}

export function isWithinJurisdiction(point: Coordinates, jurisdiction: Jurisdiction): boolean {
  return pointIsWithinBounds(point, jurisdiction.bounds) && pointInRings(point, jurisdiction.rings);
}

/**
 * Shares of the selected circle and nearby annulus inside the provider's city limits.
 * A provider without reviewed limits is treated as covering the whole area.
 */
export function areaCoverageFor(
  providerId: string,
  center: Coordinates,
  radiusMeters: number,
  outerMultiplier: number,
): AreaCoverage {
  const jurisdiction = jurisdictionFor(providerId);
  if (!jurisdiction) return FULL_AREA_COVERAGE;
  const { inner, outer } = areaShares(
    center,
    radiusMeters,
    outerMultiplier,
    (point) => isWithinJurisdiction(point, jurisdiction),
  );
  return { selected: inner, nearby: outer };
}
