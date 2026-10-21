import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { AgencyRecord, AgencySnapshot } from '../../data/agencyStats.types';
import { summarizeAgency, summarizeState, type AgencySummary } from '../../domain/agencySummary';
import {
  FULL_AGENCY,
  LAGGING_AGENCY,
  UNPOPULATED_AGENCY,
  fixtureSnapshot,
  matchFor,
} from '../../test/agencyFixtures';
import { stubBox } from '../../test/panelFixtures';
import type { SelectedPlace } from '../../types';
import {
  JurisdictionMethod,
  JurisdictionOverview,
  JurisdictionSource,
  JurisdictionSummary,
  OutsideSummary,
} from './Jurisdiction';

const months = (value: number | null, length = 24) => Array.from({ length }, () => value);

const TORONTO: SelectedPlace = { label: 'Toronto', detail: 'Ontario · Canada', coordinates: [-79.38, 43.65] };

/** Oklahoma's violent rate is 120 / 1.8 per 100k a year, so Fixture City's 120 reads as 1.8×. */
const OKLAHOMA = fixtureSnapshot({
  state: 'OK',
  stateName: 'Oklahoma',
  stateFips: '40',
  stateRates: { violent: months(120 / 1.8 / 12), property: months(150 / 12) },
});

/** Previous year 10 violent / 40 property a month; current year 12 / 50. */
const GROWING_AGENCY: AgencyRecord = {
  ...FULL_AGENCY,
  violent: [...months(10, 12), ...months(12, 12)],
  property: [...months(40, 12), ...months(50, 12)],
};

/**
 * Over Aug 2025 – Jul 2026: nothing sent for Aug 2025, a single offense in Sep 2025,
 * 30 offenses in Feb 2026, and 5 in every other month.
 */
const UNEVEN_AGENCY: AgencyRecord = {
  ...FULL_AGENCY,
  violent: [...months(2, 12), null, 1, 2, 2, 2, 2, 10, 2, 2, 2, 2, 2],
  property: [...months(3, 12), null, 0, 3, 3, 3, 3, 20, 3, 3, 3, 3, 3],
};

function summarize(agency: AgencyRecord, overrides: Parameters<typeof matchFor>[1] = {}, snapshot = fixtureSnapshot()) {
  return summarizeAgency(matchFor(agency, overrides), snapshot)!;
}

function agencyResult(summary: AgencySummary, snapshot: AgencySnapshot = fixtureSnapshot()) {
  return { kind: 'agency', summary, snapshot } as const;
}

function stateResult(agencyName: string | null, snapshot: AgencySnapshot = fixtureSnapshot()) {
  return { kind: 'state', summary: summarizeState(snapshot), snapshot, agencyName } as const;
}

const full = summarize(FULL_AGENCY);
const lagging = summarize(LAGGING_AGENCY, { ori: 'CA0000002', basis: 'county-subdivision', areaName: 'Lagging town' });
const unpopulated = summarize(UNPOPULATED_AGENCY, { ori: 'CA0000003', basis: 'county', areaName: 'Fixture County' });
const withoutState = summarize(FULL_AGENCY, {}, fixtureSnapshot({
  stateRates: { violent: months(null), property: months(150 / 12) },
}));

function fact(term: string) {
  return screen.queryByText(term, { selector: 'dt' })?.nextElementSibling ?? null;
}

describe('JurisdictionSummary for an agency', () => {
  it('compares the agency with its state on a scale named for the state', () => {
    const summary = summarize(FULL_AGENCY, {}, OKLAHOMA);
    render(<JurisdictionSummary place={TORONTO} result={agencyResult(summary, OKLAHOMA)} />);

    const section = screen.getByTestId('jurisdiction-finding');
    const headline = within(section).getByRole('heading', { level: 2 });
    expect(headline).toHaveTextContent(/^1\.8× as many violent offenses per resident as Oklahoma overall$/);
    expect(headline).toHaveAttribute('id', 'finding-headline');
    expect(headline).toHaveAttribute('data-peek-end');
    expect(headline).toHaveClass('finding__headline');
    expect(screen.getByRole('region', { name: headline.textContent! })).toBe(section);
    expect(section.querySelector('.finding__reason')).toBeNull();

    expect(within(section).getByRole('img')).toHaveAccessibleName('1.8× the Oklahoma rate (higher).');
    expect(screen.getByTestId('jurisdiction-window')).toHaveTextContent(
      /^FBI totals for all of Fixture, Aug 2025 – Jul 2026, per resident vs\. Oklahoma overall\. Not a safety rating\.$/,
    );
    const precision = within(section).getByTestId('note-precision');
    expect(precision).toHaveClass('note--caution');
    expect(precision).toHaveTextContent("Lower precision. No local incident feed covers this point, so the FBI's totals");
    expect(section.querySelector('details')).toBeNull();
  });

  it('marks a much higher rate on the scale', () => {
    render(<JurisdictionSummary place={TORONTO} result={agencyResult(full)} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      '3.0× as many violent offenses per resident as California overall',
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('3.0× the California rate (much higher).');
  });

  it('still draws the scale for a jurisdiction without violent offenses', () => {
    const quiet = summarize({ ...FULL_AGENCY, violent: months(0) });
    render(<JurisdictionSummary place={TORONTO} result={agencyResult(quiet)} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('No violent offenses in the 12 reported months');
    expect(screen.getByRole('img')).toHaveAccessibleName('0× the California rate (lower).');
  });

  it('explains a missing comparison without drawing a scale', () => {
    render(<JurisdictionSummary place={TORONTO} result={agencyResult(withoutState)} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('120 violent offenses per 100,000 residents a year');
    expect(screen.getByText('No California rate covers the same months, so there is no comparison.'))
      .toHaveClass('finding__reason');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('jurisdiction-window')).toHaveTextContent(
      /^FBI totals for all of Fixture, Aug 2025 – Jul 2026\. Not a safety rating\.$/,
    );
  });

  it('keeps notes that change the numbers open and folds the rest', () => {
    render(<JurisdictionSummary place={TORONTO} result={agencyResult(lagging)} />);

    const section = screen.getByTestId('jurisdiction-finding');
    expect(within(section).getByTestId('note-precision').closest('details')).toBeNull();
    expect(within(section).getByTestId('note-small-population').closest('details')).toBeNull();

    const details = section.querySelector('details')!;
    expect(details.querySelector('summary')).toHaveTextContent('2 notes about this data');
    expect([...details.querySelectorAll('.note')].map((note) => note.getAttribute('data-testid'))).toEqual([
      'note-partial-months',
      'note-agency-behind',
    ]);
  });
});

describe('JurisdictionSummary for a state', () => {
  it('frames the state rate as context for a silent agency', () => {
    render(<JurisdictionSummary place={TORONTO} result={stateResult('Silent City Police Department')} />);

    const section = screen.getByTestId('state-finding');
    const headline = within(section).getByRole('heading', { level: 2 });
    expect(headline).toHaveTextContent(/^No local police totals for this point$/);
    expect(headline).toHaveClass('finding__headline', 'finding__headline--quiet');
    expect(headline).toHaveAttribute('id', 'finding-headline');
    expect(headline).toHaveAttribute('data-peek-end');
    expect(screen.getByRole('region', { name: 'No local police totals for this point' })).toBe(section);

    expect(section.querySelector('.finding__reason')).toHaveTextContent(
      /^Silent City Police Department sent no months to the FBI in this snapshot\.$/,
    );
    expect(section.querySelector('.finding__context')).toHaveTextContent(
      /^California overall: 40 violent offenses per 100,000 residents a year \(US: 30\)\. That is context only; it says nothing about this area\.$/,
    );
    expect(section.querySelector('.finding__method')).toHaveTextContent(
      /^FBI statewide rates, Aug 2025 – Jul 2026\. Not a safety rating\.$/,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jurisdiction-finding')).not.toBeInTheDocument();
  });

  it('explains that no agency matched the point', () => {
    render(<JurisdictionSummary place={TORONTO} result={stateResult(null)} />);
    expect(screen.getByTestId('state-finding').querySelector('.finding__reason')).toHaveTextContent(
      'No city, town, or county police agency in the FBI data matched this point.',
    );
  });
});

describe('OutsideSummary', () => {
  it.each<[string, (place: SelectedPlace) => ReactElement]>([
    ['directly', (place) => <OutsideSummary place={place} />],
    ['for an outside result', (place) => <JurisdictionSummary place={place} result={{ kind: 'outside' }} />],
  ])('explains a place outside the US %s', (_, element) => {
    render(element(TORONTO));

    const state = screen.getByTestId('outside-coverage');
    expect(state).toHaveClass('state');
    expect(state.querySelector('svg')).toHaveClass('state__icon');
    const heading = within(state).getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Outside US coverage');
    expect(heading).toHaveAttribute('data-peek-end');
    expect(state).toHaveTextContent(
      'Toronto is not inside a US state or the District of Columbia, according to Census TIGERweb, so there is no '
        + 'police feed or FBI agency to summarize. The map still works.',
    );
    expect(screen.queryByTestId('jurisdiction-finding')).not.toBeInTheDocument();
    expect(screen.queryByTestId('state-finding')).not.toBeInTheDocument();
  });
});

describe('JurisdictionOverview facts', () => {
  it('gives twelve-month counts, rates against the state, and the change from the year before', () => {
    render(<JurisdictionOverview summary={full} />);

    expect(screen.getByTestId('violent-count')).toHaveTextContent(/^144$/);
    expect(fact('Violent')).toHaveTextContent(/^144120 per 100k a year · California 40$/);
    expect(fact('Property')).toHaveTextContent(/^360300 per 100k a year · California 150$/);
    expect(fact('Year over year')).toHaveTextContent(/^-16%/);
    expect(screen.getByTestId('jurisdiction-trend')).toHaveTextContent(/^16% fewer than the 12 months before$/);
  });

  it('signs an increase', () => {
    render(<JurisdictionOverview summary={summarize(GROWING_AGENCY)} />);

    expect(fact('Year over year')!.querySelector('strong')).toHaveTextContent(/^\+24%$/);
    expect(screen.getByTestId('jurisdiction-trend')).toHaveTextContent('24% more than the 12 months before');
  });

  it('shows no rates without a population and an unchanged year without a sign', () => {
    render(<JurisdictionOverview summary={unpopulated} />);

    expect(screen.getByTestId('violent-count')).toHaveTextContent('36');
    expect(fact('Violent')).toHaveTextContent(/^36No rate per resident$/);
    expect(fact('Property')).toHaveTextContent(/^108No rate per resident$/);
    expect(fact('Year over year')!.querySelector('strong')).toHaveTextContent(/^0%$/);
    expect(screen.getByTestId('jurisdiction-trend')).toHaveTextContent('Same as the 12 months before');
  });

  it('leaves out the trend without two complete years', () => {
    render(<JurisdictionOverview summary={lagging} />);

    expect(fact('Violent')).toHaveTextContent(/^22300 per 100k a year · California 40$/);
    expect(fact('Year over year')!.querySelector('strong')).toHaveTextContent(/^–$/);
    expect(screen.getByTestId('jurisdiction-trend')).toHaveTextContent('No trend: needs two complete years');
  });

  it('gives the rates alone when the state has none for the same months', () => {
    expect(withoutState.stateRatesPer100k).toBeNull();
    render(<JurisdictionOverview summary={withoutState} />);

    expect(fact('Violent')).toHaveTextContent(/^144120 per 100k a year$/);
    expect(fact('Property')).toHaveTextContent(/^360300 per 100k a year$/);
  });
});

describe('JurisdictionOverview monthly chart', () => {
  function renderChart(summary: AgencySummary) {
    const { container } = render(<JurisdictionOverview summary={summary} />);
    const section = screen.getByRole('heading', { level: 3, name: 'Month by month' }).closest('section')!;
    const plot = within(section).getByRole('img');
    return {
      section,
      plot,
      readout: section.querySelector('.bars__readout')!,
      columns: [...plot.querySelectorAll<HTMLElement>('.bars__col')],
      ticks: [...container.querySelectorAll('.bars__axis span')].map((tick) => tick.textContent),
    };
  }

  it('charts every month of a complete year', () => {
    const { section, plot, readout, columns, ticks } = renderChart(full);

    expect(within(section).getByRole('heading', { level: 4 })).toHaveTextContent(
      'Violent and property offenses across all of Fixture',
    );
    expect(plot).toHaveAccessibleName(
      'Monthly violent and property offenses for Fixture City Police Department, Aug 2025 – Jul 2026. '
        + 'Busiest month Aug 2025 with 42 offenses.',
    );
    expect(readout).toHaveTextContent(/^Busiest month: Aug 2025, 42 offenses$/);
    expect(columns).toHaveLength(12);
    expect(columns.every((column) => column.style.getPropertyValue('--h') === '100%')).toBe(true);
    expect(columns.some((column) => column.classList.contains('is-missing'))).toBe(false);
    expect(ticks).toEqual(['Aug 2025', 'Jul 2026']);
    expect(section.querySelector('.section__aside')).toBeNull();
  });

  it('draws a month the agency did not send as a hollow column and says so', () => {
    const { section, plot, readout, columns } = renderChart(summarize(UNEVEN_AGENCY));

    expect(plot).toHaveAccessibleName(
      'Monthly violent and property offenses for Fixture City Police Department, Aug 2025 – Jul 2026. '
        + 'Busiest month Feb 2026 with 30 offenses.',
    );
    expect(readout).toHaveTextContent(/^Busiest month: Feb 2026, 30 offenses$/);
    expect(columns[0]).toHaveClass('bars__col', 'is-missing');
    expect(columns[0]!.style.getPropertyValue('--h')).toBe('0%');
    expect(columns.filter((column) => column.classList.contains('is-missing'))).toEqual([columns[0]]);
    expect(columns[6]!.style.getPropertyValue('--h')).toBe('100%');
    expect(section.querySelector('.section__aside')).toHaveTextContent(
      /^Hollow bars mark months the agency did not send to the FBI\.$/,
    );

    stubBox(plot, { left: 0, width: 1200 });
    fireEvent.pointerMove(plot, { clientX: 50 });
    expect(readout).toHaveTextContent(/^Aug 2025: not reported$/);
    fireEvent.pointerMove(plot, { clientX: 150 });
    expect(readout).toHaveTextContent(/^Sep 2025: 1 offense$/);
    fireEvent.pointerMove(plot, { clientX: 650 });
    expect(readout).toHaveTextContent(/^Feb 2026: 30 offenses$/);
  });

  it('marks a gap inside a lagging agency\'s own window', () => {
    const { readout, columns, ticks, section } = renderChart(lagging);

    expect(ticks).toEqual(['Jan 2025', 'Dec 2025']);
    expect(readout).toHaveTextContent('Busiest month: Jan 2025, 7 offenses');
    expect(columns.map((column) => column.classList.contains('is-missing'))).toEqual(
      Array.from({ length: 12 }, (_, index) => index === 5),
    );
    expect(section.querySelector('.section__aside')).toBeInTheDocument();
  });

  it('counts nothing rather than inventing a busiest month when no month has totals', () => {
    const empty = { ...full, monthly: full.monthly.map((month) => ({ ...month, violent: null, property: null })) };
    const { readout, columns } = renderChart(empty);

    expect(readout).toHaveTextContent('Busiest month: Aug 2025, 0 offenses');
    expect(columns.every((column) => column.classList.contains('is-missing'))).toBe(true);
  });
});

describe('JurisdictionSource', () => {
  function sourceSection() {
    return screen.getByRole('heading', { level: 3, name: 'Source' }).closest('section')!;
  }

  it('names the agency, its area, and the FBI source', () => {
    const snapshot = fixtureSnapshot();
    render(<JurisdictionSource result={{ kind: 'agency', summary: full, snapshot }} />);

    const source = sourceSection();
    expect(within(source).getByText('Fixture City Police Department', { selector: 'strong' })).toBeInTheDocument();
    const link = within(source).getByRole('link', { name: /FBI Crime Data Explorer/ });
    expect(link).toHaveAttribute('href', snapshot.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(within(link).getByText("(opens the FBI's site)")).toHaveClass('sr-only');

    expect(fact('Area covered')).toHaveTextContent(/^All of Fixture, not just this point$/);
    expect(fact('Residents served')).toHaveTextContent(/^120,000 · City agency, FBI ORI CA0000001$/);
    expect(fact('Months used')).toHaveTextContent(/^Aug 2025 – Jul 2026 \(12 of 12 reported\)$/);
    expect(fact('Updates')).toHaveTextContent(
      /^Agencies send monthly totals on their own schedules\. Explorer refreshed 10\/15\/2026\.$/,
    );
    expect(fact('Locations')).toHaveTextContent(/^None\. Totals describe the whole jurisdiction\.$/);
    expect(source.querySelector('.source__verified')).toHaveTextContent(/^Snapshot taken 2026-10-21$/);
  });

  it('says when the FBI lists no population', () => {
    render(<JurisdictionSource result={agencyResult(unpopulated)} />);

    expect(fact('Area covered')).toHaveTextContent('All of Fixture County, not just this point');
    expect(fact('Residents served')).toHaveTextContent(/^Not listed · County agency, FBI ORI CA0000003$/);
  });

  it('counts the months a lagging agency reported', () => {
    render(<JurisdictionSource result={{ kind: 'agency', summary: lagging, snapshot: fixtureSnapshot() }} />);
    expect(fact('Months used')).toHaveTextContent(/^Jan 2025 – Dec 2025 \(11 of 12 reported\)$/);
  });

  it('names the statewide rates without agency facts', () => {
    render(<JurisdictionSource result={stateResult('Silent City Police Department', OKLAHOMA)} />);

    const source = sourceSection();
    expect(within(source).getByText('Oklahoma statewide rates', { selector: 'strong' })).toBeInTheDocument();
    expect(within(source).getByRole('link', { name: /FBI Crime Data Explorer/ })).toHaveAttribute('href', OKLAHOMA.sourceUrl);
    expect(fact('Area covered')).toBeNull();
    expect(fact('Residents served')).toBeNull();
    expect(fact('Months used')).toHaveTextContent(/^Aug 2025 – Jul 2026$/);
    expect(fact('Locations')).toBeInTheDocument();
  });
});

describe('JurisdictionMethod', () => {
  it('explains how the FBI fallback picks an agency and compares it', () => {
    render(<JurisdictionMethod />);

    const method = screen.getByRole('heading', { level: 3, name: 'How the FBI fallback works' }).closest('section')!;
    expect(method).toHaveTextContent('its city police, else its town or township police, else the county sheriff');
    expect(method).toHaveTextContent('compared with the state\'s rate over the same months');
    expect(method).toHaveTextContent('Where no agency matches, only the statewide rate is shown, as context.');
    expect(method).toHaveTextContent('there are no incident points, no nearby comparison, and no block-level detail.');
    expect(method.querySelectorAll('.prose p')).toHaveLength(3);
  });
});
