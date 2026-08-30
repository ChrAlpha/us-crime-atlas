import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  type GeoJSONSource,
  type LayerSpecification,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { boundingBoxForRadius, circlePolygon, haversineDistance } from '../domain/geo';
import type { Coordinates, Incident } from '../types';
import { offlineStyle } from './offlineMapStyle';

interface AtlasMapProps {
  center: Coordinates;
  radiusMeters: number;
  incidents: Incident[];
  theme: 'light' | 'dark';
  selectedIncidentId: string | null;
  onPointChange(coordinates: Coordinates): void;
  onIncidentSelect(incident: Incident): void;
}

interface IncidentMapProperties {
  id: string;
  category: Incident['category'];
  severity: number;
  violent: number;
  inside: number;
  selected: number;
}

const SOURCE_INCIDENTS = 'atlas-incidents';
const SOURCE_RADIUS = 'atlas-radius';
const SOURCE_CENTER = 'atlas-center';
const CLUSTER_LAYER = 'incident-clusters';
const CLUSTER_LABEL_LAYER = 'incident-cluster-count';
const INCIDENT_LAYER = 'incident-points';

const emptyFeatureCollection = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

function mapStyle(theme: AtlasMapProps['theme'], center: Coordinates): string | StyleSpecification {
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') === '1') return offlineStyle(theme, center);
  return theme === 'dark'
    ? 'https://tiles.openfreemap.org/styles/dark'
    : 'https://tiles.openfreemap.org/styles/positron';
}

function sourceData(
  center: Coordinates,
  radiusMeters: number,
  incidents: Incident[],
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
      geometry: {
        type: 'Point',
        coordinates: [incident.coordinates[0], incident.coordinates[1]],
      },
    })),
  };
}

function ensureAtlasLayers(map: MapLibreMap) {
  if (!map.getSource(SOURCE_RADIUS)) {
    map.addSource(SOURCE_RADIUS, { type: 'geojson', data: emptyFeatureCollection() });
  }
  if (!map.getSource(SOURCE_INCIDENTS)) {
    map.addSource(SOURCE_INCIDENTS, {
      type: 'geojson',
      data: emptyFeatureCollection(),
      cluster: true,
      clusterMaxZoom: 15,
      clusterRadius: 42,
    });
  }
  if (!map.getSource(SOURCE_CENTER)) {
    map.addSource(SOURCE_CENTER, { type: 'geojson', data: emptyFeatureCollection() });
  }

  const layers: LayerSpecification[] = [
    {
      id: 'analysis-radius-fill',
      type: 'fill',
      source: SOURCE_RADIUS,
      paint: {
        'fill-color': '#e1714d',
        'fill-opacity': 0.075,
      },
    },
    {
      id: 'analysis-radius-line',
      type: 'line',
      source: SOURCE_RADIUS,
      paint: {
        'line-color': '#c65f3f',
        'line-width': 1.5,
        'line-opacity': 0.72,
        'line-dasharray': [3, 2],
      },
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
          'homicide', '#c45d48',
          'sexual', '#c45d48',
          'robbery', '#c45d48',
          'assault', '#c45d48',
          'burglary', '#b09150',
          'theft', '#b09150',
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
      paint: {
        'circle-radius': 3.1,
        'circle-color': '#e1714d',
      },
    },
  ];

  for (const layer of layers) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }

  // Symbol layers require a glyph source. The offline acceptance-test style deliberately
  // has no external resources, so cluster circles remain usable without numeric labels.
  const currentStyle = map.getStyle() as StyleSpecification;
  if (currentStyle.glyphs && !map.getLayer(CLUSTER_LABEL_LAYER)) {
    map.addLayer({
      id: CLUSTER_LABEL_LAYER,
      type: 'symbol',
      source: SOURCE_INCIDENTS,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 10,
      },
      paint: {
        'text-color': '#f7f3eb',
      },
    });
  }
}

function updateAtlasData(
  map: MapLibreMap,
  center: Coordinates,
  radiusMeters: number,
  incidents: Incident[],
  selectedIncidentId: string | null,
) {
  if (!map.isStyleLoaded()) return;
  ensureAtlasLayers(map);
  (map.getSource(SOURCE_RADIUS) as GeoJSONSource).setData(circlePolygon(center, radiusMeters));
  (map.getSource(SOURCE_INCIDENTS) as GeoJSONSource).setData(
    sourceData(center, radiusMeters, incidents, selectedIncidentId),
  );
  (map.getSource(SOURCE_CENTER) as GeoJSONSource).setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [center[0], center[1]] },
  });
}

function viewportPadding() {
  if (window.innerWidth <= 1000) {
    return { top: 32, right: 32, bottom: 32, left: 32 };
  }
  if (window.innerWidth <= 1180) {
    return { top: 96, right: 364, bottom: 54, left: 322 };
  }
  return { top: 100, right: 468, bottom: 60, left: 404 };
}

export function AtlasMap({
  center,
  radiusMeters,
  incidents,
  theme,
  selectedIncidentId,
  onPointChange,
  onIncidentSelect,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const propsRef = useRef({ center, radiusMeters, incidents, selectedIncidentId, onPointChange, onIncidentSelect });
  const [mapError, setMapError] = useState<string | null>(null);
  const [readyTheme, setReadyTheme] = useState<AtlasMapProps['theme'] | null>(null);

  propsRef.current = { center, radiusMeters, incidents, selectedIncidentId, onPointChange, onIncidentSelect };

  useEffect(() => {
    if (!containerRef.current) return;

    setReadyTheme(null);
    let ready = false;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(theme, center),
      center: [center[0], center[1]],
      zoom: 12.4,
      minZoom: 3,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const loadTimeout = window.setTimeout(() => {
      if (!ready) setMapError('The map background could not be loaded. Incident evidence remains available in the panel.');
    }, 12_000);

    const applyData = () => {
      try {
        const latest = propsRef.current;
        updateAtlasData(map, latest.center, latest.radiusMeters, latest.incidents, latest.selectedIncidentId);
        const box = boundingBoxForRadius(latest.center, latest.radiusMeters * 3.25);
        map.fitBounds(
          [[box.west, box.south], [box.east, box.north]],
          {
            padding: viewportPadding(),
            duration: 0,
            maxZoom: 15,
          },
        );
        const canvas = map.getCanvas();
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Interactive map of published crime incident locations');
        ready = true;
        window.clearTimeout(loadTimeout);
        setMapError(null);
        map.once('idle', () => setReadyTheme(theme));
      } catch (reason) {
        console.error('Failed to initialize atlas map layers', reason);
        setMapError('The map background could not be initialized. Incident evidence remains available in the panel.');
      }
    };

    const handleError = () => {
      if (!ready) setMapError('The map background could not be loaded. Incident evidence remains available in the panel.');
    };

    const handleClick = (event: MapMouseEvent) => {
      const interactiveLayers = [CLUSTER_LAYER, INCIDENT_LAYER].filter((id) => map.getLayer(id));
      const feature = interactiveLayers.length > 0
        ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers })[0]
        : undefined;

      if (feature?.layer.id === CLUSTER_LAYER) {
        const clusterId = Number(feature.properties?.cluster_id);
        if (Number.isFinite(clusterId) && feature.geometry.type === 'Point') {
          const source = map.getSource(SOURCE_INCIDENTS) as GeoJSONSource;
          const clusterCoordinates = feature.geometry.coordinates as [number, number];
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: clusterCoordinates, zoom, duration: 450 });
          });
        }
        return;
      }

      if (feature?.layer.id === INCIDENT_LAYER) {
        const id = String(feature.properties?.id ?? '');
        const incident = propsRef.current.incidents.find((candidate) => candidate.id === id);
        if (incident) propsRef.current.onIncidentSelect(incident);
        return;
      }

      propsRef.current.onPointChange([event.lngLat.lng, event.lngLat.lat]);
    };

    const handlePointerMove = (event: MapMouseEvent) => {
      const interactiveLayers = [CLUSTER_LAYER, INCIDENT_LAYER].filter((id) => map.getLayer(id));
      const hasFeature = interactiveLayers.length > 0
        && map.queryRenderedFeatures(event.point, { layers: interactiveLayers }).length > 0;
      map.getCanvas().style.cursor = hasFeature ? 'pointer' : 'crosshair';
    };

    map.on('load', applyData);
    map.on('style.load', applyData);
    map.on('error', handleError);
    map.on('click', handleClick);
    map.on('mousemove', handlePointerMove);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      window.clearTimeout(loadTimeout);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateAtlasData(map, center, radiusMeters, incidents, selectedIncidentId);
  }, [center, radiusMeters, incidents, selectedIncidentId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const box = boundingBoxForRadius(center, radiusMeters * 3.25);
    map.fitBounds(
      [[box.west, box.south], [box.east, box.north]],
      {
        padding: viewportPadding(),
        duration: new URLSearchParams(window.location.search).get('e2e') === '1' ? 0 : 650,
        maxZoom: 15,
      },
    );
  }, [center, radiusMeters]);

  return (
    <div
      aria-label="Crime evidence map"
      className="map-stage"
      data-map-ready={readyTheme === theme ? 'true' : 'false'}
      data-map-theme={theme}
    >
      <div ref={containerRef} className="map-canvas" />
      <div className="map-veil" />
      {mapError ? (
        <div className="map-error" role="status">
          <strong>Map background unavailable</strong>
          <span>{mapError}</span>
        </div>
      ) : null}
    </div>
  );
}
