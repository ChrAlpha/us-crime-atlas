import { formatMonth, SUMMARY_MONTHS, type AgencySummary } from '../../domain/agencySummary';
import {
  agencyFinding,
  areaLabel,
  agencyMethodLine,
  agencyNotes,
  agencyTrendCopy,
  monthRangeLabel,
  rateLine,
  stateFinding,
  wholeNumber,
} from '../../domain/agencyPresentation';
import type { AreaSummary } from '../../hooks/useAreaSummary';
import type { SelectedPlace } from '../../types';
import { ExternalIcon, InfoIcon } from '../Icons';
import { BarChart } from './BarChart';
import { ComparisonScale, DataNotes } from './Finding';

type CoveredSummary = Exclude<AreaSummary, { kind: 'outside' }>;

const offenses = (count: number) => (count === 1 ? '1 offense' : `${wholeNumber(count)} offenses`);

function AgencyFinding({ summary }: { summary: AgencySummary }) {
  const result = agencyFinding(summary);
  return (
    <section aria-labelledby="finding-headline" className="finding" data-testid="jurisdiction-finding">
      <h2 className="finding__headline" data-peek-end id="finding-headline">{result.headline}</h2>
      {result.reason ? <p className="finding__reason">{result.reason}</p> : null}
      {result.ratio !== null ? (
        <ComparisonScale band={result.band} ratio={result.ratio} reference={`the ${summary.stateName} rate`} />
      ) : null}
      <p className="finding__method" data-testid="jurisdiction-window">{agencyMethodLine(summary)}</p>
      <DataNotes notes={agencyNotes(summary)} />
    </section>
  );
}

function StateFinding({ result }: { result: Extract<AreaSummary, { kind: 'state' }> }) {
  const copy = stateFinding(result.summary, result.agencyName);
  return (
    <section aria-labelledby="finding-headline" className="finding" data-testid="state-finding">
      <h2 className="finding__headline finding__headline--quiet" data-peek-end id="finding-headline">{copy.headline}</h2>
      <p className="finding__reason">{copy.reason}</p>
      <p className="finding__context">{copy.context}</p>
      <p className="finding__method">
        FBI statewide rates, {monthRangeLabel(result.summary.startMonth, result.summary.endMonth)}. Not a safety rating.
      </p>
    </section>
  );
}

export function OutsideSummary({ place }: { place: SelectedPlace }) {
  return (
    <div className="state" data-testid="outside-coverage">
      <InfoIcon className="state__icon" size={20} />
      <div>
        <h2 data-peek-end>Outside US coverage</h2>
        <p>
          {place.label} is not inside a US state or the District of Columbia, according to Census TIGERweb, so there
          is no police feed or FBI agency to summarize. The map still works.
        </p>
      </div>
    </div>
  );
}

/** The answer at the top of the panel wherever FBI totals stand in for a local feed. */
export function JurisdictionSummary({ result, place }: { result: AreaSummary; place: SelectedPlace }) {
  if (result.kind === 'outside') return <OutsideSummary place={place} />;
  if (result.kind === 'state') return <StateFinding result={result} />;
  return <AgencyFinding summary={result.summary} />;
}

/** Overview tab: the agency's twelve-month counts, rates, trend, and monthly totals. */
export function JurisdictionOverview({ summary }: { summary: AgencySummary }) {
  const totals = summary.monthly.map((month) => (
    month.violent === null || month.property === null ? null : month.violent + month.property
  ));
  const labels = summary.monthly.map((month) => formatMonth(month.month));
  const peak = totals.reduce<number>((best, value, index) => ((value ?? -1) > (totals[best] ?? -1) ? index : best), 0);
  const last = labels.length - 1;
  const range = monthRangeLabel(summary.startMonth, summary.endMonth);

  return (
    <>
      <dl className="facts">
        <div className="fact">
          <dt>Violent</dt>
          <dd>
            <strong data-testid="violent-count">{wholeNumber(summary.counts.violent)}</strong>
            <span>{rateLine(summary.ratesPer100k?.violent, summary.stateRatesPer100k?.violent, summary.stateName)}</span>
          </dd>
        </div>
        <div className="fact">
          <dt>Property</dt>
          <dd>
            <strong>{wholeNumber(summary.counts.property)}</strong>
            <span>{rateLine(summary.ratesPer100k?.property, summary.stateRatesPer100k?.property, summary.stateName)}</span>
          </dd>
        </div>
        <div className="fact">
          <dt>Year over year</dt>
          <dd>
            <strong>
              {summary.trendPercent ? `${summary.trendPercent.total > 0 ? '+' : ''}${Math.round(summary.trendPercent.total)}%` : '–'}
            </strong>
            <span data-testid="jurisdiction-trend">{agencyTrendCopy(summary.trendPercent)}</span>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="months-title" className="section">
        <div className="section__head">
          <h3 id="months-title">Month by month</h3>
        </div>
        <h4 className="section__subhead">Violent and property offenses <span>across all of {areaLabel(summary.match.areaName)}</span></h4>
        <BarChart
          idleReadout={`Busiest month: ${labels[peak]}, ${offenses(totals[peak] ?? 0)}`}
          labels={labels}
          summary={`Monthly violent and property offenses for ${summary.match.agency.name}, ${range}. `
            + `Busiest month ${labels[peak]} with ${offenses(totals[peak] ?? 0)}.`}
          ticks={[{ index: 0, label: labels[0]! }, { index: last, label: labels[last]! }]}
          unit={offenses}
          values={totals}
        />
        {totals.includes(null) ? (
          <p className="section__aside">Hollow bars mark months the agency did not send to the FBI.</p>
        ) : null}
      </section>
    </>
  );
}

/** About tab: where the FBI figures come from and what they describe. */
export function JurisdictionSource({ result }: { result: CoveredSummary }) {
  const { snapshot } = result;
  const agency = result.kind === 'agency' ? result.summary.match : null;
  const range = monthRangeLabel(result.summary.startMonth, result.summary.endMonth);
  return (
    <section aria-labelledby="source-title" className="section">
      <div className="section__head">
        <h3 id="source-title">Source</h3>
      </div>
      <div className="source">
        <div className="source__name">
          <strong>{agency ? agency.agency.name : `${snapshot.stateName} statewide rates`}</strong>
          <a href={snapshot.sourceUrl} rel="noreferrer" target="_blank">
            FBI Crime Data Explorer
            <ExternalIcon size={15} />
            <span className="sr-only">(opens the FBI's site)</span>
          </a>
        </div>
        <dl className="source__facts">
          {agency ? (
            <>
              <div>
                <dt>Area covered</dt>
                <dd>All of {areaLabel(agency.areaName)}, not just this point</dd>
              </div>
              <div>
                <dt>Residents served</dt>
                <dd>
                  {agency.agency.population > 0 ? wholeNumber(agency.agency.population) : 'Not listed'} ·{' '}
                  {agency.agency.type} agency, FBI ORI {agency.ori}
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>Months used</dt>
            <dd>
              {range}
              {result.kind === 'agency' ? ` (${result.summary.reportedMonths} of ${SUMMARY_MONTHS} reported)` : ''}
            </dd>
          </div>
          <div>
            <dt>Updates</dt>
            <dd>Agencies send monthly totals on their own schedules. Explorer refreshed {snapshot.refreshed}.</dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>None. Totals describe the whole jurisdiction.</dd>
          </div>
        </dl>
        <p className="source__verified">Snapshot taken {snapshot.retrieved}</p>
      </div>
    </section>
  );
}

export function JurisdictionMethod() {
  return (
    <section aria-labelledby="method-title" className="section">
      <div className="section__head">
        <h3 id="method-title">How the FBI fallback works</h3>
      </div>
      <div className="prose">
        <p>
          Outside the cities with a local incident feed, the atlas uses the FBI Crime Data Explorer's monthly violent
          and property offense counts for the agency that polices the point: its city police, else its town or
          township police, else the county sheriff or county police. Census TIGERweb identifies the city, town, and
          county.
        </p>
        <p>
          The agency's newest twelve reported months are totaled, divided by the population the FBI lists for it, and
          compared with the state's rate over the same months, using the same Lower, Similar, Higher, and Much higher
          bands as the local comparison. Where no agency matches, only the statewide rate is shown, as context.
        </p>
        <p>
          This trades the radius analysis for nationwide coverage: there are no incident points, no nearby comparison,
          and no block-level detail.
        </p>
      </div>
    </section>
  );
}
