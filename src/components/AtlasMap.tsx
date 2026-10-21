import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './mapWorker';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Coordinates } from '../types';
import {
  atlasLayers,
  emptyFeatureCollection,
  fitBoundsFor,
  fitRadiusMultiplier,
  INTERACTIVE_LAYERS,
  isDeterministicMode,
  LOCATION_LAYER,
  locationFeatureCollection,
  mapStyle,
  RING_LABEL_LAYER,
  ringFeatureCollection,
  ringLabelFeatureCollection,
  ringLabelLayer,
  SOURCE_LOCATIONS,
  SOURCE_RING_LABELS,
  SOURCE_RINGS,
  type MapTheme,
  type ReportLocation,
} from './mapLayers';

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A location chosen outside the map (the report list) for the camera to show. */
export interface MapFocus {
  coordinates: Coordinates;
  id: number;
}

export interface AtlasMapProps {
  center: Coordinates;
  radiusMeters: number;
  locations: readonly ReportLocation[];
  theme: MapTheme;
  selectedKey: string | null;
  /** Screen space covered by panels, kept clear when framing the circle. */
  padding: MapPadding;
  focus: MapFocus | null;
  onPointChange(coordinates: Coordinates): void;
  onLocationSelect(key: string): void;
}

export const MAP_LOAD_TIMEOUT_MS = 12_000;
const LOAD_FAILURE = 'The map background could not be loaded. The evidence panel still works.';
const INIT_FAILURE = 'The map could not be drawn. The evidence panel still works.';
const FRAME_MARGIN = 24;
const FOCUS_ZOOM = 15.5;
/** Below this much uncovered map, a panel fills the screen and reframing would be pointless. */
const MIN_FRAME_HEIGHT = 120;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function animationAllowed(): boolean {
  return !isDeterministicMode(window.location.search) && !prefersReducedMotion();
}

function ensureAtlasLayers(map: MapLibreMap, theme: MapTheme) {
  for (const id of [SOURCE_RINGS, SOURCE_LOCATIONS, SOURCE_RING_LABELS]) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: emptyFeatureCollection() });
  }
  for (const layer of atlasLayers(theme)) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
  const style = map.getStyle() as StyleSpecification | undefined;
  if (style?.glyphs && !map.getLayer(RING_LABEL_LAYER)) map.addLayer(ringLabelLayer(theme));
}

function updateAtlasData(
  map: MapLibreMap,
  theme: MapTheme,
  center: Coordinates,
  radiusMeters: number,
  locations: readonly ReportLocation[],
  selectedKey: string | null,
) {
  if (!map.isStyleLoaded()) return;
  ensureAtlasLayers(map, theme);
  (map.getSource(SOURCE_RINGS) as GeoJSONSource).setData(ringFeatureCollection(center, radiusMeters));
  (map.getSource(SOURCE_RING_LABELS) as GeoJSONSource).setData(ringLabelFeatureCollection(center, radiusMeters));
  (map.getSource(SOURCE_LOCATIONS) as GeoJSONSource).setData(locationFeatureCollection(locations, selectedKey));
}

function paddedFrame(padding: MapPadding) {
  return {
    top: padding.top + FRAME_MARGIN,
    right: padding.right + FRAME_MARGIN,
    bottom: padding.bottom + FRAME_MARGIN,
    left: padding.left + FRAME_MARGIN,
  };
}

function fitAnalysisArea(
  map: MapLibreMap,
  container: HTMLElement,
  center: Coordinates,
  radiusMeters: number,
  padding: MapPadding,
  animate: boolean,
) {
  const visibleHeight = container.clientHeight - padding.top - padding.bottom;
  if (container.clientHeight > 0 && visibleHeight < MIN_FRAME_HEIGHT) return;
  map.fitBounds(fitBoundsFor(center, radiusMeters, fitRadiusMultiplier(visibleHeight)), {
    padding: paddedFrame(padding),
    duration: animate && animationAllowed() ? 600 : 0,
    maxZoom: 16,
  });
}

function interactiveFeatureAt(map: MapLibreMap, event: MapMouseEvent) {
  const layers = INTERACTIVE_LAYERS.filter((id) => map.getLayer(id));
  return layers.length > 0 ? map.queryRenderedFeatures(event.point, { layers }) : [];
}

function pinElement(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'atlas-pin';
  element.title = 'Analysis point: drag to move';
  element.innerHTML = '<svg aria-hidden="true" viewBox="0 0 32 42" width="32" height="42">'
    + '<path class="atlas-pin__body" d="M16 41c-1.4-6.3-4.3-10.6-8-14.6A12.5 12.5 0 1 1 24 26.4c-3.7 4-6.6 8.3-8 14.6Z"/>'
    + '<circle class="atlas-pin__dot" cx="16" cy="16.5" r="4.6"/></svg>';
  return element;
}

export function AtlasMap({
  center,
  radiusMeters,
  locations,
  theme,
  selectedKey,
  padding,
  focus,
  onPointChange,
  onLocationSelect,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const userMovedRef = useRef(false);
  /** The camera when the map was last torn down, restored if the user had moved it. */
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const latest = useRef({ center, radiusMeters, locations, selectedKey, padding, onPointChange, onLocationSelect });
  const [mapError, setMapError] = useState<string | null>(null);
  const [readyTheme, setReadyTheme] = useState<MapTheme | null>(null);

  latest.current = { center, radiusMeters, locations, selectedKey, padding, onPointChange, onLocationSelect };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    setReadyTheme(null);
    let ready = false;
    let drawFailed = false;
    const initial = latest.current;
    const savedCamera = userMovedRef.current ? cameraRef.current : null;
    const map = new maplibregl.Map({
      container,
      style: mapStyle(theme, initial.center, window.location.search),
      center: savedCamera?.center ?? [initial.center[0], initial.center[1]],
      zoom: savedCamera?.zoom ?? 13,
      minZoom: 3,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const marker = new maplibregl.Marker({ element: pinElement(), anchor: 'bottom', draggable: true })
      .setLngLat([initial.center[0], initial.center[1]])
      .addTo(map);
    markerRef.current = marker;
    marker.on('dragend', () => {
      const position = marker.getLngLat();
      latest.current.onPointChange([position.lng, position.lat]);
    });

    // A background that never loads gets a message; a drawing failure keeps its own.
    const loadTimeout = window.setTimeout(() => {
      if (!ready && !drawFailed) setMapError(LOAD_FAILURE);
    }, MAP_LOAD_TIMEOUT_MS);

    const applyData = () => {
      try {
        const current = latest.current;
        updateAtlasData(map, theme, current.center, current.radiusMeters, current.locations, current.selectedKey);
        // A theme switch rebuilds the map; keep a viewport the user chose instead of reframing.
        if (!userMovedRef.current) {
          fitAnalysisArea(map, container, current.center, current.radiusMeters, current.padding, false);
        }
        const canvas = map.getCanvas();
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Interactive map of published crime incident locations');
        ready = true;
        window.clearTimeout(loadTimeout);
        setMapError(null);
        map.once('idle', () => setReadyTheme(theme));
      } catch (reason) {
        console.error('Failed to initialize atlas map layers', reason);
        drawFailed = true;
        window.clearTimeout(loadTimeout);
        setMapError(INIT_FAILURE);
      }
    };

    const handleError = () => {
      if (!ready && !drawFailed) setMapError(LOAD_FAILURE);
    };

    const handleClick = (event: MapMouseEvent) => {
      const feature = interactiveFeatureAt(map, event)[0];
      if (feature?.layer.id === LOCATION_LAYER) {
        latest.current.onLocationSelect(String(feature.properties?.key ?? ''));
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

    // Layouts change the map's size after first paint (and on rotation); keep the analysis
    // area framed until the user takes control of the viewport.
    const observer = new ResizeObserver(() => {
      map.resize();
      if (ready && !userMovedRef.current) {
        const current = latest.current;
        fitAnalysisArea(map, container, current.center, current.radiusMeters, current.padding, false);
      }
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(loadTimeout);
      observer.disconnect();
      const camera = map.getCenter();
      cameraRef.current = { center: [camera.lng, camera.lat], zoom: map.getZoom() };
      marker.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) updateAtlasData(map, theme, center, radiusMeters, locations, selectedKey);
  }, [theme, center, radiusMeters, locations, selectedKey]);

  useEffect(() => {
    markerRef.current?.setLngLat([center[0], center[1]]);
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    userMovedRef.current = false;
    fitAnalysisArea(map, container, center, radiusMeters, latest.current.padding, true);
  }, [center, radiusMeters]);

  const { top, right, bottom, left } = padding;
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || userMovedRef.current) return;
    fitAnalysisArea(map, container, latest.current.center, latest.current.radiusMeters, { top, right, bottom, left }, true);
  }, [top, right, bottom, left]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    userMovedRef.current = true;
    map.easeTo({
      center: [focus.coordinates[0], focus.coordinates[1]],
      zoom: Math.max(map.getZoom(), FOCUS_ZOOM),
      padding: paddedFrame(latest.current.padding),
      duration: animationAllowed() ? 500 : 0,
    });
  }, [focus]);

  const insets = { '--map-inset-top': `${top}px`, '--map-inset-bottom': `${bottom}px` } as CSSProperties;

  return (
    <div
      aria-label="Crime evidence map"
      className="map-stage"
      data-map-ready={readyTheme === theme ? 'true' : 'false'}
      data-map-theme={theme}
      role="region"
      style={insets}
    >
      <div ref={containerRef} className="map-canvas" />
      {mapError ? (
        <div className="map-error" role="status">
          <strong>Map background unavailable</strong>
          <span>{mapError}</span>
        </div>
      ) : null}
    </div>
  );
}
