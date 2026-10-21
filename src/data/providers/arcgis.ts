import { boundingBoxForRadius } from '../../domain/geo';
import { DAY_MS, localClockTimestamp, toLocalClockEpoch } from '../../domain/time';
import type { Incident, IncidentBatch, IncidentProvider, IncidentQuery, ProviderMeta } from '../../types';
import {
  fetchJson,
  fetchPages,
  incidentsInRange,
  isNonNull,
  LATEST_RECORD_LOOKBACK_DAYS,
  numberValue,
  sharedResource,
  textValue,
} from './shared';
import { LATEST_RECORD_TTL_MS } from './socrata';

/** Every registered layer publishes `maxRecordCount: 2000`. */
export const ARCGIS_PAGE_SIZE = 2000;
export const ARCGIS_MAX_PAGES = 5;

/**
 * How a layer's epoch attributes relate to the publisher's clock.
 *
 * - `utc`: true UTC instants (DC, Detroit, Nashville). Converted to local wall-clock time.
 * - `local-clock`: local wall-clock time stored as if it were UTC (Philadelphia, Denver).
 */
export type ArcgisEpochSemantics = 'utc' | 'local-clock';

/**
 * Coordinates come from published attributes, or from WGS84 point geometry for layers that
 * publish none (`returnGeometry`).
 */
export interface ArcgisFeature<Row extends Record<string, unknown> = Record<string, unknown>> {
  attributes?: Row;
  geometry?: { x?: unknown; y?: unknown } | null;
}

interface ArcgisError {
  message?: string;
  details?: string[];
}

interface ArcgisFeatureResponse {
  features?: unknown;
  exceededTransferLimit?: boolean;
  error?: ArcgisError;
}

export interface ArcgisProviderConfig {
  meta: ProviderMeta;
  layerUrl: string;
  dateField: string;
  objectIdField: string;
  epochSemantics: ArcgisEpochSemantics;
  outFields: readonly string[];
  mapFeature(feature: ArcgisFeature): Incident | null;
  pageSize?: number;
  maxPages?: number;
  /** Request WGS84 point geometry, for layers without coordinate attributes. */
  returnGeometry?: boolean;
  /** A reviewed SQL predicate every query adds (one row per incident, reports only). */
  filter?: string;
  /**
   * Tables ignore envelope geometry, so the bounding box is compared against these
   * coordinate attributes in the SQL predicate instead.
   */
  coordinateAttributes?: { latitude: string; longitude: string };
}

/**
 * Date literals are compared in the service's reference zone, which differs between layers.
 * The predicate is padded by a day on each side; the exact range is applied client-side.
 */
const QUERY_PADDING_MS = DAY_MS;

function sqlTimestamp(epochMs: number) {
  return new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
}

function arcgisErrorMessage(agency: string, error: ArcgisError) {
  const detail = [error.message, ...(error.details ?? [])].filter(Boolean).join(': ');
  return `${agency} query error${detail ? `: ${detail}` : ''}`;
}

function queryFilter(config: ArcgisProviderConfig, query: IncidentQuery) {
  const box = boundingBoxForRadius(query.center, query.radiusMeters);
  const start = sqlTimestamp(query.startEpochMs - QUERY_PADDING_MS);
  const end = sqlTimestamp(query.endEpochMs + QUERY_PADDING_MS);
  const predicates = [
    `${config.dateField} >= TIMESTAMP '${start}'`,
    `${config.dateField} < TIMESTAMP '${end}'`,
    ...(config.filter ? [`(${config.filter})`] : []),
  ];
  const coordinates = config.coordinateAttributes;
  if (coordinates) {
    predicates.push(
      `${coordinates.latitude} >= ${box.south.toFixed(7)}`,
      `${coordinates.latitude} <= ${box.north.toFixed(7)}`,
      `${coordinates.longitude} >= ${box.west.toFixed(7)}`,
      `${coordinates.longitude} <= ${box.east.toFixed(7)}`,
    );
    return { f: 'json', where: predicates.join(' AND ') };
  }
  return {
    f: 'json',
    where: predicates.join(' AND '),
    geometry: JSON.stringify({
      xmin: box.west,
      ymin: box.south,
      xmax: box.east,
      ymax: box.north,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
}

export function buildArcgisCountUrl(config: ArcgisProviderConfig, query: IncidentQuery): string {
  const params = new URLSearchParams({
    ...queryFilter(config, query),
    // Rochester's state-plane layer counts a different envelope edge without the page's outSR.
    ...(config.returnGeometry ? { outSR: '4326' } : {}),
    returnCountOnly: 'true',
  });
  return `${config.layerUrl}/query?${params.toString()}`;
}

export function parseArcgisCount(payload: unknown, agency: string): number {
  const response = payload as { count?: unknown; error?: ArcgisError };
  if (response.error) throw new Error(arcgisErrorMessage(agency, response.error));
  const count = numberValue(response.count);
  if (count === null) throw new Error(`${agency} returned an unexpected count response`);
  return count;
}

export function buildArcgisQueryUrl(
  config: ArcgisProviderConfig,
  query: IncidentQuery,
  page: { offset: number; limit: number } = { offset: 0, limit: config.pageSize ?? ARCGIS_PAGE_SIZE },
): string {
  const params = new URLSearchParams({
    ...queryFilter(config, query),
    outFields: config.outFields.join(','),
    // Skipping feature geometry roughly halves response time on the slower services, so it
    // is requested only from layers without coordinate attributes.
    ...(config.returnGeometry ? { returnGeometry: 'true', outSR: '4326' } : { returnGeometry: 'false' }),
    orderByFields: `${config.dateField} DESC,${config.objectIdField} ASC`,
    resultOffset: String(page.offset),
    resultRecordCount: String(page.limit),
  });
  return `${config.layerUrl}/query?${params.toString()}`;
}

export function buildArcgisLatestUrl(config: ArcgisProviderConfig, nowUtcEpochMs: number): string {
  const params = new URLSearchParams({
    f: 'json',
    where: [
      `${config.dateField} >= TIMESTAMP '${sqlTimestamp(nowUtcEpochMs - LATEST_RECORD_LOOKBACK_DAYS * DAY_MS)}'`,
      `${config.dateField} <= TIMESTAMP '${sqlTimestamp(nowUtcEpochMs + DAY_MS)}'`,
      ...(config.filter ? [`(${config.filter})`] : []),
    ].join(' AND '),
    outStatistics: JSON.stringify([
      { statisticType: 'max', onStatisticField: config.dateField, outStatisticFieldName: 'latest_record' },
    ]),
  });
  return `${config.layerUrl}/query?${params.toString()}`;
}

/** Converts a layer epoch into the provider's local-clock frame. */
export function layerEpochToLocalClock(epochMs: number, semantics: ArcgisEpochSemantics, timeZone: string): number {
  return semantics === 'utc' ? toLocalClockEpoch(epochMs, timeZone) : epochMs;
}

export function parseArcgisLatest(payload: unknown, config: ArcgisProviderConfig): number | null {
  const response = payload as ArcgisFeatureResponse;
  if (response.error) throw new Error(arcgisErrorMessage(config.meta.agency, response.error));
  if (!Array.isArray(response.features)) {
    throw new Error(`${config.meta.agency} returned an unexpected latest-record response`);
  }
  const attributes = (response.features[0] as ArcgisFeature | undefined)?.attributes;
  const key = attributes && Object.keys(attributes).find((name) => name.toLowerCase() === 'latest_record');
  if (!attributes || !key) throw new Error(`${config.meta.agency} returned no latest-record statistic`);
  const value = attributes[key];
  // A null maximum means the lookback period has no rows at all.
  if (value === null) return null;
  const epoch = typeof value === 'number' && Number.isFinite(value) ? value : null;
  if (epoch === null) throw new Error(`${config.meta.agency} returned an unreadable latest record date`);
  return layerEpochToLocalClock(epoch, config.epochSemantics, config.meta.timeZone);
}

export function createArcgisProvider(config: ArcgisProviderConfig): IncidentProvider {
  const { meta } = config;
  const pageSize = config.pageSize ?? ARCGIS_PAGE_SIZE;
  const maxPages = config.maxPages ?? ARCGIS_MAX_PAGES;

  const latestRecord = sharedResource(async (signal) => {
    const payload = await fetchJson(buildArcgisLatestUrl(config, Date.now()), meta.agency, signal);
    return parseArcgisLatest(payload, config);
  }, { ttlMs: LATEST_RECORD_TTL_MS });

  return {
    meta,
    fetchLatestRecordEpoch: latestRecord,
    resetCache: latestRecord.reset,
    async fetchIncidents(query: IncidentQuery): Promise<IncidentBatch> {
      const requestUrls: string[] = [];
      const { rows, truncated } = await fetchPages(async (offset) => {
        const url = buildArcgisQueryUrl(config, query, { offset, limit: pageSize });
        requestUrls.push(url);
        const payload = await fetchJson(url, meta.agency, query.signal) as ArcgisFeatureResponse;
        if (payload.error) throw new Error(arcgisErrorMessage(meta.agency, payload.error));
        if (!Array.isArray(payload.features)) throw new Error(`${meta.agency} returned an unexpected response`);
        return { rows: payload.features as ArcgisFeature[], hasMore: payload.exceededTransferLimit === true };
      }, pageSize, maxPages, async () => (
        parseArcgisCount(await fetchJson(buildArcgisCountUrl(config, query), meta.agency, query.signal), meta.agency)
      ));
      const incidents = rows.map((feature) => config.mapFeature(feature)).filter(isNonNull);
      return {
        incidents: incidentsInRange(incidents, query),
        recordLimit: pageSize * maxPages,
        truncated,
        requestUrls,
      };
    },
  };
}

/** Case-insensitive attribute lookup; the first present name wins. */
export function attribute(row: Record<string, unknown>, ...names: readonly string[]): unknown {
  for (const name of names) {
    if (name in row) return row[name];
    const actual = Object.keys(row).find((key) => key.toLowerCase() === name.toLowerCase());
    if (actual) return row[actual];
  }
  return undefined;
}

export const arcgisNumber = numberValue;
export const arcgisText = textValue;

/** A layer epoch as a zone-free local wall-clock timestamp. */
export function arcgisLocalTimestamp(
  value: unknown,
  semantics: ArcgisEpochSemantics,
  timeZone: string,
): string | null {
  const epoch = numberValue(value);
  if (epoch === null || Number.isNaN(new Date(epoch).getTime())) return null;
  return localClockTimestamp(layerEpochToLocalClock(epoch, semantics, timeZone));
}
