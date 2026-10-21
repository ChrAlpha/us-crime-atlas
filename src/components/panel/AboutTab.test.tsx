import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FEATURED_PLACES, providerMetadata } from '../../data/providers';
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
  status?: LoadStatus;
  themePreference?: ThemePreference;
}

function renderAbout({
  provider = META,
  evidence = evidenceFor(FRESH_WINDOW),
  status = 'ready',
  themePreference = 'system',
}: AboutOptions = {}) {
  const handlers = { onThemePreferenceChange: vi.fn(), onRefresh: vi.fn(), onPlaceSelect: vi.fn() };
  const view = render(
    <AboutTab evidence={evidence} provider={provider} status={status} themePreference={themePreference} {...handlers} />,
  );
  return { ...view, ...handlers };
}

function section(title: string) {
  return screen.getByRole('heading', { level: 3, name: title }).closest('section')!;
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
  });

  it('leads with the covered cities when the place has no feed', () => {
    renderAbout({ provider: null, evidence: null, status: 'idle' });

    expect(sectionTitles()).toEqual([
      'Cities with official incident data',
      'How the comparison works',
      'Limits of this data',
      'Appearance',
    ]);
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

    const covered = section('Cities with official incident data');
    const items = within(covered).getAllByRole('listitem');
    expect(items).toHaveLength(providerMetadata.length);
    expect(items[0]).toHaveTextContent(`${META.label}${META.agency} · published quarterly`);
    expect(within(items[0]!).getByText('Showing')).toHaveClass('covered__current');
    expect(within(items[0]!).queryByRole('button')).not.toBeInTheDocument();
    expect(within(covered).getAllByText('Showing')).toHaveLength(1);

    const buttons = within(covered).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(
      FEATURED_PLACES.slice(1).map((place) => `Go to ${place.label}`),
    );

    await user.click(within(covered).getByRole('button', { name: 'Go to The Loop' }));
    expect(onPlaceSelect).toHaveBeenCalledOnce();
    expect(onPlaceSelect).toHaveBeenCalledWith(FEATURED_PLACES.find((place) => place.label === 'The Loop'));
  });

  it('offers every featured place when none is showing', async () => {
    const user = userEvent.setup();
    const onPlaceSelect = vi.fn();
    render(<CoveredPlaces activeProviderId={null} onPlaceSelect={onPlaceSelect} />);

    expect(screen.getAllByRole('button')).toHaveLength(FEATURED_PLACES.length);
    await user.click(screen.getByRole('button', { name: 'Go to Times Square' }));
    expect(onPlaceSelect).toHaveBeenCalledWith(FEATURED_PLACES[0]);
  });

  it('marks another active provider', () => {
    render(<CoveredPlaces activeProviderId="seattle" onPlaceSelect={vi.fn()} />);

    expect(screen.getByText('Showing').closest('li')).toHaveTextContent(/^Seattle, Washington/);
    expect(screen.queryByRole('button', { name: 'Go to Pike Place' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to Times Square' })).toBeInTheDocument();
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
