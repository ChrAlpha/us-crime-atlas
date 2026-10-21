import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { MIN_GROUP_MESSAGE, THEME_STORAGE_KEY, TOAST_DURATION_MS } from './App';
import type { AtlasMapProps } from './components/AtlasMap';
import { locationKey } from './components/mapLayers';
import { loadEvidence, type EvidenceRequest } from './data/evidence';
import { summarizeAgency, summarizeState } from './domain/agencySummary';
import { FULL_AREA_COVERAGE, NO_TRUNCATION } from './domain/analysis';
import { categoryGroup, isViolentCategory, severityForCategory } from './domain/categories';
import { computeEvidenceWindow } from './domain/evidenceWindow';
import { DAY_MS, localClockTimestamp } from './domain/time';
import { useAreaSummary, type AreaSummary, type AreaSummaryState } from './hooks/useAreaSummary';
import { clearEvidenceCache } from './hooks/useIncidentAnalysis';
import { COMPACT_QUERY } from './hooks/useMediaQuery';
import { sheetGeometry } from './hooks/useSheet';
import { FULL_AGENCY, fixtureSnapshot, matchFor } from './test/agencyFixtures';
import type { Coordinates, CrimeCategory, EvidenceBundle, Incident, IncidentProvider } from './types';

vi.mock('./data/evidence', () => ({ loadEvidence: vi.fn() }));

// The hook has its own tests; here it only has to report a state without Census or snapshot requests.
vi.mock('./hooks/useAreaSummary', () => ({ useAreaSummary: vi.fn() }));

vi.mock('./components/AtlasMap', () => ({
  AtlasMap: (props: AtlasMapProps) => (
    <div
      data-center={props.center.join(',')}
      data-focus={props.focus ? `${props.focus.id}@${props.focus.coordinates.join(',')}` : ''}
      data-locations={props.locations.map((location) => location.key).join('|')}
      data-padding={JSON.stringify(props.padding)}
      data-radius={props.radiusMeters}
      data-rings={String(props.showRings)}
      data-selected={props.selectedKey ?? ''}
      data-testid="map-stub"
      data-theme={props.theme}
    >
      <button onClick={() => props.onPointChange([-87.62, 41.88])} type="button">Drop test pin</button>
      {props.locations.map((location) => (
        <button key={location.key} onClick={() => props.onLocationSelect(location.key)} type="button">
          {`Map location ${location.key}`}
        </button>
      ))}
    </div>
  ),
}));

const DARK_QUERY = '(prefers-color-scheme: dark)';
const LIGHT_THEME_COLOR = '#fdfcf9';
const DARK_THEME_COLOR = '#181714';
const LATEST_RECORD = Date.UTC(2026, 9, 18, 15);
const NOW = new Date('2026-10-21T16:00:00Z');
const TIMES_SQUARE: Coordinates = [-73.9855, 40.758];
const UNION_SQUARE: Coordinates = [-122.4075, 37.788];
/** Two reports share this block; the vehicle theft sits alone on the other side of the point. */
const SHARED_SPOT: Coordinates = [TIMES_SQUARE[0] + 0.001, TIMES_SQUARE[1]];
const VEHICLE_SPOT: Coordinates = [TIMES_SQUARE[0] - 0.001, TIMES_SQUARE[1]];
const SHARED_KEY = locationKey(SHARED_SPOT);
const VEHICLE_KEY = locationKey(VEHICLE_SPOT);

function incident(
  provider: IncidentProvider,
  request: EvidenceRequest,
  id: string,
  category: CrimeCategory,
  daysBeforeLatest: number,
  offsetDegrees: number,
): Incident {
  const epoch = LATEST_RECORD - daysBeforeLatest * DAY_MS;
  return {
    id: `${provider.meta.id}:${id}`,
    providerId: provider.meta.id,
    occurredAt: localClockTimestamp(epoch),
    occurredAtEpochMs: epoch,
    localHour: new Date(epoch).getUTCHours(),
    category,
    group: categoryGroup(category),
    rawCategory: category.toUpperCase(),
    description: `${category} description`,
    locationLabel: `${id} block`,
    coordinates: [request.center[0] + offsetDegrees, request.center[1]],
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: provider.meta.precision,
  };
}

function bundleFor(provider: IncidentProvider, request: EvidenceRequest): EvidenceBundle {
  const window = computeEvidenceWindow({
    windowDays: request.windowDays,
    nowEpochMs: NOW.getTime(),
    latestRecordEpochMs: LATEST_RECORD,
    settlingDays: 0,
  });
  return {
    provider: provider.meta,
    window,
    incidents: [
      incident(provider, request, 'robbery', 'robbery', 1, 0.001),
      incident(provider, request, 'theft', 'theft', 2, 0.001),
      incident(provider, request, 'vehicle', 'vehicle', 3, -0.001),
      incident(provider, request, 'older', 'theft', request.windowDays + 2, 0.001),
    ],
    recordLimit: 20_000,
    truncation: NO_TRUNCATION,
    areaCoverage: FULL_AREA_COVERAGE,
    requestUrls: [`${provider.meta.endpoint}?test`],
    fetchedAt: request.now.toISOString(),
  };
}

const mockedLoadEvidence = vi.mocked(loadEvidence);

/* ── FBI jurisdiction totals ──────────────────────────────────────────────── */

/** No local incident feed covers Oklahoma City. */
const OKLAHOMA_CITY: Coordinates = [-97.5164, 35.4676];
const OKLAHOMA_CITY_URL = '?lat=35.4676&lng=-97.5164&place=Oklahoma+City&detail=Oklahoma';
const OKLAHOMA_SNAPSHOT = fixtureSnapshot({ state: 'OK', stateName: 'Oklahoma', stateFips: '40' });
const AGENCY_RESULT: AreaSummary = {
  kind: 'agency',
  summary: summarizeAgency(matchFor(FULL_AGENCY), OKLAHOMA_SNAPSHOT)!,
  snapshot: OKLAHOMA_SNAPSHOT,
};
const STATE_RESULT: AreaSummary = {
  kind: 'state',
  summary: summarizeState(OKLAHOMA_SNAPSHOT),
  snapshot: OKLAHOMA_SNAPSHOT,
  agencyName: null,
};
const OUTSIDE_RESULT: AreaSummary = { kind: 'outside' };

type AreaSummaryReport = Omit<AreaSummaryState, 'refresh'>;

const mockedUseAreaSummary = vi.mocked(useAreaSummary);
const refreshAreaSummary = vi.fn();
/** What the hook reports while enabled; like the real hook, it is idle while disabled. */
let enabledAreaSummary: AreaSummaryReport;

function reportAreaSummary(report: Partial<AreaSummaryReport>) {
  enabledAreaSummary = { status: 'loading', result: null, error: null, ...report };
}

function areaSummaryCalls() {
  return mockedUseAreaSummary.mock.calls.map(([center, enabled]) => ({ center, enabled }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/* ── Browser fakes ────────────────────────────────────────────────────────── */

class FakeMediaQueryList {
  readonly listeners = new Set<() => void>();

  constructor(readonly media: string, public matches: boolean) {}

  addEventListener(_type: 'change', listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: () => void) {
    this.listeners.delete(listener);
  }

  change(matches: boolean) {
    this.matches = matches;
    act(() => {
      for (const listener of this.listeners) listener();
    });
  }
}

function installMatchMedia({ dark = false, compact = false }: { dark?: boolean; compact?: boolean } = {}) {
  const lists = new Map<string, FakeMediaQueryList>([
    [DARK_QUERY, new FakeMediaQueryList(DARK_QUERY, dark)],
    [COMPACT_QUERY, new FakeMediaQueryList(COMPACT_QUERY, compact)],
  ]);
  const matchMedia = vi.fn((query: string) => {
    let list = lists.get(query);
    if (!list) {
      list = new FakeMediaQueryList(query, false);
      lists.set(query, list);
    }
    return list;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return { dark: lists.get(DARK_QUERY)!, compact: lists.get(COMPACT_QUERY)!, matchMedia };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    this.disconnected = true;
  }

  static observersOf(target: Element) {
    return FakeResizeObserver.instances.filter((observer) => observer.targets.has(target));
  }

  static resize(target: Element) {
    act(() => {
      for (const observer of FakeResizeObserver.observersOf(target)) {
        observer.callback([], observer as unknown as ResizeObserver);
      }
    });
  }
}

function setLayout(element: Element, values: Partial<Record<'offsetTop' | 'offsetHeight' | 'clientHeight', number>>) {
  for (const [property, value] of Object.entries(values)) {
    Object.defineProperty(element, property, { configurable: true, value });
  }
}

interface GeolocationErrorLike {
  code: number;
  PERMISSION_DENIED: number;
}

function installGeolocation(getCurrentPosition: (...args: never[]) => void) {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
}

/* ── Rendering helpers ────────────────────────────────────────────────────── */

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

function params() {
  return new URLSearchParams(window.location.search);
}

function map() {
  return screen.getByTestId('map-stub');
}

function mapPadding() {
  return JSON.parse(map().getAttribute('data-padding') ?? 'null') as Record<string, number>;
}

function main() {
  return screen.getByRole('main');
}

function topbar(container: HTMLElement) {
  return container.querySelector<HTMLElement>('header.topbar')!;
}

function themeColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
}

async function renderApp() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByTestId('map-stub');
  return { user, ...view };
}

async function renderReadyApp() {
  const rendered = await renderApp();
  await screen.findByRole('tablist', { name: 'Evidence views' });
  return rendered;
}

type User = ReturnType<typeof userEvent.setup>;

async function openFilter(user: User, chip: string | RegExp) {
  await user.click(within(screen.getByRole('group', { name: 'Analysis settings' })).getByRole('button', { name: chip }));
}

const OPTION_GROUPS = {
  radius: 'Area around the point',
  window: 'Published reports from the last',
  groups: 'Types of report',
} as const;

function filterOption(kind: keyof typeof OPTION_GROUPS, option: RegExp) {
  return within(screen.getByRole('group', { name: OPTION_GROUPS[kind] })).getByRole('button', { name: option });
}

async function chooseOption(user: User, chip: string | RegExp, kind: keyof typeof OPTION_GROUPS, option: RegExp) {
  await openFilter(user, chip);
  await user.click(filterOption(kind, option));
}

async function chooseFeaturedPlace(user: User, label: string) {
  // Only the nearest few covered places are listed until the query narrows them; typing alone fetches nothing.
  await user.type(screen.getByRole('searchbox', { name: 'Search a US address, hotel, or landmark' }), label);
  const menu = screen.getByRole('region', { name: 'Search suggestions' });
  await user.click(within(menu).getByRole('button', { name: new RegExp(`^${label}`) }));
}

async function openTab(user: User, name: string | RegExp) {
  await user.click(screen.getByRole('tab', { name }));
}

let themeMeta: HTMLMetaElement;

beforeEach(() => {
  clearEvidenceCache();
  mockedLoadEvidence.mockReset();
  mockedLoadEvidence.mockImplementation(async (provider, request) => bundleFor(provider, request));
  refreshAreaSummary.mockReset();
  reportAreaSummary({});
  mockedUseAreaSummary.mockReset();
  mockedUseAreaSummary.mockImplementation((_center, enabled) => (enabled
    ? { ...enabledAreaSummary, refresh: refreshAreaSummary }
    : { status: 'idle', result: null, error: null, refresh: refreshAreaSummary }));
  installMatchMedia();
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#000000';
  document.head.append(themeMeta);
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window.navigator, 'geolocation');
  themeMeta.remove();
});

/* ── Theme ────────────────────────────────────────────────────────────────── */

describe('App theme', () => {
  it('follows the device preference by default, including later changes', async () => {
    const media = installMatchMedia({ dark: true });
    await renderApp();

    expect(media.matchMedia).toHaveBeenCalledWith(DARK_QUERY);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeColor()).toBe(DARK_THEME_COLOR);
    expect(map()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    media.dark.change(false);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeColor()).toBe(LIGHT_THEME_COLOR);
    expect(map()).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('honors a stored light theme over a dark device', async () => {
    installMatchMedia({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await renderApp();

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeColor()).toBe(LIGHT_THEME_COLOR);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('honors a stored dark theme over a light device and ignores device changes', async () => {
    const media = installMatchMedia({ dark: false });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderApp();

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeColor()).toBe(DARK_THEME_COLOR);
    media.dark.change(true);
    media.dark.change(false);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('treats an unknown stored value as the device preference and clears it', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    await renderApp();

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('switches and persists from the header toggle', async () => {
    const { user } = await renderApp();

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeColor()).toBe(DARK_THEME_COLOR);
    expect(map()).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeColor()).toBe(LIGHT_THEME_COLOR);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('goes back to the device preference from the About tab', async () => {
    installMatchMedia({ dark: true });
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const { user } = await renderReadyApp();
    await openTab(user, 'About the data');

    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Match device' }));

    expect(screen.getByRole('button', { name: 'Match device' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeColor()).toBe(DARK_THEME_COLOR);

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});

/* ── URL state ────────────────────────────────────────────────────────────── */

describe('App URL state', () => {
  it('starts at the default place and writes the full state into the URL', async () => {
    await renderReadyApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
    expect(params().get('place')).toBe('Times Square');
    expect(params().get('detail')).toBe('Manhattan · New York City');
    expect(params().get('lat')).toBe('40.75800');
    expect(params().get('lng')).toBe('-73.98550');
    expect(params().get('radius')).toBe('1000');
    expect(params().get('days')).toBe('30');
    expect(params().get('groups')).toBe('violent,property,vehicle,weapons,other');
    expect(mockedLoadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'new-york' }) }),
      expect.objectContaining({ center: TIMES_SQUARE, radiusMeters: 1000, windowDays: 30 }),
    );
    // A local feed covers the point: the circle is drawn and no FBI totals are requested.
    expect(map()).toHaveAttribute('data-rings', 'true');
    expect(screen.getByRole('group', { name: 'Analysis settings' })).toBeInTheDocument();
    const calls = areaSummaryCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual(calls.map(() => ({ center: TIMES_SQUARE, enabled: false })));
    expect(screen.queryByTestId('jurisdiction-finding')).not.toBeInTheDocument();
  });

  it('restores a shared view and syncs every change back into the URL', async () => {
    setUrl('?e2e=1&lat=41.88370&lng=-87.62980&place=The+Loop&detail=Chicago&radius=500&days=14&groups=weapons,violent');
    const { user } = await renderReadyApp();

    expect(screen.getByRole('heading', { level: 1, name: 'The Loop' })).toBeInTheDocument();
    const filters = within(screen.getByRole('group', { name: 'Analysis settings' }));
    expect(filters.getByRole('button', { name: 'Within 500 m' })).toBeInTheDocument();
    expect(filters.getByRole('button', { name: 'Last 14 days' })).toBeInTheDocument();
    expect(filters.getByRole('button', { name: '2 of 5 types' })).toBeInTheDocument();
    expect(map()).toHaveAttribute('data-center', '-87.6298,41.8837');
    expect(map()).toHaveAttribute('data-radius', '500');
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'chicago' }) }),
      expect.objectContaining({ center: [-87.6298, 41.8837], radiusMeters: 500, windowDays: 14 }),
    );

    await chooseOption(user, 'Within 500 m', 'radius', /^2 km/);
    expect(params().get('radius')).toBe('2000');
    expect(map()).toHaveAttribute('data-radius', '2000');

    await chooseOption(user, 'Last 14 days', 'window', /^60 days/);
    expect(params().get('days')).toBe('60');
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ radiusMeters: 2000, windowDays: 60 }),
    );

    // Re-added groups take their place in the canonical order, not at the end.
    await chooseOption(user, '2 of 5 types', 'groups', /^Property/);
    expect(params().get('groups')).toBe('violent,property,weapons');
    await user.click(filterOption('groups', /^Weapons/));
    expect(params().get('groups')).toBe('violent,property');
    await user.click(filterOption('groups', /^Weapons/));
    expect(params().get('groups')).toBe('violent,property,weapons');
    expect(params().get('e2e')).toBe('1');

    await chooseFeaturedPlace(user, 'Union Square');
    expect(screen.getByRole('heading', { level: 1, name: 'Union Square' })).toBeInTheDocument();
    expect(params().get('place')).toBe('Union Square');
    expect(params().get('detail')).toBe('San Francisco, California');
    expect(params().get('lat')).toBe('37.78800');
    expect(params().get('lng')).toBe('-122.40750');
    expect(params().get('radius')).toBe('2000');
    expect(params().get('e2e')).toBe('1');
    await screen.findByRole('tablist', { name: 'Evidence views' });
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'san-francisco' }) }),
      expect.objectContaining({ center: [-122.4075, 37.788] }),
    );
  });

  it('drops a pin where the map reports a click', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Drop test pin' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Dropped pin' })).toBeInTheDocument();
    expect(params().get('place')).toBe('Dropped pin');
    expect(params().get('detail')).toBe('41.88000, -87.62000');
    expect(params().get('lng')).toBe('-87.62000');
    expect(map()).toHaveAttribute('data-center', '-87.62,41.88');
    await screen.findByRole('tablist', { name: 'Evidence views' });
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'chicago' }) }),
      expect.objectContaining({ center: [-87.62, 41.88] }),
    );
  });
});

/* ── Groups and toast ─────────────────────────────────────────────────────── */

describe('App group guard and toast', () => {
  it('keeps the last active group, explains why, and dismisses on request', async () => {
    setUrl('?groups=violent');
    const { user } = await renderReadyApp();

    await chooseOption(user, 'Violent only', 'groups', /^Violent/);
    expect(params().get('groups')).toBe('violent');
    expect(filterOption('groups', /^Violent/)).toHaveAttribute('aria-pressed', 'true');
    const toast = screen.getByText(MIN_GROUP_MESSAGE).closest('.toast')!;
    expect(toast).toHaveAttribute('role', 'status');

    await user.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText(MIN_GROUP_MESSAGE)).not.toBeInTheDocument();
  });

  it('dismisses the toast automatically', async () => {
    setUrl('?groups=property');
    await renderReadyApp();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Property only' }));
    fireEvent.click(filterOption('groups', /^Property/));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(MIN_GROUP_MESSAGE)).not.toBeInTheDocument();
  });

  it('restarts the dismiss timer when the message is shown again', async () => {
    setUrl('?groups=property');
    await renderReadyApp();
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Property only' }));
    const option = filterOption('groups', /^Property/);
    fireEvent.click(option);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1000));
    fireEvent.click(option);
    expect(screen.getAllByText(MIN_GROUP_MESSAGE)).toHaveLength(1);

    // The first timer would have fired here; the repeat keeps the message up for a full duration.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1001));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(MIN_GROUP_MESSAGE)).not.toBeInTheDocument();
  });
});

/* ── Geolocation ──────────────────────────────────────────────────────────── */

describe('App geolocation', () => {
  it('explains a browser without geolocation', async () => {
    const { user } = await renderReadyApp();
    expect('geolocation' in navigator).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByText('This browser does not share its location. Search or tap the map instead.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
  });

  it('moves to the device location and disables the control while locating', async () => {
    let succeed: ((position: { coords: { longitude: number; latitude: number } }) => void) | undefined;
    const getCurrentPosition = vi.fn((success: typeof succeed) => {
      succeed = success;
    });
    installGeolocation(getCurrentPosition);
    const { user } = await renderReadyApp();
    const locate = screen.getByRole('button', { name: 'Use my location' });

    await user.click(locate);
    expect(locate).toBeDisabled();
    expect(locate.querySelector('svg')).toHaveClass('is-spinning');
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );

    act(() => succeed?.({ coords: { longitude: -122.3422, latitude: 47.6097 } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your location' })).toBeInTheDocument();
    expect(screen.getByText('Approximate location from this device')).toBeInTheDocument();
    expect(locate).toBeEnabled();
    expect(locate.querySelector('svg')).not.toHaveClass('is-spinning');
    expect(params().get('place')).toBe('Your location');
    expect(params().get('lat')).toBe('47.60970');
    expect(params().get('lng')).toBe('-122.34220');
    await screen.findByRole('tablist', { name: 'Evidence views' });
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'seattle' }) }),
      expect.objectContaining({ center: [-122.3422, 47.6097] }),
    );
  });

  it('explains a denied permission', async () => {
    installGeolocation(vi.fn((_success: unknown, failure: (error: GeolocationErrorLike) => void) => {
      failure({ code: 1, PERMISSION_DENIED: 1 });
    }));
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByText('Location access was denied. Search or tap the map instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
  });

  it('explains any other location failure', async () => {
    installGeolocation(vi.fn((_success: unknown, failure: (error: GeolocationErrorLike) => void) => {
      failure({ code: 3, PERMISSION_DENIED: 1 });
    }));
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByText('Your location could not be determined.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  });
});

/* ── Selection ────────────────────────────────────────────────────────────── */

describe('App selection', () => {
  it('passes no locations to the map until the official records arrive', async () => {
    const pending = deferred<EvidenceBundle>();
    mockedLoadEvidence.mockImplementation(() => pending.promise);
    await renderApp();

    expect(map()).toHaveAttribute('data-locations', '');
    expect(map()).toHaveAttribute('data-selected', '');
    expect(map()).toHaveAttribute('data-focus', '');

    const [provider, request] = mockedLoadEvidence.mock.calls[0]!;
    await act(async () => pending.resolve(bundleFor(provider, request)));
    expect(map()).toHaveAttribute('data-locations', `${SHARED_KEY}|${VEHICLE_KEY}`);
  });

  it('opens a card for a location picked on the map, moves between its reports, and closes', async () => {
    const { user } = await renderReadyApp();
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Map location ${SHARED_KEY}` }));
    const card = screen.getByTestId('selected-reports');
    expect(within(card).getByRole('heading', { level: 2, name: '2 reports at this spot' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { level: 3, name: 'Robbery' })).toBeInTheDocument();
    expect(map()).toHaveAttribute('data-selected', SHARED_KEY);

    await user.click(within(within(card).getByRole('list', { name: 'Other reports at this spot' })).getByRole('button', { name: /Theft/ }));
    expect(within(card).getByRole('heading', { level: 3, name: 'Theft' })).toBeInTheDocument();
    expect(map()).toHaveAttribute('data-selected', SHARED_KEY);

    await user.click(within(card).getByRole('button', { name: 'Close selected reports' }));
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-selected', '');
  });

  it('expands a report from the list in place, focuses the map on it, and collapses it again', async () => {
    const { user } = await renderReadyApp();
    await openTab(user, /^Reports/);
    const reports = within(screen.getByRole('region', { name: 'Reports inside the circle' }));
    const vehicle = reports.getByRole('button', { name: /^Vehicle/ });
    const robbery = reports.getByRole('button', { name: /^Robbery/ });
    const theft = reports.getByRole('button', { name: /^Theft/ });

    await user.click(vehicle);
    expect(vehicle).toHaveAttribute('aria-expanded', 'true');
    expect(vehicle.closest('li')).toHaveClass('is-expanded');
    expect(map()).toHaveAttribute('data-selected', VEHICLE_KEY);
    expect(map()).toHaveAttribute('data-focus', `1@${VEHICLE_SPOT.join(',')}`);
    // List picks expand in place rather than opening the map card.
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();

    await user.click(vehicle);
    expect(vehicle).toHaveAttribute('aria-expanded', 'false');
    expect(map()).toHaveAttribute('data-selected', '');
    expect(map()).toHaveAttribute('data-focus', `1@${VEHICLE_SPOT.join(',')}`);

    await user.click(robbery);
    expect(robbery).toHaveAttribute('aria-expanded', 'true');
    expect(map()).toHaveAttribute('data-focus', `2@${SHARED_SPOT.join(',')}`);

    // Another report at the same spot moves the expansion and refocuses the map.
    await user.click(theft);
    expect(robbery).toHaveAttribute('aria-expanded', 'false');
    expect(theft).toHaveAttribute('aria-expanded', 'true');
    expect(map()).toHaveAttribute('data-selected', SHARED_KEY);
    expect(map()).toHaveAttribute('data-focus', `3@${SHARED_SPOT.join(',')}`);

    // A map pick of the same spot turns the list pick into the card.
    await user.click(screen.getByRole('button', { name: `Map location ${SHARED_KEY}` }));
    expect(theft).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('selected-reports')).toBeInTheDocument();

    // Picking the card's report from the list again expands it instead of clearing it.
    await user.click(robbery);
    expect(robbery).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-focus', `4@${SHARED_SPOT.join(',')}`);
  });

  it('clears the selection once its location leaves the filtered reports', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: `Map location ${VEHICLE_KEY}` }));
    expect(within(screen.getByTestId('selected-reports')).getByRole('heading', { level: 2, name: 'Report at this spot' }))
      .toBeInTheDocument();

    // Removing another type keeps the vehicle report and its selection.
    await chooseOption(user, 'All types', 'groups', /^Violent/);
    expect(map()).toHaveAttribute('data-selected', VEHICLE_KEY);
    expect(screen.getByTestId('selected-reports')).toBeInTheDocument();

    await user.click(filterOption('groups', /^Vehicle/));
    expect(map()).toHaveAttribute('data-locations', SHARED_KEY);
    expect(map()).toHaveAttribute('data-selected', '');
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();

    // The selection does not come back with the reports.
    await user.click(filterOption('groups', /^Vehicle/));
    expect(map()).toHaveAttribute('data-locations', `${SHARED_KEY}|${VEHICLE_KEY}`);
    expect(map()).toHaveAttribute('data-selected', '');
  });

  it('drops a list pick when its report is filtered out, even though its spot keeps other reports', async () => {
    const { user } = await renderReadyApp();
    await openTab(user, /^Reports/);
    await user.click(within(screen.getByRole('region', { name: 'Reports inside the circle' }))
      .getByRole('button', { name: /^Robbery/ }));
    expect(map()).toHaveAttribute('data-selected', SHARED_KEY);

    await chooseOption(user, 'All types', 'groups', /^Violent/);
    expect(map()).toHaveAttribute('data-locations', `${SHARED_KEY}|${VEHICLE_KEY}`);
    expect(map()).toHaveAttribute('data-selected', '');
    expect(screen.queryByRole('button', { name: /^Robbery/ })).not.toBeInTheDocument();

    await user.click(filterOption('groups', /^Violent/));
    expect(map()).toHaveAttribute('data-selected', '');
    expect(screen.getByRole('button', { name: /^Robbery/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a selection while new records load, then drops it when the location is gone', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: `Map location ${SHARED_KEY}` }));

    const pending = deferred<EvidenceBundle>();
    mockedLoadEvidence.mockImplementation(() => pending.promise);
    await chooseOption(user, 'Within 1 km', 'radius', /^2 km/);
    expect(map()).toHaveAttribute('data-locations', '');

    const [provider, request] = mockedLoadEvidence.mock.lastCall!;
    const bundle = bundleFor(provider, request);
    await act(async () => pending.resolve({ ...bundle, incidents: bundle.incidents.slice(2) }));
    expect(map()).toHaveAttribute('data-locations', VEHICLE_KEY);
    expect(map()).toHaveAttribute('data-selected', '');
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
  });

  it('clears the selection when a new place is chosen', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: `Map location ${SHARED_KEY}` }));
    expect(screen.getByTestId('selected-reports')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Drop test pin' }));
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-selected', '');
  });

  it('retries a failed load through the panel', async () => {
    mockedLoadEvidence.mockRejectedValueOnce(new Error('New York City Police Department returned HTTP 503'));
    const { user } = await renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent('New York City Police Department returned HTTP 503');
    expect(map()).toHaveAttribute('data-locations', '');

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('tablist', { name: 'Evidence views' });
    expect(mockedLoadEvidence).toHaveBeenCalledTimes(2);
    expect(map()).toHaveAttribute('data-locations', `${SHARED_KEY}|${VEHICLE_KEY}`);
  });
});

/* ── Layout ───────────────────────────────────────────────────────────────── */

describe('App layout', () => {
  it('docks the panel on wide screens with no map padding and a map key', async () => {
    setUrl('?groups=weapons,violent');
    const { container } = await renderReadyApp();

    expect(main()).toHaveClass('atlas');
    expect(main()).not.toHaveClass('atlas--compact');
    expect(mapPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(main().style.getPropertyValue('--top-inset')).toBe('0px');
    expect(main().style.getPropertyValue('--sheet-visible')).toBe('0px');
    expect(screen.queryByRole('button', { name: /evidence panel/ })).not.toBeInTheDocument();
    // The topbar is only measured on phones.
    expect(FakeResizeObserver.observersOf(topbar(container))).toHaveLength(0);

    const legend = screen.getByRole('group', { name: 'Map key' });
    expect(within(legend).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Violent', 'Weapons']);
  });

  it('runs a bottom sheet on phones, keeping the map clear of the topbar and the sheet', async () => {
    installMatchMedia({ compact: true });
    const { container, user } = await renderReadyApp();
    const header = topbar(container);
    const panel = screen.getByTestId('evidence-panel');

    expect(main()).toHaveClass('atlas', 'atlas--compact', 'is-sheet-peek');
    expect(screen.queryByRole('group', { name: 'Map key' })).not.toBeInTheDocument();
    expect(FakeResizeObserver.observersOf(header)).toHaveLength(1);

    setLayout(header, { offsetTop: 12, offsetHeight: 96 });
    setLayout(panel, { clientHeight: 700 });
    FakeResizeObserver.resize(header);
    FakeResizeObserver.resize(panel);
    const geometry = sheetGeometry(700, 10, window.innerHeight);
    expect(geometry.peek).toBeLessThan(geometry.half);
    expect(geometry.half).toBeLessThan(geometry.full);

    expect(mapPadding()).toEqual({ top: 108, right: 0, bottom: geometry.peek, left: 0 });
    expect(main().style.getPropertyValue('--top-inset')).toBe('108px');
    expect(main().style.getPropertyValue('--sheet-visible')).toBe(`${geometry.peek}px`);

    await user.click(screen.getByRole('button', { name: 'Show more of the evidence panel' }));
    expect(main()).toHaveClass('is-sheet-half');
    expect(mapPadding().bottom).toBe(geometry.half);

    await user.click(screen.getByRole('button', { name: 'Expand the evidence panel' }));
    expect(main()).toHaveClass('is-sheet-full');
    expect(mapPadding().bottom).toBe(geometry.full);
    expect(main().style.getPropertyValue('--sheet-visible')).toBe(`${geometry.full}px`);

    await user.click(screen.getByRole('button', { name: 'Collapse the evidence panel' }));
    expect(main()).toHaveClass('is-sheet-peek');
    expect(mapPadding().bottom).toBe(geometry.peek);

    // A taller topbar (wrapped filters) moves the top inset with it.
    setLayout(header, { offsetHeight: 140 });
    FakeResizeObserver.resize(header);
    expect(mapPadding().top).toBe(152);
  });

  it('measures the topbar when the screen narrows and stops when it widens', async () => {
    const media = installMatchMedia({ compact: false });
    const { container } = await renderReadyApp();
    const header = topbar(container);
    setLayout(header, { offsetTop: 8, offsetHeight: 64.4 });

    media.compact.change(true);
    expect(main()).toHaveClass('atlas--compact', 'is-sheet-peek');
    expect(mapPadding().top).toBe(72);
    expect(screen.queryByRole('group', { name: 'Map key' })).not.toBeInTheDocument();
    const [observer] = FakeResizeObserver.observersOf(header);
    expect(observer).toBeDefined();

    media.compact.change(false);
    expect(observer!.disconnected).toBe(true);
    expect(main()).not.toHaveClass('atlas--compact');
    expect(mapPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(screen.getByRole('group', { name: 'Map key' })).toBeInTheDocument();
  });

  it('raises the sheet for a map pick from the lowest position only', async () => {
    installMatchMedia({ compact: true });
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: `Map location ${SHARED_KEY}` }));
    expect(main()).toHaveClass('is-sheet-half');
    expect(screen.getByTestId('selected-reports')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand the evidence panel' }));
    expect(main()).toHaveClass('is-sheet-full');
    await user.click(screen.getByRole('button', { name: `Map location ${VEHICLE_KEY}` }));
    expect(main()).toHaveClass('is-sheet-full');
    expect(map()).toHaveAttribute('data-selected', VEHICLE_KEY);

    // A new place lowers the sheet and drops the selection.
    await chooseFeaturedPlace(user, 'Pike Place');
    expect(main()).toHaveClass('is-sheet-peek');
    expect(screen.getByRole('heading', { level: 1, name: 'Pike Place' })).toBeInTheDocument();
    expect(screen.queryByTestId('selected-reports')).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-selected', '');
  });
});

/* ── FBI jurisdiction fallback ────────────────────────────────────────────── */

describe('App FBI jurisdiction fallback', () => {
  /** Nothing that belongs to a local incident feed is shown or requested. */
  function expectNoLocalFeed() {
    expect(mockedLoadEvidence).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Analysis settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Map key' })).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-rings', 'false');
    expect(map()).toHaveAttribute('data-locations', '');
  }

  function expectOnlyEnabledCallsFor(center: Coordinates) {
    const calls = areaSummaryCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toEqual(calls.map(() => ({ center, enabled: true })));
  }

  it('looks for the local police agency where no feed covers the place, then shows its totals', async () => {
    setUrl(OKLAHOMA_CITY_URL);
    const { rerender } = await renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Oklahoma City' })).toBeInTheDocument();
    expectOnlyEnabledCallsFor(OKLAHOMA_CITY);
    expect(screen.getByText('Finding the local police agency').closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText('Finding the local police agency…')).toHaveClass('place__source');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expectNoLocalFeed();

    reportAreaSummary({ status: 'ready', result: AGENCY_RESULT });
    rerender(<App />);
    expect(screen.getByTestId('jurisdiction-finding')).toBeInTheDocument();
    expect(screen.queryByText('Finding the local police agency')).not.toBeInTheDocument();
    expectOnlyEnabledCallsFor(OKLAHOMA_CITY);
    expectNoLocalFeed();
  });

  it('answers with the agency\'s FBI totals for its whole jurisdiction', async () => {
    reportAreaSummary({ status: 'ready', result: AGENCY_RESULT });
    setUrl(OKLAHOMA_CITY_URL);
    const { user } = await renderApp();

    const finding = screen.getByTestId('jurisdiction-finding');
    expect(within(finding).getByRole('heading', { level: 2 }))
      .toHaveTextContent(/as many violent offenses per resident as Oklahoma overall$/);
    expect(screen.getByText('FBI totals · Fixture City Police Department')).toBeInTheDocument();
    expect(screen.getByTestId('precision-tag')).toHaveTextContent('Whole jurisdiction');
    // FBI totals have no individual reports to list.
    const tabs = within(screen.getByRole('tablist', { name: 'Evidence views' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'About the data']);
    expect(screen.getByTestId('violent-count')).toHaveTextContent('144');
    expectNoLocalFeed();

    await openTab(user, 'About the data');
    expect(screen.getByRole('heading', { level: 3, name: 'How the FBI fallback works' })).toBeInTheDocument();
  });

  it('gives statewide rates as context when no agency matches the point', async () => {
    reportAreaSummary({ status: 'ready', result: STATE_RESULT });
    setUrl(OKLAHOMA_CITY_URL);
    await renderApp();

    const finding = screen.getByTestId('state-finding');
    expect(within(finding).getByRole('heading', { level: 2, name: 'No local police totals for this point' }))
      .toBeInTheDocument();
    expect(finding).toHaveTextContent('Oklahoma overall: 40 violent offenses per 100,000 residents a year (US: 30)');
    expect(screen.getByText('FBI statewide rates · Oklahoma')).toBeInTheDocument();
    expect(screen.queryByTestId('jurisdiction-finding')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expectNoLocalFeed();
  });

  it('keeps only the map for a point outside US coverage', async () => {
    reportAreaSummary({ status: 'ready', result: OUTSIDE_RESULT });
    setUrl('?lat=43.65320&lng=-79.38320&place=Toronto&detail=Ontario');
    await renderApp();

    expectOnlyEnabledCallsFor([-79.3832, 43.6532]);
    const outside = screen.getByTestId('outside-coverage');
    expect(within(outside).getByRole('heading', { level: 2, name: 'Outside US coverage' })).toBeInTheDocument();
    expect(outside).toHaveTextContent('Toronto is not inside a US state');
    expect(screen.getByText('Map only · outside US coverage')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expectNoLocalFeed();
  });

  it('explains a failed agency lookup and retries it through the hook', async () => {
    reportAreaSummary({ status: 'error', error: 'Census TIGERweb returned HTTP 502.' });
    setUrl(OKLAHOMA_CITY_URL);
    const { user } = await renderApp();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2, name: 'Couldn\'t find the local police agency' }))
      .toBeInTheDocument();
    expect(alert).toHaveTextContent('Census TIGERweb returned HTTP 502.');
    expect(screen.getByText('FBI totals · unavailable')).toBeInTheDocument();
    expect(refreshAreaSummary).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(refreshAreaSummary).toHaveBeenCalledOnce();
    expectNoLocalFeed();
  });

  it('switches between the local feed and FBI totals as the place moves', async () => {
    reportAreaSummary({ status: 'ready', result: AGENCY_RESULT });
    installGeolocation(vi.fn((success: (position: { coords: { longitude: number; latitude: number } }) => void) => {
      success({ coords: { longitude: OKLAHOMA_CITY[0], latitude: OKLAHOMA_CITY[1] } });
    }));
    const { user } = await renderReadyApp();
    await openTab(user, /^Reports/);
    expect(map()).toHaveAttribute('data-rings', 'true');
    expect(areaSummaryCalls().at(-1)).toEqual({ center: TIMES_SQUARE, enabled: false });
    const feedLoads = mockedLoadEvidence.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Your location' })).toBeInTheDocument();
    expect(areaSummaryCalls().at(-1)).toEqual({ center: OKLAHOMA_CITY, enabled: true });
    expect(screen.getByTestId('jurisdiction-finding')).toBeInTheDocument();
    // Reports has no FBI counterpart, so the panel shows the overview instead.
    expect(screen.queryByRole('tab', { name: /^Reports/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(map()).toHaveAttribute('data-rings', 'false');
    expect(map()).toHaveAttribute('data-locations', '');
    expect(screen.queryByRole('group', { name: 'Analysis settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Map key' })).not.toBeInTheDocument();
    expect(mockedLoadEvidence).toHaveBeenCalledTimes(feedLoads);

    await chooseFeaturedPlace(user, 'Union Square');
    await screen.findByRole('tablist', { name: 'Evidence views' });
    expect(areaSummaryCalls().at(-1)).toEqual({ center: UNION_SQUARE, enabled: false });
    expect(screen.queryByTestId('jurisdiction-finding')).not.toBeInTheDocument();
    expect(map()).toHaveAttribute('data-rings', 'true');
    const [lng, lat] = UNION_SQUARE;
    expect(map()).toHaveAttribute('data-locations', `${locationKey([lng + 0.001, lat])}|${locationKey([lng - 0.001, lat])}`);
    expect(screen.getByRole('group', { name: 'Analysis settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map key' })).toBeInTheDocument();
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'san-francisco' }) }),
      expect.objectContaining({ center: UNION_SQUARE }),
    );
  });
});
