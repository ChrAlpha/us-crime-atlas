import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident, IncidentQuery, ProviderMeta } from '../../types';
import {
  SOCRATA_QUERY_LIMIT,
  buildSocrataUrl,
  createSocrataProvider,
  finiteCoordinate,
  text,
  type SocrataProviderConfig,
} from './socrata';

interface TestRow extends Record<string, unknown> {
  id?: string;
  occurred?: string;
  latitude?: string;
  longitude?: string;
}

const meta: ProviderMeta = {
  id: 'test',
  city: 'Test City',
  state: 'TS',
  label: 'Test City, TS',
  agency: 'Test Police Department',
  datasetName: 'Test incidents',
  endpoint: 'https://example.test/resource/incidents.json',
  sourceUrl: 'https://example.test/d/incidents',
  center: [-75, 40],
  zoom: 12,
  bounds: { west: -76, south: 39, east: -74, north: 41 },
  cadence: 'Daily',
  delayNote: 'Test delay',
  precision: 'approximate',
  precisionNote: 'Approximate',
  coverageNote: 'Test coverage',
  lastVerified: '2026-08-17',
};

function mapRow(row: TestRow): Incident | null {
  if (!row.id) return null;
  return {
    id: row.id,
    providerId: meta.id,
    occurredAt: String(row.occurred),
    occurredAtEpochMs: Date.parse(String(row.occurred)),
    localHour: 12,
    category: 'other',
    group: 'other',
    rawCategory: 'Other',
    description: 'Test',
    locationLabel: 'Test location',
    coordinates: [Number(row.longitude), Number(row.latitude)],
    severity: 1,
    isViolent: false,
    precision: 'approximate',
  };
}

const config: SocrataProviderConfig<TestRow> = {
  meta,
  dateField: 'occurred',
  latitudeField: 'latitude',
  longitudeField: 'longitude',
  selectFields: ['id', 'occurred', 'latitude', 'longitude'],
  mapRow,
};

const query: IncidentQuery = {
  center: [-75, 40],
  radiusMeters: 3000,
  windowDays: 30,
  now: new Date('2026-08-17T12:00:00.000Z'),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Socrata provider boundary', () => {
  it('builds a bounded, ordered, two-window query URL', () => {
    const url = new URL(buildSocrataUrl(config, query));
    expect(url.origin).toBe('https://example.test');
    expect(url.searchParams.get('$select')).toBe('id,occurred,latitude,longitude');
    expect(url.searchParams.get('$order')).toBe('occurred DESC');
    expect(url.searchParams.get('$limit')).toBe(String(SOCRATA_QUERY_LIMIT));
    const where = url.searchParams.get('$where') ?? '';
    expect(where).toContain("occurred >= '2026-06-18T12:00:00.000'");
    expect(where).toContain("occurred <= '2026-08-17T12:00:00.000'");
    expect(where).toContain('latitude >=');
    expect(where).toContain('longitude <=');
  });

  it('fetches, maps, filters invalid rows, and reports provenance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: 'valid', occurred: '2026-08-12T12:00:00Z', latitude: '40', longitude: '-75' },
      { occurred: '2026-08-12T12:00:00Z', latitude: '40', longitude: '-75' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createSocrataProvider(config);
    const batch = await provider.fetchIncidents(query);
    expect(provider.meta).toBe(meta);
    expect(batch.incidents).toHaveLength(1);
    expect(batch.incidents[0]?.id).toBe('valid');
    expect(batch.provider).toBe(meta);
    expect(batch.truncated).toBe(false);
    expect(batch.requestUrl).toContain('$where=');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('marks a batch truncated at the upstream record limit', async () => {
    const payload = Array.from({ length: SOCRATA_QUERY_LIMIT }, (_, index) => ({
      id: String(index),
      occurred: '2026-08-12T12:00:00Z',
      latitude: '40',
      longitude: '-75',
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
    const batch = await createSocrataProvider(config).fetchIncidents(query);
    expect(batch.incidents).toHaveLength(SOCRATA_QUERY_LIMIT);
    expect(batch.truncated).toBe(true);
  });

  it('surfaces HTTP and payload contract failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(createSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('HTTP 503');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"not an array"}', { status: 200 })));
    await expect(createSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('unexpected response');
  });

  it('normalizes primitive coordinate and text fields', () => {
    expect(finiteCoordinate('40.5')).toBe(40.5);
    expect(finiteCoordinate(-75)).toBe(-75);
    expect(finiteCoordinate('not-a-number')).toBeNull();
    expect(text('  label  ')).toBe('label');
    expect(text('', 'fallback')).toBe('fallback');
    expect(text(42, 'fallback')).toBe('fallback');
  });
});
