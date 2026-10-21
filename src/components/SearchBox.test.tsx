import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEATURED_PLACES } from '../data/providers';
import { clearPlaceSearchCache } from '../hooks/usePlaceSearch';
import type { SelectedPlace } from '../types';
import { matchingFeaturedPlaces, SearchBox, type SearchBoxProps } from './SearchBox';

const TIMES_SQUARE = FEATURED_PLACES[0]!;
const THE_LOOP = FEATURED_PLACES.find((place) => place.label === 'The Loop')!;
const PIKE_PLACE = FEATURED_PLACES.find((place) => place.label === 'Pike Place')!;
const FIELD_NAME = 'Search a US address, hotel, or landmark';
const COVERED_LIST = 'Places with official incident data';

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

beforeEach(() => {
  clearPlaceSearchCache();
});

describe('matchingFeaturedPlaces', () => {
  it('offers every covered place before anything is typed', () => {
    expect(matchingFeaturedPlaces('')).toBe(FEATURED_PLACES);
    expect(matchingFeaturedPlaces('   ')).toBe(FEATURED_PLACES);
  });

  it('matches the label or the detail, ignoring case and outer spaces', () => {
    expect(matchingFeaturedPlaces('times').map((place) => place.label)).toEqual(['Times Square']);
    expect(matchingFeaturedPlaces('chicago').map((place) => place.label)).toEqual(['The Loop']);
    expect(matchingFeaturedPlaces('  CALIFORNIA ').map((place) => place.label)).toEqual(['Hollywood', 'Union Square']);
  });

  it('returns nothing for a place without official data', () => {
    expect(matchingFeaturedPlaces('Boise')).toEqual([]);
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
    expect(coveredLabels()).toEqual(FEATURED_PLACES.map((place) => place.label));
    expect(screen.queryByText(/Press Enter/)).not.toBeInTheDocument();
  });

  it('marks the covered place being shown', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SearchBox {...props({ place: THE_LOOP })} />);
    await user.click(field());

    const list = within(coveredList()!);
    const current = list.getByRole('button', { name: /^The Loop/ });
    expect(current).toHaveAttribute('aria-current', 'location');
    expect(within(current).getByText('Showing')).toHaveClass('search__badge');
    expect(list.getByRole('button', { name: /^Times Square/ })).not.toHaveAttribute('aria-current');
    expect(list.getAllByText('Showing')).toHaveLength(1);

    // Same longitude, different latitude: not the same point.
    rerender(<SearchBox {...props({ place: { label: 'Dropped pin', detail: '', coordinates: [THE_LOOP.coordinates[0], 42.5] } })} />);
    expect(list.queryByText('Showing')).not.toBeInTheDocument();
    expect(list.getAllByRole('button').filter((button) => button.hasAttribute('aria-current'))).toEqual([]);
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

    await user.type(field(), 'cali');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(coveredLabels()).toEqual(['Hollywood', 'Union Square']);
    expect(screen.getByText('Press Enter to search every US address')).toHaveClass('search__hint');
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();

    await user.clear(field());
    await user.type(field(), 'Boise');

    expect(coveredList()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: COVERED_LIST })).not.toBeInTheDocument();
    expect(screen.getByText('Press Enter to search every US address')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the menu when typing after it was closed', async () => {
    const user = userEvent.setup();
    render(<SearchBox {...props()} />);

    await user.click(field());
    await user.keyboard('{Escape}');
    expect(menu()).not.toBeInTheDocument();

    await user.keyboard('texas');
    expect(menu()).toBeInTheDocument();
    expect(coveredLabels()).toEqual(['Downtown Dallas']);
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
    expect(coveredLabels()).toHaveLength(FEATURED_PLACES.length);
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
    expect(coveredLabels()).toHaveLength(FEATURED_PLACES.length);
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
