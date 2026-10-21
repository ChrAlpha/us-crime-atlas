import { describe, expect, it, vi } from 'vitest';

// Without reviewed city limits, coverage falls back to each provider's rectangle.
vi.mock('../jurisdictions', () => ({
  jurisdictionFor: () => null,
  isWithinJurisdiction: () => {
    throw new Error('not consulted without a jurisdiction');
  },
}));

const { findProviderForPoint } = await import('./index');

describe('provider lookup without city limits', () => {
  it('uses the reviewed rectangle, neighbors included', () => {
    expect(findProviderForPoint([-73.9855, 40.758])?.meta.id).toBe('new-york');
    // Jersey City lies inside the New York rectangle.
    expect(findProviderForPoint([-74.0776, 40.7282])?.meta.id).toBe('new-york');
    expect(findProviderForPoint([-100.3, 45])).toBeNull();
  });
});
