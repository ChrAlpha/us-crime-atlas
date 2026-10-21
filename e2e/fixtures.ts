import type { Page, Route } from '@playwright/test';

const DAY_MS = 86_400_000;

/**
 * A source timestamp `daysAgo` calendar days before today. Times sit mid-day so the
 * browser-zone/UTC date difference never moves a fixture across a window boundary.
 */
function sourceDate(daysAgo: number, hour = 12) {
  const day = new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
  const clock = `${String(hour).padStart(2, '0')}:15:00`;
  return {
    date: `${day}T00:00:00.000`,
    textDate: `${day} 00:00:00.0000000`,
    time: clock,
    shortTime: clock.slice(0, 5),
    timestamp: `${day}T${clock}.000`,
    epoch: Date.parse(`${day}T${clock}.000Z`),
  };
}

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Answers the three Socrata request shapes the atlas makes: the latest-record aggregate,
 * the count aggregate and paged row queries. Rows are returned unfiltered; the provider's
 * client-side range and Haversine filters are authoritative.
 */
function socrataHandler(rows: unknown[], latestRecord: string | null, reportedTotal = rows.length) {
  return (route: Route) => {
    const url = new URL(route.request().url());
    const select = url.searchParams.get('$select') ?? '';
    if (select.startsWith('max(')) return json(route, latestRecord ? [{ latest_record: latestRecord }] : [{}]);
    if (select.startsWith('count(')) return json(route, [{ total: String(reportedTotal) }]);
    return json(route, Number(url.searchParams.get('$offset') ?? 0) > 0 ? [] : rows);
  };
}

function arcgisHandler(features: unknown[], latestEpoch: number | null) {
  return (route: Route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('outStatistics')) {
      return json(route, { features: [{ attributes: { latest_record: latestEpoch } }] });
    }
    if (url.searchParams.get('returnCountOnly') === 'true') return json(route, { count: features.length });
    return json(route, {
      exceededTransferLimit: false,
      features: Number(url.searchParams.get('resultOffset') ?? 0) > 0 ? [] : features,
    });
  };
}

const nycPoint = (
  id: string,
  daysAgo: number,
  category: string,
  description: string,
  longitude: number,
  latitude: number,
  hour = 12,
) => {
  const date = sourceDate(daysAgo, hour);
  return {
    cmplnt_num: id,
    cmplnt_fr_dt: date.date,
    cmplnt_fr_tm: date.time,
    ofns_desc: category,
    pd_desc: description,
    law_cat_cd: category.includes('ASSAULT') || category.includes('ROBBERY') ? 'FELONY' : 'MISDEMEANOR',
    loc_of_occur_desc: 'FRONT OF',
    prem_typ_desc: 'STREET',
    boro_nm: 'MANHATTAN',
    latitude: String(latitude),
    longitude: String(longitude),
  };
};

/** NYC rows `lag` days behind today, as for a quarterly publisher. */
export function nycFixture(lag = 0) {
  return [
    nycPoint('ny-1', lag + 1, 'FELONY ASSAULT', 'AGGRAVATED ASSAULT', -73.985, 40.758, 23),
    nycPoint('ny-2', lag + 2, 'ROBBERY', 'ROBBERY, OPEN AREA', -73.98, 40.758, 1),
    nycPoint('ny-3', lag + 3, 'PETIT LARCENY', 'PICKPOCKET', -73.988, 40.754, 14),
    nycPoint('ny-4', lag + 4, 'GRAND LARCENY OF MOTOR VEHICLE', 'AUTO THEFT', -73.99, 40.76, 18),
    nycPoint('ny-5', lag + 5, 'BURGLARY', 'COMMERCIAL BURGLARY', -73.981, 40.762, 3),
    nycPoint('ny-prev-1', lag + 34, 'PETIT LARCENY', 'LARCENY', -73.984, 40.758),
    nycPoint('ny-prev-2', lag + 38, 'ROBBERY', 'ROBBERY', -73.987, 40.756),
    ...Array.from({ length: 12 }, (_, index) =>
      nycPoint(
        `ny-outer-${index}`,
        lag + 2 + (index % 8),
        index % 3 === 0 ? 'FELONY ASSAULT' : 'PETIT LARCENY',
        index % 3 === 0 ? 'ASSAULT' : 'LARCENY',
        -73.963 + index * 0.0004,
        40.758 + (index % 2) * 0.003,
        10 + (index % 12),
      ),
    ),
  ];
}

const chicagoPoint = (id: string, daysAgo: number, type: string, longitude: number, latitude: number) => {
  const date = sourceDate(daysAgo, 22);
  return {
    id,
    date: date.timestamp,
    block: '001XX N STATE ST',
    primary_type: type,
    description: type === 'BATTERY' ? 'AGGRAVATED' : 'OVER $500',
    location_description: 'SIDEWALK',
    latitude: String(latitude),
    longitude: String(longitude),
  };
};

export const chicagoFixture = [
  chicagoPoint('chi-1', 2, 'BATTERY', -87.629, 41.884),
  chicagoPoint('chi-2', 3, 'ROBBERY', -87.631, 41.882),
  chicagoPoint('chi-3', 4, 'THEFT', -87.628, 41.88),
  chicagoPoint('chi-4', 5, 'MOTOR VEHICLE THEFT', -87.626, 41.885),
  chicagoPoint('chi-prev', 40, 'THEFT', -87.63, 41.883),
  ...Array.from({ length: 8 }, (_, index) =>
    chicagoPoint(`chi-outer-${index}`, 2 + index, 'THEFT', -87.608 + index * 0.0003, 41.884),
  ),
];

const dallasPoint = (id: string, daysAgo: number, offense: string, longitude: number, latitude: number) => {
  const date = sourceDate(daysAgo, 21);
  return {
    servnumid: id,
    incidentnum: `${id}-case`,
    date1: date.textDate,
    time1: date.shortTime,
    nibrs_crime: offense,
    offincident: offense,
    incident_address: '1500 MAIN ST',
    division: 'CENTRAL',
    geocoded_column: { type: 'Point', coordinates: [longitude, latitude] },
  };
};

/** Dallas settles two days, so the newest fixture rows sit three or more days back. */
export const dallasFixture = [
  dallasPoint('dal-1', 3, 'AGG ASSAULT - NFV', -96.797, 32.7767),
  dallasPoint('dal-2', 4, 'THEFT OF PROPERTY', -96.799, 32.778),
  dallasPoint('dal-3', 5, 'BURGLARY OF VEHICLE', -96.795, 32.775),
  dallasPoint('dal-prev', 40, 'ROBBERY OF INDIVIDUAL', -96.798, 32.777),
  ...Array.from({ length: 6 }, (_, index) =>
    dallasPoint(`dal-outer-${index}`, 3 + index, 'THEFT OF PROPERTY', -96.775 + index * 0.0004, 32.7767),
  ),
];

const dcFeature = (
  id: number,
  daysAgo: number,
  offense: string,
  longitude: number,
  latitude: number,
  method = 'OTHERS',
) => ({
  attributes: {
    CCN: `DC-${id}`,
    OBJECTID: id,
    START_DATE: sourceDate(daysAgo, 17).epoch,
    REPORT_DAT: sourceDate(daysAgo, 18).epoch,
    OFFENSE: offense,
    METHOD: method,
    BLOCK: '100 BLOCK PENNSYLVANIA AVE NW',
    NEIGHBORHOOD_CLUSTER: 'Cluster 2',
    LATITUDE: latitude,
    LONGITUDE: longitude,
  },
});

/** DC settles two days, so the newest fixture rows sit three or more days back. */
export const dcFixture = [
  dcFeature(1, 3, 'ROBBERY', -77.0367, 38.8894, 'GUN'),
  dcFeature(2, 4, 'ASSAULT W/DANGEROUS WEAPON', -77.034, 38.891),
  dcFeature(3, 5, 'THEFT F/AUTO', -77.039, 38.887),
  dcFeature(4, 6, 'MOTOR VEHICLE THEFT', -77.032, 38.888),
  dcFeature(20, 37, 'ROBBERY', -77.036, 38.889),
  dcFeature(30, 4, 'THEFT/OTHER', -77.015, 38.89),
  dcFeature(31, 5, 'THEFT/OTHER', -77.014, 38.891),
  dcFeature(32, 6, 'ASSAULT W/DANGEROUS WEAPON', -77.013, 38.889),
  dcFeature(33, 7, 'THEFT/OTHER', -77.012, 38.892),
];

const adaptiveMetadata = (fields: string[]) => ({ columns: fields.map((fieldName) => ({ fieldName })) });

async function adaptiveSource(page: Page, datasetId: string, fields: string[], rows: unknown[] = []) {
  await page.route(`**/api/views/${datasetId}`, (route) => json(route, adaptiveMetadata(fields)));
  await page.route(`**/resource/${datasetId}.json?*`, socrataHandler(rows, rows.length > 0 ? sourceDate(0).timestamp : null));
}

/** Census TIGERweb answers for the places the browser suites visit outside the local feeds. */
const CENSUS_FIXTURES: Record<string, { place: [string, string] | null; countySubdivision: [string, string] }> = {
  '-74.0776,40.7282': { place: ['3436000', 'Jersey City city'], countySubdivision: ['3401736000', 'Jersey City city'] },
  '-97.5164,35.4676': { place: ['4055000', 'Oklahoma City city'], countySubdivision: ['4010992426', 'Oklahoma City Southwest CCD'] },
  '-118.1728,34.0239': { place: null, countySubdivision: ['0603793155', 'South Gate-East Los Angeles CCD'] },
};

function censusHandler(route: Route) {
  const url = new URL(route.request().url());
  const fixture = CENSUS_FIXTURES[url.searchParams.get('geometry') ?? ''];
  const area = url.pathname.endsWith('/MapServer/4/query') ? fixture?.place : fixture?.countySubdivision;
  return json(route, { features: area ? [{ attributes: { GEOID: area[0], NAME: area[1] } }] : [] });
}

export interface MockOptions {
  mode?: 'success' | 'error';
  /** Days the NYC feed lags behind today (NYPD publishes quarterly). */
  nycLagDays?: number;
  /** Row count the NYC count query reports; above the record budget it forces truncation. */
  nycReportedTotal?: number;
}

export async function mockOfficialSources(page: Page, options: MockOptions | 'success' | 'error' = {}) {
  const { mode = 'success', nycLagDays = 0, nycReportedTotal } = typeof options === 'string'
    ? { mode: options }
    : options;
  const today = sourceDate(0).timestamp;
  const nycRows = nycFixture(nycLagDays);

  await page.route('**/resource/5uac-w243.json?*', async (route) => {
    if (mode === 'error') {
      await route.fulfill({ status: 503, body: 'Service unavailable' });
      return;
    }
    await socrataHandler(nycRows, sourceDate(nycLagDays).timestamp, nycReportedTotal)(route);
  });
  await page.route('**/resource/ijzp-q8t2.json?*', socrataHandler(chicagoFixture, today));
  await page.route('**/resource/wg3w-h783.json?*', socrataHandler([], null));

  await adaptiveSource(page, 'k7nn-b2ep', [
    'caseno', 'uniquenibrno', 'date_occ', 'time_occ', 'area_name', 'nibr_description',
    'crime_against', 'premis_desc', 'hndrdth_loc_chk', 'hndrdth_lat', 'hndrdth_lon',
  ]);
  await adaptiveSource(page, 'tazs-3rd5', [
    'report_number', 'report_date_time', 'offense_id', 'offense_date', 'nibrs_group_a_b',
    'nibrs_crime_against_category', 'offense_sub_category', 'block_address', 'latitude',
    'longitude', 'precinct', 'neighborhood',
  ]);
  await adaptiveSource(page, 'qv6i-rri7', [
    'servnumid', 'incidentnum', 'date1', 'time1', 'nibrs_crime', 'nibrs_crime_category',
    'offincident', 'incident_address', 'division', 'geocoded_column',
  ], dallasFixture);

  for (const path of [
    'INCIDENTS_PART1_PART2/FeatureServer/0',
    'RMS_Crime_Incidents_2026/FeatureServer/0',
    'ODC_CRIME_OFFENSES_P/FeatureServer/324',
    'Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0',
  ]) {
    await page.route(`**/${path}/query?*`, arcgisHandler([], null));
  }
  await page.route('**/FEEDS/MPD/FeatureServer/41/query?*', arcgisHandler(dcFixture, Date.now()));

  await page.route('**/nominatim.openstreetmap.org/**', (route) => json(route, []));
  await page.route('**/tigerweb.geo.census.gov/**', censusHandler);
}
