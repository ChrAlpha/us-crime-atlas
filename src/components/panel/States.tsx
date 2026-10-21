import { delayedFeedCopy } from '../../domain/presentation';
import type { EvidenceBundle, IncidentProvider, SelectedPlace } from '../../types';
import { InfoIcon, RefreshIcon, WarningIcon } from '../Icons';

export function LoadingSummary({ provider }: { provider: IncidentProvider }) {
  return (
    <div aria-live="polite" className="loading" role="status">
      <span className="sr-only">Loading official {provider.meta.city} incident records</span>
      <span aria-hidden="true" className="skeleton skeleton--headline" />
      <span aria-hidden="true" className="skeleton skeleton--headline skeleton--short" data-peek-end />
      <span aria-hidden="true" className="skeleton skeleton--scale" />
      <span aria-hidden="true" className="skeleton skeleton--facts" />
    </div>
  );
}

export function ErrorSummary({
  provider,
  error,
  onRefresh,
}: {
  provider: IncidentProvider;
  error: string | null;
  onRefresh(): void;
}) {
  return (
    <div className="state state--error" role="alert">
      <WarningIcon className="state__icon" size={20} />
      <div>
        <h2>Couldn't load {provider.meta.city} police records</h2>
        <p>{error || 'The official publisher did not return a usable response.'} Nothing is shown rather than a guess.</p>
        <button className="button" data-peek-end onClick={onRefresh} type="button">
          <RefreshIcon size={16} />
          Try again
        </button>
      </div>
    </div>
  );
}

export function NoRecordsSummary({ evidence }: { evidence: EvidenceBundle }) {
  return (
    <div className="state" data-testid="no-records-state">
      <InfoIcon className="state__icon" size={20} />
      <div>
        <h2 data-peek-end>No recent records from {evidence.provider.agency}</h2>
        <p>
          {delayedFeedCopy(evidence.window, evidence.provider.cadence)} Without published records there is nothing to
          count or compare, so no figures are shown.
        </p>
      </div>
    </div>
  );
}

export function NoFeedSummary({ place }: { place: SelectedPlace }) {
  return (
    <div className="state" data-testid="no-feed-state">
      <InfoIcon className="state__icon" size={20} />
      <div>
        <h2 data-peek-end>No official incident feed here yet</h2>
        <p>
          {place.label} is outside the cities with a verified police incident feed. The map still works, but the atlas
          never fills the gap with estimates, a national average, or another city's data.
        </p>
      </div>
    </div>
  );
}
