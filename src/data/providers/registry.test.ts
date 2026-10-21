import { describe, expect, it } from 'vitest';
import { pointIsWithinBounds } from '../../domain/geo';
import { FEATURED_PLACES, findProviderForPoint, providerMetadata, providers } from './index';

describe('provider registry', () => {
  it('registers providers with distinct identities and endpoints', () => {
    expect(providers.length).toBeGreaterThanOrEqual(12);
    expect(providerMetadata).toEqual(providers.map((provider) => provider.meta));
    expect(new Set(providerMetadata.map((meta) => meta.id)).size).toBe(providers.length);
    expect(new Set(providerMetadata.map((meta) => meta.endpoint)).size).toBe(providers.length);
  });

  it('keeps every provider center inside its own bounds and no other provider\'s', () => {
    for (const meta of providerMetadata) {
      expect(findProviderForPoint(meta.center)?.meta.id).toBe(meta.id);
      const overlapping = providerMetadata.filter((candidate) => candidate.id !== meta.id && pointIsWithinBounds(meta.center, candidate.bounds));
      expect(overlapping, `${meta.label} center overlaps another provider`).toEqual([]);
    }
  });

  it('declares a valid publisher zone, settling period and HTTPS sources', () => {
    for (const meta of providerMetadata) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: meta.timeZone }), meta.id).not.toThrow();
      expect(meta.timeZone, meta.id).toMatch(/^America\//);
      expect(Number.isInteger(meta.settlingDays), meta.id).toBe(true);
      expect(meta.settlingDays, meta.id).toBeGreaterThanOrEqual(0);
      // Slow approval workflows (Tempe) take three weeks to fill in.
      expect(meta.settlingDays, meta.id).toBeLessThan(22);
      expect(meta.endpoint, meta.id).toMatch(/^https:\/\//);
      expect(meta.sourceUrl, meta.id).toMatch(/^https:\/\//);
      expect(meta.bounds.west, meta.id).toBeLessThan(meta.bounds.east);
      expect(meta.bounds.south, meta.id).toBeLessThan(meta.bounds.north);
      expect(meta.lastVerified, meta.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('declares where each dataset starts', () => {
    expect(Object.fromEntries(providerMetadata.map((meta) => [meta.id, meta.datasetStart]))).toMatchObject({
      'new-york': 'calendar-year',
      chicago: null,
      'san-francisco': null,
      oakland: null,
      'los-angeles': '2026-01-01',
      seattle: null,
      dallas: null,
      'washington-dc': '2026-01-01',
      philadelphia: null,
      detroit: '2026-01-01',
      denver: null,
      nashville: null,
    });
    for (const meta of providerMetadata) {
      if (meta.datasetStart !== null && meta.datasetStart !== 'calendar-year') {
        expect(meta.datasetStart, meta.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isFinite(Date.parse(meta.datasetStart)), meta.id).toBe(true);
      }
    }
  });

  it('treats NYC as a complete quarterly batch and Seattle as slow to settle', () => {
    expect(providerMetadata.find((meta) => meta.id === 'new-york')?.settlingDays).toBe(0);
    expect(providerMetadata.find((meta) => meta.id === 'seattle')?.settlingDays).toBe(6);
  });

  it('offers one covered featured place per provider, in registry order', () => {
    expect(FEATURED_PLACES).toHaveLength(providers.length);
    expect(FEATURED_PLACES.map((place) => findProviderForPoint(place.coordinates)?.meta.id)).toEqual(providerMetadata.map((meta) => meta.id));
    expect(new Set(FEATURED_PLACES.map((place) => place.label)).size).toBe(FEATURED_PLACES.length);
  });

  it('returns no provider outside registered coverage', () => {
    expect(findProviderForPoint([-100.3, 45.0])).toBeNull();
    // Providence publishes block text without coordinates.
    expect(findProviderForPoint([-71.4128, 41.824])).toBeNull();
  });

  it('resolves coverage by city limits rather than the reviewed rectangle', () => {
    // Jersey City, Beverly Hills and Hamtramck: inside a rectangle, but separate cities.
    const neighbors = [
      ['new-york', [-74.0776, 40.7282]],
      ['los-angeles', [-118.4004, 34.0736]],
      ['detroit', [-83.0499, 42.3926]],
    ] as const;
    for (const [providerId, neighbor] of neighbors) {
      const bounds = providerMetadata.find((meta) => meta.id === providerId)?.bounds;
      expect(bounds && pointIsWithinBounds(neighbor, bounds), providerId).toBe(true);
      expect(findProviderForPoint(neighbor), providerId).toBeNull();
    }
    // Inside city limits on either side of those neighbors.
    expect(findProviderForPoint([-74.0, 40.72])?.meta.id).toBe('new-york');
    expect(findProviderForPoint([-118.44, 34.07])?.meta.id).toBe('los-angeles');
    expect(findProviderForPoint([-83.07, 42.38])?.meta.id).toBe('detroit');
  });
});
