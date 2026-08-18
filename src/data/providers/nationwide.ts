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
    id: [], secondaryId: [], date: [], time: [], category: [], description: [],
    location: [], area: [], latitude: [], longitude: [], point: [], ...overrides,
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
    latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point',
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
  id: 'los-angeles', city: 'Los Angeles', state: 'CA', label: 'Los Angeles, California',
  agency: 'Los Angeles Police Department', datasetName: 'Crime Data from 2020 to Present',
  endpoint: 'https://data.lacity.org/resource/2nrs-mtv8.json', sourceUrl: 'https://data.lacity.org/d/2nrs-mtv8',
  center: [-118.2437, 34.0522], zoom: 10.7,
  bounds: { west: -118.68, south: 33.7, east: -118.15, north: 34.34 },
  cadence: 'Updated regularly', delayNote: 'Records are preliminary and can be revised after publication.',
  precision: 'approximate', precisionNote: 'Public coordinates are approximate and may identify a block rather than a premises.',
  coverageNote: 'LAPD crime reports within the City of Los Angeles; zero-coordinate records are excluded.',
  lastVerified: '2026-08-17',
};
const losAngelesAliases = aliases({
  id: ['dr_no'], date: ['date_occ'], time: ['time_occ'], category: ['crm_cd_desc'],
  description: ['premis_desc', 'weapon_desc'], location: ['location'], area: ['area_name'],
  latitude: ['lat', 'latitude'], longitude: ['lon', 'longitude'], point: ['location_1', 'geocoded_column'],
});
const losAngelesFields: Fields = {
  id: 'dr_no', secondaryId: null, date: 'date_occ', time: 'time_occ', category: 'crm_cd_desc',
  description: 'premis_desc', location: 'location', area: 'area_name', latitude: 'lat', longitude: 'lon', point: null,
};
export function mapLosAngelesRow(row: Record<string, unknown>, fields = losAngelesFields) {
  return incidentFromSocrata(LOS_ANGELES_META, row, fields, {
    idPrefix: 'los-angeles', precisionLabel: 'Approximate block', combineTime: true,
  });
}
export const losAngelesProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: LOS_ANGELES_META, aliases: losAngelesAliases,
  requiredKeys: ['id', 'date', 'category'], dateKey: 'date',
  latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point', mapRow: mapLosAngelesRow,
});

export const SEATTLE_META: ProviderMeta = {
  id: 'seattle', city: 'Seattle', state: 'WA', label: 'Seattle, Washington',
  agency: 'Seattle Police Department', datasetName: 'SPD Crime Data: 2008–Present',
  endpoint: 'https://data.seattle.gov/resource/tazs-3rd5.json', sourceUrl: 'https://data.seattle.gov/d/tazs-3rd5',
  center: [-122.3321, 47.6062], zoom: 11.1,
  bounds: { west: -122.46, south: 47.47, east: -122.22, north: 47.75 },
  cadence: 'Updated daily', delayNote: 'Publication follows report processing and is not a live dispatch feed.',
  precision: 'block', precisionNote: 'Addresses and coordinates are published at an approximate 100-block location.',
  coverageNote: 'Reported Group A and Group B offenses within Seattle Police Department coverage.',
  lastVerified: '2026-08-17',
};
const seattleAliases = aliases({
  id: ['offense_id', 'report_number'], secondaryId: ['report_number'],
  date: ['offense_start_datetime', 'report_datetime'], category: ['offense', 'offense_parent_group'],
  description: ['offense_parent_group', 'crime_against_category'],
  location: ['100_block_address', 'hundred_block_location'], area: ['mcpp', 'precinct'],
  latitude: ['latitude'], longitude: ['longitude'], point: ['report_location', 'geocoded_column'],
});
const seattleFields: Fields = {
  id: 'offense_id', secondaryId: 'report_number', date: 'offense_start_datetime', time: null,
  category: 'offense', description: 'offense_parent_group', location: '100_block_address', area: 'mcpp',
  latitude: 'latitude', longitude: 'longitude', point: null,
};
export function mapSeattleRow(row: Record<string, unknown>, fields = seattleFields) {
  return incidentFromSocrata(SEATTLE_META, row, fields, {
    idPrefix: 'seattle', precisionLabel: 'Approximate 100-block',
  });
}
export const seattleProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: SEATTLE_META, aliases: seattleAliases,
  requiredKeys: ['id', 'date', 'category'], dateKey: 'date',
  latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point', mapRow: mapSeattleRow,
});

export const AUSTIN_META: ProviderMeta = {
  id: 'austin', city: 'Austin', state: 'TX', label: 'Austin, Texas',
  agency: 'Austin Police Department', datasetName: 'Crime Reports',
  endpoint: 'https://data.austintexas.gov/resource/fdj4-gpfu.json', sourceUrl: 'https://data.austintexas.gov/d/fdj4-gpfu',
  center: [-97.7431, 30.2672], zoom: 10.9,
  bounds: { west: -98.0, south: 30.05, east: -97.52, north: 30.55 },
  cadence: 'Updated regularly', delayNote: 'Open reports can change as APD records are reviewed.',
  precision: 'approximate', precisionNote: 'Coordinates and addresses are approximate public report locations.',
  coverageNote: 'APD reported crime records; clearance and classification may change after publication.',
  lastVerified: '2026-08-17',
};
const austinAliases = aliases({
  id: ['incident_report_number', 'unique_key'], date: ['occ_date_time', 'occurrence_date_time', 'occurred_date_time'],
  category: ['crime_type', 'highest_offense_description'], description: ['category_description', 'ucr_category'],
  location: ['address'], area: ['apd_district', 'district'], latitude: ['latitude'], longitude: ['longitude'],
  point: ['location', 'geocoded_column'],
});
const austinFields: Fields = {
  id: 'incident_report_number', secondaryId: null, date: 'occ_date_time', time: null,
  category: 'crime_type', description: 'category_description', location: 'address', area: 'apd_district',
  latitude: 'latitude', longitude: 'longitude', point: 'location',
};
export function mapAustinRow(row: Record<string, unknown>, fields = austinFields) {
  return incidentFromSocrata(AUSTIN_META, row, fields, {
    idPrefix: 'austin', precisionLabel: 'Approximate report location',
  });
}
export const austinProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: AUSTIN_META, aliases: austinAliases,
  requiredKeys: ['id', 'date', 'category'], dateKey: 'date',
  latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point', mapRow: mapAustinRow,
});

export const BALTIMORE_META: ProviderMeta = {
  id: 'baltimore', city: 'Baltimore', state: 'MD', label: 'Baltimore, Maryland',
  agency: 'Baltimore Police Department', datasetName: 'Part 1 Crime Data',
  endpoint: 'https://data.baltimorecity.gov/resource/wsfq-mvij.json', sourceUrl: 'https://data.baltimorecity.gov/d/wsfq-mvij',
  center: [-76.6122, 39.2904], zoom: 11.1,
  bounds: { west: -76.72, south: 39.19, east: -76.52, north: 39.38 },
  cadence: 'Updated regularly', delayNote: 'The public extract reflects records processing and later revisions.',
  precision: 'approximate', precisionNote: 'Coordinates identify an approximate public incident location.',
  coverageNote: 'Part I offenses reported within Baltimore City; source row semantics differ by offense.',
  lastVerified: '2026-08-17',
};
const baltimoreAliases = aliases({
  id: ['objectid', 'rowid', 'incidentid'], secondaryId: ['crimecode'],
  date: ['crimedatetime', 'crime_date_time'], category: ['description'], description: ['weapon', 'premise'],
  location: ['location'], area: ['neighborhood', 'district'], latitude: ['latitude'], longitude: ['longitude'],
  point: ['geolocation', 'location_1', 'geocoded_column'],
});
const baltimoreFields: Fields = {
  id: 'objectid', secondaryId: 'crimecode', date: 'crimedatetime', time: null,
  category: 'description', description: 'weapon', location: 'location', area: 'neighborhood',
  latitude: 'latitude', longitude: 'longitude', point: null,
};
export function mapBaltimoreRow(row: Record<string, unknown>, fields = baltimoreFields) {
  return incidentFromSocrata(BALTIMORE_META, row, fields, {
    idPrefix: 'baltimore', precisionLabel: 'Approximate incident location',
  });
}
export const baltimoreProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: BALTIMORE_META, aliases: baltimoreAliases,
  requiredKeys: ['date', 'category'], dateKey: 'date',
  latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point', mapRow: mapBaltimoreRow,
});

export const NASHVILLE_META: ProviderMeta = {
  id: 'nashville', city: 'Nashville', state: 'TN', label: 'Nashville, Tennessee',
  agency: 'Metropolitan Nashville Police Department', datasetName: 'Police Department Incidents',
  endpoint: 'https://data.nashville.gov/resource/2u6v-ujjs.json', sourceUrl: 'https://data.nashville.gov/d/2u6v-ujjs',
  center: [-86.7816, 36.1627], zoom: 10.8,
  bounds: { west: -87.05, south: 35.95, east: -86.5, north: 36.42 },
  cadence: 'Updated regularly', delayNote: 'Incident publication follows records processing rather than dispatch.',
  precision: 'approximate', precisionNote: 'Public coordinates identify an approximate incident location.',
  coverageNote: 'MNPD incident records across Metropolitan Nashville and Davidson County.',
  lastVerified: '2026-08-17',
};
const nashvilleAliases = aliases({
  id: ['incident_number'], secondaryId: ['offense_number'],
  date: ['incident_occurred', 'occurred', 'incident_reported'],
  category: ['offense_description', 'offense_nibrs'], description: ['offense_category', 'crime_type'],
  location: ['incident_location', 'address'], area: ['zone', 'zip_code'], latitude: ['latitude'], longitude: ['longitude'],
  point: ['mapped_location', 'location', 'geocoded_column'],
});
const nashvilleFields: Fields = {
  id: 'incident_number', secondaryId: 'offense_number', date: 'incident_occurred', time: null,
  category: 'offense_description', description: 'offense_category', location: 'incident_location', area: 'zone',
  latitude: 'latitude', longitude: 'longitude', point: 'mapped_location',
};
export function mapNashvilleRow(row: Record<string, unknown>, fields = nashvilleFields) {
  return incidentFromSocrata(NASHVILLE_META, row, fields, {
    idPrefix: 'nashville', precisionLabel: 'Approximate incident location',
  });
}
export const nashvilleProvider = createAdaptiveSocrataProvider<FieldKey>({
  meta: NASHVILLE_META, aliases: nashvilleAliases,
  requiredKeys: ['id', 'date', 'category'], dateKey: 'date',
  latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point', mapRow: mapNashvilleRow,
});

const dcYear = new Date().getUTCFullYear();
export const WASHINGTON_DC_META: ProviderMeta = {
  id: 'washington-dc', city: 'Washington', state: 'DC', label: 'Washington, District of Columbia',
  agency: 'Metropolitan Police Department of the District of Columbia',
  datasetName: `Crime Incidents in ${dcYear}`,
  endpoint: 'https://www.arcgis.com/sharing/rest/search',
  sourceUrl: 'https://opendata.dc.gov/search?q=Crime%20Incidents',
  center: [-77.0369, 38.9072], zoom: 11.1,
  bounds: { west: -77.13, south: 38.79, east: -76.9, north: 39.0 },
  cadence: 'Updated daily', delayNote: 'The annual incident layer is a publication product, not a live dispatch console.',
  precision: 'block', precisionNote: 'Public records identify a block-level or otherwise generalized location.',
  coverageNote: 'MPD crime incidents in the current-year publication layer; categories can be revised.',
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
  catalog: {
    query: `owner:DCGIS type:"Feature Service" "Crime Incidents in ${dcYear}"`,
    titleIncludes: `crime incidents in ${dcYear}`,
    layerIndex: 0,
  },
  dateField: 'START_DATE',
  outFields: ['*'],
  mapFeature: mapWashingtonDcFeature,
});
