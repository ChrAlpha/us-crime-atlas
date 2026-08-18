import { describe, expect, it } from 'vitest';
import { mapChicagoRow } from './chicago';
import { mapNewYorkRow } from './newYork';
import { mapSanFranciscoRow } from './sanFrancisco';

describe('official provider row adapters', () => {
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

  it('drops rows without usable identifiers, dates, or coordinates', () => {
    expect(mapChicagoRow({ id: 'x', date: '2026-08-10T00:00:00', latitude: 'bad', longitude: '-87' })).toBeNull();
    expect(mapChicagoRow({ date: '2026-08-10T00:00:00', latitude: '41', longitude: '-87' })).toBeNull();
    expect(mapNewYorkRow({ cmplnt_num: 'x', cmplnt_fr_dt: '', latitude: '40', longitude: '-73' })).toBeNull();
    expect(mapSanFranciscoRow({ row_id: 'x', incident_datetime: '2026-08-10T00:00:00', latitude: '37' })).toBeNull();
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
