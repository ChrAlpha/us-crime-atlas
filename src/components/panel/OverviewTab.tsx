import type { CSSProperties } from 'react';
import { CATEGORY_LABELS, categoryGroup, GROUP_LABELS } from '../../domain/categories';
import {
  formatCount,
  hourLabel,
  hourTick,
  percent,
  trendCopy,
} from '../../domain/presentation';
import { formatDay } from '../../domain/time';
import type { AnalysisResult, EvidenceBundle } from '../../types';
import { BarChart } from './BarChart';

const reports = (count: number) => (count === 1 ? '1 report' : `${count.toLocaleString('en-US')} reports`);
const isNight = (hour: number) => hour >= 22 || hour < 5;

function busiest(values: readonly number[]): number {
  return values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
}

function Facts({ analysis, evidence }: { analysis: AnalysisResult; evidence: EvidenceBundle }) {
  return (
    <dl className="facts">
      <div className="fact">
        <dt>Reports</dt>
        <dd>
          <strong data-testid="reported-count">{formatCount(analysis.currentCount, analysis.currentCountIsLowerBound)}</strong>
          <span data-testid="trend">{trendCopy(analysis, evidence.window)}</span>
        </dd>
      </div>
      <div className="fact">
        <dt>Violent</dt>
        <dd>
          <strong>{formatCount(analysis.violentCount)}</strong>
          <span>{percent(analysis.violentShare)} of these reports</span>
        </dd>
      </div>
      <div className="fact">
        <dt>At night</dt>
        <dd>
          <strong>{formatCount(analysis.nightCount)}</strong>
          <span>{percent(analysis.nightShare)} between 10 PM and 5 AM</span>
        </dd>
      </div>
    </dl>
  );
}

function Composition({ analysis }: { analysis: AnalysisResult }) {
  const present = analysis.groupBreakdown.filter((item) => item.count > 0);
  return (
    <section aria-labelledby="mix-title" className="section">
      <div className="section__head">
        <h3 id="mix-title">What was reported</h3>
      </div>
      {analysis.categoryBreakdown.length === 0 ? (
        <p className="section__empty">No reports of the selected types inside the circle over these dates.</p>
      ) : (
        <>
          <div
            aria-label={present.map((item) => `${GROUP_LABELS[item.group]} ${percent(item.share)}`).join(', ')}
            className="stack"
            role="img"
          >
            {present.map((item) => (
              <span
                className={`stack__part swatch--${item.group}`}
                key={item.group}
                style={{ '--share': item.share } as CSSProperties}
              />
            ))}
          </div>
          <ul className="mix">
            {analysis.categoryBreakdown.map((item) => (
              <li key={item.category}>
                <span aria-hidden="true" className={`swatch swatch--${categoryGroup(item.category)}`} />
                <span className="mix__label">{CATEGORY_LABELS[item.category]}</span>
                <span className="mix__share">{percent(item.share)}</span>
                <strong className="mix__count">{formatCount(item.count)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Timing({ analysis }: { analysis: AnalysisResult }) {
  const hours = analysis.hourlyActivity;
  const timed = hours.reduce((sum, value) => sum + value, 0);
  const days = analysis.dailyActivity;
  const peakHour = busiest(hours);
  const peakDay = busiest(days.map((day) => day.count));
  const dayLabels = days.map((day) => formatDay(Date.parse(`${day.date}T00:00:00Z`)).replace(/, \d{4}$/, ''));
  const lastDay = days.length - 1;

  return (
    <section aria-labelledby="timing-title" className="section">
      <div className="section__head">
        <h3 id="timing-title">When reports happen</h3>
      </div>
      {timed > 0 ? (
        <>
          <h4 className="section__subhead">Time of day <span>night shaded</span></h4>
          <BarChart
            idleReadout={`Busiest hour: ${hourLabel(peakHour)}, ${reports(hours[peakHour] ?? 0)}`}
            labels={hours.map((_, hour) => `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`)}
            shaded={isNight}
            summary={`Reports by hour of day. Busiest hour ${hourLabel(peakHour)}. `
              + `${percent(analysis.nightShare)} between 10 PM and 5 AM.`}
            ticks={[0, 6, 12, 18].map((hour) => ({ index: hour, label: hourTick(hour) }))}
            unit={reports}
            values={hours}
          />
        </>
      ) : null}
      {analysis.untimedCount > 0 ? (
        <p className="section__aside">{reports(analysis.untimedCount)} had no published time of day.</p>
      ) : null}
      {days.length > 0 ? (
        <>
          <h4 className="section__subhead">Day by day <span>last {days.length} days of the window</span></h4>
          <BarChart
            idleReadout={`Busiest day: ${dayLabels[peakDay]}, ${reports(days[peakDay]?.count ?? 0)}`}
            labels={dayLabels}
            summary={`Daily reports over the last ${days.length} days of the window. `
              + `Busiest day ${dayLabels[peakDay]} with ${reports(days[peakDay]?.count ?? 0)}.`}
            ticks={[{ index: 0, label: dayLabels[0]! }, { index: lastDay, label: dayLabels[lastDay]! }]}
            unit={reports}
            values={days.map((day) => day.count)}
          />
        </>
      ) : null}
    </section>
  );
}

export function OverviewTab({ analysis, evidence }: { analysis: AnalysisResult; evidence: EvidenceBundle }) {
  return (
    <>
      <Facts analysis={analysis} evidence={evidence} />
      <Composition analysis={analysis} />
      <Timing analysis={analysis} />
    </>
  );
}
