import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CENTER, CURRENT_WINDOW, DAY, incident, lastDayOf, META } from '../../test/panelFixtures';
import type { Incident } from '../../types';
import { groupIncidentsByLocation } from '../mapLayers';
import { ReportDetails, SelectedReports } from './SelectedReports';

const LAST_DAY = lastDayOf(CURRENT_WINDOW);

/** `count` reports at one blurred point, newest first by id order. */
function reportsAtOnePoint(count: number): Incident[] {
  return Array.from({ length: count }, (_, index) => (
    incident(`report-${index}`, index % 2 === 0 ? 'theft' : 'assault', LAST_DAY - index * DAY, {
      rawCategory: index % 2 === 0 ? 'PETIT LARCENY' : 'FELONY ASSAULT',
    })
  ));
}

function renderSelected(incidents: Incident[], incidentId: string | null = null) {
  const [location] = groupIncidentsByLocation(CENTER, 1000, incidents);
  const onFocusIncident = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <SelectedReports
      incidentId={incidentId}
      location={location!}
      onClose={onClose}
      onFocusIncident={onFocusIncident}
      precisionNote={META.precisionNote}
    />,
  );
  return { ...view, location: location!, onFocusIncident, onClose };
}

const focusedTitle = () => screen.getByRole('heading', { level: 3 });
const siblings = () => screen.queryByRole('list', { name: 'Other reports at this spot' });

describe('SelectedReports', () => {
  it('shows a single report without a sibling list', () => {
    renderSelected(reportsAtOnePoint(1));

    const section = screen.getByTestId('selected-reports');
    expect(screen.getByRole('region', { name: 'Report at this spot' })).toBe(section);
    expect(focusedTitle()).toHaveTextContent('Petit larceny');
    expect(section.querySelector('.selected__report .swatch')).toHaveClass('swatch--property');
    expect(siblings()).not.toBeInTheDocument();
    expect(section.querySelector('.selected__precision')).toHaveTextContent(
      `Location is approximate. ${META.precisionNote}`,
    );
  });

  it('counts several reports and focuses the newest by default', () => {
    renderSelected(reportsAtOnePoint(3));

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('3 reports at this spot');
    expect(focusedTitle()).toHaveTextContent('Petit larceny');
    expect(screen.getByText(/^Theft · /)).toHaveTextContent('Theft · Oct 18, 2026 · 2:30 PM');

    const items = within(siblings()!).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Felony assaultOct 17');
    expect(items[0]!.querySelector('time')).toHaveAttribute('datetime', '2026-10-17T14:30:00');
    expect(items[0]!.querySelector('.swatch')).toHaveClass('swatch--violent');
    expect(items[1]).toHaveTextContent('Petit larcenyOct 16');
  });

  it('focuses the requested report and lists the others', () => {
    renderSelected(reportsAtOnePoint(3), 'report-1');

    expect(focusedTitle()).toHaveTextContent('Felony assault');
    expect(screen.getByText(/^Assault · /)).toHaveTextContent('Assault · Oct 17, 2026 · 2:30 PM');
    expect(within(siblings()!).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Petit larcenyOct 18',
      'Petit larcenyOct 16',
    ]);
  });

  it('falls back to the newest report for an unknown id', () => {
    renderSelected(reportsAtOnePoint(2), 'missing');
    expect(focusedTitle()).toHaveTextContent('Petit larceny');
    expect(within(siblings()!).getAllByRole('button')).toHaveLength(1);
  });

  it('caps the sibling list and counts the rest', () => {
    renderSelected(reportsAtOnePoint(9));

    const list = siblings()!;
    expect(within(list).getAllByRole('button')).toHaveLength(6);
    expect(within(list).getByText('and 2 more at this spot')).toHaveClass('selected__overflow');
  });

  it('shows exactly six siblings without an overflow line', () => {
    renderSelected(reportsAtOnePoint(7));

    expect(within(siblings()!).getAllByRole('button')).toHaveLength(6);
    expect(screen.queryByText(/more at this spot/)).not.toBeInTheDocument();
  });

  it('focuses a sibling and closes', async () => {
    const user = userEvent.setup();
    const { location, onFocusIncident, onClose } = renderSelected(reportsAtOnePoint(3));

    await user.click(within(siblings()!).getAllByRole('button')[1]!);
    expect(onFocusIncident).toHaveBeenCalledOnce();
    expect(onFocusIncident).toHaveBeenCalledWith(location.incidents[2]);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close selected reports' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ReportDetails', () => {
  function renderDetails(overrides: Partial<Incident> = {}) {
    const { container } = render(<ReportDetails incident={{ ...incident('one', 'robbery', LAST_DAY, { hour: 9 }), ...overrides }} />);
    return {
      meta: container.querySelector('.selected__meta'),
      description: container.querySelector('.selected__description'),
      where: container.querySelector('.selected__where'),
    };
  }

  it('shows the category, date, time, description, and place', () => {
    const { meta, description, where } = renderDetails({
      description: 'FORCIBLE STOLEN · ARMED WITH KNIFE',
      locationLabel: 'IN FRONT OF · STREET · MANHATTAN',
    });

    expect(meta).toHaveTextContent(/^Robbery · Oct 18, 2026 · 9:30 AM$/);
    expect(description).toHaveTextContent(/^Forcible stolen · armed with knife$/);
    expect(where).toHaveTextContent(/^In Front of · Street · Manhattan$/);
  });

  it('leaves out an unknown time of day', () => {
    const { meta } = renderDetails({ localHour: null });
    expect(meta).toHaveTextContent(/^Robbery · Oct 18, 2026$/);
  });

  it('hides a description that only repeats the title', () => {
    expect(renderDetails({ rawCategory: 'ROBBERY', description: 'robbery' }).description).toBeNull();
  });

  it('hides an empty description', () => {
    expect(renderDetails({ description: '   ' }).description).toBeNull();
  });

  it('keeps mixed-case place names as published', () => {
    expect(renderDetails({ locationLabel: '  Pier 17, South Street  ' }).where).toHaveTextContent(/^Pier 17, South Street$/);
  });
});
