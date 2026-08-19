import { describe, expect, it } from 'vitest';
import {
  mapDenverFeature,
  mapDetroitFeature,
  mapNashvilleFeature,
  mapPhiladelphiaFeature,
} from './arcgisCities';
import { mapChicagoRow } from './chicago';
import { findProviderForPoint, providerMetadata } from './index';
import { mapNewYorkRow } from './newYork';
import { mapDallasRow, mapLosAngelesRow, mapSeattleRow, mapWashingtonDcFeature } from './nationwide';
import { mapSanFranciscoRow } from './sanFrancisco';

describe('official provider row adapters', () => {
  it('keeps eleven provider identities and coverage centers disjoint', () => {
    expect(providerMetadata).toHaveLength(11);
    expect(new Set(providerMetadata.map((provider) => provider.id)).size).toBe(11);
    for (const provider of providerMetadata) {
      expect(findProviderForPoint(provider.center)?.meta.id).toBe(provider.id);
      const overlapping = providerMetadata.filter((candidate) => (
        candidate.id !== provider.id
        && provider.center[0] >= candidate.bounds.west
        && provider.center[0] <= candidate.bounds.east
        && provider.center[1] >= candidate.bounds.south
        && provider.center[1] <= candidate.bounds.north
      ));
      expect(overlapping, `${provider.label} center overlaps another provider`).toEqual([]);
    }
  });

  it('normalizes Chicago battery records', () => {
    const incident = mapChicagoRow({
      id: '123',
      date: '2026-08-10T22:15:00.000',
      block: '001XX N STATE ST',
      primary_type: 'BATTERY',
      description: 'AGGRAVATED',
      location_description: 'SIDEWALK',
      latitude: '41.8837',
      longitude: '-87.6298',
    });
    expect(incident).toMatchObject({
      id: 'chicago:123',
      category: 'assault',
      group: 'violent',
      isViolent: true,
      localHour: 22,
      precision: 'block',
      coordinates: [-87.6298, 41.8837],
    });
  });

  it('normalizes NYC grand larceny auto and combines date/time fields', () => {
    const incident = mapNewYorkRow({
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
    });
    expect(incident).toMatchObject({
      id: 'new-york:NY-1',
      category: 'vehicle',
      group: 'vehicle',
      localHour: 1,
      occurredAt: '2026-08-12T01:05:00',
      locationLabel: 'FRONT OF · STREET · MANHATTAN',
    });
  });

  it('normalizes San Francisco burglary reports', () => {
    const incident = mapSanFranciscoRow({
      row_id: 'SF-1',
      incident_datetime: '2026-08-11T03:30:00.000',
      incident_category: 'Burglary',
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
    });
    expect(incident?.description).toContain('Open or Active');
  });

  it('normalizes Los Angeles NIBRS hundred-block fields', () => {
    const incident = mapLosAngelesRow({
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
    });
    expect(incident).toMatchObject({
      id: 'los-angeles:LA-1001-120:LA-1001',
      category: 'robbery',
      group: 'violent',
      localHour: 23,
      occurredAt: '2026-08-10T23:15:00',
      coordinates: [-118.3406, 34.1016],
      locationLabel: '6800 HOLLYWOOD BL · Hollywood',
    });
  });

  it('normalizes Seattle one-hundred-block offenses using the current schema', () => {
    const incident = mapSeattleRow({
      offense_id: 'SEA-1',
      report_number: 'R-1',
      offense_date: '2026-08-10T22:15:00.000',
      offense_sub_category: 'AGGRAVATED ASSAULT',
      nibrs_crime_against_category: 'PERSON',
      block_address: '1XX PIKE ST',
      neighborhood: 'DOWNTOWN COMMERCIAL',
      latitude: '47.6097',
      longitude: '-122.3422',
    });
    expect(incident).toMatchObject({
      id: 'seattle:SEA-1:R-1',
      category: 'assault',
      group: 'violent',
      precision: 'block',
      locationLabel: '1XX PIKE ST · DOWNTOWN COMMERCIAL',
    });
  });

  it('normalizes Dallas approximate public incident locations', () => {
    const incident = mapDallasRow({
      servnumid: '120551-2026-01',
      date1: '2026-08-17 00:00:00.0000000',
      time1: '01:10',
      nibrs_crime: 'AGG ASSAULT - NFV',
      nibrs_crime_category: 'ASSAULT OFFENSES',
      offincident: 'ASSAULT (AGG) -OTHER',
      incident_address: '5130 PATONIA AVE',
      division: 'SOUTH CENTRAL',
      geocoded_column: { latitude: '32.68458', longitude: '-96.79187' },
    });
    expect(incident).toMatchObject({
      id: 'dallas:120551-2026-01',
      category: 'assault',
      group: 'violent',
      localHour: 1,
      precision: 'approximate',
      coordinates: [-96.792, 32.685],
      locationLabel: '5100 BLOCK PATONIA AVE · SOUTH CENTRAL',
    });
  });

  it('normalizes Washington DC ArcGIS features and case-insensitive attributes', () => {
    const epoch = Date.parse('2026-08-10T23:00:00Z');
    const incident = mapWashingtonDcFeature({
      attributes: {
        ccn: 'DC-1',
        objectid: 8,
        start_date: epoch,
        offense: 'ROBBERY',
        method: 'GUN',
        block: '100 BLOCK PENNSYLVANIA AVE NW',
        neighborhood_cluster: 'Cluster 2',
        latitude: 38.8895,
        longitude: -77.0365,
      },
      geometry: { x: -77.0365, y: 38.8895 },
    });
    expect(incident).toMatchObject({
      id: 'washington-dc:DC-1:8',
      category: 'robbery',
      group: 'violent',
      coordinates: [-77.0365, 38.8895],
      precision: 'block',
    });
  });

  it('normalizes four additional official ArcGIS city feeds', () => {
    const philadelphia = mapPhiladelphiaFeature({
      attributes: {
        dc_key: 202615076473,
        dispatch_date_time: Date.parse('2026-08-17T23:57:00Z'),
        text_general_code: 'Thefts',
        location_block: '6900 BLOCK TORRESDALE AVE',
        dc_dist: '15',
        point_x: -75.04326165,
        point_y: 40.02620047,
      },
    });
    const detroit = mapDetroitFeature({
      attributes: {
        incident_entry_id: '1476186-1302',
        incident_occurred_at: Date.parse('2026-08-17T03:00:00Z'),
        offense_category: 'AGGRAVATED ASSAULT',
        offense_description: 'FELONIOUS ASSAULT',
        nearest_intersection: 'Pilgrim St & Turner St',
        neighborhood: 'Fitzgerald/Marygrove',
        longitude: -83.1485522,
        latitude: 42.4074899,
      },
    });
    const denver = mapDenverFeature({
      attributes: {
        OFFENSE_ID: 'DP2026455622531200',
        FIRST_OCCURRENCE_DATE: Date.parse('2026-08-16T21:48:00Z'),
        OFFENSE_CATEGORY_ID: 'public-disorder',
        OFFENSE_TYPE_ID: 'disturbing-the-peace',
        NEIGHBORHOOD_ID: 'five-points',
        DISTRICT_ID: '6',
        GEO_LON: -104.99072735,
        GEO_LAT: 39.75419794,
      },
    });
    const nashville = mapNashvilleFeature({
      attributes: {
        Primary_Key: '20260498489_11',
        Incident_Occurred: Date.parse('2026-08-17T23:00:00Z'),
        Offense_Description: 'THEFT OF PROPERTY-$1,000 OR LESS',
        Weapon_Description: 'NONE',
        Incident_Location: 'OLD HICKORY BLVD',
        Location_Description: 'APARTMENT',
        Longitude: -86.6004,
        Latitude: 36.1804,
      },
    });

    expect(philadelphia).toMatchObject({
      id: 'philadelphia:202615076473', category: 'theft', precision: 'block',
      coordinates: [-75.04326165, 40.02620047],
    });
    expect(detroit).toMatchObject({
      id: 'detroit:1476186-1302', category: 'assault', precision: 'intersection',
      locationLabel: 'Pilgrim St & Turner St · Fitzgerald/Marygrove',
    });
    expect(denver).toMatchObject({
      id: 'denver:DP2026455622531200', precision: 'approximate', coordinates: [-104.991, 39.754],
    });
    expect(nashville).toMatchObject({
      id: 'nashville:20260498489_11', category: 'theft', precision: 'approximate',
      coordinates: [-86.6, 36.18],
    });
  });

  it('drops rows without usable identifiers, dates, or coordinates', () => {
    expect(mapChicagoRow({ id: 'x', date: '2026-08-10T00:00:00', latitude: 'bad', longitude: '-87' })).toBeNull();
    expect(mapChicagoRow({ date: '2026-08-10T00:00:00', latitude: '41', longitude: '-87' })).toBeNull();
    expect(mapNewYorkRow({ cmplnt_num: 'x', cmplnt_fr_dt: '', latitude: '40', longitude: '-73' })).toBeNull();
    expect(mapSanFranciscoRow({ row_id: 'x', incident_datetime: '2026-08-10T00:00:00', latitude: '37' })).toBeNull();
    expect(mapLosAngelesRow({ uniquenibrno: 'x', date_occ: '2026-08-10T00:00:00', hndrdth_lat: '0', hndrdth_lon: '0' })).toBeNull();
    expect(mapSeattleRow({ offense_id: 'x', offense_date: '2026-08-10T00:00:00', latitude: 'REDACTED', longitude: 'REDACTED' })).toBeNull();
    expect(mapDallasRow({ servnumid: 'x', date1: '2026-08-10T00:00:00', geocoded_column: {} })).toBeNull();
    expect(mapPhiladelphiaFeature({ attributes: { dc_key: 1, dispatch_date_time: Date.now() } })).toBeNull();
    expect(mapWashingtonDcFeature({
      attributes: { OBJECTID: 1, START_DATE: 'bad' },
      geometry: { x: -77, y: 39 },
    })).toBeNull();
  });

  it('uses source fallbacks when optional labels are absent', () => {
    const chicago = mapChicagoRow({
      id: 'fallback',
      date: '2026-08-10T12:00:00',
      latitude: '41.8',
      longitude: '-87.6',
    });
    const nyc = mapNewYorkRow({
      cmplnt_num: 'fallback',
      cmplnt_fr_dt: '2026-08-10T00:00:00',
      latitude: '40.7',
      longitude: '-74',
    });
    const sf = mapSanFranciscoRow({
      row_id: 'fallback',
      incident_datetime: '2026-08-10T12:00:00',
      latitude: '37.7',
      longitude: '-122.4',
    });
    expect(chicago?.rawCategory).toBe('Unclassified');
    expect(chicago?.locationLabel).toBe('Location withheld');
    expect(nyc?.locationLabel).toBe('Block midpoint');
    expect(sf?.locationLabel).toBe('Nearby intersection');
  });
});
