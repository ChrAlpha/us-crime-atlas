import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURED_PLACES, providers } from '../data/providers';
import { clearPlaceSearchCache } from '../hooks/usePlaceSearch';
import type { SelectedPlace } from '../types';
import { summarizeAgency, summarizeState } from '../domain/agencySummary';
import { FULL_AGENCY, fixtureSnapshot, matchFor } from '../test/agencyFixtures';
import { SearchPanel, type SearchPanelProps } from './SearchPanel';

const NEW_YORK = providers.find((provider) => provider.meta.id === 'new-york')!;
const TIMES_SQUARE = FEATURED_PLACES[0]!;
const THE_LOOP = FEATURED_PLACES[3]!;

function props(overrides: Partial<SearchPanelProps> = {}): SearchPanelProps {
  return {
    place: TIMES_SQUARE,
    provider: NEW_YORK,
    providerStatus: 'ready',
    areaSummary: null,
    radiusMeters: 1000,
    windowDays: 30,
    activeGroups: ['violent', 'property', 'vehicle', 'weapons', 'other'],
    locating: false,
    onPlaceSelect: vi.fn(),
    onRadiusChange: vi.fn(),
    onWindowChange: vi.fn(),
    onToggleGroup: vi.fn(),
    onLocate: vi.fn(),
    onOpenSources: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const SEARCH_RESULTS = [
  {
    display_name: 'Times Square, Manhattan, New York County, New York, United States',
    name: 'Times Square',
    lat: '40.758',
    lon: '-73.9855',
  },
  {
    display_name: 'Idaho State Capitol, Boise, Ada County, Idaho, United States',
    name: 'Idaho State Capitol',
    lat: '43.6178',
    lon: '-116.1996',
  },
];

beforeEach(() => {
  clearPlaceSearchCache();
});

describe('SearchPanel', () => {
  it('shows the selected place and a fallback for dropped pins', () => {
    const { rerender } = render(<SearchPanel {...props()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Times Square' })).toBeInTheDocument();
    expect(screen.getByText('Manhattan · New York City')).toBeInTheDocument();

    rerender(<SearchPanel {...props({ place: { label: 'Dropped pin', detail: '', coordinates: [-73.99, 40.75] } })} />);
    expect(screen.getByText('Dropped map point')).toBeInTheDocument();
  });

  it('searches only on explicit submit and marks covered results', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SEARCH_RESULTS));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchPanel {...props()} />);

    const input = screen.getByRole('textbox', { name: 'Search a US address or landmark' });
    await user.type(input, 'Times Square');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const covered = await screen.findByRole('button', { name: /Times Square.*Official feed/ });
    expect(within(covered).getByText('Official feed')).toHaveClass('is-covered');
    const uncovered = screen.getByRole('button', { name: /Idaho State Capitol.*Map only/ });
    expect(within(uncovered).getByText('Map only')).not.toHaveClass('is-covered');
    expect(screen.getByText('Search results © OpenStreetMap contributors')).toBeInTheDocument();
  });

  it('submits with the Enter key and disables the button while finding', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      respond = resolve;
    })));
    const user = userEvent.setup();
    render(<SearchPanel {...props()} />);

    await user.type(screen.getByRole('textbox', { name: 'Search a US address or landmark' }), 'Union Square{Enter}');

    expect(screen.getByRole('button', { name: 'Finding' })).toBeDisabled();
    respond(jsonResponse([]));
    expect(await screen.findByText('No matching US place was found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  });

  it('selects a search result, then clears the query and results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(SEARCH_RESULTS)));
    const onPlaceSelect = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ onPlaceSelect })} />);

    const input = screen.getByRole('textbox', { name: 'Search a US address or landmark' });
    await user.type(input, 'capitol');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: /Idaho State Capitol/ }));

    expect(onPlaceSelect).toHaveBeenCalledWith<[SelectedPlace]>({
      label: 'Idaho State Capitol',
      detail: 'Boise, Ada County, Idaho, United States',
      coordinates: [-116.1996, 43.6178],
    });
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Idaho State Capitol/ })).not.toBeInTheDocument();
  });

  it('shows validation feedback for a short query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SearchPanel {...props()} />);

    await user.type(screen.getByRole('textbox', { name: 'Search a US address or landmark' }), 'NY');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByText('Enter at least three characters.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the featured place that matches the selection and selects others', async () => {
    const onPlaceSelect = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ place: THE_LOOP, onPlaceSelect })} />);

    const featured = within(screen.getByLabelText('Featured covered places'));
    expect(featured.getAllByRole('button')).toHaveLength(FEATURED_PLACES.length);
    expect(featured.getByRole('button', { name: 'The Loop' })).toHaveAttribute('aria-pressed', 'true');
    expect(featured.getByRole('button', { name: 'The Loop' })).toHaveClass('is-active');
    expect(featured.getByRole('button', { name: 'Times Square' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(featured.getByRole('button', { name: 'Pike Place' }));
    expect(onPlaceSelect).toHaveBeenCalledWith(FEATURED_PLACES.find((place) => place.label === 'Pike Place'));
  });

  it('describes a supported provider and opens the source details', async () => {
    const onOpenSources = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ onOpenSources })} />);

    const strip = screen.getByRole('button', { name: 'Sources & methodology' });
    expect(strip).toHaveClass('provider-strip');
    expect(strip).not.toHaveClass('is-unsupported');
    expect(strip).not.toHaveClass('has-error');
    expect(strip).toHaveTextContent('New York City Police Department');
    expect(strip).toHaveTextContent(`${NEW_YORK.meta.cadence}. ${NEW_YORK.meta.precisionNote}`);

    await user.click(strip);
    expect(onOpenSources).toHaveBeenCalledOnce();
  });

  it('explains a place without a verified feed', () => {
    render(<SearchPanel {...props({ provider: null, providerStatus: 'idle' })} />);

    const strip = screen.getByRole('button', { name: 'Sources & methodology' });
    expect(strip).toHaveClass('is-unsupported');
    expect(strip).toHaveTextContent('No verified incident feed here yet');
    expect(strip).toHaveTextContent('will not substitute proxy or synthetic crime data');
  });

  it('names the FBI agency standing in for a missing feed', () => {
    const snapshot = fixtureSnapshot();
    const summary = summarizeAgency(matchFor(FULL_AGENCY), snapshot)!;
    const { rerender } = render(
      <SearchPanel {...props({ provider: null, providerStatus: 'idle', areaSummary: { kind: 'agency', summary, snapshot } })} />,
    );

    const strip = screen.getByRole('button', { name: 'Sources & methodology' });
    expect(strip).toHaveClass('is-coarse');
    expect(strip).toHaveTextContent('Fixture City Police Department');
    expect(strip).toHaveTextContent('FBI twelve-month totals for the whole jurisdiction.');

    rerender(
      <SearchPanel
        {...props({
          provider: null,
          providerStatus: 'idle',
          areaSummary: { kind: 'state', summary: summarizeState(snapshot), snapshot, agencyName: null },
        })}
      />,
    );
    expect(strip).toHaveTextContent('California statewide context');
  });

  it('flags a provider that failed to respond', () => {
    render(<SearchPanel {...props({ providerStatus: 'error' })} />);

    const strip = screen.getByRole('button', { name: 'Sources & methodology' });
    expect(strip).toHaveClass('has-error');
    expect(strip).toHaveTextContent('New York City Police Department is temporarily unavailable');
    expect(strip).toHaveTextContent('The official source could not be loaded. Retry from the evidence panel.');
  });

  it('toggles the collapsible analysis settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<SearchPanel {...props()} />);

    const toggle = screen.getByRole('button', { name: 'Analysis settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.analysis-controls')).not.toHaveClass('is-open');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.analysis-controls')).toHaveClass('is-open');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('reflects and changes the analysis radius', async () => {
    const onRadiusChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ radiusMeters: 500, onRadiusChange })} />);

    const radius = within(screen.getByRole('group', { name: 'Analysis radius' }));
    expect(radius.getAllByRole('button').map((button) => button.textContent)).toEqual(['500 m', '1 km', '2 km']);
    expect(radius.getByRole('button', { name: '500 m' })).toHaveAttribute('aria-pressed', 'true');
    expect(radius.getByRole('button', { name: '2 km' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(radius.getByRole('button', { name: '2 km' }));
    expect(onRadiusChange).toHaveBeenCalledWith(2000);
  });

  it('reflects and changes the observation window', async () => {
    const onWindowChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ windowDays: 60, onWindowChange })} />);

    const windows = within(screen.getByRole('group', { name: 'Observation window' }));
    expect(windows.getAllByRole('button').map((button) => button.textContent)).toEqual(['14 d', '30 d', '60 d', '90 d']);
    expect(windows.getByRole('button', { name: '60 d' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(windows.getByRole('button', { name: '14 d' }));
    expect(onWindowChange).toHaveBeenCalledWith(14);
  });

  it('reflects and toggles published incident groups', async () => {
    const onToggleGroup = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel {...props({ activeGroups: ['violent', 'weapons'], onToggleGroup })} />);

    const groups = within(screen.getByRole('group', { name: 'Published incident groups' }));
    expect(groups.getByRole('button', { name: 'Violent' })).toHaveAttribute('aria-pressed', 'true');
    expect(groups.getByRole('button', { name: 'Weapons' })).toHaveAttribute('aria-pressed', 'true');
    expect(groups.getByRole('button', { name: 'Property' })).toHaveAttribute('aria-pressed', 'false');
    expect(groups.getByRole('button', { name: 'Property' })).not.toHaveClass('is-active');

    await user.click(groups.getByRole('button', { name: 'Property' }));
    await user.click(groups.getByRole('button', { name: 'Violent' }));
    expect(onToggleGroup.mock.calls).toEqual([['property'], ['violent']]);
  });

  it('requests the current location and disables the control while locating', async () => {
    const onLocate = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SearchPanel {...props({ onLocate })} />);

    await user.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(onLocate).toHaveBeenCalledOnce();

    rerender(<SearchPanel {...props({ onLocate, locating: true })} />);
    const locate = screen.getByRole('button', { name: 'Use current location' });
    expect(locate).toBeDisabled();
    expect(locate.querySelector('svg')).toHaveClass('is-spinning');
  });
});
