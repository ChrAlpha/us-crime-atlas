import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncidentQuery, ProviderMeta } from '../../types';
import { buildIncident } from './incident';
import { LATEST_RECORD_LOOKBACK_DAYS } from './shared';
import {
  buildSocrataCountUrl,
  buildSocrataLatestUrl,
  buildSocrataQueryUrl,
  createSocrataProvider,
  datasetIdFromEndpoint,
  LATEST_RECORD_TTL_MS,
  metadataUrlFromEndpoint,
  parseSocrataCount,
  parseSocrataLatest,
  resolvedCoordinates,
  resolvedNumber,
  resolvedText,
  resolvedValue,
  resolveSocrataAliases,
  SOCRATA_MAX_PAGES,
  SOCRATA_PAGE_SIZE,
  validateResolvedFields,
  type ResolvedSocrataFields,
  type SocrataProviderConfig,
} from './socrata';
import { CHICAGO_META } from './socrataCities';

type Key = 'id' | 'date' | 'category' | 'latitude' | 'longitude' | 'point';
type Fields = ResolvedSocrataFields<Key>;

const ENDPOINT = 'https://data.example.gov/resource/abcd-1234.json';
const META: ProviderMeta = {
  ...CHICAGO_META,
  id: 'test',
  agency: 'Test Police',
  endpoint: ENDPOINT,
  timeZone: 'America/Chicago',
};

const PAIR_FIELDS: Fields = {
  id: 'case_id',
  date: 'occurred',
  category: 'offense',
  latitude: 'lat',
  longitude: 'lon',
  point: null,
};

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

const QUERY: IncidentQuery = {
  center: [-87.6298, 41.8837],
  radiusMeters: 3000,
  startEpochMs: day('2026-09-22'),
  endEpochMs: day('2026-10-22'),
};

function mapRow(row: Record<string, unknown>, fields: Fields) {
  const coordinates = resolvedCoordinates(row, fields, { latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point' });
  if (!coordinates) return null;
  return buildIncident(META, {
    sourceId: resolvedText(row, fields, 'id'),
    occurredAt: resolvedText(row, fields, 'date').slice(0, 19),
    rawCategory: resolvedText(row, fields, 'category', 'Unclassified'),
    description: '',
    locationLabel: 'Block',
    coordinates,
  });
}

function config(overrides: Partial<SocrataProviderConfig<Key>> = {}): SocrataProviderConfig<Key> {
  return {
    meta: META,
    schema: { fields: PAIR_FIELDS },
    dateKey: 'date',
    latitudeKey: 'latitude',
    longitudeKey: 'longitude',
    pointKey: 'point',
    mapRow,
    ...overrides,
  };
}

function params(url: string) {
  const parsed = new URL(url);
  return { path: `${parsed.origin}${parsed.pathname}`, search: parsed.searchParams };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(route: Route) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => route(new URL(input), init));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const isCount = (url: URL) => url.searchParams.get('$select') === 'count(*) AS total';
const isLatest = (url: URL) => url.searchParams.get('$select')?.startsWith('max(') ?? false;

function row(id: string, occurred: string, lat: unknown = '41.884', lon: unknown = '-87.629') {
  return { case_id: id, occurred, offense: 'THEFT', lat, lon };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Socrata endpoint helpers', () => {
  it('derives dataset ids and metadata URLs from resource endpoints', () => {
    expect(datasetIdFromEndpoint(ENDPOINT)).toBe('abcd-1234');
    expect(metadataUrlFromEndpoint(ENDPOINT)).toBe('https://data.example.gov/api/views/abcd-1234');
  });

  it('rejects endpoints that are not resource JSON URLs', () => {
    expect(() => datasetIdFromEndpoint('https://data.example.gov/d/abcd-1234')).toThrow('Unsupported Socrata endpoint');
  });
});

describe('alias resolution', () => {
  it('resolves the first reviewed alias that the dataset publishes', () => {
    const fields = resolveSocrataAliases(
      { id: ['offense_id', 'report_number'], date: ['offense_date', 'report_date_time'], category: ['missing'] },
      ['report_number', 'report_date_time', 'offense_date'],
    );
    expect(fields).toEqual({ id: 'report_number', date: 'offense_date', category: null });
  });

  it('fails closed on missing required roles or coordinates', () => {
    const fields = { ...PAIR_FIELDS, date: null, id: null };
    expect(() => validateResolvedFields(config(), fields, ['id', 'date'])).toThrow(
      'Test Police metadata is missing required fields: date, id',
    );
    expect(() => validateResolvedFields(config(), { ...PAIR_FIELDS, latitude: null }, [])).toThrow(
      'Test Police metadata has no usable coordinate semantics',
    );
  });

  it('accepts either a coordinate pair or a point field', () => {
    expect(validateResolvedFields(config(), PAIR_FIELDS, ['id'])).toBe(PAIR_FIELDS);
    const pointOnly = { ...PAIR_FIELDS, latitude: null, longitude: null, point: 'location' };
    expect(validateResolvedFields(config(), pointOnly, ['id'])).toBe(pointOnly);
    expect(() => validateResolvedFields(config({ pointKey: undefined as never }), { ...pointOnly }, [])).toThrow('coordinate');
  });
});

describe('query URLs', () => {
  it('builds a bounded, day-aligned, stably ordered page query', () => {
    const { path, search } = params(buildSocrataQueryUrl(config(), PAIR_FIELDS, QUERY));
    expect(path).toBe(ENDPOINT);
    expect(search.get('$select')).toBe('case_id,occurred,offense,lat,lon');
    expect(search.get('$order')).toBe('occurred DESC, :id');
    expect(search.get('$limit')).toBe(String(SOCRATA_PAGE_SIZE));
    expect(search.has('$offset')).toBe(false);
    const where = search.get('$where') ?? '';
    expect(where).toMatch(/^occurred >= '2026-09-22' AND occurred < '2026-10-22' AND /);
    expect(where).toMatch(/lat >= 41\.85\d{5} AND lat <= 41\.91\d{5} AND lon >= -87\.66\d{5} AND lon <= -87\.59\d{5}$/);
  });

  it('rounds partial-day ranges outward and adds paging offsets', () => {
    const url = buildSocrataQueryUrl(config(), PAIR_FIELDS, {
      ...QUERY,
      startEpochMs: Date.parse('2026-09-22T10:00:00Z'),
      endEpochMs: Date.parse('2026-10-21T10:00:00Z'),
    }, { offset: 10_000, limit: 5000 });
    const { search } = params(url);
    expect(search.get('$where')).toContain("occurred >= '2026-09-22' AND occurred < '2026-10-22'");
    expect(search.get('$offset')).toBe('10000');
  });

  it('queries point columns with within_box', () => {
    const fields = { ...PAIR_FIELDS, latitude: null, longitude: null, point: 'geocoded_column' };
    const where = params(buildSocrataQueryUrl(config(), fields, QUERY)).search.get('$where') ?? '';
    expect(where).toMatch(/within_box\(geocoded_column, 41\.91\d+, -87\.66\d+, 41\.85\d+, -87\.59\d+\)$/);
  });

  it('compares text coordinates sign-aware, excluding privacy placeholders', () => {
    const seattle: IncidentQuery = { ...QUERY, center: [-122.3422, 47.6097], radiusMeters: 3000 };
    const where = params(buildSocrataQueryUrl(config({ coordinateFieldsAreText: true }), PAIR_FIELDS, seattle)).search.get('$where') ?? '';
    expect(where).toContain("lat NOT IN ('REDACTED', '-', '')");
    expect(where).toContain("lon NOT IN ('REDACTED', '-', '')");
    // Positive latitudes compare in natural text order.
    expect(where).toMatch(/lat >= '47\.58\d{5}' AND lat <= '47\.63\d{5}'/);
    // Negative longitudes sort in reverse as text: the western bound is the upper text bound.
    expect(where).toMatch(/lon <= '-122\.38\d{5}' AND lon >= '-122\.30\d{5}'/);
  });

  it('escapes configured placeholders', () => {
    const where = params(buildSocrataQueryUrl(
      config({ coordinateFieldsAreText: true, coordinatePlaceholders: ["N/A", "O'X"] }),
      PAIR_FIELDS,
      { ...QUERY, center: [-122.3422, 47.6097] },
    )).search.get('$where') ?? '';
    expect(where).toContain("lat NOT IN ('N/A', 'O''X')");
  });

  it('refuses text bounds that cross a degree or the sign boundary', () => {
    const textConfig = config({ coordinateFieldsAreText: true });
    expect(() => buildSocrataQueryUrl(textConfig, PAIR_FIELDS, { ...QUERY, center: [-122.5, 47.999] })).toThrow(
      'Text coordinate bounds for lat cross a degree boundary',
    );
    expect(() => buildSocrataQueryUrl(textConfig, PAIR_FIELDS, { ...QUERY, center: [0.001, 47.5] })).toThrow(
      'Text coordinate bounds for lon cross a degree boundary',
    );
  });

  it('supports point-only and pair-only configurations', () => {
    const pointOnly = config({ latitudeKey: undefined as never, longitudeKey: undefined as never });
    const fields = { ...PAIR_FIELDS, point: 'location' };
    expect(params(buildSocrataQueryUrl(pointOnly, fields, QUERY)).search.get('$where')).toContain('within_box(location, ');
    const pairOnly = config({ pointKey: undefined as never });
    expect(() => buildSocrataQueryUrl(pairOnly, { ...fields, latitude: null }, QUERY)).toThrow(
      'Test Police is missing resolved coordinate fields',
    );
  });

  it('fails when date or coordinate fields are unresolved', () => {
    expect(() => buildSocrataQueryUrl(config(), { ...PAIR_FIELDS, date: null }, QUERY)).toThrow(
      'Test Police is missing its resolved date field',
    );
    expect(() => buildSocrataQueryUrl(config(), { ...PAIR_FIELDS, latitude: null }, QUERY)).toThrow(
      'Test Police is missing resolved coordinate fields',
    );
  });

  it('builds count and latest-record queries over the same predicates', () => {
    const count = params(buildSocrataCountUrl(config(), PAIR_FIELDS, QUERY)).search;
    expect(count.get('$select')).toBe('count(*) AS total');
    expect(count.get('$where')).toBe(params(buildSocrataQueryUrl(config(), PAIR_FIELDS, QUERY)).search.get('$where'));

    const latest = params(buildSocrataLatestUrl(config(), PAIR_FIELDS, Date.parse('2026-10-21T22:30:00Z'))).search;
    const lookback = new Date(day('2026-10-21') - LATEST_RECORD_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(latest.get('$select')).toBe('max(occurred) AS latest_record');
    expect(latest.get('$where')).toBe(`occurred >= '${lookback}' AND occurred < '2026-10-22'`);
  });
});

describe('response parsing', () => {
  it('reads latest-record dates from floating and text timestamp columns', () => {
    expect(parseSocrataLatest([{ latest_record: '2026-06-30T00:00:00.000' }], 'NYPD')).toBe(day('2026-06-30'));
    expect(parseSocrataLatest([{ latest_record: '2026-10-19 00:00:00.0000000' }], 'Dallas')).toBe(day('2026-10-19'));
  });

  it('treats an empty aggregate as no records', () => {
    expect(parseSocrataLatest([], 'NYPD')).toBeNull();
    expect(parseSocrataLatest([{}], 'NYPD')).toBeNull();
    expect(parseSocrataLatest([{ latest_record: null }], 'NYPD')).toBeNull();
    expect(parseSocrataLatest([{ latest_record: '' }], 'NYPD')).toBeNull();
  });

  it('rejects malformed latest-record responses', () => {
    expect(() => parseSocrataLatest({ error: true }, 'NYPD')).toThrow('NYPD returned an unexpected latest-record response');
    expect(() => parseSocrataLatest([{ latest_record: 'soon' }], 'NYPD')).toThrow('NYPD returned an unreadable latest record date');
  });

  it('reads counts and rejects malformed count responses', () => {
    expect(parseSocrataCount([{ total: '3016' }])).toBe(3016);
    expect(parseSocrataCount([{ total: 0 }])).toBe(0);
    expect(() => parseSocrataCount([])).toThrow('Unexpected Socrata count response');
    expect(() => parseSocrataCount({ total: 1 })).toThrow('Unexpected Socrata count response');
  });
});

describe('row value helpers', () => {
  const fields: Fields = { ...PAIR_FIELDS, point: 'location' };

  it('reads resolved values, text and numbers', () => {
    const source = { case_id: 7, offense: '  ROBBERY ', lat: '41.5' };
    expect(resolvedValue(source, fields, 'id')).toBe(7);
    expect(resolvedValue(source, { ...fields, id: null }, 'id')).toBeUndefined();
    expect(resolvedText(source, fields, 'id')).toBe('7');
    expect(resolvedText(source, fields, 'category')).toBe('ROBBERY');
    expect(resolvedText(source, fields, 'date', 'fallback')).toBe('fallback');
    expect(resolvedNumber(source, fields, 'latitude')).toBe(41.5);
    expect(resolvedNumber(source, fields, 'longitude')).toBeNull();
  });

  it('prefers a valid pair, then a GeoJSON point, then a latitude/longitude point', () => {
    const keys = { latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point' } as const;
    expect(resolvedCoordinates({ lat: '41.88', lon: '-87.63' }, fields, keys)).toEqual([-87.63, 41.88]);
    expect(resolvedCoordinates({ lat: '0', lon: '0', location: { type: 'Point', coordinates: [-87.6, 41.8] } }, fields, keys))
      .toEqual([-87.6, 41.8]);
    expect(resolvedCoordinates({ location: { coordinates: [0, 0], latitude: '32.68', longitude: '-96.79' } }, fields, keys))
      .toEqual([-96.79, 32.68]);
    expect(resolvedCoordinates({ location: { latitude: '32.68', longitude: '-96.79' } }, fields, keys)).toEqual([-96.79, 32.68]);
  });

  it('returns null for missing, non-object and sentinel points', () => {
    const keys = { latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point' } as const;
    expect(resolvedCoordinates({}, fields, keys)).toBeNull();
    expect(resolvedCoordinates({ location: 'POINT (-87 41)' }, fields, keys)).toBeNull();
    expect(resolvedCoordinates({ location: { coordinates: [0] } }, fields, keys)).toBeNull();
    expect(resolvedCoordinates({ lat: '41', lon: '-87' }, fields, { pointKey: 'point' })).toBeNull();
    expect(resolvedCoordinates({ lat: '41', lon: '-87' }, fields, {})).toBeNull();
  });
});

describe('createSocrataProvider with a reviewed fixed schema', () => {
  it('resolves fields without requesting metadata', async () => {
    const fetchMock = stubFetch(() => jsonResponse([]));
    const provider = createSocrataProvider(config());
    await expect(provider.resolveFields()).resolves.toBe(PAIR_FIELDS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps rows, drops unusable ones and applies the exact half-open range', async () => {
    const fetchMock = stubFetch((url) => {
      if (isCount(url)) return jsonResponse([{ total: '4' }]);
      return jsonResponse([
        row('in-range', '2026-10-21T23:59:00.000'),
        row('at-end', '2026-10-22T00:00:00.000'),
        row('bad-coordinates', '2026-10-01T12:00:00.000', 'REDACTED', 'REDACTED'),
        row('at-start', '2026-09-22T00:00:00.000'),
      ]);
    });
    const batch = await createSocrataProvider(config()).fetchIncidents(QUERY);
    expect(batch.incidents.map((incident) => incident.id)).toEqual(['test:in-range', 'test:at-start']);
    expect(batch.recordLimit).toBe(SOCRATA_PAGE_SIZE * SOCRATA_MAX_PAGES);
    expect(batch.truncated).toBe(false);
    expect(batch.requestUrls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests exactly the counted pages and reports truncation at the budget', async () => {
    const pages = (total: number) => stubFetch((url) => {
      if (isCount(url)) return jsonResponse([{ total: String(total) }]);
      const offset = Number(url.searchParams.get('$offset') ?? 0);
      const size = Math.max(0, Math.min(2, total - offset));
      return jsonResponse(Array.from({ length: size }, (_, index) => row(`r${offset + index}`, '2026-10-01T12:00:00.000')));
    });

    pages(5);
    const provider = createSocrataProvider(config({ pageSize: 2, maxPages: 3 }));
    const complete = await provider.fetchIncidents(QUERY);
    expect(complete.requestUrls.map((url) => new URL(url).searchParams.get('$offset'))).toEqual([null, '2', '4']);
    expect(complete.incidents).toHaveLength(5);
    expect(complete.truncated).toBe(false);
    expect(complete.recordLimit).toBe(6);

    pages(9);
    const capped = await provider.fetchIncidents(QUERY);
    expect(capped.incidents).toHaveLength(6);
    expect(capped.truncated).toBe(true);
  });

  it('surfaces HTTP and unexpected-payload failures with the agency name', async () => {
    stubFetch((url) => (isCount(url) ? jsonResponse([{ total: '1' }]) : new Response('busy', { status: 429 })));
    await expect(createSocrataProvider(config()).fetchIncidents(QUERY)).rejects.toThrow('Test Police returned HTTP 429');

    stubFetch((url) => (isCount(url) ? jsonResponse([{ total: '1' }]) : jsonResponse({ error: 'bad query' })));
    await expect(createSocrataProvider(config()).fetchIncidents(QUERY)).rejects.toThrow(
      'Test Police returned an unexpected response',
    );
  });

  it('passes the caller signal to page and count requests', async () => {
    const controller = new AbortController();
    const fetchMock = stubFetch((url) => (isCount(url) ? jsonResponse([{ total: '0' }]) : jsonResponse([])));
    await createSocrataProvider(config()).fetchIncidents({ ...QUERY, signal: controller.signal });
    for (const call of fetchMock.mock.calls) expect(call[1]?.signal).toBe(controller.signal);
  });

  it('looks up the latest record in the provider zone and caches it for the TTL', async () => {
    vi.useFakeTimers();
    // 03:00 UTC on Oct 21 is still Oct 20 in Chicago, so "tomorrow" is Oct 21 there.
    vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
    const fetchMock = stubFetch((url) => {
      expect(isLatest(url)).toBe(true);
      return jsonResponse([{ latest_record: '2026-10-19T20:49:00.000' }]);
    });
    const provider = createSocrataProvider(config());

    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(Date.parse('2026-10-19T20:49:00Z'));
    const where = new URL(fetchMock.mock.calls[0]![0]).searchParams.get('$where');
    expect(where).toContain("occurred < '2026-10-21'");

    await provider.fetchLatestRecordEpoch();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(LATEST_RECORD_TTL_MS);
    await provider.fetchLatestRecordEpoch();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches the latest record after resetCache and keeps its fixed fields', async () => {
    let latest = '2026-10-19T20:49:00.000';
    const fetchMock = stubFetch(() => jsonResponse([{ latest_record: latest }]));
    const provider = createSocrataProvider(config());

    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(Date.parse('2026-10-19T20:49:00Z'));
    latest = '2026-10-20T08:00:00.000';
    await provider.fetchLatestRecordEpoch();
    expect(fetchMock).toHaveBeenCalledOnce();

    provider.resetCache?.();
    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(Date.parse('2026-10-20T08:00:00Z'));
    await expect(provider.resolveFields()).resolves.toBe(PAIR_FIELDS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => input.includes('/api/views/'))).toBe(false);
  });
});

describe('createSocrataProvider with metadata-resolved aliases', () => {
  const aliasConfig = () => config({
    schema: {
      aliases: {
        id: ['offense_id', 'report_number'],
        date: ['offense_date'],
        category: ['offense_sub_category', 'offense_category'],
        latitude: ['latitude'],
        longitude: ['longitude'],
        point: [],
      },
      requiredKeys: ['id', 'category'],
    },
  });

  const metadata = (fieldNames: unknown[]) => ({ columns: fieldNames.map((fieldName) => ({ fieldName })) });

  it('resolves reviewed aliases from live metadata once and builds queries from them', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.pathname === '/api/views/abcd-1234') {
        return jsonResponse(metadata(['report_number', 'offense_date', 'offense_category', 'latitude', 'longitude', 42, '']));
      }
      if (isCount(url)) return jsonResponse([{ total: '1' }]);
      return jsonResponse([{ report_number: 'R-1', offense_date: '2026-10-01T12:00:00.000', offense_category: 'THEFT', latitude: '41.884', longitude: '-87.629' }]);
    });
    const provider = createSocrataProvider(aliasConfig());

    await expect(provider.resolveFields()).resolves.toEqual({
      id: 'report_number',
      date: 'offense_date',
      category: 'offense_category',
      latitude: 'latitude',
      longitude: 'longitude',
      point: null,
    });
    const batch = await provider.fetchIncidents(QUERY);
    expect(batch.incidents.map((incident) => incident.id)).toEqual(['test:R-1']);
    expect(new URL(batch.requestUrls[0]!).searchParams.get('$select')).toBe('report_number,offense_date,offense_category,latitude,longitude');
    expect(fetchMock.mock.calls.filter(([input]) => input.includes('/api/views/'))).toHaveLength(1);
  });

  it('fails closed when metadata lacks a required role and retries on the next request', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.pathname === '/api/views/abcd-1234') return jsonResponse({});
      return jsonResponse([]);
    });
    const provider = createSocrataProvider(aliasConfig());
    await expect(provider.fetchIncidents(QUERY)).rejects.toThrow(
      'Test Police metadata is missing required fields: date, id, category',
    );
    await expect(provider.fetchLatestRecordEpoch()).rejects.toThrow('missing required fields');
    expect(fetchMock.mock.calls.filter(([input]) => input.includes('/api/views/'))).toHaveLength(2);
  });

  it('reports metadata HTTP failures with the agency name', async () => {
    stubFetch(() => new Response('gone', { status: 404 }));
    await expect(createSocrataProvider(aliasConfig()).fetchIncidents(QUERY)).rejects.toThrow(
      'Test Police metadata returned HTTP 404',
    );
  });

  it('keeps serving a later request after the first caller aborts mid-metadata (StrictMode regression)', async () => {
    let releaseMetadata!: () => void;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const metadataSignals: Array<AbortSignal | null | undefined> = [];
    stubFetch(async (url, init) => {
      if (url.pathname === '/api/views/abcd-1234') {
        metadataSignals.push(init?.signal);
        await metadataGate;
        return jsonResponse(metadata(['offense_id', 'offense_date', 'offense_sub_category', 'latitude', 'longitude']));
      }
      if (isCount(url)) return jsonResponse([{ total: '1' }]);
      return jsonResponse([{ offense_id: 'O-1', offense_date: '2026-10-01T12:00:00.000', offense_sub_category: 'THEFT', latitude: '41.884', longitude: '-87.629' }]);
    });
    const provider = createSocrataProvider(aliasConfig());

    const firstEffect = new AbortController();
    const first = provider.fetchIncidents({ ...QUERY, signal: firstEffect.signal });
    const secondEffect = new AbortController();
    const second = provider.fetchIncidents({ ...QUERY, signal: secondEffect.signal });
    firstEffect.abort();
    releaseMetadata();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ incidents: [expect.objectContaining({ id: 'test:O-1' })] });
    expect(metadataSignals).toHaveLength(1);
    expect(metadataSignals[0]).not.toBe(firstEffect.signal);
    expect(metadataSignals[0]?.aborted).toBe(false);
  });

  it('re-resolves metadata and the latest record after resetCache', async () => {
    let category = 'offense_category';
    const fetchMock = stubFetch((url) => {
      if (url.pathname === '/api/views/abcd-1234') {
        return jsonResponse(metadata(['report_number', 'offense_date', category, 'latitude', 'longitude']));
      }
      return jsonResponse([{ latest_record: '2026-10-19T20:49:00.000' }]);
    });
    const metadataCalls = () => fetchMock.mock.calls.filter(([input]) => input.includes('/api/views/')).length;
    const provider = createSocrataProvider(aliasConfig());

    await expect(provider.resolveFields()).resolves.toMatchObject({ category: 'offense_category' });
    await provider.fetchLatestRecordEpoch();
    expect(metadataCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The publisher renamed a column; a reset picks up the new schema.
    category = 'offense_sub_category';
    await expect(provider.resolveFields()).resolves.toMatchObject({ category: 'offense_category' });
    provider.resetCache?.();
    await expect(provider.resolveFields()).resolves.toMatchObject({ category: 'offense_sub_category' });
    await provider.fetchLatestRecordEpoch();
    expect(metadataCalls()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
