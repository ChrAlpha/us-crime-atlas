import { describe, expect, it, vi } from 'vitest';
import { normalizeCategory } from '../../domain/categories';
import { pointIsWithinBounds } from '../../domain/geo';
import type { IncidentProvider, IncidentQuery } from '../../types';
import { ARCGIS_PAGE_SIZE } from './arcgis';
import { ARCGIS_LAYER_CONTRACTS } from './arcgisCities';
import { FEATURED_PLACES, providers } from './index';
import {
  AURORA_IL_OFFENSE_GROUPINGS,
  auroraIlProvider,
  bostonProvider,
  buffaloProvider,
  cincinnatiProvider,
  clevelandProvider,
  COLUMBUS_NON_CRIME_SUBJECTS,
  columbusProvider,
  desMoinesProvider,
  hartfordProvider,
  hintedClassification,
  hourClock,
  INDIANAPOLIS_FILTER,
  indianapolisProvider,
  kansasCityProvider,
  mapAuroraIlFeature,
  mapBostonFeature,
  mapBuffaloRow,
  mapCincinnatiRow,
  mapClevelandFeature,
  mapColumbusFeature,
  mapDesMoinesFeature,
  mapHartfordFeature,
  mapIndianapolisFeature,
  mapKansasCityRow,
  mapMinneapolisFeature,
  mapOmahaFeature,
  mapRochesterFeature,
  minneapolisProvider,
  NORTHEAST_FEATURED_PLACES,
  NORTHEAST_JURISDICTIONS,
  NORTHEAST_PROVIDERS,
  omahaProvider,
  rochesterProvider,
} from './northeastCities';

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

function query(center: readonly [number, number]): IncidentQuery {
  return { center, radiusMeters: 3000, startEpochMs: day('2026-09-20'), endEpochMs: day('2026-10-20') };
}

describe('hintedClassification', () => {
  it.each([
    ['ASSLT W/DNGRS WEAPON', 'assault'],
    ['2ND DEG DOMES ASLT', 'assault'],
    ['ASLT4-LESS THAN SUBST HARM', 'assault'],
    ['CSC - PENETRATE WITH OBJECT', 'sexual'],
    ['AUTOMOBILE THEFT', 'vehicle'],
    ['Theft of Vehicle Unauthorized Use of Vehicle', 'vehicle'],
    ['Theft of Vehicle Parts and Accessories', 'theft'],
    ['Breaking & Entering Home Invasion', 'burglary'],
    ['Violent Crime Strangulation', 'assault'],
    ['Forcible Fondling', 'sexual'],
    ['Molesting Vic 15 Yr and Younger', 'sexual'],
    ['SEX OFFENSES', 'sexual'],
    ['PERSON CRIMES', 'assault'],
    ['PROPERTY CRIMES', 'theft'],
    // A hint only adds a word; the vocabulary's priority still wins.
    ['Murder strangulation', 'homicide'],
    ['Robbery strangulation', 'robbery'],
    ['DOMESTIC RELATED/VIOLENCE', 'other'],
  ])('classifies %j as %s', (text, category) => {
    expect(normalizeCategory(hintedClassification(text))).toBe(category);
  });

  it('leaves text without a hint unchanged', () => {
    expect(hintedClassification('Simple Assault')).toBe('Simple Assault');
  });
});

describe('hourClock', () => {
  it.each([[0, '00:00:00'], [23, '23:00:00'], ['7', '07:00:00']] as const)('reads %j as %s', (value, expected) => {
    expect(hourClock(value)).toBe(expected);
  });

  it.each([24, -1, 2.5, null, undefined, '', 'x'])('rejects %j', (value) => {
    expect(hourClock(value)).toBeNull();
  });
});

describe('Boston', () => {
  const feature = {
    attributes: {
      OBJECTID: 4414906,
      INC_NUM: '262092036',
      OFF_SEQ_NUM: 1,
      CRIME: 'LARCENY FROM MV',
      NIBRS_DESC: 'THEFT FROM MOTOR VEHICLE',
      OFFENSE_DESC: 'BREAKING AND ENTERING (B&E) MOTOR VEHICLE',
      CRIME_PART: 'Part One',
      DISTRICT: 'A1',
      NEIGHBORHOOD: 'Downtown',
      FROM_DATE: Date.parse('2026-10-20T13:40:00Z'),
    },
    geometry: { x: -71.06482060345714, y: 42.35028564519332 },
  };

  it('converts UTC epochs, classifies by NIBRS class and rounds geometry', () => {
    // The layer's HOUR_OF_DAY reads 9 for this 13:40 UTC epoch.
    expect(mapBostonFeature(feature)).toMatchObject({
      id: 'boston:262092036:1',
      occurredAt: '2026-10-20T09:40:00',
      localHour: 9,
      category: 'theft',
      group: 'property',
      rawCategory: 'LARCENY FROM MV',
      description: 'BREAKING AND ENTERING (B&E) MOTOR VEHICLE',
      locationLabel: 'Downtown · A1',
      coordinates: [-71.065, 42.35],
      precision: 'approximate',
    });
  });

  it('applies standard time in winter and falls back to labels', () => {
    expect(mapBostonFeature({
      attributes: { INC_NUM: '262000001', FROM_DATE: Date.parse('2026-01-15T03:30:00Z') },
      geometry: { x: -71.05, y: 42.35 },
    })).toMatchObject({
      id: 'boston:262000001',
      occurredAt: '2026-01-14T22:30:00',
      rawCategory: 'Unclassified',
      locationLabel: 'Approximate public location',
    });
  });

  it('rejects rows without geometry, date or identity', () => {
    expect(mapBostonFeature({ attributes: feature.attributes, geometry: null })).toBeNull();
    expect(mapBostonFeature({ attributes: feature.attributes })).toBeNull();
    expect(mapBostonFeature({ attributes: { ...feature.attributes, FROM_DATE: null }, geometry: feature.geometry })).toBeNull();
    expect(mapBostonFeature({ attributes: { ...feature.attributes, INC_NUM: null, OFF_SEQ_NUM: null }, geometry: feature.geometry })).toBeNull();
    expect(mapBostonFeature({})).toBeNull();
  });
});

describe('Hartford', () => {
  const feature = {
    attributes: {
      OBJECTID: 58089,
      CaseNum: '26-023957',
      Date: Date.parse('2026-10-11T00:00:00Z'),
      Time: '0625',
      NibrsCode: '520',
      NibrsDesc: 'WEAPON LAW VIOLATIONS',
      OffenseDesc: '29-35 ILL CARRY PISTOL WO PERMIT',
      Address: '31 PARK ST',
    },
    geometry: { x: -72.67652174158933, y: 41.75708339627186 },
  };

  it('joins the local date with the HHMM time and generalizes the exact address', () => {
    expect(mapHartfordFeature(feature)).toMatchObject({
      id: 'hartford:26-023957:58089',
      occurredAt: '2026-10-11T06:25:00',
      localHour: 6,
      category: 'weapons',
      description: '29-35 ILL CARRY PISTOL WO PERMIT',
      locationLabel: '0 BLOCK PARK ST',
      coordinates: [-72.677, 41.757],
      precision: 'approximate',
    });
    expect(mapHartfordFeature({ ...feature, attributes: { ...feature.attributes, Address: '1250 MAIN ST' } })?.locationLabel)
      .toBe('1200 BLOCK MAIN ST');
  });

  it('classifies by the NIBRS class rather than the statute text', () => {
    expect(mapHartfordFeature({
      ...feature,
      attributes: { ...feature.attributes, NibrsDesc: 'ALL OTHER OFFENSES', OffenseDesc: '53A-167C ASSAULT OF PUBLIC SAFETY PERSONNEL' },
    })?.category).toBe('other');
  });

  it('keeps the day but no hour when the time is missing or unreadable', () => {
    for (const Time of [null, '', '2460']) {
      expect(mapHartfordFeature({ ...feature, attributes: { ...feature.attributes, Time } })).toMatchObject({
        occurredAt: '2026-10-11T00:00:00',
        localHour: null,
      });
    }
  });

  it('rejects rows without geometry', () => {
    expect(mapHartfordFeature({ attributes: feature.attributes, geometry: { x: 'NaN', y: 'NaN' } })).toBeNull();
  });
});

describe('Rochester', () => {
  const feature = {
    attributes: {
      OBJECTID: 23038,
      Case_Number: '2026-00241320',
      OccurredFrom_Timestamp: Date.parse('2026-10-20T07:45:00Z'),
      OccurredFrom_Time: '0345',
      Statute_Text: 'Burglary',
      Statute_Description: 'BURGLARY-3RD DEG:ILLEGAL ENTRY WITH INTENT TO COMMIT A CRIME',
      Address_StreetFull: '105 DODGE ST',
    },
    geometry: { x: -77.66401500033543, y: 43.16161500029285 },
  };

  it('converts UTC epochs to the published local time and hides the exact address', () => {
    expect(mapRochesterFeature(feature)).toMatchObject({
      id: 'rochester:2026-00241320:23038',
      occurredAt: '2026-10-20T03:45:00',
      localHour: 3,
      category: 'burglary',
      locationLabel: '100 BLOCK DODGE ST',
      coordinates: [-77.664, 43.162],
      precision: 'approximate',
    });
  });

  it('classifies by the UCR Part I label only', () => {
    const attributes = { ...feature.attributes, Statute_Text: 'Larceny', Statute_Description: 'GRAND LARCENY 4TH: FIREARM' };
    expect(mapRochesterFeature({ ...feature, attributes })?.category).toBe('theft');
    expect(mapRochesterFeature({
      ...feature,
      attributes: { ...feature.attributes, Statute_Text: 'Motor Vehicle Theft', Statute_Description: 'GRAND LARCENY  AUTO OVER $100' },
    })?.category).toBe('vehicle');
  });

  it('uses the location fallback and rejects unusable dates', () => {
    expect(mapRochesterFeature({ ...feature, attributes: { ...feature.attributes, Address_StreetFull: null } })?.locationLabel)
      .toBe('Approximate public location');
    expect(mapRochesterFeature({ ...feature, attributes: { ...feature.attributes, OccurredFrom_Timestamp: 'bad' } })).toBeNull();
  });
});

describe('Buffalo', () => {
  const row = {
    case_number: '262930991',
    incident_datetime: '2026-10-20T20:53:00.000',
    incident_type_primary: 'Robbery',
    parent_incident_type: 'Robbery',
    address_1: '1336 HERTEL AVE',
    neighborhood: 'North Park',
    location: { type: 'Point', coordinates: [-78.858, 42.948] },
  };

  it('reads the floating timestamp and Point, and shows the hundred block', () => {
    expect(mapBuffaloRow(row)).toMatchObject({
      id: 'buffalo:262930991',
      occurredAt: '2026-10-20T20:53:00',
      localHour: 20,
      category: 'robbery',
      group: 'violent',
      locationLabel: '1300 BLOCK HERTEL AVE · North Park',
      coordinates: [-78.858, 42.948],
      precision: 'approximate',
    });
  });

  it('rounds coordinates the publisher may stop rounding', () => {
    expect(mapBuffaloRow({ ...row, location: { type: 'Point', coordinates: [-78.85812, 42.94791] } })?.coordinates)
      .toEqual([-78.858, 42.948]);
  });

  it('recognizes vehicle theft and breaking and entering parent types', () => {
    expect(mapBuffaloRow({ ...row, parent_incident_type: 'Theft of Vehicle', incident_type_primary: 'Unauthorized Use of Vehicle' })?.category)
      .toBe('vehicle');
    expect(mapBuffaloRow({ ...row, parent_incident_type: 'Breaking & Entering', incident_type_primary: 'Home Invasion' })?.category)
      .toBe('burglary');
  });

  it('rejects rows without a point', () => {
    expect(mapBuffaloRow({ ...row, location: undefined })).toBeNull();
  });
});

describe('Cleveland', () => {
  const feature = {
    attributes: {
      OBJECTID: 60156,
      CaseNumber: '2026-00332282',
      OffenseDate: Date.parse('2026-10-21T03:20:00Z'),
      HourofDay: 23,
      IncidentDesc: 'Aggravated Assault',
      StatDesc: 'Felonious Assault',
      Address_Public: '106XX Berea Rd',
      NEIGHBORHOOD: 'Cudell',
      LAT: 41.47790749585887,
      LON: -81.7598830435585,
    },
  };

  it('converts UTC epochs to Eastern time and rounds the published point', () => {
    // The layer's HourofDay reads 23 for this 03:20 UTC epoch.
    expect(mapClevelandFeature(feature)).toMatchObject({
      id: 'cleveland:2026-00332282:60156',
      occurredAt: '2026-10-20T23:20:00',
      localHour: 23,
      category: 'assault',
      description: 'Felonious Assault',
      locationLabel: '106XX Berea Rd · Cudell',
      coordinates: [-81.76, 41.478],
      precision: 'approximate',
    });
  });

  it('falls back to the statute when the NIBRS description is missing', () => {
    expect(mapClevelandFeature({ attributes: { ...feature.attributes, IncidentDesc: null, StatDesc: 'Strangulation -Cause serious phyiscal harm' } }))
      .toMatchObject({ rawCategory: 'Strangulation -Cause serious phyiscal harm', category: 'assault' });
    expect(mapClevelandFeature({ attributes: { ...feature.attributes, IncidentDesc: 'Forcible Fondling', StatDesc: null } })?.category)
      .toBe('sexual');
    expect(mapClevelandFeature({ attributes: { ...feature.attributes, IncidentDesc: null, StatDesc: null } })).toMatchObject({
      rawCategory: 'Unclassified',
      description: 'Unclassified',
      category: 'other',
    });
  });

  it('rejects rows whose coordinate attributes are empty', () => {
    expect(mapClevelandFeature({ attributes: { ...feature.attributes, LAT: null, LON: null } })).toBeNull();
  });
});

describe('Columbus', () => {
  const feature = {
    attributes: {
      OBJECTID: 264113,
      IncidentNo: '260784573',
      ColumbusSubject: '150 - Domestic Violence',
      OccurredOn: Date.parse('2026-10-18T00:58:00Z'),
      OccurredWeekday: 'Sunday',
      IncidentLocation: '2500 Block of W Broad St',
      GeneralSubject: 'Domestic Violence',
      ColumbusCommunity: 'Greater Hilltop',
    },
    geometry: { x: -83.06445343551455, y: 39.95541218421257 },
  };

  it('keeps wall-clock epochs stored as UTC unchanged and rounds geometry', () => {
    expect(mapColumbusFeature(feature)).toMatchObject({
      id: 'columbus:260784573:264113',
      occurredAt: '2026-10-18T00:58:00',
      localHour: 0,
      category: 'other',
      locationLabel: '2500 Block of W Broad St · Greater Hilltop',
      coordinates: [-83.064, 39.955],
      precision: 'approximate',
    });
  });

  it('classifies molesting as a sexual offense', () => {
    expect(mapColumbusFeature({ ...feature, attributes: { ...feature.attributes, GeneralSubject: 'Molesting Vic 15 Yr and Younger' } })?.category)
      .toBe('sexual');
  });

  it('rejects unmapped (null-island) reports', () => {
    expect(mapColumbusFeature({ ...feature, geometry: { x: 0, y: 0 } })).toBeNull();
  });
});

describe('Cincinnati', () => {
  const row = {
    reportnumber: '2026-INC-020174',
    starscategory: 'Robbery',
    starscategorytype: 'Violent Crime',
    eventdate: '2026-10-12T04:45:00.000',
    lat_x: '39.10722821574344',
    lon_x: '-84.57050514376095',
    snaneighborhood: 'East Price Hill',
    addressx: '8XX WELLS ST',
  };

  it('reads the floating timestamp and rounds the offset point', () => {
    expect(mapCincinnatiRow(row)).toMatchObject({
      id: 'cincinnati:2026-INC-020174:Robbery:-84.57050514376095,39.10722821574344',
      occurredAt: '2026-10-12T04:45:00',
      localHour: 4,
      category: 'robbery',
      rawCategory: 'Violent Crime',
      description: 'Robbery',
      locationLabel: '8XX WELLS ST · East Price Hill',
      coordinates: [-84.571, 39.107],
      precision: 'approximate',
    });
  });

  it('keeps one row per homicide victim and classifies strangulation as assault', () => {
    const victim = { ...row, starscategory: 'Homicide', eventdate: '2026-06-20T00:00:00.000' };
    const first = mapCincinnatiRow({ ...victim, lat_x: '39.15144129370106', lon_x: '-84.55500004949793' });
    const second = mapCincinnatiRow({ ...victim, lat_x: '39.15141078779604', lon_x: '-84.55471644775524' });
    expect(first?.category).toBe('homicide');
    expect(first?.id).not.toBe(second?.id);
    expect(mapCincinnatiRow({ ...row, starscategory: 'Strangulation' })?.category).toBe('assault');
  });

  it('rejects rows without coordinates', () => {
    expect(mapCincinnatiRow({ ...row, lat_x: undefined })).toBeNull();
  });
});

describe('Indianapolis', () => {
  const feature = {
    attributes: {
      OBJECTID: 1969116,
      Agency: 'IMPD',
      CaseNum: 'IP260085510',
      sOccTime: '21:34',
      CR_Desc: 'Aggravated Assault',
      sAddress: '2000 BLOCK N KEYSTONE AVE',
      Longitude: -86.1220382,
      Latitude: 39.79443098,
      NIBRSClassCode: 'N13A',
      NIBRSClassDesc: 'Aggravated Assault',
      CAIU_ClassType: 'Violent',
      OccurredFrom: Date.parse('2026-10-20T21:34:00Z'),
    },
  };

  it('keeps wall-clock epochs (matching sOccTime) and the published hundred block', () => {
    expect(mapIndianapolisFeature(feature)).toMatchObject({
      id: 'indianapolis:IP260085510:1969116',
      occurredAt: '2026-10-20T21:34:00',
      localHour: 21,
      category: 'assault',
      group: 'violent',
      locationLabel: '2000 BLOCK N KEYSTONE AVE',
      coordinates: [-86.1220382, 39.79443098],
      precision: 'block',
    });
  });

  it('classifies by the NIBRS class', () => {
    expect(mapIndianapolisFeature({
      attributes: { ...feature.attributes, NIBRSClassDesc: 'Larceny From Motor Vehicle', CR_Desc: 'Theft' },
    })?.category).toBe('theft');
  });

  it('rejects ungeocoded zero coordinates', () => {
    expect(mapIndianapolisFeature({ attributes: { ...feature.attributes, Longitude: 0, Latitude: 0 } })).toBeNull();
  });
});

describe('Aurora, Illinois', () => {
  const feature = {
    attributes: {
      OBJECTID: 24699,
      DISTRICT: 3,
      INCIDENT_NUM: 'AUPR26013740',
      REPORTED_ON: Date.parse('2026-10-20T00:13:00Z'),
      GROUPING: 'PERSON CRIMES',
      STREETADDR: '100 BLOCK N LOCUST ST',
    },
    geometry: { x: -88.32113595199996, y: 41.762250996000034 },
  };

  it('converts UTC report epochs to Central time and maps person crimes to assault', () => {
    expect(mapAuroraIlFeature(feature)).toMatchObject({
      id: 'aurora-il:AUPR26013740:24699',
      occurredAt: '2026-10-19T19:13:00',
      localHour: 19,
      category: 'assault',
      group: 'violent',
      locationLabel: '100 BLOCK N LOCUST ST',
      coordinates: [-88.321, 41.762],
      precision: 'approximate',
    });
  });

  it.each([
    ['PROPERTY CRIMES', 'theft'],
    ['SEX OFFENSES', 'sexual'],
    ['WEAPONS VIOLATION', 'weapons'],
    ['DOMESTIC RELATED/VIOLENCE', 'other'],
  ])('maps the %s grouping to %s', (GROUPING, category) => {
    expect(mapAuroraIlFeature({ ...feature, attributes: { ...feature.attributes, GROUPING } })?.category).toBe(category);
  });

  it('rejects rows without a date', () => {
    expect(mapAuroraIlFeature({ ...feature, attributes: { ...feature.attributes, REPORTED_ON: null } })).toBeNull();
  });
});

describe('Minneapolis', () => {
  const feature = {
    attributes: {
      OBJECTID: 18739,
      caseNumber: 'MP2026302686',
      beginDate: Date.parse('2026-10-19T00:00:00Z'),
      beginTime: 623,
      description: 'BURGLARY OF BUSINESS',
      publicaddress: '0011XX 39TH ST E',
      neighborhood: 'Bancroft',
      centerLong: -93.25808,
      centerLat: 44.93234,
    },
  };

  it('joins the local begin date with its HHMM time', () => {
    expect(mapMinneapolisFeature(feature)).toMatchObject({
      id: 'minneapolis:MP2026302686:18739',
      occurredAt: '2026-10-19T06:23:00',
      occurredAtEpochMs: Date.parse('2026-10-19T06:23:00Z'),
      localHour: 6,
      category: 'burglary',
      locationLabel: '0011XX 39TH ST E · Bancroft',
      coordinates: [-93.25808, 44.93234],
      precision: 'block',
    });
  });

  it.each([
    ['ASSLT W/DNGRS WEAPON', 'assault'],
    ['AUTOMOBILE THEFT', 'vehicle'],
    ['CSC - RAPE', 'sexual'],
    ['THEFT FROM MOTR VEHC', 'theft'],
  ])('classifies %s as %s', (description, category) => {
    expect(mapMinneapolisFeature({ attributes: { ...feature.attributes, description } })?.category).toBe(category);
  });

  it('keeps the day but no hour without a begin time', () => {
    expect(mapMinneapolisFeature({ attributes: { ...feature.attributes, beginTime: null } })).toMatchObject({
      occurredAt: '2026-10-19T00:00:00',
      localHour: null,
    });
  });

  it('rejects rows without a begin date', () => {
    expect(mapMinneapolisFeature({ attributes: { ...feature.attributes, beginDate: null } })).toBeNull();
  });
});

describe('Des Moines', () => {
  const feature = {
    attributes: {
      OBJECTID: 124134,
      case_number: '2026-00023455',
      reported_date: Date.parse('2026-09-23T05:00:00Z'),
      reported_hour_of_day: 2,
      police_district: 'CBD',
      crime_code: '13B',
      nibrs_offense: 'Simple Assault',
      offense_category: 'Assault Offenses',
      case_address_anonymized: '11XX 19TH ST',
      case_latitude_anonymized: 41.5988746,
      case_longitude_anonymized: -93.6425327,
    },
  };

  it('reads the report day from its UTC midnight and the report hour', () => {
    expect(mapDesMoinesFeature(feature)).toMatchObject({
      id: 'des-moines:2026-00023455:124134',
      occurredAt: '2026-09-23T02:00:00',
      localHour: 2,
      category: 'assault',
      description: 'Simple Assault',
      locationLabel: '11XX 19TH ST · CBD',
      coordinates: [-93.6425327, 41.5988746],
      precision: 'approximate',
    });
  });

  it('keeps the local day in winter (06:00 UTC) and drops an unreadable hour', () => {
    expect(mapDesMoinesFeature({
      attributes: { ...feature.attributes, reported_date: Date.parse('2026-01-10T06:00:00Z'), reported_hour_of_day: 24 },
    })).toMatchObject({ occurredAt: '2026-01-10T00:00:00', localHour: null });
  });

  it('rejects rows without anonymized coordinates', () => {
    expect(mapDesMoinesFeature({ attributes: { ...feature.attributes, case_latitude_anonymized: null } })).toBeNull();
  });
});

describe('Kansas City', () => {
  const row = {
    report: 'KC26063611',
    from_date: '2026-10-19T00:00:00.000',
    from_time: '04:49',
    offense: 'Domestic Violence Assault (Non-Aggravated)',
    ibrs: '13B',
    description: 'Simple Assault',
    address: '3200  PARK AVE',
    location: { type: 'Point', coordinates: [-94.55642, 39.06801] },
  };

  it('joins the date with its HH:MM time and identifies a report offense', () => {
    expect(mapKansasCityRow(row)).toMatchObject({
      id: 'kansas-city:KC26063611:Domestic Violence Assault (Non-Aggravated)',
      occurredAt: '2026-10-19T04:49:00',
      localHour: 4,
      category: 'assault',
      rawCategory: 'Simple Assault',
      description: 'Domestic Violence Assault (Non-Aggravated)',
      locationLabel: '3200  PARK AVE',
      coordinates: [-94.55642, 39.06801],
      precision: 'block',
    });
  });

  it('gives every involved-person row of one offense the same identity', () => {
    expect(mapKansasCityRow({ ...row })?.id).toBe(mapKansasCityRow(row)?.id);
  });

  it('categorizes by the KCPD offense without a NIBRS description', () => {
    expect(mapKansasCityRow({ ...row, description: null, offense: 'Stealing - Shoplift' })).toMatchObject({
      rawCategory: 'Stealing - Shoplift',
      category: 'other',
    });
    expect(mapKansasCityRow({ ...row, description: 'Forcible Fondling', offense: 'Fondling' })?.category).toBe('sexual');
  });

  it('keeps the day but no hour without a time, and rejects rows without a point', () => {
    expect(mapKansasCityRow({ ...row, from_time: null })).toMatchObject({ occurredAt: '2026-10-19T00:00:00', localHour: null });
    expect(mapKansasCityRow({ ...row, location: null })).toBeNull();
  });
});

describe('Omaha', () => {
  const feature = {
    attributes: {
      OBJECTID: 515554,
      RB: 'AA71995',
      dteMidpoint: Date.parse('2026-10-21T05:48:01Z'),
      NIBRSCategory: 'Assault Offenses',
      AddressBlock: '1900 N 144th St',
      LatBlock: 41.27698,
      LonBlock: -96.13889,
      PK: -1584096,
      Neighborhood_Associations: null,
    },
  };

  it('converts the UTC occurrence midpoint to Central time', () => {
    expect(mapOmahaFeature(feature)).toMatchObject({
      id: 'omaha:AA71995:-1584096',
      occurredAt: '2026-10-21T00:48:01',
      localHour: 0,
      category: 'assault',
      locationLabel: '1900 N 144th St',
      coordinates: [-96.13889, 41.27698],
      precision: 'block',
    });
  });

  it('identifies by the key alone when the report number is missing', () => {
    expect(mapOmahaFeature({ attributes: { ...feature.attributes, RB: null, AddressBlock: null } })).toMatchObject({
      id: 'omaha:-1584096',
      locationLabel: 'Published hundred block',
    });
  });

  it('rejects rows without block coordinates', () => {
    expect(mapOmahaFeature({ attributes: { ...feature.attributes, LonBlock: null } })).toBeNull();
  });
});

describe('Northeast ArcGIS provider wiring', () => {
  const expected: Array<[IncidentProvider, string, string | null, boolean, string[]]> = [
    [bostonProvider, 'FROM_DATE', "CRIME_PART <> 'Part Three'", true, ['INC_NUM', 'OFF_SEQ_NUM', 'CRIME', 'NIBRS_DESC', 'OFFENSE_DESC', 'NEIGHBORHOOD', 'DISTRICT', 'CRIME_PART']],
    [hartfordProvider, 'Date', "NibrsDesc <> 'NOT NIBRS REPORTABLE'", true, ['CaseNum', 'Time', 'NibrsDesc', 'OffenseDesc', 'Address']],
    [rochesterProvider, 'OccurredFrom_Timestamp', null, true, ['Case_Number', 'Statute_Text', 'Statute_Description', 'Address_StreetFull']],
    [clevelandProvider, 'OffenseDate', null, false, ['CaseNumber', 'IncidentDesc', 'StatDesc', 'Address_Public', 'NEIGHBORHOOD', 'LAT', 'LON']],
    [columbusProvider, 'OccurredOn', `GeneralSubject IS NULL OR GeneralSubject NOT IN ('${COLUMBUS_NON_CRIME_SUBJECTS.join("', '")}')`, true, ['IncidentNo', 'GeneralSubject', 'ColumbusSubject', 'IncidentLocation', 'ColumbusCommunity']],
    [indianapolisProvider, 'OccurredFrom', INDIANAPOLIS_FILTER, false, ['CaseNum', 'NIBRSClassDesc', 'CR_Desc', 'sAddress', 'Longitude', 'Latitude', 'Agency', 'CAIU_ClassType', 'NIBRSClassCode']],
    [auroraIlProvider, 'REPORTED_ON', `GROUPING IN ('${AURORA_IL_OFFENSE_GROUPINGS.join("', '")}')`, true, ['INCIDENT_NUM', 'GROUPING', 'STREETADDR']],
    [minneapolisProvider, 'beginDate', null, false, ['caseNumber', 'beginTime', 'description', 'publicaddress', 'neighborhood', 'centerLong', 'centerLat']],
    [desMoinesProvider, 'reported_date', "crime_code <> '999'", false, ['case_number', 'reported_hour_of_day', 'crime_code', 'offense_category', 'nibrs_offense', 'case_address_anonymized', 'case_longitude_anonymized', 'case_latitude_anonymized']],
    [omahaProvider, 'dteMidpoint', null, false, ['RB', 'PK', 'NIBRSCategory', 'AddressBlock', 'LonBlock', 'LatBlock']],
  ];

  function stubArcgis() {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      if (url.searchParams.get('returnCountOnly') === 'true') return new Response(JSON.stringify({ count: 0 }));
      if (url.searchParams.has('outStatistics')) return new Response(JSON.stringify({ features: [{ attributes: { latest_record: null } }] }));
      return new Response(JSON.stringify({ features: [] }));
    }));
    return urls;
  }

  it.each(expected)('queries %# with its date predicate, filter, geometry mode and page size', async (provider, dateField, filter, geometry, fields) => {
    const urls = stubArcgis();
    await provider.fetchIncidents(query(provider.meta.center));
    provider.resetCache?.();
    await provider.fetchLatestRecordEpoch();

    const page = urls.find((url) => url.searchParams.has('outFields'));
    const count = urls.find((url) => url.searchParams.get('returnCountOnly') === 'true');
    const latest = urls.find((url) => url.searchParams.has('outStatistics'));
    expect(`${page?.origin}${page?.pathname}`).toBe(`${provider.meta.endpoint}/query`);
    const where = page?.searchParams.get('where') ?? '';
    expect(where).toMatch(new RegExp(`^${dateField} >= TIMESTAMP '2026-09-19 00:00:00' AND ${dateField} < TIMESTAMP '2026-10-21 00:00:00'`));
    if (filter) {
      expect(where.endsWith(` AND (${filter})`)).toBe(true);
      expect(count?.searchParams.get('where')).toBe(where);
      expect(latest?.searchParams.get('where')).toContain(`(${filter})`);
    } else {
      expect(where.split(' AND ')).toHaveLength(2);
    }
    expect(page?.searchParams.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(page?.searchParams.get('returnGeometry')).toBe(String(geometry));
    expect(page?.searchParams.get('outSR')).toBe(geometry ? '4326' : null);
    expect(page?.searchParams.get('orderByFields')).toBe(`${dateField} DESC,OBJECTID ASC`);
    expect(page?.searchParams.get('resultRecordCount')).toBe(String(ARCGIS_PAGE_SIZE));
    const outFields = page?.searchParams.get('outFields')?.split(',') ?? [];
    expect(outFields).toEqual(expect.arrayContaining([dateField, 'OBJECTID', ...fields]));
    expect(new Set(outFields).size).toBe(outFields.length);

    const contract = ARCGIS_LAYER_CONTRACTS.find((candidate) => candidate.meta.id === provider.meta.id);
    expect(contract).toMatchObject({ dateField, outFields, pageSize: ARCGIS_PAGE_SIZE });
  });

  it('registers the reviewed live layer names and epoch semantics', () => {
    const ids = new Set(NORTHEAST_PROVIDERS.map((provider) => provider.meta.id));
    const contracts = ARCGIS_LAYER_CONTRACTS.filter((contract) => ids.has(contract.meta.id));
    expect(Object.fromEntries(contracts.map((contract) => [contract.meta.id, [contract.layerName, contract.epochSemantics]]))).toEqual({
      boston: ['Boston_Incidents_Public', 'utc'],
      hartford: ['Police Incidents Current Year to 10 Days before the Current Date', 'local-clock'],
      rochester: ['RPD Part I Crime - 2011 to Present', 'utc'],
      cleveland: ['Crime_Incidents', 'utc'],
      columbus: ['PoliceIncidentReports', 'local-clock'],
      indianapolis: ['Incidents_Public', 'local-clock'],
      'aurora-il': ['AuroraIL.Police_Incidents', 'utc'],
      minneapolis: ['Police_Incidents_2026', 'local-clock'],
      'des-moines': ['pd_crime_layer', 'utc'],
      omaha: ['crime_analysis_incidents_public', 'utc'],
    });
  });

  it('maps fetched features through the layer mapper', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('returnCountOnly') === 'true') return new Response(JSON.stringify({ count: 1 }));
      return new Response(JSON.stringify({
        features: [{
          attributes: { OBJECTID: 1, INC_NUM: '26-1', OFF_SEQ_NUM: 1, CRIME: 'ROBBERY', FROM_DATE: Date.parse('2026-10-01T16:00:00Z') },
          geometry: { x: -71.0589, y: 42.3601 },
        }],
      }));
    }));
    const batch = await bostonProvider.fetchIncidents(query(bostonProvider.meta.center));
    expect(batch.incidents.map((incident) => [incident.id, incident.occurredAt, incident.category])).toEqual([
      ['boston:26-1:1', '2026-10-01T12:00:00', 'robbery'],
    ]);
    expect(batch.truncated).toBe(false);
  });
});

describe('Northeast Socrata provider wiring', () => {
  function stubSocrata() {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      urls.push(url);
      if (url.searchParams.get('$select') === 'count(*) AS total') return new Response(JSON.stringify([{ total: '0' }]));
      if (url.searchParams.get('$select')?.startsWith('max(')) return new Response(JSON.stringify([{ latest_record: null }]));
      return new Response(JSON.stringify([]));
    }));
    return urls;
  }

  const page = (urls: URL[]) => urls.find((url) => url.searchParams.has('$order'));

  it('queries Buffalo\'s Point column with within_box and reviewed fields', async () => {
    const urls = stubSocrata();
    await buffaloProvider.fetchIncidents(query([-78.8774, 42.8768]));
    expect(urls.some((url) => url.pathname.startsWith('/api/views/'))).toBe(false);
    expect(page(urls)?.searchParams.get('$select')).toBe('case_number,incident_datetime,parent_incident_type,incident_type_primary,address_1,neighborhood,location');
    expect(page(urls)?.searchParams.get('$where'))
      .toMatch(/^incident_datetime >= '2026-09-20' AND incident_datetime < '2026-10-20' AND within_box\(location, 42\.9\d+, -78\.9\d+, 42\.8\d+, -78\.8\d+\)$/);
  });

  it('compares Cincinnati\'s numeric coordinates', async () => {
    const urls = stubSocrata();
    await cincinnatiProvider.fetchIncidents(query([-84.5128, 39.1016]));
    expect(page(urls)?.searchParams.get('$select')).toBe('reportnumber,starscategory,eventdate,starscategorytype,addressx,snaneighborhood,lat_x,lon_x');
    expect(page(urls)?.searchParams.get('$where'))
      .toMatch(/^eventdate >= '2026-09-20' AND eventdate < '2026-10-20' AND lat_x >= 39\.07\d+ AND lat_x <= 39\.12\d+ AND lon_x >= -84\.54\d+ AND lon_x <= -84\.47\d+$/);
  });

  it('filters Kansas City\'s administrative reports and never requests demographics', async () => {
    const urls = stubSocrata();
    await kansasCityProvider.fetchIncidents(query([-94.5927, 39.042]));
    kansasCityProvider.resetCache?.();
    await kansasCityProvider.fetchLatestRecordEpoch();
    const select = page(urls)?.searchParams.get('$select') ?? '';
    expect(select).toBe('report,offense,from_date,from_time,description,ibrs,address,location');
    for (const field of ['involvement', 'race', 'sex', 'age', 'age_range']) expect(select.split(',')).not.toContain(field);
    expect(page(urls)?.searchParams.get('$where')).toMatch(/^from_date >= '2026-09-20' AND from_date < '2026-10-20' AND within_box\(location, .+\) AND \(ibrs IS NULL OR ibrs != '999'\)$/);
    const count = urls.find((url) => url.searchParams.get('$select') === 'count(*) AS total');
    const latest = urls.find((url) => url.searchParams.get('$select')?.startsWith('max('));
    expect(count?.searchParams.get('$where')).toContain("(ibrs IS NULL OR ibrs != '999')");
    expect(latest?.searchParams.get('$where')).toContain("(ibrs IS NULL OR ibrs != '999')");
  });

  it('collapses Kansas City\'s per-person rows into one incident', async () => {
    const row = {
      report: 'KC26063611', from_date: '2026-10-01T00:00:00.000', from_time: '04:49', offense: 'Robbery - Business',
      description: 'Robbery', location: { type: 'Point', coordinates: [-94.5927, 39.042] },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('$select') === 'count(*) AS total') return new Response(JSON.stringify([{ total: '2' }]));
      return new Response(JSON.stringify([row, row]));
    }));
    const batch = await kansasCityProvider.fetchIncidents(query([-94.5927, 39.042]));
    expect(batch.incidents).toHaveLength(1);
    expect(batch.incidents[0]?.category).toBe('robbery');
  });
});

describe('Northeast registry exports', () => {
  const metas = NORTHEAST_PROVIDERS.map((provider) => provider.meta);
  const ids = new Set(metas.map((meta) => meta.id));
  const existing = providers.filter((provider) => !ids.has(provider.meta.id)).map((provider) => provider.meta);
  const STATES: Record<string, string> = {
    MA: 'Massachusetts', CT: 'Connecticut', NY: 'New York', OH: 'Ohio', IN: 'Indiana',
    IL: 'Illinois', MN: 'Minnesota', IA: 'Iowa', MO: 'Missouri', NE: 'Nebraska',
  };

  it('registers thirteen distinct providers, east to west', () => {
    expect(metas).toHaveLength(13);
    expect(ids.size).toBe(13);
    expect(new Set(metas.map((meta) => meta.endpoint)).size).toBe(13);
    const longitudes = metas.map((meta) => meta.center[0]);
    expect(longitudes).toEqual([...longitudes].sort((a, b) => b - a));
    for (const meta of metas) {
      expect(existing.map((other) => other.id), meta.id).not.toContain(meta.id);
      expect(existing.map((other) => other.endpoint), meta.id).not.toContain(meta.endpoint);
    }
  });

  it('declares complete, honest metadata', () => {
    for (const meta of metas) {
      expect(meta.id, meta.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(meta.label, meta.id).toBe(`${meta.city}, ${STATES[meta.state]}`);
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: meta.timeZone }), meta.id).not.toThrow();
      expect(meta.timeZone, meta.id).toMatch(/^America\//);
      expect(Number.isInteger(meta.settlingDays) && meta.settlingDays >= 0 && meta.settlingDays < 22, meta.id).toBe(true);
      expect(meta.endpoint, meta.id).toMatch(/^https:\/\//);
      expect(meta.sourceUrl, meta.id).toMatch(/^https:\/\//);
      expect(meta.datasetStart === null || /^\d{4}-\d{2}-\d{2}$/.test(meta.datasetStart), meta.id).toBe(true);
      expect(meta.lastVerified, meta.id).toBe('2026-10-21');
      for (const text of [meta.agency, meta.datasetName, meta.cadence, meta.delayNote, meta.precisionNote, meta.coverageNote]) {
        expect(text.length, meta.id).toBeGreaterThan(5);
      }
    }
    expect(Object.fromEntries(metas.map((meta) => [meta.id, meta.datasetStart]))).toEqual({
      boston: null,
      hartford: '2026-01-01',
      rochester: null,
      buffalo: null,
      cleveland: '2025-11-11',
      columbus: null,
      cincinnati: null,
      indianapolis: null,
      'aurora-il': null,
      minneapolis: '2026-01-01',
      'des-moines': null,
      'kansas-city': '2026-01-01',
      omaha: null,
    });
  });

  it('keeps every center inside its own bounds and outside every other provider\'s', () => {
    const all = [...metas, ...existing];
    for (const meta of all) {
      const claimants = all.filter((candidate) => pointIsWithinBounds(meta.center, candidate.bounds)).map((candidate) => candidate.id);
      expect(claimants, meta.id).toEqual([meta.id]);
    }
  });

  it('features one place per provider inside its bounds, with unique labels', () => {
    expect(NORTHEAST_FEATURED_PLACES).toHaveLength(NORTHEAST_PROVIDERS.length);
    NORTHEAST_FEATURED_PLACES.forEach((place, index) => {
      const meta = metas[index];
      expect(place.detail).toBe(meta?.label);
      expect(meta && pointIsWithinBounds(place.coordinates, meta.bounds), place.label).toBe(true);
      const claimants = [...metas, ...existing].filter((candidate) => pointIsWithinBounds(place.coordinates, candidate.bounds));
      expect(claimants.map((candidate) => candidate.id), place.label).toEqual([meta?.id]);
    });
    const labels = [...NORTHEAST_FEATURED_PLACES, ...FEATURED_PLACES.filter((place) => !NORTHEAST_FEATURED_PLACES.includes(place))]
      .map((place) => place.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('names a Census place GEOID for every provider', () => {
    expect(Object.keys(NORTHEAST_JURISDICTIONS)).toEqual(metas.map((meta) => meta.id));
    for (const geoids of Object.values(NORTHEAST_JURISDICTIONS)) {
      for (const geoid of [geoids].flat()) expect(geoid).toMatch(/^\d{7}$/);
    }
  });
});
