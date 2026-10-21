import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { COMPARISON_RADIUS_MULTIPLIER } from '../domain/analysis';
import { boundingBoxForRadius, haversineDistance } from '../domain/geo';
import type { Coordinates, Incident } from '../types';
import { offlineStyle } from './offlineMapStyle';

export type MapTheme = 'light' | 'dark';

export const SOURCE_INCIDENTS = 'atlas-incidents';
export const SOURCE_RADIUS = 'atlas-radius';
export const SOURCE_CENTER = 'atlas-center';
export const CLUSTER_LAYER = 'incident-clusters';
export const CLUSTER_LABEL_LAYER = 'incident-cluster-count';
export const INCIDENT_LAYER = 'incident-points';
export const INTERACTIVE_LAYERS = [CLUSTER_LAYER, INCIDENT_LAYER] as const;

/** Slightly larger than the comparison area so the outer ring has context. */
export const FIT_RADIUS_MULTIPLIER = COMPARISON_RADIUS_MULTIPLIER + 0.25;
/** Short maps (the mobile flow) frame the selected circle with a little nearby context instead. */
export const COMPACT_FIT_RADIUS_MULTIPLIER = 1.75;
export const COMPACT_MAP_HEIGHT = 480;

const VIOLENT_COLOR = '#c45d48';
const PROPERTY_COLOR = '#b09150';

export interface IncidentMapProperties {
  id: string;
  category: Incident['category'];
  severity: number;
  violent: number;
  inside: number;
  selected: number;
}

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

export function incidentFeatureCollection(
  center: Coordinates,
  radiusMeters: number,
  incidents: readonly Incident[],
  selectedIncidentId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.Point, IncidentMapProperties> {
  return {
    type: 'FeatureCollection',
    features: incidents.map((incident) => ({
      type: 'Feature',
      id: incident.id,
      properties: {
        id: incident.id,
        category: incident.category,
        severity: incident.severity,
        violent: incident.isViolent ? 1 : 0,
        inside: haversineDistance(center, incident.coordinates) <= radiusMeters ? 1 : 0,
        selected: incident.id === selectedIncidentId ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [incident.coordinates[0], incident.coordinates[1]] },
    })),
  };
}

export function centerFeature(center: Coordinates): GeoJSON.Feature<GeoJSON.Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [center[0], center[1]] } };
}

export function fitRadiusMultiplier(mapHeight: number): number {
  return mapHeight > 0 && mapHeight < COMPACT_MAP_HEIGHT ? COMPACT_FIT_RADIUS_MULTIPLIER : FIT_RADIUS_MULTIPLIER;
}

export function fitBoundsFor(
  center: Coordinates,
  radiusMeters: number,
  multiplier = FIT_RADIUS_MULTIPLIER,
): [[number, number], [number, number]] {
  const box = boundingBoxForRadius(center, radiusMeters * multiplier);
  return [[box.west, box.south], [box.east, box.north]];
}

/** Keeps the analysis circle clear of the floating panels at each layout breakpoint. */
export function viewportPadding(viewportWidth: number) {
  if (viewportWidth <= 1000) return { top: 32, right: 32, bottom: 32, left: 32 };
  if (viewportWidth <= 1180) return { top: 96, right: 364, bottom: 54, left: 322 };
  return { top: 100, right: 468, bottom: 60, left: 404 };
}

export const ATLAS_LAYERS: readonly LayerSpecification[] = [
  {
    id: 'analysis-radius-fill',
    type: 'fill',
    source: SOURCE_RADIUS,
    paint: { 'fill-color': '#e1714d', 'fill-opacity': 0.075 },
  },
  {
    id: 'analysis-radius-line',
    type: 'line',
    source: SOURCE_RADIUS,
    paint: { 'line-color': '#c65f3f', 'line-width': 1.5, 'line-opacity': 0.72, 'line-dasharray': [3, 2] },
  },
  {
    id: CLUSTER_LAYER,
    type: 'circle',
    source: SOURCE_INCIDENTS,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#252821',
      'circle-opacity': 0.88,
      'circle-radius': ['step', ['get', 'point_count'], 15, 20, 19, 80, 23],
      'circle-stroke-color': 'rgba(255,255,255,0.84)',
      'circle-stroke-width': 1.5,
    },
  },
  {
    id: INCIDENT_LAYER,
    type: 'circle',
    source: SOURCE_INCIDENTS,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match',
        ['get', 'category'],
        'homicide', VIOLENT_COLOR,
        'sexual', VIOLENT_COLOR,
        'robbery', VIOLENT_COLOR,
        'assault', VIOLENT_COLOR,
        'burglary', PROPERTY_COLOR,
        'theft', PROPERTY_COLOR,
        'vehicle', '#697791',
        'weapons', '#997246',
        '#7d8378',
      ],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10, ['+', 3.5, ['*', ['get', 'severity'], 0.25]],
        15, ['+', 5, ['*', ['get', 'severity'], 0.48]],
      ],
      'circle-opacity': ['case', ['==', ['get', 'inside'], 1], 0.86, 0.34],
      'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#1b1d19', '#f7f3eb'],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 1.25],
      'circle-stroke-opacity': ['case', ['==', ['get', 'inside'], 1], 0.92, 0.48],
    },
  },
  {
    id: 'analysis-center-ring',
    type: 'circle',
    source: SOURCE_CENTER,
    paint: {
      'circle-radius': 8,
      'circle-color': 'rgba(255,255,255,0.92)',
      'circle-stroke-color': '#1b1d19',
      'circle-stroke-width': 1.3,
    },
  },
  {
    id: 'analysis-center-dot',
    type: 'circle',
    source: SOURCE_CENTER,
    paint: { 'circle-radius': 3.1, 'circle-color': '#e1714d' },
  },
];

/** OpenFreeMap serves only Noto Sans; MapLibre's default font stack would 404 on every label. */
export const CLUSTER_LABEL_FONT = ['Noto Sans Bold'];

/** Symbol layers need glyphs; the offline e2e style has none, so clusters stay unlabeled there. */
export const CLUSTER_LABEL_LAYER_SPEC: LayerSpecification = {
  id: CLUSTER_LABEL_LAYER,
  type: 'symbol',
  source: SOURCE_INCIDENTS,
  filter: ['has', 'point_count'],
  layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': CLUSTER_LABEL_FONT, 'text-size': 10 },
  paint: { 'text-color': '#f7f3eb' },
};
