import { useEffect, useState } from 'react';
import { CATEGORY_LABELS } from '../../domain/categories';
import { formatCount, radiusLabel, reportTime, reportTitle, titleCase } from '../../domain/presentation';
import type { AnalysisResult, Incident } from '../../types';
import { ReportDetails } from './SelectedReports';

export const REPORTS_PAGE_SIZE = 25;

export function ReportRow({
  incident,
  selected,
  onSelect,
}: {
  incident: Incident;
  selected: boolean;
  onSelect(incident: Incident): void;
}) {
  const time = reportTime(incident.occurredAt, incident.localHour !== null);
  return (
    <button aria-expanded={selected} className="report" onClick={() => onSelect(incident)} type="button">
      <span aria-hidden="true" className={`swatch swatch--${incident.group}`} />
      <span className="report__text">
        <strong>{reportTitle(incident)}</strong>
        <small>{CATEGORY_LABELS[incident.category]} · {titleCase(incident.locationLabel)}</small>
      </span>
      <span className="report__time">
        <time dateTime={incident.occurredAt}>{time.date}</time>
        <small>{time.time ?? 'No time'}</small>
      </span>
    </button>
  );
}

export function ReportsTab({
  analysis,
  radiusMeters,
  expandedId,
  precisionNote,
  onSelect,
}: {
  analysis: AnalysisResult;
  radiusMeters: number;
  /** The report opened from this list, shown in place. */
  expandedId: string | null;
  precisionNote: string;
  onSelect(incident: Incident): void;
}) {
  const [shown, setShown] = useState(REPORTS_PAGE_SIZE);
  const incidents = analysis.currentIncidents;

  // A new place or filter starts the list from the top again.
  useEffect(() => setShown(REPORTS_PAGE_SIZE), [incidents]);

  if (incidents.length === 0) {
    return (
      <p className="section__empty">
        No reports of the selected types inside the {radiusLabel(radiusMeters)} circle over these dates.
      </p>
    );
  }

  const remaining = incidents.length - shown;
  return (
    <section aria-label="Reports inside the circle" className="reports">
      <p className="reports__meta">
        {formatCount(analysis.currentCount, analysis.currentCountIsLowerBound)}
        {analysis.currentCount === 1 && !analysis.currentCountIsLowerBound ? ' report' : ' reports'} within {radiusLabel(radiusMeters)},
        newest first
      </p>
      <ul className="reports__list">
        {incidents.slice(0, shown).map((incident) => (
          <li className={incident.id === expandedId ? 'is-expanded' : undefined} key={incident.id}>
            <ReportRow incident={incident} onSelect={onSelect} selected={incident.id === expandedId} />
            {incident.id === expandedId ? (
              <div className="report__details">
                <ReportDetails incident={incident} />
                <p className="selected__precision">Location is approximate. {precisionNote}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <button className="button button--quiet reports__more" onClick={() => setShown((count) => count + REPORTS_PAGE_SIZE)} type="button">
          Show {Math.min(REPORTS_PAGE_SIZE, remaining)} more of {formatCount(remaining)}
        </button>
      ) : null}
    </section>
  );
}
