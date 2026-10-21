import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  analysisFor,
  CURRENT_WINDOW,
  DAY,
  evidenceFor,
  incident,
  incidentsFor,
  lastDayOf,
  manyIncidents,
  META,
  truncation,
} from '../../test/panelFixtures';
import type { AnalysisResult, Incident } from '../../types';
import { REPORTS_PAGE_SIZE, ReportsTab } from './ReportsTab';

const PRECISION = META.precisionNote;

function renderReports({
  analysis = analysisFor(evidenceFor(CURRENT_WINDOW)),
  radiusMeters = 1000,
  expandedId = null,
  onSelect = vi.fn(),
}: {
  analysis?: AnalysisResult;
  radiusMeters?: number;
  expandedId?: string | null;
  onSelect?: (incident: Incident) => void;
} = {}) {
  const view = render(
    <ReportsTab
      analysis={analysis}
      expandedId={expandedId}
      onSelect={onSelect}
      precisionNote={PRECISION}
      radiusMeters={radiusMeters}
    />,
  );
  return { ...view, analysis, onSelect };
}

const rows = () => screen.queryAllByRole('button', { expanded: false }).concat(screen.queryAllByRole('button', { expanded: true }));
const listItems = () => within(screen.getByRole('list')).getAllByRole('listitem');
const more = () => screen.queryByRole('button', { name: /^Show \d+ more of/ });

describe('ReportsTab', () => {
  it('explains an empty list with the circle size', () => {
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents: [] }), 500), radiusMeters: 500 });

    expect(screen.getByText('No reports of the selected types inside the 500 m circle over these dates.')).toHaveClass(
      'section__empty',
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lists reports newest first with a count', () => {
    renderReports();

    const region = screen.getByRole('region', { name: 'Reports inside the circle' });
    expect(region.querySelector('.reports__meta')).toHaveTextContent(/^5 reports within 1 km, newest first$/);
    expect(listItems()).toHaveLength(5);
    expect(rows()).toHaveLength(5);
    expect(more()).not.toBeInTheDocument();
  });

  it('counts a single report in the singular', () => {
    const [first] = incidentsFor(CURRENT_WINDOW);
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents: [first!] })) });
    expect(screen.getByText(/within 1 km/)).toHaveTextContent(/^1 report within 1 km, newest first$/);
  });

  it('marks a truncated count as a lower bound', () => {
    renderReports({
      analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { truncation: truncation({ selectedCurrent: true }) })),
    });
    expect(screen.getByText(/reports within/)).toHaveTextContent(/^5\+ reports within 1 km, newest first$/);
  });

  it('shows the title, category, place, date, and time of each report', () => {
    renderReports();

    const [first, second] = listItems();
    const row = within(first!).getByRole('button');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(row.querySelector('.swatch')).toHaveClass('swatch swatch--violent');
    expect(row.querySelector('strong')).toHaveTextContent(/^Assault$/);
    expect(row.querySelector('.report__text small')).toHaveTextContent(/^Assault · assault-1 block$/);
    expect(row.querySelector('time')).toHaveAttribute('datetime', '2026-10-18T23:30:00');
    expect(row.querySelector('time')).toHaveTextContent(/^Oct 18$/);
    expect(row.querySelector('.report__time small')).toHaveTextContent(/^11:30 PM$/);

    expect(within(second!).getByRole('button')).toHaveTextContent('TheftTheft · theft-1 blockOct 172:30 PM');
  });

  it('title-cases a shouted location and falls back to the category without a publisher title', () => {
    const lastDay = lastDayOf(CURRENT_WINDOW);
    const incidents = [
      incident('upper-1', 'burglary', lastDay, {
        rawCategory: '',
        locationLabel: 'FRONT OF · 100 W 42 ST · MANHATTAN',
        hour: null,
      }),
    ];
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents })) });

    const row = screen.getByRole('button');
    expect(row.querySelector('strong')).toHaveTextContent(/^Burglary$/);
    expect(row.querySelector('.report__text small')).toHaveTextContent(/^Burglary · Front of · 100 W 42 St · Manhattan$/);
    expect(row.querySelector('time')).toHaveAttribute('datetime', '2026-10-18T00:00:00');
    expect(row.querySelector('.report__time small')).toHaveTextContent(/^No time$/);
  });

  it('expands the report opened from the list in place', () => {
    renderReports({ expandedId: 'theft-1' });

    const expanded = screen.getByRole('button', { expanded: true });
    expect(expanded).toHaveTextContent(/^Theft/);
    const item = expanded.closest('li')!;
    expect(item).toHaveClass('is-expanded');
    const details = item.querySelector('.report__details')!;
    expect(details.querySelector('.selected__meta')).toHaveTextContent('Theft · Oct 17, 2026 · 2:30 PM');
    expect(details.querySelector('.selected__description')).toHaveTextContent('theft on the sidewalk');
    expect(details.querySelector('.selected__precision')).toHaveTextContent(`Location is approximate. ${PRECISION}`);

    expect(document.querySelectorAll('.report__details')).toHaveLength(1);
    expect(listItems().filter((li) => li.classList.contains('is-expanded'))).toEqual([item]);
    expect(listItems()[0]).not.toHaveAttribute('class');
  });

  it('selects a report', async () => {
    const user = userEvent.setup();
    const { analysis, onSelect } = renderReports();

    await user.click(within(listItems()[3]!).getByRole('button'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(analysis.currentIncidents[3]);
  });

  it('pages through long lists', async () => {
    const user = userEvent.setup();
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents: manyIncidents(60) })) });

    expect(REPORTS_PAGE_SIZE).toBe(25);
    expect(screen.getByText(/reports within/)).toHaveTextContent('60 reports within 1 km');
    expect(listItems()).toHaveLength(25);

    await user.click(screen.getByRole('button', { name: 'Show 25 more of 35' }));
    expect(listItems()).toHaveLength(50);

    await user.click(screen.getByRole('button', { name: 'Show 10 more of 10' }));
    expect(listItems()).toHaveLength(60);
    expect(more()).not.toBeInTheDocument();
  });

  it('groups a large remainder', () => {
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents: manyIncidents(1030) })) });
    expect(screen.getByRole('button', { name: 'Show 25 more of 1,005' })).toHaveClass('reports__more');
  });

  it('starts from the first page again when the reports change', async () => {
    const user = userEvent.setup();
    const analysis = analysisFor(evidenceFor(CURRENT_WINDOW, { incidents: manyIncidents(60) }));
    const onSelect = vi.fn();
    const { rerender } = renderReports({ analysis, onSelect });
    const view = (next: AnalysisResult) => (
      <ReportsTab analysis={next} expandedId={null} onSelect={onSelect} precisionNote={PRECISION} radiusMeters={1000} />
    );

    await user.click(screen.getByRole('button', { name: 'Show 25 more of 35' }));
    expect(listItems()).toHaveLength(50);

    // The same reports in a new result object keep the page.
    rerender(view({ ...analysis }));
    expect(listItems()).toHaveLength(50);

    rerender(view({ ...analysis, currentIncidents: [...analysis.currentIncidents] }));
    expect(listItems()).toHaveLength(25);
    expect(screen.getByRole('button', { name: 'Show 25 more of 35' })).toBeInTheDocument();
  });

  it('keeps reports that are far apart in time in order', () => {
    const lastDay = lastDayOf(CURRENT_WINDOW);
    const incidents = [
      incident('older', 'theft', lastDay - 20 * DAY),
      ...incidentsFor(CURRENT_WINDOW),
    ];
    renderReports({ analysis: analysisFor(evidenceFor(CURRENT_WINDOW, { incidents })) });

    expect(listItems().map((item) => item.querySelector('time')!.textContent)).toEqual([
      'Oct 18',
      'Oct 17',
      'Oct 16',
      'Oct 15',
      'Oct 14',
      'Sep 28',
    ]);
  });
});
