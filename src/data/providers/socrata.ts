import { boundingBoxForRadius, type BoundingBox } from '../../domain/geo';
import { DAY_MS, isoDate, sourceTimestampToEpoch, startOfDay, toLocalClockEpoch } from '../../domain/time';
import type { Coordinates, Incident, IncidentBatch, IncidentProvider, IncidentQuery, ProviderMeta } from '../../types';
import {
  fetchJson,
  fetchPages,
  incidentsInRange,
  isNonNull,
  LATEST_RECORD_LOOKBACK_DAYS,
  numberValue,
  publicCoordinates,
  sharedResource,
  textValue,
} from './shared';

export const SOCRATA_PAGE_SIZE = 5000;
export const SOCRATA_MAX_PAGES = 4;
export const LATEST_RECORD_TTL_MS = 10 * 60_000;

export type SocrataAliasMap<Key extends string> = Record<Key, readonly string[]>;
export type ResolvedSocrataFields<Key extends string> = Record<Key, string | null>;

/**
 * A reviewed fixed field contract, or ordered aliases resolved against live dataset metadata.
 * Aliases never guess: a required role without a reviewed match fails closed.
 */
export type SocrataSchema<Key extends string> =
  | { fields: ResolvedSocrataFields<Key> }
  | { aliases: SocrataAliasMap<Key>; requiredKeys: readonly Key[] };

/** A Socrata provider that can report the dataset fields it binds. */
export type SocrataResolvable<Key extends string = string> = IncidentProvider & {
  resolveFields(signal?: AbortSignal): Promise<ResolvedSocrataFields<Key>>;
};

export interface SocrataProviderConfig<Key extends string> {
  meta: ProviderMeta;
  schema: SocrataSchema<Key>;
  dateKey: Key;
  latitudeKey?: Key;
  longitudeKey?: Key;
  pointKey?: Key;
  /** Latitude/longitude are text columns (Seattle); bounds are compared textually. */
  coordinateFieldsAreText?: boolean;
  /** Values excluded before textual coordinate comparison. */
  coordinatePlaceholders?: readonly string[];
  mapRow(row: Record<string, unknown>, fields: ResolvedSocrataFields<Key>): Incident | null;
  pageSize?: number;
  maxPages?: number;
  /**
   * A reviewed SoQL predicate added to every query (for example a crime-type allowlist on a
   * calls-for-service feed), so excluded rows never spend the record budget.
   */
  filter?: string;
}

interface SocrataMetadata {
  columns?: Array<{ fieldName?: unknown }>;
}

interface SocrataPoint {
  coordinates?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

export function datasetIdFromEndpoint(endpoint: string): string {
  const match = /\/resource\/([^/.]+)\.json$/.exec(new URL(endpoint).pathname);
  if (!match?.[1]) throw new Error(`Unsupported Socrata endpoint: ${endpoint}`);
  return match[1];
}

export function metadataUrlFromEndpoint(endpoint: string): string {
  return `${new URL(endpoint).origin}/api/views/${datasetIdFromEndpoint(endpoint)}`;
}

export function resolveSocrataAliases<Key extends string>(
  aliases: SocrataAliasMap<Key>,
  availableFields: Iterable<string>,
): ResolvedSocrataFields<Key> {
  const available = new Set(availableFields);
  return Object.fromEntries(
    Object.entries<readonly string[]>(aliases).map(([key, candidates]) => [
      key,
      candidates.find((candidate) => available.has(candidate)) ?? null,
    ]),
  ) as ResolvedSocrataFields<Key>;
}

function hasCoordinateSemantics<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
) {
  const pair = config.latitudeKey && config.longitudeKey
    && fields[config.latitudeKey] && fields[config.longitudeKey];
  const point = config.pointKey && fields[config.pointKey];
  return Boolean(pair || point);
}

export function validateResolvedFields<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  requiredKeys: readonly Key[],
): ResolvedSocrataFields<Key> {
  const missing = [config.dateKey, ...requiredKeys].filter((key) => !fields[key]);
  if (missing.length > 0) {
    throw new Error(`${config.meta.agency} metadata is missing required fields: ${[...new Set(missing)].join(', ')}`);
  }
  if (!hasCoordinateSemantics(config, fields)) {
    throw new Error(`${config.meta.agency} metadata has no usable coordinate semantics`);
  }
  return fields;
}

function textRange(field: string, lower: number, upper: number): string[] {
  if (Math.trunc(lower) !== Math.trunc(upper) || (lower < 0) !== (upper < 0)) {
    throw new Error(`Text coordinate bounds for ${field} cross a degree boundary`);
  }
  const lowerText = lower.toFixed(7);
  const upperText = upper.toFixed(7);
  // Negative numbers sort in reverse when compared as text.
  return lower < 0
    ? [`${field} <= '${lowerText}'`, `${field} >= '${upperText}'`]
    : [`${field} >= '${lowerText}'`, `${field} <= '${upperText}'`];
}

function geometryPredicates<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  box: BoundingBox,
): string[] {
  const latitudeField = config.latitudeKey ? fields[config.latitudeKey] : null;
  const longitudeField = config.longitudeKey ? fields[config.longitudeKey] : null;
  if (latitudeField && longitudeField) {
    if (config.coordinateFieldsAreText) {
      const placeholders = (config.coordinatePlaceholders ?? ['REDACTED', '-', ''])
        .map((value) => `'${value.replaceAll("'", "''")}'`)
        .join(', ');
      return [
        `${latitudeField} NOT IN (${placeholders})`,
        `${longitudeField} NOT IN (${placeholders})`,
        ...textRange(latitudeField, box.south, box.north),
        ...textRange(longitudeField, box.west, box.east),
      ];
    }
    return [
      `${latitudeField} >= ${box.south.toFixed(7)}`,
      `${latitudeField} <= ${box.north.toFixed(7)}`,
      `${longitudeField} >= ${box.west.toFixed(7)}`,
      `${longitudeField} <= ${box.east.toFixed(7)}`,
    ];
  }
  const pointField = config.pointKey ? fields[config.pointKey] : null;
  if (pointField) {
    return [
      `within_box(${pointField}, ${box.north.toFixed(7)}, ${box.west.toFixed(7)}, ${box.south.toFixed(7)}, ${box.east.toFixed(7)})`,
    ];
  }
  throw new Error(`${config.meta.agency} is missing resolved coordinate fields`);
}

function dateField<Key extends string>(config: SocrataProviderConfig<Key>, fields: ResolvedSocrataFields<Key>) {
  const field = fields[config.dateKey];
  if (!field) throw new Error(`${config.meta.agency} is missing its resolved date field`);
  return field;
}

/**
 * Windows are day-aligned, so date-only literals work for floating timestamps and for
 * text date columns (Dallas) alike.
 */
function dayLiteral(epochMs: number) {
  return `'${isoDate(startOfDay(epochMs))}'`;
}

function queryWhere<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  query: IncidentQuery,
) {
  const date = dateField(config, fields);
  return [
    `${date} >= ${dayLiteral(query.startEpochMs)}`,
    `${date} < ${dayLiteral(query.endEpochMs + DAY_MS - 1)}`,
    ...geometryPredicates(config, fields, boundingBoxForRadius(query.center, query.radiusMeters)),
    ...(config.filter ? [`(${config.filter})`] : []),
  ].join(' AND ');
}

export function buildSocrataCountUrl<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  query: IncidentQuery,
): string {
  const params = new URLSearchParams({ $select: 'count(*) AS total', $where: queryWhere(config, fields, query) });
  return `${config.meta.endpoint}?${params.toString()}`;
}

export function parseSocrataCount(payload: unknown): number {
  const total = Array.isArray(payload) ? numberValue((payload[0] as Record<string, unknown> | undefined)?.total) : null;
  if (total === null) throw new Error('Unexpected Socrata count response');
  return total;
}

export function buildSocrataQueryUrl<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  query: IncidentQuery,
  page: { offset: number; limit: number } = { offset: 0, limit: config.pageSize ?? SOCRATA_PAGE_SIZE },
): string {
  const date = dateField(config, fields);
  const where = queryWhere(config, fields, query);
  const select = [...new Set(Object.values<string | null>(fields).filter(isNonNull))];
  const params = new URLSearchParams({
    $select: select.join(','),
    $where: where,
    $order: `${date} DESC, :id`,
    $limit: String(page.limit),
  });
  if (page.offset > 0) params.set('$offset', String(page.offset));
  return `${config.meta.endpoint}?${params.toString()}`;
}

export function buildSocrataLatestUrl<Key extends string>(
  config: SocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  nowLocalEpochMs: number,
): string {
  const date = dateField(config, fields);
  const today = startOfDay(nowLocalEpochMs);
  const params = new URLSearchParams({
    $select: `max(${date}) AS latest_record`,
    $where: [
      `${date} >= ${dayLiteral(today - LATEST_RECORD_LOOKBACK_DAYS * DAY_MS)}`,
      `${date} < ${dayLiteral(today + DAY_MS)}`,
      ...(config.filter ? [`(${config.filter})`] : []),
    ].join(' AND '),
  });
  return `${config.meta.endpoint}?${params.toString()}`;
}

export function parseSocrataLatest(payload: unknown, agency: string): number | null {
  if (!Array.isArray(payload)) throw new Error(`${agency} returned an unexpected latest-record response`);
  const value = (payload[0] as Record<string, unknown> | undefined)?.latest_record;
  if (value === undefined || value === null || value === '') return null;
  const epoch = sourceTimestampToEpoch(String(value));
  if (!Number.isFinite(epoch)) throw new Error(`${agency} returned an unreadable latest record date`);
  return epoch;
}

export function createSocrataProvider<Key extends string>(
  config: SocrataProviderConfig<Key>,
): SocrataResolvable<Key> {
  const { schema, meta } = config;
  const pageSize = config.pageSize ?? SOCRATA_PAGE_SIZE;
  const maxPages = config.maxPages ?? SOCRATA_MAX_PAGES;

  const resolveFields = 'fields' in schema
    ? Object.assign(() => Promise.resolve(schema.fields), { reset() {} })
    : sharedResource(async (signal) => {
        const metadata = await fetchJson(metadataUrlFromEndpoint(meta.endpoint), `${meta.agency} metadata`, signal) as SocrataMetadata;
        const available = (metadata.columns ?? [])
          .map((column) => column.fieldName)
          .filter((field): field is string => typeof field === 'string' && field.length > 0);
        return validateResolvedFields(config, resolveSocrataAliases(schema.aliases, available), schema.requiredKeys);
      });

  const latestRecord = sharedResource(async (signal) => {
    const fields = await resolveFields(signal);
    const url = buildSocrataLatestUrl(config, fields, toLocalClockEpoch(Date.now(), meta.timeZone));
    return parseSocrataLatest(await fetchJson(url, meta.agency, signal), meta.agency);
  }, { ttlMs: LATEST_RECORD_TTL_MS });

  return {
    meta,
    resolveFields,
    fetchLatestRecordEpoch: latestRecord,
    resetCache() {
      resolveFields.reset();
      latestRecord.reset();
    },
    async fetchIncidents(query: IncidentQuery): Promise<IncidentBatch> {
      const fields = await resolveFields(query.signal);
      const requestUrls: string[] = [];
      const { rows, truncated } = await fetchPages(async (offset) => {
        const url = buildSocrataQueryUrl(config, fields, query, { offset, limit: pageSize });
        requestUrls.push(url);
        const payload = await fetchJson(url, meta.agency, query.signal);
        if (!Array.isArray(payload)) throw new Error(`${meta.agency} returned an unexpected response`);
        return { rows: payload as Record<string, unknown>[] };
      }, pageSize, maxPages, async () => (
        parseSocrataCount(await fetchJson(buildSocrataCountUrl(config, fields, query), meta.agency, query.signal))
      ));
      const incidents = rows.map((row) => config.mapRow(row, fields)).filter(isNonNull);
      return {
        incidents: incidentsInRange(incidents, query),
        recordLimit: pageSize * maxPages,
        truncated,
        requestUrls,
      };
    },
  };
}

export function resolvedValue<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  key: Key,
): unknown {
  const field = fields[key];
  return field ? row[field] : undefined;
}

export function resolvedText<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  key: Key,
  fallback = '',
): string {
  return textValue(resolvedValue(row, fields, key), fallback);
}

export function resolvedNumber<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  key: Key,
): number | null {
  return numberValue(resolvedValue(row, fields, key));
}

/** Reads a lat/lon pair first, then a Socrata Point (GeoJSON or lat/lon object). */
export function resolvedCoordinates<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  keys: { latitudeKey?: Key; longitudeKey?: Key; pointKey?: Key },
): Coordinates | null {
  if (keys.latitudeKey && keys.longitudeKey) {
    const coordinates = publicCoordinates(
      resolvedValue(row, fields, keys.longitudeKey),
      resolvedValue(row, fields, keys.latitudeKey),
    );
    if (coordinates) return coordinates;
  }
  if (keys.pointKey) {
    const point = resolvedValue(row, fields, keys.pointKey) as SocrataPoint | undefined;
    if (point && typeof point === 'object') {
      if (Array.isArray(point.coordinates) && point.coordinates.length >= 2) {
        const coordinates = publicCoordinates(point.coordinates[0], point.coordinates[1]);
        if (coordinates) return coordinates;
      }
      return publicCoordinates(point.longitude, point.latitude);
    }
  }
  return null;
}
