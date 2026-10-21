import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { scalePosition, type DataNote } from '../../domain/presentation';
import {
  analysisFor,
  CURRENT_WINDOW,
  DELAYED_WINDOW,
  evidenceFor,
  FRESH_WINDOW,
  truncation,
} from '../../test/panelFixtures';
import type { AnalysisResult, EvidenceBand } from '../../types';
import { ComparisonScale, DataNotes, Finding } from './Finding';

function note(id: DataNote['id'], prominent = false): DataNote {
  return { id, title: `Title ${id}`, body: `Body for ${id}.`, prominent };
}

describe('Finding', () => {
  const evidence = evidenceFor(FRESH_WINDOW);
  const analysis = analysisFor(evidence);

  function renderFinding(overrides: Partial<AnalysisResult> = {}, radiusMeters = 1000, bundle = evidence) {
    return render(<Finding analysis={{ ...analysisFor(bundle), ...overrides }} evidence={bundle} radiusMeters={radiusMeters} />);
  }

  it('states the comparison as a headline with its scale and method', () => {
    renderFinding();

    const section = screen.getByTestId('finding');
    const headline = screen.getByRole('heading', { level: 2 });
    expect(headline).toHaveAttribute('id', 'finding-headline');
    expect(headline).toHaveAttribute('data-peek-end');
    expect(headline).toHaveTextContent(/^\d+× as many reports per km² as the surrounding area$/);
    expect(screen.getByRole('region', { name: headline.textContent! })).toBe(section);

    expect(section.querySelector('.finding__reason')).toBeNull();
    expect(within(section).getByRole('img', { name: /the surrounding area's rate \(much higher\)\.$/ }))
      .toHaveClass('scale');
    expect(screen.getByTestId('evidence-window')).toHaveTextContent(
      /^Severity-weighted, 1 km circle vs\. the 1–3 km ring, Sep 22 – Oct 21, 2026\. Not a safety rating\.$/,
    );
    // A fresh feed with complete queries has nothing to disclose.
    expect(section.querySelector('.notes')).toBeNull();
    expect(analysis.band).toBe('markedly-elevated');
  });

  it.each<[Partial<AnalysisResult>, string]>([
    [{ relativeActivity: 0.4, band: 'lower' }, '60% fewer reports per km² than the surrounding area'],
    [{ relativeActivity: 1.1, band: 'similar' }, 'About as many reports per km² as the surrounding area'],
    [{ relativeActivity: 1.6, band: 'elevated' }, '1.6× as many reports per km² as the surrounding area'],
  ])('words the headline for %o', (overrides, headline) => {
    renderFinding(overrides);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(headline);
    expect(screen.getByRole('img')).toHaveClass('scale');
  });

  it('explains a withheld comparison without drawing a scale', () => {
    renderFinding({ comparisonUnavailableReason: 'record-limit', relativeActivity: null, band: 'insufficient' });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('No fair comparison with the surrounding area');
    expect(screen.getByText(/more reports than one request can return/)).toHaveClass('finding__reason');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('explains too few reports without drawing a scale', () => {
    renderFinding({ relativeActivity: null, band: 'insufficient', nearbyCurrentIncidents: [] });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Too few reports for a fair comparison');
    expect(screen.getByText('The surrounding area had no matching reports to compare against.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('describes a smaller circle and its ring in the method line', () => {
    renderFinding({}, 500);
    expect(screen.getByTestId('evidence-window')).toHaveTextContent('500 m circle vs. the 500 m–1.5 km ring');
  });

  it('keeps notes that change the numbers open and folds the rest', () => {
    const bundle = evidenceFor(DELAYED_WINDOW, { truncation: truncation({ selectedCurrent: true }) });
    renderFinding({}, 1000, bundle);

    const prominent = screen.getByTestId('note-truncation');
    expect(prominent).toHaveClass('note', 'note--caution');
    expect(prominent).toHaveTextContent('Counts are incomplete. A request for the circle reached the 20,000-record limit');
    expect(prominent.closest('details')).toBeNull();

    const delayed = screen.getByTestId('note-delayed');
    expect(delayed).not.toHaveClass('note--caution');
    expect(delayed).toHaveTextContent('Feed is 113 days behind.');
    expect(delayed.closest('details')).toHaveTextContent('1 note about this data');
  });

  it('folds settling days of a daily feed behind a disclosure', () => {
    renderFinding({}, 1000, evidenceFor(CURRENT_WINDOW));
    const settling = screen.getByTestId('note-settling');
    expect(settling).toHaveTextContent('Newest days left out. Newest 2 days left out while the publisher is still filling them in.');
    expect(settling.closest('details')).not.toBeNull();
  });
});

describe('ComparisonScale', () => {
  function renderScale(ratio: number, band: EvidenceBand) {
    const { container } = render(<ComparisonScale band={band} ratio={ratio} />);
    return {
      scale: screen.getByRole('img'),
      marker: container.querySelector<HTMLElement>('.scale__marker')!,
      bands: [...container.querySelectorAll<HTMLElement>('.scale__band')],
      labels: [...container.querySelectorAll<HTMLElement>('.scale__labels span')],
    };
  }

  it.each<[number, EvidenceBand, string]>([
    [0.5, 'lower', "0.5× the surrounding area's rate (lower)."],
    [1.1, 'similar', "1.1× the surrounding area's rate (similar)."],
    [1.6, 'elevated', "1.6× the surrounding area's rate (higher)."],
    [12, 'markedly-elevated', "12× the surrounding area's rate (much higher)."],
  ])('labels a %s× ratio in the %s band', (ratio, band, label) => {
    expect(renderScale(ratio, band).scale).toHaveAccessibleName(label);
  });

  it('places the marker on a logarithmic track', () => {
    const { marker, bands } = renderScale(0.5, 'lower');

    expect(marker.style.getPropertyValue('--at')).toBe('25%');
    expect(marker).toHaveTextContent('0.5×');
    expect(bands).toHaveLength(4);
    expect(bands[0]!.style.getPropertyValue('--from')).toBe('0%');
    expect(bands[0]!.style.getPropertyValue('--to')).toBe(`${scalePosition(0.65) * 100}%`);
    expect(bands[3]!.style.getPropertyValue('--to')).toBe('100%');
  });

  it.each<[number, 'start' | 'middle' | 'end']>([
    [0.25, 'start'],
    [0.3, 'start'],
    [0.4, 'middle'],
    [1, 'middle'],
    [2.8, 'middle'],
    [3, 'end'],
    [12, 'end'],
  ])('keeps the value label of a %s× marker inside the track (%s)', (ratio, edge) => {
    const { marker } = renderScale(ratio, 'similar');
    expect(marker).toHaveClass(`scale__marker--${edge}`);
    expect(marker.className).toBe(`scale__marker scale__marker--${edge}`);
  });

  it('highlights only the current band and its label', () => {
    const { bands, labels } = renderScale(1.6, 'elevated');

    expect(bands.filter((band) => band.classList.contains('is-current'))).toEqual([bands[2]]);
    expect(bands[2]).toHaveClass('scale__band--elevated');
    expect(labels.map((label) => label.textContent)).toEqual(['Lower', 'Similar', 'Higher', 'Much higher']);
    expect(labels.filter((label) => label.classList.contains('is-current'))).toEqual([labels[2]]);
    expect(labels[0]).not.toHaveAttribute('class');
  });
});

describe('DataNotes', () => {
  it('renders nothing without notes', () => {
    const { container } = render(<DataNotes notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows prominent notes and no disclosure when nothing is folded', () => {
    const { container } = render(<DataNotes notes={[note('truncation', true)]} />);

    const shown = screen.getByTestId('note-truncation');
    expect(shown).toHaveClass('note note--caution');
    expect(shown).toHaveTextContent('Title truncation. Body for truncation.');
    expect(within(shown).getByText('Title truncation.').tagName).toBe('STRONG');
    expect(shown.querySelector('svg')).toHaveClass('note__icon');
    expect(container.querySelector('details')).toBeNull();
  });

  it('folds a single minor note behind a singular summary', () => {
    const { container } = render(<DataNotes notes={[note('truncation', true), note('delayed')]} />);

    const details = container.querySelector('details')!;
    expect(details).toHaveClass('notes__more');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('1 note about this data').tagName).toBe('SUMMARY');
    expect(within(details).getByTestId('note-delayed')).toHaveClass('note');
    expect(within(details).queryByTestId('note-truncation')).not.toBeInTheDocument();
  });

  it('counts several folded notes in the summary', () => {
    const { container } = render(<DataNotes notes={[note('delayed'), note('settling'), note('area-coverage')]} />);

    const details = container.querySelector('details')!;
    expect(details.querySelector('summary')).toHaveTextContent('3 notes about this data');
    expect([...details.querySelectorAll('.note')].map((element) => element.getAttribute('data-testid'))).toEqual([
      'note-delayed',
      'note-settling',
      'note-area-coverage',
    ]);
  });

  it('lists every note flat when expanded', () => {
    const { container } = render(
      <DataNotes expanded notes={[note('truncation', true), note('delayed'), note('settling')]} />,
    );

    expect(container.querySelector('details')).toBeNull();
    expect([...container.querySelectorAll('.notes > .note')].map((element) => element.getAttribute('data-testid'))).toEqual([
      'note-truncation',
      'note-delayed',
      'note-settling',
    ]);
  });
});
