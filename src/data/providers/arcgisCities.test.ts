import { describe, expect, it, vi } from 'vitest';
import type { IncidentProvider } from '../../types';
import {
  denverProvider,
  detroitProvider,
  mapDenverFeature,
  mapDetroitFeature,
  mapNashvilleFeature,
  mapPhiladelphiaFeature,
  mapWashingtonDcFeature,
  nashvilleProvider,
  philadelphiaProvider,
  washingtonDcProvider,
} from './arcgisCities';

describe('Washington, DC', () => {
  const base = {
    CCN: 'DC-1',
    OBJECTID: 8,
    START_DATE: Date.parse('2026-08-11T03:00:00Z'),
    OFFENSE: 'ROBBERY',
    METHOD: 'GUN',
    BLOCK: '100 BLOCK PENNSYLVANIA AVE NW',
    NEIGHBORHOOD_CLUSTER: 'Cluster 2',
    LATITUDE: 38.8895,
    LONGITUDE: -77.0365,
  };

  it('converts true UTC epochs to Eastern wall-clock time', () => {
    expect(mapWashingtonDcFeature({ attributes: base })).toMatchObject({
      id: 'washington-dc:DC-1:8',
      occurredAt: '2026-08-10T23:00:00',
      localHour: 23,
      category: 'robbery',
      group: 'violent',
      description: 'GUN',
      locationLabel: '100 BLOCK PENNSYLVANIA AVE NW · Cluster 2',
      coordinates: [-77.0365, 38.8895],
      precision: 'block',
    });
  });

  it('reads attributes case-insensitively and falls back to the report date', () => {
    expect(mapWashingtonDcFeature({
      attributes: {
        ccn: 'DC-2', objectid: 9, start_date: null, report_dat: Date.parse('2026-01-15T17:30:00Z'),
        offense: 'THEFT/OTHER', latitude: 38.9, longitude: -77.02,
      },
    })).toMatchObject({
      id: 'washington-dc:DC-2:9',
      occurredAt: '2026-01-15T12:30:00',
      category: 'theft',
      description: 'THEFT/OTHER',
      locationLabel: 'Generalized block',
    });
  });

  it('builds identity from whichever of CCN and OBJECTID exists', () => {
    expect(mapWashingtonDcFeature({ attributes: { ...base, CCN: null } })?.id).toBe('washington-dc:8:8');
    expect(mapWashingtonDcFeature({ attributes: { ...base, OBJECTID: null } })?.id).toBe('washington-dc:DC-1:');
    expect(mapWashingtonDcFeature({ attributes: { ...base, CCN: '', OBJECTID: null } })).toBeNull();
  });

  it('drops features without a usable date', () => {
    expect(mapWashingtonDcFeature({ attributes: { OBJECTID: 1, START_DATE: 'bad', LONGITUDE: -77, LATITUDE: 39 } })).toBeNull();
  });
});

describe('Philadelphia', () => {
  const base = {
    dc_key: 202615076473,
    objectid: 44746263,
    dispatch_date_time: Date.parse('2026-10-19T23:54:00Z'),
    text_general_code: 'Thefts',
    location_block: '6900 BLOCK TORRESDALE AVE',
    dc_dist: '15',
    point_x: -75.04326165,
    point_y: 40.02620047,
  };

  it('keeps wall-clock epochs stored as UTC unchanged', () => {
    expect(mapPhiladelphiaFeature({ attributes: base })).toMatchObject({
      id: 'philadelphia:202615076473',
      occurredAt: '2026-10-19T23:54:00',
      localHour: 23,
      category: 'theft',
      precision: 'block',
      coordinates: [-75.04326165, 40.02620047],
      locationLabel: '6900 BLOCK TORRESDALE AVE · 15',
    });
  });

  it('falls back to objectid when dc_key is present but null', () => {
    expect(mapPhiladelphiaFeature({ attributes: { ...base, dc_key: null } })?.id).toBe('philadelphia:44746263');
  });

  it('falls back to label defaults', () => {
    expect(mapPhiladelphiaFeature({
      attributes: { objectid: 1, dispatch_date_time: base.dispatch_date_time, point_x: -75.1, point_y: 39.95 },
    })).toMatchObject({
      coordinates: [-75.1, 39.95],
      rawCategory: 'Unclassified',
      locationLabel: 'Published hundred block',
    });
  });

  it('rejects features whose coordinate attributes are null, since queries skip geometry', () => {
    expect(mapPhiladelphiaFeature({
      attributes: { objectid: 1, dispatch_date_time: base.dispatch_date_time, point_x: null, point_y: null },
    })).toBeNull();
  });

  it('drops features without coordinates', () => {
    expect(mapPhiladelphiaFeature({ attributes: { dc_key: 1, dispatch_date_time: base.dispatch_date_time } })).toBeNull();
    expect(mapPhiladelphiaFeature({})).toBeNull();
  });
});

describe('Detroit', () => {
  it('converts UTC epochs to the published local incident time', () => {
    // The layer's own text field reads incident_time 02:05 for this 06:05 UTC epoch.
    expect(mapDetroitFeature({
      attributes: {
        incident_entry_id: '1476186-1302',
        ESRI_OID: 5,
        incident_occurred_at: Date.parse('2026-10-21T06:05:00Z'),
        offense_category: 'AGGRAVATED ASSAULT',
        offense_description: 'FELONIOUS ASSAULT',
        nearest_intersection: 'Pilgrim St & Turner St',
        neighborhood: 'Fitzgerald/Marygrove',
        longitude: -83.1485522,
        latitude: 42.4074899,
      },
    })).toMatchObject({
      id: 'detroit:1476186-1302',
      occurredAt: '2026-10-21T02:05:00',
      localHour: 2,
      category: 'assault',
      precision: 'intersection',
      locationLabel: 'Pilgrim St & Turner St · Fitzgerald/Marygrove',
    });
  });

  it('falls back to ESRI_OID and the intersection label', () => {
    expect(mapDetroitFeature({
      attributes: { ESRI_OID: 77, incident_occurred_at: Date.parse('2026-10-21T06:05:00Z'), longitude: -83.1, latitude: 42.4 },
    })).toMatchObject({ id: 'detroit:77', locationLabel: 'Nearest intersection' });
  });
});

describe('Denver', () => {
  it('keeps wall-clock epochs and rounds published coordinates', () => {
    expect(mapDenverFeature({
      attributes: {
        OFFENSE_ID: 'DP2026455622531200',
        FIRST_OCCURRENCE_DATE: Date.parse('2026-10-19T21:00:00Z'),
        OFFENSE_CATEGORY_ID: 'public-disorder',
        OFFENSE_TYPE_ID: 'disturbing-the-peace',
        NEIGHBORHOOD_ID: 'five-points',
        DISTRICT_ID: '6',
        GEO_LON: -104.99072735,
        GEO_LAT: 39.75419794,
      },
    })).toMatchObject({
      id: 'denver:DP2026455622531200',
      occurredAt: '2026-10-19T21:00:00',
      localHour: 21,
      precision: 'approximate',
      coordinates: [-104.991, 39.754],
      description: 'disturbing-the-peace',
      locationLabel: 'five-points · 6',
    });
  });

  it('uses the grid label when no area is published', () => {
    expect(mapDenverFeature({
      attributes: { OBJECTID: 3, FIRST_OCCURRENCE_DATE: Date.parse('2026-10-19T21:00:00Z'), GEO_LON: -105, GEO_LAT: 39.7 },
    })).toMatchObject({ id: 'denver:3', locationLabel: 'Approximate hundred-meter grid' });
  });
});

describe('Nashville', () => {
  it('converts UTC epochs to Central time and rounds coordinates', () => {
    expect(mapNashvilleFeature({
      attributes: {
        Primary_Key: '20260498489_11',
        Incident_Occurred: Date.parse('2026-10-21T01:08:00Z'),
        Offense_Description: 'THEFT OF PROPERTY-$1,000 OR LESS',
        Weapon_Description: 'NONE',
        Incident_Location: 'OLD HICKORY BLVD',
        Location_Description: 'APARTMENT',
        Longitude: -86.6004,
        Latitude: 36.1804,
      },
    })).toMatchObject({
      id: 'nashville:20260498489_11',
      occurredAt: '2026-10-20T20:08:00',
      localHour: 20,
      category: 'theft',
      precision: 'approximate',
      coordinates: [-86.6, 36.18],
      locationLabel: 'OLD HICKORY BLVD · APARTMENT',
    });
  });

  it('describes with the weapon when no offense description exists', () => {
    expect(mapNashvilleFeature({
      attributes: {
        OBJECTID: 4, Incident_Occurred: Date.parse('2026-10-21T01:08:00Z'), Offense_NIBRS: '13A',
        Weapon_Description: 'HANDGUN', Longitude: -86.7, Latitude: 36.1,
      },
    })).toMatchObject({ id: 'nashville:4', rawCategory: '13A', description: 'HANDGUN', locationLabel: 'Approximate public location' });
  });
});

describe('ArcGIS city provider wiring', () => {
  const expected: Array<[IncidentProvider, string, string, string[]]> = [
    [washingtonDcProvider, 'START_DATE', 'OBJECTID', ['CCN', 'START_DATE', 'REPORT_DAT', 'OFFENSE', 'METHOD', 'BLOCK', 'LATITUDE', 'LONGITUDE']],
    [philadelphiaProvider, 'dispatch_date_time', 'objectid', ['dc_key', 'text_general_code', 'ucr_general', 'location_block', 'point_x', 'point_y']],
    [detroitProvider, 'incident_occurred_at', 'ESRI_OID', ['incident_entry_id', 'offense_category', 'nearest_intersection', 'longitude', 'latitude']],
    [denverProvider, 'FIRST_OCCURRENCE_DATE', 'OBJECTID', ['OFFENSE_ID', 'OFFENSE_CATEGORY_ID', 'NEIGHBORHOOD_ID', 'GEO_LON', 'GEO_LAT']],
    [nashvilleProvider, 'Incident_Occurred', 'OBJECTID', ['Primary_Key', 'Offense_Description', 'Weapon_Description', 'Longitude', 'Latitude']],
  ];

  it.each(expected)('queries %# with explicit fields and a stable object-id order', async (provider, dateField, objectIdField, fields) => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      const body = url.searchParams.get('returnCountOnly') === 'true' ? { count: 0 } : { features: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    await provider.fetchIncidents({
      center: provider.meta.center,
      radiusMeters: 1000,
      startEpochMs: Date.parse('2026-09-20T00:00:00Z'),
      endEpochMs: Date.parse('2026-10-20T00:00:00Z'),
    });
    const page = urls.find((url) => url.searchParams.has('outFields'));
    expect(`${page?.origin}${page?.pathname}`).toBe(`${provider.meta.endpoint}/query`);
    expect(page?.searchParams.get('where')).toContain(`${dateField} >= TIMESTAMP`);
    expect(page?.searchParams.get('orderByFields')).toBe(`${dateField} DESC,${objectIdField} ASC`);
    const outFields = page?.searchParams.get('outFields')?.split(',') ?? [];
    expect(outFields).toEqual(expect.arrayContaining([dateField, objectIdField, ...fields]));
    expect(outFields).not.toContain('*');
    expect(new Set(outFields).size).toBe(outFields.length);
  });
});
