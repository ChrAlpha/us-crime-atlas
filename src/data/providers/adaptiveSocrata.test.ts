import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident, IncidentQuery, ProviderMeta } from '../../types';
import {
  buildAdaptiveSocrataUrl,
  createAdaptiveSocrataProvider,
  metadataUrlFromEndpoint,
  resolveSocrataAliases,
  resolvedCoordinates,
  resolvedNumber,
  resolvedText,
  type AdaptiveSocrataProviderConfig,
  type ResolvedSocrataFields,
} from './adaptiveSocrata';

type TestKey = 'id' | 'date' | 'category' | 'latitude' | 'longitude' | 'point' | 'optional';

const meta: ProviderMeta = {
  id: 'adaptive-test',
  city: 'Test City',
  state: 'TS',
  label: 'Test City, TS',
  agency: 'Test Police Department',
  datasetName: 'Adaptive incidents',
  endpoint: 'https://example.test/resource/abcd-1234.json',
  sourceUrl: 'https://example.test/d/abcd-1234',
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

const aliases = {
  id: ['incident_id', 'id'],
  date: ['occurred_at', 'date'],
  category: ['offense'],
  latitude: ['lat', 'latitude'],
  longitude: ['lon', 'longitude'],
  point: ['location'],
  optional: ['detail'],
} as const;

const resolved: ResolvedSocrataFields<TestKey> = {
  id: 'incident_id',
  date: 'occurred_at',
  category: 'offense',
  latitude: 'lat',
  longitude: 'lon',
  point: null,
  optional: null,
};

function mapRow(row: Record<string, unknown>, fields: ResolvedSocrataFields<TestKey>): Incident | null {
  const id = resolvedText(row, fields, 'id');
  const occurredAt = resolvedText(row, fields, 'date');
  const coordinates = resolvedCoordinates(row, fields, {
    latitudeKey: 'latitude',
    longitudeKey: 'longitude',
    pointKey: 'point',
  });
  if (!id || !occurredAt || !coordinates) return null;
  return {
    id,
    providerId: meta.id,
    occurredAt,
    occurredAtEpochMs: Date.parse(occurredAt),
    localHour: 12,
    category: 'other',
    group: 'other',
    rawCategory: resolvedText(row, fields, 'category', 'Other'),
    description: 'Test',
    locationLabel: 'Test location',
    coordinates,
    severity: 1,
    isViolent: false,
    precision: 'approximate',
  };
}

const config: AdaptiveSocrataProviderConfig<TestKey> = {
  meta,
  aliases,
  requiredKeys: ['id', 'date', 'category'],
  dateKey: 'date',
  latitudeKey: 'latitude',
  longitudeKey: 'longitude',
  pointKey: 'point',
  coordinateFieldsAreText: true,
  mapRow,
};

const query: IncidentQuery = {
  center: [-75, 40],
  radiusMeters: 3000,
  windowDays: 30,
  now: new Date('2026-08-17T12:00:00.000Z'),
};

afterEach(() => vi.unstubAllGlobals());

describe('adaptive Socrata provider boundary', () => {
  it('derives metadata URL and resolves the first available alias', () => {
    expect(metadataUrlFromEndpoint(meta.endpoint)).toBe('https://example.test/api/views/abcd-1234');
    expect(resolveSocrataAliases(aliases, ['id', 'occurred_at', 'offense', 'latitude', 'longitude'])).toEqual({
      id: 'id',
      date: 'occurred_at',
      category: 'offense',
      latitude: 'latitude',
      longitude: 'longitude',
      point: null,
      optional: null,
    });
    expect(() => metadataUrlFromEndpoint('https://example.test/not-socrata')).toThrow('Unsupported Socrata endpoint');
  });

  it('builds bounded queries for separate coordinates and point geometry', () => {
    const url = new URL(buildAdaptiveSocrataUrl(config, resolved, query));
    expect(url.searchParams.get('$select')).toBe('incident_id,occurred_at,offense,lat,lon');
    expect(url.searchParams.get('$order')).toBe('occurred_at DESC');
    expect(url.searchParams.get('$where')).toContain("occurred_at >= '2026-06-18T12:00:00.000'");
    expect(url.searchParams.get('$where')).toContain("lat >= '39.973");
    expect(url.searchParams.get('$where')).toContain("lon <= '-75.035");

    const pointFields = { ...resolved, latitude: null, longitude: null, point: 'location' };
    const pointUrl = new URL(buildAdaptiveSocrataUrl(config, pointFields, query));
    expect(pointUrl.searchParams.get('$where')).toContain('within_box(location');
    expect(() => buildAdaptiveSocrataUrl(config, { ...pointFields, point: null }, query)).toThrow('coordinate fields');
    expect(() => buildAdaptiveSocrataUrl(config, { ...resolved, date: null }, query)).toThrow('date field');
  });

  it('resolves metadata once, fetches rows, filters invalid records, and reports provenance', async () => {
    const metadataPayload = JSON.stringify({
      columns: [
        { fieldName: 'incident_id' },
        { fieldName: 'occurred_at' },
        { fieldName: 'offense' },
        { fieldName: 'lat' },
        { fieldName: 'lon' },
      ],
    });
    const dataPayload = JSON.stringify([
      { incident_id: 42, occurred_at: '2026-08-12T12:00:00', offense: 'Other', lat: '40', lon: '-75' },
      { occurred_at: '2026-08-12T12:00:00', offense: 'Other', lat: '40', lon: '-75' },
    ]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(metadataPayload, { status: 200 }))
      .mockImplementation(() => Promise.resolve(new Response(dataPayload, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createAdaptiveSocrataProvider(config);
    const first = await provider.fetchIncidents(query);
    const second = await provider.fetchIncidents(query);
    expect(first.incidents).toHaveLength(1);
    expect(first.incidents[0]?.id).toBe('42');
    expect(first.provider).toBe(meta);
    expect(first.truncated).toBe(false);
    expect(new URL(first.requestUrl).searchParams.get('$where')).toContain('occurred_at');
    expect(second.incidents).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces metadata, semantic, HTTP, and payload failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 503 })));
    await expect(createAdaptiveSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('metadata returned HTTP 503');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      columns: [{ fieldName: 'incident_id' }],
    }), { status: 200 })));
    await expect(createAdaptiveSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('missing required fields');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      columns: [
        { fieldName: 'incident_id' },
        { fieldName: 'occurred_at' },
        { fieldName: 'offense' },
      ],
    }), { status: 200 })));
    await expect(createAdaptiveSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('no usable coordinate semantics');

    const columns = {
      columns: [
        { fieldName: 'incident_id' },
        { fieldName: 'occurred_at' },
        { fieldName: 'offense' },
        { fieldName: 'lat' },
        { fieldName: 'lon' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(columns), { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 502 })));
    await expect(createAdaptiveSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('returned HTTP 502');

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(columns), { status: 200 }))
      .mockResolvedValueOnce(new Response('{"message":"not an array"}', { status: 200 })));
    await expect(createAdaptiveSocrataProvider(config).fetchIncidents(query)).rejects.toThrow('unexpected response');
  });

  it('reads primitive fields and both Socrata point shapes safely', () => {
    const row = { incident_id: '  x  ', lat: '40.5', lon: '-75.5' };
    expect(resolvedText(row, resolved, 'id')).toBe('x');
    expect(resolvedText({ incident_id: 9 }, resolved, 'id')).toBe('9');
    expect(resolvedText(row, resolved, 'optional', 'fallback')).toBe('fallback');
    expect(resolvedNumber(row, resolved, 'latitude')).toBe(40.5);
    expect(resolvedCoordinates(row, resolved, {
      latitudeKey: 'latitude',
      longitudeKey: 'longitude',
    })).toEqual([-75.5, 40.5]);

    const pointFields = { ...resolved, latitude: null, longitude: null, point: 'location' };
    expect(resolvedCoordinates({
      location: { type: 'Point', coordinates: [-75, 40] },
    }, pointFields, { pointKey: 'point' })).toEqual([-75, 40]);
    expect(resolvedCoordinates({
      location: { longitude: -74, latitude: 41 },
    }, pointFields, { pointKey: 'point' })).toEqual([-74, 41]);
    expect(resolvedCoordinates({
      location: { coordinates: [0, 0] },
    }, pointFields, { pointKey: 'point' })).toBeNull();
  });
});
