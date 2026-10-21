import type { StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { categoryGroup, isViolentCategory, severityForCategory } from '../domain/categories';
import type { Coordinates, CrimeCategory, Incident } from '../types';
import {
  ATLAS_LAYERS,
  centerFeature,
  COMPACT_FIT_RADIUS_MULTIPLIER,
  COMPACT_MAP_HEIGHT,
  FIT_RADIUS_MULTIPLIER,
  fitRadiusMultiplier,
  CLUSTER_LABEL_LAYER,
  CLUSTER_LABEL_LAYER_SPEC,
  CLUSTER_LAYER,
  emptyFeatureCollection,
  fitBoundsFor,
  INCIDENT_LAYER,
  incidentFeatureCollection,
  INTERACTIVE_LAYERS,
  isDeterministicMode,
  mapStyle,
  OPENFREEMAP_STYLES,
  SOURCE_CENTER,
  SOURCE_INCIDENTS,
  SOURCE_RADIUS,
  viewportPadding,
} from './mapLayers';
import { offlineStyle } from './offlineMapStyle';

const CENTER: Coordinates = [-87.6298, 41.8837];

function incident(id: string, category: CrimeCategory, coordinates: Coordinates): Incident {
  return {
    id,
    providerId: 'test',
    occurredAt: '2026-10-01T12:00:00',
    occurredAtEpochMs: Date.UTC(2026, 9, 1, 12),
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
    expect(isDeterministicMode('')).toBe(false);
  });

  it('uses the OpenFreeMap styles for each theme outside deterministic mode', () => {
    expect(mapStyle('light', CENTER, '')).toBe(OPENFREEMAP_STYLES.light);
    expect(mapStyle('dark', CENTER, '?lat=41')).toBe(OPENFREEMAP_STYLES.dark);
    expect(OPENFREEMAP_STYLES.light).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  });

  it('renders a self-contained offline style in deterministic mode', () => {
    const style = mapStyle('dark', CENTER, '?e2e=1');
    expect(typeof style).toBe('object');
    const offline = style as StyleSpecification;
    expect(offline).toEqual(offlineStyle('dark', CENTER));
    expect(offline.glyphs).toBeUndefined();
    expect(JSON.stringify(offline)).not.toMatch(/https?:\/\//);
  });
});

describe('offline acceptance style', () => {
  it('switches every painted color between light and dark themes', () => {
    const light = offlineStyle('light', CENTER);
    const dark = offlineStyle('dark', CENTER);
    expect(light.layers.map((layer) => layer.id)).toEqual(dark.layers.map((layer) => layer.id));
    const background = (style: StyleSpecification) => (
      style.layers[0] as unknown as { paint: Record<string, string> }
    ).paint['background-color'];
    expect(background(light)).toBe('#e8e6df');
    expect(background(dark)).toBe('#151714');
    for (const [index, layer] of light.layers.entries()) {
      expect(JSON.stringify(layer)).not.toBe(JSON.stringify(dark.layers[index]));
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

describe('incident GeoJSON', () => {
  it('starts sources empty', () => {
    expect(emptyFeatureCollection()).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('flags inside, violent and selected incidents for paint expressions', () => {
    const near = incident('near', 'robbery', [CENTER[0] + 0.001, CENTER[1]]);
    const far = incident('far', 'theft', [CENTER[0] + 0.03, CENTER[1]]);
    const collection = incidentFeatureCollection(CENTER, 1000, [near, far], 'far');

    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]).toEqual({
      type: 'Feature',
      id: 'near',
      properties: { id: 'near', category: 'robbery', severity: 4, violent: 1, inside: 1, selected: 0 },
      geometry: { type: 'Point', coordinates: [CENTER[0] + 0.001, CENTER[1]] },
    });
    expect(collection.features[1]?.properties).toMatchObject({ violent: 0, inside: 0, selected: 1 });
  });

  it('treats the radius boundary as inside', () => {
    const edge = incident('edge', 'assault', [CENTER[0], CENTER[1] + 0.0089]);
    expect(incidentFeatureCollection(CENTER, 990, [edge], null).features[0]?.properties.inside).toBe(1);
    expect(incidentFeatureCollection(CENTER, 980, [edge], null).features[0]?.properties.inside).toBe(0);
  });

  it('builds a mutable point feature for the analysis center', () => {
    expect(centerFeature(CENTER)).toEqual({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [CENTER[0], CENTER[1]] },
    });
  });
});

describe('viewport framing', () => {
  it('fits slightly beyond the three-radius comparison area', () => {
    const [[west, south], [east, north]] = fitBoundsFor(CENTER, 1000);
    const latitudeSpanMeters = (north - south) * 111_195.08;
    expect(latitudeSpanMeters / 2).toBeCloseTo(3250, 0);
    expect(west).toBeLessThan(CENTER[0]);
    expect(east).toBeGreaterThan(CENTER[0]);
    expect(east - CENTER[0]).toBeCloseTo(CENTER[0] - west, 9);
  });

  it('frames the selected circle more tightly on short maps', () => {
    expect(fitRadiusMultiplier(1200)).toBe(FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(COMPACT_MAP_HEIGHT)).toBe(FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(COMPACT_MAP_HEIGHT - 1)).toBe(COMPACT_FIT_RADIUS_MULTIPLIER);
    expect(fitRadiusMultiplier(250)).toBe(COMPACT_FIT_RADIUS_MULTIPLIER);
    // An unmeasured (zero-height) container keeps the full comparison framing.
    expect(fitRadiusMultiplier(0)).toBe(FIT_RADIUS_MULTIPLIER);

    const [[, south], [, north]] = fitBoundsFor(CENTER, 1000, COMPACT_FIT_RADIUS_MULTIPLIER);
    expect(((north - south) * 111_195.08) / 2).toBeCloseTo(1750, 0);
  });

  it('clears the floating panels at each layout breakpoint', () => {
    expect(viewportPadding(390)).toEqual({ top: 32, right: 32, bottom: 32, left: 32 });
    expect(viewportPadding(1000)).toEqual({ top: 32, right: 32, bottom: 32, left: 32 });
    expect(viewportPadding(1001)).toEqual({ top: 96, right: 364, bottom: 54, left: 322 });
    expect(viewportPadding(1180)).toEqual({ top: 96, right: 364, bottom: 54, left: 322 });
    expect(viewportPadding(1440)).toEqual({ top: 100, right: 468, bottom: 60, left: 404 });
  });
});

describe('atlas layer specifications', () => {
  it('draws the radius, incidents and center from their own sources in paint order', () => {
    expect(ATLAS_LAYERS.map((layer) => layer.id)).toEqual([
      'analysis-radius-fill',
      'analysis-radius-line',
      CLUSTER_LAYER,
      INCIDENT_LAYER,
      'analysis-center-ring',
      'analysis-center-dot',
    ]);
    const sources = ATLAS_LAYERS.map((layer) => ('source' in layer ? layer.source : null));
    expect(sources).toEqual([
      SOURCE_RADIUS,
      SOURCE_RADIUS,
      SOURCE_INCIDENTS,
      SOURCE_INCIDENTS,
      SOURCE_CENTER,
      SOURCE_CENTER,
    ]);
    expect(new Set(ATLAS_LAYERS.map((layer) => layer.id)).size).toBe(ATLAS_LAYERS.length);
  });

  it('splits clusters from raw points so both stay interactive', () => {
    const cluster = ATLAS_LAYERS.find((layer) => layer.id === CLUSTER_LAYER);
    const points = ATLAS_LAYERS.find((layer) => layer.id === INCIDENT_LAYER);
    expect(cluster && 'filter' in cluster ? cluster.filter : null).toEqual(['has', 'point_count']);
    expect(points && 'filter' in points ? points.filter : null).toEqual(['!', ['has', 'point_count']]);
    expect(INTERACTIVE_LAYERS).toEqual([CLUSTER_LAYER, INCIDENT_LAYER]);
  });

  it('colors every violent category identically and dims observations outside the circle', () => {
    const points = ATLAS_LAYERS.find((layer) => layer.id === INCIDENT_LAYER) as unknown as {
      paint: Record<string, unknown[]>;
    };
    const match = points.paint['circle-color']!;
    const colorFor = (category: string) => match[match.indexOf(category) + 1];
    const violent = new Set(['homicide', 'sexual', 'robbery', 'assault'].map(colorFor));
    expect(violent.size).toBe(1);
    expect(colorFor('burglary')).toBe(colorFor('theft'));
    expect(colorFor('theft')).not.toBe(colorFor('robbery'));
    expect(points.paint['circle-opacity']).toEqual(['case', ['==', ['get', 'inside'], 1], 0.86, 0.34]);
  });

  it('labels clusters with abbreviated counts from the incident source', () => {
    expect(CLUSTER_LABEL_LAYER_SPEC).toMatchObject({
      id: CLUSTER_LABEL_LAYER,
      type: 'symbol',
      source: SOURCE_INCIDENTS,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'] },
    });
  });
});
