import { describe, expect, it, vi } from 'vitest';
import type { IncidentQuery } from '../../types';
import {
  chicagoProvider,
  dallasProvider,
  generalizedDallasAddress,
  localClock,
  localTimestamp,
  losAngelesProvider,
  mapChicagoRow,
  mapDallasRow,
  mapLosAngelesRow,
  mapNewYorkRow,
  mapSanFranciscoRow,
  mapSeattleRow,
  newYorkProvider,
  sanFranciscoProvider,
  seattleProvider,
} from './socrataCities';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const metadata = (fieldNames: string[]) => ({ columns: fieldNames.map((fieldName) => ({ fieldName })) });

/** Serves dataset metadata, an empty count and empty rows, recording every URL. */
function stubSocrata(columns: string[] = []) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    if (url.pathname.startsWith('/api/views/')) return jsonResponse(metadata(columns));
    if (url.searchParams.get('$select') === 'count(*) AS total') return jsonResponse([{ total: '0' }]);
    return jsonResponse([]);
  }));
  return urls;
}

const pageWhere = (urls: URL[]) => urls.find((url) => url.pathname.endsWith('.json') && url.searchParams.has('$order'))
  ?.searchParams.get('$where') ?? '';

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

function query(center: readonly [number, number]): IncidentQuery {
  return { center, radiusMeters: 3000, startEpochMs: day('2026-09-20'), endEpochMs: day('2026-10-20') };
}

describe('localClock', () => {
  it.each([
    ['2315', '23:15:00'],
    [2315, '23:15:00'],
    ['130', '01:30:00'],
    [5, '00:05:00'],
    ['0000', '00:00:00'],
    ['1:10', '01:10:00'],
    [' 01:10:59 ', '01:10:00'],
    [2315.9, '23:15:00'],
  ] as const)('reads %j as %s', (time, expected) => {
    expect(localClock(time)).toBe(expected);
  });

  it.each(['2400', '1260', '24:00', '12:60', '12345', '', '  ', 'abc', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}])(
    'rejects unusable time %j',
    (time) => {
      expect(localClock(time)).toBeNull();
    },
  );
});

describe('localTimestamp', () => {
  it.each([
    ['2315', '2026-08-10T23:15:00'],
    [2315, '2026-08-10T23:15:00'],
    ['130', '2026-08-10T01:30:00'],
    ['5', '2026-08-10T00:05:00'],
    [5, '2026-08-10T00:05:00'],
    ['0000', '2026-08-10T00:00:00'],
    ['01:10', '2026-08-10T01:10:00'],
    ['1:10', '2026-08-10T01:10:00'],
    [' 01:10:59 ', '2026-08-10T01:10:00'],
    [2315.9, '2026-08-10T23:15:00'],
  ] as const)('joins LAPD/Dallas time %j', (time, expected) => {
    expect(localTimestamp('2026-08-10T00:00:00.000', time)).toBe(expected);
  });

  it.each(['2400', '1260', '24:00', '12345', '', 'abc', null, undefined, Number.NaN, {}])(
    'falls back to midnight for unusable time %j',
    (time) => {
      expect(localTimestamp('2026-08-10 00:00:00.0000000', time)).toBe('2026-08-10T00:00:00');
    },
  );
});

describe('New York City', () => {
  it('combines date and time fields and classifies grand larceny auto', () => {
    expect(mapNewYorkRow({
      cmplnt_num: 'NY-1',
      cmplnt_fr_dt: '2026-08-12T00:00:00.000',
      cmplnt_fr_tm: '01:05:00',
      ofns_desc: 'GRAND LARCENY OF MOTOR VEHICLE',
      pd_desc: 'AUTO THEFT',
      law_cat_cd: 'FELONY',
      loc_of_occur_desc: 'FRONT OF',
      prem_typ_desc: 'STREET',
      boro_nm: 'MANHATTAN',
      latitude: '40.758',
      longitude: '-73.9855',
    })).toMatchObject({
      id: 'new-york:NY-1',
      category: 'vehicle',
      group: 'vehicle',
      localHour: 1,
      occurredAt: '2026-08-12T01:05:00',
      occurredAtEpochMs: Date.parse('2026-08-12T01:05:00Z'),
      description: 'AUTO THEFT · FELONY',
      locationLabel: 'FRONT OF · STREET · MANHATTAN',
      precision: 'block',
      coordinates: [-73.9855, 40.758],
    });
  });

  it('classifies from offense and PD description but not the law class', () => {
    expect(mapNewYorkRow({
      cmplnt_num: 'NY-2',
      cmplnt_fr_dt: '2026-08-12T00:00:00.000',
      ofns_desc: 'MISCELLANEOUS PENAL LAW',
      pd_desc: 'WEAPONS POSSESSION 3',
      law_cat_cd: 'FELONY',
      latitude: '40.758',
      longitude: '-73.9855',
    })).toMatchObject({ category: 'weapons' });
  });

  it('keeps a midnight timestamp but no hour when the complaint time is missing or unreadable', () => {
    for (const time of [undefined, '', '(null)', '25:00:00']) {
      expect(mapNewYorkRow({
        cmplnt_num: 'NY-3',
        cmplnt_fr_dt: '2026-08-12T00:00:00.000',
        ...(time === undefined ? {} : { cmplnt_fr_tm: time }),
        ofns_desc: 'PETIT LARCENY',
        latitude: '40.758',
        longitude: '-73.9855',
      })).toMatchObject({
        occurredAt: '2026-08-12T00:00:00',
        occurredAtEpochMs: Date.parse('2026-08-12T00:00:00Z'),
        localHour: null,
      });
    }
  });

  it('keeps a real midnight complaint time', () => {
    expect(mapNewYorkRow({
      cmplnt_num: 'NY-4',
      cmplnt_fr_dt: '2026-08-12T00:00:00.000',
      cmplnt_fr_tm: '00:00:00',
      latitude: '40.758',
      longitude: '-73.9855',
    })).toMatchObject({ occurredAt: '2026-08-12T00:00:00', localHour: 0 });
  });

  it('uses fallbacks and drops unusable rows', () => {
    const minimal = mapNewYorkRow({ cmplnt_num: 'fallback', cmplnt_fr_dt: '2026-08-10T00:00:00', latitude: '40.7', longitude: '-74' });
    expect(minimal).toMatchObject({ rawCategory: 'Unclassified', description: 'Unclassified', locationLabel: 'Block midpoint' });
    expect(mapNewYorkRow({ cmplnt_num: 'x', cmplnt_fr_dt: '', latitude: '40', longitude: '-73' })).toBeNull();
    expect(mapNewYorkRow({ cmplnt_num: 'x', cmplnt_fr_dt: '2026-08-10', latitude: '0', longitude: '0' })).toBeNull();
  });
});

describe('Chicago', () => {
  it('normalizes battery records with their published local time', () => {
    expect(mapChicagoRow({
      id: '123',
      date: '2026-08-10T22:15:00.000',
      block: '001XX N STATE ST',
      primary_type: 'BATTERY',
      description: 'AGGRAVATED',
      location_description: 'SIDEWALK',
      latitude: '41.8837',
      longitude: '-87.6298',
    })).toMatchObject({
      id: 'chicago:123',
      occurredAt: '2026-08-10T22:15:00',
      category: 'assault',
      group: 'violent',
      isViolent: true,
      localHour: 22,
      precision: 'block',
      coordinates: [-87.6298, 41.8837],
      locationLabel: '001XX N STATE ST · SIDEWALK',
    });
  });

  it('uses label fallbacks and rejects rows without coordinates', () => {
    const fallback = mapChicagoRow({ id: 'fallback', date: '2026-08-10T12:00:00', latitude: '41.8', longitude: '-87.6' });
    expect(fallback?.rawCategory).toBe('Unclassified');
    expect(fallback?.locationLabel).toBe('Location withheld');
    expect(mapChicagoRow({ id: 'x', date: '2026-08-10T00:00:00', latitude: 'bad', longitude: '-87' })).toBeNull();
  });

  it('treats a date-only timestamp as having no hour, unlike a published midnight', () => {
    const base = { id: 'c-1', primary_type: 'THEFT', latitude: '41.8', longitude: '-87.6' };
    expect(mapChicagoRow({ ...base, date: '2026-08-10' })).toMatchObject({
      occurredAt: '2026-08-10T00:00:00',
      occurredAtEpochMs: Date.parse('2026-08-10T00:00:00Z'),
      localHour: null,
    });
    expect(mapChicagoRow({ ...base, date: '2026-08-10T00:00:00.000' })).toMatchObject({
      occurredAt: '2026-08-10T00:00:00',
      localHour: 0,
    });
  });

  it('derives a deterministic identity when the publisher id is missing', () => {
    const row = { date: '2026-08-10T00:00:00', primary_type: 'THEFT', latitude: '41', longitude: '-87' };
    expect(mapChicagoRow(row)?.id).toBe('chicago:2026-08-10T00:00:00:-87,41:THEFT');
    expect(mapChicagoRow(row)?.id).toBe(mapChicagoRow({ ...row })?.id);
  });
});

describe('San Francisco', () => {
  it('normalizes burglary reports from category, subcategory and description', () => {
    const incident = mapSanFranciscoRow({
      row_id: 'SF-1',
      incident_datetime: '2026-08-11T03:30:00.000',
      incident_category: 'Other Offenses',
      incident_subcategory: 'Burglary - Commercial',
      incident_description: 'Entry without force',
      intersection: 'MARKET ST \\ 5TH ST',
      police_district: 'Southern',
      latitude: '37.783',
      longitude: '-122.408',
      resolution: 'Open or Active',
    });
    expect(incident).toMatchObject({
      id: 'san-francisco:SF-1',
      category: 'burglary',
      group: 'property',
      precision: 'intersection',
      localHour: 3,
      description: 'Entry without force · Open or Active',
      locationLabel: 'MARKET ST \\ 5TH ST · Southern',
    });
  });

  it('uses label fallbacks and rejects rows without both coordinates', () => {
    const fallback = mapSanFranciscoRow({ row_id: 'f', incident_datetime: '2026-08-10T12:00:00', latitude: '37.7', longitude: '-122.4' });
    expect(fallback).toMatchObject({ locationLabel: 'Nearby intersection', description: 'Unclassified' });
    expect(mapSanFranciscoRow({ row_id: 'x', incident_datetime: '2026-08-10T00:00:00', latitude: '37' })).toBeNull();
  });
});

describe('Los Angeles', () => {
  it('normalizes NIBRS hundred-block rows with compound identity', () => {
    expect(mapLosAngelesRow({
      uniquenibrno: 'LA-1001-120',
      caseno: 'LA-1001',
      date_occ: '2026-08-10T00:00:00.000',
      time_occ: '2315',
      nibr_description: 'ROBBERY',
      premis_desc: 'STREET',
      hndrdth_loc_chk: '6800 HOLLYWOOD BL',
      area_name: 'Hollywood',
      hndrdth_lat: '34.1016',
      hndrdth_lon: '-118.3406',
    })).toMatchObject({
      id: 'los-angeles:LA-1001-120:LA-1001',
      category: 'robbery',
      group: 'violent',
      localHour: 23,
      occurredAt: '2026-08-10T23:15:00',
      coordinates: [-118.3406, 34.1016],
      locationLabel: '6800 HOLLYWOOD BL · Hollywood',
    });
  });

  it('reads one-digit LAPD times and rejects zero coordinates', () => {
    expect(mapLosAngelesRow({
      uniquenibrno: 'LA-2', date_occ: '2026-08-10T00:00:00.000', time_occ: '5', nibr_description: 'THEFT',
      hndrdth_lat: '34.1', hndrdth_lon: '-118.3',
    })).toMatchObject({ occurredAt: '2026-08-10T00:05:00', localHour: 0, locationLabel: 'Published hundred block' });
    expect(mapLosAngelesRow({ uniquenibrno: 'x', date_occ: '2026-08-10T00:00:00', hndrdth_lat: '0', hndrdth_lon: '0' })).toBeNull();
  });

  it('accepts a metadata-resolved field map', () => {
    const fields = {
      id: 'uniquenibrno', secondaryId: null, date: 'date_occ', time: null, category: 'nibr_code', subcategory: null,
      description: 'weapon_desc', detail: null, location: null, premises: null, area: null,
      latitude: 'hndrdth_lat', longitude: 'hndrdth_lon', point: null,
    };
    expect(mapLosAngelesRow({
      uniquenibrno: 'LA-3', date_occ: '2026-08-10T00:00:00.000', nibr_code: '13A', weapon_desc: 'UNKNOWN WEAPON/OTHER WEAPON',
      hndrdth_lat: '34.1', hndrdth_lon: '-118.3',
    }, fields)).toMatchObject({
      id: 'los-angeles:LA-3',
      rawCategory: '13A',
      category: 'weapons',
      occurredAt: '2026-08-10T00:00:00',
      localHour: null,
    });
  });
});

describe('Seattle', () => {
  it('normalizes one-hundred-block offenses using the current schema', () => {
    expect(mapSeattleRow({
      offense_id: 'SEA-1',
      report_number: 'R-1',
      offense_date: '2026-08-10T22:15:00.000',
      offense_sub_category: 'AGGRAVATED ASSAULT',
      nibrs_crime_against_category: 'PERSON',
      block_address: '1XX PIKE ST',
      neighborhood: 'DOWNTOWN COMMERCIAL',
      latitude: '47.6097',
      longitude: '-122.3422',
    })).toMatchObject({
      id: 'seattle:SEA-1:R-1',
      category: 'assault',
      group: 'violent',
      precision: 'block',
      localHour: 22,
      locationLabel: '1XX PIKE ST · DOWNTOWN COMMERCIAL',
    });
  });

  it('rejects privacy placeholders and falls back to a deterministic identity', () => {
    expect(mapSeattleRow({ offense_id: 'x', offense_date: '2026-08-10T00:00:00', latitude: 'REDACTED', longitude: 'REDACTED' })).toBeNull();
    expect(mapSeattleRow({ offense_id: 'x', offense_date: '2026-08-10T00:00:00', latitude: '-', longitude: '-' })).toBeNull();
    expect(mapSeattleRow({
      report_number: 'R-9', offense_date: '2026-08-10T22:15:00.000', offense_sub_category: 'THEFT',
      latitude: '47.6', longitude: '-122.3',
    })?.id).toBe('seattle:2026-08-10T22:15:00.000:R-9:-122.3,47.6:THEFT');
  });
});

describe('Dallas', () => {
  it('reads text dates, rounds public points and generalizes house numbers', () => {
    expect(mapDallasRow({
      servnumid: '120551-2026-01',
      date1: '2026-08-17 00:00:00.0000000',
      time1: '01:10',
      nibrs_crime: 'AGG ASSAULT - NFV',
      offincident: 'ASSAULT (AGG) -OTHER',
      incident_address: '5130 PATONIA AVE',
      division: 'SOUTH CENTRAL',
      geocoded_column: { latitude: '32.68458', longitude: '-96.79187' },
    })).toMatchObject({
      id: 'dallas:120551-2026-01',
      occurredAt: '2026-08-17T01:10:00',
      occurredAtEpochMs: Date.parse('2026-08-17T01:10:00Z'),
      category: 'assault',
      group: 'violent',
      localHour: 1,
      precision: 'approximate',
      coordinates: [-96.792, 32.685],
      locationLabel: '5100 BLOCK PATONIA AVE · SOUTH CENTRAL',
    });
  });

  it('leaves the hour unknown when the separate time column is unreadable', () => {
    expect(mapDallasRow({
      servnumid: 'D-3', date1: '2026-08-17 00:00:00.0000000', time1: '25:10', nibrs_crime: 'THEFT',
      geocoded_column: { latitude: '32.68', longitude: '-96.79' },
    })).toMatchObject({ occurredAt: '2026-08-17T00:00:00', localHour: null });
  });

  it('reads GeoJSON points and rejects rows without a point', () => {
    expect(mapDallasRow({
      servnumid: 'D-2', date1: '2026-08-17 00:00:00.0000000', nibrs_crime: 'THEFT',
      geocoded_column: { type: 'Point', coordinates: [-96.8001, 32.7801] },
    })).toMatchObject({
      coordinates: [-96.8, 32.78],
      locationLabel: 'Approximate public location',
      occurredAt: '2026-08-17T00:00:00',
      localHour: null,
    });
    expect(mapDallasRow({ servnumid: 'x', date1: '2026-08-10T00:00:00', geocoded_column: {} })).toBeNull();
  });

  it.each([
    ['5130 PATONIA AVE', '5100 BLOCK PATONIA AVE'],
    ['45 MAIN ST', '0 BLOCK MAIN ST'],
    ['PATONIA AVE', 'PATONIA AVE'],
    ['5130PATONIA AVE', '5130PATONIA AVE'],
  ])('generalizes %j to %j', (address, expected) => {
    expect(generalizedDallasAddress(address)).toBe(expected);
  });
});

describe('Socrata city provider wiring', () => {
  it('queries NYC, Chicago and San Francisco from reviewed fixed fields without metadata', async () => {
    for (const [provider, select] of [
      [newYorkProvider, 'cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,ofns_desc,pd_desc,law_cat_cd,loc_of_occur_desc,prem_typ_desc,boro_nm,latitude,longitude'],
      [chicagoProvider, 'id,date,primary_type,description,block,location_description,latitude,longitude'],
      [sanFranciscoProvider, 'row_id,incident_datetime,incident_category,incident_subcategory,incident_description,resolution,intersection,police_district,latitude,longitude'],
    ] as const) {
      const urls = stubSocrata();
      await provider.fetchIncidents(query(provider.meta.center));
      expect(urls.some((url) => url.pathname.startsWith('/api/views/'))).toBe(false);
      const page = urls.find((url) => url.searchParams.has('$order'));
      expect(page?.searchParams.get('$select')).toBe(select);
    }
  });

  it('resolves Dallas aliases and queries its text date column with day literals and within_box', async () => {
    const urls = stubSocrata(['servnumid', 'incidentnum', 'date1', 'time1', 'nibrs_crime', 'offincident', 'incident_address', 'division', 'geocoded_column']);
    await dallasProvider.fetchIncidents(query(dallasProvider.meta.center));
    const where = pageWhere(urls);
    expect(where).toMatch(/^date1 >= '2026-09-20' AND date1 < '2026-10-20' AND within_box\(geocoded_column, /);
  });

  it('resolves Seattle aliases and compares its text coordinates sign-aware', async () => {
    const urls = stubSocrata(['offense_id', 'report_number', 'offense_date', 'offense_sub_category', 'nibrs_crime_against_category', 'block_address', 'neighborhood', 'latitude', 'longitude']);
    await seattleProvider.fetchIncidents(query([-122.3422, 47.6097]));
    const where = pageWhere(urls);
    expect(where).toContain("latitude NOT IN ('REDACTED', '-', '')");
    expect(where).toMatch(/longitude <= '-122\.38\d+' AND longitude >= '-122\.30\d+'/);
    expect(where).toMatch(/latitude >= '47\.58\d+' AND latitude <= '47\.63\d+'/);
  });

  it('resolves Los Angeles aliases to its hundred-block coordinates', async () => {
    const urls = stubSocrata(['uniquenibrno', 'caseno', 'date_occ', 'time_occ', 'nibr_description', 'premis_desc', 'hndrdth_loc_chk', 'area_name', 'hndrdth_lat', 'hndrdth_lon']);
    await losAngelesProvider.fetchIncidents(query(losAngelesProvider.meta.center));
    expect(pageWhere(urls)).toMatch(/hndrdth_lat >= 34\.\d+ AND hndrdth_lat <= 34\.\d+ AND hndrdth_lon >= -118\.\d+/);
  });
});
