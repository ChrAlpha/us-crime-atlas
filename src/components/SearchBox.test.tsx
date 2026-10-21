import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURED_PLACES } from '../data/providers';
import { haversineDistance } from '../domain/geo';
import { clearPlaceSearchCache } from '../hooks/usePlaceSearch';
import type { SelectedPlace } from '../types';
import { matchingFeaturedPlaces, SearchBox, SUGGESTION_LIMIT, type SearchBoxProps } from './SearchBox';

const featured = (label: string) => FEATURED_PLACES.find((place) => place.label === label)!;
const TIMES_SQUARE = FEATURED_PLACES[0]!;
const THE_LOOP = featured('The Loop');
const PIKE_PLACE = featured('Pike Place');
const FIELD_NAME = 'Search a US address, hotel, or landmark';
const COVERED_LIST = 'Places with official incident data';
const labels = (places: readonly SelectedPlace[]) => places.map((place) => place.label);
/** The covered places closest to Times Square, nearest first. */
const NEAREST_TIMES_SQUARE = ['Times Square', 'Center City', 'Bushnell Park', 'Inner Harbor', 'Faneuil Hall', 'Downtown Bethesda'];
/** Every covered place in California, nearest to Times Square first: two more than the menu lists. */
const CALIFORNIA_FROM_TIMES_SQUARE = [
  'Mission Inn',
  'Hollywood',
  'Downtown Bakersfield',
  'Old Sacramento',
  'Downtown Berkeley',
  'Lake Merritt',
  'Union Square',
  'Downtown San Mateo',
];
/** "ton" (Boston, Washington, Arlington, …): exactly one more than the menu lists, from Times Square. */
const TON_FROM_TIMES_SQUARE = [
  'Faneuil Hall',
  'National Mall',
  'Charleston City Market',
  'Louisiana State Capitol',
  'AT&T Stadium',
  'Pike Place',
  'Museum of Glass',
];

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

function props(overrides: Partial<SearchBoxProps> = {}): SearchBoxProps {
  return {
    place: TIMES_SQUARE,
    locating: false,
    onPlaceSelect: vi.fn(),
    onLocate: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(implementation: () => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const field = () => screen.getByRole('searchbox', { name: FIELD_NAME });
const menu = () => screen.queryByRole('region', { name: 'Search suggestions' });
const submitButton = () => screen.getByRole('button', { name: 'Search' });
const coveredList = () => screen.queryByRole('list', { name: COVERED_LIST });
const coveredLabels = () => within(coveredList()!).getAllByRole('button')
  .map((button) => button.querySelector('strong')!.textContent);
const moreLine = () => document.querySelector('.search__more');

beforeEach(() => {
  clearPlaceSearchCache();
});

describe('matchingFeaturedPlaces', () => {
  it('offers every covered place, nearest first, before anything is typed', () => {
    for (const query of ['', '   ']) {
      const places = matchingFeaturedPlaces(query, TIMES_SQUARE.coordinates);
      expect(places).toHaveLength(FEATURED_PLACES.length);
      expect(new Set(places)).toEqual(new Set(FEATURED_PLACES));
      expect(labels(places).slice(0, SUGGESTION_LIMIT)).toEqual(NEAREST_TIMES_SQUARE);
      const distances = places.map((place) => haversineDistance(TIMES_SQUARE.coordinates, place.coordinates));
      expect(distances).toEqual([...distances].sort((left, right) => left - right));
    }
  });

  it('orders by distance from the point it is given', () => {
    expect(labels(matchingFeaturedPlaces('', PIKE_PLACE.coordinates)).slice(0, 3))
      .toEqual(['Pike Place', 'Museum of Glass', 'Old Sacramento']);
    expect(labels(matchingFeaturedPlaces('ton', PIKE_PLACE.coordinates))).toEqual([
      'Pike Place',
      'Museum of Glass',
      'AT&T Stadium',
      'Louisiana State Capitol',
      'National Mall',
      'Charleston City Market',
      'Faneuil Hall',
    ]);
  });

  it('returns a new array each time and leaves the featured order alone', () => {
    const before = labels(FEATURED_PLACES);
    const first = matchingFeaturedPlaces('', PIKE_PLACE.coordinates);
    const second = matchingFeaturedPlaces('', PIKE_PLACE.coordinates);

    expect(first).not.toBe(FEATURED_PLACES);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(labels(FEATURED_PLACES)).toEqual(before);
    expect(FEATURED_PLACES[0]).toBe(TIMES_SQUARE);
  });

  it('matches the label or the detail, ignoring case and outer spaces', () => {
    expect(labels(matchingFeaturedPlaces('times', THE_LOOP.coordinates))).toEqual(['Times Square']);
    expect(labels(matchingFeaturedPlaces('chicago', TIMES_SQUARE.coordinates))).toEqual(['The Loop']);
    expect(labels(matchingFeaturedPlaces('  CALIFORNIA ', TIMES_SQUARE.coordinates))).toEqual(CALIFORNIA_FROM_TIMES_SQUARE);
    expect(labels(matchingFeaturedPlaces('ton', TIMES_SQUARE.coordinates))).toEqual(TON_FROM_TIMES_SQUARE);
  });

  it('returns nothing for a place without official data', () => {
    expect(matchingFeaturedPlaces('Boise', TIMES_SQUARE.coordinates)).toEqual([]);
  });
});

describe('SearchBox', () => {
  it('keeps the menu closed until the field is focused', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    expect(menu()).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    await user.click(field());

    expect(menu()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 2, name: COVERED_LIST })).toBeInTheDocument();
    expect(coveredLabels()).toEqual(NEAREST_TIMES_SQUARE);
    expect(screen.queryByText(/Press Enter/)).not.toBeInTheDocument();
  });

  it('lists only the nearest covered places and says how to find the rest', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);
    await user.click(field());

    expect(coveredLabels()).toHaveLength(SUGGESTION_LIMIT);
    expect(SUGGESTION_LIMIT).toBe(6);
    const more = moreLine()!;
    expect(more.tagName).toBe('P');
    expect(more).toHaveTextContent(
      new RegExp(`^Nearest ${SUGGESTION_LIMIT} of ${FEATURED_PLACES.length}\\. Type a city or state to find the rest\\.$`),
    );
    expect(more.previousElementSibling).toBe(coveredList());
  });

  it('lists the places nearest the place being shown', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props({ place: PIKE_PLACE })} />);
    await user.click(field());

    expect(coveredLabels()).toEqual(['Pike Place', 'Museum of Glass', 'Old Sacramento', 'Downtown Berkeley', 'Lake Merritt', 'Union Square']);
    expect(moreLine()).toHaveTextContent(`Nearest 6 of ${FEATURED_PLACES.length}.`);
  });

  it('marks the covered place being shown', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchBox {...props({ place: THE_LOOP })} />);
    await user.click(field());

    const list = within(coveredList()!);
    expect(coveredLabels()[0]).toBe('The Loop');
    const current = list.getByRole('button', { name: /^The Loop/ });
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(within(current).getByText('Showing')).toHaveClass('search__badge');
    expect(within(current).getByText('Showing')).not.toHaveClass('is-covered');
    expect(list.getByRole('button', { name: /^Paramount Theatre/ })).not.toHaveAttribute('aria-current');
    expect(list.getAllByText('Showing')).toHaveLength(1);

    // Same longitude, different latitude: not the same point.
    rerender(<SearchBox {...props({ place: { label: 'Dropped pin', detail: '', coordinates: [THE_LOOP.coordinates[0], 42.5] } })} />);
    expect(list.queryByText('Showing')).not.toBeInTheDocument();
    expect(list.getAllByRole('button').filter((button) => button.hasAttribute('aria-current'))).toEqual([]);
  });

  it('keeps marking the place being shown among typed matches', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props({ place: PIKE_PLACE })} />);

    await user.type(field(), 'ton');

    expect(coveredLabels().slice(0, 2)).toEqual(['Pike Place', 'Museum of Glass']);
    const list = within(coveredList()!);
    const current = list.getByRole('button', { name: /^Pike Place/ });
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(within(current).getByText('Showing')).toHaveClass('search__badge');
    expect(list.getAllByText('Showing')).toHaveLength(1);
    expect(list.getByRole('button', { name: /^Museum of Glass/ })).not.toHaveAttribute('aria-current');
  });

  it('uses the current location and closes the menu', async () => {
    const onLocate = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox {...props({ onLocate })} />);

    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Use my location' }));

    expect(onLocate).toHaveBeenCalledOnce();
    expect(menu()).not.toBeInTheDocument();
  });

  it('disables the location option while locating', async () => {
    const onLocate = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox {...props({ locating: true, onLocate })} />);

    await user.click(field());
    const locate = screen.getByRole('button', { name: 'Finding your location…' });
    expect(locate).toBeDisabled();
    expect(locate.querySelector('svg')).toHaveClass('is-spinning');
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();

    await user.click(locate);
    expect(onLocate).not.toHaveBeenCalled();
    expect(menu()).toBeInTheDocument();
  });

  it('filters covered places locally while typing, without calling the service', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'ohio');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(coveredLabels()).toEqual(['Rock & Roll Hall of Fame', 'Short North', 'Fountain Square']);
    expect(moreLine()).not.toBeInTheDocument();
    expect(screen.getByText('Press Enter to search every US address')).toHaveClass('search__hint');
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.clear(field());
    await user.type(field(), 'Boise');

    expect(coveredList()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COVERED_LIST })).not.toBeInTheDocument();
    expect(moreLine()).not.toBeInTheDocument();
    expect(screen.getByText('Press Enter to search every US address')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts the typed matches beyond the list, in the singular for one', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'ton');

    expect(coveredLabels()).toEqual(TON_FROM_TIMES_SQUARE.slice(0, SUGGESTION_LIMIT));
    expect(moreLine()).toHaveTextContent(/^1 more place matches\. Keep typing to narrow the list\.$/);
  });

  it('counts the typed matches beyond the list, in the plural for several', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), '  California ');

    expect(coveredLabels()).toEqual(CALIFORNIA_FROM_TIMES_SQUARE.slice(0, SUGGESTION_LIMIT));
    expect(moreLine()).toHaveTextContent(/^2 more places match\. Keep typing to narrow the list\.$/);
    expect(screen.queryByText(/^Nearest/)).not.toBeInTheDocument();
  });

  it('drops the count once typing narrows the matches to the list', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'downtown');
    expect(coveredLabels()).toHaveLength(SUGGESTION_LIMIT);
    expect(moreLine()).toHaveTextContent(/^2 more places match\./);

    await user.type(field(), ' d');
    expect(coveredLabels()).toEqual(['Downtown Detroit', 'Downtown Dallas', 'Downtown Denver']);
    expect(moreLine()).not.toBeInTheDocument();

    await user.clear(field());
    expect(coveredLabels()).toEqual(NEAREST_TIMES_SQUARE);
    expect(moreLine()).toHaveTextContent(/^Nearest 6 of /);
  });

  it('opens the menu when typing after it was closed', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.click(field());
    await user.keyboard('{Escape}');
    expect(menu()).not.toBeInTheDocument();

    await user.keyboard('texas');
    expect(menu()).toBeInTheDocument();
    expect(coveredLabels()).toEqual(['Downtown Dallas', 'AT&T Stadium']);
  });

  it('chooses a covered place, then clears the query and closes the menu', async () => {
    const onPlaceSelect = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox {...props({ onPlaceSelect })} />);

    await user.type(field(), 'seattle');
    await user.click(within(coveredList()!).getByRole('button', { name: /^Pike Place/ }));

    expect(onPlaceSelect).toHaveBeenCalledExactlyOnceWith(PIKE_PLACE);
    expect(field()).toHaveValue('');
    expect(field()).not.toHaveFocus();
    expect(menu()).not.toBeInTheDocument();
  });

  it('searches only on explicit submit and marks results with official data', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(SEARCH_RESULTS));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'Times Square');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(submitButton());

    expect(fetchMock).toHaveBeenCalledOnce();
    const results = within(await screen.findByRole('list', { name: 'Search results' }));
    const covered = results.getByRole('button', { name: /^Times Square/ });
    expect(within(covered).getByText('Official data')).toHaveClass('search__badge', 'is-covered');
    expect(within(covered).getByText('Manhattan, New York County, New York, United States')).toBeInTheDocument();
    const uncovered = results.getByRole('button', { name: /^Idaho State Capitol/ });
    expect(within(uncovered).getByText('Map only')).toHaveClass('search__badge');
    expect(within(uncovered).getByText('Map only')).not.toHaveClass('is-covered');
    expect(screen.getByText('Results © OpenStreetMap contributors')).toBeInTheDocument();
    // Results replace the local suggestions.
    expect(coveredList()).not.toBeInTheDocument();
    expect(screen.queryByText(/Press Enter/)).not.toBeInTheDocument();
  });

  it('submits with Enter and shows a loading note until the service answers', async () => {
    let respond!: (response: Response) => void;
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => {
      respond = resolve;
    }));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'Union Square{Enter}');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText('Searching OpenStreetMap…')).toHaveClass('search__note');
    expect(submitButton()).toBeDisabled();
    expect(coveredList()).not.toBeInTheDocument();
    expect(screen.queryByText(/Press Enter/)).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledOnce();

    respond(jsonResponse([]));

    expect(await screen.findByText('No matching US place was found.')).toHaveClass('search__note', 'search__note--error');
    expect(screen.queryByText('Searching OpenStreetMap…')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
    expect(coveredLabels()).toEqual(['Union Square']);
  });

  it('does not submit an empty or blank query', async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.click(field());
    await user.keyboard('{Enter}');
    await user.type(field(), '   {Enter}');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
    // Blank text still shows the starting menu, plus a way to clear it.
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    expect(coveredLabels()).toEqual(NEAREST_TIMES_SQUARE);
    expect(moreLine()).toHaveTextContent(`Nearest 6 of ${FEATURED_PLACES.length}. Type a city or state to find the rest.`);
  });

  it('shows validation and service errors', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ error: 'busy' }, 503));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'NY{Enter}');
    expect(screen.getByText('Enter at least three characters.')).toHaveClass('search__note--error');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(field(), 'C Boise{Enter}');
    expect(await screen.findByText('Place search returned HTTP 503')).toHaveClass('search__note--error');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('chooses a search result, then clears the query and results', async () => {
    stubFetch(async () => jsonResponse(SEARCH_RESULTS));
    const onPlaceSelect = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox {...props({ onPlaceSelect })} />);

    await user.type(field(), 'capitol{Enter}');
    await user.click(await screen.findByRole('button', { name: /^Idaho State Capitol/ }));

    expect(onPlaceSelect).toHaveBeenCalledExactlyOnceWith<[SelectedPlace]>({
      label: 'Idaho State Capitol',
      detail: 'Boise, Ada County, Idaho, United States',
      coordinates: [-116.1996, 43.6178],
    });
    expect(field()).toHaveValue('');
    expect(field()).not.toHaveFocus();
    expect(menu()).not.toBeInTheDocument();

    await user.click(field());
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
    expect(coveredLabels()).toEqual(NEAREST_TIMES_SQUARE);
  });

  it('clears the query and results and keeps the field focused', async () => {
    stubFetch(async () => jsonResponse(SEARCH_RESULTS));
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), 'Times Square{Enter}');
    expect(await screen.findByRole('list', { name: 'Search results' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(menu()).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeInTheDocument();
  });

  it('closes the menu with Escape and lets later Escapes through', async () => {
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener('keydown', listener);
    const user = userEvent.setup();
    try {
      render(<SearchBox {...props()} />);

      await user.click(field());
      await user.keyboard('{Escape}');
      expect(menu()).not.toBeInTheDocument();
      expect(seen).not.toContain('Escape');
      expect(field()).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(seen).toContain('Escape');
      expect(menu()).not.toBeInTheDocument();
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });

  it('keeps the query on the Escape that closes the menu and clears it on the next', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.click(field());
    await user.keyboard('cali');
    const closing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      field().dispatchEvent(closing);
    });
    // Prevented so the browser's own search-field clearing cannot reopen the menu.
    expect(closing.defaultPrevented).toBe(true);
    expect(menu()).not.toBeInTheDocument();
    expect(field()).toHaveValue('cali');

    await user.keyboard('{Escape}');
    expect(field()).toHaveValue('');
    expect(menu()).not.toBeInTheDocument();
  });

  it('closes the menu on a pointer press outside it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SearchBox {...props()} />
        <button type="button">Map</button>
      </>,
    );

    await user.click(field());
    fireEvent.pointerDown(within(coveredList()!).getAllByRole('button')[0]!);
    expect(menu()).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Map' }));
    expect(menu()).not.toBeInTheDocument();
  });

  it('focuses the field with the / shortcut', () => {
    render(
      <>
        <SearchBox {...props()} />
        <button type="button">Map</button>
      </>,
    );

    const outside = screen.getByRole('button', { name: 'Map' });
    outside.focus();
    expect(fireEvent.keyDown(outside, { key: '/' })).toBe(false);
    expect(field()).toHaveFocus();
    expect(menu()).toBeInTheDocument();

    field().blur();
    expect(fireEvent.keyDown(document, { key: '/' })).toBe(false);
    expect(field()).toHaveFocus();
  });

  it('ignores / while typing elsewhere, with modifier keys, and other keys', () => {
    render(
      <>
        <SearchBox {...props()} />
        <input aria-label="Other field" />
        <textarea aria-label="Notes" />
        <select aria-label="Choice"><option>One</option></select>
        <div data-testid="editable" />
        <button type="button">Map</button>
      </>,
    );
    const editable = screen.getByTestId('editable');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const outside = screen.getByRole('button', { name: 'Map' });

    for (const target of [
      screen.getByRole('textbox', { name: 'Other field' }),
      screen.getByRole('textbox', { name: 'Notes' }),
      screen.getByRole('combobox', { name: 'Choice' }),
      editable,
    ]) {
      expect(fireEvent.keyDown(target, { key: '/' })).toBe(true);
    }
    expect(fireEvent.keyDown(outside, { key: '/', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: '/', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: '/', altKey: true })).toBe(true);
    expect(fireEvent.keyDown(outside, { key: 's' })).toBe(true);

    expect(field()).not.toHaveFocus();
    expect(menu()).not.toBeInTheDocument();
  });

  it('types a / inside the field itself', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.type(field(), '5th/Main');
    expect(field()).toHaveValue('5th/Main');
  });

  it('stops listening for the shortcut once unmounted', () => {
    const { unmount } = render(<SearchBox {...props()} />);
    unmount();
    expect(fireEvent.keyDown(document, { key: '/' })).toBe(true);
  });
});
