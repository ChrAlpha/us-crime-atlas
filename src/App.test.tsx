import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { MIN_GROUP_MESSAGE, sourceIndicator, THEME_STORAGE_KEY, TOAST_DURATION_MS } from './App';
import type { AtlasMapProps } from './components/AtlasMap';
import { loadEvidence, type EvidenceRequest } from './data/evidence';
import { FULL_AREA_COVERAGE, NO_TRUNCATION } from './domain/analysis';
import { categoryGroup, isViolentCategory, severityForCategory } from './domain/categories';
import { computeEvidenceWindow } from './domain/evidenceWindow';
import { DAY_MS, localClockTimestamp } from './domain/time';
import { loadAgencySnapshot, lookupCensusGeography } from './data/agencyStats';
import { clearAreaSummaryCache } from './hooks/useAreaSummary';
import { clearEvidenceCache } from './hooks/useIncidentAnalysis';
import { fixtureSnapshot, geography } from './test/agencyFixtures';
import type { CrimeCategory, EvidenceBundle, Incident, IncidentProvider } from './types';

vi.mock('./data/evidence', () => ({ loadEvidence: vi.fn() }));
vi.mock('./data/agencyStats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data/agencyStats')>()),
  lookupCensusGeography: vi.fn(),
  loadAgencySnapshot: vi.fn(),
}));

vi.mock('./components/AtlasMap', () => ({
  AtlasMap: (props: AtlasMapProps) => (
    <div
      data-incidents={props.incidents.map((incident) => incident.id).join(',')}
      data-radius={props.radiusMeters}
      data-selected={props.selectedIncidentId ?? ''}
      data-testid="map-stub"
      data-theme={props.theme}
    >
      <button onClick={() => props.onPointChange([-87.62, 41.88])} type="button">Drop test pin</button>
      <button
        onClick={() => {
          const first = props.incidents[0];
          if (first) props.onIncidentSelect(first);
        }}
        type="button"
      >
        Select first map incident
      </button>
    </div>
  ),
}));

const LATEST_RECORD = Date.UTC(2026, 9, 18, 15);
const NOW = new Date('2026-10-21T16:00:00Z');

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
      incident(provider, request, 'theft', 'theft', 2, 0.002),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

function params() {
  return new URLSearchParams(window.location.search);
}

function brandStatus(text: string) {
  return screen.getByText(text, { selector: '.brand-status' });
}

async function renderApp() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByTestId('map-stub');
  return { user, ...view };
}

async function renderReadyApp() {
  const rendered = await renderApp();
  await screen.findByText('Official local feed');
  return rendered;
}

interface FakeGeolocation {
  getCurrentPosition: ReturnType<typeof vi.fn>;
}

function installGeolocation(getCurrentPosition: FakeGeolocation['getCurrentPosition']) {
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
}

const mockedLookup = vi.mocked(lookupCensusGeography);
const mockedSnapshot = vi.mocked(loadAgencySnapshot);

beforeEach(() => {
  clearAreaSummaryCache();
  mockedLookup.mockReset();
  mockedLookup.mockResolvedValue(geography());
  mockedSnapshot.mockReset();
  mockedSnapshot.mockResolvedValue(fixtureSnapshot());
  clearEvidenceCache();
  mockedLoadEvidence.mockReset();
  mockedLoadEvidence.mockImplementation(async (provider, request) => bundleFor(provider, request));
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window.navigator, 'geolocation');
});

describe('App state and URL', () => {
  it('starts at the default place and writes the full state into the URL', async () => {
    await renderReadyApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 km' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30 d' })).toHaveAttribute('aria-pressed', 'true');
    expect(params().get('place')).toBe('Times Square');
    expect(params().get('lat')).toBe('40.75800');
    expect(params().get('lng')).toBe('-73.98550');
    expect(params().get('radius')).toBe('1000');
    expect(params().get('days')).toBe('30');
    expect(params().get('groups')).toBe('violent,property,vehicle,weapons,other');
    expect(mockedLoadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'new-york' }) }),
      expect.objectContaining({ center: [-73.9855, 40.758], radiusMeters: 1000, windowDays: 30 }),
    );
  });

  it('restores a shared view and keeps the e2e flag while the state changes', async () => {
    setUrl('?e2e=1&lat=41.88370&lng=-87.62980&place=The+Loop&detail=Chicago&radius=500&days=14&groups=violent,property');
    const { user } = await renderReadyApp();

    expect(screen.getByRole('heading', { level: 1, name: 'The Loop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '500 m' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '14 d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Vehicle' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByText('Chicago Police Department').length).toBeGreaterThan(0);
    expect(params().get('e2e')).toBe('1');

    await user.click(screen.getByRole('button', { name: '2 km' }));
    expect(params().get('radius')).toBe('2000');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-radius', '2000');

    await user.click(screen.getByRole('button', { name: '60 d' }));
    expect(params().get('days')).toBe('60');

    await user.click(screen.getByRole('button', { name: 'Vehicle' }));
    expect(params().get('groups')).toBe('violent,property,vehicle');
    await user.click(screen.getByRole('button', { name: 'Property' }));
    expect(params().get('groups')).toBe('violent,vehicle');

    await user.click(screen.getByRole('button', { name: 'Times Square' }));
    expect(params().get('place')).toBe('Times Square');
    expect(params().get('lat')).toBe('40.75800');
    expect(params().get('e2e')).toBe('1');
    expect(await screen.findAllByText('New York City Police Department')).not.toHaveLength(0);
  });

  it('drops a pin where the map reports a click', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Drop test pin' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Dropped pin' })).toBeInTheDocument();
    expect(screen.getByText('41.88000, -87.62000', { selector: 'p' })).toBeInTheDocument();
    expect(params().get('place')).toBe('Dropped pin');
    expect(params().get('lng')).toBe('-87.62000');
    await screen.findByText('Official local feed');
    expect(mockedLoadEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ id: 'chicago' }) }),
      expect.objectContaining({ center: [-87.62, 41.88] }),
    );
  });
});

describe('App theme', () => {
  it('defaults to light, then persists a toggled dark theme', async () => {
    const { user } = await renderApp();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-theme', 'light');

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-theme', 'dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores a stored theme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderApp();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('follows the system preference when nothing valid is stored', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMedia);
    await renderApp();
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

describe('App source status', () => {
  it('shows the checking tone while official records load', async () => {
    const pending = deferred<EvidenceBundle>();
    mockedLoadEvidence.mockImplementation(() => pending.promise);
    await renderApp();

    expect(brandStatus('Checking official feed')).toHaveClass('is-loading');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading official incident records');
  });

  it('shows the ready tone with the analyzed evidence', async () => {
    await renderReadyApp();
    expect(brandStatus('Official local feed')).toHaveClass('is-ready');
    expect(screen.getByTestId('reported-count')).toHaveTextContent('3');
    expect(screen.getByTestId('map-stub')).toHaveAttribute(
      'data-incidents',
      'new-york:robbery,new-york:theft,new-york:vehicle',
    );
  });

  it('shows the error tone and recovers after a retry', async () => {
    mockedLoadEvidence.mockRejectedValueOnce(new Error('New York City Police Department returned HTTP 503'));
    const { user } = await renderApp();

    expect(await screen.findByText('Source unavailable')).toHaveClass('is-error');
    expect(screen.getByRole('alert')).toHaveTextContent('New York City Police Department returned HTTP 503');
    expect(screen.getByText('New York City Police Department is temporarily unavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Official local feed')).toHaveClass('is-ready');
    expect(mockedLoadEvidence).toHaveBeenCalledTimes(2);
  });

  it('stands in FBI jurisdiction totals where no local feed exists', async () => {
    setUrl('?lat=35.4676&lng=-97.5164&place=Oklahoma+City');
    await renderApp();

    expect(await screen.findByText('FBI jurisdiction totals')).toHaveClass('is-coarse');
    expect(screen.getByTestId('jurisdiction-band')).toHaveTextContent('Fixture City Police Department');
    expect(screen.getByRole('button', { name: 'Sources & methodology' })).toHaveClass('is-coarse');
    expect(mockedLookup).toHaveBeenCalledWith([-97.5164, 35.4676], expect.any(AbortSignal));
    expect(mockedLoadEvidence).not.toHaveBeenCalled();
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-incidents', '');
  });

  it('keeps a place outside the states as map-only', async () => {
    mockedLookup.mockResolvedValue(null);
    setUrl('?lat=43.6532&lng=-79.3832&place=Toronto');
    await renderApp();

    expect(await screen.findByText('Map only')).toHaveClass('is-neutral');
    expect(screen.getByTestId('outside-coverage')).toBeInTheDocument();
    expect(screen.getByText('No verified incident feed here yet')).toBeInTheDocument();
  });
});

describe('sourceIndicator', () => {
  const idle = { status: 'idle' as const, result: null };

  it('describes local feeds by their load status', () => {
    expect(sourceIndicator(true, 'loading', idle)).toEqual({ sourceTone: 'loading', sourceStatus: 'Checking official feed' });
    expect(sourceIndicator(true, 'ready', idle)).toEqual({ sourceTone: 'ready', sourceStatus: 'Official local feed' });
    expect(sourceIndicator(true, 'error', idle)).toEqual({ sourceTone: 'error', sourceStatus: 'Source unavailable' });
  });

  it('describes the FBI fallback by what it found', () => {
    const snapshot = fixtureSnapshot();
    expect(sourceIndicator(false, 'idle', { status: 'loading', result: null }).sourceStatus).toBe('Finding local agency');
    expect(sourceIndicator(false, 'idle', { status: 'error', result: null }).sourceTone).toBe('error');
    expect(sourceIndicator(false, 'idle', {
      status: 'ready',
      result: {
        kind: 'state',
        snapshot,
        agencyName: null,
        summary: { stateName: 'California', startMonth: '2025-08', endMonth: '2026-07', ratesPer100k: null, nationalRatesPer100k: null },
      },
    })).toEqual({ sourceTone: 'coarse', sourceStatus: 'Statewide context only' });
  });
});

describe('App sources dialog', () => {
  it('opens from the header and closes from the dialog', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Open sources and methodology' }));

    const dialog = screen.getByRole('dialog', { name: 'Sources & methodology' });
    expect(within(dialog).getByRole('heading', { name: 'Current source' })).toBeInTheDocument();
    expect(within(dialog).getAllByText('New York City Police Department').length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole('button', { name: 'Close sources and methodology' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens from the provider strip without a current source for unsupported places', async () => {
    setUrl('?lat=35.4676&lng=-97.5164&place=Oklahoma+City');
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Sources & methodology' }));
    const dialog = screen.getByRole('dialog', { name: 'Sources & methodology' });
    expect(within(dialog).queryByRole('heading', { name: 'Current source' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Official local publishers' })).toBeInTheDocument();
  });
});

describe('App incident groups and toast', () => {
  it('keeps the last active group and explains why', async () => {
    setUrl('?groups=violent');
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Violent' }));
    expect(params().get('groups')).toBe('violent');
    expect(screen.getByRole('button', { name: 'Violent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText(MIN_GROUP_MESSAGE)).not.toBeInTheDocument();
  });

  it('dismisses the toast automatically', async () => {
    setUrl('?groups=property');
    render(<App />);
    await screen.findByText('Official local feed');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Property' }));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getByText(MIN_GROUP_MESSAGE)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(MIN_GROUP_MESSAGE)).not.toBeInTheDocument();
  });

  it('restarts the dismiss timer when the same message is shown again', async () => {
    setUrl('?groups=property');
    render(<App />);
    await screen.findByText('Official local feed');
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Property' }));
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1000));
    fireEvent.click(screen.getByRole('button', { name: 'Property' }));
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

describe('App incident selection', () => {
  it('shows the selected map incident and clears it when it leaves the analysis', async () => {
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Select first map incident' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Robbery · ROBBERY' })).toBeInTheDocument();
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-selected', 'new-york:robbery');

    await user.click(screen.getByRole('button', { name: 'Violent' }));
    expect(screen.queryByRole('heading', { level: 3, name: 'Robbery · ROBBERY' })).not.toBeInTheDocument();
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-selected', '');
  });

  it('selects an incident from the evidence list', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: /Vehicle theft · VEHICLE/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'Vehicle theft · VEHICLE' })).toBeInTheDocument();
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-selected', 'new-york:vehicle');
  });

  it('clears the selection when a new place is chosen', async () => {
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Select first map incident' }));
    await user.click(screen.getByRole('button', { name: 'Union Square' }));
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-selected', '');
  });
});

describe('App geolocation', () => {
  it('moves to the browser location and disables the control while locating', async () => {
    let succeed: ((position: { coords: { longitude: number; latitude: number } }) => void) | undefined;
    const getCurrentPosition = vi.fn((success: typeof succeed) => {
      succeed = success;
    });
    installGeolocation(getCurrentPosition);
    const { user } = await renderReadyApp();

    await user.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(screen.getByRole('button', { name: 'Use current location' })).toBeDisabled();
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );

    act(() => succeed?.({ coords: { longitude: -122.3422, latitude: 47.6097 } }));
    expect(screen.getByRole('heading', { level: 1, name: 'Current location' })).toBeInTheDocument();
    expect(screen.getByText('Approximate browser location', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use current location' })).toBeEnabled();
    expect(params().get('lat')).toBe('47.60970');
    await screen.findByText('Official local feed');
  });

  it('explains a denied permission', async () => {
    installGeolocation(vi.fn((_success: unknown, failure: (error: { code: number; PERMISSION_DENIED: number }) => void) => {
      failure({ code: 1, PERMISSION_DENIED: 1 });
    }));
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(screen.getByText('Location permission was denied. Search or drop a pin instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use current location' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
  });

  it('explains any other location failure', async () => {
    installGeolocation(vi.fn((_success: unknown, failure: (error: { code: number; PERMISSION_DENIED: number }) => void) => {
      failure({ code: 3, PERMISSION_DENIED: 1 });
    }));
    const { user } = await renderReadyApp();
    await user.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(screen.getByText('Current location could not be determined.')).toBeInTheDocument();
  });

  it('explains a browser without geolocation', async () => {
    const { user } = await renderReadyApp();
    expect('geolocation' in navigator).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(screen.getByText('This browser does not expose location access.')).toBeInTheDocument();
  });
});
