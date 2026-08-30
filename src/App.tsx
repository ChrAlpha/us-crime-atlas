import { useCallback, useEffect, useMemo, useState } from 'react';
import { findProviderForPoint } from './data/providers';
import { parseUrlState, serializeUrlState } from './domain/urlState';
import { useIncidentAnalysis } from './hooks/useIncidentAnalysis';
import type { AtlasState, Coordinates, CrimeGroup, Incident, SelectedPlace } from './types';
import { AtlasMap } from './components/AtlasMap';
import { EvidencePanel } from './components/EvidencePanel';
import { AtlasIcon, CloseIcon, InfoIcon, MoonIcon, SunIcon } from './components/Icons';
import { SearchPanel } from './components/SearchPanel';
import { SourceDialog } from './components/SourceDialog';

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const stored = window.localStorage.getItem('us-crime-atlas-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function droppedPin(coordinates: Coordinates): SelectedPlace {
  return {
    label: 'Dropped pin',
    detail: `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`,
    coordinates,
  };
}

export default function App() {
  const [atlasState, setAtlasState] = useState<AtlasState>(() => parseUrlState(window.location.search));
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const provider = useMemo(
    () => findProviderForPoint(atlasState.place.coordinates),
    [atlasState.place.coordinates],
  );
  const incidentState = useIncidentAnalysis({
    provider,
    place: atlasState.place,
    radiusMeters: atlasState.radiusMeters,
    windowDays: atlasState.windowDays,
    activeGroups: atlasState.activeGroups,
  });
  const sourceTone = !provider
    ? 'neutral'
    : incidentState.status === 'error'
      ? 'error'
      : incidentState.status === 'loading'
        ? 'loading'
        : 'ready';
  const sourceStatus = sourceTone === 'neutral'
    ? 'Map only'
    : sourceTone === 'error'
      ? 'Source unavailable'
      : sourceTone === 'loading'
        ? 'Checking official feed'
        : 'Official local feed';

  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId || !incidentState.analysis) return null;
    return incidentState.analysis.mapIncidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  }, [incidentState.analysis, selectedIncidentId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('us-crime-atlas-theme', theme);
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(serializeUrlState(atlasState).slice(1));
    if (new URLSearchParams(window.location.search).get('e2e') === '1') params.set('e2e', '1');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [atlasState]);

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

  const setRadius = useCallback((radiusMeters: number) => {
    setAtlasState((state) => ({ ...state, radiusMeters }));
  }, []);

  const setWindow = useCallback((windowDays: number) => {
    setAtlasState((state) => ({ ...state, windowDays }));
  }, []);

  const toggleGroup = useCallback((group: CrimeGroup) => {
    setAtlasState((state) => {
      const active = state.activeGroups.includes(group);
      if (active && state.activeGroups.length === 1) {
        setToast('At least one published incident group must remain active.');
        return state;
      }
      const activeGroups = active
        ? state.activeGroups.filter((candidate) => candidate !== group)
        : [...state.activeGroups, group];
      return { ...state, activeGroups };
    });
  }, []);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setToast('This browser does not expose location access.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        choosePlace({
          label: 'Current location',
          detail: 'Browser location · coordinates are not stored',
          coordinates: [position.coords.longitude, position.coords.latitude],
        });
        setLocating(false);
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Search or drop a pin instead.'
          : 'Current location could not be determined.';
        setToast(message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [choosePlace]);

  const openSources = useCallback(() => setSourcesOpen(true), []);
  const closeSources = useCallback(() => setSourcesOpen(false), []);
  const selectIncident = useCallback((incident: Incident) => setSelectedIncidentId(incident.id), []);

  return (
    <main className="atlas-app">
      <a className="skip-link" href="#place-query">Skip to place search</a>
      <AtlasMap
        center={atlasState.place.coordinates}
        incidents={incidentState.analysis?.mapIncidents ?? []}
        onIncidentSelect={selectIncident}
        onPointChange={chooseMapPoint}
        radiusMeters={atlasState.radiusMeters}
        selectedIncidentId={selectedIncidentId}
        theme={theme}
      />

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
        batch={incidentState.batch}
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
          <span>{toast}</span>
          <button aria-label="Dismiss message" onClick={() => setToast(null)} type="button">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      <SourceDialog activeProvider={provider?.meta ?? null} onClose={closeSources} open={sourcesOpen} />
    </main>
  );
}
