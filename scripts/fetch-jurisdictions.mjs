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
/** ≈50 m; well below the 500 m minimum analysis radius. */
const MAX_ALLOWABLE_OFFSET_DEGREES = 0.0005;
const PRECISION = 4;
/**
 * Rings smaller than ≈0.02 km² (annexed parcels, enclaves) are dropped: they are far below the
 * analysis radius, yet they made up most of the file for fragmented cities such as Charleston.
 */
const MIN_RING_AREA_SQUARE_DEGREES = 2e-6;

function ringArea(ring) {
  let twice = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    twice += ring[previous][0] * ring[index][1] - ring[index][0] * ring[previous][1];
  }
  return Math.abs(twice) / 2;
}

/** Census designated places (unincorporated communities), for agencies that also patrol them. */
const CDP_LAYER = LAYER.replace(/\/4$/, '/5');
/** Counties, for county-wide agencies. */
const COUNTY_LAYER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1';

/**
 * Provider id → Census place GEOID of the police department's jurisdiction, or a list of
 * GEOIDs whose union it patrols; `cdp:` marks a census designated place and `county:` a county.
 */
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
  oakland: '0653000',
  seattle: '5363000',
  // Northeast and Midwest expansion (src/data/providers/northeastCities.ts).
  boston: '2507000',
  hartford: '0937000',
  rochester: '3663000',
  buffalo: '3611000',
  cleveland: '3916000',
  columbus: '3918000',
  cincinnati: '3915000',
  // The consolidated city's balance, without the included towns that keep their own police.
  indianapolis: '1836003',
  'aurora-il': '1703012',
  minneapolis: '2743000',
  'des-moines': '1921000',
  'kansas-city': '2938000',
  omaha: '3137000',
  // South expansion (src/data/providers/southCities.ts).
  baltimore: '2404000',
  // County Police plus the municipal departments that publish into the same feed.
  'montgomery-county-md': 'county:24031',
  raleigh: '3755000',
  charleston: '4513330',
  charlotte: '3712000',
  orlando: '1253000',
  // The consolidated city's balance plus Baldwin, which JSO patrols; the Beaches have their own police.
  jacksonville: ['1235000', '1203250'],
  tampa: '1271000',
  atlanta: '1304000',
  memphis: '4748000',
  'new-orleans': '2255000',
  'baton-rouge': '2205000',
  'arlington-tx': '4804000',
  // West expansion (src/data/providers/westCities.ts).
  berkeley: '0606000',
  'san-mateo': '0668252',
  tacoma: '5370000',
  'salt-lake-city': '4967000',
  boulder: '0807850',
  'aurora-co': '0804000',
  'colorado-springs': '0816000',
  sacramento: '0664000',
  // LVMPD also patrols unincorporated Clark County around the city, including the Strip.
  'las-vegas': ['3240000', 'cdp:3254600', 'cdp:3284600', 'cdp:3268585', 'cdp:3223770', 'cdp:3271400', 'cdp:3283800', 'cdp:3270900'],
  bakersfield: '0603526',
  riverside: '0662000',
  tempe: '0473000',
  mesa: '0446000',
  tucson: '0477000',
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
async function fetchPlace(providerId, reference) {
  const [prefix, geoid] = reference.includes(':') ? reference.split(':') : ['place', reference];
  const layerUrl = { place: LAYER, cdp: CDP_LAYER, county: COUNTY_LAYER }[prefix];
  if (!layerUrl) throw new Error(`Unknown jurisdiction reference ${reference}`);
  const query = new URLSearchParams({
    where: `GEOID='${geoid}'`,
    outFields: 'GEOID,NAME',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(MAX_ALLOWABLE_OFFSET_DEGREES),
    geometryPrecision: String(PRECISION),
    f: 'json',
  });
  const payload = await fetchJson(`${layerUrl}/query?${query}`);
  const feature = payload.features?.[0];
  if (payload.features?.length !== 1 || !feature.geometry?.rings?.length) {
    throw new Error(`Expected exactly one polygon for ${providerId} (${reference})`);
  }
  const rings = feature.geometry.rings.filter((ring) => ringArea(ring) >= MIN_RING_AREA_SQUARE_DEGREES);
  if (!rings.length) throw new Error(`Every ring of ${providerId} (${reference}) is below the minimum area`);
  return { geoid, name: feature.attributes.NAME, rings };
}

for (const [providerId, references] of Object.entries(PLACES)) {
  const parts = await Promise.all([references].flat().map((reference) => fetchPlace(providerId, reference)));
  const [primary] = parts;
  places[providerId] = {
    geoid: primary.geoid,
    name: parts.map((part) => part.name).join(' + '),
    // Disjoint polygons: the even-odd point test treats their rings as one multipolygon.
    rings: parts.flatMap((part) => part.rings),
  };
  const rings = places[providerId].rings;
  const vertices = rings.reduce((sum, ring) => sum + ring.length, 0);
  console.log(`${providerId}: ${places[providerId].name}, ${rings.length} rings, ${vertices} vertices`);
}

const output = {
  source: `U.S. Census Bureau TIGERweb, ${layer.description?.split(';')[0] ?? 'Incorporated Places'}${layer.description?.includes(';') ? `;${layer.description.split(';')[1]}` : ''}`,
  sourceUrl: LAYER,
  retrieved: new Date().toISOString().slice(0, 10),
  maxAllowableOffsetDegrees: MAX_ALLOWABLE_OFFSET_DEGREES,
  places,
};
await writeFile(new URL('../src/data/jurisdictions.json', import.meta.url), `${JSON.stringify(output)}\n`);
