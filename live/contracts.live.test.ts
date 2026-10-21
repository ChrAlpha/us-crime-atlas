import { describe, expect, it } from 'vitest';
import { RING_LABEL_FONT, OPENFREEMAP_STYLES } from '../src/components/mapLayers';
import { ARCGIS_LAYER_CONTRACTS } from '../src/data/providers/arcgisCities';
import { fetchJson } from '../src/data/providers/shared';
import { providers } from '../src/data/providers';
import { metadataUrlFromEndpoint, type SocrataResolvable } from '../src/data/providers/socrata';

/** Every registered Socrata provider, fixed or metadata-resolved. */
const socrataProviders = providers.filter((provider): provider is SocrataResolvable => 'resolveFields' in provider);

interface SocrataMetadata {
  columns?: Array<{ fieldName?: string }>;
}

interface ArcgisLayerMetadata {
  name?: string;
  maxRecordCount?: number;
  error?: { message?: string };
  fields?: Array<{ name?: string; type?: string }>;
}

describe.each(socrataProviders.map((provider) => [provider.meta.label, provider] as const))(
  'Socrata contract: %s',
  (_label, provider) => {
    it('resolves every reviewed field against live dataset metadata', async () => {
      const metadata = await fetchJson(
        metadataUrlFromEndpoint(provider.meta.endpoint),
        `${provider.meta.agency} metadata`,
      ) as SocrataMetadata;
      const available = new Set((metadata.columns ?? []).map((column) => column.fieldName));
      const fields = await provider.resolveFields();
      const missing = Object.values<string | null>(fields).filter((field) => field && !available.has(field));
      expect(missing, `${provider.meta.agency} renamed or removed reviewed fields`).toEqual([]);
    });
  },
);

describe.each(ARCGIS_LAYER_CONTRACTS.map((contract) => [contract.meta.label, contract] as const))(
  'ArcGIS contract: %s',
  (_label, contract) => {
    it('still publishes the reviewed layer, date field and requested attributes', async () => {
      const metadata = await fetchJson(`${contract.meta.endpoint}?f=json`, contract.meta.agency) as ArcgisLayerMetadata;
      expect(metadata.error).toBeUndefined();
      expect(metadata.name).toBe(contract.layerName);
      const fields = new Map((metadata.fields ?? []).map((field) => [field.name?.toLowerCase(), field.type]));
      const missing = contract.outFields.filter((field) => !fields.has(field.toLowerCase()));
      expect(missing, `${contract.meta.agency} renamed or removed requested attributes`).toEqual([]);
      expect(fields.get(contract.dateField.toLowerCase())).toBe('esriFieldTypeDate');
      // A smaller server page would silently skip rows between the offsets we request.
      expect(metadata.maxRecordCount, 'the layer serves smaller pages than the client requests')
        .toBeGreaterThanOrEqual(contract.pageSize);
    });
  },
);

describe('OpenFreeMap base styles', () => {
  it.each(Object.entries(OPENFREEMAP_STYLES))('serves a valid MapLibre v8 %s style', async (_theme, url) => {
    const style = await fetchJson(url, 'OpenFreeMap') as {
      version?: number;
      sources?: object;
      layers?: unknown[];
      glyphs?: string;
    };
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources ?? {}).length).toBeGreaterThan(0);
    expect(style.layers?.length).toBeGreaterThan(0);

    // The cluster count labels request this font stack from the style's glyph server.
    const glyphUrl = (style.glyphs ?? '')
      .replace('{fontstack}', encodeURIComponent(RING_LABEL_FONT.join(',')))
      .replace('{range}', '0-255');
    const glyphs = await fetch(glyphUrl);
    expect(glyphs.status, `${glyphUrl} does not serve the cluster label font`).toBe(200);
  });
});
