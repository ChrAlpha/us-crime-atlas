import { categoryGroup, isViolentCategory, normalizeCategory, severityForCategory } from '../../domain/categories';
import { combineDateAndTime, hourFromTimestamp, sourceTimestampToEpoch } from '../../domain/time';
import type { Incident, ProviderMeta } from '../../types';
import {
  arcgisNumber,
  arcgisText,
  arcgisTimestamp,
  createArcgisProvider,
  type ArcgisFeature,
} from './arcgis';
import {
  createAdaptiveSocrataProvider,
  resolvedCoordinates,
  resolvedText,
  type ResolvedSocrataFields,
  type SocrataAliasMap,
} from './adaptiveSocrata';

type FieldKey =
  | 'id'
  | 'secondaryId'
  | 'date'
  | 'time'
  | 'category'
  | 'description'
  | 'location'
  | 'area'
  | 'latitude'
  | 'longitude'
  | 'point';

type Fields = ResolvedSocrataFields<FieldKey>;

function aliases(overrides: Partial<SocrataAliasMap<FieldKey>>): SocrataAliasMap<FieldKey> {
  return {
    id: [],
    secondaryId: [],
    date: [],
    time: [],
    category: [],
    description: [],
    location: [],
    area: [],
    latitude: [],
    longitude: [],
    point: [],
    ...overrides,
  };
}

function rowValue(row: Record<string, unknown>, fields: Fields, key: FieldKey) {
  const field = fields[key];
  return field ? row[field] : undefined;
}

function localTimestamp(dateValue: string, timeValue: unknown) {
  const numeric = Number(timeValue);
  if (Number.isFinite(numeric)) {
    const padded = String(Math.trunc(numeric)).padStart(4, '0').slice(-4);
    return combineDateAndTime(dateValue, `${padded.slice(0, 2)}:${padded.slice(2)}:00`);
  }
  if (typeof timeValue === 'string' && /^\d{1,2}:?\d{2}/.test(timeValue.trim())) {
    const compact = timeValue.replace(/\D/g, '').padStart(4, '0').slice(0, 4);
    return combineDateAndTime(dateValue, `${compact.slice(0, 2)}:${compact.slice(2)}:00`);
  }
  return dateValue;
}

function incidentFromSocrata(
  meta: ProviderMeta,
  row: Record<string, unknown>,
  fields: Fields,
  options: { idPrefix: string; precisionLabel: string; combineTime?: boolean },
): Incident | null {
  const coordinates = resolvedCoordinates(row, fields, {
    latitudeKey: 'latitude',
    longitudeKey: 'longitude',
    pointKey: 'point',
  });
  const sourceDate = resolvedText(row, fields, 'date');
  if (!coordinates || !sourceDate) return null;

  const primaryId = resolvedText(row, fields, 'id');
  const secondaryId = resolvedText(row, fields, 'secondaryId');
  const rawCategory = resolvedText(row, fields, 'category', 'Unclassified');
  const fallbackId = [sourceDate, secondaryId, coordinates.join(','), rawCategory].filter(Boolean).join(':');
  const sourceId = primaryId ? [primaryId, secondaryId].filter(Boolean).join(':') : fallbackId;
  if (!sourceId) return null;

  const occurredAt = options.combineTime
    ? localTimestamp(sourceDate, rowValue(row, fields, 'time'))
    : sourceDate;
  const description = resolvedText(row, fields, 'description', rawCategory);
  const category = normalizeCategory(`${rawCategory} ${description}`);
  const locationLabel = [
    resolvedText(row, fields, 'location'),
    resolvedText(row, fields, 'area'),
  ].filter(Boolean).join(' · ') || options.precisionLabel;

  return {
    id: `${options.idPrefix}:${sourceId}`,
    providerId: meta.id,
    occurredAt,
    occurredAtEpochMs: sourceTimestampToEpoch(occurredAt),
    localHour: hourFromTimestamp(occurredAt),
    category,
    group: categoryGroup(category),
    rawCategory,
    description,
    locationLabel,
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: meta.precision,
  };
}

export const LOS_ANGELES_META: ProviderMeta = {
  id: 'los-angeles',
  city: 'Los Angeles',
  state: 'CA',
  label: 'Los Angeles, California',
  agency: 'Los Angeles Police Department',
  datasetName: 'LAPD NIBRS Offenses Dataset 2026 to Present',
  endpoint: 'https://data.lacity.org/resource/k7nn-b2ep.json',
  sourceUrl: 'https://data.lacity.org/d/k7nn-b2ep',
  center: [-118.2437, 34.0522],
  zoom: 10.7,
  bounds: { west: -118.68, south: 33.7, east: -118.15, north: 34.34 },
  cadence: 'Updated on the LAPD publication cycle',
  delayNote: 'The NIBRS offense feed is a publication product and can be revised after release.',
  precision: 'block',
  precisionNote: 'Coordinates identify the published hundred-block location, not a premises.',
  coverageNote: 'NIBRS offense rows for 2026 onward; one incident can contain multiple offenses.',
  lastVerified: '2026-08-18',
};

const losAngelesAliases = aliases({
  id: ['uniquenibrno'],
  secondaryId: ['caseno'],
  date: ['date_occ'],
  time: ['time_occ'],
  category: ['nibr_description', 'nibr_code'],
  description: ['premis_desc', 'weapon_desc', 'crime_against'],
  location: ['hndrdth_loc_chk'],
  area: ['area_name'],
  latitude: ['hndrdth_lat'],
  longitude: ['hndrdth_lon'],
});

const losAngelesFields: Fields = {
  id: 'uniquenibrno',
  secondaryId: 'caseno',
  date: 'date_occ',
  time: 'time_occ',
  category: 'nibr_description',
  description: 'premis_desc',
  location: 'hndrdth_loc_chk',
  area: 'area_name',
  latitude: 'hndrdth_lat',
  longitude: 'hndrdth_lon',
  point: null,
};

export function mapLosAngelesRow(row: Record<string, unknown>, fields = losAngelesFields) {
  return incidentFromSocrata(LOS_ANGELES_META, row, fields, {
    idPrefix: 'los-angeles',
    precisionLabel: 'Published hundred block',
    combineTime: true,
  });
}

export const losAngelesProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: LOS_ANGELES_META,
  aliases: losAngelesAliases,
  requiredKeys: ['id', 'date', 'category'],
  dateKey: 'date',
  latitudeKey: 'latitude',
  longitudeKey: 'longitude',
  pointKey: 'point',
  mapRow: mapLosAngelesRow,
});

export const SEATTLE_META: ProviderMeta = {
  id: 'seattle',
  city: 'Seattle',
  state: 'WA',
  label: 'Seattle, Washington',
  agency: 'Seattle Police Department',
  datasetName: 'SPD Crime Data: 2008–Present',
  endpoint: 'https://cos-data.seattle.gov/resource/tazs-3rd5.json',
  sourceUrl: 'https://cos-data.seattle.gov/d/tazs-3rd5',
  center: [-122.3321, 47.6062],
  zoom: 11.1,
  bounds: { west: -122.46, south: 47.47, east: -122.22, north: 47.75 },
  cadence: 'Updated daily',
  delayNote: 'Only finalized reports are released; publication follows records approval rather than dispatch.',
  precision: 'block',
  precisionNote: 'Addresses and coordinates are blurred to an approximate one-hundred block.',
  coverageNote: 'One report can contain multiple offense rows identified by distinct offense IDs.',
  lastVerified: '2026-08-17',
};

const seattleAliases = aliases({
  id: ['offense_id', 'report_number'],
  secondaryId: ['report_number'],
  date: ['offense_date', 'report_date_time'],
  category: ['offense_sub_category', 'offense_category', 'nibrs_crime_against_category'],
  description: ['nibrs_crime_against_category', 'nibrs_group_a_b', 'nibrs_offense_code_description'],
  location: ['block_address'],
  area: ['neighborhood', 'precinct'],
  latitude: ['latitude'],
  longitude: ['longitude'],
});

const seattleFields: Fields = {
  id: 'offense_id',
  secondaryId: 'report_number',
  date: 'offense_date',
  time: null,
  category: 'offense_sub_category',
  description: 'nibrs_crime_against_category',
  location: 'block_address',
  area: 'neighborhood',
  latitude: 'latitude',
  longitude: 'longitude',
  point: null,
};

export function mapSeattleRow(row: Record<string, unknown>, fields = seattleFields) {
  return incidentFromSocrata(SEATTLE_META, row, fields, {
    idPrefix: 'seattle',
    precisionLabel: 'Approximate one-hundred block',
  });
}

export const seattleProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: SEATTLE_META,
  aliases: seattleAliases,
  requiredKeys: ['id', 'date', 'category'],
  dateKey: 'date',
  latitudeKey: 'latitude',
  longitudeKey: 'longitude',
  coordinateFieldsAreText: true,
  mapRow: mapSeattleRow,
});

export const DALLAS_META: ProviderMeta = {
  id: 'dallas',
  city: 'Dallas',
  state: 'TX',
  label: 'Dallas, Texas',
  agency: 'Dallas Police Department',
  datasetName: 'Police Incidents',
  endpoint: 'https://www.dallasopendata.com/resource/qv6i-rri7.json',
  sourceUrl: 'https://www.dallasopendata.com/d/qv6i-rri7',
  center: [-96.797, 32.7767],
  zoom: 10.7,
  bounds: { west: -97.04, south: 32.61, east: -96.52, north: 33.03 },
  cadence: 'Updated daily',
  delayNote: 'Published records are preliminary and can change as investigations and classifications progress.',
  precision: 'approximate',
  precisionNote: 'Published coordinates are rounded to an approximately one-hundred-meter grid and addresses to a hundred block.',
  coverageNote: 'Dallas Police RMS incidents from June 2014 onward; one service report can contain multiple offense rows.',
  lastVerified: '2026-08-19',
};

const dallasAliases = aliases({
  id: ['servnumid', 'incidentnum'],
  secondaryId: ['incidentnum'],
  date: ['date1'],
  time: ['time1'],
  category: ['nibrs_crime', 'nibrs_crime_category', 'offincident'],
  description: ['offincident', 'nibrs_crime_category', 'ucr_offdesc'],
  location: ['incident_address'],
  area: ['division', 'community', 'beat'],
  point: ['geocoded_column'],
});

const dallasFields: Fields = {
  id: 'servnumid',
  secondaryId: null,
  date: 'date1',
  time: 'time1',
  category: 'nibrs_crime',
  description: 'offincident',
  location: 'incident_address',
  area: 'division',
  latitude: null,
  longitude: null,
  point: 'geocoded_column',
};

function generalizedDallasAddress(value: string) {
  return value.replace(/^(\d+)\s+/, (match, houseNumber: string) => {
    const number = Number(houseNumber);
    if (!Number.isFinite(number)) return match;
    return `${Math.floor(number / 100) * 100} BLOCK `;
  });
}

export function mapDallasRow(row: Record<string, unknown>, fields = dallasFields) {
  const incident = incidentFromSocrata(DALLAS_META, row, fields, {
    idPrefix: 'dallas',
    precisionLabel: 'Approximate public location',
    combineTime: true,
  });
  if (!incident) return null;
  const [longitude, latitude] = incident.coordinates;
  return {
    ...incident,
    coordinates: [Number(longitude.toFixed(3)), Number(latitude.toFixed(3))] as const,
    locationLabel: generalizedDallasAddress(incident.locationLabel),
  };
}

export const dallasProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: DALLAS_META,
  aliases: dallasAliases,
  requiredKeys: ['id', 'date', 'category'],
  dateKey: 'date',
  latitudeKey: 'latitude',
  longitudeKey: 'longitude',
  pointKey: 'point',
  mapRow: mapDallasRow,
});

export const WASHINGTON_DC_LAYER_URL =
  'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41';

export const WASHINGTON_DC_META: ProviderMeta = {
  id: 'washington-dc',
  city: 'Washington',
  state: 'DC',
  label: 'Washington, District of Columbia',
  agency: 'Metropolitan Police Department of the District of Columbia',
  datasetName: 'Crime Incidents - 2026',
  endpoint: WASHINGTON_DC_LAYER_URL,
  sourceUrl: WASHINGTON_DC_LAYER_URL,
  center: [-77.0369, 38.9072],
  zoom: 11.1,
  bounds: { west: -77.13, south: 38.79, east: -76.9, north: 39.0 },
  cadence: 'Updated daily',
  delayNote: 'The annual incident layer is a publication product, not a live dispatch console.',
  precision: 'block',
  precisionNote: 'Public records identify a block-level or otherwise generalized location.',
  coverageNote: 'MPD crime incidents in the official 2026 annual layer; categories can be revised.',
  lastVerified: '2026-08-17',
};

type DcRow = Record<string, unknown>;

function dcAttribute(row: DcRow, ...names: string[]) {
  for (const name of names) {
    if (name in row) return row[name];
    const actual = Object.keys(row).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (actual) return row[actual];
  }
  return undefined;
}

export function mapWashingtonDcFeature(feature: ArcgisFeature<DcRow>): Incident | null {
  const row = feature.attributes ?? {};
  const longitude = arcgisNumber(dcAttribute(row, 'LONGITUDE')) ?? arcgisNumber(feature.geometry?.x);
  const latitude = arcgisNumber(dcAttribute(row, 'LATITUDE')) ?? arcgisNumber(feature.geometry?.y);
  const occurredAt = arcgisTimestamp(dcAttribute(row, 'START_DATE', 'REPORT_DAT'));
  const ccn = arcgisText(dcAttribute(row, 'CCN'));
  const objectId = arcgisText(dcAttribute(row, 'OBJECTID'));
  if (longitude === null || latitude === null || !occurredAt || (!ccn && !objectId)) return null;

  const rawCategory = arcgisText(dcAttribute(row, 'OFFENSE'), 'Unclassified');
  const description = arcgisText(dcAttribute(row, 'METHOD'), rawCategory);
  const category = normalizeCategory(`${rawCategory} ${description}`);

  return {
    id: `washington-dc:${ccn || objectId}:${objectId}`,
    providerId: WASHINGTON_DC_META.id,
    occurredAt,
    occurredAtEpochMs: sourceTimestampToEpoch(occurredAt),
    localHour: hourFromTimestamp(occurredAt),
    category,
    group: categoryGroup(category),
    rawCategory,
    description,
    locationLabel: [
      arcgisText(dcAttribute(row, 'BLOCK')),
      arcgisText(dcAttribute(row, 'NEIGHBORHOOD_CLUSTER')),
    ].filter(Boolean).join(' · ') || 'Generalized block',
    coordinates: [longitude, latitude],
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: WASHINGTON_DC_META.precision,
  };
}

export const washingtonDcProvider = createArcgisProvider<DcRow>({
  meta: WASHINGTON_DC_META,
  serviceUrl: WASHINGTON_DC_LAYER_URL,
  dateField: 'START_DATE',
  outFields: ['*'],
  mapFeature: mapWashingtonDcFeature,
});
