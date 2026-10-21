import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { summarizeAgency, summarizeState, type AgencySummary } from '../domain/agencySummary';
import {
  FULL_AGENCY,
  LAGGING_AGENCY,
  UNPOPULATED_AGENCY,
  fixtureSnapshot,
  matchFor,
} from '../test/agencyFixtures';
import type { SelectedPlace } from '../types';
import { agencyHeadline, AreaSummaryContent, monthRangeLabel } from './AreaSummaryContent';

const PLACE: SelectedPlace = { label: 'Lake Merritt', detail: 'Oakland, California', coordinates: [-122.26, 37.8] };
const SNAPSHOT = fixtureSnapshot();

function agencySummary(agency = FULL_AGENCY, overrides: Parameters<typeof matchFor>[1] = {}): AgencySummary {
  return summarizeAgency(matchFor(agency, overrides), SNAPSHOT)!;
}

function renderAgency(summary: AgencySummary, onOpenSources = vi.fn()) {
  render(
    <AreaSummaryContent
      onOpenSources={onOpenSources}
      place={PLACE}
      result={{ kind: 'agency', summary, snapshot: SNAPSHOT }}
    />,
  );
  return onOpenSources;
}

describe('AreaSummaryContent agency totals', () => {
  it('compares a complete year with the state and keeps the precision caveat visible', async () => {
    const onOpenSources = renderAgency(agencySummary());

    const band = screen.getByTestId('jurisdiction-band');
    expect(band).toHaveClass('activity-band--markedly-elevated');
    expect(band).toHaveTextContent('Well above the state rate');
    expect(band).toHaveTextContent('Violent offenses 3.0× the California rate');
    expect(band).toHaveTextContent('Property offenses ran 2.0× the state rate.');
    expect(band).toHaveTextContent('12 of 12 months reported');
    expect(screen.getByTestId('jurisdiction-window')).toHaveTextContent('Aug 2025 – Jul 2026');
    expect(screen.getByTestId('precision-notice')).toHaveTextContent('Lower precision.');
    expect(screen.getByTestId('violent-count')).toHaveTextContent('144');
    expect(screen.getByText('120 per 100k a year · California 40')).toBeInTheDocument();
    expect(screen.getByText('-16%')).toBeInTheDocument();
    expect(screen.getByText('Violent +20% · property -25%')).toBeInTheDocument();
    expect(screen.getByText('120,000')).toBeInTheDocument();
    expect(screen.getByText('City agency · FBI ORI CA0000001')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Monthly violent and property offense counts/ })).toBeInTheDocument();
    expect(screen.queryByTestId('stale-agency-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('partial-months-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('small-population-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('place-without-agency')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the FBI Crime Data Explorer' })).toHaveAttribute('href', SNAPSHOT.sourceUrl);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Read source caveats and methodology' }));
    expect(onOpenSources).toHaveBeenCalledOnce();
  });

  it('calls out a lagging, partial, small agency', () => {
    renderAgency(agencySummary(LAGGING_AGENCY));

    expect(screen.getByTestId('stale-agency-notice')).toHaveTextContent('newest FBI submission is for Dec 2025, 7 months');
    expect(screen.getByTestId('partial-months-warning')).toHaveTextContent('Only 11 of the 12 months were submitted');
    expect(screen.getByTestId('small-population-warning')).toHaveTextContent('Fewer than 10,000 residents');
    expect(screen.getByText('Needs two complete 12-month windows')).toBeInTheDocument();
    expect(document.querySelectorAll('.timeline__bar.is-missing')).toHaveLength(1);
  });

  it('names a city without an agency of its own', () => {
    renderAgency(agencySummary(UNPOPULATED_AGENCY, {
      basis: 'county',
      areaName: 'Fixture County',
      placeWithoutAgency: 'Contract city',
    }));

    expect(screen.getByTestId('place-without-agency')).toHaveTextContent(
      "Contract city has no FBI-reporting police agency of its own in this snapshot, so Fixture County Sheriff's Office's totals are shown.",
    );
    expect(screen.getByTestId('jurisdiction-band')).toHaveClass('activity-band--insufficient');
    expect(screen.getAllByText('No population-based rate')).toHaveLength(2);
    expect(screen.getAllByText('—')).toHaveLength(1);
  });
});

describe('agencyHeadline', () => {
  it('explains why a rate is missing', () => {
    expect(agencyHeadline(agencySummary(UNPOPULATED_AGENCY))).toBe('36 violent offenses; the FBI lists no population for a rate');
    const fewMonths = {
      ...FULL_AGENCY,
      violent: [...Array.from({ length: 20 }, () => null), 1, 1, 1, 1],
      property: [...Array.from({ length: 20 }, () => null), 1, 1, 1, 1],
    };
    expect(agencyHeadline(agencySummary(fewMonths))).toBe('4 of 12 months reported — too few for a rate');
    const noState = summarizeAgency(matchFor(FULL_AGENCY), fixtureSnapshot({
      stateRates: { violent: Array.from({ length: 24 }, () => null), property: Array.from({ length: 24 }, () => null) },
    }))!;
    expect(agencyHeadline(noState)).toBe('120 violent offenses per 100,000 residents');
  });

  it('formats month ranges', () => {
    expect(monthRangeLabel('2025-08', '2026-07')).toBe('Aug 2025 – Jul 2026');
  });
});

describe('AreaSummaryContent fallbacks', () => {
  it('shows statewide context when no agency covers the point', () => {
    render(
      <AreaSummaryContent
        onOpenSources={vi.fn()}
        place={PLACE}
        result={{ kind: 'state', summary: summarizeState(SNAPSHOT), snapshot: SNAPSHOT, agencyName: null }}
      />,
    );
    const band = screen.getByTestId('state-band');
    expect(band).toHaveTextContent('California: 40 violent offenses per 100,000 residents');
    expect(band).toHaveTextContent('No city, town or county agency in the FBI snapshot was matched to this point.');
    expect(screen.getByText('per 100k a year · US 30')).toBeInTheDocument();
    expect(screen.getByText('California statewide rates')).toBeInTheDocument();
  });

  it('names a silent agency and survives missing statewide rates', () => {
    const summary = {
      ...summarizeState(SNAPSHOT),
      ratesPer100k: null,
      nationalRatesPer100k: null,
    };
    render(
      <AreaSummaryContent
        onOpenSources={vi.fn()}
        place={PLACE}
        result={{ kind: 'state', summary, snapshot: SNAPSHOT, agencyName: 'Silent City Police Department' }}
      />,
    );
    expect(screen.getByTestId('state-band')).toHaveTextContent('California: no statewide rate');
    expect(screen.getByTestId('state-band')).toHaveTextContent('Silent City Police Department submitted no months');
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('explains points outside the states', async () => {
    const onOpenSources = vi.fn();
    render(<AreaSummaryContent onOpenSources={onOpenSources} place={PLACE} result={{ kind: 'outside' }} />);
    expect(screen.getByTestId('outside-coverage')).toHaveTextContent('Outside United States coverage');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review current coverage' }));
    expect(onOpenSources).toHaveBeenCalledOnce();
  });
});
