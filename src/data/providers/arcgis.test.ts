import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncidentQuery, ProviderMeta } from '../../types';
import {
  ARCGIS_MAX_PAGES,
  ARCGIS_PAGE_SIZE,
  arcgisLocalTimestamp,
  arcgisNumber,
  arcgisText,
  attribute,
  buildArcgisCountUrl,
  buildArcgisLatestUrl,
  buildArcgisQueryUrl,
  createArcgisProvider,
  layerEpochToLocalClock,
  parseArcgisCount,
  parseArcgisLatest,
  type ArcgisFeature,
  type ArcgisProviderConfig,
} from './arcgis';
import { DETROIT_META } from './arcgisCities';
import { buildIncident } from './incident';
import { LATEST_RECORD_LOOKBACK_DAYS, numberValue, publicCoordinates, textValue } from './shared';
import { LATEST_RECORD_TTL_MS } from './socrata';

const LAYER = 'https://services.example.com/arcgis/rest/services/Crime/FeatureServer/0';
const META: ProviderMeta = { ...DETROIT_META, id: 'arc', agency: 'Arc Police', endpoint: LAYER, timeZone: 'America/Detroit' };

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

const QUERY: IncidentQuery = {
  center: [-83.0458, 42.3314],
  radiusMeters: 3000,
  startEpochMs: day('2026-09-22'),
  endEpochMs: day('2026-10-22'),
};

function config(overrides: Partial<ArcgisProviderConfig> = {}): ArcgisProviderConfig {
  const base: ArcgisProviderConfig = {
    meta: META,
    layerUrl: LAYER,
    dateField: 'occurred_at',
    objectIdField: 'OBJECTID',
    epochSemantics: 'utc',
    outFields: ['case_id', 'occurred_at', 'offense', 'lon', 'lat', 'OBJECTID'],
    mapFeature: (feature: ArcgisFeature) => {
      const row = feature.attributes ?? {};
      const coordinates = publicCoordinates(row.lon, row.lat);
      const occurredAt = arcgisLocalTimestamp(row.occurred_at, base.epochSemantics, META.timeZone);
      if (!coordinates || !occurredAt) return null;
      return buildIncident(META, {
        sourceId: textValue(row.case_id),
        occurredAt,
        rawCategory: textValue(row.offense, 'Unclassified'),
        description: '',
        locationLabel: 'Intersection',
        coordinates,
      });
    },
  };
  return { ...base, ...overrides };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(route: (url: URL) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => route(new URL(input)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const isCount = (url: URL) => url.searchParams.get('returnCountOnly') === 'true';
const isLatest = (url: URL) => url.searchParams.has('outStatistics');

function feature(caseId: string, utcInstant: string): ArcgisFeature {
  return { attributes: { case_id: caseId, occurred_at: Date.parse(utcInstant), offense: 'LARCENY', lon: -83.046, lat: 42.331 } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ArcGIS query URLs', () => {
  it('pads the date predicate by a day, skips geometry and orders stably', () => {
    const url = new URL(buildArcgisQueryUrl(config(), QUERY));
    const search = url.searchParams;
    expect(`${url.origin}${url.pathname}`).toBe(`${LAYER}/query`);
    expect(search.get('f')).toBe('json');
    expect(search.get('where')).toBe(
      "occurred_at >= TIMESTAMP '2026-09-21 00:00:00' AND occurred_at < TIMESTAMP '2026-10-23 00:00:00'",
    );
    expect(search.get('outFields')).toBe('case_id,occurred_at,offense,lon,lat,OBJECTID');
    expect(search.get('returnGeometry')).toBe('false');
    expect(search.get('orderByFields')).toBe('occurred_at DESC,OBJECTID ASC');
    expect(search.get('resultOffset')).toBe('0');
    expect(search.get('resultRecordCount')).toBe(String(ARCGIS_PAGE_SIZE));
    expect(search.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(search.get('inSR')).toBe('4326');
    expect(search.get('spatialRel')).toBe('esriSpatialRelIntersects');
    const envelope = JSON.parse(search.get('geometry') ?? '{}');
    expect(envelope.spatialReference).toEqual({ wkid: 4326 });
    expect(envelope.xmin).toBeLessThan(-83.0458);
    expect(envelope.xmax).toBeGreaterThan(-83.0458);
    expect(envelope.ymin).toBeCloseTo(42.3314 - 3000 / 111_195.08, 6);
    expect(envelope.ymax).toBeCloseTo(42.3314 + 3000 / 111_195.08, 6);
  });

  it('pages with resultOffset and resultRecordCount', () => {
    const search = new URL(buildArcgisQueryUrl(config(), QUERY, { offset: 4000, limit: 2000 })).searchParams;
    expect(search.get('resultOffset')).toBe('4000');
    expect(search.get('resultRecordCount')).toBe('2000');
  });

  it('counts over the same filter without returning rows', () => {
    const count = new URL(buildArcgisCountUrl(config(), QUERY)).searchParams;
    const page = new URL(buildArcgisQueryUrl(config(), QUERY)).searchParams;
    expect(count.get('returnCountOnly')).toBe('true');
    expect(count.get('where')).toBe(page.get('where'));
    expect(count.get('geometry')).toBe(page.get('geometry'));
    expect(count.has('outFields')).toBe(false);
  });

  it('looks up the latest record within a bounded lookback', () => {
    const now = Date.parse('2026-10-21T10:15:00Z');
    const search = new URL(buildArcgisLatestUrl(config(), now)).searchParams;
    const lookback = new Date(now - LATEST_RECORD_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    expect(search.get('where')).toBe(
      `occurred_at >= TIMESTAMP '${lookback}' AND occurred_at <= TIMESTAMP '2026-10-22 10:15:00'`,
    );
    expect(JSON.parse(search.get('outStatistics') ?? '[]')).toEqual([
      { statisticType: 'max', onStatisticField: 'occurred_at', outStatisticFieldName: 'latest_record' },
    ]);
  });
});

describe('ArcGIS layer options', () => {
  it('requests WGS84 geometry from layers without coordinate attributes', () => {
    const search = new URL(buildArcgisQueryUrl(config({ returnGeometry: true }), QUERY)).searchParams;
    expect(search.get('returnGeometry')).toBe('true');
    expect(search.get('outSR')).toBe('4326');
    // The count must evaluate the envelope exactly as the pages do.
    expect(new URL(buildArcgisCountUrl(config({ returnGeometry: true }), QUERY)).searchParams.get('outSR')).toBe('4326');
    expect(new URL(buildArcgisCountUrl(config(), QUERY)).searchParams.has('outSR')).toBe(false);
  });

  it('adds a reviewed filter to every query, including the newest-record lookup', () => {
    const filtered = config({ filter: "Agency='IMPD' OR Agency='IMPD2'" });
    expect(new URL(buildArcgisQueryUrl(filtered, QUERY)).searchParams.get('where'))
      .toMatch(/ AND \(Agency='IMPD' OR Agency='IMPD2'\)$/);
    expect(new URL(buildArcgisCountUrl(filtered, QUERY)).searchParams.get('where')).toContain("(Agency='IMPD'");
    expect(new URL(buildArcgisLatestUrl(filtered, Date.parse('2026-10-21T10:15:00Z'))).searchParams.get('where'))
      .toMatch(/ AND \(Agency='IMPD' OR Agency='IMPD2'\)$/);
  });

  it('bounds a table by its coordinate attributes instead of envelope geometry', () => {
    const table = config({ coordinateAttributes: { latitude: 'Latitude', longitude: 'Longitude' } });
    const search = new URL(buildArcgisQueryUrl(table, QUERY)).searchParams;
    expect(search.has('geometry')).toBe(false);
    expect(search.has('geometryType')).toBe(false);
    expect(search.get('where')).toMatch(
      /AND Latitude >= 42\.30\d+ AND Latitude <= 42\.35\d+ AND Longitude >= -83\.08\d+ AND Longitude <= -83\.00\d+$/,
    );
  });
});

describe('ArcGIS epoch semantics', () => {
  it('converts true UTC instants into the publisher clock across daylight saving', () => {
    // Detroit publishes incident_time 02:05 for an epoch of 06:05 UTC during EDT.
    expect(layerEpochToLocalClock(Date.parse('2026-10-21T06:05:00Z'), 'utc', 'America/Detroit')).toBe(Date.parse('2026-10-21T02:05:00Z'));
    expect(layerEpochToLocalClock(Date.parse('2026-01-15T06:05:00Z'), 'utc', 'America/Detroit')).toBe(Date.parse('2026-01-15T01:05:00Z'));
    expect(arcgisLocalTimestamp(Date.parse('2026-03-08T07:30:00Z'), 'utc', 'America/New_York')).toBe('2026-03-08T03:30:00');
    expect(arcgisLocalTimestamp(Date.parse('2026-03-08T06:30:00Z'), 'utc', 'America/New_York')).toBe('2026-03-08T01:30:00');
  });

  it('keeps local wall-clock epochs stored as UTC unchanged', () => {
    // Philadelphia publishes dispatch_time 23:54 for an epoch of 23:54 UTC.
    const epoch = Date.parse('2026-10-19T23:54:00Z');
    expect(layerEpochToLocalClock(epoch, 'local-clock', 'America/New_York')).toBe(epoch);
    expect(arcgisLocalTimestamp(epoch, 'local-clock', 'America/New_York')).toBe('2026-10-19T23:54:00');
  });

  it('rejects unusable epochs', () => {
    for (const value of [null, undefined, '', 'yesterday', Number.NaN, 1e20]) {
      expect(arcgisLocalTimestamp(value, 'utc', 'America/Detroit')).toBeNull();
    }
    expect(arcgisLocalTimestamp(String(Date.parse('2026-10-19T23:54:00Z')), 'local-clock', 'UTC')).toBe('2026-10-19T23:54:00');
  });
});

describe('ArcGIS response parsing', () => {
  it('reads counts and service errors', () => {
    expect(parseArcgisCount({ count: 3016 }, 'Arc Police')).toBe(3016);
    expect(parseArcgisCount({ count: '7' }, 'Arc Police')).toBe(7);
    expect(() => parseArcgisCount({ error: { message: 'Invalid query', details: ['bad where'] } }, 'Arc Police')).toThrow(
      'Arc Police query error: Invalid query: bad where',
    );
    expect(() => parseArcgisCount({}, 'Arc Police')).toThrow('Arc Police returned an unexpected count response');
  });

  it('converts the latest record per layer semantics with a case-insensitive alias', () => {
    const payload = { features: [{ attributes: { LATEST_RECORD: Date.parse('2026-10-21T06:05:00Z') } }] };
    expect(parseArcgisLatest(payload, config())).toBe(Date.parse('2026-10-21T02:05:00Z'));
    expect(parseArcgisLatest(payload, config({ epochSemantics: 'local-clock' }))).toBe(Date.parse('2026-10-21T06:05:00Z'));
  });

  it('treats a null maximum as no records in the lookback period', () => {
    expect(parseArcgisLatest({ features: [{ attributes: { latest_record: null } }] }, config())).toBeNull();
    expect(parseArcgisLatest({ features: [{ attributes: { Latest_Record: null } }] }, config())).toBeNull();
  });

  it('rejects a response without the latest-record statistic', () => {
    for (const payload of [
      { features: [] },
      { features: [{}] },
      { features: [{ attributes: {} }] },
      { features: [{ attributes: { newest: Date.parse('2026-10-21T06:05:00Z') } }] },
    ]) {
      expect(() => parseArcgisLatest(payload, config())).toThrow('Arc Police returned no latest-record statistic');
    }
  });

  it('rejects an unreadable latest-record value instead of reporting no records', () => {
    for (const value of ['2026-10-21', String(Date.parse('2026-10-21T06:05:00Z')), Number.NaN, Number.POSITIVE_INFINITY, undefined, {}]) {
      expect(() => parseArcgisLatest({ features: [{ attributes: { latest_record: value } }] }, config())).toThrow(
        'Arc Police returned an unreadable latest record date',
      );
    }
  });

  it('rejects errors and malformed statistics', () => {
    expect(() => parseArcgisLatest({ error: {} }, config())).toThrow(/^Arc Police query error$/);
    expect(() => parseArcgisLatest({ features: 'none' }, config())).toThrow(
      'Arc Police returned an unexpected latest-record response',
    );
  });
});

describe('ArcGIS attribute helpers', () => {
  it('looks attributes up exactly, then case-insensitively, in name order', () => {
    const row = { CCN: 'DC-1', objectid: 8, START_DATE: null };
    expect(attribute(row, 'CCN')).toBe('DC-1');
    expect(attribute(row, 'OBJECTID')).toBe(8);
    expect(attribute(row, 'missing', 'ccn')).toBe('DC-1');
    expect(attribute(row, 'start_date', 'CCN')).toBeNull();
    expect(attribute(row, 'missing')).toBeUndefined();
  });

  it('re-exports the shared value readers', () => {
    expect(arcgisNumber).toBe(numberValue);
    expect(arcgisText).toBe(textValue);
  });
});

describe('createArcgisProvider', () => {
  it('maps features and applies the exact range after the padded service predicate', async () => {
    const fetchMock = stubFetch((url) => {
      if (isCount(url)) return jsonResponse({ count: 4 });
      return jsonResponse({
        features: [
          feature('in-range', '2026-10-22T03:30:00Z'), // 23:30 EDT on Oct 21
          feature('padding-after', '2026-10-22T05:00:00Z'), // 01:00 EDT on Oct 22
          feature('padding-before', '2026-09-22T03:00:00Z'), // 23:00 EDT on Sep 21
          { attributes: { case_id: 'no-coordinates', occurred_at: Date.parse('2026-10-01T12:00:00Z') } },
        ],
      });
    });
    const batch = await createArcgisProvider(config()).fetchIncidents(QUERY);
    expect(batch.incidents.map((incident) => [incident.id, incident.occurredAt, incident.localHour])).toEqual([
      ['arc:in-range', '2026-10-21T23:30:00', 23],
    ]);
    expect(batch.recordLimit).toBe(ARCGIS_PAGE_SIZE * ARCGIS_MAX_PAGES);
    expect(batch.truncated).toBe(false);
    expect(batch.requestUrls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('requests counted pages and reports truncation beyond the budget', async () => {
    stubFetch((url) => {
      if (isCount(url)) return jsonResponse({ count: 5 });
      const offset = Number(url.searchParams.get('resultOffset'));
      return jsonResponse({
        features: [feature(`f${offset}`, '2026-10-01T12:00:00Z'), feature(`f${offset + 1}`, '2026-10-01T12:00:00Z')],
        exceededTransferLimit: true,
      });
    });
    const batch = await createArcgisProvider(config({ pageSize: 2, maxPages: 2 })).fetchIncidents(QUERY);
    expect(batch.requestUrls.map((url) => new URL(url).searchParams.get('resultOffset'))).toEqual(['0', '2']);
    expect(batch.incidents).toHaveLength(4);
    expect(batch.truncated).toBe(true);
  });

  it('falls back to exceededTransferLimit paging when the count fails', async () => {
    stubFetch((url) => {
      if (isCount(url)) return jsonResponse({ error: { message: 'count disabled' } });
      const offset = Number(url.searchParams.get('resultOffset'));
      if (offset === 0) return jsonResponse({ features: [feature('first', '2026-10-01T12:00:00Z')], exceededTransferLimit: true });
      if (offset === 2) return jsonResponse({ features: [feature('second', '2026-10-02T12:00:00Z')] });
      return jsonResponse({ features: [] });
    });
    const batch = await createArcgisProvider(config({ pageSize: 2, maxPages: 3 })).fetchIncidents(QUERY);
    expect(batch.incidents.map((incident) => incident.id)).toEqual(['arc:first', 'arc:second']);
    expect(batch.requestUrls).toHaveLength(3);
    expect(batch.truncated).toBe(false);
  });

  it('surfaces query errors and unexpected payloads', async () => {
    stubFetch((url) => (isCount(url)
      ? jsonResponse({ count: 1 })
      : jsonResponse({ error: { message: 'Invalid query', details: ['Unable to complete operation.'] } })));
    await expect(createArcgisProvider(config()).fetchIncidents(QUERY)).rejects.toThrow(
      'Arc Police query error: Invalid query: Unable to complete operation.',
    );

    stubFetch((url) => (isCount(url) ? jsonResponse({ count: 1 }) : jsonResponse({ features: null })));
    await expect(createArcgisProvider(config()).fetchIncidents(QUERY)).rejects.toThrow(
      'Arc Police returned an unexpected response',
    );

    stubFetch(() => new Response('', { status: 500 }));
    await expect(createArcgisProvider(config()).fetchIncidents(QUERY)).rejects.toThrow('Arc Police returned HTTP 500');
  });

  it('caches the converted latest record for the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:15:00Z'));
    const fetchMock = stubFetch((url) => {
      expect(isLatest(url)).toBe(true);
      return jsonResponse({ features: [{ attributes: { latest_record: Date.parse('2026-10-21T06:05:00Z') } }] });
    });
    const provider = createArcgisProvider(config());
    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(Date.parse('2026-10-21T02:05:00Z'));
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('where')).toContain("<= TIMESTAMP '2026-10-22 10:15:00'");
    await provider.fetchLatestRecordEpoch();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(LATEST_RECORD_TTL_MS);
    await provider.fetchLatestRecordEpoch();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches the latest record after resetCache', async () => {
    let latest = Date.parse('2026-10-21T06:05:00Z');
    const fetchMock = stubFetch(() => jsonResponse({ features: [{ attributes: { latest_record: latest } }] }));
    const provider = createArcgisProvider(config({ epochSemantics: 'local-clock' }));
    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(latest);
    latest = Date.parse('2026-10-21T09:00:00Z');
    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(Date.parse('2026-10-21T06:05:00Z'));
    expect(fetchMock).toHaveBeenCalledOnce();

    provider.resetCache?.();
    await expect(provider.fetchLatestRecordEpoch()).resolves.toBe(latest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a latest-record response it cannot read', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ features: [{ attributes: { latest_record: 'yesterday' } }] }));
    const provider = createArcgisProvider(config());
    await expect(provider.fetchLatestRecordEpoch()).rejects.toThrow('Arc Police returned an unreadable latest record date');
    await expect(provider.fetchLatestRecordEpoch()).rejects.toThrow('unreadable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks a counted query truncated when the service returns fewer rows than counted', async () => {
    // The layer caps responses below the assumed page size, so counted offsets skip rows.
    stubFetch((url) => {
      if (isCount(url)) return jsonResponse({ count: 4 });
      const offset = Number(url.searchParams.get('resultOffset'));
      return jsonResponse({ features: [feature(`f${offset}`, '2026-10-01T12:00:00Z')], exceededTransferLimit: true });
    });
    const batch = await createArcgisProvider(config({ pageSize: 2, maxPages: 3 })).fetchIncidents(QUERY);
    expect(batch.incidents).toHaveLength(2);
    expect(batch.truncated).toBe(true);
  });
});
