import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { findProviderForPoint } from './data/providers';
import { CRIME_GROUPS, GROUP_LABELS } from './domain/categories';
import { droppedPin, parseUrlState, serializeUrlState } from './domain/urlState';
import { useAreaSummary } from './hooks/useAreaSummary';
import { useIncidentAnalysis } from './hooks/useIncidentAnalysis';
import { COMPACT_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import type { SheetSnap } from './hooks/useSheet';
import type { AtlasState, Coordinates, CrimeGroup, Incident, RadiusMeters, SelectedPlace, WindowDays } from './types';
import type { MapFocus, MapPadding } from './components/AtlasMap';
import { FilterBar } from './components/FilterBar';
import { AtlasIcon, CloseIcon, LocateIcon, MoonIcon, SunIcon } from './components/Icons';
import { MapErrorBoundary } from './components/MapErrorBoundary';
import { groupIncidentsByLocation, locationKey } from './components/mapLayers';
import type { ThemePreference } from './components/panel/AboutTab';
import { PlacePanel, type PanelTab } from './components/PlacePanel';
import { SearchBox } from './components/SearchBox';

type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'us-crime-atlas-theme';
export const MIN_GROUP_MESSAGE = 'Keep at least one type of report selected.';
export const TOAST_DURATION_MS = 6_000;
const NO_INCIDENTS: Incident[] = [];
const NO_PADDING: MapPadding = { top: 0, right: 0, bottom: 0, left: 0 };
const DARK_QUERY = '(prefers-color-scheme: dark)';

const AtlasMap = lazy(async () => {
  const module = await import('./components/AtlasMap');
  return { default: module.AtlasMap };
});

function initialThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function MapLegend({ activeGroups }: { activeGroups: readonly CrimeGroup[] }) {
  return (
    <div aria-label="Map key" className="legend" role="group">
      <ul>
        {CRIME_GROUPS.filter((group) => activeGroups.includes(group)).map((group) => (
          <li key={group}>
            <span aria-hidden="true" className={`swatch swatch--${group}`} />
            {GROUP_LABELS[group]}
          </li>
        ))}
      </ul>
      <p>Larger dots carry more reports at one spot. Faded dots are outside the circle.</p>
    </div>
  );
}

export default function App() {
  const [atlasState, setAtlasState] = useState<AtlasState>(() => parseUrlState(window.location.search));
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialThemePreference);
  const systemDark = useMediaQuery(DARK_QUERY);
  const theme: Theme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference;
  const compact = useMediaQuery(COMPACT_QUERY);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const showToast = useCallback((message: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }, []);
  const [selection, setSelection] = useState<{
    key: string;
    incidentId: string | null;
    origin: 'map' | 'list';
  } | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [tab, setTab] = useState<PanelTab>('overview');
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [sheetVisible, setSheetVisible] = useState(0);
  const [topInset, setTopInset] = useState(0);
  const topbarRef = useRef<HTMLElement | null>(null);

  const { place, radiusMeters, windowDays, activeGroups } = atlasState;
  const provider = useMemo(() => findProviderForPoint(place.coordinates), [place.coordinates]);
  // FBI jurisdiction totals stand in wherever no local incident feed covers the point.
  const areaSummary = useAreaSummary(place.coordinates, provider === null);
  const incidentState = useIncidentAnalysis({
    provider,
    center: place.coordinates,
    radiusMeters,
    windowDays,
    activeGroups,
  });
  const mapIncidents = incidentState.analysis?.mapIncidents ?? NO_INCIDENTS;
  const locations = useMemo(
    () => groupIncidentsByLocation(place.coordinates, radiusMeters, mapIncidents),
    [place.coordinates, radiusMeters, mapIncidents],
  );
  const selectedLocation = useMemo(() => {
    if (!selection) return null;
    const location = locations.find((candidate) => candidate.key === selection.key);
    if (!location) return null;
    // A report opened from the list goes away with that report, even if its spot keeps others.
    const listReportGone = selection.origin === 'list'
      && !location.incidents.some((incident) => incident.id === selection.incidentId);
    return listReportGone ? null : location;
  }, [locations, selection]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#181714' : '#fdfcf9');
  }, [theme]);

  useEffect(() => {
    if (themePreference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [themePreference]);

  useEffect(() => {
    const search = serializeUrlState(atlasState, window.location.search);
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, [atlasState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A selection disappears with its reports (new filters, radius, or window).
  useEffect(() => {
    if (selection && !selectedLocation && incidentState.analysis) setSelection(null);
  }, [incidentState.analysis, selectedLocation, selection]);

  // The floating search bar covers the top of the map on phones; keep the circle clear of it.
  useLayoutEffect(() => {
    const topbar = topbarRef.current;
    if (!compact || !topbar) {
      setTopInset(0);
      return undefined;
    }
    const measure = () => setTopInset(Math.round(topbar.offsetTop + topbar.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, [compact]);

  const padding = useMemo<MapPadding>(
    () => (compact ? { top: topInset, right: 0, bottom: sheetVisible, left: 0 } : NO_PADDING),
    [compact, sheetVisible, topInset],
  );

  const choosePlace = useCallback((next: SelectedPlace) => {
    setAtlasState((state) => ({ ...state, place: next }));
    setSelection(null);
    setSnap('peek');
  }, []);

  const chooseMapPoint = useCallback((coordinates: Coordinates) => {
    choosePlace(droppedPin(coordinates));
  }, [choosePlace]);

  const setRadius = useCallback((radius: RadiusMeters) => {
    setAtlasState((state) => ({ ...state, radiusMeters: radius }));
  }, []);

  const setWindow = useCallback((days: WindowDays) => {
    setAtlasState((state) => ({ ...state, windowDays: days }));
  }, []);

  const toggleGroup = useCallback((group: CrimeGroup) => {
    if (activeGroups.length === 1 && activeGroups[0] === group) {
      showToast(MIN_GROUP_MESSAGE);
      return;
    }
    setAtlasState((state) => ({
      ...state,
      activeGroups: state.activeGroups.includes(group)
        ? state.activeGroups.filter((candidate) => candidate !== group)
        : CRIME_GROUPS.filter((candidate) => candidate === group || state.activeGroups.includes(candidate)),
    }));
  }, [activeGroups, showToast]);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      showToast('This browser does not share its location. Search or tap the map instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        choosePlace({
          label: 'Your location',
          detail: 'Approximate location from this device',
          coordinates: [position.coords.longitude, position.coords.latitude],
        });
        setLocating(false);
      },
      (error) => {
        showToast(error.code === error.PERMISSION_DENIED
          ? 'Location access was denied. Search or tap the map instead.'
          : 'Your location could not be determined.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [choosePlace, showToast]);

  const selectLocation = useCallback((key: string) => {
    setSelection({ key, incidentId: null, origin: 'map' });
    setSnap((current) => (current === 'peek' ? 'half' : current));
  }, []);

  const selectReport = useCallback((incident: Incident) => {
    if (selection?.origin === 'list' && selection.incidentId === incident.id) {
      setSelection(null);
      return;
    }
    setSelection({ key: locationKey(incident.coordinates), incidentId: incident.id, origin: 'list' });
    setFocus((current) => ({ coordinates: incident.coordinates, id: (current?.id ?? 0) + 1 }));
  }, [selection]);

  const focusIncident = useCallback((incident: Incident) => {
    setSelection({ key: locationKey(incident.coordinates), incidentId: incident.id, origin: 'map' });
  }, []);

  const clearSelection = useCallback(() => setSelection(null), []);

  const rootStyle = {
    '--top-inset': `${topInset}px`,
    '--sheet-visible': `${sheetVisible}px`,
  } as CSSProperties;

  return (
    <main className={`atlas${compact ? ` atlas--compact is-sheet-${snap}` : ''}`} style={rootStyle}>
      <a className="skip-link" href="#place-query">Skip to place search</a>

      <header className="topbar" ref={topbarRef}>
        <div className="topbar__brand">
          <span className="brand">
            <AtlasIcon size={20} />
            US Crime Atlas
          </span>
          <button
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            className="icon-button"
            onClick={() => setThemePreference(theme === 'light' ? 'dark' : 'light')}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            type="button"
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
        <SearchBox locating={locating} onLocate={locate} onPlaceSelect={choosePlace} place={place} />
        {/* Radius, dates, and report types only apply to a local incident feed. */}
        {provider ? (
          <FilterBar
            activeGroups={activeGroups}
            onRadiusChange={setRadius}
            onToggleGroup={toggleGroup}
            onWindowChange={setWindow}
            radiusMeters={radiusMeters}
            windowDays={windowDays}
          />
        ) : null}
      </header>

      <div className="atlas__map">
        <MapErrorBoundary>
          <Suspense
            fallback={(
              <div className="map-stage map-stage--loading" role="status">
                <span>Loading map</span>
              </div>
            )}
          >
            <AtlasMap
              center={place.coordinates}
              focus={focus}
              locations={locations}
              onLocationSelect={selectLocation}
              onPointChange={chooseMapPoint}
              padding={padding}
              radiusMeters={radiusMeters}
              selectedKey={selectedLocation?.key ?? null}
              showRings={provider !== null}
              theme={theme}
            />
          </Suspense>
        </MapErrorBoundary>
        <button
          aria-label="Use my location"
          className="locate-button"
          disabled={locating}
          onClick={locate}
          title="Use my location"
          type="button"
        >
          <LocateIcon className={locating ? 'is-spinning' : undefined} size={20} />
        </button>
        {!compact && provider ? <MapLegend activeGroups={activeGroups} /> : null}
      </div>

      <PlacePanel
        analysis={incidentState.analysis}
        areaSummary={areaSummary}
        compact={compact}
        error={incidentState.error}
        evidence={incidentState.evidence}
        onClearSelection={clearSelection}
        onFocusIncident={focusIncident}
        onPlaceSelect={choosePlace}
        onRefresh={incidentState.refresh}
        onReportSelect={selectReport}
        onSnapChange={setSnap}
        onTabChange={setTab}
        onThemePreferenceChange={setThemePreference}
        onVisibleHeightChange={setSheetVisible}
        place={place}
        provider={provider}
        radiusMeters={radiusMeters}
        selection={selectedLocation && selection
          ? { location: selectedLocation, incidentId: selection.incidentId, origin: selection.origin }
          : null}
        snap={snap}
        status={incidentState.status}
        tab={tab}
        themePreference={themePreference}
      />

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          <button aria-label="Dismiss message" className="icon-button" onClick={() => setToast(null)} type="button">
            <CloseIcon size={16} />
          </button>
        </div>
      ) : null}
    </main>
  );
}
