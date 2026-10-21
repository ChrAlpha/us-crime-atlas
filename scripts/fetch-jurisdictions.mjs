#!/usr/bin/env node
/**
 * Regenerates src/data/jurisdictions.json: simplified city-limit polygons for every
 * registered provider, from the U.S. Census Bureau TIGERweb "Incorporated Places" layer.
 *
 *   node scripts/fetch-jurisdictions.mjs
 *
 * The output is committed so the atlas never depends on TIGERweb at runtime.
 */
import { writeFile } from 'node:fs/promises';

const LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';
/** ≈20 m; well below the 500 m minimum analysis radius. */
const MAX_ALLOWABLE_OFFSET_DEGREES = 0.0002;
const PRECISION = 5;

/** Provider id → Census place GEOID of the police department's jurisdiction. */
const PLACES = {
  'new-york': '3651000',
  'washington-dc': '1150000',
  philadelphia: '4260000',
  chicago: '1714000',
  detroit: '2622000',
  // The consolidated government's balance: Davidson County minus satellite cities with their own police.
  nashville: '4752006',
  dallas: '4819000',
  denver: '0820000',
  'los-angeles': '0644000',
  'san-francisco': '0667000',
  seattle: '5363000',
};

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${url} returned ${JSON.stringify(payload.error)}`);
  return payload;
}

const layer = await fetchJson(`${LAYER}?f=json`);
const places = {};
for (const [providerId, geoid] of Object.entries(PLACES)) {
  const query = new URLSearchParams({
    where: `GEOID='${geoid}'`,
    outFields: 'GEOID,NAME',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(MAX_ALLOWABLE_OFFSET_DEGREES),
    geometryPrecision: String(PRECISION),
    f: 'json',
  });
  const payload = await fetchJson(`${LAYER}/query?${query}`);
  const feature = payload.features?.[0];
  if (payload.features?.length !== 1 || !feature.geometry?.rings?.length) {
    throw new Error(`Expected exactly one polygon for ${providerId} (${geoid})`);
  }
  places[providerId] = {
    geoid,
    name: feature.attributes.NAME,
    rings: feature.geometry.rings,
  };
  const vertices = feature.geometry.rings.reduce((sum, ring) => sum + ring.length, 0);
  console.log(`${providerId}: ${feature.attributes.NAME}, ${feature.geometry.rings.length} rings, ${vertices} vertices`);
}

const output = {
  source: `U.S. Census Bureau TIGERweb, ${layer.description?.split(';')[0] ?? 'Incorporated Places'}${layer.description?.includes(';') ? `;${layer.description.split(';')[1]}` : ''}`,
  sourceUrl: LAYER,
  retrieved: new Date().toISOString().slice(0, 10),
  maxAllowableOffsetDegrees: MAX_ALLOWABLE_OFFSET_DEGREES,
  places,
};
await writeFile(new URL('../src/data/jurisdictions.json', import.meta.url), `${JSON.stringify(output)}\n`);
