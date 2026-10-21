import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FEATURED_PLACES, findProviderForPoint } from '../data/providers';
import { usePlaceSearch } from '../hooks/usePlaceSearch';
import type { SelectedPlace } from '../types';
import { ArrowRightIcon, CloseIcon, LocateIcon, PinIcon, SearchIcon } from './Icons';

export interface SearchBoxProps {
  place: SelectedPlace;
  locating: boolean;
  onPlaceSelect(place: SelectedPlace): void;
  onLocate(): void;
}

function samePoint(left: SelectedPlace, right: SelectedPlace) {
  return Math.abs(left.coordinates[0] - right.coordinates[0]) < 0.0001
    && Math.abs(left.coordinates[1] - right.coordinates[1]) < 0.0001;
}

/** Covered cities that match what has been typed so far, without a network request. */
export function matchingFeaturedPlaces(query: string): readonly SelectedPlace[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return FEATURED_PLACES;
  return FEATURED_PLACES.filter((featured) => (
    `${featured.label} ${featured.detail}`.toLowerCase().includes(needle)
  ));
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function SearchBox({ place, locating, onPlaceSelect, onLocate }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = usePlaceSearch();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOpen(true);
    void search.search(query);
  };

  const choose = (next: SelectedPlace) => {
    onPlaceSelect(next);
    setQuery('');
    setOpen(false);
    search.clear();
    inputRef.current?.blur();
  };

  const locate = () => {
    setOpen(false);
    onLocate();
  };

  const clear = () => {
    setQuery('');
    search.clear();
    inputRef.current?.focus();
  };

  const hasResults = search.results.length > 0;
  const suggestions = matchingFeaturedPlaces(query);
  const showSuggestions = !hasResults && search.status !== 'loading';

  return (
    <div
      className={`search${open ? ' is-open' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Search inputs clear themselves on Escape and fire `input`, which would reopen the menu.
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (query) {
          event.preventDefault();
          setQuery('');
          search.clear();
        }
      }}
      ref={rootRef}
    >
      <form className="search__field" onSubmit={submit} role="search">
        <SearchIcon className="search__icon" size={18} />
        <label className="sr-only" htmlFor="place-query">Search a US address, hotel, or landmark</label>
        <input
          autoComplete="off"
          enterKeyHint="search"
          id="place-query"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a hotel, address, or landmark"
          ref={inputRef}
          type="search"
          value={query}
        />
        {query ? (
          <button aria-label="Clear search" className="search__clear" onClick={clear} type="button">
            <CloseIcon size={16} />
          </button>
        ) : null}
        <button
          aria-label="Search"
          className="search__submit"
          disabled={search.status === 'loading' || query.trim().length === 0}
          type="submit"
        >
          <ArrowRightIcon size={18} />
        </button>
      </form>

      {open ? (
        <div aria-label="Search suggestions" className="search__menu" id="search-menu" role="region">
          <div aria-live="polite" className="search__status">
            {search.status === 'loading' ? <p className="search__note">Searching OpenStreetMap…</p> : null}
            {search.error ? <p className="search__note search__note--error">{search.error}</p> : null}
          </div>

          {hasResults ? (
            <>
              <ul className="search__list" aria-label="Search results">
                {search.results.map((result) => {
                  const covered = findProviderForPoint(result.coordinates) !== null;
                  return (
                    <li key={`${result.coordinates.join(':')}:${result.label}`}>
                      <button className="search__option" onClick={() => choose(result)} type="button">
                        <PinIcon className="search__option-icon" size={18} />
                        <span className="search__option-text">
                          <strong>{result.label}</strong>
                          <small>{result.detail}</small>
                        </span>
                        <span className={`search__badge${covered ? ' is-covered' : ''}`}>
                          {covered ? 'Official data' : 'Map only'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="search__attribution">Results © OpenStreetMap contributors</p>
            </>
          ) : null}

          {showSuggestions ? (
            <>
              {query.trim() ? (
                <p className="search__hint">Press Enter to search every US address</p>
              ) : (
                <button className="search__option search__option--locate" disabled={locating} onClick={locate} type="button">
                  <LocateIcon className={`search__option-icon${locating ? ' is-spinning' : ''}`} size={18} />
                  <span className="search__option-text">
                    <strong>{locating ? 'Finding your location…' : 'Use my location'}</strong>
                  </span>
                </button>
              )}
              {suggestions.length > 0 ? (
                <>
                  <h2 className="search__heading" id="covered-places-heading">Places with official incident data</h2>
                  <ul aria-labelledby="covered-places-heading" className="search__list">
                    {suggestions.map((featured) => {
                      const current = samePoint(place, featured);
                      return (
                        <li key={featured.label}>
                          <button
                            aria-current={current ? 'location' : undefined}
                            className="search__option"
                            onClick={() => choose(featured)}
                            type="button"
                          >
                            <PinIcon className="search__option-icon" size={18} />
                            <span className="search__option-text">
                              <strong>{featured.label}</strong>
                              <small>{featured.detail}</small>
                            </span>
                            {current ? <span className="search__badge">Showing</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
