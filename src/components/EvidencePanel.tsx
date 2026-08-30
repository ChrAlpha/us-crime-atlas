import type { CSSProperties } from 'react';
import { BAND_COPY } from '../domain/analysis';
import { CATEGORY_LABELS } from '../domain/categories';
import { formatSourceTimestamp } from '../domain/time';
import type {
  AnalysisResult,
  Incident,
  IncidentBatch,
  IncidentProvider,
  SelectedPlace,
} from '../types';
import {
  ExternalIcon,
  InfoIcon,
  LayersIcon,
  RefreshIcon,
  WarningIcon,
} from './Icons';

interface EvidencePanelProps {
  place: SelectedPlace;
  provider: IncidentProvider | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  analysis: AnalysisResult | null;
  batch: IncidentBatch | null;
  error: string | null;
  radiusMeters: number;
  windowDays: number;
  selectedIncident: Incident | null;
  onIncidentSelect(incident: Incident): void;
  onRefresh(): void;
  onOpenSources(): void;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function radiusLabel(radiusMeters: number) {
  return radiusMeters < 1000 ? `${radiusMeters} m` : `${radiusMeters / 1000} km`;
}

function trendCopy(analysis: AnalysisResult) {
  if (analysis.trendDirection === 'none') return 'No reports in either equal window';
  if (analysis.trendDirection === 'new') return 'Previous equal window had no reports';
  if (analysis.trendDirection === 'flat') return 'Unchanged from previous equal window';
  const change = Math.abs(Math.round(analysis.trendPercent ?? 0));
  return `${change}% ${analysis.trendDirection === 'up' ? 'higher' : 'lower'} than previous equal window`;
}

function comparisonHeadline(analysis: AnalysisResult): string {
  return analysis.relativeActivity === null
    ? 'No stable nearby comparison'
    : `${analysis.relativeActivity.toFixed(2)}× nearby weighted report density`;
}

function comparisonRangeLabel(radiusMeters: number): string {
  if (radiusMeters % 1000 === 0) {
    return `${radiusMeters / 1000} to ${radiusMeters * 3 / 1000} km`;
  }
  return `${radiusLabel(radiusMeters)} to ${radiusLabel(radiusMeters * 3)}`;
}

function latestCopy(analysis: AnalysisResult) {
  return analysis.latestObservedAt ? formatSourceTimestamp(analysis.latestObservedAt) : 'No observation in window';
}

function LoadingState() {
  return (
    <div className="loading-stack" aria-live="polite" role="status">
      <span className="sr-only">Loading official incident records</span>
      <span className="skeleton skeleton--hero" />
      <div className="metric-grid">
        <span className="skeleton skeleton--metric" />
        <span className="skeleton skeleton--metric" />
      </div>
      <span className="skeleton skeleton--chart" />
    </div>
  );
}

function UnsupportedState({ place, onOpenSources }: { place: SelectedPlace; onOpenSources(): void }) {
  return (
    <div className="state-card">
      <LayersIcon />
      <div>
        <strong>No verified local incident feed</strong>
        <p>
          {place.label} is outside the first-release city coverage. The map remains available, but no national proxy,
          inferred score, or synthetic event is substituted.
        </p>
        <button onClick={onOpenSources} type="button">Review current coverage</button>
      </div>
    </div>
  );
}

function ErrorState({ error, onRefresh }: { error: string | null; onRefresh(): void }) {
  return (
    <div className="state-card state-card--error" role="alert">
      <WarningIcon />
      <div>
        <strong>Official data could not be loaded</strong>
        <p>{error || 'The official publisher did not return a usable response.'}</p>
        <button onClick={onRefresh} type="button">Try again</button>
      </div>
    </div>
  );
}

function AnalysisContent({
  analysis,
  batch,
  provider,
  radiusMeters,
  windowDays,
  selectedIncident,
  onIncidentSelect,
  onOpenSources,
}: {
  analysis: AnalysisResult;
  batch: IncidentBatch;
  provider: IncidentProvider;
  radiusMeters: number;
  windowDays: number;
  selectedIncident: Incident | null;
  onIncidentSelect(incident: Incident): void;
  onOpenSources(): void;
}) {
  const band = BAND_COPY[analysis.band];
  const maxDaily = Math.max(1, ...analysis.dailyActivity.map((day) => day.count));
  const observationCount = analysis.currentCount + analysis.nearbyCurrentIncidents.length;

  return (
    <>
      <section className={`activity-band activity-band--${analysis.band}`} data-testid="activity-band">
        <div className="activity-band__status">
          <span className="activity-band__dot" aria-hidden="true" />
          <span>Local comparison</span>
          <span className="activity-band__classification">{band.label}</span>
        </div>
        <strong>{comparisonHeadline(analysis)}</strong>
        <p>{band.detail} This describes published reporting activity, not a safety grade.</p>
        <div className="confidence-row">
          <span>Confidence: <strong>{analysis.confidence}</strong> · {observationCount} observations</span>
          <span>
            {radiusLabel(radiusMeters)} circle · {comparisonRangeLabel(radiusMeters)} nearby · {windowDays} days
          </span>
        </div>
      </section>

      {batch.truncated ? (
        <div className="data-warning">
          <WarningIcon />
          <span>
            The query reached the publisher limit of {batch.queryLimit.toLocaleString()} records. Counts may be
            incomplete and evidence confidence has been reduced.
          </span>
        </div>
      ) : null}

      <div className="metric-grid">
        <article>
          <span>Reported incidents</span>
          <strong data-testid="reported-count">{analysis.currentCount}</strong>
          <small>{trendCopy(analysis)}</small>
        </article>
        <article>
          <span>Violent reports</span>
          <strong>{analysis.violentCount}</strong>
          <small>{percent(analysis.violentShare)} of selected-area reports</small>
        </article>
        <article>
          <span>Nighttime reports</span>
          <strong>{analysis.nightCount}</strong>
          <small>{percent(analysis.nightShare)} occurred 10 PM–4:59 AM</small>
        </article>
        <article>
          <span>Nearby comparator</span>
          <strong>{analysis.nearbyCurrentIncidents.length}</strong>
          <small>Between {radiusLabel(radiusMeters)} and {radiusLabel(radiusMeters * 3)}</small>
        </article>
      </div>

      {selectedIncident ? (
        <section className="selected-incident" aria-live="polite">
          <span className={`category-dot category-dot--${selectedIncident.category}`} aria-hidden="true" />
          <div>
            <h3>{CATEGORY_LABELS[selectedIncident.category]} · {selectedIncident.rawCategory}</h3>
            <p>{selectedIncident.description}</p>
            <small>
              {formatSourceTimestamp(selectedIncident.occurredAt)} · {selectedIncident.locationLabel}. Public point
              precision: {selectedIncident.precision}.
            </small>
          </div>
        </section>
      ) : null}

      <section className="evidence-section">
        <div className="section-heading">
          <h3>Most recent selected-area reports</h3>
          <span>{analysis.currentCount} total</span>
        </div>
        {analysis.currentIncidents.length > 0 ? (
          <div className="incident-list">
            {analysis.currentIncidents.slice(0, 8).map((incident) => (
              <button key={incident.id} onClick={() => onIncidentSelect(incident)} type="button">
                <span className={`category-dot category-dot--${incident.category}`} aria-hidden="true" />
                <span>
                  <strong>{CATEGORY_LABELS[incident.category]} · {incident.rawCategory}</strong>
                  <small>{incident.locationLabel}</small>
                </span>
                <time dateTime={incident.occurredAt}>{formatSourceTimestamp(incident.occurredAt).split(' · ')[0]}</time>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-copy">
            No reports in the selected radius match the active categories and {windowDays}-day window.
          </p>
        )}
      </section>

      <section className="evidence-section">
        <div className="section-heading">
          <h3>Recent rhythm</h3>
          <span>Last {analysis.dailyActivity.length} days</span>
        </div>
        <div
          className="timeline"
          role="img"
          aria-label={`Daily report count timeline for the last ${analysis.dailyActivity.length} days. ${analysis.currentCount} reports total.`}
        >
          {analysis.dailyActivity.map((day) => {
            const height = Math.max(4, (day.count / maxDaily) * 100);
            const style = { '--bar-height': `${height}%` } as CSSProperties;
            return (
              <span
                aria-hidden="true"
                className="timeline__bar"
                key={day.date}
                style={style}
                title={`${day.date}: ${day.count}`}
              />
            );
          })}
        </div>
      </section>

      <section className="evidence-section">
        <div className="section-heading">
          <h3>Category composition</h3>
          <span>Raw report count</span>
        </div>
        {analysis.categoryBreakdown.length > 0 ? (
          <div className="category-list">
            {analysis.categoryBreakdown.map((item) => (
              <div key={item.category}>
                <span className={`category-dot category-dot--${item.category}`} aria-hidden="true" />
                <span>{CATEGORY_LABELS[item.category]}</span>
                <span className="category-meter" aria-hidden="true">
                  <i style={{ width: `${Math.max(5, item.share * 100)}%` }} />
                </span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-copy">No selected categories were observed in this radius and date window.</p>
        )}
      </section>

      <section className="source-card">
        <div>
          <h3>{provider.meta.datasetName}</h3>
          <p>{provider.meta.agency}</p>
        </div>
        <a aria-label={`Open official ${provider.meta.datasetName} source`} href={provider.meta.sourceUrl} rel="noreferrer" target="_blank">
          <ExternalIcon size={16} />
        </a>
        <dl>
          <div>
            <dt>Published cadence</dt>
            <dd>{provider.meta.cadence}</dd>
          </div>
          <div>
            <dt>Public precision</dt>
            <dd>{provider.meta.precision}</dd>
          </div>
          <div>
            <dt>Latest observed</dt>
            <dd>{latestCopy(analysis)}</dd>
          </div>
        </dl>
        <button className="source-card__method" onClick={onOpenSources} type="button">
          <InfoIcon size={15} />
          Read source caveats and methodology
        </button>
      </section>
    </>
  );
}

export function EvidencePanel({
  place,
  provider,
  status,
  analysis,
  batch,
  error,
  radiusMeters,
  windowDays,
  selectedIncident,
  onIncidentSelect,
  onRefresh,
  onOpenSources,
}: EvidencePanelProps) {
  let body = null;
  if (!provider) {
    body = <UnsupportedState onOpenSources={onOpenSources} place={place} />;
  } else if (status === 'error') {
    body = <ErrorState error={error} onRefresh={onRefresh} />;
  } else if (!analysis || !batch) {
    body = <LoadingState />;
  } else {
    body = (
      <div className="evidence-content">
        {status === 'loading' ? <div className="updating-badge" role="status">Refreshing official records…</div> : null}
        <AnalysisContent
          analysis={analysis}
          batch={batch}
          onIncidentSelect={onIncidentSelect}
          onOpenSources={onOpenSources}
          provider={provider}
          radiusMeters={radiusMeters}
          selectedIncident={selectedIncident}
          windowDays={windowDays}
        />
      </div>
    );
  }

  return (
    <aside
      className="evidence-panel glass-panel"
      data-testid="evidence-panel"
      aria-label="Observed incident evidence"
    >
      <header className="evidence-header">
        <div>
          <span className="eyebrow">Observed evidence</span>
          <h2 title={place.label}>{place.label}</h2>
          <p>{radiusLabel(radiusMeters)} · last {windowDays} days · published incidents</p>
        </div>
        {provider ? (
          <button
            aria-label="Refresh official incident data"
            className="icon-button"
            disabled={status === 'loading'}
            onClick={onRefresh}
            title="Refresh official incident data"
            type="button"
          >
            <RefreshIcon className={status === 'loading' ? 'is-spinning' : undefined} size={17} />
          </button>
        ) : null}
      </header>
      {body}
    </aside>
  );
}
