import { afterEach, describe, expect, it, vi } from 'vitest';
import { monthIndex, summarizeAgency } from '../domain/agencySummary';
import { fixtureSnapshot, geography } from '../test/agencyFixtures';
import {
  CENSUS_COUNTY_SUBDIVISIONS_LAYER,
  CENSUS_PLACES_LAYER,
  loadAgencySnapshot,
  lookupCensusGeography,
  matchAgency,
  STATE_CODES,
} from './agencyStats';
import type { AgencySnapshot } from './agencyStats.types';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubTigerweb(place: unknown, subdivision: unknown) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(CENSUS_PLACES_LAYER)) return jsonResponse(place);
    if (url.startsWith(CENSUS_COUNTY_SUBDIVISIONS_LAYER)) return jsonResponse(subdivision);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const OAKLAND_PLACE = { features: [{ attributes: { GEOID: '0653000', NAME: 'Oakland city' } }] };
const OAKLAND_SUBDIVISION = { features: [{ attributes: { GEOID: '0600192230', NAME: 'Oakland CCD' } }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookupCensusGeography', () => {
  it('reads the place and county subdivision containing a point', async () => {
    const fetchMock = stubTigerweb(OAKLAND_PLACE, OAKLAND_SUBDIVISION);
    const controller = new AbortController();

    await expect(lookupCensusGeography([-122.2712, 37.8044], controller.signal)).resolves.toEqual({
      stateFips: '06',
      countyFips: '06001',
      place: { geoid: '0653000', name: 'Oakland city' },
      countySubdivision: { geoid: '0600192230', name: 'Oakland CCD' },
    });
    const placeUrl = new URL(String(fetchMock.mock.calls.find(([url]) => String(url).startsWith(CENSUS_PLACES_LAYER))![0]));
    expect(placeUrl.searchParams.get('geometry')).toBe('-122.2712,37.8044');
    expect(placeUrl.searchParams.get('inSR')).toBe('4326');
    expect(placeUrl.searchParams.get('returnGeometry')).toBe('false');
    expect(fetchMock.mock.calls[0]![1]).toEqual({ signal: controller.signal });
  });

  it('keeps unincorporated points, and rejects points outside every county', async () => {
    stubTigerweb({ features: [] }, OAKLAND_SUBDIVISION);
    await expect(lookupCensusGeography([-122, 37.7])).resolves.toMatchObject({ place: null, countyFips: '06001' });

    stubTigerweb({ features: [] }, { features: [] });
    await expect(lookupCensusGeography([-140, 30])).resolves.toBeNull();

    stubTigerweb({ features: [] }, { features: [{ attributes: { GEOID: '06001', NAME: 'Malformed' } }] });
    await expect(lookupCensusGeography([-122, 37.7])).resolves.toBeNull();

    stubTigerweb({}, { features: [{ attributes: { GEOID: 6001, NAME: 'Numeric' } }] });
    await expect(lookupCensusGeography([-122, 37.7])).resolves.toBeNull();
  });

  it('surfaces service failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 503)));
    await expect(lookupCensusGeography([-122, 37.7])).rejects.toThrow('Census TIGERweb returned HTTP 503');

    stubTigerweb({ error: { message: 'Invalid geometry' } }, OAKLAND_SUBDIVISION);
    await expect(lookupCensusGeography([-122, 37.7])).rejects.toThrow('Census TIGERweb returned an error: Invalid geometry');

    stubTigerweb({ error: {} }, OAKLAND_SUBDIVISION);
    await expect(lookupCensusGeography([-122, 37.7])).rejects.toThrow('returned an error: unknown');
  });
});

describe('matchAgency', () => {
  const snapshot = fixtureSnapshot();

  it('prefers the city agency', () => {
    expect(matchAgency(geography(), snapshot)).toMatchObject({
      ori: 'CA0000001',
      basis: 'place',
      areaName: 'Fixture city',
      placeWithoutAgency: null,
    });
  });

  it('falls back to a town or township agency', () => {
    const match = matchAgency(geography({
      place: { geoid: '0600099', name: 'Village without police' },
      countySubdivision: { geoid: '0600190002', name: 'Lagging town' },
    }), snapshot);
    expect(match).toMatchObject({ ori: 'CA0000002', basis: 'county-subdivision', placeWithoutAgency: null });
  });

  it('uses the county agency outside city limits, and flags a city without an agency', () => {
    expect(matchAgency(geography({ place: null }), snapshot)).toMatchObject({
      ori: 'CA0000003',
      basis: 'county',
      areaName: 'Fixture County',
      placeWithoutAgency: null,
    });
    expect(matchAgency(geography({ place: { geoid: '0600099', name: 'Contract city' } }), snapshot)).toMatchObject({
      basis: 'county',
      placeWithoutAgency: 'Contract city',
    });
    const unnamed = fixtureSnapshot({ countyNames: {} });
    expect(matchAgency(geography({ place: null }), unnamed)?.areaName).toBe('the county');
  });

  it('returns null where no agency is registered', () => {
    expect(matchAgency(geography({ place: null, countyFips: '06003', countySubdivision: null }), snapshot)).toBeNull();
    // A mapping to an agency the snapshot omits is ignored rather than trusted.
    const dangling = fixtureSnapshot({ places: { '0600001': 'CA9999999' }, counties: {} });
    expect(matchAgency(geography(), dangling)).toBeNull();
  });
});

describe('loadAgencySnapshot', () => {
  it('loads a state chunk by FIPS code, and nothing outside the states', async () => {
    const california = await loadAgencySnapshot('06');
    expect(california?.state).toBe('CA');
    expect(california?.stateFips).toBe('06');
    await expect(loadAgencySnapshot('72')).resolves.toBeNull();
    expect(Object.keys(STATE_CODES)).toHaveLength(51);
  });
});

describe('committed FBI snapshots', () => {
  const snapshots = Object.values(import.meta.glob<AgencySnapshot>('./agencyStats/*.json', { eager: true, import: 'default' }));
  const byState = new Map(snapshots.map((snapshot) => [snapshot.state, snapshot]));
  const [first] = snapshots;

  it('covers every state and DC with one consistent month range', () => {
    expect([...byState.keys()].sort()).toEqual(Object.values(STATE_CODES).sort());
    for (const snapshot of snapshots) {
      expect(STATE_CODES[snapshot.stateFips]).toBe(snapshot.state);
      expect(snapshot.months).toEqual(first!.months);
      expect(snapshot.refreshed).toBe(first!.refreshed);
    }
  });

  it('aligns every series with the months and resolves every mapping', () => {
    const length = monthIndex(first!.months[1]) - monthIndex(first!.months[0]) + 1;
    expect(length).toBeGreaterThanOrEqual(24);
    for (const snapshot of snapshots) {
      for (const series of [snapshot.stateRates.violent, snapshot.stateRates.property]) {
        expect(series).toHaveLength(length);
      }
      for (const agency of Object.values(snapshot.agencies)) {
        if (agency.violent) expect(agency.violent).toHaveLength(length);
        if (agency.property) expect(agency.property).toHaveLength(length);
      }
      const referenced = [
        ...Object.values(snapshot.places),
        ...Object.values(snapshot.countySubdivisions),
        ...Object.values(snapshot.counties),
      ];
      for (const ori of referenced) expect(snapshot.agencies[ori], `${snapshot.state} ${ori}`).toBeDefined();
      expect(new Set(referenced)).toEqual(new Set(Object.keys(snapshot.agencies)));
      for (const geoid of Object.keys(snapshot.places)) expect(geoid.startsWith(snapshot.stateFips)).toBe(true);
      for (const geoid of Object.keys(snapshot.counties)) expect(geoid.startsWith(snapshot.stateFips)).toBe(true);
    }
  });

  /** Places travelers ask about, with the agency each must resolve to and recent data. */
  const DESTINATIONS: ReadonlyArray<readonly [string, string, string, RegExp]> = [
    ['CA', 'places', '0653000', /^Oakland Police/],
    ['CA', 'places', '0668000', /^San Jose Police/],
    ['CA', 'places', '0606000', /^Berkeley Police/],
    ['CA', 'places', '0666000', /^San Diego Police/],
    ['NV', 'counties', '32003', /^Las Vegas Metropolitan Police/],
    ['HI', 'counties', '15003', /^Honolulu Police/],
    ['NJ', 'places', '3436000', /^Jersey City Police/],
    ['MA', 'places', '2507000', /^Boston Police/],
    ['GA', 'places', '1304000', /^Atlanta Police/],
    ['FL', 'places', '1245000', /^Miami Police/],
    ['FL', 'places', '1253000', /^Orlando Police/],
    ['LA', 'places', '2255000', /^New Orleans Police/],
    ['TX', 'places', '4805000', /^Austin Police/],
    ['TX', 'places', '4835000', /^Houston Police/],
    ['AZ', 'places', '0455000', /^Phoenix Police/],
    ['OR', 'places', '4159000', /^Portland Police/],
  ];

  it.each(DESTINATIONS)('%s %s %s resolves to its own agency', (state, kind, geoid, agencyName) => {
    const snapshot = byState.get(state)!;
    const mapping = snapshot[kind as 'places' | 'counties'];
    const agency = snapshot.agencies[mapping[geoid]!];
    expect(agency?.name).toMatch(agencyName);
    expect(agency!.population).toBeGreaterThan(100_000);
  });

  it('can summarize most destinations from recent months', () => {
    const summaries = DESTINATIONS.map(([state, kind, geoid]) => {
      const snapshot = byState.get(state)!;
      const ori = snapshot[kind as 'places' | 'counties'][geoid]!;
      return summarizeAgency({ ori, agency: snapshot.agencies[ori]!, basis: 'place', areaName: geoid, placeWithoutAgency: null }, snapshot);
    });
    const recent = summaries.filter((summary) => summary && summary.monthsBehind <= 12);
    expect(recent.length).toBeGreaterThanOrEqual(DESTINATIONS.length - 3);
  });
});
