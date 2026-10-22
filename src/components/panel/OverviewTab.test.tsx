import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  analysisFor,
  CURRENT_WINDOW,
  DAY,
  evidenceFor,
  evidenceWindow,
  incident,
  incidentsFor,
  lastDayOf,
  stubBox,
  truncation,
} from '../../test/panelFixtures';
import type { AnalysisResult, EvidenceBundle } from '../../types';
import { OverviewTab } from './OverviewTab';

function renderOverview(evidence: EvidenceBundle = evidenceFor(CURRENT_WINDOW), overrides: Partial<AnalysisResult> = {}) {
  const analysis = { ...analysisFor(evidence), ...overrides };
  return { analysis, ...render(<OverviewTab analysis={analysis} evidence={evidence} />) };
}

function fact(term: string) {
  return screen.getByText(term, { selector: 'dt' }).closest('.fact')! as HTMLElement;
}

function section(title: string) {
  return screen.getByRole('heading', { level: 3, name: title }).closest('section')!;
}

const hourlyChart = () => screen.getByRole('img', { name: /^Reports by hour of day\./ });
const dailyChart = () => screen.getByRole('img', { name: /^Daily reports over the last/ });
const readoutOf = (chart: HTMLElement) => chart.closest('figure')!.querySelector('.bars__readout')!;

describe('OverviewTab facts', () => {
  it('counts reports with the trend, violent share, and night share', () => {
    renderOverview();

    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5$/);
    expect(screen.getByTestId('trend')).toHaveTextContent('400% more than the previous 30 days');
    expect(within(fact('Violent')).getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(fact('Violent')).toHaveTextContent('40% of these reports');
    expect(within(fact('At night')).getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(fact('At night')).toHaveTextContent('40% between 10 PM and 5 AM');
  });

  it('marks a truncated count as a lower bound and withholds the trend', () => {
    renderOverview(evidenceFor(CURRENT_WINDOW, { truncation: truncation({ selectedCurrent: true }) }));

    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^5\+$/);
    expect(screen.getByTestId('trend')).toHaveTextContent('No trend: a request hit its record limit');
  });
});

describe('OverviewTab composition', () => {
  it('stacks only the groups with reports and lists every category', () => {
    renderOverview();

    const composition = section('What was reported');
    const stack = within(composition).getByRole('img', { name: 'Violent 40%, Property 40%, Vehicle 20%' });
    const parts = [...stack.querySelectorAll<HTMLElement>('.stack__part')];
    expect(parts.map((part) => part.className)).toEqual([
      'stack__part swatch--violent',
      'stack__part swatch--property',
      'stack__part swatch--vehicle',
    ]);
    expect(parts.map((part) => part.style.getPropertyValue('--share'))).toEqual(['0.4', '0.4', '0.2']);

    const rows = within(composition).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Theft40%2',
      'Assault20%1',
      'Robbery20%1',
      'Vehicle theft20%1',
    ]);
    expect(rows.map((row) => row.querySelector('.swatch')!.className)).toEqual([
      'swatch swatch--property',
      'swatch swatch--violent',
      'swatch swatch--violent',
      'swatch swatch--vehicle',
    ]);
  });

  it('says so when nothing of the selected types was reported', () => {
    renderOverview(evidenceFor(CURRENT_WINDOW, { incidents: [] }));

    const composition = section('What was reported');
    expect(composition).toHaveTextContent('No reports of the selected types inside the circle over these dates.');
    expect(within(composition).queryByRole('img')).not.toBeInTheDocument();
    expect(within(composition).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByTestId('reported-count')).toHaveTextContent(/^0$/);
  });
});

describe('OverviewTab timing', () => {
  it('charts reports by hour with night hours shaded', () => {
    renderOverview();

    const chart = hourlyChart();
    expect(chart).toHaveAccessibleName('Reports by hour of day. Busiest hour 2 PM. 40% between 10 PM and 5 AM.');
    expect(screen.getByRole('heading', { level: 4, name: 'Time of day night shaded' })).toBeInTheDocument();
    expect(readoutOf(chart)).toHaveTextContent('Busiest hour: 2 PM, 3 reports');

    const columns = [...chart.querySelectorAll('.bars__col')];
    expect(columns).toHaveLength(24);
    const shaded = columns.flatMap((column, hour) => (column.classList.contains('is-shaded') ? [hour] : []));
    expect(shaded).toEqual([0, 1, 2, 3, 4, 22, 23]);

    const ticks = [...chart.closest('figure')!.querySelectorAll('.bars__axis span')].map((tick) => tick.textContent);
    expect(ticks).toEqual(['12a', '6a', '12p', '6p']);
  });

  it('reads out an hour range under the pointer', () => {
    renderOverview();
    const chart = hourlyChart();
    stubBox(chart, { left: 0, width: 240 });

    fireEvent.pointerMove(chart, { clientX: 145 });
    expect(readoutOf(chart)).toHaveTextContent(/^2 PM–3 PM: 3 reports$/);

    fireEvent.pointerMove(chart, { clientX: 235 });
    expect(readoutOf(chart)).toHaveTextContent(/^11 PM–12 AM: 1 report$/);

    fireEvent.pointerMove(chart, { clientX: 5 });
    expect(readoutOf(chart)).toHaveTextContent(/^12 AM–1 AM: 0 reports$/);
  });

  it('notes reports without a published time', () => {
    const untimed = incident('untimed-1', 'theft', lastDayOf(CURRENT_WINDOW) - 6 * DAY, { hour: null });
    renderOverview(evidenceFor(CURRENT_WINDOW, { incidents: [...incidentsFor(CURRENT_WINDOW), untimed] }));

    expect(section('When reports happen')).toHaveTextContent('1 report had no published time of day.');
    expect(hourlyChart()).toBeInTheDocument();
  });

  it('pluralizes and groups large untimed counts', () => {
    renderOverview(undefined, { untimedCount: 1234 });
    expect(section('When reports happen')).toHaveTextContent('1,234 reports had no published time of day.');
  });

  it('skips the hourly chart when no report has a time', () => {
    const lastDay = lastDayOf(CURRENT_WINDOW);
    const incidents = [
      incident('untimed-1', 'theft', lastDay, { hour: null }),
      incident('untimed-2', 'assault', lastDay - DAY, { hour: null }),
    ];
    renderOverview(evidenceFor(CURRENT_WINDOW, { incidents }));

    expect(screen.queryByRole('img', { name: /^Reports by hour of day/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Time of day/ })).not.toBeInTheDocument();
    expect(section('When reports happen')).toHaveTextContent('2 reports had no published time of day.');
  });

  it('omits the untimed note when every report has a time', () => {
    renderOverview();
    expect(section('When reports happen')).not.toHaveTextContent('no published time of day');
  });

  it('charts the last days of the window with the busiest day', () => {
    renderOverview();

    const chart = dailyChart();
    // Five days tie at one report; the earliest wins.
    expect(chart).toHaveAccessibleName(
      'Daily reports over the last 30 days of the window. Busiest day Oct 14 with 1 report.',
    );
    expect(screen.getByRole('heading', { level: 4, name: 'Day by day last 30 days of the window' })).toBeInTheDocument();
    expect(readoutOf(chart)).toHaveTextContent('Busiest day: Oct 14, 1 report');
    expect(chart.querySelectorAll('.bars__col')).toHaveLength(30);
    expect(chart.querySelectorAll('.is-shaded')).toHaveLength(0);

    const ticks = [...chart.closest('figure')!.querySelectorAll<HTMLElement>('.bars__axis span')];
    expect(ticks.map((tick) => [tick.textContent, tick.dataset.align])).toEqual([
      ['Sep 19', 'start'],
      ['Oct 18', 'end'],
    ]);

    stubBox(chart, { left: 0, width: 300 });
    fireEvent.pointerMove(chart, { clientX: 295 });
    expect(readoutOf(chart)).toHaveTextContent(/^Oct 18: 1 report$/);
  });

  it('picks the day with the most reports', () => {
    const lastDay = lastDayOf(CURRENT_WINDOW);
    const incidents = [
      ...incidentsFor(CURRENT_WINDOW),
      incident('theft-3', 'theft', lastDay - DAY),
      incident('theft-4', 'theft', lastDay - DAY, { hour: 9 }),
    ];
    renderOverview(evidenceFor(CURRENT_WINDOW, { incidents }));
    expect(readoutOf(dailyChart())).toHaveTextContent('Busiest day: Oct 17, 3 reports');
  });

  it('follows a shorter window', () => {
    const window = evidenceWindow(Date.UTC(2026, 9, 20, 18), 2, 14);
    renderOverview(evidenceFor(window));

    expect(dailyChart()).toHaveAccessibleName(/^Daily reports over the last 14 days of the window\./);
    expect(dailyChart().querySelectorAll('.bars__col')).toHaveLength(14);
    expect(screen.getByRole('heading', { level: 4, name: 'Day by day last 14 days of the window' })).toBeInTheDocument();
  });

  it('draws a flat daily chart when the circle had no reports', () => {
    renderOverview(evidenceFor(CURRENT_WINDOW, { incidents: [] }));

    expect(readoutOf(dailyChart())).toHaveTextContent('Busiest day: Sep 19, 0 reports');
    expect(screen.queryByRole('img', { name: /^Reports by hour of day/ })).not.toBeInTheDocument();
  });

  it('skips the daily chart without daily activity', () => {
    renderOverview(undefined, { dailyActivity: [] });

    expect(screen.queryByRole('img', { name: /^Daily reports/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Day by day/ })).not.toBeInTheDocument();
    expect(hourlyChart()).toBeInTheDocument();
  });
});
