import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { COMPARISON_RADIUS_MULTIPLIER } from '../domain/analysis';
import { categoryGroup, isViolentCategory, severityForCategory } from '../domain/categories';
import { haversineDistance } from '../domain/geo';
import { GROUP_COLORS, MAP_INK } from '../domain/palette';
import type { Coordinates, CrimeCategory, Incident } from '../types';
import {
  atlasLayers,
  COMPACT_FIT_RADIUS_MULTIPLIER,
  COMPACT_MAP_HEIGHT,
  emptyFeatureCollection,
  FIT_RADIUS_MULTIPLIER,
  fitBoundsFor,
  fitRadiusMultiplier,
  groupIncidentsByLocation,
  INTERACTIVE_LAYERS,
  isDeterministicMode,
  LOCATION_LAYER,
  locationFeatureCollection,
  locationKey,
  mapStyle,
  OPENFREEMAP_STYLES,
  RING_LABEL_FONT,
  RING_LABEL_LAYER,
  ringFeatureCollection,
  ringLabelFeatureCollection,
  ringLabelLayer,
  SOURCE_LOCATIONS,
  SOURCE_RING_LABELS,
  SOURCE_RINGS,
  type ReportLocation,
} from './mapLayers';
import { offlineStyle } from './offlineMapStyle';

const CENTER: Coordinates = [-87.6298, 41.8837];
/** ≈83 m east of the center: inside a 1 km circle. */
const NEAR: Coordinates = [-87.6288, 41.8837];
/** ≈2.5 km east: outside a 1 km circle. */
const FAR: Coordinates = [-87.5998, 41.8837];
const METERS_PER_DEGREE_LATITUDE = 111_195.08;

function incident(
  id: string,
  category: CrimeCategory,
  coordinates: Coordinates,
  occurredAt = '2026-10-01T12:00:00',
): Incident {
  return {
    id,
    providerId: 'test',
    occurredAt,
    occurredAtEpochMs: Date.parse(`${occurredAt}Z`),
    localHour: 12,
    category,
    group: categoryGroup(category),
    rawCategory: category,
    description: category,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

function location(key: string, count: number, inside: boolean): ReportLocation {
  return {
    key,
    coordinates: NEAR,
    incidents: Array.from({ length: count }, (_, index) => incident(`${key}-${index}`, 'theft', NEAR)),
    group: 'property',
    inside,
  };
}

function layer(layers: LayerSpecification[], id: string) {
  const found = layers.find((item) => item.id === id);
  if (!found) throw new Error(`Missing layer ${id}`);
  return found as LayerSpecification & {
    source: string;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint: Record<string, unknown>;
  };
}

function lineCoordinates(style: StyleSpecification, sourceId: string) {
  const source = style.sources[sourceId];
  if (source?.type !== 'geojson' || typeof source.data !== 'object' || source.data.type !== 'FeatureCollection') {
    throw new Error(`Missing GeoJSON source ${sourceId}`);
  }
  return source.data.features;
}

describe('map style selection', () => {
  it('recognizes only an explicit e2e=1 flag as deterministic mode', () => {
    expect(isDeterministicMode('?e2e=1')).toBe(true);
    expect(isDeterministicMode('?lat=1&e2e=1')).toBe(true);
    expect(isDeterministicMode('?e2e=0')).toBe(false);
    expect(isDeterministicMode('?e2e')).toBe(false);
    expect(isDeterministicMode('')).toBe(false);
  });

  it('uses the OpenFreeMap styles for each theme outside deterministic mode', () => {
    expect(mapStyle('light', CENTER, '')).toBe(OPENFREEMAP_STYLES.light);
    expect(mapStyle('dark', CENTER, '?lat=41')).toBe(OPENFREEMAP_STYLES.dark);
    expect(OPENFREEMAP_STYLES).toEqual({
      light: 'https://tiles.openfreemap.org/styles/positron',
      dark: 'https://tiles.openfreemap.org/styles/dark',
    });
  });

  it('renders a self-contained offline style in deterministic mode', () => {
    const style = mapStyle('dark', CENTER, '?e2e=1');
    expect(typeof style).toBe('object');
    const offline = style as StyleSpecification;
    expect(offline).toEqual(offlineStyle('dark', CENTER));
    expect(offline.glyphs).toBeUndefined();
    expect(JSON.stringify(offline)).not.toMatch(/https?:\/\//);
  });

  it('starts sources empty', () => {
    expect(emptyFeatureCollection()).toEqual({ type: 'FeatureCollection', features: [] });
    expect(emptyFeatureCollection()).not.toBe(emptyFeatureCollection());
  });
});

describe('offline acceptance style', () => {
  it('switches every painted color between light and dark themes', () => {
    const light = offlineStyle('light', CENTER);
    const dark = offlineStyle('dark', CENTER);
    expect(light.layers.map((item) => item.id)).toEqual(dark.layers.map((item) => item.id));
    const background = (style: StyleSpecification) => (
      style.layers[0] as unknown as { paint: Record<string, string> }
    ).paint['background-color'];
    expect(background(light)).toBe('#e8e6df');
    expect(background(dark)).toBe('#151714');
    for (const [index, item] of light.layers.entries()) {
      expect(JSON.stringify(item)).not.toBe(JSON.stringify(dark.layers[index]));
    }
  });

  it('translates the synthetic street grid and areas to the requested center', () => {
    const home = offlineStyle('light', [-73.9855, 40.758]);
    const shifted = offlineStyle('light', [-73.9855 + 1, 40.758 - 2]);

    const homeStreets = lineCoordinates(home, 'offline-streets');
    const shiftedStreets = lineCoordinates(shifted, 'offline-streets');
    expect(shiftedStreets).toHaveLength(homeStreets.length);
    const homeLine = homeStreets[0]!.geometry as GeoJSON.LineString;
    const shiftedLine = shiftedStreets[0]!.geometry as GeoJSON.LineString;
    expect(shiftedLine.coordinates[0]![0]).toBeCloseTo(homeLine.coordinates[0]![0]! + 1, 9);
    expect(shiftedLine.coordinates[0]![1]).toBeCloseTo(homeLine.coordinates[0]![1]! - 2, 9);

    const homeAreas = lineCoordinates(home, 'offline-areas');
    const shiftedAreas = lineCoordinates(shifted, 'offline-areas');
    expect(shiftedAreas.map((feature) => feature.properties?.kind))
      .toEqual(homeAreas.map((feature) => feature.properties?.kind));
    const plaza = homeAreas.findIndex((feature) => feature.properties?.kind === 'plaza');
    expect(plaza).toBeGreaterThanOrEqual(0);
    const homeRing = (homeAreas[plaza]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    const shiftedRing = (shiftedAreas[plaza]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    expect(shiftedRing[1]![0]).toBeCloseTo(homeRing[1]![0]! + 1, 9);
    expect(shiftedRing[1]![1]).toBeCloseTo(homeRing[1]![1]! - 2, 9);
  });
});

describe('report locations', () => {
  it('keys a point by its coordinates rounded to five decimals', () => {
    expect(locationKey([-87.62981234, 41.88371234])).toBe('-87.62981,41.88371');
    expect(locationKey([-87.629806, 41.883706])).toBe('-87.62981,41.88371');
    expect(locationKey([-87.6298, 41.8837])).toBe('-87.62980,41.88370');
    expect(locationKey([-87.62981234, 41.88371234])).not.toBe(locationKey([-87.62982, 41.88371]));
  });

  it('returns no locations for no incidents', () => {
    expect(groupIncidentsByLocation(CENTER, 1000, [])).toEqual([]);
  });

  it('merges reports at the same rounded point and lists them newest first', () => {
    const older = incident('older', 'theft', [-87.628801, 41.883701], '2026-09-01T08:00:00');
    const newest = incident('newest', 'theft', [-87.628804, 41.883704], '2026-10-01T23:00:00');
    const middle = incident('middle', 'theft', [-87.6288, 41.8837], '2026-09-15T12:00:00');
    const elsewhere = incident('elsewhere', 'robbery', FAR, '2026-09-20T12:00:00');

    const locations = groupIncidentsByLocation(CENTER, 1000, [older, elsewhere, newest, middle]);

    expect(locations.map((item) => item.key)).toEqual(['-87.62880,41.88370', locationKey(FAR)]);
    const [merged, single] = locations;
    expect(merged?.incidents.map((item) => item.id)).toEqual(['newest', 'middle', 'older']);
    // The point is drawn where the newest report sits.
    expect(merged?.coordinates).toEqual(newest.coordinates);
    expect(single?.incidents).toEqual([elsewhere]);
    expect(single?.coordinates).toEqual(FAR);
  });

  it('flags locations inside the circle by Haversine distance, the boundary included', () => {
    const [near, far] = groupIncidentsByLocation(CENTER, 1000, [incident('near', 'theft', NEAR), incident('far', 'theft', FAR)]);
    expect(near?.inside).toBe(true);
    expect(far?.inside).toBe(false);

    const edge = incident('edge', 'theft', [CENTER[0], CENTER[1] + 0.009]);
    const distance = haversineDistance(CENTER, edge.coordinates);
    expect(groupIncidentsByLocation(CENTER, distance, [edge])[0]?.inside).toBe(true);
    expect(groupIncidentsByLocation(CENTER, distance - 0.01, [edge])[0]?.inside).toBe(false);
  });

  it('colors a location by its most common group', () => {
    const [location] = groupIncidentsByLocation(CENTER, 1000, [
      incident('theft-1', 'theft', NEAR),
      incident('burglary', 'burglary', NEAR),
      incident('robbery', 'robbery', NEAR),
    ]);
    expect(location?.group).toBe('property');
  });

  it.each([
    [['theft', 'robbery'], 'violent'],
    [['weapons', 'theft'], 'weapons'],
    [['vehicle', 'burglary'], 'property'],
    [['other', 'vehicle'], 'vehicle'],
    [['other', 'other'], 'other'],
    [['other', 'assault', 'weapons', 'theft', 'vehicle'], 'violent'],
  ] as const)('breaks a tie between %j in favor of %s', (categories, group) => {
    const incidents = categories.map((category, index) => incident(`${category}-${index}`, category, NEAR));
    expect(groupIncidentsByLocation(CENTER, 1000, incidents)[0]?.group).toBe(group);
  });
});

describe('location GeoJSON', () => {
  it('describes each location as a point keyed by its location key', () => {
    const [location] = groupIncidentsByLocation(CENTER, 1000, [
      incident('a', 'robbery', NEAR),
      incident('b', 'robbery', NEAR),
    ]);
    const collection = locationFeatureCollection([location!], null);
    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: location!.key,
        properties: { key: location!.key, count: 2, group: 'violent', inside: 1, selected: 0, sortKey: 1_000_000 - 2 },
        geometry: { type: 'Point', coordinates: [NEAR[0], NEAR[1]] },
      }],
    });
  });

  it('marks only the selected location', () => {
    const collection = locationFeatureCollection([location('a', 1, true), location('b', 1, false)], 'b');
    expect(collection.features.map((feature) => feature.properties.selected)).toEqual([0, 1]);
    expect(collection.features.map((feature) => feature.properties.inside)).toEqual([1, 0]);
    expect(locationFeatureCollection([location('a', 1, true)], 'missing').features[0]?.properties.selected).toBe(0);
  });

  it('draws the selected location on top, then locations inside the circle, then smaller stacks', () => {
    const locations = [
      location('outside-large', 40, false),
      location('outside-small', 1, false),
      location('inside-large', 300, true),
      location('inside-small', 2, true),
      location('selected-outside', 500, false),
    ];
    const features = locationFeatureCollection(locations, 'selected-outside').features;
    const byDrawOrder = [...features]
      .sort((left, right) => left.properties.sortKey - right.properties.sortKey)
      .map((feature) => feature.properties.key);
    expect(byDrawOrder).toEqual(['outside-large', 'outside-small', 'inside-large', 'inside-small', 'selected-outside']);
    expect(features.map((feature) => feature.properties.sortKey)).toEqual([-40, -1, 999_700, 999_998, 1_999_500]);
  });

  it('returns an empty collection for no locations', () => {
    expect(locationFeatureCollection([], 'any')).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('analysis rings', () => {
  it('draws the selected circle and the comparison ring at three radii', () => {
    const collection = ringFeatureCollection(CENTER, 1000);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features.map((feature) => feature.properties?.ring)).toEqual(['selected', 'comparison']);
    const radii = collection.features.map((feature) => {
      expect(feature.geometry.type).toBe('Polygon');
      const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0]!;
      expect(ring.at(-1)).toEqual(ring[0]);
      return ring.map((position) => haversineDistance(CENTER, [position[0]!, position[1]!]));
    });
    for (const distance of radii[0]!) expect(distance).toBeCloseTo(1000, 3);
    for (const distance of radii[1]!) expect(distance).toBeCloseTo(1000 * COMPARISON_RADIUS_MULTIPLIER, 3);
  });

  it.each([
    [500, ['500 m', '1.5 km comparison']],
    [1000, ['1 km', '3 km comparison']],
    [2000, ['2 km', '6 km comparison']],
  ] as const)('labels the %s m rings due north of the center', (radius, labels) => {
    const collection = ringLabelFeatureCollection(CENTER, radius);
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features.map((feature) => feature.properties?.label)).toEqual(labels);
    const distances = [radius, radius * COMPARISON_RADIUS_MULTIPLIER];
    for (const [index, feature] of collection.features.entries()) {
      expect(feature.type).toBe('Feature');
      expect(feature.geometry.type).toBe('Point');
      const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      expect(longitude).toBeCloseTo(CENTER[0], 9);
      expect(latitude).toBeGreaterThan(CENTER[1]);
      expect(haversineDistance(CENTER, [longitude, latitude])).toBeCloseTo(distances[index]!, 3);
    }
  });
});

describe('viewport framing', () => {
  it('fits slightly beyond the three-radius comparison area', () => {
    expect(FIT_RADIUS_MULTIPLIER).toBe(COMPARISON_RADIUS_MULTIPLIER + 0.25);
    const [[west, south], [east, north]] = fitBoundsFor(CENTER, 1000);
    expect(((north - south) * METERS_PER_DEGREE_LATITUDE) / 2).toBeCloseTo(3250, 0);
    expect(west).toBeLessThan(CENTER[0]);
    expect(east).toBeGreaterThan(CENTER[0]);
    expect(east - CENTER[0]).toBeCloseTo(CENTER[0] - west, 9);
    expect(fitBoundsFor(CENTER, 1000, FIT_RADIUS_MULTIPLIER)).toEqual(fitBoundsFor(CENTER, 1000));
  });

  it('frames the selected circle more tightly on short maps', () => {
    expect(fitRadiusMultiplier(1200)).toBe(FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(COMPACT_MAP_HEIGHT)).toBe(FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(COMPACT_MAP_HEIGHT - 1)).toBe(COMPACT_FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(250)).toBe(COMPACT_FIT_RADIUS_MULTIPLIER);
    // An unmeasured (zero or negative height) container keeps the full comparison framing.
    expect(fitRadiusMultiplier(0)).toBe(FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(-100)).toBe(FIT_RADIUS_MULTIPLIER);

    const [[, south], [, north]] = fitBoundsFor(CENTER, 1000, COMPACT_FIT_RADIUS_MULTIPLIER);
    expect(((north - south) * METERS_PER_DEGREE_LATITUDE) / 2).toBeCloseTo(1600, 0);
  });
});

describe('atlas layer specifications', () => {
  it.each(['light', 'dark'] as const)('draws the rings and locations from their own sources in paint order (%s)', (theme) => {
    const layers = atlasLayers(theme);
    expect(layers.map((item) => item.id)).toEqual([
      'analysis-circle-fill',
      'comparison-ring-line',
      'analysis-circle-line',
      LOCATION_LAYER,
    ]);
    expect(layers.map((item) => ('source' in item ? item.source : null))).toEqual([
      SOURCE_RINGS,
      SOURCE_RINGS,
      SOURCE_RINGS,
      SOURCE_LOCATIONS,
    ]);
    expect(layers.map((item) => item.type)).toEqual(['fill', 'line', 'line', 'circle']);
  });

  it('filters ring layers to the ring each one draws', () => {
    const layers = atlasLayers('light');
    expect(layer(layers, 'analysis-circle-fill').filter).toEqual(['==', ['get', 'ring'], 'selected']);
    expect(layer(layers, 'analysis-circle-line').filter).toEqual(['==', ['get', 'ring'], 'selected']);
    expect(layer(layers, 'comparison-ring-line').filter).toEqual(['==', ['get', 'ring'], 'comparison']);
    expect(layer(layers, LOCATION_LAYER).filter).toBeUndefined();
  });

  it.each(['light', 'dark'] as const)('paints the rings in the %s map ink', (theme) => {
    const layers = atlasLayers(theme);
    const { ink } = MAP_INK[theme];
    expect(layer(layers, 'analysis-circle-fill').paint).toEqual({
      'fill-color': ink,
      'fill-opacity': theme === 'light' ? 0.045 : 0.07,
    });
    expect(layer(layers, 'comparison-ring-line').paint).toMatchObject({ 'line-color': ink, 'line-dasharray': [2, 2.5] });
    expect(layer(layers, 'analysis-circle-line').paint).toMatchObject({ 'line-color': ink, 'line-width': 2 });
  });

  it.each(['light', 'dark'] as const)('colors locations by group with the %s palette', (theme) => {
    const colors = GROUP_COLORS[theme];
    const { ink, surface } = MAP_INK[theme];
    const locations = layer(atlasLayers(theme), LOCATION_LAYER);
    expect(locations.layout).toEqual({ 'circle-sort-key': ['get', 'sortKey'] });
    expect(locations.paint['circle-color']).toEqual([
      'match',
      ['get', 'group'],
      'violent', colors.violent,
      'property', colors.property,
      'vehicle', colors.vehicle,
      'weapons', colors.weapons,
      colors.other,
    ]);
    expect(locations.paint['circle-opacity']).toEqual(['case', ['==', ['get', 'inside'], 1], 0.9, 0.38]);
    expect(locations.paint['circle-stroke-color']).toEqual(['case', ['==', ['get', 'selected'], 1], ink, surface]);
    expect(locations.paint['circle-stroke-width']).toEqual(['case', ['==', ['get', 'selected'], 1], 2.5, 1]);
    expect(locations.paint['circle-stroke-opacity']).toEqual(['case', ['==', ['get', 'inside'], 1], 0.95, 0.45]);
  });

  it('grows dots with the square root of their count up to a cap at each zoom', () => {
    const radius = layer(atlasLayers('light'), LOCATION_LAYER).paint['circle-radius'];
    const sized = (base: number, scale: number, cap: number) => ['min', cap, ['+', base, ['*', scale, ['sqrt', ['get', 'count']]]]];
    expect(radius).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      10, sized(1.6, 0.7, 9),
      13, sized(2.6, 1.3, 15),
      16, sized(4, 2.2, 24),
    ]);
  });

  it('makes only report locations interactive', () => {
    expect(INTERACTIVE_LAYERS).toEqual([LOCATION_LAYER]);
  });

  it.each(['light', 'dark'] as const)('labels the rings in Noto Sans with a %s halo', (theme) => {
    const { ink, surface } = MAP_INK[theme];
    expect(RING_LABEL_FONT).toEqual(['Noto Sans Bold']);
    expect(ringLabelLayer(theme)).toEqual({
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
    });
  });

  it('keeps every layer id unique, the ring labels included', () => {
    const ids = [...atlasLayers('light'), ringLabelLayer('light')].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
