import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { findProviderForPoint } from './data/providers';
import { droppedPin, parseUrlState, serializeUrlState } from './domain/urlState';
import { useAreaSummary } from './hooks/useAreaSummary';
import { useIncidentAnalysis } from './hooks/useIncidentAnalysis';
import type { AreaSummaryState } from './hooks/useAreaSummary';
import type {
  AtlasState,
  Coordinates,
  CrimeGroup,
  Incident,
  LoadStatus,
  RadiusMeters,
  SelectedPlace,
  WindowDays,
} from './types';
import { EvidencePanel } from './components/EvidencePanel';
import { AtlasIcon, CloseIcon, InfoIcon, MoonIcon, SunIcon } from './components/Icons';
import { MapErrorBoundary } from './components/MapErrorBoundary';
import { SearchPanel } from './components/SearchPanel';
import { SourceDialog } from './components/SourceDialog';

type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'us-crime-atlas-theme';
export const MIN_GROUP_MESSAGE = 'At least one published incident group must remain active.';
export const TOAST_DURATION_MS = 6_000;
/** Stable while analysis is pending, so the map's data effect does not re-run every render. */
const NO_INCIDENTS: Incident[] = [];

const AtlasMap = lazy(async () => {
  const module = await import('./components/AtlasMap');
  return { default: module.AtlasMap };
});

type SourceTone = 'neutral' | 'error' | 'loading' | 'ready' | 'coarse';

/** The header pill: which kind of evidence backs the current place. */
export function sourceIndicator(
  hasProvider: boolean,
  incidentStatus: LoadStatus,
  areaSummary: Pick<AreaSummaryState, 'status' | 'result'>,
): { sourceTone: SourceTone; sourceStatus: string } {
  const status = hasProvider ? incidentStatus : areaSummary.status;
  if (status === 'error') return { sourceTone: 'error', sourceStatus: 'Source unavailable' };
  if (hasProvider) {
    return status === 'ready'
      ? { sourceTone: 'ready', sourceStatus: 'Official local feed' }
      : { sourceTone: 'loading', sourceStatus: 'Checking official feed' };
  }
  const kind = areaSummary.result?.kind;
  if (kind === 'agency') return { sourceTone: 'coarse', sourceStatus: 'FBI jurisdiction totals' };
  if (kind === 'state') return { sourceTone: 'coarse', sourceStatus: 'Statewide context only' };
  if (kind === 'outside') return { sourceTone: 'neutral', sourceStatus: 'Map only' };
  return { sourceTone: 'loading', sourceStatus: 'Finding local agency' };
}

function initialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const [atlasState, setAtlasState] = useState<AtlasState>(() => parseUrlState(window.location.search));
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // The id restarts the dismiss timer when the same message is shown again.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const showToast = useCallback((message: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }, []);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const provider = useMemo(
    () => findProviderForPoint(atlasState.place.coordinates),
    [atlasState.place.coordinates],
  );
  const incidentState = useIncidentAnalysis({
    provider,
    center: atlasState.place.coordinates,
    radiusMeters: atlasState.radiusMeters,
    windowDays: atlasState.windowDays,
    activeGroups: atlasState.activeGroups,
  });
  const areaSummary = useAreaSummary(atlasState.place.coordinates, !provider);
  const { sourceTone, sourceStatus } = sourceIndicator(provider !== null, incidentState.status, areaSummary);
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId || !incidentState.analysis) return null;
    return incidentState.analysis.mapIncidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  }, [incidentState.analysis, selectedIncidentId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const search = serializeUrlState(atlasState, window.location.search);
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, [atlasState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedIncidentId) return;
    const remainsVisible = incidentState.analysis?.mapIncidents.some((incident) => incident.id === selectedIncidentId);
    if (!remainsVisible) setSelectedIncidentId(null);
  }, [incidentState.analysis, selectedIncidentId]);

  const choosePlace = useCallback((place: SelectedPlace) => {
    setAtlasState((state) => ({ ...state, place }));
    setSelectedIncidentId(null);
  }, []);

  const chooseMapPoint = useCallback((coordinates: Coordinates) => {
    choosePlace(droppedPin(coordinates));
  }, [choosePlace]);

  const setRadius = useCallback((radiusMeters: RadiusMeters) => {
    setAtlasState((state) => ({ ...state, radiusMeters }));
  }, []);

  const setWindow = useCallback((windowDays: WindowDays) => {
    setAtlasState((state) => ({ ...state, windowDays }));
  }, []);

  const { activeGroups } = atlasState;
  const toggleGroup = useCallback((group: CrimeGroup) => {
    if (activeGroups.length === 1 && activeGroups[0] === group) {
      showToast(MIN_GROUP_MESSAGE);
      return;
    }
    setAtlasState((state) => ({
      ...state,
      activeGroups: state.activeGroups.includes(group)
        ? state.activeGroups.filter((candidate) => candidate !== group)
        : [...state.activeGroups, group],
    }));
  }, [activeGroups, showToast]);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      showToast('This browser does not expose location access.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        choosePlace({
          label: 'Current location',
          detail: 'Approximate browser location',
          coordinates: [position.coords.longitude, position.coords.latitude],
        });
        setLocating(false);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Search or drop a pin instead.'
          : 'Current location could not be determined.';
        showToast(message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [choosePlace, showToast]);

  const openSources = useCallback(() => setSourcesOpen(true), []);
  const closeSources = useCallback(() => setSourcesOpen(false), []);
  const selectIncident = useCallback((incident: Incident) => setSelectedIncidentId(incident.id), []);

  return (
    <main className="atlas-app">
      <a className="skip-link" href="#place-query">Skip to place search</a>
      <MapErrorBoundary>
        <Suspense
          fallback={(
            <div className="map-stage map-stage--loading" role="status">
              <span>Loading map</span>
            </div>
          )}
        >
          <AtlasMap
            center={atlasState.place.coordinates}
            incidents={incidentState.analysis?.mapIncidents ?? NO_INCIDENTS}
            onIncidentSelect={selectIncident}
            onPointChange={chooseMapPoint}
            radiusMeters={atlasState.radiusMeters}
            selectedIncidentId={selectedIncidentId}
            theme={theme}
          />
        </Suspense>
      </MapErrorBoundary>

      <header className="brand-bar glass-panel">
        <div className="brand-lockup">
          <span className="brand-mark"><AtlasIcon size={22} /></span>
          <span>
            <strong>US Crime Atlas</strong>
            <small>Evidence for travel decisions</small>
          </span>
        </div>
        <div className={`brand-status is-${sourceTone}`}>
          <span className="live-dot" aria-hidden="true" />
          {sourceStatus}
        </div>
        <div className="brand-actions">
          <button
            aria-label="Open sources and methodology"
            className="icon-button"
            onClick={openSources}
            title="Sources and methodology"
            type="button"
          >
            <InfoIcon />
          </button>
          <button
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            className="icon-button"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            type="button"
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        </div>
      </header>

      <SearchPanel
        activeGroups={atlasState.activeGroups}
        areaSummary={areaSummary.result}
        locating={locating}
        onLocate={locate}
        onOpenSources={openSources}
        onPlaceSelect={choosePlace}
        onRadiusChange={setRadius}
        onToggleGroup={toggleGroup}
        onWindowChange={setWindow}
        place={atlasState.place}
        provider={provider}
        providerStatus={incidentState.status}
        radiusMeters={atlasState.radiusMeters}
        windowDays={atlasState.windowDays}
      />

      <EvidencePanel
        analysis={incidentState.analysis}
        areaSummary={areaSummary}
        evidence={incidentState.evidence}
        error={incidentState.error}
        onIncidentSelect={selectIncident}
        onOpenSources={openSources}
        onRefresh={incidentState.refresh}
        place={atlasState.place}
        provider={provider}
        radiusMeters={atlasState.radiusMeters}
        selectedIncident={selectedIncident}
        status={incidentState.status}
        windowDays={atlasState.windowDays}
      />

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          <button aria-label="Dismiss message" onClick={() => setToast(null)} type="button">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      <SourceDialog activeProvider={provider?.meta ?? null} onClose={closeSources} open={sourcesOpen} />
    </main>
  );
}
