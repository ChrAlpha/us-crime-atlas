import type { CSSProperties } from 'react';
import {
  BAND_LABELS,
  dataNotes,
  finding,
  formatRatio,
  methodLine,
  SCALE_BANDS,
  scalePosition,
  type DataNote,
} from '../../domain/presentation';
import type { AnalysisResult, EvidenceBand, EvidenceBundle } from '../../types';
import { InfoIcon, WarningIcon } from '../Icons';

export function ComparisonScale({
  ratio,
  band,
  reference = "the surrounding area's rate",
}: {
  ratio: number;
  band: EvidenceBand;
  /** What the ratio is relative to, for the text alternative. */
  reference?: string;
}) {
  const position = scalePosition(ratio);
  const edge = position > 0.88 ? 'end' : position < 0.12 ? 'start' : 'middle';
  const marker = { '--at': `${position * 100}%` } as CSSProperties;
  return (
    <figure
      aria-label={`${formatRatio(ratio)} ${reference} (${BAND_LABELS[band].toLowerCase()}).`}
      className="scale"
      role="img"
    >
      <div className="scale__track" aria-hidden="true">
        {SCALE_BANDS.map((step) => {
          const style = {
            '--from': `${scalePosition(step.from) * 100}%`,
            '--to': `${scalePosition(step.to) * 100}%`,
          } as CSSProperties;
          return (
            <span
              className={`scale__band scale__band--${step.band}${step.band === band ? ' is-current' : ''}`}
              key={step.band}
              style={style}
            />
          );
        })}
        <span className="scale__tick" />
        <span className={`scale__marker scale__marker--${edge}`} style={marker}>
          <span className="scale__value">{formatRatio(ratio)}</span>
        </span>
      </div>
      <div className="scale__labels" aria-hidden="true">
        {SCALE_BANDS.map((step) => {
          const style = {
            '--from': `${scalePosition(step.from) * 100}%`,
            '--to': `${scalePosition(step.to) * 100}%`,
          } as CSSProperties;
          return (
            <span className={step.band === band ? 'is-current' : undefined} key={step.band} style={style}>
              {BAND_LABELS[step.band]}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

function Note({ note }: { note: DataNote }) {
  const Icon = note.prominent ? WarningIcon : InfoIcon;
  return (
    <div className={`note${note.prominent ? ' note--caution' : ''}`} data-testid={`note-${note.id}`}>
      <Icon className="note__icon" size={16} />
      <p>
        <strong>{note.title}.</strong> {note.body}
      </p>
    </div>
  );
}

/** Notes that change how numbers read stay open; the rest fold behind one disclosure. */
export function DataNotes({ notes, expanded = false }: { notes: DataNote[]; expanded?: boolean }) {
  if (notes.length === 0) return null;
  if (expanded) {
    return <div className="notes">{notes.map((note) => <Note key={note.id} note={note} />)}</div>;
  }
  const prominent = notes.filter((note) => note.prominent);
  const folded = notes.filter((note) => !note.prominent);
  return (
    <div className="notes">
      {prominent.map((note) => <Note key={note.id} note={note} />)}
      {folded.length > 0 ? (
        <details className="notes__more">
          <summary>
            <InfoIcon size={16} />
            {folded.length === 1 ? '1 note about this data' : `${folded.length} notes about this data`}
          </summary>
          {folded.map((note) => <Note key={note.id} note={note} />)}
        </details>
      ) : null}
    </div>
  );
}

export function Finding({
  analysis,
  evidence,
  radiusMeters,
}: {
  analysis: AnalysisResult;
  evidence: EvidenceBundle;
  radiusMeters: number;
}) {
  const result = finding(analysis);
  return (
    <section aria-labelledby="finding-headline" className="finding" data-testid="finding">
      <h2 className="finding__headline" data-peek-end id="finding-headline">{result.headline}</h2>
      {result.reason ? <p className="finding__reason">{result.reason}</p> : null}
      {result.ratio !== null ? <ComparisonScale band={result.band} ratio={result.ratio} /> : null}
      <p className="finding__method" data-testid="evidence-window">{methodLine(radiusMeters, evidence.window)}</p>
      <DataNotes notes={dataNotes(evidence)} />
    </section>
  );
}
