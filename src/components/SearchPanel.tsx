import { useState, type FormEvent } from 'react';
import { FEATURED_PLACES, findProviderForPoint } from '../data/providers';
import { CRIME_GROUPS, GROUP_LABELS } from '../domain/categories';
import { RADIUS_OPTIONS, WINDOW_OPTIONS } from '../domain/urlState';
import type { AreaSummary } from '../hooks/useAreaSummary';
import { usePlaceSearch } from '../hooks/usePlaceSearch';
import type { CrimeGroup, IncidentProvider, LoadStatus, RadiusMeters, SelectedPlace, WindowDays } from '../types';
import {
  ChevronIcon,
  InfoIcon,
  LocateIcon,
  SearchIcon,
  SlidersIcon,
} from './Icons';

export interface SearchPanelProps {
  place: SelectedPlace;
  provider: IncidentProvider | null;
  providerStatus: LoadStatus;
  /** FBI jurisdiction totals standing in where no local incident feed covers the place. */
  areaSummary: AreaSummary | null;
  radiusMeters: RadiusMeters;
  windowDays: WindowDays;
  activeGroups: readonly CrimeGroup[];
  locating: boolean;
  onPlaceSelect(place: SelectedPlace): void;
  onRadiusChange(radius: RadiusMeters): void;
  onWindowChange(days: WindowDays): void;
  onToggleGroup(group: CrimeGroup): void;
  onLocate(): void;
  onOpenSources(): void;
}

/** The source strip's copy and tone wherever no local incident feed covers the place. */
export function fallbackSourceCopy(areaSummary: AreaSummary | null): { title: string; detail: string; tone: string } {
  if (areaSummary?.kind === 'agency') {
    return {
      title: areaSummary.summary.match.agency.name,
      detail: 'FBI twelve-month totals for the whole jurisdiction. No local incident feed covers this point yet.',
      tone: 'is-coarse',
    };
  }
  if (areaSummary?.kind === 'state') {
    return {
      title: `${areaSummary.summary.stateName} statewide context`,
      detail: 'No local agency totals matched this point, and no synthetic data is substituted.',
      tone: 'is-coarse',
    };
  }
  return {
    title: 'No verified incident feed here yet',
    detail: 'The map remains usable, but the atlas will not substitute proxy or synthetic crime data.',
    tone: 'is-unsupported',
  };
}

function samePoint(left: SelectedPlace, right: SelectedPlace) {
  return Math.abs(left.coordinates[0] - right.coordinates[0]) < 0.0001
    && Math.abs(left.coordinates[1] - right.coordinates[1]) < 0.0001;
}

function radiusLabel(radius: number) {
  return radius === 500 ? '500 m' : `${radius / 1000} km`;
}

export function SearchPanel({
  place,
  provider,
  providerStatus,
  areaSummary,
  radiusMeters,
  windowDays,
  activeGroups,
  locating,
  onPlaceSelect,
  onRadiusChange,
  onWindowChange,
  onToggleGroup,
  onLocate,
  onOpenSources,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const search = usePlaceSearch();
  const providerUnavailable = Boolean(provider && providerStatus === 'error');
  const fallback = fallbackSourceCopy(areaSummary);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search.search(query);
  };

  const selectPlace = (nextPlace: SelectedPlace) => {
    onPlaceSelect(nextPlace);
    setQuery('');
    search.clear();
  };

  return (
    <aside className="search-panel glass-panel" aria-label="Place and analysis controls">
      <div className="search-panel__heading">
        <div>
          <span className="eyebrow">Selected travel area</span>
          <h1 title={place.label}>{place.label}</h1>
          <p title={place.detail}>{place.detail || 'Dropped map point'}</p>
        </div>
        <button
          aria-label="Use current location"
          className="icon-button locate-button"
          disabled={locating}
          onClick={onLocate}
          title="Use current location"
          type="button"
        >
          <LocateIcon className={locating ? 'is-spinning' : undefined} />
        </button>
      </div>

      <form className="place-search" onSubmit={submit} role="search">
        <SearchIcon size={17} />
        <label className="sr-only" htmlFor="place-query">Search a US address or landmark</label>
        <input
          autoComplete="off"
          id="place-query"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Hotel, landmark, address…"
          value={query}
        />
        <button disabled={search.status === 'loading'} type="submit">
          {search.status === 'loading' ? 'Finding' : 'Search'}
        </button>
      </form>

      {search.results.length > 0 || search.error ? (
        <div className="search-results" aria-live="polite">
          {search.results.map((result) => {
            const resultProvider = findProviderForPoint(result.coordinates);
            return (
              <button key={`${result.coordinates.join(':')}:${result.label}`} onClick={() => selectPlace(result)} type="button">
                <span>
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </span>
                <em className={resultProvider ? 'is-covered' : undefined}>
                  {resultProvider ? 'Official feed' : 'Map only'}
                </em>
              </button>
            );
          })}
          {search.error ? <p className="inline-message">{search.error}</p> : null}
          <p className="search-attribution">Search results © OpenStreetMap contributors</p>
        </div>
      ) : null}

      <div className="featured-places" aria-label="Featured covered places">
        {FEATURED_PLACES.map((featured) => (
          <button
            aria-pressed={samePoint(place, featured)}
            className={samePoint(place, featured) ? 'is-active' : undefined}
            key={featured.label}
            onClick={() => selectPlace(featured)}
            type="button"
          >
            {featured.label}
          </button>
        ))}
      </div>

      <button
        aria-label="Sources & methodology"
        className={`provider-strip${provider ? '' : ` ${fallback.tone}`}${providerUnavailable ? ' has-error' : ''}`}
        onClick={onOpenSources}
        type="button"
      >
        <span className="provider-dot" aria-hidden="true" />
        <span className="provider-strip__copy">
          <strong>
            {providerUnavailable
              ? `${provider?.meta.agency} is temporarily unavailable`
              : provider
                ? provider.meta.agency
                : fallback.title}
          </strong>
          <small>
            {providerUnavailable
              ? 'The official source could not be loaded. Retry from the evidence panel.'
              : provider
              ? `${provider.meta.cadence}. ${provider.meta.precisionNote}`
              : fallback.detail}
          </small>
        </span>
        <span className="provider-strip__action" aria-hidden="true">
          <InfoIcon size={15} />
          Details
        </span>
      </button>

      <button
        aria-expanded={settingsOpen}
        className="mobile-filter-toggle"
        onClick={() => setSettingsOpen((value) => !value)}
        type="button"
      >
        <SlidersIcon size={16} />
        Analysis settings
        <ChevronIcon className={settingsOpen ? 'is-open' : undefined} size={16} />
      </button>

      <div className={`analysis-controls${settingsOpen ? ' is-open' : ''}`}>
        <fieldset>
          <legend>Analysis radius</legend>
          <div className="segmented-control">
            {RADIUS_OPTIONS.map((radius) => (
              <button
                aria-pressed={radiusMeters === radius}
                className={radiusMeters === radius ? 'is-active' : undefined}
                key={radius}
                onClick={() => onRadiusChange(radius)}
                type="button"
              >
                {radiusLabel(radius)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Observation window</legend>
          <div className="segmented-control segmented-control--four">
            {WINDOW_OPTIONS.map((days) => (
              <button
                aria-pressed={windowDays === days}
                className={windowDays === days ? 'is-active' : undefined}
                key={days}
                onClick={() => onWindowChange(days)}
                type="button"
              >
                {days} d
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Published incident groups</legend>
          <div className="filter-chips">
            {CRIME_GROUPS.map((group) => {
              const active = activeGroups.includes(group);
              return (
                <button
                  aria-pressed={active}
                  className={active ? 'is-active' : undefined}
                  key={group}
                  onClick={() => onToggleGroup(group)}
                  type="button"
                >
                  <span className={`group-swatch group-swatch--${group}`} aria-hidden="true" />
                  {GROUP_LABELS[group]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </aside>
  );
}
