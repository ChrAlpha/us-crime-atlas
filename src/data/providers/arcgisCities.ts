import type { Incident, ProviderMeta } from '../../types';
import {
  ARCGIS_MAX_PAGES,
  ARCGIS_PAGE_SIZE,
  arcgisLocalTimestamp,
  attribute,
  createArcgisProvider,
  type ArcgisEpochSemantics,
  type ArcgisFeature,
} from './arcgis';
import { buildIncident, joinLabels, roundCoordinates } from './incident';
import { numberValue, publicCoordinates, textValue } from './shared';

type Row = Record<string, unknown>;

/** The first non-empty text among `names`. */
function firstText(row: Row, names: readonly string[], fallback = ''): string {
  for (const name of names) {
    const value = textValue(attribute(row, name));
    if (value) return value;
  }
  return fallback;
}

function firstNumber(row: Row, names: readonly string[]): number | null {
  for (const name of names) {
    const value = numberValue(attribute(row, name));
    if (value !== null) return value;
  }
  return null;
}

interface CityFeatureConfig {
  meta: ProviderMeta;
  epochSemantics: ArcgisEpochSemantics;
  idFields: readonly string[];
  /** Overrides `idFields` when identity combines several attributes. */
  sourceId?(row: Row): string;
  dateFields: readonly string[];
  categoryFields: readonly string[];
  descriptionFields: readonly string[];
  locationFields: readonly string[];
  locationFallback: string;
  longitudeFields: readonly string[];
  latitudeFields: readonly string[];
  /** Rounds published coordinates to this many decimals. */
  coordinateDigits?: number;
}

export function mapCityFeature(feature: ArcgisFeature, config: CityFeatureConfig): Incident | null {
  const row = feature.attributes ?? {};
  const coordinates = publicCoordinates(
    firstNumber(row, config.longitudeFields),
    firstNumber(row, config.latitudeFields),
  );
  const occurredAt = config.dateFields
    .map((field) => arcgisLocalTimestamp(attribute(row, field), config.epochSemantics, config.meta.timeZone))
    .find(Boolean);
  if (!coordinates || !occurredAt) return null;

  const rawCategory = firstText(row, config.categoryFields, 'Unclassified');
  return buildIncident(config.meta, {
    sourceId: config.sourceId ? config.sourceId(row) : firstText(row, config.idFields),
    occurredAt,
    rawCategory,
    description: firstText(row, config.descriptionFields, rawCategory),
    locationLabel: joinLabels(config.locationFields.map((field) => firstText(row, [field])), config.locationFallback),
    coordinates: config.coordinateDigits === undefined
      ? coordinates
      : roundCoordinates(coordinates, config.coordinateDigits),
  });
}

function outFields(config: CityFeatureConfig, extra: readonly string[] = []) {
  return [...new Set([
    ...config.idFields,
    ...config.dateFields,
    ...config.categoryFields,
    ...config.descriptionFields,
    ...config.locationFields,
    ...config.longitudeFields,
    ...config.latitudeFields,
    ...extra,
  ])];
}

/** What the live contract suite verifies against each layer's published metadata. */
export interface ArcgisLayerContract {
  meta: ProviderMeta;
  /** The reviewed layer name; a rename means the layer must be reviewed again. */
  layerName: string;
  dateField: string;
  epochSemantics: ArcgisEpochSemantics;
  outFields: readonly string[];
  /** Rows requested per page; the layer must serve at least this many. */
  pageSize: number;
}

interface LayerConfig {
  layerName: string;
  dateField: string;
  objectIdField: string;
  /** Overrides `ARCGIS_PAGE_SIZE` for a layer that serves smaller pages. */
  pageSize?: number;
}

export const ARCGIS_LAYER_CONTRACTS: ArcgisLayerContract[] = [];

function cityProvider(config: CityFeatureConfig, layer: LayerConfig) {
  const mapFeature = (feature: ArcgisFeature) => mapCityFeature(feature, config);
  const fields = outFields(config, [layer.objectIdField]);
  const pageSize = layer.pageSize ?? ARCGIS_PAGE_SIZE;
  // Smaller pages keep the same total record budget.
  const maxPages = Math.ceil((ARCGIS_PAGE_SIZE * ARCGIS_MAX_PAGES) / pageSize);
  ARCGIS_LAYER_CONTRACTS.push({
    meta: config.meta,
    layerName: layer.layerName,
    dateField: layer.dateField,
    epochSemantics: config.epochSemantics,
    outFields: fields,
    pageSize,
  });
  return {
    mapFeature,
    provider: createArcgisProvider({
      meta: config.meta,
      layerUrl: config.meta.endpoint,
      dateField: layer.dateField,
      objectIdField: layer.objectIdField,
      epochSemantics: config.epochSemantics,
      outFields: fields,
      pageSize,
      maxPages,
      mapFeature,
    }),
  };
}

export const WASHINGTON_DC_META: ProviderMeta = {
  id: 'washington-dc',
  city: 'Washington',
  state: 'DC',
  label: 'Washington, District of Columbia',
  agency: 'Metropolitan Police Department of the District of Columbia',
  datasetName: 'Crime Incidents - 2026',
  endpoint: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41',
  sourceUrl: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41',
  timeZone: 'America/New_York',
  center: [-77.0369, 38.9072],
  zoom: 11.1,
  bounds: { west: -77.13, south: 38.79, east: -76.9, north: 39.0 },
  cadence: 'Updated daily',
  delayNote: 'The annual incident layer is a publication product, not a live dispatch console.',
  settlingDays: 2,
  datasetStart: '2026-01-01',
  precision: 'block',
  precisionNote: 'Public records identify a block-level or otherwise generalized location.',
  coverageNote: 'MPD crime incidents in the official 2026 annual layer; categories can be revised.',
  lastVerified: '2026-10-21',
};

const washingtonDc = cityProvider({
  meta: WASHINGTON_DC_META,
  epochSemantics: 'utc',
  idFields: ['CCN', 'OBJECTID'],
  sourceId: (row) => {
    const objectId = firstText(row, ['OBJECTID']);
    const ccn = firstText(row, ['CCN']);
    return ccn || objectId ? `${ccn || objectId}:${objectId}` : '';
  },
  dateFields: ['START_DATE', 'REPORT_DAT'],
  categoryFields: ['OFFENSE'],
  descriptionFields: ['METHOD'],
  locationFields: ['BLOCK', 'NEIGHBORHOOD_CLUSTER'],
  locationFallback: 'Generalized block',
  longitudeFields: ['LONGITUDE'],
  latitudeFields: ['LATITUDE'],
}, {
  layerName: 'Crime Incidents - 2026',
  dateField: 'START_DATE',
  objectIdField: 'OBJECTID',
  // DC's load-balanced servers disagree: some serve 2,000 rows per page, others only 1,000.
  pageSize: 1000,
});

export const mapWashingtonDcFeature = washingtonDc.mapFeature;
export const washingtonDcProvider = washingtonDc.provider;

export const PHILADELPHIA_META: ProviderMeta = {
  id: 'philadelphia',
  city: 'Philadelphia',
  state: 'PA',
  label: 'Philadelphia, Pennsylvania',
  agency: 'Philadelphia Police Department',
  datasetName: 'Crime Incidents 2006 to Present',
  endpoint: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/INCIDENTS_PART1_PART2/FeatureServer/0',
  sourceUrl: 'https://opendataphilly.org/datasets/crime-incidents/',
  timeZone: 'America/New_York',
  center: [-75.1652, 39.9526],
  zoom: 10.8,
  bounds: { west: -75.29, south: 39.86, east: -74.95, north: 40.14 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary police incident data can be reclassified after investigation.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Published locations are rounded to the hundred block.',
  coverageNote: 'Part I and Part II incidents with generalized UCR categories; counts can differ from UCR submissions.',
  lastVerified: '2026-10-21',
};

const philadelphia = cityProvider({
  meta: PHILADELPHIA_META,
  epochSemantics: 'local-clock',
  idFields: ['dc_key', 'objectid'],
  dateFields: ['dispatch_date_time'],
  categoryFields: ['text_general_code', 'ucr_general'],
  descriptionFields: ['text_general_code'],
  locationFields: ['location_block', 'dc_dist'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['point_x'],
  latitudeFields: ['point_y'],
}, { layerName: 'INCIDENTS_PART1_PART2', dateField: 'dispatch_date_time', objectIdField: 'objectid' });

export const mapPhiladelphiaFeature = philadelphia.mapFeature;
export const philadelphiaProvider = philadelphia.provider;

export const DETROIT_META: ProviderMeta = {
  id: 'detroit',
  city: 'Detroit',
  state: 'MI',
  label: 'Detroit, Michigan',
  agency: 'Detroit Police Department',
  datasetName: 'RMS Crime Incidents 2026',
  endpoint: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents_2026/FeatureServer/0',
  sourceUrl: 'https://data.detroitmi.gov/datasets/rms-crime-incidents-2026/',
  timeZone: 'America/Detroit',
  center: [-83.0458, 42.3314],
  zoom: 10.7,
  bounds: { west: -83.32, south: 42.25, east: -82.91, north: 42.46 },
  cadence: 'Updated daily',
  delayNote: 'Records are preliminary and follow the RMS publication workflow.',
  settlingDays: 2,
  datasetStart: '2026-01-01',
  precision: 'intersection',
  precisionNote: 'The public location is represented by the nearest intersection.',
  coverageNote: 'Current-year RMS offense rows; one report can contain multiple crime entries.',
  lastVerified: '2026-10-21',
};

const detroit = cityProvider({
  meta: DETROIT_META,
  epochSemantics: 'utc',
  idFields: ['incident_entry_id', 'ESRI_OID'],
  dateFields: ['incident_occurred_at'],
  categoryFields: ['offense_category', 'offense_description'],
  descriptionFields: ['offense_description'],
  locationFields: ['nearest_intersection', 'neighborhood'],
  locationFallback: 'Nearest intersection',
  longitudeFields: ['longitude'],
  latitudeFields: ['latitude'],
}, { layerName: 'rms_crime_incidents', dateField: 'incident_occurred_at', objectIdField: 'ESRI_OID' });

export const mapDetroitFeature = detroit.mapFeature;
export const detroitProvider = detroit.provider;

export const DENVER_META: ProviderMeta = {
  id: 'denver',
  city: 'Denver',
  state: 'CO',
  label: 'Denver, Colorado',
  agency: 'Denver Police Department',
  datasetName: 'Crime Offenses',
  endpoint: 'https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324',
  sourceUrl: 'https://www.denvergov.org/opendata/dataset/city-and-county-of-denver-crime',
  timeZone: 'America/Denver',
  center: [-104.9903, 39.7392],
  zoom: 10.7,
  bounds: { west: -105.12, south: 39.61, east: -104.6, north: 39.91 },
  cadence: 'Updated daily',
  delayNote: 'Offense records remain subject to correction and reclassification.',
  settlingDays: 4,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Police offense rows flagged as crime; an incident can contain multiple offenses.',
  lastVerified: '2026-10-21',
};

const denver = cityProvider({
  meta: DENVER_META,
  epochSemantics: 'local-clock',
  idFields: ['OFFENSE_ID', 'OBJECTID'],
  dateFields: ['FIRST_OCCURRENCE_DATE'],
  categoryFields: ['OFFENSE_CATEGORY_ID', 'OFFENSE_TYPE_ID'],
  descriptionFields: ['OFFENSE_TYPE_ID'],
  locationFields: ['NEIGHBORHOOD_ID', 'DISTRICT_ID'],
  locationFallback: 'Approximate hundred-meter grid',
  longitudeFields: ['GEO_LON'],
  latitudeFields: ['GEO_LAT'],
  coordinateDigits: 3,
}, { layerName: 'CRIME_OFFENSES_P', dateField: 'FIRST_OCCURRENCE_DATE', objectIdField: 'OBJECTID' });

export const mapDenverFeature = denver.mapFeature;
export const denverProvider = denver.provider;

export const NASHVILLE_META: ProviderMeta = {
  id: 'nashville',
  city: 'Nashville',
  state: 'TN',
  label: 'Nashville, Tennessee',
  agency: 'Metropolitan Nashville Police Department',
  datasetName: 'Police Department Incidents',
  endpoint: 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0',
  sourceUrl: 'https://data.nashville.gov/datasets/police-department-incidents/',
  timeZone: 'America/Chicago',
  center: [-86.7816, 36.1627],
  zoom: 10.4,
  bounds: { west: -87.06, south: 35.96, east: -86.51, north: 36.4 },
  cadence: 'Updated daily',
  delayNote: 'Incident rows can be revised as reports and investigations progress.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Public coordinates are rounded and identify an approximate location.',
  coverageNote: 'Incident offense and victim rows across Metropolitan Nashville and Davidson County.',
  lastVerified: '2026-10-21',
};

const nashville = cityProvider({
  meta: NASHVILLE_META,
  epochSemantics: 'utc',
  idFields: ['Primary_Key', 'OBJECTID'],
  dateFields: ['Incident_Occurred'],
  categoryFields: ['Offense_Description', 'Offense_NIBRS'],
  descriptionFields: ['Offense_Description', 'Weapon_Description'],
  locationFields: ['Incident_Location', 'Location_Description'],
  locationFallback: 'Approximate public location',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: 3,
}, { layerName: 'Metro_Nashville_Police_Department_Incidents', dateField: 'Incident_Occurred', objectIdField: 'OBJECTID' });

export const mapNashvilleFeature = nashville.mapFeature;
export const nashvilleProvider = nashville.provider;
