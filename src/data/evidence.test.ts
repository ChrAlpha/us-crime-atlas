import { describe, expect, it, vi } from 'vitest';
import { FULL_AREA_COVERAGE, NO_TRUNCATION } from '../domain/analysis';
import type { Incident, IncidentBatch, IncidentProvider, IncidentQuery, ProviderMeta } from '../types';
import { loadEvidence } from './evidence';
import { areaCoverageFor } from './jurisdictions';
import { NEW_YORK_META } from './providers/socrataCities';

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);
const CENTER = [-73.9855, 40.758] as const;
const NOW = new Date('2026-10-21T12:00:00Z');

function incident(id: string, epoch: number): Incident {
  return {
    id,
    providerId: 'test',
    occurredAt: new Date(epoch).toISOString().slice(0, 19),
    occurredAtEpochMs: epoch,
    localHour: 12,
    category: 'theft',
    group: 'property',
    rawCategory: 'THEFT',
    description: 'THEFT',
    locationLabel: 'Block',
    coordinates: CENTER,
    severity: 1.3,
    isViolent: false,
    precision: 'block',
  };
}

function batch(overrides: Partial<IncidentBatch> = {}): IncidentBatch {
  return { incidents: [], recordLimit: 20_000, truncated: false, requestUrls: [], ...overrides };
}

interface Batches {
  /** Current window across the whole comparison area (3r). */
  comparison?: IncidentBatch;
  /** Previous window across the selected circle (r). */
  previous?: IncidentBatch;
  /** Current window across the selected circle, only requested after a truncated comparison. */
  selectedCurrent?: IncidentBatch;
}

function fakeProvider(latest: number | null, batches: Batches = {}, meta: Partial<ProviderMeta> = {}) {
  const queries: IncidentQuery[] = [];
  const provider = {
    meta: { ...NEW_YORK_META, settlingDays: 0, datasetStart: null, ...meta },
    fetchLatestRecordEpoch: vi.fn(async (_signal?: AbortSignal) => latest),
    // Calls arrive in a fixed order: comparison and previous together, then the optional re-fetch.
    fetchIncidents: vi.fn(async (query: IncidentQuery) => {
      queries.push(query);
      return [batches.comparison, batches.previous, batches.selectedCurrent][queries.length - 1] ?? batch();
    }),
  } satisfies IncidentProvider;
  return { provider, queries };
}

function load(provider: IncidentProvider, overrides: Partial<Parameters<typeof loadEvidence>[1]> = {}) {
  return loadEvidence(provider, { center: CENTER, radiusMeters: 1000, windowDays: 30, now: NOW, ...overrides });
}

describe('loadEvidence', () => {
  it('anchors equal windows to the latest record minus settling days', async () => {
    const { provider, queries } = fakeProvider(Date.parse('2026-10-20T23:00:00Z'), {}, { settlingDays: 2 });
    const controller = new AbortController();
    const now = new Date('2026-10-21T10:15:00Z');

    const evidence = await load(provider, { now, signal: controller.signal });

    expect(evidence.window).toEqual({
      windowDays: 30,
      previousStartEpochMs: day('2026-08-20'),
      currentStartEpochMs: day('2026-09-19'),
      endEpochMs: day('2026-10-19'),
      latestRecordEpochMs: Date.parse('2026-10-20T23:00:00Z'),
      settlingDays: 2,
      lagDays: 3,
      datasetStartEpochMs: null,
    });
    expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledWith(controller.signal);
    expect(queries).toEqual([
      { center: CENTER, radiusMeters: 3000, startEpochMs: day('2026-09-19'), endEpochMs: day('2026-10-19'), signal: controller.signal },
      { center: CENTER, radiusMeters: 1000, startEpochMs: day('2026-08-20'), endEpochMs: day('2026-09-19'), signal: controller.signal },
    ]);
    expect(evidence.provider).toBe(provider.meta);
    expect(evidence.fetchedAt).toBe('2026-10-21T10:15:00.000Z');
  });

  it('starts the comparison and previous queries in parallel', async () => {
    const { provider } = fakeProvider(day('2026-10-20'));
    let release: (value: IncidentBatch) => void = () => undefined;
    provider.fetchIncidents.mockImplementationOnce(() => new Promise<IncidentBatch>((resolve) => { release = resolve; }));

    const pending = load(provider);
    await vi.waitFor(() => expect(provider.fetchIncidents).toHaveBeenCalledTimes(2));
    release(batch());
    await expect(pending).resolves.toMatchObject({ truncation: NO_TRUNCATION });
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
  });

  it('reads "today" in the provider zone rather than UTC', async () => {
    const { provider } = fakeProvider(null);
    // 03:00 UTC on Oct 21 is 23:00 on Oct 20 in New York.
    const evidence = await load(provider, { radiusMeters: 500, windowDays: 14, now: new Date('2026-10-21T03:00:00Z') });
    expect(evidence.window.endEpochMs).toBe(day('2026-10-21'));
    expect(evidence.window.latestRecordEpochMs).toBeNull();
    expect(provider.fetchLatestRecordEpoch).toHaveBeenCalledWith(undefined);
  });

  it('returns empty, untruncated evidence without querying when nothing was published', async () => {
    const { provider } = fakeProvider(null);
    const evidence = await load(provider);
    expect(provider.fetchIncidents).not.toHaveBeenCalled();
    expect(evidence.incidents).toEqual([]);
    expect(evidence.requestUrls).toEqual([]);
    expect(evidence.truncation).toEqual(NO_TRUNCATION);
    // No request was made, so there is no record limit to report.
    expect(evidence.recordLimit).toBe(0);
  });

  it('measures how much of the analysis area lies inside the provider\'s city limits', async () => {
    const newYork = await load(fakeProvider(day('2026-10-20')).provider);
    expect(newYork.areaCoverage).toEqual(areaCoverageFor('new-york', CENTER, 1000, 3));
    expect(newYork.areaCoverage.selected).toBe(1);
    expect(newYork.areaCoverage.nearby).toBeLessThan(0.95);

    const loop = [-87.6298, 41.8837] as const;
    const chicago = await load(fakeProvider(day('2026-10-20'), {}, { id: 'chicago' }).provider, { center: loop, radiusMeters: 2000 });
    expect(chicago.areaCoverage).toEqual(areaCoverageFor('chicago', loop, 2000, 3));
    expect(chicago.areaCoverage.selected).toBeLessThan(1);
    expect(chicago.areaCoverage.nearby).toBeLessThan(chicago.areaCoverage.selected);
  });

  it('treats a provider without reviewed city limits as covering the whole area', async () => {
    const evidence = await load(fakeProvider(day('2026-10-20'), {}, { id: 'springfield' }).provider);
    expect(evidence.areaCoverage).toEqual(FULL_AREA_COVERAGE);
  });

  it('reports area coverage even when nothing was published', async () => {
    const evidence = await load(fakeProvider(null).provider);
    expect(evidence.areaCoverage).toEqual(areaCoverageFor('new-york', CENTER, 1000, 3));
  });

  it('resolves the dataset start from provider metadata', async () => {
    const latest = Date.parse('2026-06-30T18:00:00Z');
    const yearToDate = await load(fakeProvider(latest, {}, { datasetStart: 'calendar-year' }).provider);
    expect(yearToDate.window.datasetStartEpochMs).toBe(day('2026-01-01'));

    const fixed = await load(fakeProvider(latest, {}, { datasetStart: '2026-03-15' }).provider);
    expect(fixed.window.datasetStartEpochMs).toBe(day('2026-03-15'));

    const none = await load(fakeProvider(latest).provider);
    expect(none.window.datasetStartEpochMs).toBeNull();
  });

  it('merges every batch, de-duplicates and combines limits and request URLs', async () => {
    const shared = incident('shared', day('2026-09-19'));
    const { provider } = fakeProvider(day('2026-10-20'), {
      comparison: batch({ incidents: [incident('current', day('2026-10-01')), shared], requestUrls: ['current-1', 'current-2'] }),
      previous: batch({
        incidents: [{ ...shared, description: 'duplicate' }, incident('previous', day('2026-09-01'))],
        requestUrls: ['previous-1'],
        recordLimit: 10_000,
      }),
    });
    const evidence = await load(provider);

    expect(evidence.incidents.map((item) => item.id)).toEqual(['current', 'shared', 'previous']);
    expect(evidence.incidents[1]?.description).toBe('THEFT');
    expect(evidence.truncation).toEqual(NO_TRUNCATION);
    expect(evidence.recordLimit).toBe(10_000);
    expect(evidence.requestUrls).toEqual(['current-1', 'current-2', 'previous-1']);
  });

  it('reports untruncated evidence when no query hit its limit', async () => {
    const { provider } = fakeProvider(day('2026-10-20'));
    const evidence = await load(provider);
    expect(evidence.truncation).toEqual(NO_TRUNCATION);
    expect(evidence.incidents).toEqual([]);
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
  });

  it('flags a truncated previous window without re-fetching the current window', async () => {
    const { provider } = fakeProvider(day('2026-10-20'), { previous: batch({ truncated: true }) });
    const evidence = await load(provider);
    expect(evidence.truncation).toEqual({ selectedCurrent: false, selectedPrevious: true, comparison: false });
    expect(provider.fetchIncidents).toHaveBeenCalledTimes(2);
  });

  it('re-fetches the selected circle on its own budget when the comparison query is truncated', async () => {
    const controller = new AbortController();
    const { provider, queries } = fakeProvider(day('2026-10-20'), {
      comparison: batch({ incidents: [incident('nearby', day('2026-10-05'))], requestUrls: ['comparison'], truncated: true }),
      previous: batch({ incidents: [incident('previous', day('2026-09-01'))], requestUrls: ['previous'] }),
      selectedCurrent: batch({
        incidents: [incident('inside', day('2026-10-02')), incident('nearby', day('2026-10-05'))],
        requestUrls: ['selected'],
        recordLimit: 5_000,
      }),
    });
    const evidence = await load(provider, { signal: controller.signal });

    expect(queries).toHaveLength(3);
    expect(queries[2]).toEqual({
      center: CENTER,
      radiusMeters: 1000,
      startEpochMs: day('2026-09-21'),
      endEpochMs: day('2026-10-21'),
      signal: controller.signal,
    });
    expect(evidence.truncation).toEqual({ selectedCurrent: false, selectedPrevious: false, comparison: true });
    expect(evidence.incidents.map((item) => item.id)).toEqual(['inside', 'nearby', 'previous']);
    expect(evidence.recordLimit).toBe(5_000);
    expect(evidence.requestUrls).toEqual(['selected', 'comparison', 'previous']);
  });

  it('flags the selected current window when even its own query is truncated', async () => {
    const { provider } = fakeProvider(day('2026-10-20'), {
      comparison: batch({ truncated: true }),
      selectedCurrent: batch({ truncated: true }),
    });
    const evidence = await load(provider);
    expect(evidence.truncation).toEqual({ selectedCurrent: true, selectedPrevious: false, comparison: true });
  });

  it('propagates latest-record failures without querying incidents', async () => {
    const { provider } = fakeProvider(null);
    provider.fetchLatestRecordEpoch.mockRejectedValueOnce(new Error('NYPD returned HTTP 503'));
    await expect(load(provider, { now: new Date() })).rejects.toThrow('HTTP 503');
    expect(provider.fetchIncidents).not.toHaveBeenCalled();
  });

  it('propagates incident-query failures', async () => {
    const { provider } = fakeProvider(day('2026-10-20'));
    provider.fetchIncidents.mockRejectedValueOnce(new Error('query error'));
    await expect(load(provider, { now: new Date() })).rejects.toThrow('query error');
  });

  it('propagates a failure of the selected-circle re-fetch', async () => {
    const { provider } = fakeProvider(day('2026-10-20'), { comparison: batch({ truncated: true }) });
    provider.fetchIncidents
      .mockResolvedValueOnce(batch({ truncated: true }))
      .mockResolvedValueOnce(batch())
      .mockRejectedValueOnce(new Error('re-fetch failed'));
    await expect(load(provider)).rejects.toThrow('re-fetch failed');
  });
});
