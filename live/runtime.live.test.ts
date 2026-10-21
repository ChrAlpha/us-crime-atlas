import { describe, expect, it } from 'vitest';
import { loadEvidence } from '../src/data/evidence';
import { FEATURED_PLACES, findProviderForPoint, providers } from '../src/data/providers';
import { analyzeIncidents, NO_TRUNCATION } from '../src/domain/analysis';
import { CRIME_GROUPS } from '../src/domain/categories';
import { publicationLagDays } from '../src/domain/evidenceWindow';
import { haversineDistance } from '../src/domain/geo';
import type { Incident } from '../src/types';

/** NYPD's quarterly releases are the slowest registered cadence. */
const MAX_PUBLICATION_LAG_DAYS = 200;
const RADIUS_METERS = 1000;
const WINDOW_DAYS = 30;
const MIN_HOURLY_SAMPLE = 300;

/**
 * Start hour of the quietest three-hour block. Street crime bottoms out in the early morning,
 * so a block far from 01:00–08:00 means epochs are being read in the wrong zone.
 */
function quietestBlockStart(incidents: readonly Incident[]): number | null {
  const hours = incidents.map((incident) => incident.localHour).filter((hour): hour is number => hour !== null);
  if (hours.length < MIN_HOURLY_SAMPLE) return null;
  const counts = Array.from({ length: 24 }, (_, hour) => hours.filter((value) => value === hour).length);
  const blocks = counts.map((_, start) => [0, 1, 2].reduce((sum, offset) => sum + (counts[(start + offset) % 24] ?? 0), 0));
  return blocks.indexOf(Math.min(...blocks));
}

const cases = providers.map((provider) => {
  const place = FEATURED_PLACES.find((candidate) => findProviderForPoint(candidate.coordinates) === provider);
  if (!place) throw new Error(`${provider.meta.label} has no featured place`);
  return [provider.meta.label, provider, place] as const;
});

describe.each(cases)('runtime evidence: %s', (_label, provider, place) => {
  it('loads a fresh, non-empty, correctly bounded analysis at its featured place', async () => {
    const now = new Date();
    const evidence = await loadEvidence(provider, {
      center: place.coordinates,
      radiusMeters: RADIUS_METERS,
      windowDays: WINDOW_DAYS,
      now,
    });
    const { window } = evidence;

    expect(window.latestRecordEpochMs, 'the feed has no records in the lookback period').not.toBeNull();
    expect(publicationLagDays(window)).toBeLessThanOrEqual(MAX_PUBLICATION_LAG_DAYS);
    expect(evidence.truncation, 'the default 1 km / 30 day request hit a record limit').toEqual(NO_TRUNCATION);
    expect(evidence.incidents.length).toBeGreaterThan(0);

    for (const incident of evidence.incidents) {
      expect(incident.providerId).toBe(provider.meta.id);
      expect(incident.occurredAtEpochMs).toBeGreaterThanOrEqual(window.previousStartEpochMs);
      expect(incident.occurredAtEpochMs).toBeLessThan(window.endEpochMs);
    }

    const analysis = analyzeIncidents({
      incidents: evidence.incidents,
      center: place.coordinates,
      radiusMeters: RADIUS_METERS,
      window,
      activeGroups: CRIME_GROUPS,
      truncation: evidence.truncation,
    });
    expect(analysis.currentCount + analysis.nearbyCurrentIncidents.length).toBeGreaterThan(0);
    for (const incident of analysis.mapIncidents) {
      expect(haversineDistance(place.coordinates, incident.coordinates)).toBeLessThanOrEqual(RADIUS_METERS * 3);
    }

    const quietest = quietestBlockStart(evidence.incidents);
    if (quietest !== null) {
      expect(quietest, 'the quietest hours are not in the early morning; check epoch time-zone semantics')
        .toBeGreaterThanOrEqual(1);
      expect(quietest).toBeLessThanOrEqual(7);
    }
  });
});
