import type { Coordinates, CoverageBounds } from '../types';

/** Mean Earth radius; Haversine distance and envelopes share this sphere. */
export const EARTH_RADIUS_METERS = 6_371_008.8;
/** Absorbs floating-point error so circle points on the envelope edge stay inside (≈0.1 mm). */
const ENVELOPE_EPSILON_DEGREES = 1e-9;

export type BoundingBox = CoverageBounds;

/** Polygon rings as `[longitude, latitude]` vertices; outer rings and holes in any order. */
export type PolygonRings = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

export function haversineDistance(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const halfDeltaLat = Math.sin(toRadians(b[1] - a[1]) / 2);
  const halfDeltaLon = Math.sin(toRadians(b[0] - a[0]) / 2);
  const h = halfDeltaLat * halfDeltaLat + Math.cos(lat1) * Math.cos(lat2) * halfDeltaLon * halfDeltaLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The smallest axis-aligned envelope containing the spherical circle of `radiusMeters`
 * around `center`, so no record inside the Haversine radius is left unrequested.
 */
export function boundingBoxForRadius(center: Coordinates, radiusMeters: number): BoundingBox {
  const angularDistance = radiusMeters / EARTH_RADIUS_METERS;
  // A spherical cap's widest longitude offset is asin(sin δ / cos φ); it wraps once the cap holds a pole.
  const ratio = Math.sin(angularDistance) / Math.cos(toRadians(center[1]));
  const latDelta = toDegrees(angularDistance) + ENVELOPE_EPSILON_DEGREES;
  const lonDelta = ratio >= 1 ? 180 : toDegrees(Math.asin(ratio)) + ENVELOPE_EPSILON_DEGREES;
  return {
    west: center[0] - lonDelta,
    south: center[1] - latDelta,
    east: center[0] + lonDelta,
    north: center[1] + latDelta,
  };
}

export function pointIsWithinBounds(point: Coordinates, bounds: CoverageBounds): boolean {
  return point[0] >= bounds.west
    && point[0] <= bounds.east
    && point[1] >= bounds.south
    && point[1] <= bounds.north;
}

/** The point `distanceMeters` from `origin` along the initial `bearingRadians` (clockwise from north). */
export function destinationPoint(origin: Coordinates, distanceMeters: number, bearingRadians: number): Coordinates {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const latitude = toRadians(origin[1]);
  const longitude = toRadians(origin[0]);
  const destinationLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(latitude),
    Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
  );
  return [toDegrees(destinationLongitude), toDegrees(destinationLatitude)];
}

/** A closed geodesic circle polygon suitable for a GeoJSON source. */
export function circlePolygon(
  center: Coordinates,
  radiusMeters: number,
  steps = 80,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const ring: GeoJSON.Position[] = [];
  for (let index = 0; index < steps; index += 1) {
    ring.push([...destinationPoint(center, radiusMeters, (index / steps) * Math.PI * 2)]);
  }
  if (ring[0]) ring.push([...ring[0]]);

  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Point-in-polygon by the even-odd rule across every ring, so multi-part polygons and
 * holes (enclaves such as Hamtramck inside Detroit) need no ring orientation.
 */
export function pointInRings(point: Coordinates, rings: PolygonRings): boolean {
  const [x, y] = point;
  let inside = false;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [x1, y1] = ring[index] as readonly [number, number];
      const [x2, y2] = ring[previous] as readonly [number, number];
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

/** Radial bands and bearings per sampled region; ≈1–2% resolution on the covered share. */
const AREA_SAMPLE_BANDS = 16;
const AREA_SAMPLE_BEARINGS = 64;

/**
 * Estimates which share of the disc `[0, r]` and of the annulus `(r, outerMultiplier·r]`
 * satisfies `contains`, from equal-area polar samples.
 */
export function areaShares(
  center: Coordinates,
  radiusMeters: number,
  outerMultiplier: number,
  contains: (point: Coordinates) => boolean,
): { inner: number; outer: number } {
  const share = (innerRadius: number, outerRadius: number) => {
    let hits = 0;
    for (let band = 0; band < AREA_SAMPLE_BANDS; band += 1) {
      // Equal-area bands: the squared radius is uniform across the region.
      const fraction = (band + 0.5) / AREA_SAMPLE_BANDS;
      const distance = Math.sqrt(innerRadius ** 2 + (outerRadius ** 2 - innerRadius ** 2) * fraction);
      // Staggered bearings keep samples from lining up along one radial.
      const offset = (band % 2) * 0.5;
      for (let step = 0; step < AREA_SAMPLE_BEARINGS; step += 1) {
        const bearing = ((step + offset) / AREA_SAMPLE_BEARINGS) * Math.PI * 2;
        if (contains(destinationPoint(center, distance, bearing))) hits += 1;
      }
    }
    return hits / (AREA_SAMPLE_BANDS * AREA_SAMPLE_BEARINGS);
  };
  return { inner: share(0, radiusMeters), outer: share(radiusMeters, radiusMeters * outerMultiplier) };
}

export function circleAreaSquareKilometers(radiusMeters: number): number {
  const kilometers = radiusMeters / 1000;
  return Math.PI * kilometers * kilometers;
}
