import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { COMPARISON_RADIUS_MULTIPLIER } from '../domain/analysis';
import { boundingBoxForRadius, circlePolygon, destinationPoint, haversineDistance } from '../domain/geo';
import { GROUP_COLORS, MAP_INK, type ThemeName } from '../domain/palette';
import { radiusLabel } from '../domain/presentation';
import type { Coordinates, CrimeGroup, Incident } from '../types';
import { offlineStyle } from './offlineMapStyle';

export type MapTheme = ThemeName;

export const SOURCE_RINGS = 'atlas-rings';
export const SOURCE_RING_LABELS = 'atlas-ring-labels';
export const SOURCE_LOCATIONS = 'atlas-locations';
export const LOCATION_LAYER = 'report-locations';
export const RING_LABEL_LAYER = 'ring-labels';
export const INTERACTIVE_LAYERS = [LOCATION_LAYER] as const;

/** Slightly larger than the comparison ring so it has context. */
export const FIT_RADIUS_MULTIPLIER = COMPARISON_RADIUS_MULTIPLIER + 0.25;
/** Short visible map areas (a phone with the sheet open) frame the circle with some surroundings instead. */
export const COMPACT_FIT_RADIUS_MULTIPLIER = 1.6;
export const COMPACT_MAP_HEIGHT = 480;

export const OPENFREEMAP_STYLES: Record<MapTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export function isDeterministicMode(search: string): boolean {
  return new URLSearchParams(search).get('e2e') === '1';
}

/** The deterministic e2e mode renders a self-contained style with no network dependencies. */
export function mapStyle(theme: MapTheme, center: Coordinates, search: string): string | StyleSpecification {
  return isDeterministicMode(search) ? offlineStyle(theme, center) : OPENFREEMAP_STYLES[theme];
}

export function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/* ── Report locations ─────────────────────────────────────────────────────── */

/**
 * Publishers blur reports to a block midpoint or intersection, so many reports share one
 * point. The map draws each distinct point once, sized by how many reports it carries.
 */
export interface ReportLocation {
  key: string;
  coordinates: Coordinates;
  /** Newest first. */
  incidents: Incident[];
  /** The most common group here; ties go to the more serious group. */
  group: CrimeGroup;
  inside: boolean;
}

const GROUP_PRIORITY: readonly CrimeGroup[] = ['violent', 'weapons', 'property', 'vehicle', 'other'];

export function locationKey(coordinates: Coordinates): string {
  return `${coordinates[0].toFixed(5)},${coordinates[1].toFixed(5)}`;
}

function dominantGroup(incidents: readonly Incident[]): CrimeGroup {
  const counts = new Map<CrimeGroup, number>();
  for (const incident of incidents) counts.set(incident.group, (counts.get(incident.group) ?? 0) + 1);
  let best: CrimeGroup = 'other';
  let bestCount = 0;
  for (const group of GROUP_PRIORITY) {
    const count = counts.get(group) ?? 0;
    if (count > bestCount) {
      best = group;
      bestCount = count;
    }
  }
  return best;
}

export function groupIncidentsByLocation(
  center: Coordinates,
  radiusMeters: number,
  incidents: readonly Incident[],
): ReportLocation[] {
  const byKey = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const key = locationKey(incident.coordinates);
    byKey.set(key, [...(byKey.get(key) ?? []), incident]);
  }
  return [...byKey.entries()].map(([key, members]) => {
    const sorted = [...members].sort((left, right) => right.occurredAtEpochMs - left.occurredAtEpochMs);
    const coordinates = sorted[0]!.coordinates;
    return {
      key,
      coordinates,
      incidents: sorted,
      group: dominantGroup(sorted),
      inside: haversineDistance(center, coordinates) <= radiusMeters,
    };
  });
}

export interface LocationProperties {
  key: string;
  count: number;
  group: CrimeGroup;
  inside: number;
  selected: number;
  /** Higher draws on top: selected, then inside the circle, then smaller stacks over larger. */
  sortKey: number;
}

export function locationFeatureCollection(
  locations: readonly ReportLocation[],
  selectedKey: string | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, LocationProperties> {
  return {
    type: 'FeatureCollection',
    features: locations.map((location) => {
      const selected = location.key === selectedKey;
      const count = location.incidents.length;
      return {
        type: 'Feature',
        id: location.key,
        properties: {
          key: location.key,
          count,
          group: location.group,
          inside: location.inside ? 1 : 0,
          selected: selected ? 1 : 0,
          sortKey: (selected ? 2_000_000 : 0) + (location.inside ? 1_000_000 : 0) - count,
        },
        geometry: { type: 'Point', coordinates: [location.coordinates[0], location.coordinates[1]] },
      };
    }),
  };
}

/* ── The analysis circle and comparison ring ──────────────────────────────── */

export function ringFeatureCollection(center: Coordinates, radiusMeters: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      { ...circlePolygon(center, radiusMeters), properties: { ring: 'selected' } },
      { ...circlePolygon(center, radiusMeters * COMPARISON_RADIUS_MULTIPLIER), properties: { ring: 'comparison' } },
    ],
  };
}

export function ringLabelFeatureCollection(center: Coordinates, radiusMeters: number): GeoJSON.FeatureCollection {
  const outer = radiusMeters * COMPARISON_RADIUS_MULTIPLIER;
  return {
    type: 'FeatureCollection',
    features: [
      { radius: radiusMeters, label: radiusLabel(radiusMeters) },
      { radius: outer, label: `${radiusLabel(outer)} comparison` },
    ].map(({ radius, label }) => {
      const point = destinationPoint(center, radius, 0);
      return {
        type: 'Feature' as const,
        properties: { label },
        geometry: { type: 'Point' as const, coordinates: [point[0], point[1]] },
      };
    }),
  };
}

/* ── Camera ───────────────────────────────────────────────────────────────── */

export function fitRadiusMultiplier(visibleMapHeight: number): number {
  return visibleMapHeight > 0 && visibleMapHeight < COMPACT_MAP_HEIGHT
    ? COMPACT_FIT_RADIUS_MULTIPLIER
    : FIT_RADIUS_MULTIPLIER;
}

export function fitBoundsFor(
  center: Coordinates,
  radiusMeters: number,
  multiplier = FIT_RADIUS_MULTIPLIER,
): [[number, number], [number, number]] {
  const box = boundingBoxForRadius(center, radiusMeters * multiplier);
  return [[box.west, box.south], [box.east, box.north]];
}

/* ── Layers ───────────────────────────────────────────────────────────────── */

function groupColor(theme: MapTheme): ExpressionSpecification {
  const colors = GROUP_COLORS[theme];
  return [
    'match',
    ['get', 'group'],
    'violent', colors.violent,
    'property', colors.property,
    'vehicle', colors.vehicle,
    'weapons', colors.weapons,
    colors.other,
  ];
}

/** Dot area grows with the number of reports at a point; the cap keeps hot spots from hiding streets. */
function locationRadius(base: number, scale: number, cap: number): ExpressionSpecification {
  return ['min', cap, ['+', base, ['*', scale, ['sqrt', ['get', 'count']]]]];
}

export function atlasLayers(theme: MapTheme): LayerSpecification[] {
  const { ink, surface } = MAP_INK[theme];
  return [
    {
      id: 'analysis-circle-fill',
      type: 'fill',
      source: SOURCE_RINGS,
      filter: ['==', ['get', 'ring'], 'selected'],
      paint: { 'fill-color': ink, 'fill-opacity': theme === 'light' ? 0.045 : 0.07 },
    },
    {
      id: 'comparison-ring-line',
      type: 'line',
      source: SOURCE_RINGS,
      filter: ['==', ['get', 'ring'], 'comparison'],
      paint: { 'line-color': ink, 'line-width': 1.25, 'line-opacity': 0.42, 'line-dasharray': [2, 2.5] },
    },
    {
      id: 'analysis-circle-line',
      type: 'line',
      source: SOURCE_RINGS,
      filter: ['==', ['get', 'ring'], 'selected'],
      paint: { 'line-color': ink, 'line-width': 2, 'line-opacity': 0.82 },
    },
    {
      id: LOCATION_LAYER,
      type: 'circle',
      source: SOURCE_LOCATIONS,
      layout: { 'circle-sort-key': ['get', 'sortKey'] },
      paint: {
        'circle-color': groupColor(theme),
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10, locationRadius(1.6, 0.7, 9),
          13, locationRadius(2.6, 1.3, 15),
          16, locationRadius(4, 2.2, 24),
        ],
        'circle-opacity': ['case', ['==', ['get', 'inside'], 1], 0.9, 0.38],
        'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], ink, surface],
        'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 2.5, 1],
        'circle-stroke-opacity': ['case', ['==', ['get', 'inside'], 1], 0.95, 0.45],
      },
    },
  ];
}

/** OpenFreeMap serves only Noto Sans; MapLibre's default font stack would 404 on every label. */
export const RING_LABEL_FONT = ['Noto Sans Bold'];

/** Symbol layers need glyphs; the offline e2e style has none, so rings stay unlabeled there. */
export function ringLabelLayer(theme: MapTheme): LayerSpecification {
  const { ink, surface } = MAP_INK[theme];
  return {
    id: RING_LABEL_LAYER,
    type: 'symbol',
    source: SOURCE_RING_LABELS,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': RING_LABEL_FONT,
      'text-size': 11,
      'text-anchor': 'bottom',
      'text-offset': [0, -0.3],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': ink, 'text-halo-color': surface, 'text-halo-width': 1.6, 'text-opacity': 0.82 },
  };
}
