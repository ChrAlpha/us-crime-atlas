import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { providerMetadata } from '../data/providers';
import { CATEGORY_LABELS, CATEGORY_SEVERITY } from '../domain/categories';
import type { CrimeCategory, ProviderMeta } from '../types';
import { CloseIcon, ExternalIcon, InfoIcon, WarningIcon } from './Icons';

interface SourceDialogProps {
  open: boolean;
  activeProvider: ProviderMeta | null;
  onClose(): void;
}

const categoryOrder: CrimeCategory[] = [
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

const limitations = [
  'Published records are incomplete observations: not every event is reported, and reporting behavior differs by offense and community.',
  'Police deployment, classification rules, approval workflows, and later revisions affect what appears in each feed.',
  'Public coordinates are deliberately blurred. A point must not be interpreted as identifying a particular hotel, business, home, or person.',
  'The nearby land-area comparison does not measure foot traffic, visitors, transit riders, time spent outdoors, lighting, or special events.',
  'A short quiet window does not guarantee safety, while a high historical count does not establish the probability of harm to an individual traveler.',
];

function ProviderCard({ provider, active = false }: { provider: ProviderMeta; active?: boolean }) {
  return (
    <article className={active ? 'is-active' : undefined}>
      <div className="provider-card__title">
        <div>
          <span>{provider.label}</span>
          <h4>{provider.datasetName}</h4>
        </div>
        <a
          aria-label={`Open ${provider.datasetName}`}
          href={provider.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalIcon size={15} />
        </a>
      </div>
      <dl>
        <div>
          <dt>Publisher</dt>
          <dd>{provider.agency}</dd>
        </div>
        <div>
          <dt>Cadence and lag</dt>
          <dd>{provider.cadence}. {provider.delayNote}</dd>
        </div>
        <div>
          <dt>Public location</dt>
          <dd>{provider.precisionNote}</dd>
        </div>
      </dl>
      <p>{provider.coverageNote}</p>
      <small>Field contract verified {provider.lastVerified}</small>
    </article>
  );
}

export function SourceDialog({ open, activeProvider, onClose }: SourceDialogProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const dismissBackdrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const otherProviders = activeProvider
    ? providerMetadata.filter((provider) => provider.id !== activeProvider.id)
    : providerMetadata;

  return (
    <div className="dialog-backdrop" onMouseDown={dismissBackdrop}>
      <section
        aria-describedby="source-dialog-description"
        aria-labelledby="source-dialog-title"
        aria-modal="true"
        className="source-dialog"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">Evidence, not a safety grade</span>
            <h2 id="source-dialog-title">Sources &amp; methodology</h2>
            <p id="source-dialog-description">
              The atlas preserves raw local observations, documents publication limits, and compares the selected
              circle with its immediately surrounding area. It does not predict individual harm.
            </p>
          </div>
          <button
            ref={closeRef}
            aria-label="Close sources and methodology"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="source-dialog__body">
          {activeProvider ? (
            <section className="current-source-section">
              <h3>Current source</h3>
              <div className="provider-cards provider-cards--active">
                <ProviderCard active provider={activeProvider} />
              </div>
            </section>
          ) : null}

          <section>
            <div className="method-callout">
              <InfoIcon size={20} />
              <div>
                <strong>Transparent local comparison</strong>
                <p>
                  Exact Haversine distance assigns reports to the selected radius or the surrounding annulus from 1×
                  to 3× that radius. The current window is also compared with the immediately preceding equal window.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3>How relative activity is calculated</h3>
            <div className="formula-card">
              <div
                aria-label="Relative activity equals selected weighted incidents per selected square kilometer divided by nearby weighted incidents per annulus square kilometer"
                className="formula-expression"
                role="img"
              >
                <code>relative activity</code>
                <span aria-hidden="true">=</span>
                <span className="formula-fraction">
                  <code>selected weighted incidents / selected km²</code>
                  <code>nearby weighted incidents / annulus km²</code>
                </span>
              </div>
              <p>
                Below 0.65× is labeled lower; 0.65×–1.24× similar; 1.25×–1.99× elevated; and 2× or more markedly
                elevated. Fewer than five current observations, or no usable nearby denominator, yields “not enough
                evidence.” Raw counts remain visible independently.
              </p>
            </div>
            <p className="method-note">
              Weights express product-level salience so high-volume minor theft does not numerically erase rarer
              violent reports. They are not legal rankings, loss estimates, or claims about victim harm.
            </p>
            <div className="weight-grid">
              {categoryOrder.map((category) => (
                <div key={category}>
                  <span>{CATEGORY_LABELS[category]}</span>
                  <strong>{CATEGORY_SEVERITY[category].toFixed(1)}×</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="limitations-section">
            <h3>Read these limitations before acting</h3>
            <ul>
              {limitations.map((limitation) => (
                <li key={limitation}>
                  <WarningIcon />
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>{activeProvider ? 'Other official local publishers' : 'Official local publishers'}</h3>
            <div className="provider-cards">
              {otherProviders.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
