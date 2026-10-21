import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryGroup, isViolentCategory, severityForCategory } from '../domain/categories';
import type { Coordinates, CrimeCategory, Incident } from '../types';
import { AtlasMap, MAP_LOAD_TIMEOUT_MS, type AtlasMapProps } from './AtlasMap';
import {
  CLUSTER_LABEL_LAYER,
  CLUSTER_LAYER,
  INCIDENT_LAYER,
  OPENFREEMAP_STYLES,
  SOURCE_CENTER,
  SOURCE_INCIDENTS,
  SOURCE_RADIUS,
} from './mapLayers';
import { offlineStyle } from './offlineMapStyle';

type Handler = (event?: unknown) => void;

interface RenderedFeature {
  layer: { id: string };
  properties?: Record<string, unknown>;
  geometry: { type: string; coordinates?: unknown };
}

const fakes = vi.hoisted(() => {
  class FakeSource {
    spec: Record<string, unknown>;
    setData = vi.fn();
    getClusterExpansionZoom = vi.fn(async () => 16);

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
    style: { glyphs?: string } = {};
    styleLoaded = false;
    rendered: Array<{ layer: { id: string } }> = [];
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
    FakeNavigationControl,
    FakeResizeObserver,
    maps: [] as FakeMap[],
    observers: [] as FakeResizeObserver[],
  };
});

vi.mock('maplibre-gl', () => ({ Map: fakes.FakeMap, NavigationControl: fakes.FakeNavigationControl }));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('./mapWorker', () => ({}));

type FakeMap = InstanceType<typeof fakes.FakeMap>;

const CENTER: Coordinates = [-87.6298, 41.8837];

function incident(id: string, category: CrimeCategory, coordinates: Coordinates = [CENTER[0] + 0.001, CENTER[1]]): Incident {
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

const INCIDENTS = [incident('a', 'robbery'), incident('b', 'theft', [CENTER[0] + 0.03, CENTER[1]])];

function renderMap(overrides: Partial<AtlasMapProps> = {}) {
  const props: AtlasMapProps = {
    center: CENTER,
    radiusMeters: 1000,
    incidents: INCIDENTS,
    theme: 'light',
    selectedIncidentId: null,
    onPointChange: vi.fn(),
    onIncidentSelect: vi.fn(),
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

function currentObserver() {
  const observer = fakes.observers.at(-1);
  if (!observer) throw new Error('No resize observer was created');
  return observer;
}

function loadMap(map = currentMap(), event: 'load' | 'style.load' = 'load') {
  map.styleLoaded = true;
  act(() => map.emit(event));
}

function stage() {
  return screen.getByLabelText('Crime evidence map');
}

function fitDurations(map: FakeMap) {
  return map.fitBounds.mock.calls.map((call) => (call[1] as { duration: number }).duration);
}

function incidentSource(map: FakeMap) {
  const source = map.sources.get(SOURCE_INCIDENTS);
  if (!source) throw new Error('Incident source missing');
  return source;
}

beforeEach(() => {
  fakes.maps.length = 0;
  fakes.observers.length = 0;
  vi.stubGlobal('ResizeObserver', fakes.FakeResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AtlasMap creation', () => {
  it('creates a non-rotating map on the OpenFreeMap style for the theme', () => {
    renderMap({ theme: 'dark' });
    const map = currentMap();

    expect(map.options).toMatchObject({
      style: OPENFREEMAP_STYLES.dark,
      center: [CENTER[0], CENTER[1]],
      zoom: 12.4,
      minZoom: 3,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
    });
    expect(map.options.container).toBeInstanceOf(HTMLDivElement);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledOnce();
    expect(map.addControl).toHaveBeenCalledWith(expect.any(fakes.FakeNavigationControl), 'top-right');
    expect((map.addControl.mock.calls[0]?.[0] as { options: unknown }).options).toEqual({ showCompass: false });
    expect(currentObserver().observe).toHaveBeenCalledWith(map.options.container);
    expect(stage()).toHaveAttribute('data-map-theme', 'dark');
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
  });

  it('uses the deterministic offline style in e2e mode', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    renderMap();
    expect(currentMap().options.style).toEqual(offlineStyle('light', CENTER));
  });
});

describe('AtlasMap style loading', () => {
  it('adds sources and layers, frames the analysis area and labels the canvas', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);

    expect([...map.sources.keys()]).toEqual([SOURCE_RADIUS, SOURCE_INCIDENTS, SOURCE_CENTER]);
    expect(incidentSource(map).spec).toMatchObject({ type: 'geojson', cluster: true, clusterMaxZoom: 15 });
    expect(map.layers.map((layer) => layer.id)).toContain(CLUSTER_LAYER);
    expect(map.layers.map((layer) => layer.id)).toContain(INCIDENT_LAYER);
    expect(map.layers.map((layer) => layer.id)).not.toContain(CLUSTER_LABEL_LAYER);

    const radiusData = map.sources.get(SOURCE_RADIUS)?.setData.mock.calls.at(-1)?.[0] as GeoJSON.Feature;
    expect(radiusData.geometry.type).toBe('Polygon');
    const incidentData = incidentSource(map).setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection;
    expect(incidentData.features.map((feature) => feature.id)).toEqual(['a', 'b']);
    expect(map.sources.get(SOURCE_CENTER)?.setData).toHaveBeenLastCalledWith({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [CENTER[0], CENTER[1]] },
    });

    const [bounds, options] = map.fitBounds.mock.calls.at(-1) ?? [];
    expect(bounds).toHaveLength(2);
    expect(options).toEqual({ padding: { top: 96, right: 364, bottom: 54, left: 322 }, duration: 0, maxZoom: 15 });

    expect(map.canvas).toHaveAttribute('role', 'img');
    expect(map.canvas).toHaveAttribute('aria-label', 'Interactive map of published crime incident locations');
    expect(screen.getByLabelText('Interactive map of published crime incident locations')).toBe(map.canvas);
  });

  it('frames the selected circle more tightly when the map is short', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(260);
    renderMap();
    const map = currentMap();
    loadMap(map);

    const [[[, south], [, north]] = [[0, 0], [0, 0]]] = map.fitBounds.mock.calls.at(-1) ?? [];
    expect(((north - south) * 111_195.08) / 2).toBeCloseTo(1750, 0);
  });

  it('adds the cluster count layer only when the style provides glyphs', () => {
    renderMap();
    const map = currentMap();
    map.style = { glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf' };
    loadMap(map);
    expect(map.layers.filter((layer) => layer.id === CLUSTER_LABEL_LAYER)).toHaveLength(1);
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
    expect(incidentSource(map).setData).toHaveBeenCalledTimes(2);
  });

  it('marks the map ready for the current theme after the first idle event', () => {
    renderMap();
    const map = currentMap();
    loadMap(map);
    expect(stage()).toHaveAttribute('data-map-ready', 'false');
    act(() => map.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');
  });
});

describe('AtlasMap failures', () => {
  it('explains a background failure that happens before the style is ready', () => {
    renderMap();
    act(() => currentMap().emit('error'));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Map background unavailableThe map background could not be loaded. Incident evidence remains available in the panel.',
    );
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
    expect(screen.getByRole('status')).toHaveTextContent('The map background could not be loaded.');
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
    expect(screen.getByRole('status')).toHaveTextContent('The map background could not be initialized.');
    expect(consoleError).toHaveBeenCalledWith('Failed to initialize atlas map layers', expect.any(Error));
    expect(map.canvas).not.toHaveAttribute('role');
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

  it('drops a pin where the user clicks empty map before layers exist', () => {
    const { props } = renderMap();
    const map = currentMap();
    click(map);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(props.onPointChange).toHaveBeenCalledWith([-87.61, 41.87]);
  });

  it('drops a pin when nothing interactive is under the pointer', () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    click(map);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ x: 10, y: 20 }, { layers: [CLUSTER_LAYER, INCIDENT_LAYER] });
    expect(props.onPointChange).toHaveBeenCalledWith([-87.61, 41.87]);
    expect(props.onIncidentSelect).not.toHaveBeenCalled();
  });

  it('selects the clicked incident using the latest incidents prop', () => {
    const { props, rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    const replacement = incident('c', 'assault');
    rerender({ incidents: [replacement] });
    map.rendered = [{ layer: { id: INCIDENT_LAYER }, properties: { id: 'c' }, geometry: { type: 'Point' } } as RenderedFeature];
    click(map);
    expect(props.onIncidentSelect).toHaveBeenCalledWith(replacement);
    expect(props.onPointChange).not.toHaveBeenCalled();
  });

  it('ignores an incident feature that is no longer in the analysis', () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    map.rendered = [{ layer: { id: INCIDENT_LAYER }, properties: {}, geometry: { type: 'Point' } } as RenderedFeature];
    click(map);
    expect(props.onIncidentSelect).not.toHaveBeenCalled();
    expect(props.onPointChange).not.toHaveBeenCalled();
  });

  it('zooms into a clicked cluster and stops auto-framing afterwards', async () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    map.rendered = [{
      layer: { id: CLUSTER_LAYER },
      properties: { cluster_id: 7 },
      geometry: { type: 'Point', coordinates: [-87.62, 41.88] },
    } as RenderedFeature];
    click(map);
    await act(async () => undefined);

    expect(incidentSource(map).getClusterExpansionZoom).toHaveBeenCalledWith(7);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-87.62, 41.88], zoom: 16, duration: 450 });
    expect(props.onPointChange).not.toHaveBeenCalled();

    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(fits);
  });

  it('does nothing for a cluster feature without a usable id or point', () => {
    const { props } = renderMap();
    const map = currentMap();
    loadMap(map);
    map.rendered = [{ layer: { id: CLUSTER_LAYER }, properties: { cluster_id: 'x' }, geometry: { type: 'Point' } } as RenderedFeature];
    click(map);
    map.rendered = [{ layer: { id: CLUSTER_LAYER }, properties: { cluster_id: 3 }, geometry: { type: 'Polygon' } } as RenderedFeature];
    click(map);
    expect(incidentSource(map).getClusterExpansionZoom).not.toHaveBeenCalled();
    expect(props.onPointChange).not.toHaveBeenCalled();
  });

  it('shows a pointer over incidents and a crosshair elsewhere', () => {
    renderMap();
    const map = currentMap();
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('crosshair');
    loadMap(map);
    map.rendered = [{ layer: { id: CLUSTER_LAYER }, geometry: { type: 'Point' } } as RenderedFeature];
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('pointer');
    map.rendered = [];
    act(() => map.emit('mousemove', { point: { x: 1, y: 1 } }));
    expect(map.canvas.style.cursor).toBe('crosshair');
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

    act(() => map.emit('movestart', { originalEvent: new MouseEvent('mousedown') }));
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

  it('does not listen for the old drag and zoom start events', () => {
    renderMap();
    const map = currentMap();
    expect(map.handlers.has('dragstart')).toBe(false);
    expect(map.handlers.has('zoomstart')).toBe(false);
    expect(map.handlers.get('movestart')).toHaveLength(1);
  });

  it('animates to a new center or radius and resumes auto-framing', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);
    act(() => map.emit('movestart', { originalEvent: new MouseEvent('mousedown') }));

    rerender({ radiusMeters: 2000 });
    expect(fitDurations(map).at(-1)).toBe(650);
    const fits = map.fitBounds.mock.calls.length;
    act(() => currentObserver().trigger());
    expect(map.fitBounds).toHaveBeenCalledTimes(fits + 1);

    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(map).at(-1)).toBe(650);
    const [[west, south], [east, north]] = map.fitBounds.mock.calls.at(-1)?.[0] as [[number, number], [number, number]];
    expect((west + east) / 2).toBeCloseTo(-87.6, 6);
    expect((south + north) / 2).toBeCloseTo(41.9, 6);
  });

  it('jumps instead of animating in deterministic e2e mode', () => {
    window.history.replaceState(null, '', '/?e2e=1');
    const { rerender } = renderMap();
    const map = currentMap();
    expect(fitDurations(map)).toEqual([0]);
    rerender({ radiusMeters: 500 });
    expect(fitDurations(map)).toEqual([0, 0]);
  });
});

describe('AtlasMap data updates', () => {
  it('waits for the style before pushing data', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    rerender({ incidents: [incident('late', 'burglary')] });
    expect(map.sources.size).toBe(0);
  });

  it('pushes new incidents, radius and selection into the sources', () => {
    const { rerender } = renderMap();
    const map = currentMap();
    loadMap(map);

    rerender({ selectedIncidentId: 'b' });
    const selected = incidentSource(map).setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection;
    expect(selected.features.map((feature) => feature.properties?.selected)).toEqual([0, 1]);

    rerender({ incidents: [incident('z', 'weapons')] });
    const replaced = incidentSource(map).setData.mock.calls.at(-1)?.[0] as GeoJSON.FeatureCollection;
    expect(replaced.features.map((feature) => feature.id)).toEqual(['z']);

    const radiusCalls = map.sources.get(SOURCE_RADIUS)?.setData.mock.calls.length ?? 0;
    rerender({ radiusMeters: 2000 });
    expect(map.sources.get(SOURCE_RADIUS)?.setData).toHaveBeenCalledTimes(radiusCalls + 1);
  });
});

describe('AtlasMap lifecycle', () => {
  it('recreates the map for a new theme and waits for it to become ready', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    const firstObserver = currentObserver();
    loadMap(first);
    act(() => first.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');

    rerender({ theme: 'dark' });
    expect(first.remove).toHaveBeenCalledOnce();
    expect(firstObserver.disconnect).toHaveBeenCalledOnce();
    expect(fakes.maps).toHaveLength(2);
    const second = currentMap();
    expect(second.options.style).toBe(OPENFREEMAP_STYLES.dark);
    expect(stage()).toHaveAttribute('data-map-theme', 'dark');
    expect(stage()).toHaveAttribute('data-map-ready', 'false');

    loadMap(second);
    act(() => second.emit('idle'));
    expect(stage()).toHaveAttribute('data-map-ready', 'true');
  });

  it('keeps a viewport the user chose when the theme changes', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    act(() => first.emit('movestart', { originalEvent: new MouseEvent('mousedown') }));
    first.camera = { lng: -87.7, lat: 41.95, zoom: 14.2 };

    rerender({ theme: 'dark' });
    const second = currentMap();
    expect(second.options).toMatchObject({ center: [-87.7, 41.95], zoom: 14.2 });
    loadMap(second);
    expect(second.fitBounds).not.toHaveBeenCalled();
    // Resizes still leave the user's viewport alone.
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
    expect(second.options).toMatchObject({ center: [CENTER[0], CENTER[1]], zoom: 12.4 });
    loadMap(second);
    expect(fitDurations(second)).toEqual([0]);
  });

  it('frames a newly chosen place after a theme change even if the user had moved before', () => {
    const { rerender } = renderMap();
    const first = currentMap();
    loadMap(first);
    act(() => first.emit('movestart', { originalEvent: new MouseEvent('mousedown') }));
    rerender({ theme: 'dark' });
    const second = currentMap();
    loadMap(second);
    expect(second.fitBounds).not.toHaveBeenCalled();

    rerender({ center: [-87.6, 41.9] });
    expect(fitDurations(second)).toEqual([650]);
    act(() => currentObserver().trigger());
    expect(fitDurations(second)).toEqual([650, 0]);
  });

  it('removes the map, observer and load timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderMap();
    const map = currentMap();
    const observer = currentObserver();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
