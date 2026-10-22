import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FEATURED_PLACES, providerMetadata } from '../../data/providers';
import { summarizeAgency, summarizeState } from '../../domain/agencySummary';
import type { AreaSummary } from '../../hooks/useAreaSummary';
import { FULL_AGENCY, LAGGING_AGENCY, fixtureSnapshot, matchFor } from '../../test/agencyFixtures';
import {
  CURRENT_WINDOW,
  DELAYED_WINDOW,
  EMPTY_WINDOW,
  evidenceFor,
  FRESH_WINDOW,
  META,
} from '../../test/panelFixtures';
import type { EvidenceBundle, LoadStatus, ProviderMeta } from '../../types';
import { AboutTab, CoveredPlaces, LIMITATIONS, type ThemePreference } from './AboutTab';

interface AboutOptions {
  provider?: ProviderMeta | null;
  evidence?: EvidenceBundle | null;
  jurisdiction?: AreaSummary | null;
  status?: LoadStatus;
  themePreference?: ThemePreference;
}

function renderAbout({
  provider = META,
  evidence = evidenceFor(FRESH_WINDOW),
  jurisdiction = null,
  status = 'ready',
  themePreference = 'system',
}: AboutOptions = {}) {
  const handlers = { onThemePreferenceChange: vi.fn(), onRefresh: vi.fn(), onPlaceSelect: vi.fn() };
  const view = render(
    <AboutTab
      evidence={evidence}
      jurisdiction={jurisdiction}
      provider={provider}
      status={status}
      themePreference={themePreference}
      {...handlers}
    />,
  );
  return { ...view, ...handlers };
}

const snapshot = fixtureSnapshot();
/** A county agency standing in for a city without its own, behind and missing a month. */
const LAGGING_RESULT: AreaSummary = {
  kind: 'agency',
  summary: summarizeAgency(matchFor(LAGGING_AGENCY, {
    ori: 'CA0000002',
    basis: 'county',
    areaName: 'Fixture County',
    placeWithoutAgency: 'Smallville town',
  }), snapshot)!,
  snapshot,
};
const FULL_RESULT: AreaSummary = { kind: 'agency', summary: summarizeAgency(matchFor(FULL_AGENCY), snapshot)!, snapshot };
const STATE_RESULT: AreaSummary = { kind: 'state', summary: summarizeState(snapshot), snapshot, agencyName: null };

function section(title: string) {
  return screen.getByRole('heading', { level: 3, name: title }).closest('section')!;
}

function covered() {
  return screen.getByRole('heading', { level: 3, name: 'Cities with official incident data' }).closest('details')!;
}

function fact(term: string) {
  return screen.queryByText(term, { selector: 'dt' })?.nextElementSibling ?? null;
}

const sectionTitles = () => screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);

describe('AboutTab source', () => {
  it('describes the source with its official dataset and dates', () => {
    renderAbout({ evidence: evidenceFor(CURRENT_WINDOW) });

    const source = section('Source');
    expect(within(source).getByText(META.agency, { selector: 'strong' })).toBeInTheDocument();
    const link = within(source).getByRole('link', { name: /NYPD Complaint Data Current \(YTD\)/ });
    expect(link).toHaveAttribute('href', META.sourceUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(within(link).getByText('(opens the official dataset)')).toHaveClass('sr-only');

    expect(fact('Dates analyzed')).toHaveTextContent(/^Sep 19 – Oct 18, 2026$/);
    expect(fact('Newest record')).toHaveTextContent(/^Oct 20, 2026$/);
    expect(fact('Behind today')).toHaveTextContent(/^1 day\. The window ends Oct 18, 2026\.$/);
    expect(fact('Updates')).toHaveTextContent(`${META.cadence}. ${META.delayNote}`);
    expect(fact('Locations')).toHaveTextContent(META.precisionNote);
    expect(fact('Coverage')).toHaveTextContent(META.coverageNote);
    expect(source).toHaveTextContent(`Field contract verified ${META.lastVerified}`);
  });

  it('pluralizes a longer lag', () => {
    renderAbout({ evidence: evidenceFor(DELAYED_WINDOW) });
    expect(fact('Behind today')).toHaveTextContent(/^113 days\. The window ends Jun 30, 2026\.$/);
  });

  it('leaves out the lag row for a feed that is up to date', () => {
    renderAbout({ evidence: evidenceFor(FRESH_WINDOW) });

    expect(fact('Dates analyzed')).toHaveTextContent('Sep 22 – Oct 21, 2026');
    expect(fact('Newest record')).toHaveTextContent('Oct 21, 2026');
    expect(fact('Behind today')).toBeNull();
  });

  it.each<[string, EvidenceBundle | null]>([
    ['no evidence yet', null],
    ['a feed without records', evidenceFor(EMPTY_WINDOW, { incidents: [] })],
  ])('leaves out the date rows with %s', (_, evidence) => {
    renderAbout({ evidence });

    expect(fact('Dates analyzed')).toBeNull();
    expect(fact('Newest record')).toBeNull();
    expect(fact('Behind today')).toBeNull();
    expect(fact('Updates')).toBeInTheDocument();
  });
});

describe('AboutTab notes', () => {
  it('lists every note about this view, expanded', () => {
    renderAbout({ evidence: evidenceFor(DELAYED_WINDOW) });

    const notes = section('Notes for this view');
    expect(within(notes).getByTestId('note-delayed')).toHaveTextContent('Feed is 113 days behind.');
    expect(notes.querySelector('details')).toBeNull();
  });

  it('shows settling days as a note', () => {
    renderAbout({ evidence: evidenceFor(CURRENT_WINDOW) });
    expect(within(section('Notes for this view')).getByTestId('note-settling')).toBeInTheDocument();
  });

  it.each<[string, EvidenceBundle | null]>([
    ['complete, fresh evidence', evidenceFor(FRESH_WINDOW)],
    ['no evidence', null],
  ])('has no notes section with %s', (_, evidence) => {
    renderAbout({ evidence });
    expect(screen.queryByRole('heading', { name: 'Notes for this view' })).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^note-/)).not.toBeInTheDocument();
  });
});

describe('AboutTab layout', () => {
  it('puts the source first and the covered cities after the limits', () => {
    renderAbout({ evidence: evidenceFor(CURRENT_WINDOW) });
    expect(sectionTitles()).toEqual([
      'Source',
      'Notes for this view',
      'How the comparison works',
      'Limits of this data',
      'Cities with official incident data',
      'Appearance',
    ]);
    expect(covered()).not.toHaveAttribute('open');
  });

  it.each<[string, AreaSummary | null]>([
    ['no FBI totals', null],
    ['a place outside the US', { kind: 'outside' }],
  ])('leads with the covered cities, unfolded, when the place has no feed and %s', (_, jurisdiction) => {
    renderAbout({ provider: null, evidence: null, jurisdiction, status: 'idle' });

    expect(sectionTitles()).toEqual([
      'Cities with official incident data',
      'How the comparison works',
      'Limits of this data',
      'Appearance',
    ]);
    expect(covered()).toHaveAttribute('open');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reload/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Showing')).not.toBeInTheDocument();
  });

  it('explains the method and its weights', () => {
    renderAbout();

    const method = section('How the comparison works');
    expect(method).toHaveTextContent('out to three times the radius');
    expect(method).toHaveTextContent('Below 0.65× reads as lower, up to 1.25× as similar');
    expect(within(method).getByRole('heading', { level: 4 })).toHaveTextContent(
      'Weights so frequent minor theft does not drown out rarer violence',
    );
    expect(within(method).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Homicide5.0×',
      'Sexual offense4.5×',
      'Robbery4.0×',
      'Assault3.7×',
      'Weapons3.4×',
      'Burglary2.5×',
      'Vehicle theft2.1×',
      'Theft1.3×',
      'Other1.0×',
    ]);
    expect(method).toHaveTextContent('They are not legal rankings or measures of harm.');
  });

  it('lists the limits of the data', () => {
    renderAbout();

    const limits = section('Limits of this data');
    expect(within(limits).getAllByRole('listitem').map((item) => item.textContent)).toEqual([...LIMITATIONS]);
    expect(limits.querySelectorAll('svg')).toHaveLength(LIMITATIONS.length);
    expect(LIMITATIONS.at(-1)).toBe(
      'Outside the local feeds, FBI totals describe a whole city or county. A citywide rate says nothing about which '
        + 'neighborhood you are in, and agencies send months on their own schedules.',
    );
  });

  it('credits the map and search providers', () => {
    const { container } = renderAbout();
    expect(container.querySelector('footer')).toHaveTextContent('Map © OpenStreetMap contributors, tiles by OpenFreeMap.');
  });
});

describe('AboutTab covered places', () => {
  it('offers a jump to each other city and marks the one showing', async () => {
    const user = userEvent.setup();
    const { onPlaceSelect } = renderAbout();

    const list = covered();
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(providerMetadata.length);
    expect(items[0]).toHaveTextContent(`${META.label}${META.agency} · published quarterly`);
    expect(within(items[0]!).getByText('Showing')).toHaveClass('covered__current');
    expect(within(items[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(list).getAllByText('Showing')).toHaveLength(1);

    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(
      FEATURED_PLACES.slice(1).map((place) => `Go to ${place.label}`),
    );

    await user.click(within(list).getByRole('button', { name: 'Go to The Loop' }));
    expect(onPlaceSelect).toHaveBeenCalledOnce();
    expect(onPlaceSelect).toHaveBeenCalledWith(FEATURED_PLACES.find((place) => place.label === 'The Loop'));
  });

  it('offers every featured place when none is showing', async () => {
    const user = userEvent.setup();
    const onPlaceSelect = vi.fn();
    render(<CoveredPlaces activeProviderId={null} onPlaceSelect={onPlaceSelect} open />);

    expect(screen.getAllByRole('button')).toHaveLength(FEATURED_PLACES.length);
    await user.click(screen.getByRole('button', { name: 'Go to Times Square' }));
    expect(onPlaceSelect).toHaveBeenCalledWith(FEATURED_PLACES[0]);
  });

  it('marks another active provider', () => {
    render(<CoveredPlaces activeProviderId="seattle" onPlaceSelect={vi.fn()} open />);

    expect(screen.getByText('Showing').closest('li')).toHaveTextContent(/^Seattle, Washington/);
    expect(screen.queryByRole('button', { name: 'Go to Pike Place' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Times Square' })).toBeInTheDocument();
  });

  it('folds the list behind a counted heading', () => {
    const { container } = render(<CoveredPlaces activeProviderId={null} onPlaceSelect={vi.fn()} open={false} />);

    const details = container.querySelector('details')!;
    expect(details).toHaveClass('section', 'covered-section');
    expect(details).not.toHaveAttribute('open');

    const summary = details.querySelector('summary')!;
    expect(summary).toHaveClass('section__head');
    const heading = within(summary).getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent(/^Cities with official incident data$/);
    expect(heading).toHaveAttribute('id', 'covered-title');
    expect(summary.querySelector('.covered-section__count')).toHaveTextContent(new RegExp(`^${providerMetadata.length}$`));
    expect(summary.querySelector('svg')).toHaveClass('covered-section__chevron');

    const list = details.querySelector('ul')!;
    expect(list).toHaveClass('covered');
    expect(list).toHaveAttribute('aria-labelledby', 'covered-title');
    expect(list.querySelectorAll('li')).toHaveLength(providerMetadata.length);
  });

  it('unfolds the list when asked', () => {
    const { container } = render(<CoveredPlaces activeProviderId={null} onPlaceSelect={vi.fn()} open />);

    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(screen.getByRole('list', { name: 'Cities with official incident data' })).toBeInTheDocument();
  });
});

describe('AboutTab FBI fallback', () => {
  it('describes the agency totals and folds the covered cities after the limits', () => {
    renderAbout({ provider: null, evidence: null, jurisdiction: LAGGING_RESULT, status: 'idle' });

    expect(sectionTitles()).toEqual([
      'Source',
      'Notes for this view',
      'How the FBI fallback works',
      'Limits of this data',
      'Cities with official incident data',
      'Appearance',
    ]);
    const source = section('Source');
    expect(within(source).getByText('Lagging Town Police Department', { selector: 'strong' })).toBeInTheDocument();
    expect(within(source).getByRole('link', { name: /FBI Crime Data Explorer/ })).toHaveAttribute('href', snapshot.sourceUrl);
    expect(fact('Area covered')).toHaveTextContent('All of Fixture County, not just this point');
    expect(fact('Months used')).toHaveTextContent('Jan 2025 – Dec 2025 (11 of 12 reported)');

    expect(covered()).not.toHaveAttribute('open');
    expect(screen.queryByRole('heading', { name: 'How the comparison works' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reload/ })).not.toBeInTheDocument();
  });

  it('lists every agency note, expanded', () => {
    renderAbout({ provider: null, evidence: null, jurisdiction: LAGGING_RESULT, status: 'idle' });

    const notes = section('Notes for this view');
    expect(notes.querySelector('details')).toBeNull();
    expect([...notes.querySelectorAll('.notes > .note')].map((note) => note.getAttribute('data-testid'))).toEqual([
      'note-precision',
      'note-no-city-agency',
      'note-small-population',
      'note-partial-months',
      'note-agency-behind',
    ]);
    expect(within(notes).getByTestId('note-agency-behind')).toHaveTextContent('Agency is 7 months behind.');
  });

  it('notes the lower precision even for a complete agency', () => {
    renderAbout({ provider: null, evidence: null, jurisdiction: FULL_RESULT, status: 'idle' });

    const notes = section('Notes for this view');
    expect([...notes.querySelectorAll('.note')].map((note) => note.getAttribute('data-testid'))).toEqual([
      'note-precision',
    ]);
    expect(fact('Residents served')).toHaveTextContent('120,000 · City agency, FBI ORI CA0000001');
  });

  it('describes the statewide rates without agency notes', () => {
    renderAbout({ provider: null, evidence: null, jurisdiction: STATE_RESULT, status: 'idle' });

    expect(sectionTitles()).toEqual([
      'Source',
      'How the FBI fallback works',
      'Limits of this data',
      'Cities with official incident data',
      'Appearance',
    ]);
    expect(within(section('Source')).getByText('California statewide rates', { selector: 'strong' })).toBeInTheDocument();
    expect(fact('Area covered')).toBeNull();
    expect(screen.queryByTestId(/^note-/)).not.toBeInTheDocument();
    expect(covered()).not.toHaveAttribute('open');
  });

  it('ignores FBI totals while a local feed covers the place', () => {
    renderAbout({ evidence: evidenceFor(CURRENT_WINDOW), jurisdiction: LAGGING_RESULT });

    expect(sectionTitles()).toEqual([
      'Source',
      'Notes for this view',
      'How the comparison works',
      'Limits of this data',
      'Cities with official incident data',
      'Appearance',
    ]);
    expect(within(section('Source')).getByText(META.agency, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByTestId('note-settling')).toBeInTheDocument();
    expect(screen.queryByTestId('note-precision')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'How the FBI fallback works' })).not.toBeInTheDocument();
    expect(covered()).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Reload from New York City source' })).toBeInTheDocument();
  });
});

describe('AboutTab appearance', () => {
  it.each<[ThemePreference, string]>([
    ['system', 'Match device'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ])('presses the %s option', (themePreference, label) => {
    renderAbout({ themePreference });

    const group = screen.getByRole('group', { name: 'Appearance' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Match device', 'Light', 'Dark']);
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-pressed', String(button.textContent === label));
    }
  });

  it('changes the theme preference', async () => {
    const user = userEvent.setup();
    const { onThemePreferenceChange } = renderAbout({ themePreference: 'system' });

    await user.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onThemePreferenceChange).toHaveBeenLastCalledWith('dark');
    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(onThemePreferenceChange).toHaveBeenLastCalledWith('light');
    await user.click(screen.getByRole('button', { name: 'Match device' }));
    expect(onThemePreferenceChange).toHaveBeenLastCalledWith('system');
    expect(onThemePreferenceChange).toHaveBeenCalledTimes(3);
  });
});

describe('AboutTab reload', () => {
  it('reloads from the source', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderAbout();

    const reload = screen.getByRole('button', { name: 'Reload from New York City source' });
    expect(reload).toBeEnabled();
    expect(reload.querySelector('svg')).not.toHaveClass('is-spinning');
    await user.click(reload);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('spins and disables the reload while loading', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderAbout({ status: 'loading' });

    const reload = screen.getByRole('button', { name: 'Reload from New York City source' });
    expect(reload).toBeDisabled();
    expect(reload.querySelector('svg')).toHaveClass('is-spinning');
    await user.click(reload);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
