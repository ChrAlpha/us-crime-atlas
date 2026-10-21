#!/usr/bin/env node
/**
 * Regenerates src/data/agencyStats/{STATE}.json: monthly violent and property offense counts
 * for every city and county law-enforcement agency in the FBI Crime Data Explorer, matched to
 * the Census geography each agency polices.
 *
 *   node scripts/fetch-agency-stats.mjs [--cache <dir>] [--states CA,NV]
 *
 * The atlas uses these snapshots wherever no local incident feed is registered. They describe
 * a whole jurisdiction over twelve months, never a radius, and the output is committed so the
 * atlas does not depend on the Crime Data Explorer (which sends no CORS headers) at runtime.
 *
 * About 30,000 Crime Data Explorer requests are needed; responses are cached under `--cache`
 * (default node_modules/.cache/agency-stats), so an interrupted run resumes where it stopped.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CDE = 'https://cde.ucr.cjis.gov/LATEST';
const TIGERWEB = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const PLACES_LAYER = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/4`;
const COUNTY_SUBDIVISIONS_LAYER = `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/1`;
const COUNTIES_LAYER = `${TIGERWEB}/State_County/MapServer/1`;
const OUTPUT_DIR = new URL('../src/data/agencyStats/', import.meta.url);

/** Months requested per agency, ending at the refresh month. */
const REQUEST_MONTHS = 38;
/**
 * Months before the refresh month that are still filling in. Agencies submit on their own
 * schedules; two months before a mid-October refresh, Texas had reported only about three
 * quarters of a normal month, so the newest usable month is three months back.
 */
const SETTLING_MONTHS = 3;
const CONCURRENCY = 12;
const AGENCY_TYPES = new Set(['City', 'County']);

/** County-equivalents patrolled by an agency whose name does not mention the county. */
const COUNTY_AGENCY_OVERRIDES = {
  // Unincorporated Clark County, including the Las Vegas Strip.
  '32003': 'Las Vegas Metropolitan Police Department',
  // Hawaii has no incorporated places. The other county police departments are county agencies;
  // the City and County of Honolulu's is listed as a city agency.
  '15003': 'Honolulu Police Department',
};

const STATES = {
  '01': ['AL', 'Alabama'], '02': ['AK', 'Alaska'], '04': ['AZ', 'Arizona'], '05': ['AR', 'Arkansas'],
  '06': ['CA', 'California'], '08': ['CO', 'Colorado'], '09': ['CT', 'Connecticut'], '10': ['DE', 'Delaware'],
  '11': ['DC', 'District of Columbia'], '12': ['FL', 'Florida'], '13': ['GA', 'Georgia'], '15': ['HI', 'Hawaii'],
  '16': ['ID', 'Idaho'], '17': ['IL', 'Illinois'], '18': ['IN', 'Indiana'], '19': ['IA', 'Iowa'],
  '20': ['KS', 'Kansas'], '21': ['KY', 'Kentucky'], '22': ['LA', 'Louisiana'], '23': ['ME', 'Maine'],
  '24': ['MD', 'Maryland'], '25': ['MA', 'Massachusetts'], '26': ['MI', 'Michigan'], '27': ['MN', 'Minnesota'],
  '28': ['MS', 'Mississippi'], '29': ['MO', 'Missouri'], '30': ['MT', 'Montana'], '31': ['NE', 'Nebraska'],
  '32': ['NV', 'Nevada'], '33': ['NH', 'New Hampshire'], '34': ['NJ', 'New Jersey'], '35': ['NM', 'New Mexico'],
  '36': ['NY', 'New York'], '37': ['NC', 'North Carolina'], '38': ['ND', 'North Dakota'], '39': ['OH', 'Ohio'],
  '40': ['OK', 'Oklahoma'], '41': ['OR', 'Oregon'], '42': ['PA', 'Pennsylvania'], '44': ['RI', 'Rhode Island'],
  '45': ['SC', 'South Carolina'], '46': ['SD', 'South Dakota'], '47': ['TN', 'Tennessee'], '48': ['TX', 'Texas'],
  '49': ['UT', 'Utah'], '50': ['VT', 'Vermont'], '51': ['VA', 'Virginia'], '53': ['WA', 'Washington'],
  '54': ['WV', 'West Virginia'], '55': ['WI', 'Wisconsin'], '56': ['WY', 'Wyoming'],
};

const cacheArg = process.argv.indexOf('--cache');
const CACHE_DIR = cacheArg > 0 ? process.argv[cacheArg + 1] : new URL('../node_modules/.cache/agency-stats/', import.meta.url).pathname;

const statesArg = process.argv.indexOf('--states');
const ONLY_STATES = statesArg > 0 ? new Set(process.argv[statesArg + 1].split(',')) : null;
const selectedStates = Object.entries(STATES).filter(([, [abbr]]) => !ONLY_STATES || ONLY_STATES.has(abbr));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.error) throw new Error(`${url} returned ${JSON.stringify(payload.error)}`);
      return payload;
    } catch (error) {
      lastError = error;
      await sleep(2_000 * attempt);
    }
  }
  throw lastError;
}

async function cachedJson(name, url) {
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) return JSON.parse(await readFile(path, 'utf8'));
  const payload = await fetchJson(url);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(payload));
  await rename(`${path}.tmp`, path);
  return payload;
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
      done += 1;
      if (done % 2_000 === 0) console.log(`  ${done} / ${items.length}`);
    }
  }));
  return results;
}

async function queryAll(layer, outFields) {
  const features = [];
  for (let offset = 0; ; ) {
    const query = new URLSearchParams({
      where: '1=1',
      outFields,
      returnGeometry: 'false',
      orderByFields: 'GEOID',
      resultOffset: String(offset),
      resultRecordCount: '50000',
      f: 'json',
    });
    const payload = await fetchJson(`${layer}/query?${query}`);
    features.push(...payload.features.map((feature) => feature.attributes));
    if (!payload.exceededTransferLimit || payload.features.length === 0) break;
    offset += payload.features.length;
  }
  return features;
}

// ── Months ───────────────────────────────────────────────────────────────────

function monthIndex(year, month) {
  return year * 12 + (month - 1);
}

function monthKey(index) {
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** CDE month keys are `MM-YYYY`. */
function cdeMonth(index) {
  const [year, month] = monthKey(index).split('-');
  return `${month}-${year}`;
}

// ── Names ────────────────────────────────────────────────────────────────────

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bsainte\b/g, 'ste')
    .replace(/\bmount\b/g, 'mt')
    .replace(/\bfort\b/g, 'ft')
    .replace(/\btwp\b/g, 'township')
    .trim()
    .replace(/\s+/g, ' ');
}

const AGENCY_SUFFIXES = [
  'department of public safety', 'public safety department', 'department of police services',
  'police department', 'police dept', 'police services', 'department of police', 'public safety',
  'police', 'sheriffs office', 'sheriffs department', 'sheriff office', 'sheriff department', 'sheriff',
  'marshals office', 'marshal office', 'marshal', 'division of police', 'police division',
  'bureau of police', 'police bureau',
].sort((a, b) => b.length - a.length);
const PLACE_TYPE_WORDS = ['city', 'town', 'village', 'borough', 'township', 'county', 'parish', 'metropolitan', 'metro'];

/**
 * Candidate jurisdiction names inside an agency name, longest first ("oklahoma city", then
 * "oklahoma"), plus the type words it used ("township").
 */
function agencyCores(rawAgencyName) {
  // "Hamilton Township Police Department, Mercer County": the county disambiguates.
  const [agencyName, countyHint = ''] = rawAgencyName.split(/,\s*/);
  let core = normalize(agencyName);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of AGENCY_SUFFIXES) {
      if (core.endsWith(` ${suffix}`) || core === suffix) {
        core = core.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }
  core = core
    .replace(/^(city|town|village|borough|township) of /, '')
    .replace(/^(metropolitan|metro) /, '')
    // "Webster Town and Village": the town polices its village too.
    .replace(/ town and village$/, ' town');
  const cores = [core];
  const typeWords = [];
  for (;;) {
    const word = PLACE_TYPE_WORDS.find((type) => core.endsWith(` ${type}`));
    if (!word) break;
    typeWords.push(word);
    core = core.slice(0, -word.length - 1).trim();
    cores.push(core);
  }
  // "Charlotte-Mecklenburg" polices Charlotte.
  const hyphenated = /^([^-]+)-/.exec(agencyName);
  if (hyphenated) cores.push(normalize(hyphenated[1]));
  return {
    cores: [...new Set(cores.filter(Boolean))],
    typeWords,
    countyHint: normalize(countyHint).replace(/ (county|parish)$/, ''),
  };
}

/** "Athens-Clarke County unified government (balance)" → "Athens-Clarke County". */
const CONSOLIDATED_SUFFIX = / (?:(?:unified|consolidated|metropolitan|metro) government|urban county|city|town)? ?\(balance\)$/i;

function nameVariants(rawBasename) {
  const basename = rawBasename.replace(CONSOLIDATED_SUFFIX, '').trim();
  // "San Buenaventura (Ventura)" is also known by the name in parentheses.
  const alias = /^(.*?)\s*\(([^)]+)\)$/.exec(basename);
  if (alias) {
    const [main, aside] = [nameVariants(alias[1]), nameVariants(alias[2])];
    return { full: main.full, variants: [...new Set([...main.variants, aside.full])] };
  }
  const full = normalize(basename);
  const variants = new Set([full]);
  // "Nashville-Davidson", "Louisville/Jefferson County", "Lexington-Fayette".
  const first = basename.split(/[-/]/)[0];
  if (first && first !== basename) variants.add(normalize(first));
  // "Boise City", "West Valley City", "Weymouth Town", "City of Orange".
  variants.add(full.replace(/ (city|town|village|borough)$/, '').replace(/^city of /, ''));
  return { full, variants: [...variants] };
}

function distanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = Math.PI / 180;
  const x = (longitudeB - longitudeA) * radians * Math.cos(((latitudeA + latitudeB) / 2) * radians);
  const y = (latitudeB - latitudeA) * radians;
  return Math.sqrt(x * x + y * y) * 6371;
}

function nearest(candidates, agency) {
  if (candidates.length <= 1 || typeof agency.latitude !== 'number' || typeof agency.longitude !== 'number') {
    return candidates.length === 1 ? candidates[0] : null;
  }
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      distance: distanceKm(agency.latitude, agency.longitude, Number(candidate.INTPTLAT), Number(candidate.INTPTLON)),
    }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0].candidate;
}

// ── Monthly series ───────────────────────────────────────────────────────────

function seriesFromResponse(payload, keyName, months) {
  const actuals = payload?.offenses?.actuals ?? {};
  const series = actuals[`${keyName} Offenses`];
  if (!series) return null;
  return months.map((index) => {
    const value = series[cdeMonth(index)];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  });
}

function rateSeries(payload, keyName, months) {
  const series = payload?.offenses?.rates?.[`${keyName} Offenses`];
  if (!series) return null;
  return months.map((index) => {
    const value = series[cdeMonth(index)];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;
  });
}

/** The agency's own label in a summarized response: the key that is neither its state nor the nation. */
function agencyKey(payload, stateName, agencyName) {
  const keys = Object.keys(payload?.offenses?.actuals ?? {})
    .filter((key) => key.endsWith(' Offenses'))
    .map((key) => key.slice(0, -' Offenses'.length));
  if (keys.includes(agencyName)) return agencyName;
  const others = keys.filter((key) => key !== stateName && key !== 'United States');
  return others.length === 1 ? others[0] : null;
}

function latestPopulation(payload, keyName) {
  const series = payload?.populations?.population?.[keyName];
  if (!series) return null;
  const values = Object.entries(series)
    .map(([key, value]) => [key.slice(3) + key.slice(0, 2), value])
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return values.at(-1)?.[1] ?? null;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Trailing zero months from an agency that normally reports many offenses are unsubmitted
 * NIBRS months, not quiet ones; they become `null`.
 */
function trimUnsubmitted(violent, property) {
  const totals = violent.map((value, index) => (value === null || property[index] === null ? null : value + property[index]));
  const typical = median(totals.filter((value) => value !== null));
  if (typical < 10) return;
  for (let index = totals.length - 1; index >= 0; index -= 1) {
    if (totals[index] === null) continue;
    if (totals[index] > 0) break;
    violent[index] = null;
    property[index] = null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const refresh = await fetchJson(`${CDE}/refresh-date`);
const [refreshMonth, , refreshYear] = refresh.last_refresh_date.UCR.split('/').map(Number);
const refreshIndex = monthIndex(refreshYear, refreshMonth);
const requestStart = refreshIndex - REQUEST_MONTHS + 1;
const cutoff = refreshIndex - SETTLING_MONTHS;
const months = Array.from({ length: cutoff - requestStart + 1 }, (_, offset) => requestStart + offset);
const requestRange = `from=${cdeMonth(requestStart)}&to=${cdeMonth(refreshIndex)}`;
const rangeKey = `${monthKey(requestStart)}-${monthKey(refreshIndex)}`;
console.log(`CDE refreshed ${refresh.last_refresh_date.UCR}; months ${monthKey(requestStart)} to ${monthKey(cutoff)}`);

console.log('Census geography');
const [counties, places, countySubdivisions] = await Promise.all([
  queryAll(COUNTIES_LAYER, 'GEOID,BASENAME,NAME,STATE,LSADC'),
  queryAll(PLACES_LAYER, 'GEOID,BASENAME,NAME,STATE,FUNCSTAT,INTPTLAT,INTPTLON'),
  queryAll(COUNTY_SUBDIVISIONS_LAYER, 'GEOID,BASENAME,NAME,STATE,COUNTY,FUNCSTAT,INTPTLAT,INTPTLON'),
]);
console.log(`  ${counties.length} counties, ${places.length} places, ${countySubdivisions.length} county subdivisions`);

console.log('FBI agencies');
const agenciesByState = {};
for (const [stateFips, [abbr]] of selectedStates) {
  const payload = await cachedJson(`agencies/${abbr}.json`, `${CDE}/agency/byStateAbbr/${abbr}`);
  agenciesByState[stateFips] = Object.values(payload).flat()
    .filter((agency) => AGENCY_TYPES.has(agency.agency_type_name));
}
const allAgencies = Object.values(agenciesByState).flat();
console.log(`  ${allAgencies.length} city and county agencies`);

console.log('Monthly offenses');
const jobs = allAgencies.flatMap((agency) => ['V', 'P'].map((offense) => ({ agency, offense })));
const responses = await mapConcurrent(jobs, ({ agency, offense }) => cachedJson(
  `summarized/${agency.ori}-${offense}-${rangeKey}.json`,
  `${CDE}/summarized/agency/${agency.ori}/${offense}?${requestRange}`,
));
const responseByKey = new Map(jobs.map((job, index) => [`${job.agency.ori}:${job.offense}`, responses[index]]));

const stateResponses = {};
for (const [stateFips, [abbr]] of selectedStates) {
  stateResponses[stateFips] = {
    V: await cachedJson(`state/${abbr}-V-${rangeKey}.json`, `${CDE}/summarized/state/${abbr}/V?${requestRange}`),
    P: await cachedJson(`state/${abbr}-P-${rangeKey}.json`, `${CDE}/summarized/state/${abbr}/P?${requestRange}`),
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
const report = { agencies: 0, reporting: 0, matched: 0, matchedPopulation: 0, reportingPopulation: 0, unmatched: [] };

for (const [stateFips, [abbr, stateName]] of selectedStates) {
  const stateCounties = counties.filter((county) => county.STATE === stateFips);
  const statePlaces = places.filter((place) => place.STATE === stateFips);
  const stateSubdivisions = countySubdivisions.filter((subdivision) => (
    subdivision.STATE === stateFips && ['A', 'B', 'C'].includes(subdivision.FUNCSTAT)
  ));
  const countyByName = new Map();
  for (const county of stateCounties) {
    const key = normalize(county.BASENAME);
    // Independent cities share basenames with counties (Richmond city / Richmond County).
    for (const name of [key, key.replaceAll(' ', '')]) {
      if (!countyByName.has(name) || county.LSADC !== '25') countyByName.set(name, county);
    }
  }

  const agencies = [];
  for (const agency of agenciesByState[stateFips]) {
    report.agencies += 1;
    const violentResponse = responseByKey.get(`${agency.ori}:V`);
    const propertyResponse = responseByKey.get(`${agency.ori}:P`);
    const key = agencyKey(violentResponse, stateName, agency.agency_name);
    const violent = key ? seriesFromResponse(violentResponse, key, months) : null;
    const property = key ? seriesFromResponse(propertyResponse, key, months) : null;
    const population = key ? latestPopulation(violentResponse, key) : null;
    const reporting = Boolean(violent && property && violent.some((value) => value !== null));
    if (reporting) {
      trimUnsubmitted(violent, property);
      report.reporting += 1;
      report.reportingPopulation += population ?? 0;
    }
    agencies.push({
      ori: agency.ori,
      name: agency.agency_name.trim(),
      type: agency.agency_type_name,
      counties: String(agency.counties ?? '').split(/[,;]/).map((county) => normalize(county)).filter(Boolean),
      latitude: agency.latitude,
      longitude: agency.longitude,
      population: population ?? 0,
      violent: reporting ? violent : null,
      property: reporting ? property : null,
    });
  }

  const countyFipsOf = (agency, countyHint) => [countyHint, ...agency.counties]
    .filter(Boolean)
    .map((name) => {
      const key = name.replace(/ (county|parish|borough|census area|municipality)$/, '');
      return (countyByName.get(key) ?? countyByName.get(key.replaceAll(' ', '')))?.GEOID;
    })
    .filter(Boolean);

  // Competing claims on one area keep the agency serving the most people.
  const claims = { places: new Map(), countySubdivisions: new Map(), counties: new Map() };
  const claim = (kind, geoid, agency) => {
    const current = claims[kind].get(geoid);
    if (!current || agency.population > current.population) claims[kind].set(geoid, agency);
  };

  const placeNames = statePlaces.map((place) => ({ place, ...nameVariants(place.BASENAME) }));
  const subdivisionNames = stateSubdivisions.map((subdivision) => ({ subdivision, ...nameVariants(subdivision.BASENAME) }));

  for (const agency of agencies) {
    const { cores, typeWords, countyHint } = agencyCores(agency.name);
    let matched = false;

    if (agency.type === 'County') {
      const county = cores.map((core) => countyByName.get(core) ?? countyByName.get(core.replaceAll(' ', ''))).find(Boolean)
        ?? (agency.counties.length === 1 ? countyByName.get(agency.counties[0].replace(/ (county|parish)$/, '')) : undefined);
      if (county) {
        claim('counties', county.GEOID, agency);
        matched = true;
      }
    }

    const preferSubdivision = typeWords.some((word) => word === 'township' || word === 'town');
    const countyFips = countyFipsOf(agency, countyHint);
    for (const core of matched ? [] : cores) {
      const exactPlaces = placeNames.filter((entry) => entry.full === core).map((entry) => entry.place);
      const prefixPlaces = placeNames.filter((entry) => entry.variants.includes(core)).map((entry) => entry.place);
      const subdivisions = subdivisionNames.filter((entry) => entry.full === core).map((entry) => entry.subdivision);
      const aliasSubdivisions = subdivisions.length
        ? []
        : subdivisionNames.filter((entry) => entry.variants.includes(core)).map((entry) => entry.subdivision);
      const candidates = subdivisions.length ? subdivisions : aliasSubdivisions;
      const localSubdivisions = candidates.filter((subdivision) => countyFips.includes(subdivision.GEOID.slice(0, 5)));
      const place = nearest(exactPlaces, agency) ?? (prefixPlaces.length === 1 ? prefixPlaces[0] : null);
      // A county hint that matches nothing rules the name out rather than picking a namesake elsewhere.
      const subdivision = countyHint && !localSubdivisions.length
        ? null
        : nearest(localSubdivisions.length ? localSubdivisions : candidates, agency);

      if (subdivision && (preferSubdivision || !place)) {
        claim('countySubdivisions', subdivision.GEOID, agency);
        matched = true;
      } else if (place) {
        claim('places', place.GEOID, agency);
        matched = true;
      }
      if (matched) break;
    }

    if (matched) {
      report.matched += 1;
      report.matchedPopulation += agency.violent ? agency.population : 0;
    } else if (agency.violent) {
      report.unmatched.push({ state: abbr, name: agency.name, type: agency.type, population: agency.population });
    }
  }

  for (const [countyFips, agencyName] of Object.entries(COUNTY_AGENCY_OVERRIDES)) {
    if (countyFips.slice(0, 2) !== stateFips) continue;
    const agency = agencies.find((candidate) => candidate.name === agencyName);
    if (!agency) throw new Error(`Override agency ${agencyName} is missing from ${abbr}`);
    claims.counties.set(countyFips, agency);
    const unmatched = report.unmatched.findIndex((entry) => entry.state === abbr && entry.name === agencyName);
    if (unmatched >= 0) {
      report.unmatched.splice(unmatched, 1);
      report.matched += 1;
      report.matchedPopulation += agency.population;
    }
  }

  const referenced = new Set([
    ...claims.places.values(),
    ...claims.countySubdivisions.values(),
    ...claims.counties.values(),
  ].map((agency) => agency.ori));
  const sortedEntries = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([geoid, agency]) => [geoid, agency.ori]));

  const output = {
    state: abbr,
    stateName,
    stateFips,
    source: 'FBI Crime Data Explorer, summarized SRS and NIBRS offenses known to law enforcement',
    sourceUrl: 'https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend',
    refreshed: refresh.last_refresh_date.UCR,
    retrieved: new Date().toISOString().slice(0, 10),
    months: [monthKey(months[0]), monthKey(months.at(-1))],
    stateRates: {
      violent: rateSeries(stateResponses[stateFips].V, stateName, months),
      property: rateSeries(stateResponses[stateFips].P, stateName, months),
    },
    nationalRates: {
      violent: rateSeries(stateResponses[stateFips].V, 'United States', months),
      property: rateSeries(stateResponses[stateFips].P, 'United States', months),
    },
    agencies: Object.fromEntries(agencies
      .filter((agency) => referenced.has(agency.ori))
      .sort((a, b) => a.ori.localeCompare(b.ori))
      .map((agency) => [agency.ori, {
        name: agency.name,
        type: agency.type,
        population: agency.population,
        violent: agency.violent,
        property: agency.property,
      }])),
    places: sortedEntries(claims.places),
    countySubdivisions: sortedEntries(claims.countySubdivisions),
    counties: sortedEntries(claims.counties),
    countyNames: Object.fromEntries(stateCounties
      .map((county) => [county.GEOID, county.NAME])
      .sort(([a], [b]) => a.localeCompare(b))),
  };
  if (!output.stateRates.violent || !output.stateRates.property) throw new Error(`State rates are missing for ${abbr}`);
  await writeFile(new URL(`${abbr}.json`, OUTPUT_DIR), `${JSON.stringify(output)}\n`);
}

report.unmatched.sort((a, b) => b.population - a.population);
console.log(`${report.reporting} of ${report.agencies} agencies report; ${report.matched} matched to Census geography`);
console.log(`Reporting population matched: ${(report.matchedPopulation / report.reportingPopulation * 100).toFixed(1)}%`);
console.log('Largest unmatched reporting agencies:');
for (const agency of report.unmatched.slice(0, 40)) {
  console.log(`  ${agency.state} ${agency.type} ${agency.name} (${agency.population})`);
}
