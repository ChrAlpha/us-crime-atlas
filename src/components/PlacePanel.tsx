import { useEffect, useRef, type KeyboardEvent } from 'react';
import { isDelayedFeed, publicationLagDays } from '../domain/evidenceWindow';
import { dayCount, formatCount, windowRangeLabel } from '../domain/presentation';
import { nextSnap, useSheet, type SheetSnap } from '../hooks/useSheet';
import type {
  AnalysisResult,
  EvidenceBundle,
  Incident,
  IncidentProvider,
  LoadStatus,
  SelectedPlace,
} from '../types';
import { ClockIcon } from './Icons';
import type { ReportLocation } from './mapLayers';
import { AboutTab, type ThemePreference } from './panel/AboutTab';
import { Finding } from './panel/Finding';
import { OverviewTab } from './panel/OverviewTab';
import { ReportsTab } from './panel/ReportsTab';
import { SelectedReports } from './panel/SelectedReports';
import { ErrorSummary, LoadingSummary, NoFeedSummary, NoRecordsSummary } from './panel/States';

export type PanelTab = 'overview' | 'reports' | 'about';

export interface PanelSelection {
  location: ReportLocation;
  incidentId: string | null;
  /** Map picks open a card at the top; list picks expand in place. */
  origin: 'map' | 'list';
}

export interface PlacePanelProps {
  compact: boolean;
  place: SelectedPlace;
  provider: IncidentProvider | null;
  status: LoadStatus;
  analysis: AnalysisResult | null;
  evidence: EvidenceBundle | null;
  error: string | null;
  radiusMeters: number;
  tab: PanelTab;
  snap: SheetSnap;
  selection: PanelSelection | null;
  themePreference: ThemePreference;
  onTabChange(tab: PanelTab): void;
  onSnapChange(snap: SheetSnap): void;
  onVisibleHeightChange(height: number): void;
  onReportSelect(incident: Incident): void;
  onFocusIncident(incident: Incident): void;
  onClearSelection(): void;
  onRefresh(): void;
  onPlaceSelect(place: SelectedPlace): void;
  onThemePreferenceChange(value: ThemePreference): void;
}

const TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'reports', label: 'Reports' },
  { id: 'about', label: 'About the data' },
];

const SNAP_ACTIONS: Record<SheetSnap, string> = {
  peek: 'Show more of the evidence panel',
  half: 'Expand the evidence panel',
  full: 'Collapse the evidence panel',
};

function SourceLine({
  provider,
  status,
  evidence,
}: {
  provider: IncidentProvider | null;
  status: LoadStatus;
  evidence: EvidenceBundle | null;
}) {
  if (!provider) return <p className="place__source">Map only · no verified incident feed</p>;
  const records = `${provider.meta.city} police records`;
  if (status === 'error') return <p className="place__source">{records} · unavailable</p>;
  const window = evidence?.window;
  if (!window || window.latestRecordEpochMs === null) {
    return <p className="place__source">{records}{status === 'loading' ? ' · checking the feed…' : ''}</p>;
  }
  return (
    <p className="place__source">
      <span>{records} · {windowRangeLabel(window)}</span>
      {isDelayedFeed(window) ? (
        <span className="tag" data-testid="delayed-feed-tag">
          <ClockIcon size={14} />
          {dayCount(publicationLagDays(window))} behind
        </span>
      ) : null}
    </p>
  );
}

function Tabs({
  tab,
  reportCount,
  onChange,
}: {
  tab: PanelTab;
  reportCount: string;
  onChange(tab: PanelTab): void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next]!.id;
    onChange(target);
    event.currentTarget.querySelector<HTMLButtonElement>(`#tab-${target}`)?.focus();
  };
  return (
    <div aria-label="Evidence views" className="tabs" onKeyDown={move} role="tablist">
      {TABS.map((item) => (
        <button
          aria-controls="panel-view"
          aria-selected={tab === item.id}
          className="tabs__tab"
          id={`tab-${item.id}`}
          key={item.id}
          onClick={() => onChange(item.id)}
          role="tab"
          tabIndex={tab === item.id ? 0 : -1}
          type="button"
        >
          {item.label}
          {item.id === 'reports' ? <span className="tabs__count">{reportCount}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PlacePanel(props: PlacePanelProps) {
  const {
    compact,
    place,
    provider,
    status,
    analysis,
    evidence,
    error,
    radiusMeters,
    tab,
    snap,
    selection,
    onTabChange,
    onSnapChange,
    onVisibleHeightChange,
  } = props;
  const sheetRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const sheet = useSheet({
    enabled: compact,
    snap,
    sheetRef,
    scrollRef,
    summaryRef,
    onSnapChange,
    onVisibleHeightChange,
  });

  const hasRecords = evidence !== null && evidence.window.latestRecordEpochMs !== null;
  const ready = Boolean(provider && status !== 'error' && analysis && evidence && hasRecords);

  // A location picked on the map is shown from the top of the panel.
  const selectionKey = selection?.origin === 'map' ? `${selection.location.key}:${selection.incidentId ?? ''}` : null;
  useEffect(() => {
    if (selectionKey && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selectionKey]);

  let summary = null;
  if (!provider) summary = <NoFeedSummary place={place} />;
  else if (status === 'error') summary = <ErrorSummary error={error} onRefresh={props.onRefresh} provider={provider} />;
  else if (!analysis || !evidence) summary = <LoadingSummary provider={provider} />;
  else if (!hasRecords) summary = <NoRecordsSummary evidence={evidence} />;
  else summary = <Finding analysis={analysis} evidence={evidence} radiusMeters={radiusMeters} />;

  const about = (
    <AboutTab
      evidence={evidence}
      onPlaceSelect={props.onPlaceSelect}
      onRefresh={props.onRefresh}
      onThemePreferenceChange={props.onThemePreferenceChange}
      provider={provider?.meta ?? null}
      status={status}
      themePreference={props.themePreference}
    />
  );

  let view = null;
  if (ready && analysis && evidence) {
    if (tab === 'overview') view = <OverviewTab analysis={analysis} evidence={evidence} />;
    else if (tab === 'reports') {
      view = (
        <ReportsTab
          analysis={analysis}
          expandedId={selection?.origin === 'list' ? selection.incidentId : null}
          onSelect={props.onReportSelect}
          precisionNote={provider?.meta.precisionNote ?? ''}
          radiusMeters={radiusMeters}
        />
      );
    } else view = about;
  }

  const classes = ['panel'];
  if (compact) classes.push('panel--sheet', `is-${snap}`);
  if (sheet.dragging) classes.push('is-dragging');

  return (
    <section
      aria-label={`Evidence for ${place.label}`}
      className={classes.join(' ')}
      data-testid="evidence-panel"
      ref={sheetRef}
      style={sheet.style}
    >
      <div className="panel__scroll" ref={scrollRef}>
        {compact ? (
          <button
            aria-expanded={snap !== 'peek'}
            aria-label={SNAP_ACTIONS[snap]}
            className="sheet__handle"
            onClick={() => {
              if (!sheet.consumeDragClick()) onSnapChange(nextSnap(snap));
            }}
            type="button"
            {...sheet.bind}
          >
            <span />
          </button>
        ) : null}

        <div className="panel__summary" ref={summaryRef}>
          <header className="place" {...(compact ? sheet.bind : {})}>
            <h1 title={place.label}>{place.label}</h1>
            <p className="place__detail">{place.detail || 'Dropped pin'}</p>
            <SourceLine evidence={evidence} provider={provider} status={status} />
          </header>
          {summary}
        </div>

        {status === 'loading' && analysis ? (
          <div className="panel__progress" role="status">
            <span className="sr-only">Updating official records</span>
          </div>
        ) : null}

        {selection?.origin === 'map' && provider ? (
          <SelectedReports
            incidentId={selection.incidentId}
            location={selection.location}
            onClose={props.onClearSelection}
            onFocusIncident={props.onFocusIncident}
            precisionNote={provider.meta.precisionNote}
          />
        ) : null}

        {ready && analysis ? (
          <>
            <Tabs
              onChange={onTabChange}
              reportCount={formatCount(analysis.currentCount, analysis.currentCountIsLowerBound)}
              tab={tab}
            />
            <div aria-labelledby={`tab-${tab}`} className="panel__view" id="panel-view" role="tabpanel">
              {view}
            </div>
          </>
        ) : (
          <div className="panel__view">{about}</div>
        )}
      </div>
    </section>
  );
}
