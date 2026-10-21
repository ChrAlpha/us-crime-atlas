import { JURISDICTION_SOURCE } from '../../data/jurisdictions';
import { FEATURED_PLACES, findProviderForPoint, providerMetadata } from '../../data/providers';
import { CATEGORY_LABELS, CATEGORY_SEVERITY } from '../../domain/categories';
import { lastDayOfWindow, publicationLagDays } from '../../domain/evidenceWindow';
import { dataNotes, dayCount, windowRangeLabel } from '../../domain/presentation';
import { formatDay } from '../../domain/time';
import type { CrimeCategory, EvidenceBundle, LoadStatus, ProviderMeta, SelectedPlace } from '../../types';
import { ExternalIcon, RefreshIcon, WarningIcon } from '../Icons';
import { DataNotes } from './Finding';

export type ThemePreference = 'system' | 'light' | 'dark';

const CATEGORY_ORDER: CrimeCategory[] = [
  'homicide',
  'sexual',
  'robbery',
  'assault',
  'weapons',
  'burglary',
  'vehicle',
  'theft',
  'other',
];

export const LIMITATIONS = [
  'Published records are incomplete: not every event is reported, and reporting differs by offense and community.',
  'Police deployment, classification rules, approval workflows, and later revisions shape what each feed contains.',
  'Locations are deliberately blurred. A dot never identifies a particular hotel, business, home, or person.',
  'Comparing land areas ignores foot traffic, visitors, transit riders, lighting, and special events.',
  'A quiet window does not guarantee safety, and a high count does not measure the risk to any one traveler.',
];

function featuredPlaceFor(provider: ProviderMeta): SelectedPlace | undefined {
  return FEATURED_PLACES.find((place) => findProviderForPoint(place.coordinates)?.meta.id === provider.id);
}

function SourceDetails({ provider, evidence }: { provider: ProviderMeta; evidence: EvidenceBundle | null }) {
  const window = evidence?.window;
  const newest = window?.latestRecordEpochMs ?? null;
  return (
    <section aria-labelledby="source-title" className="section">
      <div className="section__head">
        <h3 id="source-title">Source</h3>
      </div>
      <div className="source">
        <div className="source__name">
          <strong>{provider.agency}</strong>
          <a href={provider.sourceUrl} rel="noreferrer" target="_blank">
            {provider.datasetName}
            <ExternalIcon size={15} />
            <span className="sr-only">(opens the official dataset)</span>
          </a>
        </div>
        <dl className="source__facts">
          {window && newest !== null ? (
            <>
              <div>
                <dt>Dates analyzed</dt>
                <dd>{windowRangeLabel(window)}</dd>
              </div>
              <div>
                <dt>Newest record</dt>
                <dd>{formatDay(newest)}</dd>
              </div>
              {publicationLagDays(window) > 0 ? (
                <div>
                  <dt>Behind today</dt>
                  <dd>
                    {dayCount(publicationLagDays(window))}. The window ends {formatDay(lastDayOfWindow(window))}.
                  </dd>
                </div>
              ) : null}
            </>
          ) : null}
          <div>
            <dt>Updates</dt>
            <dd>{provider.cadence}. {provider.delayNote}</dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>{provider.precisionNote}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{provider.coverageNote}</dd>
          </div>
        </dl>
        <p className="source__verified">Field contract verified {provider.lastVerified}</p>
      </div>
    </section>
  );
}

function Method() {
  return (
    <section aria-labelledby="method-title" className="section">
      <div className="section__head">
        <h3 id="method-title">How the comparison works</h3>
      </div>
      <div className="prose">
        <p>
          Reports are split by exact distance into the circle you chose and the ring around it, out to three times
          the radius. Each area's reports are weighted by type, then divided by the area that lies inside city limits
          ({JURISDICTION_SOURCE.source}). The headline is the circle's rate divided by the ring's.
        </p>
        <p>
          Both use the same dates, ending at the publisher's newest complete day rather than today, so days not yet
          published never look quiet. The current window is also compared with the equal window before it.
        </p>
        <p>
          Below 0.65× reads as lower, up to 1.25× as similar, up to 2× as higher, and beyond that as much higher.
          Fewer than five reports, or none in the ring, is too few to compare.
        </p>
      </div>
      <h4 className="section__subhead">Weights <span>so frequent minor theft does not drown out rarer violence</span></h4>
      <ul className="weights">
        {CATEGORY_ORDER.map((category) => (
          <li key={category}>
            <span>{CATEGORY_LABELS[category]}</span>
            <strong>{CATEGORY_SEVERITY[category].toFixed(1)}×</strong>
          </li>
        ))}
      </ul>
      <p className="section__aside">Weights express emphasis in this view. They are not legal rankings or measures of harm.</p>
    </section>
  );
}

function Limits() {
  return (
    <section aria-labelledby="limits-title" className="section">
      <div className="section__head">
        <h3 id="limits-title">Limits of this data</h3>
      </div>
      <ul className="limits">
        {LIMITATIONS.map((limitation) => (
          <li key={limitation}>
            <WarningIcon size={16} />
            <span>{limitation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CoveredPlaces({
  activeProviderId,
  onPlaceSelect,
}: {
  activeProviderId: string | null;
  onPlaceSelect(place: SelectedPlace): void;
}) {
  return (
    <section aria-labelledby="covered-title" className="section">
      <div className="section__head">
        <h3 id="covered-title">Cities with official incident data</h3>
      </div>
      <ul className="covered">
        {providerMetadata.map((provider) => {
          const place = featuredPlaceFor(provider);
          const active = provider.id === activeProviderId;
          return (
            <li key={provider.id}>
              <span className="covered__text">
                <strong>{provider.label}</strong>
                <small>{provider.agency} · {provider.cadence.toLowerCase()}</small>
              </span>
              {place && !active ? (
                <button className="button button--quiet" onClick={() => onPlaceSelect(place)} type="button">
                  Go to {place.label}
                </button>
              ) : null}
              {active ? <span className="covered__current">Showing</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Appearance({ value, onChange }: { value: ThemePreference; onChange(value: ThemePreference): void }) {
  const options: Array<{ value: ThemePreference; label: string }> = [
    { value: 'system', label: 'Match device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <section aria-labelledby="appearance-title" className="section">
      <div className="section__head">
        <h3 id="appearance-title">Appearance</h3>
      </div>
      <div aria-labelledby="appearance-title" className="segmented" role="group">
        {options.map((option) => (
          <button aria-pressed={value === option.value} key={option.value} onClick={() => onChange(option.value)} type="button">
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function AboutTab({
  provider,
  evidence,
  status,
  themePreference,
  onThemePreferenceChange,
  onRefresh,
  onPlaceSelect,
}: {
  provider: ProviderMeta | null;
  evidence: EvidenceBundle | null;
  status: LoadStatus;
  themePreference: ThemePreference;
  onThemePreferenceChange(value: ThemePreference): void;
  onRefresh(): void;
  onPlaceSelect(place: SelectedPlace): void;
}) {
  const notes = evidence ? dataNotes(evidence) : [];
  const covered = <CoveredPlaces activeProviderId={provider?.id ?? null} onPlaceSelect={onPlaceSelect} />;
  return (
    <>
      {provider ? <SourceDetails evidence={evidence} provider={provider} /> : covered}
      {notes.length > 0 ? (
        <section aria-labelledby="notes-title" className="section">
          <div className="section__head">
            <h3 id="notes-title">Notes for this view</h3>
          </div>
          <DataNotes expanded notes={notes} />
        </section>
      ) : null}
      <Method />
      <Limits />
      {provider ? covered : null}
      <Appearance onChange={onThemePreferenceChange} value={themePreference} />
      <footer className="credits">
        {provider ? (
          <button className="button button--quiet" disabled={status === 'loading'} onClick={onRefresh} type="button">
            <RefreshIcon className={status === 'loading' ? 'is-spinning' : undefined} size={16} />
            Reload from {provider.city} source
          </button>
        ) : null}
        <p>
          Map © OpenStreetMap contributors, tiles by OpenFreeMap. Place search by Nominatim. Data remains subject to
          each publisher's terms.
        </p>
      </footer>
    </>
  );
}
