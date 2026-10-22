import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryGroup, isViolentCategory, severityForCategory } from '../domain/categories';
import type { Coordinates, CrimeCategory, Incident } from '../types';
import { AtlasMap, MAP_LOAD_TIMEOUT_MS, type AtlasMapProps, type MapPadding } from './AtlasMap';
import {
  atlasLayers,
  COMPACT_FIT_RADIUS_MULTIPLIER,
  emptyFeatureCollection,
  fitBoundsFor,
  groupIncidentsByLocation,
  LOCATION_LAYER,
  locationFeatureCollection,
  OPENFREEMAP_STYLES,
  RING_LABEL_LAYER,
  ringFeatureCollection,
  ringLabelFeatureCollection,
  ringLabelLayer,
  SOURCE_LOCATIONS,
  SOURCE_RING_LABELS,
  SOURCE_RINGS,
} from './mapLayers';
import { offlineStyle } from './offlineMapStyle';

interface RenderedFeature {
  layer: { id: string };
  properties?: Record<string, unknown>;
}

const fakes = vi.hoisted(() => {
  class FakeSource {
    spec: Record<string, unknown>;
    setData = vi.fn();

    constructor(spec: Record<string, unknown>) {
      this.spec = spec;
    }
  }

  class FakeMap {
    options: Record<string, unknown>;
    handlers = new Map<string, Array<(event?: unknown) => void>>();
    onceHandlers = new Map<string, Array<(event?: unknown) => void>>();
    sources = new Map<string, FakeSource>();
    layers: Array<{ id: string }> = [];
    style: { glyphs?: string } | undefined = {};
    styleLoaded = false;
    rendered: Array<{ layer: { id: string }; properties?: Record<string, unknown> }> = [];
    canvas = document.createElement('canvas');
    camera: { lng: number; lat: number; zoom: number };
    fitBounds = vi.fn();
    easeTo = vi.fn();
    resize = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    touchZoomRotate = { disableRotation: vi.fn() };
    queryRenderedFeatures = vi.fn((_point: unknown, options: { layers: string[] }) => (
      this.rendered.filter((feature) => options.layers.includes(feature.layer.id))
    ));

    constructor(options: Record<string, unknown>) {
      this.options = options;
      const [lng = 0, lat = 0] = options.center as [number, number];
      this.camera = { lng, lat, zoom: options.zoom as number };
      (options.container as HTMLElement).append(this.canvas);
      fakes.maps.push(this);
    }

    getCenter() {
      return { lng: this.camera.lng, lat: this.camera.lat };
    }

    getZoom() {
      return this.camera.zoom;
    }

    on(type: string, handler: (event?: unknown) => void) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      return this;
    }

    once(type: string, handler: (event?: unknown) => void) {
      this.onceHandlers.set(type, [...(this.onceHandlers.get(type) ?? []), handler]);
      return this;
    }

    emit(type: string, event: unknown = {}) {
      for (const handler of this.handlers.get(type) ?? []) handler(event);
      const once = this.onceHandlers.get(type) ?? [];
      this.onceHandlers.delete(type);
      for (const handler of once) handler(event);
    }

    isStyleLoaded() {
      return this.styleLoaded;
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    addSource(id: string, spec: Record<string, unknown>) {
      this.sources.set(id, new FakeSource(spec));
    }

    getLayer(id: string) {
      return this.layers.find((layer) => layer.id === id);
    }

    addLayer(layer: { id: string }) {
      this.layers.push(layer);
    }

    getStyle() {
      return this.style;
    }

    getCanvas() {
      return this.canvas;
    }
  }

  class FakeMarker {
    options: { element: HTMLElement; anchor: string; draggable: boolean };
    position = { lng: Number.NaN, lat: Number.NaN };
    handlers = new Map<string, Array<() => void>>();
    map: unknown = null;
    setLngLat = vi.fn((lngLat: [number, number]) => {
      this.position = { lng: lngLat[0], lat: lngLat[1] };
      return this;
    });
    addTo = vi.fn((map: unknown) => {
      this.map = map;
      return this;
    });
    remove = vi.fn(() => this);

    constructor(options: { element: HTMLElement; anchor: string; draggable: boolean }) {
      this.options = options;
      fakes.markers.push(this);
    }

    getLngLat() {
      return this.position;
    }

    on(type: string, handler: () => void) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      return this;
    }

    /** Simulates the user dropping the pin at a new position. */
    drag(lng: number, lat: number) {
      this.position = { lng, lat };
      for (const handler of this.handlers.get('dragend') ?? []) handler();
    }
  }

  class FakeNavigationControl {
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
    }
  }

  class FakeResizeObserver {
    callback: () => void;
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(callback: () => void) {
      this.callback = callback;
      fakes.observers.push(this);
    }

    trigger() {
      this.callback();
    }
  }

  return {
    FakeMap,
    FakeMarker,
    FakeNavigationControl,
    FakeResizeObserver,
    maps: [] as FakeMap[],
    markers: [] as FakeMarker[],
    observers: [] as FakeResizeObserver[],
  };
});

vi.mock('maplibre-gl', () => ({
  Map: fakes.FakeMap,
  Marker: fakes.FakeMarker,
  NavigationControl: fakes.FakeNavigationControl,
}));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('./mapWorker', () => ({}));

type FakeMap = InstanceType<typeof fakes.FakeMap>;

const CENTER: Coordinates = [-87.6298, 41.8837];
const NO_PADDING: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };
const FRAME_MARGIN = 24;
const LOAD_FAILURE = 'The map background could not be loaded. The evidence panel still works.';
const INIT_FAILURE = 'The map could not be drawn. The evidence panel still works.';

function incident(id: string, category: CrimeCategory, coordinates: Coordinates): Incident {
  return {
    id,
    providerId: 'chicago',
    occurredAt: '2026-10-01T12:00:00',
    occurredAtEpochMs: Date.UTC(2026, 9, 1, 12),
    localHour: 12,
    category,
    group: categoryGroup(category),
    rawCategory: category.toUpperCase(),
    description: category,
    locationLabel: 'Test block',
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: 'block',
  };
}

const LOCATIONS = groupIncidentsByLocation(CENTER, 1000, [
  incident('a', 'robbery', [CENTER[0] + 0.001, CENTER[1]]),
  incident('b', 'theft', [CENTER[0] + 0.03, CENTER[1]]),
]);

function renderMap(overrides: Partial<AtlasMapProps> = {}) {
  const props: AtlasMapProps = {
    center: CENTER,
    radiusMeters: 1000,
    locations: LOCATIONS,
    theme: 'light',
    selectedKey: null,
    padding: NO_PADDING,
    focus: null,
    onPointChange: vi.fn(),
    onLocationSelect: vi.fn(),
    ...overrides,
  };
  const view = render(<AtlasMap {...props} />);
  const rerender = (next: Partial<AtlasMapProps>) => {
    Object.assign(props, next);
    view.rerender(<AtlasMap {...props} />);
  };
  return { ...view, props, rerender };
}

function currentMap(): FakeMap {
  const map = fakes.maps.at(-1);
  if (!map) throw new Error('No map was created');
  return map;
}

function currentMarker() {
  const marker = fakes.markers.at(-1);
  if (!marker) throw new Error('No marker was created');
  return marker;
}

function currentObserver() {
  const observer = fakes.observers.at(-1);
  if (!observer) throw new Error('No resize observer was created');
  return observer;
}

function loadMap(map = currentMap(), event: 'load' | 'style.load' = 'load') {
  map.styleLoaded = true;
  act(() => map.emit(event));
}

function userMove(map = currentMap()) {
  act(() => map.emit('movestart', { originalEvent: new MouseEvent('mousedown') }));
}

function stage() {
  return screen.getByLabelText('Crime evidence map');
}

function fitDurations(map: FakeMap) {
  return map.fitBounds.mock.calls.map((call) => (call[1] as { duration: number }).duration);
}

function lastFit(map: FakeMap) {
  const call = map.fitBounds.mock.calls.at(-1);
  if (!call) throw new Error('The map was never framed');
  return call as [[[number, number], [number, number]], { padding: MapPadding; duration: number; maxZoom: number }];
}

function source(map: FakeMap, id: string) {
  const found = map.sources.get(id);
  if (!found) throw new Error(`Source ${id} missing`);
  return found;
}

function lastData(map: FakeMap, id: string) {
  return source(map, id).setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection;
}

function framed(padding: MapPadding): MapPadding {
  return {
    top: padding.top + FRAME_MARGIN,
    right: padding.right + FRAME_MARGIN,
    bottom: padding.bottom + FRAME_MARGIN,
    left: padding.left + FRAME_MARGIN,
  };
}

/** Gives the map container (and only it) a measured height. */
function containerHeight(height: number) {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight(this: HTMLElement) {
    return this.classList.contains('map-canvas') ? height : 0;
  });
}

beforeEach(() => {
  fakes.maps.length = 0;
  fakes.markers.length = 0;
  fakes.observers.length = 0;
  vi.stubGlobal('ResizeObserver', fakes.FakeResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AtlasMap creation', () => {
  it('creates a non-rotating map with a compact attribution on the OpenFreeMap style for the theme', () => {
    renderMap({ theme: 'dark' });
    const map = currentMap();

    expect(map.options).toMatchObject({
      style: OPENFREEMAP_STYLES.dark,
      center: [CENTER[0], CENTER[1]],
      zoom: 13,
      minZoom: 3,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    expect(map.options.container).toBeInstanceOf(HTMLDivElement);
    expect(map.options.container).toHaveClass('map-canvas');
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.addControl).toHaveBeenCalledOnce();
    expect(map.addControl).toHaveBeenCalledWith(expect.any(fakes.FakeNavigationControl), 'bottom-right');
    expect((map.addControl.mock.calls[0]?.[0] as { options: unknown }).options).toEqual({ showCompass: false });
    expect(currentObserver().observe).toHaveBeenCalledWith(map.options.container);
    expect(stage()).toHaveAttribute('role', 'region');
    expect(stage()).toHaveAttribute('data-map-theme', 'dark');
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
  });

  it('keeps the drawing failure message when later errors or the load timeout follow', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    renderMap();
    const map = currentMap();
    map.addSource = () => {
      throw new Error('bad source');
    };
    loadMap(map);
    act(() => map.emit('error'));
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS * 2));
    expect(screen.getByRole('status')).toHaveTextContent(`Map background unavailable${INIT_FAILURE}`);
  });

  it('adds a draggable analysis pin at the center', () => {
    renderMap();
    const map = currentMap();
    const marker = currentMarker();

    expect(fakes.markers).toHaveLength(1);
    expect(marker.options).toMatchObject({ anchor: 'bottom', draggable: true });
    expect(marker.options.element).toHaveClass('atlas-pin');
    expect(marker.options.element).toHaveAttribute('title', 'Analysis point: drag to move');
    expect(marker.options.element.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(marker.setLngLat).toHaveBeenCalledWith([CENTER[0], CENTER[1]]);
    expect(marker.addTo).toHaveBeenCalledWith(map);
    expect(marker.handlers.get('dragend')).toHaveLength(1);
  });

  it('uses the deterministic offline style in e2e mode', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    renderMap();
    expect(currentMap().options.style).toEqual(offlineStyle('light', CENTER));
  });

  it('exposes the panel insets as CSS variables', () => {
    const { rerender } = renderMap({ padding: { top: 60, right: 10, bottom: 200, left: 20 } });
    expect(stage().style.getPropertyValue('--map-inset-top')).toBe('60px');
    expect(stage().style.getPropertyValue('--map-inset-bottom')).toBe('200px');
    rerender({ padding: { top: 64, right: 0, bottom: 0, left: 0 } });
    expect(stage().style.getPropertyValue('--map-inset-top')).toBe('64px');
    expect(stage().style.getPropertyValue('--map-inset-bottom')).toBe('0px');
  });
});

describe('AtlasMap style loading', () => {
  it('adds sources and layers, pushes data, frames the analysis area and labels the canvas', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);

    expect([...map.sources.keys()]).toEqual([SOURCE_RINGS, SOURCE_LOCATIONS, SOURCE_RING_LABELS]);
    for (const item of map.sources.values()) {
      expect(item.spec).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    expect(map.layers).toEqual(atlasLayers('light'));
    expect(map.layers.map((layer) => layer.id)).not.toContain(RING_LABEL_LAYER);

    expect(lastData(map, SOURCE_RINGS)).toEqual(ringFeatureCollection(CENTER, 1000));
    expect(lastData(map, SOURCE_RING_LABELS)).toEqual(ringLabelFeatureCollection(CENTER, 1000));
    expect(lastData(map, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, null));

    expect(lastFit(map)).toEqual([fitBoundsFor(CENTER, 1000), { padding: framed(NO_PADDING), duration: 0, maxZoom: 16 }]);

    expect(map.canvas).toHaveAttribute('role', 'img');
    expect(map.canvas).toHaveAttribute('aria-label', 'Interactive map of published crime incident locations');
    expect(screen.getByLabelText('Interactive map of published crime incident locations')).toBe(map.canvas);
  });

  it('draws the layers in the dark palette for the dark theme', () => {
    renderMap({ theme: 'dark' });
    const map = currentMap();
    map.style = { glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf' };
    loadMap(map);
    expect(map.layers).toEqual([...atlasLayers('dark'), ringLabelLayer('dark')]);
  });

  it('labels the rings only when the style provides glyphs, and only once', () => {
    renderMap();
    const map = currentMap();
    map.style = { glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf' };
    loadMap(map);
    expect(map.layers.filter((layer) => layer.id === RING_LABEL_LAYER)).toEqual([ringLabelLayer('light')]);
    loadMap(map, 'style.load');
    expect(map.layers.filter((layer) => layer.id === RING_LABEL_LAYER)).toHaveLength(1);
  });

  it('leaves the rings unlabeled while the style is unavailable', () => {
    renderMap();
    const map = currentMap();
    map.style = undefined;
    loadMap(map);
    expect(map.layers.map((layer) => layer.id)).not.toContain(RING_LABEL_LAYER);
    expect(map.canvas).toHaveAttribute('role', 'img');
  });

  it('reapplies data idempotently when the style reloads', () => {
    renderMap();
    const map = currentMap();
    map.style = { glyphs: 'glyphs' };
    loadMap(map, 'load');
    const layerCount = map.layers.length;
    loadMap(map, 'style.load');
    expect(map.layers).toHaveLength(layerCount);
    expect(map.sources.size).toBe(3);
    expect(source(map, SOURCE_LOCATIONS).setData).toHaveBeenCalledTimes(2);
  });

  it('marks the map ready for the current theme after the first idle event', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
    expect(map.onceHandlers.get('idle')).toHaveLength(1);
    expect(map.handlers.has('idle')).toBe(false);
    act(() => map.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');
  });

  it('frames the analysis area inside the panels plus a margin', () => {
    const padding = { top: 60, right: 10, bottom: 200, left: 20 };
    renderMap({ padding });
    const map = currentMap();
    loadMap(map);
    expect(lastFit(map)[1]).toEqual({ padding: { top: 84, right: 34, bottom: 224, left: 44 }, duration: 0, maxZoom: 16 });
  });
});

describe('AtlasMap framing by visible height', () => {
  it('keeps the full comparison framing on a tall map', () => {
    containerHeight(900);
    renderMap();
    const map = currentMap();
    loadMap(map);
    expect(lastFit(map)[0]).toEqual(fitBoundsFor(CENTER, 1000));
  });

  it('frames the selected circle more tightly when panels leave a short map', () => {
    containerHeight(600);
    renderMap({ padding: { top: 60, right: 0, bottom: 200, left: 0 } });
    const map = currentMap();
    loadMap(map);
    // 600 − 60 − 200 = 340 px visible.
    expect(lastFit(map)[0]).toEqual(fitBoundsFor(CENTER, 1000, COMPACT_FIT_RADIUS_MULTIPLIER));
  });

  it('skips framing when panels cover almost all of a measured map', () => {
    containerHeight(400);
    const { rerender } = renderMap({ padding: { top: 80, right: 0, bottom: 201, left: 0 } });
    const map = currentMap();
    loadMap(map);
    act(() => currentObserver().trigger());
    rerender({ radiusMeters: 2000 });
    expect(map.resize).toHaveBeenCalledOnce();
    expect(map.fitBounds).not.toHaveBeenCalled();

    // Exactly 120 px left uncovered is still worth framing.
    rerender({ padding: { top: 80, right: 0, bottom: 200, left: 0 } });
    expect(map.fitBounds).toHaveBeenCalledOnce();
    expect(lastFit(map)[0]).toEqual(fitBoundsFor(CENTER, 2000, COMPACT_FIT_RADIUS_MULTIPLIER));
  });

  it('still frames an unmeasured container whatever the padding', () => {
    containerHeight(0);
    renderMap({ padding: { top: 400, right: 0, bottom: 400, left: 0 } });
    const map = currentMap();
    loadMap(map);
    expect(lastFit(map)[0]).toEqual(fitBoundsFor(CENTER, 1000));
  });
});

describe('AtlasMap failures', () => {
  it('explains a background failure that happens before the style is ready', () => {
    renderMap();
    act(() => currentMap().emit('error'));
    expect(screen.getByRole('status')).toHaveTextContent(`Map background unavailable${LOAD_FAILURE}`);
  });

  it('ignores tile errors once the map is ready', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);
    act(() => map.emit('error'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('times out a style that never loads', () => {
    vi.useFakeTimers();
    renderMap();
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS - 1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toHaveTextContent(LOAD_FAILURE);
  });

  it('does not time out once the style has loaded', () => {
    vi.useFakeTimers();
    renderMap();
    loadMap();
    act(() => vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS * 2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('reports a layer initialization failure without crashing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderMap();
    const map = currentMap();
    map.addSource = () => {
      throw new Error('bad source');
    };
    loadMap(map);
    expect(screen.getByRole('status')).toHaveTextContent(`Map background unavailable${INIT_FAILURE}`);
    expect(consoleError).toHaveBeenCalledWith('Failed to initialize atlas map layers', expect.any(Error));
    expect(map.canvas).not.toHaveAttribute('role');
    expect(map.onceHandlers.has('idle')).toBe(false);
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
  });

  it('clears an earlier failure when the style eventually loads', () => {
    renderMap();
    const map = currentMap();
    act(() => map.emit('error'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    loadMap(map);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('AtlasMap interaction', () => {
  const click = (map: FakeMap) => act(() => map.emit('click', {
    point: { x: 10, y: 20 },
    lngLat: { lng: -87.61, lat: 41.87 },
  }));

  it('moves the analysis point where the user clicks before layers exist', () => {
    const { props } = renderMap();
    const map = currentMap();
    click(map);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(props.onPointChange).toHaveBeenCalledWith([-87.61, 41.87]);
  });

  it('moves the analysis point when no report location is under the pointer', () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    click(map);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 10, y: 20 }, { layers: [LOCATION_LAYER] });
    expect(props.onPointChange).toHaveBeenCalledWith([-87.61, 41.87]);
    expect(props.onLocationSelect).not.toHaveBeenCalled();
  });

  it('selects a clicked report location through the latest callback', () => {
    const { props, rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    const first = props.onLocationSelect;
    const onLocationSelect = vi.fn();
    rerender({ onLocationSelect });
    map.rendered = [{ layer: { id: LOCATION_LAYER }, properties: { key: LOCATIONS[1]!.key } } as RenderedFeature];
    click(map);
    expect(onLocationSelect).toHaveBeenCalledWith(LOCATIONS[1]!.key);
    expect(first).not.toHaveBeenCalled();
    expect(props.onPointChange).not.toHaveBeenCalled();
  });

  it('passes an empty key for a location feature without one', () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    map.rendered = [{ layer: { id: LOCATION_LAYER }, properties: {} }];
    click(map);
    map.rendered = [{ layer: { id: LOCATION_LAYER } }];
    click(map);
    expect(props.onLocationSelect).toHaveBeenNthCalledWith(1, '');
    expect(props.onLocationSelect).toHaveBeenNthCalledWith(2, '');
    expect(props.onPointChange).not.toHaveBeenCalled();
  });

  it('shows a pointer over report locations and a crosshair elsewhere', () => {
    renderMap();
    const map = currentMap();
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('crosshair');
    loadMap(map);
    map.rendered = [{ layer: { id: LOCATION_LAYER }, properties: { key: 'k' } }];
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('pointer');
    map.rendered = [];
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('crosshair');
  });

  it('moves the analysis point where the pin is dropped, through the latest callback', () => {
    const { props, rerender } = renderMap();
    const first = props.onPointChange;
    const onPointChange = vi.fn();
    rerender({ onPointChange });
    act(() => currentMarker().drag(-87.64, 41.89));
    expect(onPointChange).toHaveBeenCalledExactlyOnceWith([-87.64, 41.89]);
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps the pin on the analysis center', () => {
    const { rerender } = renderMap();
    const marker = currentMarker();
    rerender({ center: [-87.6, 41.9] });
    expect(marker.setLngLat).toHaveBeenLastCalledWith([-87.6, 41.9]);
    expect(marker.getLngLat()).toEqual({ lng: -87.6, lat: 41.9 });
    const calls = marker.setLngLat.mock.calls.length;
    rerender({ selectedKey: LOCATIONS[0]!.key });
    expect(marker.setLngLat).toHaveBeenCalledTimes(calls);
  });
});

describe('AtlasMap viewport framing', () => {
  it('only resizes before the style is ready', () => {
    renderMap();
    const map = currentMap();
    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.resize).toHaveBeenCalledOnce();
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('refits on resize until the user drags, ignoring programmatic camera moves', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);
    const observer = currentObserver();

    act(() => observer.trigger());
    expect(map.resize).toHaveBeenCalledTimes(1);
    const afterFirstResize = map.fitBounds.mock.calls.length;
    expect(fitDurations(map).at(-1)).toBe(0);

    act(() => map.emit('movestart', {}));
    act(() => observer.trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(afterFirstResize + 1);

    userMove(map);
    act(() => observer.trigger());
    expect(map.resize).toHaveBeenCalledTimes(3);
    expect(map.fitBounds).toHaveBeenCalledTimes(afterFirstResize + 1);
  });

  it.each([
    ['wheel zoom', () => new WheelEvent('wheel')],
    ['keyboard pan', () => new KeyboardEvent('keydown', { key: 'ArrowLeft' })],
    ['touch gesture', () => new Event('touchstart')],
  ])('stops refitting after a user %s', (_name, originalEvent) => {
    renderMap();
    const map = currentMap();
    loadMap(map);
    act(() => map.emit('movestart', { originalEvent: originalEvent() }));
    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('animates the first framing before the style loads', () => {
    renderMap();
    const map = currentMap();
    expect(fitDurations(map).length).toBeGreaterThan(0);
    expect(fitDurations(map).every((duration) => duration === 600)).toBe(true);
  });

  it('animates to a new center or radius and resumes auto-framing', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    userMove(map);

    rerender({ radiusMeters: 2000 });
    expect(lastFit(map)).toEqual([fitBoundsFor(CENTER, 2000), { padding: framed(NO_PADDING), duration: 600, maxZoom: 16 }]);
    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(fits + 1);

    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(map).at(-1)).toBe(600);
    expect(lastFit(map)[0]).toEqual(fitBoundsFor([-87.6, 41.9], 2000));
  });

  it('reframes with animation when the panels change size', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    const fits = map.fitBounds.mock.calls.length;

    const sheet = { top: 64, right: 0, bottom: 320, left: 0 };
    rerender({ padding: sheet });
    expect(map.fitBounds).toHaveBeenCalledTimes(fits + 1);
    expect(lastFit(map)[1]).toEqual({ padding: framed(sheet), duration: 600, maxZoom: 16 });

    // A new object with the same insets is not a change.
    rerender({ padding: { ...sheet } });
    expect(map.fitBounds).toHaveBeenCalledTimes(fits + 1);
  });

  it('frames later resizes with the latest padding', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    const sheet = { top: 64, right: 0, bottom: 320, left: 0 };
    rerender({ padding: sheet });
    act(() => currentObserver().trigger());
    expect(lastFit(map)[1]).toEqual({ padding: framed(sheet), duration: 0, maxZoom: 16 });
  });

  it('leaves a map the user moved alone when the panels change size', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    userMove(map);
    const fits = map.fitBounds.mock.calls.length;
    rerender({ padding: { top: 64, right: 0, bottom: 320, left: 0 } });
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('eases to a focused report location and stops auto-framing', () => {
    const sheet = { top: 64, right: 0, bottom: 320, left: 0 };
    const { rerender } = renderMap({ padding: sheet });
    const map = currentMap();
    loadMap(map);
    expect(map.easeTo).not.toHaveBeenCalled();

    const target: Coordinates = [-87.625, 41.886];
    rerender({ focus: { coordinates: target, id: 1 } });
    expect(map.easeTo).toHaveBeenCalledExactlyOnceWith({
      center: [target[0], target[1]],
      zoom: 15.5,
      padding: framed(sheet),
      duration: 500,
    });

    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    rerender({ padding: NO_PADDING });
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('keeps a closer zoom when focusing and eases again for each new focus request', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    map.camera.zoom = 17;
    const target: Coordinates = [-87.625, 41.886];
    rerender({ focus: { coordinates: target, id: 1 } });
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ zoom: 17 }));

    rerender({ selectedKey: LOCATIONS[0]!.key });
    expect(map.easeTo).toHaveBeenCalledOnce();

    rerender({ focus: { coordinates: target, id: 2 } });
    expect(map.easeTo).toHaveBeenCalledTimes(2);
  });

  it('resumes framing when a new place is chosen after a focus', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    rerender({ focus: { coordinates: [-87.625, 41.886], id: 1 } });
    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(map).at(-1)).toBe(600);
    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(fits + 1);
  });

  it('jumps instead of animating in deterministic e2e mode', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    rerender({ radiusMeters: 500 });
    rerender({ padding: { top: 64, right: 0, bottom: 200, left: 0 } });
    rerender({ focus: { coordinates: CENTER, id: 1 } });
    expect(fitDurations(map).length).toBeGreaterThanOrEqual(4);
    expect(fitDurations(map).every((duration) => duration === 0)).toBe(true);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });

  it('jumps instead of animating when the user prefers reduced motion', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: true, media: query }));
    vi.stubGlobal('matchMedia', matchMedia);
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    rerender({ center: [-87.6, 41.9] });
    rerender({ focus: { coordinates: CENTER, id: 1 } });
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(fitDurations(map).every((duration) => duration === 0)).toBe(true);
    expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });

  it('animates when the user has no reduced-motion preference', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query })));
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(map).at(-1)).toBe(600);
  });
});

describe('AtlasMap data updates', () => {
  it('waits for the style before pushing data', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    rerender({ locations: [], selectedKey: 'x' });
    expect(map.sources.size).toBe(0);
    expect(map.layers).toEqual([]);
  });

  it('pushes new locations, radius and selection into the sources', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);

    rerender({ selectedKey: LOCATIONS[1]!.key });
    expect(lastData(map, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, LOCATIONS[1]!.key));
    expect(lastData(map, SOURCE_LOCATIONS).features.map((feature) => feature.properties?.selected)).toEqual([0, 1]);

    const replacement = groupIncidentsByLocation(CENTER, 1000, [incident('z', 'weapons', CENTER)]);
    rerender({ locations: replacement });
    expect(lastData(map, SOURCE_LOCATIONS).features.map((feature) => feature.id)).toEqual([replacement[0]!.key]);

    const ringCalls = source(map, SOURCE_RINGS).setData.mock.calls.length;
    rerender({ radiusMeters: 2000 });
    expect(source(map, SOURCE_RINGS).setData).toHaveBeenCalledTimes(ringCalls + 1);
    expect(lastData(map, SOURCE_RINGS)).toEqual(ringFeatureCollection(CENTER, 2000));
    expect(lastData(map, SOURCE_RING_LABELS)).toEqual(ringLabelFeatureCollection(CENTER, 2000));
  });
});

describe('AtlasMap rings', () => {
  function expectRings(map: FakeMap, center: Coordinates, radiusMeters: number) {
    expect(lastData(map, SOURCE_RINGS)).toEqual(ringFeatureCollection(center, radiusMeters));
    expect(lastData(map, SOURCE_RING_LABELS)).toEqual(ringLabelFeatureCollection(center, radiusMeters));
  }

  function expectNoRings(map: FakeMap) {
    expect(lastData(map, SOURCE_RINGS)).toEqual(emptyFeatureCollection());
    expect(lastData(map, SOURCE_RING_LABELS)).toEqual(emptyFeatureCollection());
  }

  it('draws no circle when rings are off, but still shows the report locations', () => {
    const { rerender } = renderMap({ showRings: false });
    const map = currentMap();
    map.style = { glyphs: 'glyphs' };
    loadMap(map);

    expect([...map.sources.keys()]).toEqual([SOURCE_RINGS, SOURCE_LOCATIONS, SOURCE_RING_LABELS]);
    expect(map.layers).toEqual([...atlasLayers('light'), ringLabelLayer('light')]);
    expectNoRings(map);
    expect(lastData(map, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, null));
    // The map is still framed on the point and becomes ready as usual.
    expect(lastFit(map)).toEqual([fitBoundsFor(CENTER, 1000), { padding: framed(NO_PADDING), duration: 0, maxZoom: 16 }]);
    act(() => map.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');

    const ringCalls = source(map, SOURCE_RINGS).setData.mock.calls.length;
    rerender({ center: [-87.6, 41.9], radiusMeters: 2000, selectedKey: LOCATIONS[0]!.key });
    expect(source(map, SOURCE_RINGS).setData).toHaveBeenCalledTimes(ringCalls + 1);
    expectNoRings(map);
    expect(lastData(map, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, LOCATIONS[0]!.key));
  });

  it('keeps the rings off when the style reloads', () => {
    renderMap({ showRings: false });
    const map = currentMap();
    loadMap(map, 'load');
    loadMap(map, 'style.load');
    expect(source(map, SOURCE_RINGS).setData).toHaveBeenCalledTimes(2);
    expectNoRings(map);
  });

  it('clears and redraws the rings when the setting changes', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    expectRings(map, CENTER, 1000);
    const locationCalls = source(map, SOURCE_LOCATIONS).setData.mock.calls.length;

    rerender({ showRings: false });
    expectNoRings(map);
    expect(source(map, SOURCE_LOCATIONS).setData).toHaveBeenCalledTimes(locationCalls + 1);
    expect(lastData(map, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, null));

    rerender({ radiusMeters: 500 });
    expectNoRings(map);

    // Switching back draws the circle for the current radius, not the one it was hidden at.
    rerender({ showRings: true });
    expectRings(map, CENTER, 500);
  });

  it('defaults to drawing the rings when the setting is omitted', () => {
    const { props, rerender } = renderMap({ showRings: false });
    const map = currentMap();
    loadMap(map);
    expectNoRings(map);
    delete props.showRings;
    rerender({});
    expectRings(map, CENTER, 1000);
  });

  it('uses the latest setting when the style finishes loading', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    rerender({ showRings: false });
    expect(map.sources.size).toBe(0);
    loadMap(map);
    expectNoRings(map);

    // Updates are dropped while a new style loads; the reload draws whatever is current.
    map.styleLoaded = false;
    rerender({ showRings: true });
    expectNoRings(map);
    loadMap(map, 'style.load');
    expectRings(map, CENTER, 1000);
  });

  it('keeps the rings off on the map rebuilt for a new theme', () => {
    const { rerender } = renderMap({ showRings: false });
    loadMap(currentMap());
    rerender({ theme: 'dark' });
    const second = currentMap();
    loadMap(second);
    expect(second.layers).toEqual(atlasLayers('dark'));
    expectNoRings(second);
    expect(lastData(second, SOURCE_LOCATIONS)).toEqual(locationFeatureCollection(LOCATIONS, null));
  });
});

describe('AtlasMap lifecycle', () => {
  it('recreates the map and pin for a new theme and waits for it to become ready', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    const firstMarker = currentMarker();
    const firstObserver = currentObserver();
    loadMap(first);
    act(() => first.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');

    rerender({ theme: 'dark' });
    expect(first.remove).toHaveBeenCalledOnce();
    expect(firstMarker.remove).toHaveBeenCalledOnce();
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    expect(fakes.maps).toHaveLength(2);
    expect(fakes.markers).toHaveLength(2);
    const second = currentMap();
    expect(currentMarker().addTo).toHaveBeenCalledWith(second);
    expect(second.options.style).toBe(OPENFREEMAP_STYLES.dark);
    expect(stage()).toHaveAttribute('data-map-theme', 'dark');
    expect(stage()).toHaveAttribute('data-map-ready', 'false');

    loadMap(second);
    expect(second.layers).toEqual(atlasLayers('dark'));
    act(() => second.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');
  });

  it('does not mark the new theme ready from the old map\'s late idle event', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    expect(first.onceHandlers.get('idle')).toHaveLength(1);

    rerender({ theme: 'dark' });
    act(() => first.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-theme', 'dark');
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
  });

  it('keeps a viewport the user chose when the theme changes', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    userMove(first);
    first.camera = { lng: -87.7, lat: 41.95, zoom: 14.2 };

    rerender({ theme: 'dark' });
    const second = currentMap();
    expect(second.options).toMatchObject({ center: [-87.7, 41.95], zoom: 14.2 });
    // The pin stays on the analysis center, not on the restored camera.
    expect(currentMarker().setLngLat).toHaveBeenCalledWith([CENTER[0], CENTER[1]]);
    loadMap(second);
    expect(second.fitBounds).not.toHaveBeenCalled();
    act(() => currentObserver().trigger());
    expect(second.fitBounds).not.toHaveBeenCalled();
  });

  it('reframes the analysis area after a theme change when the user has not moved the map', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    act(() => first.emit('movestart', {}));
    first.camera = { lng: -80, lat: 30, zoom: 9 };

    rerender({ theme: 'dark' });
    const second = currentMap();
    expect(second.options).toMatchObject({ center: [CENTER[0], CENTER[1]], zoom: 13 });
    expect(second.fitBounds).not.toHaveBeenCalled();
    loadMap(second);
    expect(fitDurations(second)).toEqual([0]);
  });

  it('frames a newly chosen place after a theme change even if the user had moved before', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    userMove(first);
    rerender({ theme: 'dark' });
    const second = currentMap();
    loadMap(second);
    expect(second.fitBounds).not.toHaveBeenCalled();

    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(second)).toEqual([600]);
    act(() => currentObserver().trigger());
    expect(fitDurations(second)).toEqual([600, 0]);
  });

  it('removes the map, pin, observer and load timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderMap();
    const map = currentMap();
    const marker = currentMarker();
    const observer = currentObserver();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(marker.remove).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
