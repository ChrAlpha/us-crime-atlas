import { categoryGroup, isViolentCategory, normalizeCategory, severityForCategory } from '../../domain/categories';
import { hourFromTimestamp, sourceTimestampToEpoch } from '../../domain/time';
import type { Incident, ProviderMeta } from '../../types';
import {
  arcgisNumber,
  arcgisText,
  arcgisTimestamp,
  createArcgisProvider,
  type ArcgisFeature,
} from './arcgis';

type ArcgisRow = Record<string, unknown>;

function attribute(row: ArcgisRow, ...names: string[]) {
  for (const name of names) {
    if (name in row) return row[name];
    const actual = Object.keys(row).find((key) => key.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (actual) return row[actual];
  }
  return undefined;
}

interface CityFeatureConfig {
  meta: ProviderMeta;
  idFields: string[];
  dateFields: string[];
  categoryFields: string[];
  descriptionFields: string[];
  locationFields: string[];
  longitudeFields?: string[];
  latitudeFields?: string[];
  coordinateDigits?: number;
}

function mapCityFeature(feature: ArcgisFeature<ArcgisRow>, config: CityFeatureConfig): Incident | null {
  const row = feature.attributes ?? {};
  const id = arcgisText(attribute(row, ...config.idFields));
  const occurredAt = arcgisTimestamp(attribute(row, ...config.dateFields));
  const longitude = arcgisNumber(attribute(row, ...(config.longitudeFields ?? [])))
    ?? arcgisNumber(feature.geometry?.x);
  const latitude = arcgisNumber(attribute(row, ...(config.latitudeFields ?? [])))
    ?? arcgisNumber(feature.geometry?.y);
  if (!id || !occurredAt || longitude === null || latitude === null) return null;

  const rawCategory = arcgisText(attribute(row, ...config.categoryFields), 'Unclassified');
  const description = arcgisText(attribute(row, ...config.descriptionFields), rawCategory);
  const category = normalizeCategory(`${rawCategory} ${description}`);
  const digits = config.coordinateDigits;
  const coordinates = digits === undefined
    ? [longitude, latitude] as const
    : [Number(longitude.toFixed(digits)), Number(latitude.toFixed(digits))] as const;

  return {
    id: `${config.meta.id}:${id}`,
    providerId: config.meta.id,
    occurredAt,
    occurredAtEpochMs: sourceTimestampToEpoch(occurredAt),
    localHour: hourFromTimestamp(occurredAt),
    category,
    group: categoryGroup(category),
    rawCategory,
    description,
    locationLabel: config.locationFields
      .map((field) => arcgisText(attribute(row, field)))
      .filter(Boolean)
      .join(' · ') || config.meta.precisionNote,
    coordinates,
    severity: severityForCategory(category),
    isViolent: isViolentCategory(category),
    precision: config.meta.precision,
  };
}

export const PHILADELPHIA_LAYER_URL =
  'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/INCIDENTS_PART1_PART2/FeatureServer/0';

export const PHILADELPHIA_META: ProviderMeta = {
  id: 'philadelphia', city: 'Philadelphia', state: 'PA', label: 'Philadelphia, Pennsylvania',
  agency: 'Philadelphia Police Department', datasetName: 'Crime Incidents 2006 to Present',
  endpoint: PHILADELPHIA_LAYER_URL, sourceUrl: 'https://opendataphilly.org/datasets/crime-incidents/',
  center: [-75.1652, 39.9526], zoom: 10.8,
  bounds: { west: -75.29, south: 39.86, east: -74.95, north: 40.14 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary police incident data can be reclassified after investigation.',
  precision: 'block', precisionNote: 'Published locations are rounded to the hundred block.',
  coverageNote: 'Part I and Part II incidents with generalized UCR categories; counts can differ from UCR submissions.',
  lastVerified: '2026-08-19',
};

export function mapPhiladelphiaFeature(feature: ArcgisFeature<ArcgisRow>) {
  return mapCityFeature(feature, {
    meta: PHILADELPHIA_META, idFields: ['dc_key', 'objectid'], dateFields: ['dispatch_date_time'],
    categoryFields: ['text_general_code', 'ucr_general'], descriptionFields: ['text_general_code'],
    locationFields: ['location_block', 'dc_dist'], longitudeFields: ['point_x'], latitudeFields: ['point_y'],
  });
}

export const philadelphiaProvider = createArcgisProvider<ArcgisRow>({
  meta: PHILADELPHIA_META, serviceUrl: PHILADELPHIA_LAYER_URL, dateField: 'dispatch_date_time',
  outFields: ['*'], mapFeature: mapPhiladelphiaFeature,
});

export const DETROIT_LAYER_URL =
  'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents_2026/FeatureServer/0';

export const DETROIT_META: ProviderMeta = {
  id: 'detroit', city: 'Detroit', state: 'MI', label: 'Detroit, Michigan',
  agency: 'Detroit Police Department', datasetName: 'RMS Crime Incidents 2026',
  endpoint: DETROIT_LAYER_URL, sourceUrl: 'https://data.detroitmi.gov/datasets/rms-crime-incidents-2026/',
  center: [-83.0458, 42.3314], zoom: 10.7,
  bounds: { west: -83.32, south: 42.25, east: -82.91, north: 42.46 },
  cadence: 'Updated daily', delayNote: 'Records are preliminary and follow the RMS publication workflow.',
  precision: 'intersection', precisionNote: 'The public location is represented by the nearest intersection.',
  coverageNote: 'Current-year RMS offense rows; one report can contain multiple crime entries.',
  lastVerified: '2026-08-19',
};

export function mapDetroitFeature(feature: ArcgisFeature<ArcgisRow>) {
  return mapCityFeature(feature, {
    meta: DETROIT_META, idFields: ['incident_entry_id', 'ESRI_OID'], dateFields: ['incident_occurred_at'],
    categoryFields: ['offense_category', 'offense_description'], descriptionFields: ['offense_description'],
    locationFields: ['nearest_intersection', 'neighborhood'], longitudeFields: ['longitude'], latitudeFields: ['latitude'],
  });
}

export const detroitProvider = createArcgisProvider<ArcgisRow>({
  meta: DETROIT_META, serviceUrl: DETROIT_LAYER_URL, dateField: 'incident_occurred_at',
  outFields: ['*'], mapFeature: mapDetroitFeature,
});

export const DENVER_LAYER_URL =
  'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324';

export const DENVER_META: ProviderMeta = {
  id: 'denver', city: 'Denver', state: 'CO', label: 'Denver, Colorado',
  agency: 'Denver Police Department', datasetName: 'Crime Offenses',
  endpoint: DENVER_LAYER_URL, sourceUrl: 'https://www.denvergov.org/opendata/dataset/city-and-county-of-denver-crime',
  center: [-104.9903, 39.7392], zoom: 10.7,
  bounds: { west: -105.12, south: 39.61, east: -104.6, north: 39.91 },
  cadence: 'Updated daily', delayNote: 'Offense records remain subject to correction and reclassification.',
  precision: 'approximate', precisionNote: 'Coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Police offense rows flagged as crime; an incident can contain multiple offenses.',
  lastVerified: '2026-08-19',
};

export function mapDenverFeature(feature: ArcgisFeature<ArcgisRow>) {
  return mapCityFeature(feature, {
    meta: DENVER_META, idFields: ['OFFENSE_ID', 'OBJECTID'], dateFields: ['FIRST_OCCURRENCE_DATE'],
    categoryFields: ['OFFENSE_CATEGORY_ID', 'OFFENSE_TYPE_ID'], descriptionFields: ['OFFENSE_TYPE_ID'],
    locationFields: ['NEIGHBORHOOD_ID', 'DISTRICT_ID'], longitudeFields: ['GEO_LON'], latitudeFields: ['GEO_LAT'],
    coordinateDigits: 3,
  });
}

export const denverProvider = createArcgisProvider<ArcgisRow>({
  meta: DENVER_META, serviceUrl: DENVER_LAYER_URL, dateField: 'FIRST_OCCURRENCE_DATE',
  outFields: ['*'], mapFeature: mapDenverFeature,
});

export const NASHVILLE_LAYER_URL =
  'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0';

export const NASHVILLE_META: ProviderMeta = {
  id: 'nashville', city: 'Nashville', state: 'TN', label: 'Nashville, Tennessee',
  agency: 'Metropolitan Nashville Police Department', datasetName: 'Police Department Incidents',
  endpoint: NASHVILLE_LAYER_URL, sourceUrl: 'https://data.nashville.gov/datasets/police-department-incidents/',
  center: [-86.7816, 36.1627], zoom: 10.4,
  bounds: { west: -87.06, south: 35.96, east: -86.51, north: 36.4 },
  cadence: 'Updated daily', delayNote: 'Incident rows can be revised as reports and investigations progress.',
  precision: 'approximate', precisionNote: 'Public coordinates are rounded and identify an approximate location.',
  coverageNote: 'Incident offense and victim rows across Metropolitan Nashville and Davidson County.',
  lastVerified: '2026-08-19',
};

export function mapNashvilleFeature(feature: ArcgisFeature<ArcgisRow>) {
  return mapCityFeature(feature, {
    meta: NASHVILLE_META, idFields: ['Primary_Key', 'OBJECTID'], dateFields: ['Incident_Occurred'],
    categoryFields: ['Offense_Description', 'Offense_NIBRS'], descriptionFields: ['Offense_Description', 'Weapon_Description'],
    locationFields: ['Incident_Location', 'Location_Description'], longitudeFields: ['Longitude'], latitudeFields: ['Latitude'],
    coordinateDigits: 3,
  });
}

export const nashvilleProvider = createArcgisProvider<ArcgisRow>({
  meta: NASHVILLE_META, serviceUrl: NASHVILLE_LAYER_URL, dateField: 'Incident_Occurred',
  outFields: ['*'], mapFeature: mapNashvilleFeature,
});
