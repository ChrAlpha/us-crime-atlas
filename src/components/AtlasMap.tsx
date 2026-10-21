import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './mapWorker';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { circlePolygon } from '../domain/geo';
import type { Coordinates, Incident } from '../types';
import {
  ATLAS_LAYERS,
  centerFeature,
  CLUSTER_LABEL_LAYER,
  CLUSTER_LABEL_LAYER_SPEC,
  CLUSTER_LAYER,
  emptyFeatureCollection,
  fitBoundsFor,
  fitRadiusMultiplier,
  INCIDENT_LAYER,
  incidentFeatureCollection,
  INTERACTIVE_LAYERS,
  isDeterministicMode,
  mapStyle,
  SOURCE_CENTER,
  SOURCE_INCIDENTS,
  SOURCE_RADIUS,
  viewportPadding,
  type MapTheme,
} from './mapLayers';

export interface AtlasMapProps {
  center: Coordinates;
  radiusMeters: number;
  incidents: Incident[];
  theme: MapTheme;
  selectedIncidentId: string | null;
  onPointChange(coordinates: Coordinates): void;
  onIncidentSelect(incident: Incident): void;
}

export const MAP_LOAD_TIMEOUT_MS = 12_000;
const LOAD_FAILURE = 'The map background could not be loaded. Incident evidence remains available in the panel.';
const INIT_FAILURE = 'The map background could not be initialized. Incident evidence remains available in the panel.';

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
  for (const layer of ATLAS_LAYERS) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  const style = map.getStyle() as StyleSpecification | undefined;
  if (style?.glyphs && !map.getLayer(CLUSTER_LABEL_LAYER)) map.addLayer(CLUSTER_LABEL_LAYER_SPEC);
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
    incidentFeatureCollection(center, radiusMeters, incidents, selectedIncidentId),
  );
  (map.getSource(SOURCE_CENTER) as GeoJSONSource).setData(centerFeature(center));
}

function fitAnalysisArea(
  map: MapLibreMap,
  container: HTMLElement,
  center: Coordinates,
  radiusMeters: number,
  animate: boolean,
) {
  map.fitBounds(fitBoundsFor(center, radiusMeters, fitRadiusMultiplier(container.clientHeight)), {
    padding: viewportPadding(window.innerWidth),
    duration: animate && !isDeterministicMode(window.location.search) ? 650 : 0,
    maxZoom: 15,
  });
}

function interactiveFeatureAt(map: MapLibreMap, event: MapMouseEvent) {
  const layers = INTERACTIVE_LAYERS.filter((id) => map.getLayer(id));
  return layers.length > 0 ? map.queryRenderedFeatures(event.point, { layers }) : [];
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
  const userMovedRef = useRef(false);
  /** The camera when the map was last torn down, restored if the user had moved it. */
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const latest = useRef({ center, radiusMeters, incidents, selectedIncidentId, onPointChange, onIncidentSelect });
  const [mapError, setMapError] = useState<string | null>(null);
  const [readyTheme, setReadyTheme] = useState<MapTheme | null>(null);

  latest.current = { center, radiusMeters, incidents, selectedIncidentId, onPointChange, onIncidentSelect };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    setReadyTheme(null);
    let ready = false;
    const initial = latest.current;
    const savedCamera = userMovedRef.current ? cameraRef.current : null;
    const map = new maplibregl.Map({
      container,
      style: mapStyle(theme, initial.center, window.location.search),
      center: savedCamera?.center ?? [initial.center[0], initial.center[1]],
      zoom: savedCamera?.zoom ?? 12.4,
      minZoom: 3,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const loadTimeout = window.setTimeout(() => {
      if (!ready) setMapError(LOAD_FAILURE);
    }, MAP_LOAD_TIMEOUT_MS);

    const applyData = () => {
      try {
        const current = latest.current;
        updateAtlasData(map, current.center, current.radiusMeters, current.incidents, current.selectedIncidentId);
        // A theme switch rebuilds the map; keep a viewport the user chose instead of reframing.
        if (!userMovedRef.current) fitAnalysisArea(map, container, current.center, current.radiusMeters, false);
        const canvas = map.getCanvas();
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Interactive map of published crime incident locations');
        ready = true;
        window.clearTimeout(loadTimeout);
        setMapError(null);
        map.once('idle', () => setReadyTheme(theme));
      } catch (reason) {
        console.error('Failed to initialize atlas map layers', reason);
        setMapError(INIT_FAILURE);
      }
    };

    const handleError = () => {
      if (!ready) setMapError(LOAD_FAILURE);
    };

    const handleClick = (event: MapMouseEvent) => {
      const feature = interactiveFeatureAt(map, event)[0];
      if (feature?.layer.id === CLUSTER_LAYER) {
        const clusterId = Number(feature.properties?.cluster_id);
        if (Number.isFinite(clusterId) && feature.geometry.type === 'Point') {
          const coordinates = feature.geometry.coordinates as [number, number];
          userMovedRef.current = true;
          void (map.getSource(SOURCE_INCIDENTS) as GeoJSONSource)
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => map.easeTo({ center: coordinates, zoom, duration: 450 }));
        }
        return;
      }
      if (feature?.layer.id === INCIDENT_LAYER) {
        const id = String(feature.properties?.id ?? '');
        const incident = latest.current.incidents.find((candidate) => candidate.id === id);
        if (incident) latest.current.onIncidentSelect(incident);
        return;
      }
      latest.current.onPointChange([event.lngLat.lng, event.lngLat.lat]);
    };

    const handlePointerMove = (event: MapMouseEvent) => {
      map.getCanvas().style.cursor = interactiveFeatureAt(map, event).length > 0 ? 'pointer' : 'crosshair';
    };

    // Only gestures (pointer, wheel, touch, keyboard) carry an original event; programmatic
    // fits and eases do not.
    const markUserMove = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) userMovedRef.current = true;
    };

    map.on('load', applyData);
    map.on('style.load', applyData);
    map.on('error', handleError);
    map.on('click', handleClick);
    map.on('mousemove', handlePointerMove);
    map.on('movestart', markUserMove);

    // Panel layouts change the map's size after first paint (and on rotation); keep the
    // analysis area framed until the user takes control of the viewport.
    const observer = new ResizeObserver(() => {
      map.resize();
      if (ready && !userMovedRef.current) {
        fitAnalysisArea(map, container, latest.current.center, latest.current.radiusMeters, false);
      }
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(loadTimeout);
      observer.disconnect();
      const camera = map.getCenter();
      cameraRef.current = { center: [camera.lng, camera.lat], zoom: map.getZoom() };
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) updateAtlasData(map, center, radiusMeters, incidents, selectedIncidentId);
  }, [center, radiusMeters, incidents, selectedIncidentId]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    userMovedRef.current = false;
    fitAnalysisArea(map, container, center, radiusMeters, true);
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
