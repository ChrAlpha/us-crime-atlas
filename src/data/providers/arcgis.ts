import { boundingBoxForRadius } from '../../domain/geo';
import type { Incident, IncidentBatch, IncidentQuery, ProviderMeta } from '../../types';

export const ARCGIS_QUERY_LIMIT = 2000;

export interface ArcgisGeometry {
  x?: unknown;
  y?: unknown;
}

export interface ArcgisFeature<Row extends Record<string, unknown>> {
  attributes?: Row;
  geometry?: ArcgisGeometry;
}

interface ArcgisFeatureResponse<Row extends Record<string, unknown>> {
  features?: ArcgisFeature<Row>[];
  exceededTransferLimit?: boolean;
  error?: { message?: string; details?: string[] };
}

interface ArcgisSearchResult {
  title?: string;
  url?: string;
}

interface ArcgisSearchResponse {
  results?: ArcgisSearchResult[];
  error?: { message?: string };
}

export interface ArcgisCatalogConfig {
  portalUrl?: string;
  query: string;
  titleIncludes: string;
  layerIndex?: number;
}

export interface ArcgisProviderConfig<Row extends Record<string, unknown>> {
  meta: ProviderMeta;
  serviceUrl?: string;
  catalog?: ArcgisCatalogConfig;
  dateField: string;
  outFields: string[];
  mapFeature(feature: ArcgisFeature<Row>): Incident | null;
}

function normalizeLayerUrl(serviceUrl: string, layerIndex: number) {
  const normalized = serviceUrl.replace(/\/$/, '');
  return /\/FeatureServer\/\d+$/i.test(normalized) ? normalized : `${normalized}/${layerIndex}`;
}

export function buildArcgisSearchUrl(catalog: ArcgisCatalogConfig) {
  const url = new URL(catalog.portalUrl ?? 'https://www.arcgis.com/sharing/rest/search');
  url.search = new URLSearchParams({ f: 'json', num: '100', q: catalog.query }).toString();
  return url.toString();
}

export async function resolveArcgisLayerUrl(
  config: Pick<ArcgisProviderConfig<Record<string, unknown>>, 'meta' | 'serviceUrl' | 'catalog'>,
  signal?: AbortSignal,
) {
  if (config.serviceUrl) return normalizeLayerUrl(config.serviceUrl, config.catalog?.layerIndex ?? 0);
  if (!config.catalog) throw new Error(`${config.meta.agency} has no ArcGIS service configuration`);
  const response = await fetch(buildArcgisSearchUrl(config.catalog), {
    headers: { Accept: 'application/json' },
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error(`${config.meta.agency} catalog returned HTTP ${response.status}`);
  const payload = (await response.json()) as ArcgisSearchResponse;
  if (payload.error) throw new Error(`${config.meta.agency} catalog error: ${payload.error.message ?? 'unknown error'}`);
  const needle = config.catalog.titleIncludes.toLocaleLowerCase();
  const result = (payload.results ?? []).find(
    (candidate) => candidate.title?.toLocaleLowerCase().includes(needle) && candidate.url,
  );
  if (!result?.url) throw new Error(`${config.meta.agency} catalog did not expose the expected feature service`);
  return normalizeLayerUrl(result.url, config.catalog.layerIndex ?? 0);
}

function sqlTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function arcgisDateWhere(dateField: string, query: IncidentQuery) {
  const start = new Date(query.now.getTime() - query.windowDays * 2 * 86_400_000);
  return `${dateField} >= TIMESTAMP '${sqlTimestamp(start)}' AND ${dateField} <= TIMESTAMP '${sqlTimestamp(query.now)}'`;
}

export function buildArcgisQueryUrl<Row extends Record<string, unknown>>(
  config: ArcgisProviderConfig<Row>,
  layerUrl: string,
  query: IncidentQuery,
) {
  const box = boundingBoxForRadius(query.center, query.radiusMeters);
  const geometry = JSON.stringify({
    xmin: box.west,
    ymin: box.south,
    xmax: box.east,
    ymax: box.north,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    f: 'json',
    where: arcgisDateWhere(config.dateField, query),
    outFields: config.outFields.join(','),
    returnGeometry: 'true',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    orderByFields: `${config.dateField} DESC`,
    resultRecordCount: String(ARCGIS_QUERY_LIMIT),
  });
  return `${layerUrl}/query?${params.toString()}`;
}

export function createArcgisProvider<Row extends Record<string, unknown>>(
  config: ArcgisProviderConfig<Row>,
) {
  let layerPromise: Promise<string> | null = null;
  const layerUrl = (signal?: AbortSignal) => {
    if (!layerPromise) {
      layerPromise = resolveArcgisLayerUrl(
        config as ArcgisProviderConfig<Record<string, unknown>>,
        signal,
      ).catch((error) => {
        layerPromise = null;
        throw error;
      });
    }
    return layerPromise;
  };

  return {
    meta: config.meta,
    async fetchIncidents(query: IncidentQuery): Promise<IncidentBatch> {
      const resolvedLayerUrl = await layerUrl(query.signal);
      const requestUrl = buildArcgisQueryUrl(config, resolvedLayerUrl, query);
      const response = await fetch(requestUrl, {
        headers: { Accept: 'application/json' },
        signal: query.signal ?? null,
      });
      if (!response.ok) throw new Error(`${config.meta.agency} returned HTTP ${response.status}`);
      const payload = (await response.json()) as ArcgisFeatureResponse<Row>;
      if (payload.error) {
        const detail = [payload.error.message, ...(payload.error.details ?? [])].filter(Boolean).join(': ');
        throw new Error(`${config.meta.agency} query error${detail ? `: ${detail}` : ''}`);
      }
      if (!Array.isArray(payload.features)) {
        throw new Error(`${config.meta.agency} returned an unexpected response`);
      }
      const incidents = payload.features
        .map((feature) => config.mapFeature(feature))
        .filter((incident): incident is Incident => incident !== null);
      return {
        incidents,
        provider: config.meta,
        fetchedAt: new Date().toISOString(),
        queryLimit: ARCGIS_QUERY_LIMIT,
        truncated: payload.exceededTransferLimit === true || payload.features.length >= ARCGIS_QUERY_LIMIT,
        requestUrl,
      };
    },
  };
}

export function arcgisNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function arcgisText(value: unknown, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

export function arcgisTimestamp(value: unknown) {
  const epoch = arcgisNumber(value);
  if (epoch === null) return null;
  const date = new Date(epoch);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
