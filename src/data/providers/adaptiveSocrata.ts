import { boundingBoxForRadius } from '../../domain/geo';
import type { Coordinates, Incident, IncidentBatch, IncidentQuery, ProviderMeta } from '../../types';
import { SOCRATA_QUERY_LIMIT } from './socrata';

export type SocrataAliasMap<Key extends string> = Record<Key, readonly string[]>;
export type ResolvedSocrataFields<Key extends string> = Record<Key, string | null>;

export interface AdaptiveSocrataProviderConfig<Key extends string> {
  meta: ProviderMeta;
  aliases: SocrataAliasMap<Key>;
  requiredKeys: readonly Key[];
  dateKey: Key;
  latitudeKey?: Key;
  longitudeKey?: Key;
  pointKey?: Key;
  coordinateFieldsAreText?: boolean;
  mapRow(row: Record<string, unknown>, fields: ResolvedSocrataFields<Key>): Incident | null;
}

interface SocrataMetadataColumn {
  fieldName?: unknown;
}

interface SocrataMetadata {
  columns?: SocrataMetadataColumn[];
}

interface SocrataPoint {
  type?: unknown;
  coordinates?: unknown;
  latitude?: unknown;
  longitude?: unknown;
}

function datasetIdFromEndpoint(endpoint: string) {
  const match = new URL(endpoint).pathname.match(/\/resource\/([^/.]+)\.json$/);
  if (!match?.[1]) throw new Error(`Unsupported Socrata endpoint: ${endpoint}`);
  return match[1];
}

export function metadataUrlFromEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  return `${url.origin}/api/views/${datasetIdFromEndpoint(endpoint)}`;
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

function sourceStamp(date: Date) {
  return date.toISOString().replace(/Z$/, '');
}

function textRange(field: string, lower: number, upper: number) {
  const lowerWhole = Math.trunc(lower);
  const upperWhole = Math.trunc(upper);
  if (lowerWhole !== upperWhole || (lower < 0) !== (upper < 0)) {
    throw new Error(`Text coordinate bounds for ${field} cross a degree boundary`);
  }
  const lowerText = lower.toFixed(7);
  const upperText = upper.toFixed(7);
  if (lower < 0) {
    return [`${field} <= '${lowerText}'`, `${field} >= '${upperText}'`];
  }
  return [`${field} >= '${lowerText}'`, `${field} <= '${upperText}'`];
}

function resolvedQueryGeometry<Key extends string>(
  config: AdaptiveSocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  query: IncidentQuery,
) {
  const box = boundingBoxForRadius(query.center, query.radiusMeters);
  const latitudeField = config.latitudeKey ? fields[config.latitudeKey] : null;
  const longitudeField = config.longitudeKey ? fields[config.longitudeKey] : null;
  if (latitudeField && longitudeField) {
    if (config.coordinateFieldsAreText) {
      return [
        `${latitudeField} NOT IN ('REDACTED', '-', '')`,
        `${longitudeField} NOT IN ('REDACTED', '-', '')`,
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

export function buildAdaptiveSocrataUrl<Key extends string>(
  config: AdaptiveSocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
  query: IncidentQuery,
) {
  const dateField = fields[config.dateKey];
  if (!dateField) throw new Error(`${config.meta.agency} is missing its resolved date field`);
  const start = new Date(query.now.getTime() - query.windowDays * 2 * 86_400_000);
  const selectedFields = [...new Set(Object.values(fields).filter((value): value is string => Boolean(value)))];
  const where = [
    `${dateField} >= '${sourceStamp(start)}'`,
    `${dateField} <= '${sourceStamp(query.now)}'`,
    ...resolvedQueryGeometry(config, fields, query),
  ].join(' AND ');
  const params = new URLSearchParams({
    $select: selectedFields.join(','),
    $where: where,
    $order: `${dateField} DESC`,
    $limit: String(SOCRATA_QUERY_LIMIT),
  });
  return `${config.meta.endpoint}?${params.toString()}`;
}

function hasResolvedCoordinates<Key extends string>(
  config: AdaptiveSocrataProviderConfig<Key>,
  fields: ResolvedSocrataFields<Key>,
) {
  const hasPair = Boolean(
    config.latitudeKey && config.longitudeKey && fields[config.latitudeKey] && fields[config.longitudeKey],
  );
  const hasPoint = Boolean(config.pointKey && fields[config.pointKey]);
  return hasPair || hasPoint;
}

export function createAdaptiveSocrataProvider<Key extends string>(
  config: AdaptiveSocrataProviderConfig<Key>,
) {
  let resolvedFieldsPromise: Promise<ResolvedSocrataFields<Key>> | null = null;

  const resolveFields = async (signal?: AbortSignal) => {
    if (!resolvedFieldsPromise) {
      resolvedFieldsPromise = fetch(metadataUrlFromEndpoint(config.meta.endpoint), {
        headers: { Accept: 'application/json' },
        signal: signal ?? null,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`${config.meta.agency} metadata returned HTTP ${response.status}`);
          const metadata = (await response.json()) as SocrataMetadata;
          const availableFields = (metadata.columns ?? [])
            .map((column) => column.fieldName)
            .filter((field): field is string => typeof field === 'string' && field.length > 0);
          const fields = resolveSocrataAliases(config.aliases, availableFields);
          const missing = config.requiredKeys.filter((key) => !fields[key]);
          if (missing.length > 0) {
            throw new Error(`${config.meta.agency} metadata is missing required fields: ${missing.join(', ')}`);
          }
          if (!hasResolvedCoordinates(config, fields)) {
            throw new Error(`${config.meta.agency} metadata has no usable coordinate semantics`);
          }
          return fields;
        })
        .catch((error) => {
          resolvedFieldsPromise = null;
          throw error;
        });
    }
    return resolvedFieldsPromise;
  };

  return {
    meta: config.meta,
    async fetchIncidents(query: IncidentQuery): Promise<IncidentBatch> {
      const fields = await resolveFields(query.signal);
      const requestUrl = buildAdaptiveSocrataUrl(config, fields, query);
      const response = await fetch(requestUrl, {
        headers: { Accept: 'application/json' },
        signal: query.signal ?? null,
      });
      if (!response.ok) throw new Error(`${config.meta.agency} returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error(`${config.meta.agency} returned an unexpected response`);
      const incidents = payload
        .map((row) => config.mapRow(row as Record<string, unknown>, fields))
        .filter((incident): incident is Incident => incident !== null);
      return {
        incidents,
        provider: config.meta,
        fetchedAt: new Date().toISOString(),
        queryLimit: SOCRATA_QUERY_LIMIT,
        truncated: payload.length >= SOCRATA_QUERY_LIMIT,
        requestUrl,
      };
    },
  };
}

export function resolvedText<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  key: Key,
  fallback = '',
) {
  const field = fields[key];
  const value = field ? row[field] : undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function resolvedNumber<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  key: Key,
) {
  const field = fields[key];
  const value = field ? row[field] : undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteCoordinates(longitude: unknown, latitude: unknown): Coordinates | null {
  const lon = typeof longitude === 'number' ? longitude : Number(longitude);
  const lat = typeof latitude === 'number' ? latitude : Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) < 0.0001 && Math.abs(lat) < 0.0001) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}

export function resolvedCoordinates<Key extends string>(
  row: Record<string, unknown>,
  fields: ResolvedSocrataFields<Key>,
  options: { latitudeKey?: Key; longitudeKey?: Key; pointKey?: Key },
) {
  if (options.latitudeKey && options.longitudeKey) {
    const latitudeField = fields[options.latitudeKey];
    const longitudeField = fields[options.longitudeKey];
    if (latitudeField && longitudeField) {
      const coordinates = finiteCoordinates(row[longitudeField], row[latitudeField]);
      if (coordinates) return coordinates;
    }
  }
  if (options.pointKey) {
    const pointField = fields[options.pointKey];
    const point = pointField ? row[pointField] as SocrataPoint | undefined : undefined;
    if (point && Array.isArray(point.coordinates) && point.coordinates.length >= 2) {
      const coordinates = finiteCoordinates(point.coordinates[0], point.coordinates[1]);
      if (coordinates) return coordinates;
    }
    if (point) return finiteCoordinates(point.longitude, point.latitude);
  }
  return null;
}
