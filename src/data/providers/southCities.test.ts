import { describe, expect, it, vi } from 'vitest';
import { normalizeCategory } from '../../domain/categories';
import { pointIsWithinBounds } from '../../domain/geo';
import type { IncidentProvider, IncidentQuery } from '../../types';
import { ARCGIS_MAX_PAGES, ARCGIS_PAGE_SIZE } from './arcgis';
import {
  ARCGIS_LAYER_CONTRACTS,
  DENVER_META,
  DETROIT_META,
  NASHVILLE_META,
  PHILADELPHIA_META,
  WASHINGTON_DC_META,
} from './arcgisCities';
import {
  CHICAGO_META,
  DALLAS_META,
  LOS_ANGELES_META,
  NEW_YORK_META,
  OAKLAND_META,
  SAN_FRANCISCO_META,
  SEATTLE_META,
} from './socrataCities';
import {
  arlingtonTxProvider,
  atlantaProvider,
  baltimoreProvider,
  batonRougeProvider,
  CHARLOTTE_FILTER,
  charlestonProvider,
  charlotteProvider,
  hundredBlock,
  jacksonvilleProvider,
  mapArlingtonTxFeature,
  mapAtlantaFeature,
  mapBaltimoreFeature,
  mapBatonRougeRow,
  mapCharlestonFeature,
  mapCharlotteFeature,
  mapJacksonvilleFeature,
  mapMemphisFeature,
  mapMontgomeryCountyMdRow,
  mapNewOrleansRow,
  mapOrlandoFeature,
  mapRaleighFeature,
  mapTampaFeature,
  memphisProvider,
  MONTGOMERY_COUNTY_MD_NON_CRIMINAL_CODES,
  montgomeryCountyMdProvider,
  NEW_ORLEANS_CRIME_CALL_TYPES,
  NEW_ORLEANS_FILTER,
  newOrleansProvider,
  ORLANDO_FILTER,
  ORLANDO_NON_CRIME_CASE_TYPES,
  orlandoProvider,
  RALEIGH_FILTER,
  raleighProvider,
  SOUTH_FEATURED_PLACES,
  SOUTH_JURISDICTIONS,
  SOUTH_PROVIDERS,
  tampaProvider,
} from './southCities';

const utc = (value: string) => Date.parse(`${value}Z`);

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

function query(provider: IncidentProvider, radiusMeters = 1000): IncidentQuery {
  return { center: provider.meta.center, radiusMeters, startEpochMs: day('2026-09-20'), endEpochMs: day('2026-10-20') };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Serves ArcGIS counts, features and newest-record statistics, recording every URL. */
function stubArcgis({ count = 0, features = [] as unknown[], latest = null as number | null } = {}) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    if (url.searchParams.get('returnCountOnly') === 'true') return jsonResponse({ count });
    if (url.searchParams.has('outStatistics')) return jsonResponse({ features: [{ attributes: { latest_record: latest } }] });
    return jsonResponse({ features });
  }));
  return urls;
}

/** Serves Socrata counts, rows and the newest-record aggregate, recording every URL. */
function stubSocrata({ rows = [] as unknown[], latest = null as string | null } = {}) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    const select = url.searchParams.get('$select') ?? '';
    if (select === 'count(*) AS total') return jsonResponse([{ total: String(rows.length) }]);
    if (select.startsWith('max(')) return jsonResponse([{ latest_record: latest }]);
    return jsonResponse(rows);
  }));
  return urls;
}

const pageUrl = (urls: URL[], key: string) => urls.find((url) => url.searchParams.has(key));

describe('hundredBlock', () => {
  it.each([
    ['1070 BOLTON RD NW · Bankhead', '1000 BLOCK BOLTON RD NW · Bankhead'],
    ['30 N PAYSON ST', '0 BLOCK N PAYSON ST'],
    ['1070A BOLTON RD', '1000 BLOCK BOLTON RD'],
    ['12-14 MAIN ST', '0 BLOCK MAIN ST'],
    ['3700 BLOCK OF NW 27TH AVE', '3700 BLOCK OF NW 27TH AVE'],
    ['100  BLOCK MAIN ST', '100  BLOCK MAIN ST'],
    ['100 BLK MARYLAND AVE', '100 BLK MARYLAND AVE'],
    ['15TH ST W, JACKSONVILLE', '15TH ST W, JACKSONVILLE'],
    ['MAIN ST & N 5TH ST', 'MAIN ST & N 5TH ST'],
  ])('generalizes %s', (value, expected) => {
    expect(hundredBlock(value)).toBe(expected);
  });
});

describe('Atlanta', () => {
  const base = {
    ReportNumber: '262921221-1',
    NibrsUcrCode: '23F',
    OBJECTID: 187995425,
    OccurredFromDate: utc('2026-10-19T03:30:00'),
    NIBRS_Bucket: 'Theft From Auto',
    NIBRS_Offense: 'Theft From Motor Vehicle',
    StreetAddress: '935 PEACHTREE ST NE',
    NhoodName: 'Midtown',
    Longitude: -84.383152,
    Latitude: 33.780456,
  };

  it('converts UTC to Eastern time, classifies on the offense and generalizes the exact address', () => {
    // Joined, the bucket and offense would read as "…Auto Theft…".
    expect(normalizeCategory(`${base.NIBRS_Bucket} ${base.NIBRS_Offense}`)).toBe('vehicle');
    expect(mapAtlantaFeature({ attributes: base })).toMatchObject({
      id: 'atlanta:262921221-1:23F',
      occurredAt: '2026-10-18T23:30:00',
      localHour: 23,
      category: 'theft',
      group: 'property',
      rawCategory: 'Theft From Auto',
      description: 'Theft From Motor Vehicle',
      locationLabel: '900 BLOCK PEACHTREE ST NE · Midtown',
      coordinates: [-84.383, 33.78],
      precision: 'approximate',
    });
  });

  it('falls back to the bucket and keeps one row per report and offense code', () => {
    expect(mapAtlantaFeature({
      attributes: { ...base, NIBRS_Offense: null, NIBRS_Bucket: 'Auto Theft', NibrsUcrCode: null, StreetAddress: null },
    })).toMatchObject({ id: 'atlanta:262921221-1', category: 'vehicle', description: 'Auto Theft', locationLabel: 'Midtown' });
  });

  it('rejects rows without a report number or coordinates', () => {
    expect(mapAtlantaFeature({ attributes: { ...base, ReportNumber: '' } })).toBeNull();
    expect(mapAtlantaFeature({ attributes: { ...base, Latitude: null } })).toBeNull();
  });
});

describe('Baltimore', () => {
  const base = {
    CCNumber: '261006724',
    CrimeCode: '13A',
    CrimeDateTime: utc('2026-10-19T03:40:00'),
    Description: 'AGG. ASSAULT',
    Location: '1123 NANTICOKE ST',
    Neighborhood: 'WASHINGTON VILLAGE/PIGTOWN',
    Latitude: '39.279851',
    Longitude: '-76.632263',
    Gender: 'M',
  };

  it('reads numeric-text coordinates, converts UTC and generalizes the block', () => {
    expect(mapBaltimoreFeature({ attributes: base })).toMatchObject({
      id: 'baltimore:261006724:13A',
      occurredAt: '2026-10-18T23:40:00',
      localHour: 23,
      category: 'assault',
      rawCategory: '13A',
      description: 'AGG. ASSAULT',
      locationLabel: '1100 BLOCK NANTICOKE ST · WASHINGTON VILLAGE/PIGTOWN',
      coordinates: [-76.632, 39.28],
      precision: 'approximate',
    });
  });

  it('rejects rows with blank coordinates', () => {
    expect(mapBaltimoreFeature({ attributes: { ...base, Latitude: '' } })).toBeNull();
  });

  it('counts one row per victim once', async () => {
    stubArcgis({ features: [{ attributes: base }, { attributes: { ...base, Gender: 'F' } }] });
    const batch = await baltimoreProvider.fetchIncidents({
      ...query(baltimoreProvider),
      startEpochMs: day('2026-10-01'),
      endEpochMs: day('2026-10-20'),
    });
    expect(batch.incidents.map((incident) => incident.id)).toEqual(['baltimore:261006724:13A']);
  });
});

describe('Charlotte', () => {
  const base = {
    INCIDENT_REPORT_ID: '20261016-1018-01',
    DATE_INCIDENT_BEGAN: utc('2026-10-16T04:00:00'),
    HIGHEST_NIBRS_CODE: '23C',
    HIGHEST_NIBRS_DESCRIPTION: 'Shoplifting',
    LOCATION: '200 N GRAHAM ST',
    CMPD_PATROL_DIVISION: 'Central',
    LATITUDE_PUBLIC: 35.232118,
    LONGITUDE_PUBLIC: -80.84488,
  };

  it('keeps the local date of the UTC midnight instant and leaves the hour unknown', () => {
    expect(mapCharlotteFeature({ attributes: base })).toMatchObject({
      id: 'charlotte:20261016-1018-01',
      occurredAt: '2026-10-16T00:00:00',
      occurredAtEpochMs: day('2026-10-16'),
      localHour: null,
      category: 'theft',
      locationLabel: '200 N GRAHAM ST · Central',
      coordinates: [-80.84488, 35.232118],
      precision: 'block',
    });
    // Eastern Standard Time: local midnight is 05:00 UTC.
    expect(mapCharlotteFeature({ attributes: { ...base, DATE_INCIDENT_BEGAN: utc('2026-01-15T05:00:00') } }))
      .toMatchObject({ occurredAt: '2026-01-15T00:00:00', localHour: null });
  });

  it('rejects rows without public coordinates', () => {
    expect(mapCharlotteFeature({ attributes: { ...base, LATITUDE_PUBLIC: null } })).toBeNull();
  });

  it('reads the MapServer newest-record statistic as local midnight', async () => {
    charlotteProvider.resetCache?.();
    const urls = stubArcgis({ latest: utc('2026-10-19T00:00:00') });
    await expect(charlotteProvider.fetchLatestRecordEpoch()).resolves.toBe(day('2026-10-19'));
    expect(urls[0]?.searchParams.get('where')).toContain(`(${CHARLOTTE_FILTER})`);
  });
});

describe('Jacksonville', () => {
  const feature = {
    attributes: {
      EsriPkey: '7724839.202600627036.23F',
      IncidentDateTime: utc('2026-10-21T03:35:00'),
      nibrsDescription: 'THEFT FROM MOTOR VEHICLE',
      Address: ' 1752 EAVERSON ST',
    },
    geometry: { x: -81.6728172912, y: 30.346938615339994 },
  };

  it('reads point geometry, converts UTC and classifies the offense once', () => {
    // Category and description are the same; joined they read "…MOTOR VEHICLE THEFT…".
    expect(normalizeCategory('THEFT FROM MOTOR VEHICLE THEFT FROM MOTOR VEHICLE')).toBe('vehicle');
    expect(mapJacksonvilleFeature(feature)).toMatchObject({
      id: 'jacksonville:7724839.202600627036.23F',
      occurredAt: '2026-10-20T23:35:00',
      localHour: 23,
      category: 'theft',
      description: 'THEFT FROM MOTOR VEHICLE',
      locationLabel: '1700 BLOCK EAVERSON ST',
      coordinates: [-81.673, 30.347],
      precision: 'approximate',
    });
  });

  it('rejects features without geometry', () => {
    expect(mapJacksonvilleFeature({ attributes: feature.attributes, geometry: null })).toBeNull();
  });
});

describe('Memphis', () => {
  const base = {
    Crime_ID: '2610023478ME',
    UCR_Incident_Code: '23D',
    Offense_Datetime: utc('2026-10-11T04:10:00'),
    UCR_Category: 'LARCENY/THEFT',
    UCR_Description: 'THEFT FROM A BUILDING',
    Street_Address: '100 BICKFORD AVE',
    Precinct: 'NORTH MAIN',
    Latitude: 35.165,
    Longitude: -90.043,
  };

  it('converts UTC to Central time and keeps one row per offense code', () => {
    expect(mapMemphisFeature({ attributes: base })).toMatchObject({
      id: 'memphis:2610023478ME:23D',
      occurredAt: '2026-10-10T23:10:00',
      localHour: 23,
      category: 'theft',
      locationLabel: '100 BICKFORD AVE · NORTH MAIN',
      coordinates: [-90.043, 35.165],
      precision: 'approximate',
    });
    expect(mapMemphisFeature({ attributes: { ...base, UCR_Incident_Code: null } })?.id).toBe('memphis:2610023478ME');
  });

  it('rejects rows without coordinates', () => {
    expect(mapMemphisFeature({ attributes: { ...base, Latitude: null } })).toBeNull();
  });
});

describe('Raleigh', () => {
  const base = {
    case_number: 'P26056176',
    crime_code: '70E',
    GlobalID: '82588ccd-9f2d-4501-80da-f9ba5843e465',
    reported_date: utc('2026-10-21T03:42:00'),
    reported_year: 2026,
    reported_month: 10,
    reported_day: 21,
    reported_hour: 3,
    crime_category: 'DISORDERLY CONDUCT',
    crime_description: 'Disorderly Conduct/Resist-Delay-Obstruct Officer',
    reported_block_address: '3300 BLOCK HEWBERRY LN',
    district: 'Southeast',
    latitude: 35.7548692450399,
    longitude: -78.58867589924276,
  };

  it('builds local report time from the local integer fields', () => {
    expect(mapRaleighFeature({ attributes: base })).toMatchObject({
      id: 'raleigh:P26056176:70E',
      occurredAt: '2026-10-21T03:42:00',
      localHour: 3,
      category: 'other',
      locationLabel: '3300 BLOCK HEWBERRY LN · Southeast',
      coordinates: [-78.589, 35.755],
      precision: 'approximate',
    });
  });

  it('corrects older rows whose report epoch is a true UTC instant', () => {
    expect(mapRaleighFeature({
      attributes: {
        ...base,
        reported_date: utc('2026-01-15T13:17:00'),
        reported_year: 2026,
        reported_month: 1,
        reported_day: 15,
        reported_hour: 8,
      },
    })).toMatchObject({ occurredAt: '2026-01-15T08:17:00', localHour: 8 });
  });

  it('falls back to the global id and rejects unusable times and redacted locations', () => {
    expect(mapRaleighFeature({ attributes: { ...base, case_number: '' } })?.id)
      .toBe('raleigh:82588ccd-9f2d-4501-80da-f9ba5843e465');
    expect(mapRaleighFeature({ attributes: { ...base, case_number: '', GlobalID: null } })).toBeNull();
    expect(mapRaleighFeature({ attributes: { ...base, reported_hour: null } })).toBeNull();
    expect(mapRaleighFeature({ attributes: { ...base, reported_month: 13 } })).toBeNull();
    expect(mapRaleighFeature({ attributes: { ...base, latitude: 0, longitude: 0 } })).toBeNull();
  });
});

describe('Tampa', () => {
  const base = {
    offenseid: '2026611209',
    sequence: 1,
    occurfrdate: utc('2026-10-17T04:00:00'),
    nibrsoffense: 'Motor Vehicle Theft',
    nibrsdesc: 'Motor Vehicle Theft',
    fulladdr: 'N 15th St & E 5th Ave',
    neighborhood: 'Historic Ybor',
    x: -82.4429666,
    y: 27.95883682,
  };

  it('keeps the local date and leaves the hour unknown', () => {
    expect(mapTampaFeature({ attributes: base })).toMatchObject({
      id: 'tampa:2026611209:1',
      occurredAt: '2026-10-17T00:00:00',
      localHour: null,
      category: 'vehicle',
      locationLabel: 'N 15th St & E 5th Ave · Historic Ybor',
      coordinates: [-82.4429666, 27.95883682],
      precision: 'intersection',
    });
  });

  it('rejects rows without coordinates', () => {
    expect(mapTampaFeature({ attributes: { ...base, x: null } })).toBeNull();
  });
});

describe('Arlington, Texas', () => {
  const feature = {
    attributes: {
      CaseNumber: '2026-90002376',
      CrimeCode: '26B  ',
      Description: 'FRAUD; CREDIT CARD/ATM FRAUD',
      DateOfOccurrence: utc('2026-10-20T15:05:00'),
      Beat: '260',
      District: 'NORTH',
    },
    geometry: { x: -97.10890293667337, y: 32.73938569731882 },
  };

  it('converts the UTC feature epoch to Central time and labels the beat', () => {
    expect(mapArlingtonTxFeature(feature)).toMatchObject({
      id: 'arlington-tx:2026-90002376:26B',
      occurredAt: '2026-10-20T10:05:00',
      localHour: 10,
      rawCategory: '26B',
      category: 'other',
      locationLabel: 'Beat 260 · NORTH district',
      coordinates: [-97.109, 32.739],
      precision: 'approximate',
    });
    // Central Standard Time is six hours behind UTC.
    expect(mapArlingtonTxFeature({ ...feature, attributes: { ...feature.attributes, DateOfOccurrence: utc('2026-01-10T06:30:00') } }))
      .toMatchObject({ occurredAt: '2026-01-10T00:30:00', localHour: 0 });
  });

  it('labels whatever area is published', () => {
    const label = (Beat: string | null, District: string | null) => mapArlingtonTxFeature({
      ...feature,
      attributes: { ...feature.attributes, Beat, District },
    })?.locationLabel;
    expect(label('260', null)).toBe('Beat 260');
    expect(label(null, 'EAST')).toBe('EAST district');
    expect(label(null, null)).toBe('Approximate public location');
  });

  it('rejects features without geometry', () => {
    expect(mapArlingtonTxFeature({ attributes: feature.attributes })).toBeNull();
  });

  it('reads the MapServer newest-record statistic as local wall-clock time', async () => {
    arlingtonTxProvider.resetCache?.();
    stubArcgis({ latest: utc('2026-10-20T10:05:00') });
    await expect(arlingtonTxProvider.fetchLatestRecordEpoch()).resolves.toBe(utc('2026-10-20T10:05:00'));
  });
});

describe('Orlando', () => {
  const feature = {
    attributes: {
      CaseNumber: '2026-00377131',
      CaseDate: utc('2026-10-16T23:42:55'),
      GISCaseType: 'Motor Vehicle Theft',
      CaseType: 'Motor Vehicle Theft',
      NeighborhoodName: 'Central Business District',
    },
    geometry: { x: -81.38068, y: 28.54142 },
  };

  it('keeps wall-clock epochs and rounds the exact point', () => {
    expect(mapOrlandoFeature(feature)).toMatchObject({
      id: 'orlando:2026-00377131',
      occurredAt: '2026-10-16T23:42:55',
      localHour: 23,
      category: 'vehicle',
      locationLabel: 'Central Business District',
      coordinates: [-81.381, 28.541],
      precision: 'approximate',
    });
  });

  it('rejects cases without a case number', () => {
    expect(mapOrlandoFeature({ ...feature, attributes: { ...feature.attributes, CaseNumber: null } })).toBeNull();
  });
});

describe('Charleston', () => {
  const feature = {
    attributes: {
      OCA: '2616624',
      ucr_code: '13A ',
      DateOccurred: utc('2026-10-05T00:00:00'),
      IncidentHour: 20,
      IncidentCategory: 'Violent',
      ChargeDescription: 'AGGRAVATED ASSAULT / FIREARM',
      StreetAddress: 'XX CONROY ST',
    },
    geometry: { x: -79.94612, y: 32.80654 },
  };

  it('adds the separately published local hour to the local date', () => {
    expect(mapCharlestonFeature(feature)).toMatchObject({
      id: 'charleston:2616624:13A',
      occurredAt: '2026-10-05T20:00:00',
      occurredAtEpochMs: utc('2026-10-05T20:00:00'),
      localHour: 20,
      category: 'assault',
      locationLabel: 'XX CONROY ST',
      coordinates: [-79.946, 32.807],
      precision: 'approximate',
    });
  });

  it('classifies drug charges on the charge, not the shared drug and weapon category', () => {
    expect(mapCharlestonFeature({
      ...feature,
      attributes: { ...feature.attributes, IncidentCategory: 'Drug and Weapon Law', ChargeDescription: 'DRUG / NARCOTICS VIOLATION' },
    })).toMatchObject({ category: 'other', group: 'other' });
  });

  it.each([null, 24, -1, 2.5])('leaves the hour unknown when IncidentHour is %s', (IncidentHour) => {
    expect(mapCharlestonFeature({ ...feature, attributes: { ...feature.attributes, IncidentHour } }))
      .toMatchObject({ occurredAt: '2026-10-05T00:00:00', localHour: null });
  });

  it('rejects features without geometry', () => {
    expect(mapCharlestonFeature({ attributes: feature.attributes })).toBeNull();
  });
});

describe('Montgomery County, Maryland', () => {
  const base = {
    incident_id: '201595214',
    offence_code: '5707',
    start_date: '2026-10-20T17:28:00.000',
    crimename2: 'Trespass of Real Property',
    crimename3: 'TRESPASSING',
    location: '100 BLK  MARYLAND AVE',
    city: 'ROCKVILLE',
    geolocation: { latitude: '39.0827', longitude: '-77.151', human_address: '{}' },
  };

  it('maps a floating local timestamp and the published block point', () => {
    expect(mapMontgomeryCountyMdRow(base)).toMatchObject({
      id: 'montgomery-county-md:201595214:5707',
      occurredAt: '2026-10-20T17:28:00',
      localHour: 17,
      category: 'other',
      locationLabel: '100 BLK MARYLAND AVE · ROCKVILLE',
      coordinates: [-77.151, 39.0827],
      precision: 'block',
    });
  });

  it('classifies on the NIBRS offense rather than the local description', () => {
    expect(normalizeCategory('Theft From Motor Vehicle LARCENY - FROM AUTO')).toBe('vehicle');
    expect(mapMontgomeryCountyMdRow({ ...base, crimename2: 'Theft From Motor Vehicle', crimename3: 'LARCENY - FROM AUTO' }))
      .toMatchObject({ category: 'theft' });
  });

  it('rejects redacted 0.0 locations', () => {
    expect(mapMontgomeryCountyMdRow({ ...base, geolocation: { latitude: '0.0', longitude: '0.0' } })).toBeNull();
  });
});

describe('New Orleans', () => {
  const base = {
    nopd_item: 'J2092626',
    timecreate: '2026-10-20T23:03:59.210000',
    typetext: 'SIMPLE BATTERY',
    dispositiontext: 'REPORT TO FOLLOW',
    block_address: '014XX Tulane Av',
    location: { type: 'Point', coordinates: [-90.07644004, 29.9555838] },
  };

  it('maps a call for service with its local creation time', () => {
    expect(mapNewOrleansRow(base)).toMatchObject({
      id: 'new-orleans:J2092626',
      occurredAt: '2026-10-20T23:03:59',
      localHour: 23,
      category: 'assault',
      rawCategory: 'SIMPLE BATTERY',
      description: 'Call for service · REPORT TO FOLLOW',
      locationLabel: '014XX Tulane Av',
      coordinates: [-90.07644004, 29.9555838],
      precision: 'block',
    });
    expect(mapNewOrleansRow({ ...base, dispositiontext: null })?.description).toBe('Call for service');
  });

  it('rejects calls without a location', () => {
    expect(mapNewOrleansRow({ ...base, location: null })).toBeNull();
  });
});

describe('Baton Rouge', () => {
  const base = {
    incident_number: '26-196429',
    charge_id: '6016871',
    charge_date: '2026-10-05T23:27:00.000',
    statute_category: 'THEFT',
    offense_description: 'ALL OTHER LARCENY',
    street: '5053 ANNETTE ST',
    neighborhood: 'BROOKSTOWN',
    latitude: '30.496443',
    longitude: '-91.134473',
  };

  it('rounds the exact point and generalizes the street address', () => {
    expect(mapBatonRougeRow(base)).toMatchObject({
      id: 'baton-rouge:26-196429:6016871',
      occurredAt: '2026-10-05T23:27:00',
      localHour: 23,
      category: 'theft',
      description: 'ALL OTHER LARCENY',
      locationLabel: '5000 BLOCK ANNETTE ST · BROOKSTOWN',
      coordinates: [-91.134, 30.496],
      precision: 'approximate',
    });
  });

  it('classifies on the NIBRS offense, falling back to the statute category', () => {
    expect(mapBatonRougeRow({ ...base, statute_category: 'BATTERY', offense_description: 'SIMPLE ASSAULT' })?.category).toBe('assault');
    expect(mapBatonRougeRow({ ...base, statute_category: 'NARCOTICS', offense_description: null }))
      .toMatchObject({ category: 'other', description: 'NARCOTICS' });
  });

  it('rejects charges without a published location', () => {
    expect(mapBatonRougeRow({ ...base, latitude: null, longitude: null })).toBeNull();
  });
});

describe('ArcGIS wiring', () => {
  const expected: Array<[IncidentProvider, string, string, string[], string | null, boolean, number]> = [
    [atlantaProvider, 'OccurredFromDate', 'OBJECTID', ['ReportNumber', 'NibrsUcrCode', 'NIBRS_Bucket', 'NIBRS_Offense', 'StreetAddress', 'Longitude', 'Latitude'], null, false, 2000],
    [baltimoreProvider, 'CrimeDateTime', 'RowID', ['CCNumber', 'CrimeCode', 'Description', 'Location', 'Longitude', 'Latitude'], null, false, 2000],
    [charlotteProvider, 'DATE_INCIDENT_BEGAN', 'OBJECTID', ['INCIDENT_REPORT_ID', 'HIGHEST_NIBRS_CODE', 'LOCATION', 'LONGITUDE_PUBLIC', 'LATITUDE_PUBLIC'], CHARLOTTE_FILTER, false, 2500],
    [jacksonvilleProvider, 'IncidentDateTime', 'OBJECTID', ['EsriPkey', 'nibrsDescription', 'Address'], null, true, 2000],
    [memphisProvider, 'Offense_Datetime', 'ObjectId', ['Crime_ID', 'UCR_Incident_Code', 'UCR_Category', 'Street_Address', 'Longitude', 'Latitude'], null, false, 1000],
    [raleighProvider, 'reported_date', 'OBJECTID', ['case_number', 'crime_code', 'GlobalID', 'reported_year', 'reported_month', 'reported_day', 'reported_hour', 'longitude', 'latitude'], RALEIGH_FILTER, false, 2000],
    [tampaProvider, 'occurfrdate', 'OBJECTID', ['offenseid', 'sequence', 'nibrsoffense', 'fulladdr', 'x', 'y'], null, false, 2000],
    [arlingtonTxProvider, 'DateOfOccurrence', 'OBJECTID', ['CaseNumber', 'CrimeCode', 'Description', 'Beat', 'District'], null, true, 2000],
    [orlandoProvider, 'CaseDate', 'OBJECTID', ['CaseNumber', 'GISCaseType', 'CaseType', 'NeighborhoodName'], ORLANDO_FILTER, true, 2000],
    [charlestonProvider, 'DateOccurred', 'OBJECTID', ['OCA', 'ucr_code', 'IncidentCategory', 'ChargeDescription', 'IncidentHour'], null, true, 2000],
  ];

  it.each(expected)('queries %# with its date, filter, fields and geometry', async (provider, dateField, objectIdField, fields, filter, geometry, pageSize) => {
    const urls = stubArcgis();
    await provider.fetchIncidents(query(provider));
    const page = pageUrl(urls, 'outFields');
    expect(`${page?.origin}${page?.pathname}`).toBe(`${provider.meta.endpoint}/query`);
    const where = page?.searchParams.get('where') ?? '';
    expect(where).toContain(`${dateField} >= TIMESTAMP`);
    if (filter) expect(where).toContain(` AND (${filter})`);
    else expect(where).not.toContain('(');
    expect(page?.searchParams.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(page?.searchParams.get('returnGeometry')).toBe(String(geometry));
    expect(page?.searchParams.get('outSR')).toBe(geometry ? '4326' : null);
    expect(page?.searchParams.get('orderByFields')).toBe(`${dateField} DESC,${objectIdField} ASC`);
    expect(page?.searchParams.get('resultRecordCount')).toBe(String(pageSize));
    const outFields = page?.searchParams.get('outFields')?.split(',') ?? [];
    expect(outFields).toEqual(expect.arrayContaining([dateField, objectIdField, ...fields]));
    expect(new Set(outFields).size).toBe(outFields.length);
    expect(outFields).not.toContain('*');
  });

  it('registers live layer contracts with the reviewed names and page sizes', () => {
    const contracts = Object.fromEntries(ARCGIS_LAYER_CONTRACTS.map((contract) => [contract.meta.id, contract]));
    expect(Object.fromEntries(expected.map(([provider]) => [
      provider.meta.id,
      [contracts[provider.meta.id]?.layerName, contracts[provider.meta.id]?.pageSize],
    ]))).toEqual({
      atlanta: ['AxonCrimeData_XYTable', 2000],
      baltimore: ['NIBRS Group A Crime Data', 2000],
      charlotte: ['CMPD Incidents', 2500],
      jacksonville: ['Incidents', 2000],
      memphis: ['MPD_Public_Safety_Incidents', 1000],
      raleigh: ['Incidents', 2000],
      tampa: ['Crimes', 2000],
      'arlington-tx': ['Crime Data Rolling Day', 2000],
      orlando: ['LERMSCases4Dashboard', 2000],
      charleston: ['PDI_Reported_Incidents', 2000],
    });
  });

  it.each([
    [memphisProvider, 1000, 10],
    [charlotteProvider, 2500, 4],
  ])('pages %# within the shared record budget', async (provider, pageSize, pages) => {
    const urls = stubArcgis({ count: 25_000 });
    const batch = await provider.fetchIncidents(query(provider));
    const requested = urls.filter((url) => url.searchParams.has('resultRecordCount'));
    expect(requested.map((url) => Number(url.searchParams.get('resultOffset')))).toEqual(
      Array.from({ length: pages }, (_, index) => index * pageSize),
    );
    expect(batch.recordLimit).toBe(ARCGIS_PAGE_SIZE * ARCGIS_MAX_PAGES);
    expect(batch.truncated).toBe(true);
  });

  it('keeps the Orlando query under the server\'s 2,048-character URL limit', async () => {
    const urls = stubArcgis();
    await orlandoProvider.fetchIncidents(query(orlandoProvider, 3000));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.toString().length).toBeLessThan(2048);
  });

  it('excludes reviewed non-crime case types and non-criminal report codes', () => {
    expect(ORLANDO_FILTER).toMatch(/^GISCaseType NOT IN \('Information Report', /);
    expect(ORLANDO_NON_CRIME_CASE_TYPES).not.toContain('Petit Theft');
    expect(CHARLOTTE_FILTER).toContain("<> '09C'");
    expect(RALEIGH_FILTER).toContain("'MISCELLANEOUS'");
  });
});

describe('Socrata wiring', () => {
  it('queries Montgomery County by its point column and excludes non-criminal codes', async () => {
    const urls = stubSocrata();
    await montgomeryCountyMdProvider.fetchIncidents(query(montgomeryCountyMdProvider));
    const page = pageUrl(urls, '$order');
    expect(`${page?.origin}${page?.pathname}`).toBe(montgomeryCountyMdProvider.meta.endpoint);
    const where = page?.searchParams.get('$where') ?? '';
    expect(where).toContain("start_date >= '2026-09-20'");
    expect(where).toContain('within_box(geolocation, ');
    expect(where).toContain(`(offence_code NOT IN ('${MONTGOMERY_COUNTY_MD_NON_CRIMINAL_CODES.join("', '")}'))`);
    expect(page?.searchParams.get('$select')?.split(',')).toEqual(expect.arrayContaining([
      'incident_id', 'offence_code', 'start_date', 'crimename2', 'crimename3', 'location', 'city', 'geolocation',
    ]));
    expect(page?.searchParams.get('$select')).not.toContain('latitude');
    expect(page?.searchParams.get('$order')).toBe('start_date DESC, :id');
  });

  it('limits New Orleans calls to reviewed crime types and real dispositions', async () => {
    const urls = stubSocrata({
      rows: [{
        nopd_item: 'J2092626',
        timecreate: '2026-10-10T23:03:59.210000',
        typetext: 'THEFT',
        location: { type: 'Point', coordinates: newOrleansProvider.meta.center },
      }],
    });
    const batch = await newOrleansProvider.fetchIncidents(query(newOrleansProvider));
    expect(batch.incidents.map((incident) => incident.id)).toEqual(['new-orleans:J2092626']);
    const where = pageUrl(urls, '$order')?.searchParams.get('$where') ?? '';
    expect(where).toContain('within_box(location, ');
    expect(where).toContain(` AND (${NEW_ORLEANS_FILTER})`);
    expect(where).toContain("(disposition IS NULL OR disposition NOT IN ('DUP', 'VOI', 'UNF', 'CBC'))");
    expect(where).toContain("'SIMPLE BURGLARY VEHICLE'");
    expect(NEW_ORLEANS_CRIME_CALL_TYPES).not.toContain('BURGLAR ALARM, SILENT');
    expect(NEW_ORLEANS_CRIME_CALL_TYPES).not.toContain('COMPLAINT OTHER');
  });

  it('applies the New Orleans allowlist to the newest-record lookup', async () => {
    newOrleansProvider.resetCache?.();
    const urls = stubSocrata({ latest: '2026-10-20T23:56:41.637000' });
    await expect(newOrleansProvider.fetchLatestRecordEpoch()).resolves.toBe(utc('2026-10-20T23:56:41.637'));
    expect(urls[0]?.searchParams.get('$where')).toContain(`(${NEW_ORLEANS_FILTER})`);
  });

  it('queries Baton Rouge by numeric coordinates and only NIBRS offenses', async () => {
    const urls = stubSocrata();
    await batonRougeProvider.fetchIncidents(query(batonRougeProvider));
    const where = pageUrl(urls, '$order')?.searchParams.get('$where') ?? '';
    expect(where).toMatch(/latitude >= 30\.\d+ AND latitude <= 30\.\d+ AND longitude >= -91\.\d+/);
    expect(where).toContain(' AND (nibrs_code IS NOT NULL)');
  });
});

describe('southern registry exports', () => {
  const metas = SOUTH_PROVIDERS.map((provider) => provider.meta);
  const firstRelease = [
    NEW_YORK_META, WASHINGTON_DC_META, PHILADELPHIA_META, CHICAGO_META, DETROIT_META, NASHVILLE_META, DALLAS_META,
    DENVER_META, LOS_ANGELES_META, SAN_FRANCISCO_META, OAKLAND_META, SEATTLE_META,
  ];

  it('orders unique kebab-case providers east to west', () => {
    const ids = metas.map((meta) => meta.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    const longitudes = metas.map((meta) => meta.center[0]);
    expect(longitudes).toEqual([...longitudes].sort((a, b) => b - a));
  });

  it('declares complete, reviewed metadata', () => {
    for (const meta of metas) {
      expect(meta.label, meta.id).toMatch(new RegExp(`^${meta.city}, [A-Z][a-z]+(?: [A-Z][a-z]+)*$`));
      expect(meta.state, meta.id).toMatch(/^[A-Z]{2}$/);
      expect(meta.timeZone, meta.id).toMatch(/^America\/(New_York|Chicago)$/);
      expect(meta.lastVerified, meta.id).toBe('2026-10-21');
      expect(Number.isInteger(meta.settlingDays) && meta.settlingDays >= 0 && meta.settlingDays < 22, meta.id).toBe(true);
      expect(pointIsWithinBounds(meta.center, meta.bounds), meta.id).toBe(true);
      for (const text of [meta.agency, meta.datasetName, meta.cadence, meta.delayNote, meta.precisionNote, meta.coverageNote]) {
        expect(text.length, meta.id).toBeGreaterThan(3);
      }
    }
  });

  it('keeps every center out of every other provider\'s bounds', () => {
    const all = [...firstRelease, ...metas];
    for (const meta of all) {
      const overlapping = all.filter((other) => other.id !== meta.id && pointIsWithinBounds(meta.center, other.bounds));
      expect(overlapping.map((other) => other.id), meta.id).toEqual([]);
    }
  });

  it('offers one featured place per provider, inside its bounds, in the same order', () => {
    expect(SOUTH_FEATURED_PLACES).toHaveLength(SOUTH_PROVIDERS.length);
    SOUTH_FEATURED_PLACES.forEach((place, index) => {
      const meta = metas[index]!;
      expect(place.detail).toBe(meta.label);
      expect(pointIsWithinBounds(place.coordinates, meta.bounds), place.label).toBe(true);
    });
    expect(new Set(SOUTH_FEATURED_PLACES.map((place) => place.label)).size).toBe(SOUTH_FEATURED_PLACES.length);
  });

  it('names a Census jurisdiction for every provider', () => {
    expect(Object.keys(SOUTH_JURISDICTIONS).sort()).toEqual(metas.map((meta) => meta.id).sort());
    for (const references of Object.values(SOUTH_JURISDICTIONS)) {
      for (const reference of [references].flat()) expect(reference).toMatch(/^(?:\d{7}|county:\d{5}|cdp:\d{7})$/);
    }
    expect(SOUTH_JURISDICTIONS['montgomery-county-md']).toBe('county:24031');
    expect(SOUTH_JURISDICTIONS.jacksonville).toEqual(['1235000', '1203250']);
  });
});
