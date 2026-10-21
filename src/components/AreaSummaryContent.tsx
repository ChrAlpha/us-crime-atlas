import type { CSSProperties } from 'react';
import {
  formatMonth,
  relativeBand,
  SMALL_POPULATION,
  SUMMARY_MONTHS,
  type AgencySummary,
  type StateSummary,
  type TrendPercent,
} from '../domain/agencySummary';
import type { AreaSummary } from '../hooks/useAreaSummary';
import type { AgencySnapshot } from '../data/agencyStats.types';
import type { SelectedPlace } from '../types';
import { ExternalIcon, InfoIcon, LayersIcon, WarningIcon } from './Icons';

/** Months behind the snapshot's newest month before the panel calls the agency out. */
export const STALE_AGENCY_MONTHS = 3;

const BAND_LABELS = {
  lower: 'Below the state rate',
  similar: 'Similar to the state rate',
  elevated: 'Above the state rate',
  'markedly-elevated': 'Well above the state rate',
  insufficient: 'No rate comparison',
} as const;

function whole(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function times(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}×`;
}

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}

export function monthRangeLabel(startMonth: string, endMonth: string): string {
  return `${formatMonth(startMonth)} – ${formatMonth(endMonth)}`;
}

export function agencyHeadline(summary: AgencySummary): string {
  if (summary.relativeToState) {
    return `Violent offenses ${times(summary.relativeToState.violent)} the ${summary.stateName} rate`;
  }
  if (!summary.ratesPer100k) {
    return summary.match.agency.population > 0
      ? `${summary.reportedMonths} of ${SUMMARY_MONTHS} months reported — too few for a rate`
      : `${whole(summary.counts.violent)} violent offenses; the FBI lists no population for a rate`;
  }
  return `${whole(summary.ratesPer100k.violent)} violent offenses per 100,000 residents`;
}

function rateLine(rate: number | undefined, stateRate: number | undefined, stateName: string): string {
  if (rate === undefined) return 'No population-based rate';
  const state = stateRate === undefined ? '' : ` · ${stateName} ${whole(stateRate)}`;
  return `${whole(rate)} per 100k a year${state}`;
}

function trendLine(trend: TrendPercent | null): string {
  if (!trend) return 'Needs two complete 12-month windows';
  return `Violent ${signedPercent(trend.violent)} · property ${signedPercent(trend.property)}`;
}

function SourceCard({ snapshot, title, onOpenSources }: { snapshot: AgencySnapshot; title: string; onOpenSources(): void }) {
  return (
    <section className="source-card">
      <div>
        <h3>FBI Crime Data Explorer</h3>
        <p>{title}</p>
      </div>
      <a aria-label="Open the FBI Crime Data Explorer" href={snapshot.sourceUrl} rel="noreferrer" target="_blank">
        <ExternalIcon size={16} />
      </a>
      <dl>
        <div>
          <dt>Published cadence</dt>
          <dd>Monthly agency submissions</dd>
        </div>
        <div>
          <dt>Public precision</dt>
          <dd>Whole jurisdiction</dd>
        </div>
        <div>
          <dt>Explorer refreshed</dt>
          <dd>{snapshot.refreshed}</dd>
        </div>
        <div>
          <dt>Snapshot taken</dt>
          <dd>{snapshot.retrieved}</dd>
        </div>
      </dl>
      <button className="source-card__method" onClick={onOpenSources} type="button">
        <InfoIcon size={15} />
        Read source caveats and methodology
      </button>
    </section>
  );
}

function PrecisionNotice() {
  return (
    <div className="data-notice" data-testid="precision-notice">
      <InfoIcon size={16} />
      <span>
        <strong>Lower precision.</strong> No verified local incident feed covers this point yet, so the FBI's
        twelve-month totals for the whole jurisdiction stand in. They cannot tell one block from another, and the
        radius and window settings do not apply.
      </span>
    </div>
  );
}

function AgencyContent({ summary, snapshot, onOpenSources }: {
  summary: AgencySummary;
  snapshot: AgencySnapshot;
  onOpenSources(): void;
}) {
  const { match } = summary;
  const band = relativeBand(summary.relativeToState?.violent ?? null);
  const maxMonthly = Math.max(1, ...summary.monthly.map((month) => (month.violent ?? 0) + (month.property ?? 0)));
  const range = monthRangeLabel(summary.startMonth, summary.endMonth);

  return (
    <>
      <section className={`activity-band activity-band--${band}`} data-testid="jurisdiction-band">
        <div className="activity-band__status">
          <span className="activity-band__dot" aria-hidden="true" />
          <span>Jurisdiction summary</span>
          <span className="activity-band__classification">{BAND_LABELS[band]}</span>
        </div>
        <strong>{agencyHeadline(summary)}</strong>
        <p>
          {match.agency.name} reported these offenses across {match.areaName}, not just the selected area.
          {summary.relativeToState
            ? ` Property offenses ran ${times(summary.relativeToState.property)} the state rate.`
            : ''}
        </p>
        <div className="confidence-row">
          <span>Precision: <strong>whole jurisdiction</strong></span>
          <span>{summary.reportedMonths} of {SUMMARY_MONTHS} months reported</span>
          <span className="confidence-row__window" data-testid="jurisdiction-window">{range}</span>
        </div>
      </section>

      <PrecisionNotice />

      {match.placeWithoutAgency ? (
        <div className="data-notice" data-testid="place-without-agency">
          <InfoIcon size={16} />
          <span>
            <strong>No city agency matched.</strong> {match.placeWithoutAgency} has no FBI-reporting police agency of
            its own in this snapshot, so {match.agency.name}'s totals are shown. They may not include the city.
          </span>
        </div>
      ) : null}

      {summary.monthsBehind >= STALE_AGENCY_MONTHS ? (
        <div className="data-notice" data-testid="stale-agency-notice">
          <InfoIcon size={16} />
          <span>
            <strong>Agency is behind.</strong> {match.agency.name}'s newest FBI submission is for{' '}
            {formatMonth(summary.endMonth)}, {summary.monthsBehind} months before the newest month in the snapshot.
          </span>
        </div>
      ) : null}

      {summary.reportedMonths < SUMMARY_MONTHS ? (
        <div className="data-warning" data-testid="partial-months-warning">
          <WarningIcon />
          <span>
            Only {summary.reportedMonths} of the {SUMMARY_MONTHS} months were submitted; rates are annualized from
            those months and the trend is withheld.
          </span>
        </div>
      ) : null}

      {summary.smallPopulation ? (
        <div className="data-warning" data-testid="small-population-warning">
          <WarningIcon />
          <span>
            Fewer than {whole(SMALL_POPULATION)} residents: a handful of offenses moves this rate a long way.
          </span>
        </div>
      ) : null}

      <div className="metric-grid">
        <article>
          <span>Violent offenses</span>
          <strong data-testid="violent-count">{whole(summary.counts.violent)}</strong>
          <small>{rateLine(summary.ratesPer100k?.violent, summary.stateRatesPer100k?.violent, summary.stateName)}</small>
        </article>
        <article>
          <span>Property offenses</span>
          <strong>{whole(summary.counts.property)}</strong>
          <small>{rateLine(summary.ratesPer100k?.property, summary.stateRatesPer100k?.property, summary.stateName)}</small>
        </article>
        <article>
          <span>Previous 12 months</span>
          <strong>{summary.trendPercent ? signedPercent(summary.trendPercent.total) : '—'}</strong>
          <small>{trendLine(summary.trendPercent)}</small>
        </article>
        <article>
          <span>Residents served</span>
          <strong>{match.agency.population > 0 ? whole(match.agency.population) : '—'}</strong>
          <small>{match.agency.type} agency · FBI ORI {match.ori}</small>
        </article>
      </div>

      <section className="evidence-section">
        <div className="section-heading">
          <h3>Monthly offenses</h3>
          <span>Violent and property</span>
        </div>
        <div
          className="timeline"
          role="img"
          aria-label={`Monthly violent and property offense counts for ${match.agency.name}, ${range}.`}
        >
          {summary.monthly.map((month) => {
            const total = month.violent === null || month.property === null ? null : month.violent + month.property;
            const height = total === null ? 4 : Math.max(4, (total / maxMonthly) * 100);
            const style = { '--bar-height': `${height}%` } as CSSProperties;
            return (
              <span
                aria-hidden="true"
                className={`timeline__bar${total === null ? ' is-missing' : ''}`}
                key={month.month}
                style={style}
                title={`${formatMonth(month.month)}: ${total === null ? 'not reported' : total}`}
              />
            );
          })}
        </div>
      </section>

      <SourceCard onOpenSources={onOpenSources} snapshot={snapshot} title={match.agency.name} />
    </>
  );
}

function StateContent({ summary, snapshot, agencyName, onOpenSources }: {
  summary: StateSummary;
  snapshot: AgencySnapshot;
  agencyName: string | null;
  onOpenSources(): void;
}) {
  return (
    <>
      <section className="activity-band activity-band--insufficient" data-testid="state-band">
        <div className="activity-band__status">
          <span className="activity-band__dot" aria-hidden="true" />
          <span>Statewide context</span>
          <span className="activity-band__classification">No local totals</span>
        </div>
        <strong>
          {summary.ratesPer100k
            ? `${summary.stateName}: ${whole(summary.ratesPer100k.violent)} violent offenses per 100,000 residents`
            : `${summary.stateName}: no statewide rate`}
        </strong>
        <p>
          {agencyName
            ? `${agencyName} submitted no months to the FBI in this snapshot.`
            : 'No city, town or county agency in the FBI snapshot was matched to this point.'}{' '}
          Statewide rates are context only; they say nothing about this area.
        </p>
        <div className="confidence-row">
          <span>Precision: <strong>whole state</strong></span>
          <span className="confidence-row__window">{monthRangeLabel(summary.startMonth, summary.endMonth)}</span>
        </div>
      </section>

      <PrecisionNotice />

      <div className="metric-grid">
        <article>
          <span>Violent, {summary.stateName}</span>
          <strong>{summary.ratesPer100k ? whole(summary.ratesPer100k.violent) : '—'}</strong>
          <small>
            per 100k a year{summary.nationalRatesPer100k ? ` · US ${whole(summary.nationalRatesPer100k.violent)}` : ''}
          </small>
        </article>
        <article>
          <span>Property, {summary.stateName}</span>
          <strong>{summary.ratesPer100k ? whole(summary.ratesPer100k.property) : '—'}</strong>
          <small>
            per 100k a year{summary.nationalRatesPer100k ? ` · US ${whole(summary.nationalRatesPer100k.property)}` : ''}
          </small>
        </article>
      </div>

      <SourceCard onOpenSources={onOpenSources} snapshot={snapshot} title={`${summary.stateName} statewide rates`} />
    </>
  );
}

export function OutsideCoverageState({ place, onOpenSources }: { place: SelectedPlace; onOpenSources(): void }) {
  return (
    <div className="state-card" data-testid="outside-coverage">
      <LayersIcon />
      <div>
        <strong>Outside United States coverage</strong>
        <p>
          {place.label} is not inside a U.S. state or the District of Columbia according to Census TIGERweb, so there
          is no local incident feed or FBI jurisdiction to summarize.
        </p>
        <button onClick={onOpenSources} type="button">Review current coverage</button>
      </div>
    </div>
  );
}

export function AreaSummaryContent({ result, place, onOpenSources }: {
  result: AreaSummary;
  place: SelectedPlace;
  onOpenSources(): void;
}) {
  if (result.kind === 'outside') return <OutsideCoverageState onOpenSources={onOpenSources} place={place} />;
  return (
    <div className="evidence-content">
      {result.kind === 'agency'
        ? <AgencyContent onOpenSources={onOpenSources} snapshot={result.snapshot} summary={result.summary} />
        : (
            <StateContent
              agencyName={result.agencyName}
              onOpenSources={onOpenSources}
              snapshot={result.snapshot}
              summary={result.summary}
            />
          )}
    </div>
  );
}
