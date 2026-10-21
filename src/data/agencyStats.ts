import type { Coordinates } from '../types';
import type {
  AgencyMatch,
  AgencySnapshot,
  CensusArea,
  CensusGeography,
} from './agencyStats.types';

const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
export const CENSUS_PLACES_LAYER = `${TIGERWEB}/4`;
export const CENSUS_COUNTY_SUBDIVISIONS_LAYER = `${TIGERWEB}/1`;

/** State FIPS code → USPS code of every state with a snapshot. */
export const STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

const snapshotLoaders = import.meta.glob<AgencySnapshot>('./agencyStats/*.json', { import: 'default' });

/** Loads one state's snapshot as its own chunk, or `null` outside the 50 states and DC. */
export async function loadAgencySnapshot(stateFips: string): Promise<AgencySnapshot | null> {
  const code = STATE_CODES[stateFips];
  const load = code ? snapshotLoaders[`./agencyStats/${code}.json`] : undefined;
  return load ? load() : null;
}

function pointQuery(point: Coordinates, outFields: string): string {
  return new URLSearchParams({
    geometry: `${point[0]},${point[1]}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
    f: 'json',
  }).toString();
}

async function firstArea(url: string, signal: AbortSignal | undefined): Promise<CensusArea | null> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Census TIGERweb returned HTTP ${response.status}`);
  const payload = await response.json() as {
    error?: { message?: string };
    features?: Array<{ attributes?: { GEOID?: unknown; NAME?: unknown } }>;
  };
  if (payload.error) throw new Error(`Census TIGERweb returned an error: ${payload.error.message ?? 'unknown'}`);
  const attributes = payload.features?.[0]?.attributes;
  if (typeof attributes?.GEOID !== 'string' || typeof attributes.NAME !== 'string') return null;
  return { geoid: attributes.GEOID, name: attributes.NAME };
}

/**
 * The incorporated place and county subdivision containing `point`, from Census TIGERweb.
 * Every county is divided into county subdivisions, so a point without one lies outside
 * the United States (or offshore) and yields `null`.
 */
export async function lookupCensusGeography(point: Coordinates, signal?: AbortSignal): Promise<CensusGeography | null> {
  const [place, countySubdivision] = await Promise.all([
    firstArea(`${CENSUS_PLACES_LAYER}/query?${pointQuery(point, 'GEOID,NAME')}`, signal),
    firstArea(`${CENSUS_COUNTY_SUBDIVISIONS_LAYER}/query?${pointQuery(point, 'GEOID,NAME')}`, signal),
  ]);
  if (!countySubdivision || !/^\d{10}$/.test(countySubdivision.geoid)) return null;
  return {
    stateFips: countySubdivision.geoid.slice(0, 2),
    countyFips: countySubdivision.geoid.slice(0, 5),
    place,
    countySubdivision,
  };
}

/**
 * The agency whose totals describe the point: its city's police, then its town or township
 * police, then the county agency (sheriff or county police) for everything else.
 */
export function matchAgency(geography: CensusGeography, snapshot: AgencySnapshot): AgencyMatch | null {
  const byPlace = geography.place ? snapshot.places[geography.place.geoid] : undefined;
  if (byPlace && geography.place && snapshot.agencies[byPlace]) {
    return { ori: byPlace, agency: snapshot.agencies[byPlace], basis: 'place', areaName: geography.place.name, placeWithoutAgency: null };
  }

  const placeWithoutAgency = geography.place?.name ?? null;
  const bySubdivision = geography.countySubdivision ? snapshot.countySubdivisions[geography.countySubdivision.geoid] : undefined;
  if (bySubdivision && geography.countySubdivision && snapshot.agencies[bySubdivision]) {
    return {
      ori: bySubdivision,
      agency: snapshot.agencies[bySubdivision],
      basis: 'county-subdivision',
      areaName: geography.countySubdivision.name,
      // A village inside a town that polices it is expected, not a gap.
      placeWithoutAgency: null,
    };
  }

  const byCounty = snapshot.counties[geography.countyFips];
  if (byCounty && snapshot.agencies[byCounty]) {
    return {
      ori: byCounty,
      agency: snapshot.agencies[byCounty],
      basis: 'county',
      areaName: snapshot.countyNames[geography.countyFips] ?? 'the county',
      placeWithoutAgency,
    };
  }
  return null;
}
