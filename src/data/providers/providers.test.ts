import { describe, expect, it } from 'vitest';
import { mapChicagoRow } from './chicago';
import { mapNewYorkRow } from './newYork';
import {
  mapAustinRow,
  mapBaltimoreRow,
  mapLosAngelesRow,
  mapNashvilleRow,
  mapSeattleRow,
  mapWashingtonDcFeature,
} from './nationwide';
import { mapSanFranciscoRow } from './sanFrancisco';

describe('official provider row adapters', () => {
  it('normalizes Chicago battery records', () => {
    const incident = mapChicagoRow({
      id: '123', date: '2026-08-10T22:15:00.000', block: '001XX N STATE ST',
      primary_type: 'BATTERY', description: 'AGGRAVATED', location_description: 'SIDEWALK',
      latitude: '41.8837', longitude: '-87.6298',
    });
    expect(incident).toMatchObject({
      id: 'chicago:123', category: 'assault', group: 'violent', isViolent: true,
      localHour: 22, precision: 'block', coordinates: [-87.6298, 41.8837],
    });
  });

  it('normalizes NYC grand larceny auto and combines date/time fields', () => {
    const incident = mapNewYorkRow({
      cmplnt_num: 'NY-1', cmplnt_fr_dt: '2026-08-12T00:00:00.000', cmplnt_fr_tm: '01:05:00',
      ofns_desc: 'GRAND LARCENY OF MOTOR VEHICLE', pd_desc: 'AUTO THEFT', law_cat_cd: 'FELONY',
      loc_of_occur_desc: 'FRONT OF', prem_typ_desc: 'STREET', boro_nm: 'MANHATTAN',
      latitude: '40.758', longitude: '-73.9855',
    });
    expect(incident).toMatchObject({
      id: 'new-york:NY-1', category: 'vehicle', group: 'vehicle', localHour: 1,
      occurredAt: '2026-08-12T01:05:00', locationLabel: 'FRONT OF · STREET · MANHATTAN',
    });
  });

  it('normalizes San Francisco burglary reports', () => {
    const incident = mapSanFranciscoRow({
      row_id: 'SF-1', incident_datetime: '2026-08-11T03:30:00.000', incident_category: 'Burglary',
      incident_subcategory: 'Burglary - Commercial', incident_description: 'Entry without force',
      intersection: 'MARKET ST \\ 5TH ST', police_district: 'Southern', latitude: '37.783',
      longitude: '-122.408', resolution: 'Open or Active',
    });
    expect(incident).toMatchObject({
      id: 'san-francisco:SF-1', category: 'burglary', group: 'property',
      precision: 'intersection', localHour: 3,
    });
    expect(incident?.description).toContain('Open or Active');
  });

  it('normalizes Los Angeles occurrence time and approximate coordinates', () => {
    const incident = mapLosAngelesRow({
      dr_no: 1001, date_occ: '2026-08-10T00:00:00.000', time_occ: '2315',
      crm_cd_desc: 'ROBBERY', premis_desc: 'STREET', location: '6800 HOLLYWOOD BL',
      area_name: 'Hollywood', lat: '34.1016', lon: '-118.3406',
    });
    expect(incident).toMatchObject({
      id: 'los-angeles:1001', category: 'robbery', group: 'violent', localHour: 23,
      occurredAt: '2026-08-10T23:15:00', coordinates: [-118.3406, 34.1016],
    });
  });

  it('normalizes Seattle 100-block offenses', () => {
    const incident = mapSeattleRow({
      offense_id: 'SEA-1', report_number: 'R-1', offense_start_datetime: '2026-08-10T22:15:00.000',
      offense: 'Aggravated Assault', offense_parent_group: 'ASSAULT OFFENSES',
      '100_block_address': '1XX PIKE ST', mcpp: 'DOWNTOWN COMMERCIAL',
      latitude: '47.6097', longitude: '-122.3422',
    });
    expect(incident).toMatchObject({
      id: 'seattle:SEA-1:R-1', category: 'assault', group: 'violent', precision: 'block',
      locationLabel: '1XX PIKE ST · DOWNTOWN COMMERCIAL',
    });
  });

  it('normalizes Austin crime reports', () => {
    const incident = mapAustinRow({
      incident_report_number: 'AUS-1', occ_date_time: '2026-08-10T02:30:00.000',
      crime_type: 'BURGLARY OF RESIDENCE', category_description: 'Burglary',
      address: '100 BLOCK CONGRESS AVE', apd_district: 'DT', latitude: '30.2672', longitude: '-97.7431',
    });
    expect(incident).toMatchObject({
      id: 'austin:AUS-1', category: 'burglary', group: 'property', localHour: 2,
      coordinates: [-97.7431, 30.2672],
    });
  });

  it('builds a deterministic Baltimore fallback identity when no primary id is published', () => {
    const incident = mapBaltimoreRow({
      crimedatetime: '2026-08-10T19:00:00.000', crimecode: '4E', description: 'COMMON ASSAULT',
      weapon: 'HANDS', location: '100 BLOCK LIGHT ST', neighborhood: 'Inner Harbor',
      latitude: '39.2866', longitude: '-76.6105',
    });
    expect(incident).toMatchObject({
      category: 'assault', group: 'violent', locationLabel: '100 BLOCK LIGHT ST · Inner Harbor',
    });
    expect(incident?.id).toContain('baltimore:2026-08-10T19:00:00.000:4E');
  });

  it('normalizes Nashville offense rows with compound identities', () => {
    const incident = mapNashvilleRow({
      incident_number: 'NSH-1', offense_number: '2', incident_occurred: '2026-08-10T21:30:00.000',
      offense_description: 'WEAPON LAW VIOLATIONS', offense_category: 'WEAPONS',
      incident_location: '100 BROADWAY', zone: 'CENTRAL', latitude: '36.1601', longitude: '-86.7742',
    });
    expect(incident).toMatchObject({
      id: 'nashville:NSH-1:2', category: 'weapons', group: 'weapons', localHour: 21,
    });
  });

  it('normalizes Washington DC ArcGIS features and case-insensitive attributes', () => {
    const epoch = Date.parse('2026-08-10T23:00:00Z');
    const incident = mapWashingtonDcFeature({
      attributes: {
        ccn: 'DC-1', objectid: 8, start_date: epoch, offense: 'ROBBERY', method: 'GUN',
        block: '100 BLOCK PENNSYLVANIA AVE NW', neighborhood_cluster: 'Cluster 2',
        latitude: 38.8895, longitude: -77.0365,
      },
      geometry: { x: -77.0365, y: 38.8895 },
    });
    expect(incident).toMatchObject({
      id: 'washington-dc:DC-1:8', category: 'robbery', group: 'violent',
      coordinates: [-77.0365, 38.8895], precision: 'block',
    });
  });

  it('falls back to Socrata point geometry when separate coordinates are absent', () => {
    const incident = mapAustinRow({
      incident_report_number: 'AUS-POINT', occ_date_time: '2026-08-10T02:30:00.000',
      crime_type: 'THEFT', address: 'CONGRESS AVE', location: { type: 'Point', coordinates: [-97.7431, 30.2672] },
    }, {
      id: 'incident_report_number', secondaryId: null, date: 'occ_date_time', time: null,
      category: 'crime_type', description: null, location: 'address', area: null,
      latitude: null, longitude: null, point: 'location',
    });
    expect(incident).toMatchObject({ id: 'austin:AUS-POINT', coordinates: [-97.7431, 30.2672] });
  });

  it('drops rows without usable identifiers, dates, or coordinates', () => {
    expect(mapChicagoRow({ id: 'x', date: '2026-08-10T00:00:00', latitude: 'bad', longitude: '-87' })).toBeNull();
    expect(mapChicagoRow({ date: '2026-08-10T00:00:00', latitude: '41', longitude: '-87' })).toBeNull();
    expect(mapNewYorkRow({ cmplnt_num: 'x', cmplnt_fr_dt: '', latitude: '40', longitude: '-73' })).toBeNull();
    expect(mapSanFranciscoRow({ row_id: 'x', incident_datetime: '2026-08-10T00:00:00', latitude: '37' })).toBeNull();
    expect(mapLosAngelesRow({ dr_no: 'x', date_occ: '2026-08-10T00:00:00', lat: '0', lon: '0' })).toBeNull();
    expect(mapWashingtonDcFeature({ attributes: { OBJECTID: 1, START_DATE: 'bad' }, geometry: { x: -77, y: 39 } })).toBeNull();
  });

  it('uses source fallbacks when optional labels are absent', () => {
    const chicago = mapChicagoRow({ id: 'fallback', date: '2026-08-10T12:00:00', latitude: '41.8', longitude: '-87.6' });
    const nyc = mapNewYorkRow({ cmplnt_num: 'fallback', cmplnt_fr_dt: '2026-08-10T00:00:00', latitude: '40.7', longitude: '-74' });
    const sf = mapSanFranciscoRow({ row_id: 'fallback', incident_datetime: '2026-08-10T12:00:00', latitude: '37.7', longitude: '-122.4' });
    expect(chicago?.rawCategory).toBe('Unclassified');
    expect(chicago?.locationLabel).toBe('Location withheld');
    expect(nyc?.locationLabel).toBe('Block midpoint');
    expect(sf?.locationLabel).toBe('Nearby intersection');
  });
});
