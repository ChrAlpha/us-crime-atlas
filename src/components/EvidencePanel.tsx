import type { CSSProperties } from 'react';
import { LATEST_RECORD_LOOKBACK_DAYS } from '../data/providers/shared';
import { BAND_COPY, COMPARISON_RADIUS_MULTIPLIER, isTruncated } from '../domain/analysis';
import { CATEGORY_LABELS } from '../domain/categories';
import {
  currentWindowPredatesDataset,
  isDelayedFeed,
  lastDayOfWindow,
  publicationLagDays,
} from '../domain/evidenceWindow';
import { formatDay, formatDayRange, formatSourceTimestamp } from '../domain/time';
import type {
  AnalysisResult,
  AreaCoverage,
  EvidenceBundle,
  EvidenceTruncation,
  EvidenceWindow,
  Incident,
  IncidentProvider,
  LoadStatus,
  SelectedPlace,
  UnavailableReason,
} from '../types';
import type { AreaSummaryState } from '../hooks/useAreaSummary';
import { AreaSummaryContent } from './AreaSummaryContent';
import {
  ExternalIcon,
  InfoIcon,
  RefreshIcon,
  WarningIcon,
} from './Icons';

export interface EvidencePanelProps {
  place: SelectedPlace;
  provider: IncidentProvider | null;
  /** FBI jurisdiction totals, used wherever no local incident feed covers the place. */
  areaSummary: AreaSummaryState;
  status: LoadStatus;
  analysis: AnalysisResult | null;
  evidence: EvidenceBundle | null;
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

function dayCount(days: number) {
  return days === 1 ? '1 day' : `${days} days`;
}

/** Counts from a query that hit its record budget are shown as lower bounds. */
function countLabel(count: number, lowerBound: boolean) {
  return lowerBound ? `${count}+` : String(count);
}

function trendCopy(analysis: AnalysisResult, window: EvidenceWindow) {
  if (analysis.trendDirection === 'unavailable') {
    if (analysis.trendUnavailableReason === 'dataset-start') {
      const start = window.datasetStartEpochMs === null ? '' : ` (starts ${formatDay(window.datasetStartEpochMs)})`;
      return `No trend: the previous equal window predates this dataset${start}`;
    }
    return 'No trend: a window reached the record limit';
  }
  if (analysis.trendDirection === 'none') return 'No reports in either equal window';
  if (analysis.trendDirection === 'new') return 'Previous equal window had no reports';
  if (analysis.trendDirection === 'flat') return 'Unchanged from previous equal window';
  const change = Math.abs(Math.round(analysis.trendPercent ?? 0));
  if (change === 0) return 'Within 1% of previous equal window';
  return `${change}% ${analysis.trendDirection === 'up' ? 'higher' : 'lower'} than previous equal window`;
}

function comparisonHeadline(analysis: AnalysisResult): string {
  if (analysis.comparisonUnavailableReason) return 'Nearby comparison unavailable';
  return analysis.relativeActivity === null
    ? 'No stable nearby comparison'
    : `${analysis.relativeActivity.toFixed(2)}× nearby weighted report density`;
}

const COMPARISON_UNAVAILABLE_DETAIL: Record<UnavailableReason, string> = {
  'record-limit': 'The nearby area has more reports than one query can return, so its density would be understated.',
  'dataset-start': 'The dataset does not cover the whole window, so the densities would not be comparable.',
  jurisdiction: 'Too little of the selected circle or nearby area lies inside city limits for a stable comparison.',
};

/** Below this covered share of either area, the panel says how much lies outside city limits. */
const AREA_NOTICE_SHARE = 0.95;

export function areaCoverageCopy(coverage: AreaCoverage, city: string): string | null {
  const outsideSelected = Math.round((1 - coverage.selected) * 100);
  const outsideNearby = Math.round((1 - coverage.nearby) * 100);
  if (coverage.selected >= AREA_NOTICE_SHARE && coverage.nearby >= AREA_NOTICE_SHARE) return null;
  const parts = [
    outsideSelected > 0 ? `${outsideSelected}% of the selected circle` : null,
    outsideNearby > 0 ? `${outsideNearby}% of the nearby area` : null,
  ].filter(Boolean);
  return `${parts.join(' and ')} ${parts.length > 1 ? 'lie' : 'lies'} outside ${city} limits, where this feed has `
    + 'no records. Densities use only the area inside the city.';
}

export function truncationCopy(truncation: EvidenceTruncation, recordLimit: number): string {
  const limit = `${recordLimit.toLocaleString('en-US')}-record limit`;
  if (truncation.selectedCurrent || truncation.selectedPrevious) {
    return `A selected-area query reached the ${limit}. Counts are lower bounds, the trend is withheld and `
      + 'evidence confidence has been reduced. A smaller radius or shorter window avoids this.';
  }
  return `The nearby comparison query reached the ${limit}, so the nearby comparison is withheld. `
    + 'Selected-area counts are complete. A smaller radius or shorter window avoids this.';
}

function comparisonRangeLabel(radiusMeters: number): string {
  const outer = radiusMeters * COMPARISON_RADIUS_MULTIPLIER;
  if (radiusMeters % 1000 === 0) return `${radiusMeters / 1000} to ${outer / 1000} km`;
  return `${radiusLabel(radiusMeters)} to ${radiusLabel(outer)}`;
}

export function windowRangeLabel(window: EvidenceWindow): string {
  return formatDayRange(window.currentStartEpochMs, lastDayOfWindow(window));
}

export function settlingCopy(window: EvidenceWindow): string | null {
  if (window.settlingDays === 0 || window.latestRecordEpochMs === null) return null;
  return `Newest ${dayCount(window.settlingDays)} excluded while still being filled in`;
}

function latestCopy(analysis: AnalysisResult) {
  return analysis.latestObservedAt ? formatSourceTimestamp(analysis.latestObservedAt) : 'No observation in window';
}

export function delayedFeedCopy(window: EvidenceWindow, cadence: string): string {
  if (window.latestRecordEpochMs === null) {
    return `No records were published in the last ${LATEST_RECORD_LOOKBACK_DAYS} days. ${cadence}.`;
  }
  const newest = formatDay(window.latestRecordEpochMs);
  const end = formatDay(lastDayOfWindow(window));
  const filling = window.settlingDays === 1 ? 'newest day is' : `newest ${window.settlingDays} days are`;
  const settling = window.settlingDays > 0
    ? ` The ${filling} still being filled in, so the window ends ${end}.`
    : ` The window ends ${end}.`;
  return `The newest published record is from ${newest}. ${cadence}.${settling} `
    + 'Unpublished days are never counted as quiet days.';
}

function DelayedFeedNotice({ window, provider }: { window: EvidenceWindow; provider: IncidentProvider }) {
  return (
    <div className="data-notice" data-testid="delayed-feed-notice">
      <InfoIcon size={16} />
      <span>
        <strong>Feed is {dayCount(publicationLagDays(window))} behind.</strong>{' '}
        {delayedFeedCopy(window, provider.meta.cadence)}
      </span>
    </div>
  );
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

function DatasetStartNotice({ window }: { window: EvidenceWindow }) {
  if (window.datasetStartEpochMs === null || !currentWindowPredatesDataset(window)) return null;
  return (
    <div className="data-notice" data-testid="dataset-start-notice">
      <InfoIcon size={16} />
      <span>
        <strong>Partial window.</strong> This dataset starts {formatDay(window.datasetStartEpochMs)}, so earlier days
        of the window have no published records and are not counted as quiet days.
      </span>
    </div>
  );
}

function AreaCoverageNotice({ coverage, city }: { coverage: AreaCoverage; city: string }) {
  const copy = areaCoverageCopy(coverage, city);
  if (!copy) return null;
  return (
    <div className="data-notice" data-testid="area-coverage-notice">
      <InfoIcon size={16} />
      <span>
        <strong>Partly outside city limits.</strong> {copy}
      </span>
    </div>
  );
}

function NoRecordsState({ evidence, onOpenSources }: { evidence: EvidenceBundle; onOpenSources(): void }) {
  return (
    <div className="state-card" data-testid="no-records-state">
      <InfoIcon />
      <div>
        <strong>No recent records from {evidence.provider.agency}</strong>
        <p>
          {delayedFeedCopy(evidence.window, evidence.provider.cadence)} Without published records there is nothing to
          count or compare, so no figures are shown.
        </p>
        <button onClick={onOpenSources} type="button">Review source status</button>
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
  evidence,
  newestRecordEpochMs,
  provider,
  radiusMeters,
  windowDays,
  selectedIncident,
  onIncidentSelect,
  onOpenSources,
}: {
  analysis: AnalysisResult;
  evidence: EvidenceBundle;
  newestRecordEpochMs: number;
  provider: IncidentProvider;
  radiusMeters: number;
  windowDays: number;
  selectedIncident: Incident | null;
  onIncidentSelect(incident: Incident): void;
  onOpenSources(): void;
}) {
  const band = analysis.comparisonUnavailableReason
    ? { label: 'Comparison withheld', detail: COMPARISON_UNAVAILABLE_DETAIL[analysis.comparisonUnavailableReason] }
    : BAND_COPY[analysis.band];
  const settling = settlingCopy(evidence.window);
  const maxDaily = Math.max(1, ...analysis.dailyActivity.map((day) => day.count));
  const nearbyIsLowerBound = evidence.truncation.comparison;
  const observationCount = countLabel(
    analysis.currentCount + analysis.nearbyCurrentIncidents.length,
    analysis.currentCountIsLowerBound || nearbyIsLowerBound,
  );
  const currentCount = countLabel(analysis.currentCount, analysis.currentCountIsLowerBound);

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
          <span className="confidence-row__window" data-testid="evidence-window">
            {windowRangeLabel(evidence.window)}
            {settling ? ` · ${settling}` : ''}
          </span>
        </div>
      </section>

      {isDelayedFeed(evidence.window) ? <DelayedFeedNotice provider={provider} window={evidence.window} /> : null}

      <DatasetStartNotice window={evidence.window} />

      <AreaCoverageNotice city={provider.meta.city} coverage={evidence.areaCoverage} />

      {isTruncated(evidence.truncation) ? (
        <div className="data-warning" data-testid="truncation-warning">
          <WarningIcon />
          <span>{truncationCopy(evidence.truncation, evidence.recordLimit)}</span>
        </div>
      ) : null}

      <div className="metric-grid">
        <article>
          <span>Reported incidents</span>
          <strong data-testid="reported-count">{currentCount}</strong>
          <small>{trendCopy(analysis, evidence.window)}</small>
        </article>
        <article>
          <span>Violent reports</span>
          <strong>{analysis.violentCount}</strong>
          <small>{percent(analysis.violentShare)} of selected-area reports</small>
        </article>
        <article>
          <span>Nighttime reports</span>
          <strong>{analysis.nightCount}</strong>
          <small>
            {percent(analysis.nightShare)} occurred 10 PM–4:59 AM
            {analysis.untimedCount > 0 ? ` · ${analysis.untimedCount} without a published time` : ''}
          </small>
        </article>
        <article>
          <span>Nearby comparator</span>
          <strong>{countLabel(analysis.nearbyCurrentIncidents.length, nearbyIsLowerBound)}</strong>
          <small>Between {radiusLabel(radiusMeters)} and {radiusLabel(radiusMeters * COMPARISON_RADIUS_MULTIPLIER)}</small>
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
          <span>{currentCount} total</span>
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
            No reports in the selected radius match the active categories between{' '}
            {windowRangeLabel(evidence.window)}.
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
          aria-label={`Daily report count timeline for the last ${analysis.dailyActivity.length} days. ${currentCount} reports total.`}
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
            <dt>Newest in feed</dt>
            <dd>{formatDay(newestRecordEpochMs)}</dd>
          </div>
          <div>
            <dt>Latest here</dt>
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
  areaSummary,
  status,
  analysis,
  evidence,
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
    if (areaSummary.status === 'error') body = <ErrorState error={areaSummary.error} onRefresh={areaSummary.refresh} />;
    else if (areaSummary.result) body = <AreaSummaryContent onOpenSources={onOpenSources} place={place} result={areaSummary.result} />;
    else body = <LoadingState />;
  } else if (status === 'error') {
    body = <ErrorState error={error} onRefresh={onRefresh} />;
  } else if (!analysis || !evidence) {
    body = <LoadingState />;
  } else if (evidence.window.latestRecordEpochMs === null) {
    body = <NoRecordsState evidence={evidence} onOpenSources={onOpenSources} />;
  } else {
    body = (
      <div className="evidence-content">
        {status === 'loading' ? <div className="updating-badge" role="status">Refreshing official records…</div> : null}
        <AnalysisContent
          analysis={analysis}
          evidence={evidence}
          newestRecordEpochMs={evidence.window.latestRecordEpochMs}
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
  const hasRecords = evidence !== null && evidence.window.latestRecordEpochMs !== null;
  const compact = provider
    ? status === 'error' || (evidence !== null && !hasRecords)
    : areaSummary.status === 'error' || areaSummary.result?.kind === 'outside';

  return (
    <aside
      className={`evidence-panel glass-panel${compact ? ' evidence-panel--compact' : ''}`}
      data-testid="evidence-panel"
      aria-label="Observed incident evidence"
    >
      <header className="evidence-header">
        <div>
          <span className="eyebrow">Observed evidence</span>
          <h2 title={place.label}>{place.label}</h2>
          {provider ? (
            <p>
              {radiusLabel(radiusMeters)} · {windowDays} days
              {evidence && hasRecords && status !== 'error' ? ` ending ${formatDay(lastDayOfWindow(evidence.window))}` : ''} · published
              incidents
            </p>
          ) : (
            <p>Jurisdiction totals · 12 months · FBI Crime Data Explorer</p>
          )}
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
