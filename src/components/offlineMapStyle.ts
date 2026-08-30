import type { StyleSpecification } from 'maplibre-gl';
import type { Coordinates } from '../types';

const offlineCenter: Coordinates = [-73.9855, 40.758];

const streetLongitudes = Array.from({ length: 15 }, (_, index) => -74.035 + index * 0.007);
const streetLatitudes = Array.from({ length: 15 }, (_, index) => 40.725 + index * 0.0048);

const streetFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [
  ...streetLongitudes.map((longitude, index) => ({
    type: 'Feature' as const,
    properties: { kind: index % 2 === 0 ? 'avenue' : 'street' },
    geometry: {
      type: 'LineString' as const,
      coordinates: [[longitude, 40.718], [longitude, 40.798]],
    },
  })),
  ...streetLatitudes.map((latitude, index) => ({
    type: 'Feature' as const,
    properties: { kind: index % 3 === 0 ? 'avenue' : 'street' },
    geometry: {
      type: 'LineString' as const,
      coordinates: [[-74.045, latitude], [-73.93, latitude]],
    },
  })),
  {
    type: 'Feature',
    properties: { kind: 'broadway' },
    geometry: {
      type: 'LineString',
      coordinates: [[-74.035, 40.725], [-74.012, 40.741], [-73.989, 40.756], [-73.964, 40.775], [-73.94, 40.792]],
    },
  },
];

const areaFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [
  {
    type: 'Feature',
    properties: { kind: 'water' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-74.06, 40.71], [-74.025, 40.71], [-74.025, 40.81], [-74.06, 40.81], [-74.06, 40.71]]],
    },
  },
  {
    type: 'Feature',
    properties: { kind: 'water' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-73.945, 40.71], [-73.915, 40.71], [-73.915, 40.81], [-73.945, 40.81], [-73.945, 40.71]]],
    },
  },
  {
    type: 'Feature',
    properties: { kind: 'park' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-73.9868, 40.7512], [-73.9822, 40.7512], [-73.9822, 40.7541], [-73.9868, 40.7541], [-73.9868, 40.7512]]],
    },
  },
  {
    type: 'Feature',
    properties: { kind: 'plaza' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[-73.9885, 40.7555], [-73.984, 40.7555], [-73.984, 40.7605], [-73.9885, 40.7605], [-73.9885, 40.7555]]],
    },
  },
];

function shiftPosition(position: GeoJSON.Position, center: Coordinates): GeoJSON.Position {
  return [
    position[0]! + center[0] - offlineCenter[0],
    position[1]! + center[1] - offlineCenter[1],
  ];
}

function shiftedStreetFeatures(center: Coordinates): GeoJSON.Feature<GeoJSON.LineString>[] {
  return streetFeatures.map((feature) => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map((position) => shiftPosition(position, center)),
    },
  }));
}

function shiftedAreaFeatures(center: Coordinates): GeoJSON.Feature<GeoJSON.Polygon>[] {
  return areaFeatures.map((feature) => ({
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: feature.geometry.coordinates.map((ring) => (
        ring.map((position) => shiftPosition(position, center))
      )),
    },
  }));
}

export function offlineStyle(theme: 'light' | 'dark', center: Coordinates): StyleSpecification {
  const dark = theme === 'dark';
  return {
    version: 8,
    name: 'Deterministic acceptance map',
    sources: {
      'offline-areas': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: shiftedAreaFeatures(center) },
      },
      'offline-streets': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: shiftedStreetFeatures(center) },
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': dark ? '#151714' : '#e8e6df' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'offline-areas',
        filter: ['==', ['get', 'kind'], 'water'],
        paint: { 'fill-color': dark ? '#1d2525' : '#dbe4e3', 'fill-opacity': 0.86 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'offline-areas',
        filter: ['==', ['get', 'kind'], 'park'],
        paint: { 'fill-color': dark ? '#1f2a20' : '#dce4d5', 'fill-opacity': 0.9 },
      },
      {
        id: 'plaza',
        type: 'fill',
        source: 'offline-areas',
        filter: ['==', ['get', 'kind'], 'plaza'],
        paint: { 'fill-color': dark ? '#24231f' : '#dedbd2', 'fill-opacity': 0.92 },
      },
      {
        id: 'minor-streets',
        type: 'line',
        source: 'offline-streets',
        filter: ['==', ['get', 'kind'], 'street'],
        paint: {
          'line-color': dark ? '#30332e' : '#d5d1c7',
          'line-opacity': 0.78,
          'line-width': 1,
        },
      },
      {
        id: 'avenues',
        type: 'line',
        source: 'offline-streets',
        filter: ['==', ['get', 'kind'], 'avenue'],
        paint: {
          'line-color': dark ? '#3b3d37' : '#c7c2b8',
          'line-opacity': 0.88,
          'line-width': 1.6,
        },
      },
      {
        id: 'broadway',
        type: 'line',
        source: 'offline-streets',
        filter: ['==', ['get', 'kind'], 'broadway'],
        paint: {
          'line-color': dark ? '#55524a' : '#aaa398',
          'line-opacity': 0.9,
          'line-width': 2.2,
        },
      },
    ],
  };
}
