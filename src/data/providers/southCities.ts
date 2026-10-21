import { localClockTimestamp, toLocalClockEpoch } from '../../domain/time';
import type { Incident, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { attribute } from './arcgis';
import { cityProvider, firstText } from './arcgisCities';
import { buildIncident, joinLabels, roundCoordinates, type IncidentFields } from './incident';
import { numberValue } from './shared';
import { createSocrataProvider, resolvedText } from './socrata';
import { COORDINATE_KEYS, fields, incidentFromRow, type FieldKey, type Row } from './socrataCities';

/** Grid used where a feed publishes exact points (≈110 m at three decimals). */
const ROUNDED_DIGITS = 3;

/**
 * Replaces a leading house number (optionally with a unit suffix such as `12A` or `12-14`)
 * with its hundred block. Labels that are already blocks or intersections pass through.
 */
export function hundredBlock(value: string): string {
  return value.replace(/^(\d+)[A-Z]?(?:-\d+[A-Z]?)?\s+(?!\s|BLOCK\b|BLK\b)/i, (_match, houseNumber: string) => (
    `${Math.floor(Number(houseNumber) / 100) * 100} BLOCK `
  ));
}

/** `primary:secondary`, or `fallback` when the primary identifier is missing. */
function compositeId(row: Row, primary: string, secondary: string, fallback?: string): string {
  const id = firstText(row, [primary]);
  if (!id) return fallback ? firstText(row, [fallback]) : '';
  return [id, firstText(row, [secondary])].filter(Boolean).join(':');
}

/** SQL string list, with quotes escaped. */
function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
}

// ── Reviewed refinements on the shared city mapper ───────────────────────────

/** Rebuilds a mapped incident with reviewed overrides, so category, group and hour stay consistent. */
function rebuilt(meta: ProviderMeta, incident: Incident, overrides: Partial<IncidentFields>): Incident | null {
  return buildIncident(meta, {
    sourceId: incident.id.slice(meta.id.length + 1),
    occurredAt: incident.occurredAt,
    rawCategory: incident.rawCategory,
    description: incident.description,
    locationLabel: incident.locationLabel,
    coordinates: incident.coordinates,
    ...overrides,
  });
}

/** The publisher gives a local date only: keep it at midnight for windowing, with no hour. */
function dateOnly(meta: ProviderMeta) {
  return (incident: Incident) => rebuilt(meta, incident, {
    occurredAt: `${incident.occurredAt.slice(0, 10)}T00:00:00`,
    timeKnown: false,
  });
}

// ── Atlanta ──────────────────────────────────────────────────────────────────

export const ATLANTA_META: ProviderMeta = {
  id: 'atlanta',
  city: 'Atlanta',
  state: 'GA',
  label: 'Atlanta, Georgia',
  agency: 'Atlanta Police Department',
  datasetName: 'APD Open Data Crime (OpenDataWebsite_Crime view)',
  endpoint: 'https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/OpenDataWebsite_Crime_view/FeatureServer/0',
  sourceUrl: 'https://opendata.atlantapd.org/',
  timeZone: 'America/New_York',
  center: [-84.388, 33.749],
  zoom: 11,
  bounds: { west: -84.56, south: 33.64, east: -84.28, north: 33.89 },
  cadence: 'Updated daily',
  delayNote: 'Offenses appear within about a day of the report; the newest three days are still filling in.',
  settlingDays: 3,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'The feed publishes full street addresses and exact points; the atlas rounds points to an approximately one-hundred-meter grid and addresses to the hundred block.',
  coverageNote: 'NIBRS offense rows from Atlanta Police reports since 2021, dated when the offense began; one report can list several offenses.',
  lastVerified: '2026-10-21',
};

const atlanta = cityProvider({
  meta: ATLANTA_META,
  epochSemantics: 'utc',
  idFields: ['ReportNumber', 'NibrsUcrCode'],
  sourceId: (row) => compositeId(row, 'ReportNumber', 'NibrsUcrCode'),
  dateFields: ['OccurredFromDate'],
  categoryFields: ['NIBRS_Bucket'],
  descriptionFields: ['NIBRS_Offense'],
  locationFields: ['StreetAddress', 'NhoodName'],
  locationFallback: 'Approximate public location',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: ROUNDED_DIGITS,
  // Joined, bucket and offense can invent one ("Theft From Auto" + "Theft From…" reads as auto theft).
  refine: (incident, row) => rebuilt(ATLANTA_META, incident, {
    classificationText: firstText(row, ['NIBRS_Offense', 'NIBRS_Bucket']),
    locationLabel: hundredBlock(incident.locationLabel),
  }),
}, { layerName: 'AxonCrimeData_XYTable', dateField: 'OccurredFromDate', objectIdField: 'OBJECTID' });

export const mapAtlantaFeature = atlanta.mapFeature;
export const atlantaProvider = atlanta.provider;

// ── Baltimore ────────────────────────────────────────────────────────────────

export const BALTIMORE_META: ProviderMeta = {
  id: 'baltimore',
  city: 'Baltimore',
  state: 'MD',
  label: 'Baltimore, Maryland',
  agency: 'Baltimore Police Department',
  datasetName: 'NIBRS Group A Crime Data',
  endpoint: 'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/NIBRS_GroupA_Crime_Data/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=204beefe92a645d79fdf0969957bbdf8',
  timeZone: 'America/New_York',
  center: [-76.6122, 39.2904],
  zoom: 11.3,
  bounds: { west: -76.72, south: 39.19, east: -76.52, north: 39.38 },
  cadence: 'Updated daily',
  delayNote: 'Records are published after entry into the records system; the newest two days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Points can differ within one published block; the atlas rounds them to an approximately one-hundred-meter grid and addresses to the hundred block.',
  coverageNote: 'NIBRS Group A offenses since 2022. The feed has one row per victim; rows of the same case and offense code are counted once.',
  lastVerified: '2026-10-21',
};

const baltimore = cityProvider({
  meta: BALTIMORE_META,
  epochSemantics: 'utc',
  idFields: ['CCNumber', 'CrimeCode'],
  // One row per victim: the same case and offense collapse into one incident.
  sourceId: (row) => compositeId(row, 'CCNumber', 'CrimeCode'),
  dateFields: ['CrimeDateTime'],
  categoryFields: ['CrimeCode'],
  descriptionFields: ['Description'],
  locationFields: ['Location', 'Neighborhood'],
  locationFallback: 'Approximate public location',
  // Published as numeric text.
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: ROUNDED_DIGITS,
  refine: (incident) => ({ ...incident, locationLabel: hundredBlock(incident.locationLabel) }),
}, { layerName: 'NIBRS Group A Crime Data', dateField: 'CrimeDateTime', objectIdField: 'RowID' });

export const mapBaltimoreFeature = baltimore.mapFeature;
export const baltimoreProvider = baltimore.provider;

// ── Charlotte ────────────────────────────────────────────────────────────────

export const CHARLOTTE_META: ProviderMeta = {
  id: 'charlotte',
  city: 'Charlotte',
  state: 'NC',
  label: 'Charlotte, North Carolina',
  agency: 'Charlotte-Mecklenburg Police Department',
  datasetName: 'CMPD Incidents',
  endpoint: 'https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0',
  sourceUrl: 'https://data.charlottenc.gov/',
  timeZone: 'America/New_York',
  center: [-80.8431, 35.2271],
  zoom: 10.6,
  bounds: { west: -81.02, south: 35.0, east: -80.63, north: 35.41 },
  cadence: 'Updated daily',
  delayNote: 'The public layer trails by about two days, and the newest three published days are still filling in.',
  settlingDays: 3,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published as a hundred-block address with one public point per block.',
  coverageNote: 'One row per incident report, classified by its most serious NIBRS offense and dated by the day it began; the time of day is not published. Non-criminal reports (missing persons, deaths, overdoses, recovered vehicles, accidents) and justifiable homicides are excluded.',
  lastVerified: '2026-10-21',
};

/** CMPD's local 8xx codes are non-criminal reports; 09C is a justifiable homicide. */
export const CHARLOTTE_FILTER = "HIGHEST_NIBRS_CODE NOT LIKE '8%' AND HIGHEST_NIBRS_CODE <> '09C'";

const charlotte = cityProvider({
  meta: CHARLOTTE_META,
  // Features are UTC instants of local midnight (04:00Z/05:00Z), but this MapServer's
  // newest-record statistic comes back as local midnight. Read as local-clock, both keep the
  // right local date; the date-only refinement drops the stray hour.
  epochSemantics: 'local-clock',
  idFields: ['INCIDENT_REPORT_ID'],
  dateFields: ['DATE_INCIDENT_BEGAN'],
  categoryFields: ['HIGHEST_NIBRS_CODE'],
  descriptionFields: ['HIGHEST_NIBRS_DESCRIPTION'],
  locationFields: ['LOCATION', 'CMPD_PATROL_DIVISION'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['LONGITUDE_PUBLIC'],
  latitudeFields: ['LATITUDE_PUBLIC'],
  refine: dateOnly(CHARLOTTE_META),
}, {
  layerName: 'CMPD Incidents',
  dateField: 'DATE_INCIDENT_BEGAN',
  objectIdField: 'OBJECTID',
  pageSize: 2500,
  filter: CHARLOTTE_FILTER,
});

export const mapCharlotteFeature = charlotte.mapFeature;
export const charlotteProvider = charlotte.provider;

// ── Jacksonville ─────────────────────────────────────────────────────────────

export const JACKSONVILLE_META: ProviderMeta = {
  id: 'jacksonville',
  city: 'Jacksonville',
  state: 'FL',
  label: 'Jacksonville, Florida',
  agency: "Jacksonville Sheriff's Office",
  datasetName: 'Public Transparency Data View (Incidents)',
  endpoint: 'https://services3.arcgis.com/7C7xW0yv6W8spzhp/arcgis/rest/services/Public_Transparency_Data_View_10_03_2025/FeatureServer/0',
  sourceUrl: 'https://transparency.jaxsheriff.org/',
  timeZone: 'America/New_York',
  center: [-81.6557, 30.3322],
  zoom: 10,
  bounds: { west: -82.06, south: 30.1, east: -81.31, north: 30.59 },
  cadence: 'Updated daily',
  delayNote: 'Offenses publish within a day of the report; the newest day is still filling in.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are hundred blocks; points can differ within a block, so the atlas rounds them to an approximately one-hundred-meter grid.',
  coverageNote: 'NIBRS offense rows across the consolidated City of Jacksonville and Baldwin, excluding the Beaches, which have their own police. Sexual offenses are not published.',
  lastVerified: '2026-10-21',
};

const jacksonville = cityProvider({
  meta: JACKSONVILLE_META,
  epochSemantics: 'utc',
  idFields: ['EsriPkey'],
  dateFields: ['IncidentDateTime'],
  categoryFields: ['nibrsDescription'],
  descriptionFields: ['nibrsDescription'],
  locationFields: ['Address'],
  locationFallback: 'Published hundred block',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: ROUNDED_DIGITS,
  // Category and description are the same text; joined, "…MOTOR VEHICLE THEFT FROM…" reads as vehicle theft.
  refine: (incident) => rebuilt(JACKSONVILLE_META, incident, {
    classificationText: incident.rawCategory,
    locationLabel: hundredBlock(incident.locationLabel),
  }),
}, { layerName: 'Incidents', dateField: 'IncidentDateTime', objectIdField: 'OBJECTID' });

export const mapJacksonvilleFeature = jacksonville.mapFeature;
export const jacksonvilleProvider = jacksonville.provider;

// ── Memphis ──────────────────────────────────────────────────────────────────

export const MEMPHIS_META: ProviderMeta = {
  id: 'memphis',
  city: 'Memphis',
  state: 'TN',
  label: 'Memphis, Tennessee',
  agency: 'Memphis Police Department',
  datasetName: 'MPD Public Safety Incidents',
  endpoint: 'https://services2.arcgis.com/saWmpKJIUAjyyNVc/arcgis/rest/services/MPD_Public_Safety_Incidents/FeatureServer/0',
  sourceUrl: 'https://data.memphistn.gov/',
  timeZone: 'America/Chicago',
  center: [-90.049, 35.1495],
  zoom: 10.5,
  bounds: { west: -90.19, south: 34.99, east: -89.69, north: 35.27 },
  cadence: 'Updated irregularly',
  delayNote: 'Updates arrive in irregular batches, so the newest record can be a week or more old; the newest two days of a batch are partial.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are published as hundred blocks and points are rounded to three decimals (about one hundred meters).',
  coverageNote: 'One row per offense in an incident; the same incident can appear under several offense codes.',
  lastVerified: '2026-10-21',
};

const memphis = cityProvider({
  meta: MEMPHIS_META,
  epochSemantics: 'utc',
  idFields: ['Crime_ID', 'UCR_Incident_Code'],
  sourceId: (row) => compositeId(row, 'Crime_ID', 'UCR_Incident_Code'),
  dateFields: ['Offense_Datetime'],
  categoryFields: ['UCR_Category'],
  descriptionFields: ['UCR_Description'],
  locationFields: ['Street_Address', 'Precinct'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
}, { layerName: 'MPD_Public_Safety_Incidents', dateField: 'Offense_Datetime', objectIdField: 'ObjectId', pageSize: 1000 });

export const mapMemphisFeature = memphis.mapFeature;
export const memphisProvider = memphis.provider;

// ── Raleigh ──────────────────────────────────────────────────────────────────

export const RALEIGH_META: ProviderMeta = {
  id: 'raleigh',
  city: 'Raleigh',
  state: 'NC',
  label: 'Raleigh, North Carolina',
  agency: 'Raleigh Police Department',
  datasetName: 'Raleigh Police Incidents (NIBRS)',
  endpoint: 'https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Police_Incidents/FeatureServer/0',
  sourceUrl: 'https://data.raleighnc.gov/',
  timeZone: 'America/New_York',
  center: [-78.6382, 35.7796],
  zoom: 11,
  bounds: { west: -78.83, south: 35.7, east: -78.46, north: 35.98 },
  cadence: 'Updated daily',
  delayNote: 'Reports publish within hours; the newest two days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are published as hundred blocks; points can differ within a block, so the atlas rounds them to an approximately one-hundred-meter grid.',
  coverageNote: 'Offenses dated by when they were reported, not when they occurred; one case can list several offenses. Non-offense reports (miscellaneous, animal control, juvenile) are excluded, and sensitive cases are published without a location.',
  lastVerified: '2026-10-21',
};

export const RALEIGH_FILTER = "crime_category NOT IN ('MISCELLANEOUS', 'HUMANE', 'JUVENILE')";

const RALEIGH_LOCAL_PARTS = ['reported_year', 'reported_month', 'reported_day', 'reported_hour'] as const;

/**
 * `reported_date` switched from true UTC to local wall-clock epochs in late September 2026,
 * and rows rewritten since then switch with it, while the integer `reported_*` fields are
 * always local. The local time is rebuilt from them; minutes agree in both forms because the
 * zone offsets are whole hours.
 */
export function raleighLocalReport(incident: Incident, row: Row): Incident | null {
  const parts = RALEIGH_LOCAL_PARTS.map((field) => numberValue(attribute(row, field)));
  if (parts.some((part) => part === null)) return null;
  const [year, month, day, hour] = parts.map((part) => String(part).padStart(2, '0'));
  // An impossible date (month 13) is rejected rather than rolled over.
  return rebuilt(RALEIGH_META, incident, {
    occurredAt: `${year}-${month}-${day}T${hour}:${incident.occurredAt.slice(14, 16)}:00`,
  });
}

const raleigh = cityProvider({
  meta: RALEIGH_META,
  // The newest rows, and so the newest-record statistic, are local wall-clock epochs.
  epochSemantics: 'local-clock',
  idFields: ['case_number', 'crime_code', 'GlobalID'],
  sourceId: (row) => compositeId(row, 'case_number', 'crime_code', 'GlobalID'),
  dateFields: ['reported_date'],
  categoryFields: ['crime_category'],
  descriptionFields: ['crime_description'],
  locationFields: ['reported_block_address', 'district'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['longitude'],
  latitudeFields: ['latitude'],
  coordinateDigits: ROUNDED_DIGITS,
  refineFields: RALEIGH_LOCAL_PARTS,
  refine: raleighLocalReport,
}, {
  layerName: 'Incidents',
  dateField: 'reported_date',
  objectIdField: 'OBJECTID',
  filter: RALEIGH_FILTER,
});

export const mapRaleighFeature = raleigh.mapFeature;
export const raleighProvider = raleigh.provider;

// ── Montgomery County, Maryland ──────────────────────────────────────────────

export const MONTGOMERY_COUNTY_MD_META: ProviderMeta = {
  id: 'montgomery-county-md',
  city: 'Montgomery County',
  state: 'MD',
  label: 'Montgomery County, Maryland',
  agency: 'Montgomery County Police Department',
  datasetName: 'Crime',
  endpoint: 'https://data.montgomerycountymd.gov/resource/icn6-v9z3.json',
  sourceUrl: 'https://data.montgomerycountymd.gov/d/icn6-v9z3',
  timeZone: 'America/New_York',
  center: [-77.16, 39.1],
  zoom: 10,
  bounds: { west: -77.53, south: 38.93, east: -76.88, north: 39.36 },
  cadence: 'Updated daily',
  delayNote: 'Offenses publish after report entry; the newest four days are still filling in.',
  settlingDays: 4,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block with one public point per block.',
  coverageNote: 'Offenses countywide from County Police and the Rockville, Gaithersburg and Takoma Park police; one incident can list several offenses. Non-criminal reports (police information, mental-health petitions, lost or recovered property, deaths, missing persons) are excluded, and about one in seven offenses has no published location.',
  lastVerified: '2026-10-21',
};

/** MCPD's local non-criminal report codes (runaways, suicides, deaths, lost property…). */
export const MONTGOMERY_COUNTY_MD_NON_CRIMINAL_CODES = [
  '9021', '9041', '9042', '9101', '9102', '9104', '9105', '9106', '9107', '9108', '9109', '9112', '9113', '9199', '9201',
] as const;

const MONTGOMERY_COUNTY_MD_FIELDS = fields({
  id: 'incident_id',
  secondaryId: 'offence_code',
  date: 'start_date',
  category: 'crimename2',
  description: 'crimename3',
  location: 'location',
  area: 'city',
  point: 'geolocation',
});

export function mapMontgomeryCountyMdRow(row: Row): Incident | null {
  const incident = incidentFromRow(MONTGOMERY_COUNTY_MD_META, row, MONTGOMERY_COUNTY_MD_FIELDS, {
    locationFallback: 'Published hundred block',
    // Joined with the local description, "Theft From Motor Vehicle" + "LARCENY…" reads as vehicle theft.
    classificationText: (_source, _map, rawCategory) => rawCategory,
  });
  // Blocks are published with a double space ("100 BLK  MARYLAND AVE").
  return incident && { ...incident, locationLabel: incident.locationLabel.replace(/\s{2,}/g, ' ') };
}

export const montgomeryCountyMdProvider = createSocrataProvider<FieldKey>({
  meta: MONTGOMERY_COUNTY_MD_META,
  schema: { fields: MONTGOMERY_COUNTY_MD_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  filter: `offence_code NOT IN (${sqlList(MONTGOMERY_COUNTY_MD_NON_CRIMINAL_CODES)})`,
  mapRow: mapMontgomeryCountyMdRow,
});

// ── Tampa ────────────────────────────────────────────────────────────────────

export const TAMPA_META: ProviderMeta = {
  id: 'tampa',
  city: 'Tampa',
  state: 'FL',
  label: 'Tampa, Florida',
  agency: 'Tampa Police Department',
  datasetName: 'Crimes — Public, Last 365 Days',
  endpoint: 'https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/crimes_public_365days/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=654a4f080b11490b920761964eed849a',
  timeZone: 'America/New_York',
  center: [-82.4572, 27.9506],
  zoom: 10.8,
  bounds: { west: -82.66, south: 27.8, east: -82.25, north: 28.18 },
  cadence: 'Updated daily',
  delayNote: 'The rolling layer trails by about two days; the newest two published days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'intersection',
  precisionNote: 'Locations are published as the nearest intersection.',
  coverageNote: 'Only 13 Part I offense types (thefts, burglary, robbery, aggravated assault, rape and vehicle theft) over a rolling 365 days, dated by the day the offense began; the time of day is not published.',
  lastVerified: '2026-10-21',
};

const tampa = cityProvider({
  meta: TAMPA_META,
  epochSemantics: 'utc',
  idFields: ['offenseid', 'sequence'],
  sourceId: (row) => compositeId(row, 'offenseid', 'sequence'),
  dateFields: ['occurfrdate'],
  categoryFields: ['nibrsoffense'],
  descriptionFields: ['nibrsdesc'],
  locationFields: ['fulladdr', 'neighborhood'],
  locationFallback: 'Nearest intersection',
  longitudeFields: ['x'],
  latitudeFields: ['y'],
  // UTC instants of local midnight: the day is published, the time of day is not.
  refine: dateOnly(TAMPA_META),
}, { layerName: 'Crimes', dateField: 'occurfrdate', objectIdField: 'OBJECTID' });

export const mapTampaFeature = tampa.mapFeature;
export const tampaProvider = tampa.provider;

// ── Arlington, Texas ─────────────────────────────────────────────────────────

export const ARLINGTON_TX_META: ProviderMeta = {
  id: 'arlington-tx',
  city: 'Arlington',
  state: 'TX',
  label: 'Arlington, Texas',
  agency: 'Arlington Police Department',
  datasetName: 'Crime Data Rolling Day',
  endpoint: 'https://gis2.arlingtontx.gov/agsext2/rest/services/Police/PoliceExternal/MapServer/1',
  sourceUrl: 'https://gis2.arlingtontx.gov/agsext2/rest/services/Police/PoliceExternal/MapServer/1',
  timeZone: 'America/Chicago',
  center: [-97.1081, 32.7357],
  zoom: 11,
  bounds: { west: -97.24, south: 32.58, east: -97.03, north: 32.82 },
  cadence: 'Updated daily',
  delayNote: 'Cases keep arriving for more than a week after they occur; the newest nine days are excluded.',
  settlingDays: 9,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'The feed publishes exact points without an address; the atlas rounds them to an approximately one-hundred-meter grid and labels them by police beat.',
  coverageNote: 'NIBRS Group A offenses over a rolling year; one case can list several offenses.',
  lastVerified: '2026-10-21',
};

/**
 * Features carry true UTC instants, but this MapServer's newest-record statistic ignores its
 * `dateFieldsTimeReference` and returns local wall-clock time. The layer is read as local-clock
 * (right for the statistic) and each feature is converted from UTC here.
 */
export function arlingtonTxLocalTime(incident: Incident, row: Row): Incident | null {
  const beat = firstText(row, ['Beat']);
  const district = firstText(row, ['District']);
  return rebuilt(ARLINGTON_TX_META, incident, {
    occurredAt: localClockTimestamp(toLocalClockEpoch(incident.occurredAtEpochMs, ARLINGTON_TX_META.timeZone)),
    locationLabel: joinLabels(
      [beat ? `Beat ${beat}` : '', district ? `${district} district` : ''],
      incident.locationLabel,
    ),
  });
}

const arlingtonTx = cityProvider({
  meta: ARLINGTON_TX_META,
  epochSemantics: 'local-clock',
  idFields: ['CaseNumber', 'CrimeCode'],
  sourceId: (row) => compositeId(row, 'CaseNumber', 'CrimeCode'),
  dateFields: ['DateOfOccurrence'],
  categoryFields: ['CrimeCode'],
  descriptionFields: ['Description'],
  locationFields: ['Beat', 'District'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: ROUNDED_DIGITS,
  refine: arlingtonTxLocalTime,
}, { layerName: 'Crime Data Rolling Day', dateField: 'DateOfOccurrence', objectIdField: 'OBJECTID' });

export const mapArlingtonTxFeature = arlingtonTx.mapFeature;
export const arlingtonTxProvider = arlingtonTx.provider;

// ── New Orleans (calls for service) ──────────────────────────────────────────

export const NEW_ORLEANS_META: ProviderMeta = {
  id: 'new-orleans',
  city: 'New Orleans',
  state: 'LA',
  label: 'New Orleans, Louisiana',
  agency: 'New Orleans Police Department',
  datasetName: 'Calls for Service 2026',
  endpoint: 'https://data.nola.gov/resource/es9j-6y5d.json',
  sourceUrl: 'https://data.nola.gov/d/es9j-6y5d',
  timeZone: 'America/Chicago',
  center: [-90.0715, 29.9511],
  zoom: 11,
  bounds: { west: -90.15, south: 29.86, east: -89.62, north: 30.2 },
  cadence: 'Updated daily',
  delayNote: 'Calls are logged as they are created and published the next morning; the annual file restarts every January.',
  settlingDays: 0,
  datasetStart: '2026-01-01',
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block or intersection and its geocoded point.',
  coverageNote: 'These are 911 and officer-initiated calls for service, not crime reports: a call records what was reported or found, not a confirmed offense. Only reviewed crime call types are included (no alarms, traffic, medical or complaint calls), and duplicate, void, unfounded and cancelled calls are excluded.',
  lastVerified: '2026-10-21',
};

/** Reviewed final call types that describe a crime, as published in `typetext`. */
export const NEW_ORLEANS_CRIME_CALL_TYPES = [
  'HOMICIDE', 'HOMICIDE BY SHOOTING', 'HOMICIDE BY CUTTING', 'ATTEMPTED MURDER',
  'AGGRAVATED RAPE', 'SIMPLE RAPE', 'ATTEMPTED AGGRAVATED RAPE', 'ATTEMPTED SIMPLE RAPE',
  'SEXUAL BATTERY', 'MISDEMEANOR SEXUAL BATTERY',
  'ARMED ROBBERY', 'ARMED ROBBERY WITH GUN', 'ARMED ROBBERY WITH KNIFE', 'ATTEMPTED ARMED ROBBERY',
  'SIMPLE ROBBERY', 'SIMPLE ROBBERY, PROPERTY SNATCHING', 'ATTEMPTED SIMPLE ROBBERY',
  'CARJACKING', 'CARJACKING- NO WEAPON', 'ATTEMPTED ARMED CARJACKING', 'ATTEMPTED CARJACKING NO WEAPON',
  'AGGRAVATED ASSAULT', 'AGGRAVATED ASSAULT DOMESTIC', 'SIMPLE ASSAULT', 'SIMPLE ASSAULT DOMESTIC',
  'AGGRAVATED BATTERY', 'AGGRAVATED BATTERY BY SHOOTING', 'AGGRAVATED BATTERY BY CUTTING', 'AGGRAVATED BATTERY DOMESTIC',
  'SIMPLE BATTERY', 'SIMPLE BATTERY DOMESTIC',
  'AGGRAVATED KIDNAPPING', 'SIMPLE KIDNAPPING', 'HUMAN TRAFFICKING', 'STALKING INCIDENT',
  'EXTORTION (THREATS)', 'EXTORTION (THREATS) DOMESTIC',
  'DISCHARGING FIREARM', 'ILLEGAL CARRYING OF WEAPON', 'ILLEGAL CARRYING OF WEAPON- GUN', 'ILLEGAL CARRYING OF WEAPON- KNIFE',
  'SIMPLE BURGLARY', 'ATTEMPTED SIMPLE BURGLARY', 'SIMPLE BURGLARY DOMESTIC', 'RESIDENCE BURGLARY', 'BUSINESS BURGLARY',
  'AGGRAVATED BURGLARY', 'AGGRAVATED BURGLARY DOMESTIC', 'ATTEMPTED AGGRAVATED BURGLARY', 'HOME INVASION',
  'SIMPLE BURGLARY VEHICLE', 'ATTEMPTED SIMPLE BURGLARY VEHICLE', 'AUTO SMASH & GRAB',
  'THEFT', 'ATTEMPTED THEFT', 'THEFT DOMESTIC', 'THEFT BY FRAUD', 'THEFT BY EMBEZZLEMENT',
  'THEFT FROM EXTERIOR OF VEHICLE', 'ATTEMPTED THEFT FORM VEHICLE', 'SHOPLIFTING', 'PICKPOCKET', 'BICYCLE THEFT',
  'POSSESSION OF STOLEN PROPERTY', 'FORGERY',
  'AUTO THEFT', 'ATTEMPTED AUTO THEFT', 'UNAUTHORIZED USE OF VEHICLE',
  'SIMPLE CRIMINAL DAMAGE', 'CRIMINAL DAMAGE DOMESTIC', 'AGGRAVATED CRIMINAL DAMAGE', 'CRIMINAL MISCHIEF', 'CRIMINAL MISCHIEF DOMESTIC',
  'SIMPLE ARSON', 'ATTEMPTED SIMPLE ARSON', 'AGGRAVATED ARSON',
  'DRUG VIOLATIONS',
] as const;

/** Duplicate, void, unfounded and cancelled-by-complainant dispositions. */
const NEW_ORLEANS_EXCLUDED_DISPOSITIONS = ['DUP', 'VOI', 'UNF', 'CBC'] as const;

export const NEW_ORLEANS_FILTER = [
  `typetext IN (${sqlList(NEW_ORLEANS_CRIME_CALL_TYPES)})`,
  `(disposition IS NULL OR disposition NOT IN (${sqlList(NEW_ORLEANS_EXCLUDED_DISPOSITIONS)}))`,
].join(' AND ');

const NEW_ORLEANS_FIELDS = fields({
  id: 'nopd_item',
  date: 'timecreate',
  category: 'typetext',
  description: 'dispositiontext',
  location: 'block_address',
  point: 'location',
});

export function mapNewOrleansRow(row: Row): Incident | null {
  return incidentFromRow(NEW_ORLEANS_META, row, NEW_ORLEANS_FIELDS, {
    locationFallback: 'Published hundred block',
    locationKeys: ['location'],
    description: (source, map) => joinLabels(['Call for service', resolvedText(source, map, 'description')], ''),
    // The disposition ("NECESSARY ACTION TAKEN") says nothing about the offense.
    classificationText: (_source, _map, rawCategory) => rawCategory,
  });
}

export const newOrleansProvider = createSocrataProvider<FieldKey>({
  meta: NEW_ORLEANS_META,
  schema: { fields: NEW_ORLEANS_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  filter: NEW_ORLEANS_FILTER,
  mapRow: mapNewOrleansRow,
});

// ── Orlando ──────────────────────────────────────────────────────────────────

export const ORLANDO_META: ProviderMeta = {
  id: 'orlando',
  city: 'Orlando',
  state: 'FL',
  label: 'Orlando, Florida',
  agency: 'Orlando Police Department',
  datasetName: 'OPD Cases (LERMSCases4Dashboard)',
  endpoint: 'https://gis.orlando.gov/server/rest/services/OPD_Cases_Viewing/FeatureServer/0',
  sourceUrl: 'https://gis.orlando.gov/server/rest/services/OPD_Cases_Viewing/FeatureServer/0',
  timeZone: 'America/New_York',
  center: [-81.3792, 28.5383],
  zoom: 11,
  bounds: { west: -81.51, south: 28.34, east: -81.12, north: 28.62 },
  cadence: 'Updated daily',
  delayNote: 'Cases publish after report entry; the newest four days are still filling in.',
  settlingDays: 4,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'The feed publishes exact points without an address; the atlas rounds them to an approximately one-hundred-meter grid and labels them by neighborhood.',
  coverageNote: 'One row per police case, dated when the case was created, so it can differ from the time of the offense. Reviewed non-crime case types (information reports, lost or found property, traffic crashes, warrant arrests, welfare and death investigations) are excluded; a new non-crime type would appear until reviewed. Sexual offenses are not published.',
  lastVerified: '2026-10-21',
};

/**
 * Reviewed non-crime `GISCaseType` values (every type seen from October 2025 to October 2026).
 * A denylist, because the allowlist of crime types pushes the query URL past this server's
 * 2,048-character limit.
 */
export const ORLANDO_NON_CRIME_CASE_TYPES = [
  'Information Report', 'Suspicious Incident/Person', 'Suspicious Device', 'Baker Act',
  'Lost Property', 'Found Property', 'Confiscated Property', 'Recovered Stolen Property',
  'Recovered Stolen Vehicle', 'Recovered Vehicle Tag', 'Recovered Missing Adult', 'Missing Person-Adult', 'Adult At-Large',
  'Unattended Death', 'Suicide', 'Attemtped Suicide', 'Drowning', 'Industrial Accident', 'Train Accident',
  'Florida Traffic Crash Report', 'Traffic Arrest', 'Misdemeanor Arrest', 'Warrant Arrest',
  'City Ordinance Violation', 'Custody Dispute', 'Serving an Injunction', 'Tow Violation',
] as const;

export const ORLANDO_FILTER = `GISCaseType NOT IN (${sqlList(ORLANDO_NON_CRIME_CASE_TYPES)})`;

const orlando = cityProvider({
  meta: ORLANDO_META,
  epochSemantics: 'local-clock',
  idFields: ['CaseNumber'],
  dateFields: ['CaseDate'],
  categoryFields: ['GISCaseType'],
  descriptionFields: ['CaseType'],
  locationFields: ['NeighborhoodName'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: ROUNDED_DIGITS,
  refine: (incident) => rebuilt(ORLANDO_META, incident, { classificationText: incident.rawCategory }),
}, { layerName: 'LERMSCases4Dashboard', dateField: 'CaseDate', objectIdField: 'OBJECTID', filter: ORLANDO_FILTER });

export const mapOrlandoFeature = orlando.mapFeature;
export const orlandoProvider = orlando.provider;

// ── Baton Rouge ──────────────────────────────────────────────────────────────

export const BATON_ROUGE_META: ProviderMeta = {
  id: 'baton-rouge',
  city: 'Baton Rouge',
  state: 'LA',
  label: 'Baton Rouge, Louisiana',
  agency: 'Baton Rouge Police Department',
  datasetName: 'Baton Rouge Police Crime Incidents',
  endpoint: 'https://data.brla.gov/resource/pbin-pcm7.json',
  sourceUrl: 'https://data.brla.gov/d/pbin-pcm7',
  timeZone: 'America/Chicago',
  center: [-91.1871, 30.4515],
  zoom: 11,
  bounds: { west: -91.24, south: 30.33, east: -91.0, north: 30.56 },
  cadence: 'Updated irregularly',
  delayNote: 'Charges publish only after approval, so the newest week is far below normal; updates stalled in early October 2026.',
  settlingDays: 8,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'The feed publishes full street addresses and exact points; the atlas rounds points to an approximately one-hundred-meter grid and addresses to the hundred block.',
  coverageNote: 'One row per approved charge; an incident can list several charges, and repeated rows of the same charge are counted once. Traffic and other violations without a NIBRS offense are excluded, and about one in five charges has no published location.',
  lastVerified: '2026-10-21',
};

const BATON_ROUGE_FIELDS = fields({
  id: 'incident_number',
  secondaryId: 'charge_id',
  date: 'charge_date',
  category: 'statute_category',
  description: 'offense_description',
  location: 'street',
  area: 'neighborhood',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapBatonRougeRow(row: Row): Incident | null {
  const incident = incidentFromRow(BATON_ROUGE_META, row, BATON_ROUGE_FIELDS, {
    locationFallback: 'Approximate public location',
    // Statute categories ("THEFT") prefixed to NIBRS offenses can invent "… VEHICLE THEFT".
    classificationText: (_source, _map, _rawCategory, description) => description,
  });
  if (!incident) return null;
  return {
    ...incident,
    coordinates: roundCoordinates(incident.coordinates, ROUNDED_DIGITS),
    locationLabel: hundredBlock(incident.locationLabel),
  };
}

export const batonRougeProvider = createSocrataProvider<FieldKey>({
  meta: BATON_ROUGE_META,
  schema: { fields: BATON_ROUGE_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  filter: 'nibrs_code IS NOT NULL',
  mapRow: mapBatonRougeRow,
});

// ── Charleston, South Carolina ───────────────────────────────────────────────

export const CHARLESTON_META: ProviderMeta = {
  id: 'charleston',
  city: 'Charleston',
  state: 'SC',
  label: 'Charleston, South Carolina',
  agency: 'Charleston Police Department',
  datasetName: 'PDI Reported Incidents',
  endpoint: 'https://services2.arcgis.com/tQaXW7Zb1Vphzvgd/arcgis/rest/services/PDI_Reported_Incidents/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=69d85743b5b0484ab12382e7562377c6',
  timeZone: 'America/New_York',
  center: [-79.9311, 32.7765],
  zoom: 11,
  bounds: { west: -80.19, south: 32.66, east: -79.79, north: 32.98 },
  cadence: 'Updated periodically',
  delayNote: 'The layer runs about two weeks behind; the newest two published days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are published as blocks or intersections ("6XX KING ST"); points can differ within a block, so the atlas rounds them to an approximately one-hundred-meter grid.',
  coverageNote: 'Only three published categories: violent offenses, selected property offenses (burglary, vehicle theft and thefts from vehicles) and drug and weapon law violations, which make up most rows. Other thefts, simple assaults and vandalism are not published, so totals are not comparable with other cities.',
  lastVerified: '2026-10-21',
};

/** `DateOccurred` is the local date at midnight; the hour is published separately (`TimeOccurred` is empty). */
export function charlestonLocalTime(incident: Incident, row: Row): Incident | null {
  const hour = numberValue(attribute(row, 'IncidentHour'));
  const known = hour !== null && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  return rebuilt(CHARLESTON_META, incident, {
    occurredAt: `${incident.occurredAt.slice(0, 10)}T${known ? String(hour).padStart(2, '0') : '00'}:00:00`,
    timeKnown: known,
    // Joined with "Drug and Weapon Law", every drug charge would read as a weapons offense.
    classificationText: incident.description,
  });
}

const charleston = cityProvider({
  meta: CHARLESTON_META,
  epochSemantics: 'local-clock',
  idFields: ['OCA', 'ucr_code'],
  sourceId: (row) => compositeId(row, 'OCA', 'ucr_code'),
  dateFields: ['DateOccurred'],
  categoryFields: ['IncidentCategory'],
  descriptionFields: ['ChargeDescription'],
  locationFields: ['StreetAddress'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: ROUNDED_DIGITS,
  refineFields: ['IncidentHour'],
  refine: charlestonLocalTime,
}, { layerName: 'PDI_Reported_Incidents', dateField: 'DateOccurred', objectIdField: 'OBJECTID' });

export const mapCharlestonFeature = charleston.mapFeature;
export const charlestonProvider = charleston.provider;

// ── Registry exports ─────────────────────────────────────────────────────────

/** Ordered east to west. */
export const SOUTH_PROVIDERS: readonly IncidentProvider[] = [
  baltimoreProvider,
  montgomeryCountyMdProvider,
  raleighProvider,
  charlestonProvider,
  charlotteProvider,
  orlandoProvider,
  jacksonvilleProvider,
  tampaProvider,
  atlantaProvider,
  memphisProvider,
  newOrleansProvider,
  batonRougeProvider,
  arlingtonTxProvider,
];

/** One travel spot per provider, in the same order. */
export const SOUTH_FEATURED_PLACES: readonly SelectedPlace[] = [
  { label: 'Inner Harbor', detail: 'Baltimore, Maryland', coordinates: [-76.6097, 39.2858] },
  { label: 'Downtown Bethesda', detail: 'Montgomery County, Maryland', coordinates: [-77.0947, 38.9847] },
  { label: 'Fayetteville Street', detail: 'Raleigh, North Carolina', coordinates: [-78.6389, 35.7771] },
  { label: 'Charleston City Market', detail: 'Charleston, South Carolina', coordinates: [-79.9307, 32.7808] },
  { label: 'Uptown Charlotte', detail: 'Charlotte, North Carolina', coordinates: [-80.8431, 35.2271] },
  { label: 'Lake Eola Park', detail: 'Orlando, Florida', coordinates: [-81.3731, 28.5434] },
  { label: 'Downtown Jacksonville', detail: 'Jacksonville, Florida', coordinates: [-81.6593, 30.329] },
  { label: 'Ybor City', detail: 'Tampa, Florida', coordinates: [-82.4364, 27.9603] },
  { label: 'Centennial Olympic Park', detail: 'Atlanta, Georgia', coordinates: [-84.3933, 33.7603] },
  { label: 'Beale Street', detail: 'Memphis, Tennessee', coordinates: [-90.051, 35.1393] },
  { label: 'French Quarter', detail: 'New Orleans, Louisiana', coordinates: [-90.063, 29.9574] },
  { label: 'Louisiana State Capitol', detail: 'Baton Rouge, Louisiana', coordinates: [-91.1873, 30.457] },
  { label: 'AT&T Stadium', detail: 'Arlington, Texas', coordinates: [-97.0929, 32.7473] },
];

/**
 * Provider id → Census place GEOID(s) of the police jurisdiction; `county:` marks a county
 * (five-digit county GEOID) for countywide agencies.
 */
export const SOUTH_JURISDICTIONS: Readonly<Record<string, string | readonly string[]>> = {
  baltimore: '2404000',
  // County Police plus the municipal departments that publish into the same feed.
  'montgomery-county-md': 'county:24031',
  raleigh: '3755000',
  charleston: '4513330',
  charlotte: '3712000',
  orlando: '1253000',
  // The consolidated city's balance plus Baldwin, which JSO patrols; the Beaches have their own police.
  jacksonville: ['1235000', '1203250'],
  tampa: '1271000',
  atlanta: '1304000',
  memphis: '4748000',
  'new-orleans': '2255000',
  'baton-rouge': '2205000',
  'arlington-tx': '4804000',
};
