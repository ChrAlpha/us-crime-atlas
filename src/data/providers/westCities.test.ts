import { describe, expect, it, vi } from 'vitest';
import { pointIsWithinBounds } from '../../domain/geo';
import type { Incident, IncidentProvider, IncidentQuery } from '../../types';
import { ARCGIS_MAX_PAGES, ARCGIS_PAGE_SIZE } from './arcgis';
import { ARCGIS_LAYER_CONTRACTS } from './arcgisCities';
import { providers as registeredProviders } from './index';
import {
  auroraCoProvider,
  bakersfieldProvider,
  berkeleyProvider,
  boulderProvider,
  coloradoSpringsProvider,
  compositeId,
  hourClock,
  hundredBlock,
  lasVegasProvider,
  mapAuroraCoFeature,
  mapBakersfieldFeature,
  mapBerkeleyFeature,
  mapBoulderFeature,
  mapColoradoSpringsRow,
  mapLasVegasFeature,
  mapMesaRow,
  mapRiversideFeature,
  mapSacramentoFeature,
  mapSaltLakeCityFeature,
  mapSanMateoFeature,
  mapTacomaFeature,
  mapTempeFeature,
  mapTucsonFeature,
  mesaProvider,
  riversideProvider,
  sacramentoProvider,
  saltLakeCityProvider,
  SAN_MATEO_FILTER,
  sanMateoProvider,
  tacomaProvider,
  TEMPE_FILTER,
  tempeProvider,
  tucsonProvider,
  WEST_FEATURED_PLACES,
  WEST_JURISDICTIONS,
  WEST_PROVIDERS,
  withLocalClock,
} from './westCities';

const utc = (value: string) => Date.parse(`${value}Z`);

const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

function query(provider: IncidentProvider): IncidentQuery {
  return { center: provider.meta.center, radiusMeters: 1000, startEpochMs: day('2026-09-20'), endEpochMs: day('2026-10-20') };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Serves empty ArcGIS or Socrata responses (with an optional count), recording every URL. */
function stubFetch(count = 0) {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    if (url.searchParams.get('returnCountOnly') === 'true') return jsonResponse({ count });
    if (url.searchParams.get('$select') === 'count(*) AS total') return jsonResponse([{ total: String(count) }]);
    if (url.pathname.endsWith('.json')) return jsonResponse([]);
    return jsonResponse({ features: [] });
  }));
  return urls;
}

const arcgisPages = (urls: URL[]) => urls.filter((url) => url.searchParams.has('outFields'));

describe('West helpers', () => {
  it('joins composite identities only when the primary identifier exists', () => {
    expect(compositeId({ a: 'A-1', b: 'B', c: 3 }, 'a', 'b', 'c')).toBe('A-1:B:3');
    expect(compositeId({ a: 'A-1' }, 'a', 'b')).toBe('A-1:');
    expect(compositeId({ a: '  ', b: 'B' }, 'a', 'b')).toBe('');
  });

  it.each([
    ['2614 ENSENADA WY', '2600 BLOCK ENSENADA WY'],
    ['99 MAIN ST', '0 BLOCK MAIN ST'],
    ['123A  MAIN ST', '100 BLOCK MAIN ST'],
    ['3500 BLOCK  W La Cadena Dr', '3500 BLOCK W La Cadena Dr'],
    ['7000 BLK East Broadway Boulevard', '7000 BLK East Broadway Boulevard'],
    ['CONCAR DR/PACIFIC BL', 'CONCAR DR/PACIFIC BL'],
    ['Generalized block', 'Generalized block'],
  ])('generalizes %j to %j', (label, expected) => {
    expect(hundredBlock(label)).toBe(expected);
  });

  it('reads integer hours only', () => {
    expect(hourClock(0)).toBe('00:00:00');
    expect(hourClock(23)).toBe('23:00:00');
    for (const value of [24, -1, 1.5, '5', null, undefined]) expect(hourClock(value)).toBeNull();
  });

  it('re-times an incident from a separate day and time of day', () => {
    const base = mapTucsonFeature({
      attributes: { IncidentNumber: 'T-1', OccurredDateTime: utc('2026-10-20T01:00:00'), PublicLongitude: -110.97, PublicLatitude: 32.22 },
    }) as Incident;
    expect(withLocalClock(base, '14:30:00')).toMatchObject({
      occurredAt: '2026-10-20T14:30:00',
      occurredAtEpochMs: utc('2026-10-20T14:30:00'),
      localHour: 14,
    });
    expect(withLocalClock(base, null)).toMatchObject({ occurredAt: '2026-10-20T00:00:00', localHour: null });
    expect(withLocalClock(base, '00:00:00', '2026-10-21')).toMatchObject({ occurredAt: '2026-10-21T00:00:00', localHour: 0 });
    expect(withLocalClock(base, null, '2026-02-30')).toBeNull();
  });
});

describe('Berkeley', () => {
  const base = {
    Case_Number: '2026-00046843',
    Occurred_Datetime: utc('2026-10-20T06:13:00'),
    Incident_Type: 'Robbery',
    Statute: 'PC 211',
    Statute_Description: 'ROBBERY (2nd Degree)',
    Block_Address: 'GRAYSON ST  &  7TH ST',
    lat: 37.85530496091133,
    lon: -122.2924726190853,
    ObjectId: 31,
  };

  it('converts UTC epochs to Pacific time and rounds coordinates', () => {
    expect(mapBerkeleyFeature({ attributes: base })).toMatchObject({
      id: 'berkeley:2026-00046843:PC 211:ROBBERY (2nd Degree)',
      occurredAt: '2026-10-19T23:13:00',
      occurredAtEpochMs: utc('2026-10-19T23:13:00'),
      localHour: 23,
      category: 'robbery',
      group: 'violent',
      rawCategory: 'Robbery',
      description: 'ROBBERY (2nd Degree)',
      locationLabel: 'GRAYSON ST  &  7TH ST',
      coordinates: [-122.292, 37.855],
      precision: 'approximate',
    });
  });

  it('keeps statute rows of one case apart, even with a repeated statute', () => {
    const second = mapBerkeleyFeature({ attributes: { ...base, Statute: 'PC 530.5 (A)', Statute_Description: 'GET CREDIT/ETC OTHER\'S ID BY IMPERSONATION' } });
    const third = mapBerkeleyFeature({ attributes: { ...base, Statute: 'PC 530.5 (A)', Statute_Description: 'GET CREDIT/ETC OTHER\'S ID BY FALSE PRETENSES' } });
    expect(new Set([mapBerkeleyFeature({ attributes: base })?.id, second?.id, third?.id]).size).toBe(3);
  });

  it('drops rows without a case number, date or coordinates', () => {
    expect(mapBerkeleyFeature({ attributes: { ...base, Case_Number: null } })).toBeNull();
    expect(mapBerkeleyFeature({ attributes: { ...base, Occurred_Datetime: null } })).toBeNull();
    expect(mapBerkeleyFeature({ attributes: { ...base, lat: null } })).toBeNull();
  });
});

describe('San Mateo', () => {
  const feature = {
    attributes: {
      OBJECTID: 50991,
      DATEX: utc('2026-10-03T00:00:00'),
      ADDRESS: '1941 S EL CAMINO REAL',
      OFFDESC1: 'Theft by use of access card information - Credit card/atm (F)',
    },
    geometry: { x: -122.31021559999999, y: 37.5489810000295 },
  };

  it('keeps the local day without an hour and generalizes exact addresses', () => {
    expect(mapSanMateoFeature(feature)).toMatchObject({
      id: 'san-mateo:50991',
      occurredAt: '2026-10-03T00:00:00',
      occurredAtEpochMs: utc('2026-10-03T00:00:00'),
      localHour: null,
      category: 'theft',
      locationLabel: '1900 BLOCK S EL CAMINO REAL',
      coordinates: [-122.31, 37.549],
      precision: 'approximate',
    });
  });

  it('keeps intersections and falls back without an address', () => {
    expect(mapSanMateoFeature({ ...feature, attributes: { ...feature.attributes, ADDRESS: 'E 3RD AV/S B ST' } })?.locationLabel)
      .toBe('E 3RD AV/S B ST');
    expect(mapSanMateoFeature({ ...feature, attributes: { ...feature.attributes, ADDRESS: null } })?.locationLabel)
      .toBe('Generalized block');
  });

  it('drops rows without geometry or attributes', () => {
    expect(mapSanMateoFeature({ attributes: feature.attributes, geometry: null })).toBeNull();
    expect(mapSanMateoFeature({ geometry: feature.geometry })).toBeNull();
  });

  it('excludes non-criminal report types and escapes quoted values', () => {
    expect(SAN_MATEO_FILTER).toMatch(/^REPORT = 'Y' AND OFFDESC1 NOT IN \('Mental Health Evaluation', /);
    expect(SAN_MATEO_FILTER).toContain("'Coroner''s Case'");
    expect(SAN_MATEO_FILTER).not.toMatch(/RACE|SEX|AGE/);
  });
});

describe('Tacoma', () => {
  const base = {
    CaseNo: '2629300969',
    OBJECTID: 13742,
    DateOccurred: utc('2026-10-20T00:00:00'),
    Approximate_Time: '3:00',
    Offense_Category: 'Burglary/Breaking & Entering',
    Description: 'Burglary',
    Address: '1800 S 84TH ST',
    Latitude: 47.182398,
    Longitude: -122.461539,
  };

  it('joins the local day with the approximate hour', () => {
    expect(mapTacomaFeature({ attributes: base })).toMatchObject({
      id: 'tacoma:2629300969:13742',
      occurredAt: '2026-10-20T03:00:00',
      occurredAtEpochMs: utc('2026-10-20T03:00:00'),
      localHour: 3,
      category: 'burglary',
      group: 'property',
      description: 'Burglary',
      locationLabel: '1800 S 84TH ST',
      coordinates: [-122.462, 47.182],
      precision: 'approximate',
    });
  });

  it('keeps midnight but no hour when the time is missing or unreadable', () => {
    for (const time of [null, '', '25:00']) {
      expect(mapTacomaFeature({ attributes: { ...base, Approximate_Time: time } })).toMatchObject({
        occurredAt: '2026-10-20T00:00:00',
        localHour: null,
      });
    }
    expect(mapTacomaFeature({ attributes: { ...base, Approximate_Time: '0:00' } })?.localHour).toBe(0);
  });

  it('drops rows without coordinates', () => {
    expect(mapTacomaFeature({ attributes: { ...base, Latitude: null } })).toBeNull();
  });
});

describe('Salt Lake City', () => {
  const feature = {
    attributes: {
      objectid: 2,
      case_nbr: '26-222904',
      crime_type: 'Violent',
      crime: 'Robbery - All Other',
      occur_dt: utc('2026-09-30T06:00:00'),
      occur_hr: 1,
      date_t: '2026/09/30',
      com_council: 'Downtown Community/Granary District Alliance',
    },
    geometry: { x: -111.90434361648724, y: 40.756301532603814 },
  };

  it('joins the published local day with its hour at the nearest intersection', () => {
    expect(mapSaltLakeCityFeature(feature)).toMatchObject({
      id: 'salt-lake-city:26-222904:Robbery - All Other',
      occurredAt: '2026-09-30T01:00:00',
      occurredAtEpochMs: utc('2026-09-30T01:00:00'),
      localHour: 1,
      category: 'robbery',
      rawCategory: 'Violent',
      description: 'Robbery - All Other',
      locationLabel: 'Downtown Community/Granary District Alliance',
      coordinates: [-111.90434361648724, 40.756301532603814],
      precision: 'intersection',
    });
  });

  it('reads the local day from date_t, else from the UTC midnight epoch', () => {
    // A fixed 06:00Z in winter would be 23:00 the previous evening in Mountain Standard Time.
    expect(mapSaltLakeCityFeature({
      ...feature,
      attributes: { ...feature.attributes, occur_dt: utc('2026-01-15T06:00:00'), date_t: '2026/01/15', occur_hr: 23 },
    })?.occurredAt).toBe('2026-01-15T23:00:00');
    expect(mapSaltLakeCityFeature({
      ...feature,
      attributes: { ...feature.attributes, occur_dt: utc('2026-01-15T07:00:00'), date_t: null },
    })?.occurredAt).toBe('2026-01-15T01:00:00');
  });

  it('has no hour without occur_hr, and drops rows without geometry', () => {
    expect(mapSaltLakeCityFeature({ ...feature, attributes: { ...feature.attributes, occur_hr: null } }))
      .toMatchObject({ occurredAt: '2026-09-30T00:00:00', localHour: null });
    expect(mapSaltLakeCityFeature({ attributes: feature.attributes })).toBeNull();
  });
});

describe('Boulder', () => {
  const feature = {
    attributes: {
      OID: 88726,
      Report_Number: '2608832',
      inc_date: utc('2026-09-28T02:11:21'),
      nibrs_offense: 'Destruction / Damage / Vandalism of Property',
      NIBRSdescription: 'Damage/Vandalism',
      vio_desc: 'CRIMINAL MISCHIEF $300 TO <$999',
      STAddress: '3XX PEARL',
    },
    geometry: { x: -105.24895738800231, y: 40.02360000000178 },
  };

  it('keeps local wall-clock epochs and rounds the point', () => {
    expect(mapBoulderFeature(feature)).toMatchObject({
      id: 'boulder:2608832:88726',
      occurredAt: '2026-09-28T02:11:21',
      localHour: 2,
      category: 'other',
      rawCategory: 'Destruction / Damage / Vandalism of Property',
      description: 'CRIMINAL MISCHIEF $300 TO <$999',
      locationLabel: '3XX PEARL',
      coordinates: [-105.249, 40.024],
      precision: 'approximate',
    });
  });

  it('falls back to the short NIBRS description and the masked-block label', () => {
    expect(mapBoulderFeature({
      ...feature,
      attributes: { ...feature.attributes, nibrs_offense: null, NIBRSdescription: 'Theft Offenses', vio_desc: 'THEFT $300-$1000', STAddress: null },
    })).toMatchObject({ rawCategory: 'Theft Offenses', category: 'theft', locationLabel: 'Masked block' });
  });

  it('drops rows without a point', () => {
    expect(mapBoulderFeature({ attributes: feature.attributes, geometry: { x: null, y: null } })).toBeNull();
  });
});

describe('Aurora, Colorado', () => {
  const feature = {
    attributes: {
      OBJECTID: 64247,
      OffenseId: 'AP2026202509',
      OccurFrDate: utc('2026-09-30T00:00:00'),
      OffenseCat: 'Larceny/Theft Offenses',
      NIBRSDesc: 'LARCENY FROM BUILDING',
      Neighborhood: 'Highpoint',
      LocateDesc: 'GROCERY/SUPERMARKET',
    },
    geometry: { x: -104.76528737353264, y: 39.63880586200213 },
  };

  it('keeps the local occurrence day without an hour', () => {
    expect(mapAuroraCoFeature(feature)).toMatchObject({
      id: 'aurora-co:AP2026202509',
      providerId: 'aurora-co',
      occurredAt: '2026-09-30T00:00:00',
      occurredAtEpochMs: utc('2026-09-30T00:00:00'),
      localHour: null,
      category: 'theft',
      group: 'property',
      locationLabel: 'Highpoint · GROCERY/SUPERMARKET',
      coordinates: [-104.765, 39.639],
      precision: 'approximate',
    });
  });

  it('drops rows without an occurrence date', () => {
    expect(mapAuroraCoFeature({ ...feature, attributes: { ...feature.attributes, OccurFrDate: null } })).toBeNull();
  });
});

describe('Colorado Springs', () => {
  const row = {
    casenumber: '2026-00378257',
    occurredfromdate: '2026-10-10T01:00:00.000',
    statute: '18-3-203(1)(i) F4',
    statutedescription: '2nd Degree Assault -strangulation causing BI',
    crimecodedescription: 'Aggravated Assault',
    nciccodedescription: 'Aggravated Assault-Nonfamily-Weapon (Identify Weapon)',
    domestic: 'No',
    streetaddress: '5800 WELKIN CIR',
    patrol_division: 'Stetson Hills',
    location_point: { type: 'Point', coordinates: [-104.72149, 38.89794] },
  };

  it('reads floating local timestamps and Point locations', () => {
    expect(mapColoradoSpringsRow(row)).toMatchObject({
      id: 'colorado-springs:2026-00378257:18-3-203(1)(i) F4:No',
      occurredAt: '2026-10-10T01:00:00',
      occurredAtEpochMs: utc('2026-10-10T01:00:00'),
      localHour: 1,
      category: 'assault',
      rawCategory: 'Aggravated Assault',
      description: '2nd Degree Assault -strangulation causing BI',
      locationLabel: '5800 WELKIN CIR · Stetson Hills',
      coordinates: [-104.72149, 38.89794],
      precision: 'block',
    });
  });

  it('keeps repeated statutes apart by the domestic-violence flag', () => {
    const harassment = { ...row, statute: '18-9-111(1)(a) M1', crimecodedescription: 'All Other Offenses', nciccodedescription: 'Harassing Communication' };
    const ids = [mapColoradoSpringsRow({ ...harassment, domestic: 'Yes' })?.id, mapColoradoSpringsRow({ ...harassment, domestic: 'No' })?.id];
    expect(new Set(ids).size).toBe(2);
    expect(mapColoradoSpringsRow({ ...harassment, domestic: undefined })?.id).toBe('colorado-springs:2026-00378257:18-9-111(1)(a) M1:');
  });

  it('classifies from NIBRS and NCIC codes, and from the statute only for unreportable codes', () => {
    expect(mapColoradoSpringsRow({
      ...row,
      crimecodedescription: 'Weapons Law Violations',
      nciccodedescription: 'Weapon Offense',
      statutedescription: 'Menacing with a weapon (assault)',
    })?.category).toBe('weapons');
    expect(mapColoradoSpringsRow({
      ...row,
      crimecodedescription: 'Not Reportable',
      nciccodedescription: undefined,
      statutedescription: 'Theft - Value $50 or more but < $300',
    })?.category).toBe('theft');
  });

  it('drops offenses without a published point or date', () => {
    expect(mapColoradoSpringsRow({ ...row, location_point: undefined })).toBeNull();
    expect(mapColoradoSpringsRow({ ...row, occurredfromdate: '' })).toBeNull();
  });
});

describe('Sacramento', () => {
  const feature = {
    attributes: {
      OBJECTID_1: 83378,
      Record_ID: '1857240',
      Occurrence_Date_UTC: utc('2026-10-07T06:56:00'),
      Offense_Category: 'ASSAULT',
      Description: '273.5(A) DOMESTIC VIOLENCE:F:INFLICT CORP INJ ON SPOUSE/COHAB-MINOR INJ & NO WEA',
      Location: 'FRANKLIN BLVD / FRUITRIDGE RD',
    },
    geometry: { x: -121.47176099538416, y: 38.52489526856204 },
  };

  it('converts UTC epochs to Pacific time', () => {
    expect(mapSacramentoFeature(feature)).toMatchObject({
      id: 'sacramento:1857240:83378',
      occurredAt: '2026-10-06T23:56:00',
      localHour: 23,
      category: 'assault',
      locationLabel: 'FRANKLIN BLVD / FRUITRIDGE RD',
      coordinates: [-121.472, 38.525],
      precision: 'approximate',
    });
  });

  it('drops confidential reports that publish no location', () => {
    expect(mapSacramentoFeature({ attributes: feature.attributes })).toBeNull();
  });
});

describe('Las Vegas', () => {
  const base = {
    OBJECTID: 238203,
    Event_Number: 'LLV261000065808',
    ReportedOn: utc('2026-10-18T12:27:31.987'),
    OffenseCategory: 'GROUP "B" OFFENSES',
    Offense: 'Trespass of Real Property',
    NIBRSOffenseCode: '90J',
    Location: '3700 S LAS VEGAS BLVD',
    Latitude: 36.10957343913246,
    Longitude: -115.17596688833835,
  };

  it('converts the UTC report time to Pacific time and rounds the point', () => {
    expect(mapLasVegasFeature({ attributes: base })).toMatchObject({
      id: 'las-vegas:LLV261000065808:90J:238203',
      occurredAt: '2026-10-18T05:27:31',
      localHour: 5,
      category: 'other',
      description: 'Trespass of Real Property',
      locationLabel: '3700 S LAS VEGAS BLVD',
      coordinates: [-115.176, 36.11],
      precision: 'approximate',
    });
  });

  it('keeps two rows of one event and offense code apart', () => {
    const assault = { ...base, OffenseCategory: 'ASSAULT OFFENSES', Offense: 'Aggravated Assault', NIBRSOffenseCode: '13A' };
    const first = mapLasVegasFeature({ attributes: assault });
    const second = mapLasVegasFeature({ attributes: { ...assault, OBJECTID: 238204 } });
    expect(first).toMatchObject({ category: 'assault', isViolent: true });
    expect(first?.id).not.toBe(second?.id);
  });

  it('drops null-island and missing coordinates', () => {
    expect(mapLasVegasFeature({ attributes: { ...base, Latitude: 0, Longitude: 0 } })).toBeNull();
    expect(mapLasVegasFeature({ attributes: { ...base, Location: null, Latitude: null, Longitude: null } })).toBeNull();
  });
});

describe('Bakersfield', () => {
  const feature = {
    attributes: {
      ObjectID: 36522,
      USER_event_date: utc('2026-10-17T13:58:00'),
      USER_nibrs_desc: 'AGG ASSAULT     ',
      USER_nibrs_long_desc: '(WEAPON AND/OR SEVERE INJURY) ASSAULT-ADW-FORCE-NO FIREARM-GBI LIKELY           ',
    },
    geometry: { x: -119.01765374262955, y: 35.37999071661854 },
  };

  it('keeps local wall-clock epochs and trims padded codes', () => {
    expect(mapBakersfieldFeature(feature)).toMatchObject({
      id: 'bakersfield:36522',
      occurredAt: '2026-10-17T13:58:00',
      localHour: 13,
      category: 'assault',
      rawCategory: 'AGG ASSAULT',
      description: '(WEAPON AND/OR SEVERE INJURY) ASSAULT-ADW-FORCE-NO FIREARM-GBI LIKELY',
      locationLabel: 'Approximate public location',
      coordinates: [-119.018, 35.38],
      precision: 'approximate',
    });
  });

  it('drops rows without a date', () => {
    expect(mapBakersfieldFeature({ ...feature, attributes: { ...feature.attributes, USER_event_date: null } })).toBeNull();
  });
});

describe('Riverside', () => {
  const feature = {
    attributes: {
      ObjectID: 1516665,
      rpdunique: '260028130_23H_0',
      offendate: utc('2026-10-20T18:27:54.290'),
      nibrsdesc: 'Larceny',
      IBRCrimeAgainst: 'Property',
      BLOCK_ADDRESS: '3500 BLOCK  W La Cadena Dr',
    },
    geometry: { x: -117.36122739693148, y: 33.99698747051653 },
  };

  it('keeps the local record-entry day without an hour', () => {
    expect(mapRiversideFeature(feature)).toMatchObject({
      id: 'riverside:260028130_23H_0',
      occurredAt: '2026-10-20T00:00:00',
      occurredAtEpochMs: utc('2026-10-20T00:00:00'),
      localHour: null,
      category: 'theft',
      description: 'Property',
      locationLabel: '3500 BLOCK W La Cadena Dr',
      coordinates: [-117.361, 33.997],
      precision: 'approximate',
    });
  });

  it('converts to the Pacific day before dropping the entry time', () => {
    expect(mapRiversideFeature({ ...feature, attributes: { ...feature.attributes, offendate: utc('2026-10-21T03:30:00') } })?.occurredAt)
      .toBe('2026-10-20T00:00:00');
  });

  it('generalizes approximate street addresses to the hundred block', () => {
    expect(mapRiversideFeature({ ...feature, attributes: { ...feature.attributes, BLOCK_ADDRESS: 'Approx Loc: 2710 Durahart St' } })?.locationLabel)
      .toBe('2700 BLOCK Durahart St');
    expect(mapRiversideFeature({ ...feature, attributes: { ...feature.attributes, BLOCK_ADDRESS: 'Magnolia Ave And Polk St' } })?.locationLabel)
      .toBe('Magnolia Ave And Polk St');
  });

  it('drops rows without an entry date', () => {
    expect(mapRiversideFeature({ ...feature, attributes: { ...feature.attributes, offendate: null } })).toBeNull();
  });
});

describe('Tempe', () => {
  const base = {
    OBJECTID: 386001,
    PrimaryKey: 'TE2026106613        ',
    OccurrenceDatetime: utc('2026-10-20T16:22:00'),
    OffenseCustom: '[35A] DRUG/NARCOTIC OFFENSE (INCL CRIMINAL MARIJUANA VIOLATIONS)                ',
    ObfuscatedAddress: '4XXX S RURAL RD',
    NeighborhoodName: null,
    Latitude: 33.382032,
    Longitude: -111.927333,
  };

  it('keeps local wall-clock epochs, trims padded text and rounds coordinates', () => {
    expect(mapTempeFeature({ attributes: base })).toMatchObject({
      id: 'tempe:TE2026106613',
      occurredAt: '2026-10-20T16:22:00',
      localHour: 16,
      rawCategory: '[35A] DRUG/NARCOTIC OFFENSE (INCL CRIMINAL MARIJUANA VIOLATIONS)',
      category: 'other',
      locationLabel: '4XXX S RURAL RD',
      coordinates: [-111.927, 33.382],
      precision: 'approximate',
    });
  });

  it('labels unclassified offenses and adds the neighborhood', () => {
    expect(mapTempeFeature({ attributes: { ...base, OffenseCustom: null, NeighborhoodName: 'Papago Parkway' } })).toMatchObject({
      rawCategory: 'Unclassified',
      locationLabel: '4XXX S RURAL RD · Papago Parkway',
    });
  });

  it('drops rows without coordinates', () => {
    expect(mapTempeFeature({ attributes: { ...base, Longitude: null } })).toBeNull();
  });

  it('excludes service calls and non-criminal general offenses except hit-and-run', () => {
    expect(TEMPE_FILTER).toBe("OffenseCustom NOT LIKE '%SC-0]%' AND (OffenseCustom NOT LIKE '%GO-0]%' OR OffenseCustom LIKE '%HIT AND RUN%')");
  });
});

describe('Mesa', () => {
  const row = {
    offense_uid: '2026243400-5',
    crime_id: '2026243400',
    occurred_date: '2026-10-19T00:00:00.000',
    offense_description: 'All Other Offenses',
    local_offense_description: 'RESISTING ARREST',
    crime_type: 'DISORDERLY CONDUCT -DV',
    address: '200 E 1ST AVE',
    latitude: '33.4128799',
    longitude: '-111.8249595',
  };

  it('keeps the occurrence date without an hour and reads text coordinates', () => {
    expect(mapMesaRow(row)).toMatchObject({
      id: 'mesa:2026243400-5',
      occurredAt: '2026-10-19T00:00:00',
      occurredAtEpochMs: utc('2026-10-19T00:00:00'),
      localHour: null,
      rawCategory: 'All Other Offenses',
      description: 'RESISTING ARREST',
      category: 'other',
      locationLabel: '200 E 1ST AVE',
      coordinates: [-111.8249595, 33.4128799],
      precision: 'block',
    });
  });

  it('classifies each offense row on its own, not by the incident crime type', () => {
    expect(mapMesaRow({
      ...row,
      offense_description: 'Weapon Law Violations',
      local_offense_description: 'PROHIBITED POSSESSER',
      crime_type: 'AGGRAVATED ASSAULT',
    })?.category).toBe('weapons');
  });

  it('drops sensitive incidents whose location is withheld', () => {
    expect(mapMesaRow({ ...row, address: undefined, latitude: undefined, longitude: undefined })).toBeNull();
  });
});

describe('Tucson', () => {
  const base = {
    OBJECTID: 134626,
    IncidentNumber: 'P2610200010',
    OccurredDateTime: utc('2026-10-20T01:00:00'),
    UCRSummaryDescription: 'CRIMINAL DAMAGE',
    StatuteDescription: 'Criminal Damage - Intentional Vandalism',
    Address100Block: '7000 BLK East Broadway Boulevard',
    PublicLatitude: 32.22181625373325,
    PublicLongitude: -110.84525219505024,
  };

  it('keeps local wall-clock epochs and the skewed public point', () => {
    expect(mapTucsonFeature({ attributes: base })).toMatchObject({
      id: 'tucson:P2610200010',
      occurredAt: '2026-10-20T01:00:00',
      localHour: 1,
      category: 'other',
      locationLabel: '7000 BLK East Broadway Boulevard',
      coordinates: [-110.84525219505024, 32.22181625373325],
      precision: 'approximate',
    });
  });

  it('classifies GTA from the statute description', () => {
    expect(mapTucsonFeature({
      attributes: { ...base, UCRSummaryDescription: 'GTA', StatuteDescription: 'Motor Vehicle Theft - Stolen and/or Recovered Vehicle' },
    })).toMatchObject({ category: 'vehicle', group: 'vehicle' });
  });

  it('drops rows without public coordinates', () => {
    expect(mapTucsonFeature({ attributes: { ...base, PublicLatitude: null } })).toBeNull();
  });
});

describe('West ArcGIS wiring', () => {
  const geometryLayers = new Set([sanMateoProvider, saltLakeCityProvider, boulderProvider, auroraCoProvider, sacramentoProvider, bakersfieldProvider, riversideProvider]);
  const expected: Array<[IncidentProvider, string, string, string | null, number, string[]]> = [
    [berkeleyProvider, 'Occurred_Datetime', 'ObjectId', null, 1000, ['Case_Number', 'Statute', 'Statute_Description', 'Incident_Type', 'Block_Address', 'lat', 'lon']],
    [sanMateoProvider, 'DATEX', 'OBJECTID', SAN_MATEO_FILTER, ARCGIS_PAGE_SIZE, ['OFFDESC1', 'ADDRESS']],
    [tacomaProvider, 'DateOccurred', 'OBJECTID', "Offense_Category IS NULL OR Offense_Category NOT LIKE 'Traffic Accident%'", 1000, ['CaseNo', 'Approximate_Time', 'Offense_Category', 'Description', 'Address', 'Latitude', 'Longitude']],
    [saltLakeCityProvider, 'occur_dt', 'objectid', null, ARCGIS_PAGE_SIZE, ['case_nbr', 'crime', 'crime_type', 'occur_hr', 'date_t', 'com_council']],
    [boulderProvider, 'inc_date', 'OID', null, ARCGIS_PAGE_SIZE, ['Report_Number', 'nibrs_offense', 'NIBRSdescription', 'vio_desc', 'STAddress']],
    [auroraCoProvider, 'OccurFrDate', 'OBJECTID', null, ARCGIS_PAGE_SIZE, ['OffenseId', 'OffenseCat', 'NIBRSDesc', 'Neighborhood', 'LocateDesc']],
    [sacramentoProvider, 'Occurrence_Date_UTC', 'OBJECTID_1', "Offense_Code NOT IN ('INC', '5400')", ARCGIS_PAGE_SIZE, ['Record_ID', 'Offense_Category', 'Description', 'Location']],
    [lasVegasProvider, 'ReportedOn', 'OBJECTID', null, ARCGIS_PAGE_SIZE, ['Event_Number', 'NIBRSOffenseCode', 'OffenseCategory', 'Offense', 'Location', 'Latitude', 'Longitude']],
    [bakersfieldProvider, 'USER_event_date', 'ObjectID', null, ARCGIS_PAGE_SIZE, ['USER_nibrs_desc', 'USER_nibrs_long_desc']],
    [riversideProvider, 'offendate', 'ObjectID', null, ARCGIS_PAGE_SIZE, ['rpdunique', 'nibrsdesc', 'IBRCrimeAgainst', 'BLOCK_ADDRESS']],
    [tempeProvider, 'OccurrenceDatetime', 'OBJECTID', TEMPE_FILTER, ARCGIS_PAGE_SIZE, ['PrimaryKey', 'OffenseCustom', 'ObfuscatedAddress', 'NeighborhoodName', 'Latitude', 'Longitude']],
    [tucsonProvider, 'OccurredDateTime', 'OBJECTID', "MaxGRC = '1'", 1000, ['IncidentNumber', 'UCRSummaryDescription', 'StatuteDescription', 'Address100Block', 'PublicLatitude', 'PublicLongitude']],
  ];

  it.each(expected)('queries %# with its reviewed fields, filter, geometry and page size', async (provider, dateField, objectIdField, filter, pageSize, fields) => {
    const urls = stubFetch();
    await provider.fetchIncidents(query(provider));
    const page = arcgisPages(urls)[0];
    expect(`${page?.origin}${page?.pathname}`).toBe(`${provider.meta.endpoint}/query`);
    const where = page?.searchParams.get('where') ?? '';
    expect(where).toMatch(new RegExp(`^${dateField} >= TIMESTAMP '[^']+' AND ${dateField} < TIMESTAMP '[^']+'`));
    if (filter) expect(where).toContain(` AND (${filter})`);
    else expect(where).not.toContain('(');
    expect(page?.searchParams.get('orderByFields')).toBe(`${dateField} DESC,${objectIdField} ASC`);
    expect(page?.searchParams.get('resultRecordCount')).toBe(String(pageSize));
    if (geometryLayers.has(provider)) {
      expect(page?.searchParams.get('returnGeometry')).toBe('true');
      expect(page?.searchParams.get('outSR')).toBe('4326');
    } else {
      expect(page?.searchParams.get('returnGeometry')).toBe('false');
      expect(page?.searchParams.has('outSR')).toBe(false);
    }
    const outFields = page?.searchParams.get('outFields')?.split(',') ?? [];
    expect(outFields).toEqual(expect.arrayContaining([dateField, objectIdField, ...fields]));
    expect(outFields).not.toContain('*');
    expect(outFields).not.toContain('Subject');
    expect(new Set(outFields).size).toBe(outFields.length);
  });

  it('puts the Tacoma table bounding box in SQL instead of an envelope', async () => {
    const urls = stubFetch();
    await tacomaProvider.fetchIncidents(query(tacomaProvider));
    const page = arcgisPages(urls)[0];
    expect(page?.searchParams.get('where')).toMatch(
      /\(Offense_Category IS NULL OR Offense_Category NOT LIKE 'Traffic Accident%'\) AND Latitude >= 47\.\d{7} AND Latitude <= 47\.\d{7} AND Longitude >= -122\.\d{7} AND Longitude <= -122\.\d{7}$/,
    );
    expect(page?.searchParams.has('geometry')).toBe(false);
  });

  it('never requests San Mateo demographic attributes', async () => {
    const urls = stubFetch();
    await sanMateoProvider.fetchIncidents(query(sanMateoProvider));
    const outFields = arcgisPages(urls)[0]?.searchParams.get('outFields')?.split(',') ?? [];
    for (const field of ['RACE', 'SEX', 'AGE', 'RESCITY', 'ARREST', 'FORCEUSED']) expect(outFields).not.toContain(field);
  });

  it('pages 1,000-row layers ten times, keeping the record budget', async () => {
    const urls = stubFetch(25_000);
    const batch = await berkeleyProvider.fetchIncidents(query(berkeleyProvider));
    const pages = arcgisPages(urls);
    expect(pages.map((url) => url.searchParams.get('resultRecordCount'))).toEqual(Array(10).fill('1000'));
    expect(pages.map((url) => Number(url.searchParams.get('resultOffset')))).toEqual(Array.from({ length: 10 }, (_, index) => index * 1000));
    expect(batch.recordLimit).toBe(ARCGIS_PAGE_SIZE * ARCGIS_MAX_PAGES);
    expect(batch.truncated).toBe(true);
  });

  it('applies the reviewed filter to the newest-record lookup', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      urls.push(new URL(input));
      return jsonResponse({ features: [{ attributes: { latest_record: utc('2026-10-20T01:00:00') } }] });
    }));
    tucsonProvider.resetCache?.();
    await expect(tucsonProvider.fetchLatestRecordEpoch()).resolves.toBe(utc('2026-10-20T01:00:00'));
    expect(urls[0]?.searchParams.get('where')).toContain(" AND (MaxGRC = '1')");
    tucsonProvider.resetCache?.();
  });

  it('maps fetched features through the refined mappers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('returnCountOnly') === 'true') return jsonResponse({ count: 1 });
      return jsonResponse({
        features: [{
          attributes: {
            CaseNo: '2629300555', OBJECTID: 26760, DateOccurred: day('2026-10-19'), Approximate_Time: '8:00',
            Offense_Category: 'Larceny/Theft Offenses', Description: 'Larceny Theft', Address: '1000 S WHITMAN ST',
            Latitude: 47.250398, Longitude: -122.522539,
          },
        }],
      });
    }));
    const batch = await tacomaProvider.fetchIncidents(query(tacomaProvider));
    expect(batch.incidents).toHaveLength(1);
    expect(batch.incidents[0]).toMatchObject({ id: 'tacoma:2629300555:26760', occurredAt: '2026-10-19T08:00:00', localHour: 8 });
  });

  it('registers a live layer contract for every West ArcGIS provider', () => {
    const contracts = new Map(ARCGIS_LAYER_CONTRACTS.map((contract) => [contract.meta.id, contract]));
    expect(Object.fromEntries(expected.map(([provider]) => [provider.meta.id, contracts.get(provider.meta.id)?.layerName]))).toEqual({
      berkeley: 'cases_latlon',
      'san-mateo': 'RIMS_CRIME_ALL',
      tacoma: 'City_Of_Tacoma_Reported_Crime',
      'salt-lake-city': 'PublicCrime_At_Intersections',
      boulder: 'Offenses',
      'aurora-co': 'import',
      sacramento: 'PD_Crime_3Years',
      'las-vegas': 'Reported NIBRS Crime',
      bakersfield: 'COB_Offenses',
      riverside: 'Crime (Last Year to Date)',
      tempe: 'General Offense',
      tucson: 'TPDReportedCrimes2026',
    });
    expect(contracts.get('tacoma')).toMatchObject({ dateField: 'DateOccurred', epochSemantics: 'local-clock', pageSize: 1000 });
    expect(contracts.get('tacoma')?.outFields).toContain('Approximate_Time');
    expect(contracts.get('salt-lake-city')).toMatchObject({ epochSemantics: 'utc', outFields: expect.arrayContaining(['occur_hr', 'date_t']) });
  });
});

describe('West Socrata wiring', () => {
  it('queries Mesa with explicit fields, numeric bounds and the unmatched-address filter', async () => {
    const urls = stubFetch();
    await mesaProvider.fetchIncidents(query(mesaProvider));
    const page = urls.find((url) => url.searchParams.has('$order'));
    expect(page?.searchParams.get('$select')?.split(',')).toEqual(
      expect.arrayContaining(['offense_uid', 'occurred_date', 'offense_description', 'local_offense_description', 'address', 'latitude', 'longitude']),
    );
    expect(page?.searchParams.get('$select')).not.toContain('crime_type');
    expect(page?.searchParams.get('$where')).toMatch(
      /^occurred_date >= '2026-09-20' AND occurred_date < '2026-10-20' AND latitude >= 33\.\d+ AND latitude <= 33\.\d+ AND longitude >= -111\.\d+ AND longitude <= -111\.\d+ AND \(verified != 0\)$/,
    );
    expect(page?.searchParams.get('$order')).toBe('occurred_date DESC, :id');
  });

  it('queries Colorado Springs by Point and excludes rows classified as no crime', async () => {
    const urls = stubFetch();
    await coloradoSpringsProvider.fetchIncidents(query(coloradoSpringsProvider));
    const page = urls.find((url) => url.searchParams.has('$order'));
    expect(page?.searchParams.get('$select')?.split(',')).toEqual(
      expect.arrayContaining(['casenumber', 'statute', 'occurredfromdate', 'crimecodedescription', 'nciccodedescription', 'statutedescription', 'domestic', 'streetaddress', 'patrol_division', 'location_point']),
    );
    expect(page?.searchParams.get('$where')).toMatch(
      /AND within_box\(location_point, 38\.\d+, -104\.\d+, 38\.\d+, -104\.\d+\) AND \(index_crime_category IS NULL OR index_crime_category != 'Not A Crime'\)$/,
    );
  });
});

describe('West registry exports', () => {
  const metas = WEST_PROVIDERS.map((provider) => provider.meta);

  it('exports one featured place and one jurisdiction per provider, with unique identities', () => {
    expect(WEST_FEATURED_PLACES).toHaveLength(WEST_PROVIDERS.length);
    expect(Object.keys(WEST_JURISDICTIONS).sort()).toEqual(metas.map((meta) => meta.id).sort());
    expect(new Set(metas.map((meta) => meta.id)).size).toBe(metas.length);
    expect(new Set(metas.map((meta) => meta.endpoint)).size).toBe(metas.length);
    expect(new Set(WEST_FEATURED_PLACES.map((place) => place.label)).size).toBe(WEST_FEATURED_PLACES.length);
    for (const meta of metas) expect(meta.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it('lists Census place GEOIDs, with LVMPD covering the city and its unincorporated CDPs', () => {
    for (const references of Object.values(WEST_JURISDICTIONS)) {
      for (const reference of [references].flat()) expect(reference).toMatch(/^(?:cdp:)?\d{7}$/);
    }
    expect(WEST_JURISDICTIONS['las-vegas']).toEqual(expect.arrayContaining(['3240000', 'cdp:3254600', 'cdp:3284600', 'cdp:3268585', 'cdp:3223770', 'cdp:3271400']));
  });

  it('places each featured spot inside its own provider\'s bounds, in provider order', () => {
    WEST_FEATURED_PLACES.forEach((place, index) => {
      const meta = metas[index];
      expect(place.detail).toBe(meta?.label);
      expect(meta && pointIsWithinBounds(place.coordinates, meta.bounds), place.label).toBe(true);
    });
  });

  it('keeps every center inside its own bounds and outside every other provider\'s', () => {
    const others = [...metas, ...registeredProviders.map((provider) => provider.meta)];
    for (const meta of metas) {
      expect(pointIsWithinBounds(meta.center, meta.bounds), meta.id).toBe(true);
      const containing = others.filter((other) => other.id !== meta.id && pointIsWithinBounds(meta.center, other.bounds));
      expect(containing.map((other) => other.id), `${meta.id} center`).toEqual([]);
      const contained = others.filter((other) => other.id !== meta.id && pointIsWithinBounds(other.center, meta.bounds));
      expect(contained.map((other) => other.id), `${meta.id} bounds`).toEqual([]);
    }
  });

  it('declares complete, honest metadata', () => {
    for (const meta of metas) {
      expect(meta.label, meta.id).toMatch(new RegExp(`^${meta.city}, [A-Z][a-z]+$`));
      expect(meta.state, meta.id).toMatch(/^[A-Z]{2}$/);
      expect(meta.timeZone, meta.id).toMatch(/^America\/(?:Los_Angeles|Denver|Phoenix)$/);
      expect(Number.isInteger(meta.settlingDays) && meta.settlingDays >= 0 && meta.settlingDays < 22, meta.id).toBe(true);
      expect(meta.endpoint, meta.id).toMatch(/^https:\/\//);
      expect(meta.sourceUrl, meta.id).toMatch(/^https:\/\//);
      expect(meta.lastVerified, meta.id).toBe('2026-10-21');
      expect(meta.bounds.west < meta.bounds.east && meta.bounds.south < meta.bounds.north, meta.id).toBe(true);
      for (const note of [meta.cadence, meta.delayNote, meta.precisionNote, meta.coverageNote]) expect(note.length, meta.id).toBeGreaterThan(10);
    }
    expect(Object.fromEntries(metas.map((meta) => [meta.id, [meta.settlingDays, meta.datasetStart, meta.precision]]))).toEqual({
      berkeley: [2, null, 'approximate'],
      'san-mateo': [3, null, 'approximate'],
      tacoma: [4, null, 'approximate'],
      'salt-lake-city': [0, null, 'intersection'],
      boulder: [5, null, 'approximate'],
      'aurora-co': [3, null, 'approximate'],
      'colorado-springs': [11, null, 'block'],
      sacramento: [2, null, 'approximate'],
      'las-vegas': [9, '2025-01-01', 'approximate'],
      bakersfield: [5, null, 'approximate'],
      riverside: [12, null, 'approximate'],
      tempe: [21, null, 'approximate'],
      mesa: [16, null, 'block'],
      tucson: [11, '2026-01-01', 'approximate'],
    });
  });
});
