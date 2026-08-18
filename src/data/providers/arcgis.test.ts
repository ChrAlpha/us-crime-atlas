import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident, IncidentQuery, ProviderMeta } from '../../types';
import {
  ARCGIS_QUERY_LIMIT,
  arcgisNumber,
  arcgisText,
  arcgisTimestamp,
  buildArcgisQueryUrl,
  buildArcgisSearchUrl,
  createArcgisProvider,
  resolveArcgisLayerUrl,
  type ArcgisFeature,
  type ArcgisProviderConfig,
} from './arcgis';

interface TestRow extends Record<string, unknown> {
  OBJECTID?: number;
  START_DATE?: number;
  OFFENSE?: string;
}

const meta: ProviderMeta = {
  id: 'arcgis-test', city: 'Test City', state: 'TS', label: 'Test City, TS',
  agency: 'Test Police Department', datasetName: 'ArcGIS incidents',
  endpoint: 'https://www.arcgis.com/sharing/rest/search', sourceUrl: 'https://example.test/about',
  center: [-77, 39], zoom: 12, bounds: { west: -78, south: 38, east: -76, north: 40 },
  cadence: 'Daily', delayNote: 'Test delay', precision: 'block', precisionNote: 'Block',
  coverageNote: 'Test coverage', lastVerified: '2026-08-17',
};

function mapFeature(feature: ArcgisFeature<TestRow>): Incident | null {
  const id = arcgisNumber(feature.attributes?.OBJECTID);
  const occurredAt = arcgisTimestamp(feature.attributes?.START_DATE);
  const longitude = arcgisNumber(feature.geometry?.x);
  const latitude = arcgisNumber(feature.geometry?.y);
  if (id === null || !occurredAt || longitude === null || latitude === null) return null;
  return {
    id: String(id), providerId: meta.id, occurredAt, occurredAtEpochMs: Date.parse(occurredAt), localHour: 12,
    category: 'other', group: 'other', rawCategory: arcgisText(feature.attributes?.OFFENSE, 'Other'),
    description: 'Test', locationLabel: 'Test block', coordinates: [longitude, latitude], severity: 1,
    isViolent: false, precision: 'block',
  };
}

const config: ArcgisProviderConfig<TestRow> = {
  meta,
  serviceUrl: 'https://services.example.test/arcgis/rest/services/Crime/FeatureServer',
  dateField: 'START_DATE',
  outFields: ['OBJECTID', 'START_DATE', 'OFFENSE'],
  mapFeature,
};

const query: IncidentQuery = {
  center: [-77, 39], radiusMeters: 3000, windowDays: 30,
  now: new Date('2026-08-17T12:00:00.000Z'),
};

afterEach(() => vi.unstubAllGlobals());

describe('ArcGIS provider boundary', () => {
  it('builds catalog and bounded feature query URLs', () => {
    const search = new URL(buildArcgisSearchUrl({ query: 'owner:official crime', titleIncludes: 'crime' }));
    expect(search.searchParams.get('q')).toBe('owner:official crime');
    expect(search.searchParams.get('f')).toBe('json');

    const url = new URL(buildArcgisQueryUrl(config, `${config.serviceUrl}/0`, query));
    expect(url.pathname).toContain('/FeatureServer/0/query');
    expect(url.searchParams.get('where')).toContain("START_DATE >= TIMESTAMP '2026-06-18 12:00:00'");
    expect(url.searchParams.get('where')).toContain("START_DATE <= TIMESTAMP '2026-08-17 12:00:00'");
    expect(url.searchParams.get('outFields')).toBe('OBJECTID,START_DATE,OFFENSE');
    expect(url.searchParams.get('resultRecordCount')).toBe(String(ARCGIS_QUERY_LIMIT));
    expect(JSON.parse(url.searchParams.get('geometry') ?? '{}')).toMatchObject({ spatialReference: { wkid: 4326 } });
  });

  it('discovers an official service and normalizes its layer URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [
      { title: 'Unrelated layer', url: 'https://example.test/other/FeatureServer' },
      { title: 'Crime Incidents in 2026', url: 'https://example.test/crime/FeatureServer/' },
    ] }), { status: 200 })));
    await expect(resolveArcgisLayerUrl({
      meta,
      catalog: { query: 'crime', titleIncludes: 'incidents in 2026', layerIndex: 2 },
    })).resolves.toBe('https://example.test/crime/FeatureServer/2');
    await expect(resolveArcgisLayerUrl({ ...config, serviceUrl: `${config.serviceUrl}/4` })).resolves.toBe(`${config.serviceUrl}/4`);
  });

  it('fetches and maps features while retaining truncation and provenance', async () => {
    const payload = {
      exceededTransferLimit: true,
      features: [
        { attributes: { OBJECTID: 7, START_DATE: Date.parse('2026-08-12T12:00:00Z'), OFFENSE: 'Other' }, geometry: { x: -77, y: 39 } },
        { attributes: { OFFENSE: 'Invalid' }, geometry: { x: -77, y: 39 } },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const batch = await createArcgisProvider(config).fetchIncidents(query);
    expect(batch.incidents).toHaveLength(1);
    expect(batch.incidents[0]?.id).toBe('7');
    expect(batch.provider).toBe(meta);
    expect(batch.truncated).toBe(true);
    expect(batch.requestUrl).toContain('/FeatureServer/0/query?');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('surfaces catalog, HTTP, ArcGIS, and malformed payload errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 503 })));
    await expect(resolveArcgisLayerUrl({ meta, catalog: { query: 'crime', titleIncludes: 'crime' } })).rejects.toThrow('catalog returned HTTP 503');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Catalog error' } }), { status: 200 })));
    await expect(resolveArcgisLayerUrl({ meta, catalog: { query: 'crime', titleIncludes: 'crime' } })).rejects.toThrow('Catalog error');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 })));
    await expect(resolveArcgisLayerUrl({ meta, catalog: { query: 'crime', titleIncludes: 'crime' } })).rejects.toThrow('did not expose');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 502 })));
    await expect(createArcgisProvider(config).fetchIncidents(query)).rejects.toThrow('returned HTTP 502');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Bad query', details: ['field'] } }), { status: 200 })));
    await expect(createArcgisProvider(config).fetchIncidents(query)).rejects.toThrow('Bad query: field');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
    await expect(createArcgisProvider(config).fetchIncidents(query)).rejects.toThrow('unexpected response');
  });

  it('normalizes primitive ArcGIS values', () => {
    expect(arcgisNumber('4.5')).toBe(4.5);
    expect(arcgisNumber('bad')).toBeNull();
    expect(arcgisText('  label  ')).toBe('label');
    expect(arcgisText(2)).toBe('2');
    expect(arcgisText({}, 'fallback')).toBe('fallback');
    expect(arcgisTimestamp(Date.parse('2026-08-12T12:00:00Z'))).toBe('2026-08-12T12:00:00.000Z');
    expect(arcgisTimestamp('bad')).toBeNull();
  });
});
