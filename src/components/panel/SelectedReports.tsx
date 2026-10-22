import { CATEGORY_LABELS } from '../../domain/categories';
import { reportTime, reportTitle, sentenceCase, titleCase } from '../../domain/presentation';
import type { Incident } from '../../types';
import { CloseIcon } from '../Icons';
import type { ReportLocation } from '../mapLayers';

const MAX_SIBLINGS = 6;

function when(incident: Incident): string {
  const time = reportTime(incident.occurredAt, incident.localHour !== null);
  return [`${time.date}, ${time.year}`, time.time].filter(Boolean).join(' · ');
}

/** Everything the publisher says about one report. */
export function ReportDetails({ incident }: { incident: Incident }) {
  const description = sentenceCase(incident.description);
  const title = reportTitle(incident);
  return (
    <>
      <p className="selected__meta">
        {CATEGORY_LABELS[incident.category]} · {when(incident)}
      </p>
      {description && description.toLowerCase() !== title.toLowerCase() ? (
        <p className="selected__description">{description}</p>
      ) : null}
      <p className="selected__where">{titleCase(incident.locationLabel)}</p>
    </>
  );
}

export function SelectedReports({
  location,
  incidentId,
  precisionNote,
  onFocusIncident,
  onClose,
}: {
  location: ReportLocation;
  incidentId: string | null;
  precisionNote: string;
  onFocusIncident(incident: Incident): void;
  onClose(): void;
}) {
  const focused = location.incidents.find((incident) => incident.id === incidentId) ?? location.incidents[0]!;
  const siblings = location.incidents.filter((incident) => incident.id !== focused.id);
  const count = location.incidents.length;

  return (
    <section aria-labelledby="selected-title" className="selected" data-testid="selected-reports">
      <div className="selected__head">
        <h2 id="selected-title">{count === 1 ? 'Report at this spot' : `${count} reports at this spot`}</h2>
        <button aria-label="Close selected reports" className="icon-button" onClick={onClose} type="button">
          <CloseIcon size={18} />
        </button>
      </div>

      <article className="selected__report">
        <span aria-hidden="true" className={`swatch swatch--${focused.group}`} />
        <div>
          <h3>{reportTitle(focused)}</h3>
          <ReportDetails incident={focused} />
        </div>
      </article>

      {siblings.length > 0 ? (
        <ul aria-label="Other reports at this spot" className="selected__others">
          {siblings.slice(0, MAX_SIBLINGS).map((incident) => (
            <li key={incident.id}>
              <button onClick={() => onFocusIncident(incident)} type="button">
                <span aria-hidden="true" className={`swatch swatch--${incident.group}`} />
                <span>{reportTitle(incident)}</span>
                <time dateTime={incident.occurredAt}>{reportTime(incident.occurredAt, false).date}</time>
              </button>
            </li>
          ))}
          {siblings.length > MAX_SIBLINGS ? (
            <li className="selected__overflow">and {siblings.length - MAX_SIBLINGS} more at this spot</li>
          ) : null}
        </ul>
      ) : null}

      <p className="selected__precision">Location is approximate. {precisionNote}</p>
    </section>
  );
}
