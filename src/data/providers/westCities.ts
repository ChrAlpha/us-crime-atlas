import { normalizeCategory } from '../../domain/categories';
import { combineDateAndTime, hourFromTimestamp, sourceTimestampToEpoch } from '../../domain/time';
import type { Incident, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { cityProvider, firstText, type Row } from './arcgisCities';
import { createSocrataProvider, resolvedText } from './socrata';
import { COORDINATE_KEYS, fields, incidentFromRow, localClock, type FieldKey } from './socrataCities';

const VERIFIED = '2026-10-21';

// ── Shared West helpers ──────────────────────────────────────────────────────

/** `primary:rest…` from the named attributes, or `''` when the primary identifier is missing. */
export function compositeId(row: Row, primary: string, ...rest: readonly string[]): string {
  const id = firstText(row, [primary]);
  return id && [id, ...rest.map((name) => firstText(row, [name]))].join(':');
}

/**
 * Replaces a leading house number with its hundred block (`2614 ENSENADA WY` →
 * `2600 BLOCK ENSENADA WY`). Block labels and intersections pass through unchanged.
 */
export function hundredBlock(label: string): string {
  return label
    .replace(/\s+/g, ' ')
    .replace(/^(\d+)\S* (?!(?:BLOCK|BLK)\b)/i, (_match, houseNumber: string) => (
      `${Math.floor(Number(houseNumber) / 100) * 100} BLOCK `
    ));
}

/**
 * Re-times an incident from a layer that publishes the day and the time of day separately,
 * or the day only. `clock` is `HH:MM:SS`; without it the incident keeps midnight for
 * windowing but has no known hour.
 */
export function withLocalClock(incident: Incident, clock: string | null, day: string = incident.occurredAt): Incident | null {
  const occurredAt = combineDateAndTime(day, clock ?? undefined);
  const occurredAtEpochMs = sourceTimestampToEpoch(occurredAt);
  if (!Number.isFinite(occurredAtEpochMs)) return null;
  return {
    ...incident,
    occurredAt,
    occurredAtEpochMs,
    localHour: clock === null ? null : hourFromTimestamp(occurredAt),
  };
}

/** An integer hour attribute (`occur_hr`) as `HH:00:00`, or `null`. */
export function hourClock(value: unknown): string | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23
    ? `${String(value).padStart(2, '0')}:00:00`
    : null;
}

/** Date-only layers: midnight for windowing, unknown hour. */
const dateOnly = (incident: Incident) => withLocalClock(incident, null);

// ── Berkeley ─────────────────────────────────────────────────────────────────

export const BERKELEY_META: ProviderMeta = {
  id: 'berkeley',
  city: 'Berkeley',
  state: 'CA',
  label: 'Berkeley, California',
  agency: 'Berkeley Police Department',
  datasetName: 'BPD Transparency Hub cases (cases_latlon)',
  endpoint: 'https://services7.arcgis.com/vIHhVXjE1ToSg0Fz/arcgis/rest/services/cases_latlon/FeatureServer/0',
  sourceUrl: 'https://bpd-transparency-initiative-berkeleypd.hub.arcgis.com',
  timeZone: 'America/Los_Angeles',
  // North Berkeley: Oakland's reviewed rectangle reaches 37.89° N and covers central Berkeley.
  center: [-122.27, 37.8935],
  zoom: 12.2,
  bounds: { west: -122.37, south: 37.835, east: -122.23, north: 37.91 },
  cadence: 'Updated daily',
  delayNote: 'Cases publish after entry into the records system; the newest two days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Locations are published as a block or intersection; coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Berkeley Police cases since 2016, one row per statute charged, so a case can appear several times. Incidents handled by other agencies, such as UC Berkeley police on campus, are published separately.',
  lastVerified: VERIFIED,
};

const berkeley = cityProvider({
  meta: BERKELEY_META,
  epochSemantics: 'utc',
  idFields: ['Case_Number', 'Statute', 'Statute_Description'],
  // A case has one row per statute, and a statute can repeat with a different description.
  sourceId: (row) => compositeId(row, 'Case_Number', 'Statute', 'Statute_Description'),
  dateFields: ['Occurred_Datetime'],
  categoryFields: ['Incident_Type'],
  descriptionFields: ['Statute_Description'],
  locationFields: ['Block_Address'],
  locationFallback: 'Published block',
  longitudeFields: ['lon'],
  latitudeFields: ['lat'],
  coordinateDigits: 3,
}, { layerName: 'cases_latlon', dateField: 'Occurred_Datetime', objectIdField: 'ObjectId', pageSize: 1000 });

export const mapBerkeleyFeature = berkeley.mapFeature;
export const berkeleyProvider = berkeley.provider;

// ── San Mateo ────────────────────────────────────────────────────────────────

export const SAN_MATEO_META: ProviderMeta = {
  id: 'san-mateo',
  city: 'San Mateo',
  state: 'CA',
  label: 'San Mateo, California',
  agency: 'San Mateo Police Department',
  datasetName: 'PD Crime Data (RIMS_CRIME_ALL)',
  endpoint: 'https://services2.arcgis.com/g26Y0m7OCdjU0ObA/arcgis/rest/services/PD_Crime_Data_All/FeatureServer/1',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=0f517e442bef4aca81176878accc7b2f',
  timeZone: 'America/Los_Angeles',
  center: [-122.3255, 37.563],
  zoom: 12,
  bounds: { west: -122.36, south: 37.51, east: -122.27, north: 37.61 },
  cadence: 'Refreshed quarterly',
  delayNote: 'Refreshed once a quarter, so the newest records can be up to about three and a half months old; the newest three published days are partial.',
  settlingDays: 3,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'The source publishes exact addresses; the atlas generalizes them to the hundred block and rounds coordinates to an approximately one-hundred-meter grid.',
  coverageNote: 'Calls that produced a police report, excluding informational, lost-and-found, collision, mental-health, missing-person and other non-criminal reports. Dates carry no time of day; a report can list up to ten offenses and only the first is shown.',
  lastVerified: VERIFIED,
};

/** Report rows whose first offense is not a crime (reviewed from a year of OFFDESC1 values). */
export const SAN_MATEO_FILTER = `REPORT = 'Y' AND OFFDESC1 NOT IN (${[
  'Mental Health Evaluation',
  'Informational Only',
  'Informational Cross Report',
  'Collision Report with Injuries',
  'Collision Report No Injury',
  'Lost Property',
  'Found Property',
  'Property for destruction',
  'Property for Safekeeping',
  'Recovered Local Prop/Veh',
  'Outside Agency Recovered Stolen Property/Veh - Info',
  'Outside Agency Assist',
  'Courtesy Report for Outside Agency',
  'Suspicious Circumstances',
  'Suspicious Circumstance Sexual Assault',
  'Missing Person',
  'Located missing person',
  "Coroner's Case",
  'Voided Case',
  'Gang Validation',
  'Welfare Check',
  'Civil Matter-Informational Case',
].map((value) => `'${value.replaceAll("'", "''")}'`).join(', ')})`;

const sanMateo = cityProvider({
  meta: SAN_MATEO_META,
  epochSemantics: 'local-clock',
  idFields: ['OBJECTID'],
  dateFields: ['DATEX'],
  categoryFields: ['OFFDESC1'],
  descriptionFields: ['OFFDESC1'],
  locationFields: ['ADDRESS'],
  locationFallback: 'Generalized block',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refineFields: [],
  refine: (incident) => dateOnly({ ...incident, locationLabel: hundredBlock(incident.locationLabel) }),
}, { layerName: 'RIMS_CRIME_ALL', dateField: 'DATEX', objectIdField: 'OBJECTID', filter: SAN_MATEO_FILTER });

export const mapSanMateoFeature = sanMateo.mapFeature;
export const sanMateoProvider = sanMateo.provider;

// ── Tacoma (table: bounding box in SQL, separate approximate time) ───────────

export const TACOMA_META: ProviderMeta = {
  id: 'tacoma',
  city: 'Tacoma',
  state: 'WA',
  label: 'Tacoma, Washington',
  agency: 'Tacoma Police Department',
  datasetName: 'City of Tacoma Reported Crime',
  endpoint: 'https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/TPD_RMS_Crime/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=a27ad2206f16467793c17d33422c3e91',
  timeZone: 'America/Los_Angeles',
  center: [-122.4443, 47.2529],
  zoom: 11.2,
  bounds: { west: -122.57, south: 47.16, east: -122.34, north: 47.34 },
  cadence: 'Updated daily',
  delayNote: 'Records follow the occurred-on date given by the reporting person, sometimes a best guess; the newest four days are still filling in.',
  settlingDays: 4,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are anonymized to the hundred block and coordinates are rounded to an approximately one-hundred-meter grid; police stations and hospitals sometimes stand in for unknown locations.',
  coverageNote: 'Distinct offense descriptions per report, not NIBRS or UCR counts. The publisher removes sexual offenses and any offense involving domestic violence; traffic collisions are excluded here. Times are approximate, to the hour.',
  lastVerified: VERIFIED,
};

const tacoma = cityProvider({
  meta: TACOMA_META,
  epochSemantics: 'local-clock',
  idFields: ['CaseNo', 'OBJECTID'],
  // A report lists one row per distinct offense description under the same case number.
  sourceId: (row) => compositeId(row, 'CaseNo', 'OBJECTID'),
  dateFields: ['DateOccurred'],
  categoryFields: ['Offense_Category'],
  descriptionFields: ['Description'],
  locationFields: ['Address'],
  locationFallback: 'Anonymized hundred block',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: 3,
  refineFields: ['Approximate_Time'],
  // DateOccurred is the local day at midnight; Approximate_Time is `H:00` local time.
  refine: (incident, row) => withLocalClock(incident, localClock(firstText(row, ['Approximate_Time']))),
}, {
  layerName: 'City_Of_Tacoma_Reported_Crime',
  dateField: 'DateOccurred',
  objectIdField: 'OBJECTID',
  pageSize: 1000,
  filter: "Offense_Category IS NULL OR Offense_Category NOT LIKE 'Traffic Accident%'",
  coordinateAttributes: { latitude: 'Latitude', longitude: 'Longitude' },
});

export const mapTacomaFeature = tacoma.mapFeature;
export const tacomaProvider = tacoma.provider;

// ── Salt Lake City (local midnight plus a separate hour) ─────────────────────

export const SALT_LAKE_CITY_META: ProviderMeta = {
  id: 'salt-lake-city',
  city: 'Salt Lake City',
  state: 'UT',
  label: 'Salt Lake City, Utah',
  agency: 'Salt Lake City Police Department',
  datasetName: 'Public Crime at Intersections',
  endpoint: 'https://maps.slc.gov/server/rest/services/Hosted/PublicCrime_At_Intersections/FeatureServer/0',
  sourceUrl: 'https://maps.slc.gov/server/rest/services/Hosted/PublicCrime_At_Intersections/FeatureServer/0',
  timeZone: 'America/Denver',
  center: [-111.891, 40.7608],
  zoom: 11.2,
  bounds: { west: -112.11, south: 40.69, east: -111.735, north: 40.86 },
  cadence: 'Refreshed monthly',
  delayNote: 'Refreshed around mid-month with the previous complete month, so the newest records are four to seven weeks old.',
  settlingDays: 0,
  datasetStart: null,
  precision: 'intersection',
  precisionNote: 'Each record is mapped to the nearest intersection.',
  coverageNote: 'Selected Part I crimes (larceny, vehicle burglary and theft, burglary, aggravated assault, robbery, rape) for a rolling six months; a row can count two offenses of the same type. Times are published to the hour.',
  lastVerified: VERIFIED,
};

/** `date_t` (`2026/09/30`) is the authoritative local day; it guards against DST storage drift. */
function saltLakeDay(row: Row): string | undefined {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(firstText(row, ['date_t']));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

const saltLakeCity = cityProvider({
  meta: SALT_LAKE_CITY_META,
  // occur_dt is local midnight as a true UTC instant (06:00Z in summer).
  epochSemantics: 'utc',
  idFields: ['case_nbr', 'crime'],
  sourceId: (row) => compositeId(row, 'case_nbr', 'crime'),
  dateFields: ['occur_dt'],
  categoryFields: ['crime_type'],
  descriptionFields: ['crime'],
  locationFields: ['com_council'],
  locationFallback: 'Nearest intersection',
  longitudeFields: [],
  latitudeFields: [],
  refineFields: ['occur_hr', 'date_t'],
  refine: (incident, row) => withLocalClock(
    incident,
    hourClock(row.occur_hr),
    saltLakeDay(row) ?? incident.occurredAt,
  ),
}, { layerName: 'PublicCrime_At_Intersections', dateField: 'occur_dt', objectIdField: 'objectid' });

export const mapSaltLakeCityFeature = saltLakeCity.mapFeature;
export const saltLakeCityProvider = saltLakeCity.provider;

// ── Boulder ──────────────────────────────────────────────────────────────────

export const BOULDER_META: ProviderMeta = {
  id: 'boulder',
  city: 'Boulder',
  state: 'CO',
  label: 'Boulder, Colorado',
  agency: 'Boulder Police Department',
  datasetName: 'BPD Offenses',
  endpoint: 'https://services.arcgis.com/ePKBjXrBZ2vEEgWd/ArcGIS/rest/services/BPD_Offenses/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=8ef054b1a3ca4ac496d75ec28f17a117',
  timeZone: 'America/Denver',
  center: [-105.2797, 40.0176],
  zoom: 12,
  bounds: { west: -105.31, south: 39.95, east: -105.17, north: 40.1 },
  cadence: 'Updated daily',
  delayNote: 'The publisher describes a 48-hour delay, but the newest records were about three weeks old when reviewed; the newest five published days are still filling in.',
  settlingDays: 5,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are masked to the block (for example 1XX PEARL); coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Offenses addressed by Boulder Police since 2019, one row per offense, so a report can appear several times; details can change as cases are clarified. University of Colorado police incidents on campus are published separately.',
  lastVerified: VERIFIED,
};

const boulder = cityProvider({
  meta: BOULDER_META,
  epochSemantics: 'local-clock',
  idFields: ['Report_Number', 'OID'],
  // One report lists several offenses, and an offense description can repeat.
  sourceId: (row) => compositeId(row, 'Report_Number', 'OID'),
  dateFields: ['inc_date'],
  categoryFields: ['nibrs_offense', 'NIBRSdescription'],
  descriptionFields: ['vio_desc'],
  locationFields: ['STAddress'],
  locationFallback: 'Masked block',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
}, { layerName: 'Offenses', dateField: 'inc_date', objectIdField: 'OID' });

export const mapBoulderFeature = boulder.mapFeature;
export const boulderProvider = boulder.provider;

// ── Aurora, Colorado (date only) ─────────────────────────────────────────────

export const AURORA_CO_META: ProviderMeta = {
  id: 'aurora-co',
  city: 'Aurora',
  state: 'CO',
  label: 'Aurora, Colorado',
  agency: 'Aurora Police Department',
  datasetName: 'APD Transparency RMS Public View',
  endpoint: 'https://services3.arcgis.com/0Va1ID99NSrNyyPX/arcgis/rest/services/APD_Transparency_RMS_Public_View/FeatureServer/36',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=2ad951b54e1f4b42b269842c14e69477',
  timeZone: 'America/Denver',
  // Southlands, south of Denver's reviewed rectangle, which covers most of central Aurora.
  center: [-104.7065, 39.6007],
  zoom: 10.6,
  bounds: { west: -104.89, south: 39.55, east: -104.485, north: 39.83 },
  cadence: 'Refreshed monthly',
  delayNote: 'Refreshed about once a month with offenses reported through the end of the previous month; the newest three published days are still filling in.',
  settlingDays: 3,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'No address is published; point locations are rounded to an approximately one-hundred-meter grid and labeled with the neighborhood and premises type.',
  coverageNote: 'Group A offenses in major categories only (theft, assault, vehicle theft, burglary, robbery, sex offenses, arson, homicide), one row per report. Occurrence dates carry no time of day.',
  lastVerified: VERIFIED,
};

const auroraCo = cityProvider({
  meta: AURORA_CO_META,
  epochSemantics: 'local-clock',
  idFields: ['OffenseId'],
  dateFields: ['OccurFrDate'],
  categoryFields: ['OffenseCat'],
  descriptionFields: ['NIBRSDesc'],
  locationFields: ['Neighborhood', 'LocateDesc'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refineFields: [],
  refine: dateOnly,
}, { layerName: 'import', dateField: 'OccurFrDate', objectIdField: 'OBJECTID' });

export const mapAuroraCoFeature = auroraCo.mapFeature;
export const auroraCoProvider = auroraCo.provider;

// ── Colorado Springs (Socrata, Point column) ─────────────────────────────────

export const COLORADO_SPRINGS_META: ProviderMeta = {
  id: 'colorado-springs',
  city: 'Colorado Springs',
  state: 'CO',
  label: 'Colorado Springs, Colorado',
  agency: 'Colorado Springs Police Department',
  datasetName: 'Crime Level Data',
  endpoint: 'https://policedata.coloradosprings.gov/resource/bc88-hemr.json',
  sourceUrl: 'https://policedata.coloradosprings.gov/d/bc88-hemr',
  timeZone: 'America/Denver',
  center: [-104.8214, 38.8339],
  zoom: 10.8,
  bounds: { west: -104.93, south: 38.71, east: -104.575, north: 39.04 },
  cadence: 'Updated daily',
  delayNote: 'Offenses publish as reports are approved; the newest eleven days are still filling in.',
  settlingDays: 11,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Addresses are published at the hundred block with a matching point.',
  coverageNote: 'One row per offense charged in a case, so a case can appear several times; rows classified "Not A Crime" are excluded. About one in ten offenses has no published point and cannot be mapped. CSPD notes the data do not follow state or FBI counting rules.',
  lastVerified: VERIFIED,
};

const COLORADO_SPRINGS_FIELDS = fields({
  id: 'casenumber',
  secondaryId: 'statute',
  date: 'occurredfromdate',
  category: 'crimecodedescription',
  subcategory: 'nciccodedescription',
  description: 'statutedescription',
  detail: 'domestic',
  location: 'streetaddress',
  area: 'patrol_division',
  point: 'location_point',
});

export function mapColoradoSpringsRow(row: Row): Incident | null {
  const incident = incidentFromRow(COLORADO_SPRINGS_META, row, COLORADO_SPRINGS_FIELDS, {
    locationFallback: 'Published hundred block',
    // NIBRS and NCIC codes classify; the statute text only helps "Not Reportable" rows.
    classificationText: (source, map, rawCategory, description) => {
      const coded = `${rawCategory} ${resolvedText(source, map, 'subcategory')}`;
      return normalizeCategory(coded) === 'other' ? `${coded} ${description}` : coded;
    },
  });
  // Rows of one case can repeat a statute, differing only in the domestic-violence flag.
  return incident && { ...incident, id: `${incident.id}:${resolvedText(row, COLORADO_SPRINGS_FIELDS, 'detail')}` };
}

export const coloradoSpringsProvider = createSocrataProvider<FieldKey>({
  meta: COLORADO_SPRINGS_META,
  schema: { fields: COLORADO_SPRINGS_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  filter: "index_crime_category IS NULL OR index_crime_category != 'Not A Crime'",
  mapRow: mapColoradoSpringsRow,
});

// ── Sacramento ───────────────────────────────────────────────────────────────

export const SACRAMENTO_META: ProviderMeta = {
  id: 'sacramento',
  city: 'Sacramento',
  state: 'CA',
  label: 'Sacramento, California',
  agency: 'Sacramento Police Department',
  datasetName: 'Police Crime (3 Years)',
  endpoint: 'https://services5.arcgis.com/54falWtcpty3V47Z/ArcGIS/rest/services/Police_Crime_3Years/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=f889cb7dbc68439eb0de5f28ed0e9034',
  timeZone: 'America/Los_Angeles',
  center: [-121.4944, 38.5816],
  zoom: 11,
  bounds: { west: -121.565, south: 38.43, east: -121.355, north: 38.69 },
  cadence: 'Updated daily, about two weeks behind',
  delayNote: 'The city publishes records about fourteen days after they occur; the newest two published days are still filling in.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are masked to the block or an intersection; coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Crime reports for the current and two prior years, excluding incident (informational) and traffic-collision reports. Confidential reports, most assault reports, and sex-offense and missing-person reports publish no location, so they are never mapped.',
  lastVerified: VERIFIED,
};

const sacramento = cityProvider({
  meta: SACRAMENTO_META,
  epochSemantics: 'utc',
  idFields: ['Record_ID', 'OBJECTID_1'],
  // Record IDs are almost always unique; a handful of rows repeat one verbatim.
  sourceId: (row) => compositeId(row, 'Record_ID', 'OBJECTID_1'),
  dateFields: ['Occurrence_Date_UTC'],
  categoryFields: ['Offense_Category'],
  descriptionFields: ['Description'],
  locationFields: ['Location'],
  locationFallback: 'Masked block',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
}, {
  layerName: 'PD_Crime_3Years',
  dateField: 'Occurrence_Date_UTC',
  objectIdField: 'OBJECTID_1',
  // INC: informational incident reports (found property, 5150 holds, missing persons); 5400: collisions.
  filter: "Offense_Code NOT IN ('INC', '5400')",
});

export const mapSacramentoFeature = sacramento.mapFeature;
export const sacramentoProvider = sacramento.provider;

// ── Las Vegas (LVMPD: city and unincorporated Clark County) ──────────────────

export const LAS_VEGAS_META: ProviderMeta = {
  id: 'las-vegas',
  city: 'Las Vegas',
  state: 'NV',
  label: 'Las Vegas, Nevada',
  agency: 'Las Vegas Metropolitan Police Department',
  datasetName: 'LVMPD Reported NIBRS Crimes',
  endpoint: 'https://services.arcgis.com/jjSk6t82vIntwDbs/arcgis/rest/services/Weekly_Public_Crimes/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=c1ec788896ae46e0b896b72cb98e7ae8',
  timeZone: 'America/Los_Angeles',
  center: [-115.1728, 36.1147],
  zoom: 10.6,
  bounds: { west: -115.41, south: 35.95, east: -114.98, north: 36.41 },
  cadence: 'Updated weekly',
  delayNote: 'Published weekly; times are when the crime was reported, not when it occurred, and reports for the newest nine days keep arriving.',
  settlingDays: 9,
  datasetStart: '2025-01-01',
  precision: 'approximate',
  precisionNote: 'Addresses are published as a hundred block or intersection; points vary within it and are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'NIBRS offense rows reported to LVMPD since 2025 across the City of Las Vegas and unincorporated Clark County, including the Strip. Dates and times are when the crime was reported. One event can list several offenses. Henderson, North Las Vegas and Boulder City have their own police and are not covered.',
  lastVerified: VERIFIED,
};

const lasVegas = cityProvider({
  meta: LAS_VEGAS_META,
  epochSemantics: 'utc',
  idFields: ['Event_Number', 'NIBRSOffenseCode', 'OBJECTID'],
  // An event lists one row per offense; a code can repeat for a second victim.
  sourceId: (row) => compositeId(row, 'Event_Number', 'NIBRSOffenseCode', 'OBJECTID'),
  dateFields: ['ReportedOn'],
  categoryFields: ['OffenseCategory'],
  descriptionFields: ['Offense'],
  locationFields: ['Location'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: 3,
}, { layerName: 'Reported NIBRS Crime', dateField: 'ReportedOn', objectIdField: 'OBJECTID' });

export const mapLasVegasFeature = lasVegas.mapFeature;
export const lasVegasProvider = lasVegas.provider;

// ── Bakersfield ──────────────────────────────────────────────────────────────

export const BAKERSFIELD_META: ProviderMeta = {
  id: 'bakersfield',
  city: 'Bakersfield',
  state: 'CA',
  label: 'Bakersfield, California',
  agency: 'Bakersfield Police Department',
  datasetName: 'Public Crime View (COB Offenses)',
  endpoint: 'https://services3.arcgis.com/OKildAHLkXjQX8Ca/ArcGIS/rest/services/PublicCrimeView/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=1f782ffb865b43d6b00ddeff639fc2d0',
  timeZone: 'America/Los_Angeles',
  center: [-119.0187, 35.3733],
  zoom: 10.8,
  bounds: { west: -119.27, south: 35.19, east: -118.77, north: 35.45 },
  cadence: 'Updated daily',
  delayNote: 'Offenses publish after review; the newest five days are still filling in.',
  settlingDays: 5,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'No address is published; point locations are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'Selected serious offenses only (larceny, vehicle theft, burglary, robbery, assault, sex offenses, homicide) for about the last three years; other crimes are not published.',
  lastVerified: VERIFIED,
};

const bakersfield = cityProvider({
  meta: BAKERSFIELD_META,
  epochSemantics: 'local-clock',
  idFields: ['ObjectID'],
  dateFields: ['USER_event_date'],
  categoryFields: ['USER_nibrs_desc'],
  descriptionFields: ['USER_nibrs_long_desc'],
  locationFields: [],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
}, { layerName: 'COB_Offenses', dateField: 'USER_event_date', objectIdField: 'ObjectID' });

export const mapBakersfieldFeature = bakersfield.mapFeature;
export const bakersfieldProvider = bakersfield.provider;

// ── Riverside (record-entry dates, some exact addresses) ─────────────────────

export const RIVERSIDE_META: ProviderMeta = {
  id: 'riverside',
  city: 'Riverside',
  state: 'CA',
  label: 'Riverside, California',
  agency: 'Riverside Police Department',
  datasetName: 'Crimes (Last Year to Date)',
  endpoint: 'https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/View_CrimesRPD/FeatureServer/4',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=9c39e6708f884ee9bf81917fbf072196',
  timeZone: 'America/Los_Angeles',
  center: [-117.3755, 33.9806],
  zoom: 11,
  bounds: { west: -117.53, south: 33.87, east: -117.27, north: 34.025 },
  cadence: 'Updated daily',
  delayNote: 'Dates are when the record was entered, not when the offense occurred; records publish after review, so the newest twelve days are still filling in.',
  settlingDays: 12,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Locations are published at the block or an intersection, and some as an approximate street address that the atlas generalizes to the hundred block; coordinates are rounded to an approximately one-hundred-meter grid.',
  coverageNote: 'NIBRS offense case reports since January of last year, one row per offense. Since September 2025 the published offense time equals the record-entry time, so incidents carry a date but no time of day.',
  lastVerified: VERIFIED,
};

const APPROXIMATE_LOCATION_PREFIX = /^Approx(?:imate)?\.? Loc(?:ation)?:\s*/i;

const riverside = cityProvider({
  meta: RIVERSIDE_META,
  epochSemantics: 'utc',
  idFields: ['rpdunique'],
  dateFields: ['offendate'],
  categoryFields: ['nibrsdesc'],
  // `Subject` is free text that can name people, so it is never requested or shown.
  descriptionFields: ['IBRCrimeAgainst'],
  locationFields: ['BLOCK_ADDRESS'],
  locationFallback: 'Published block',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refineFields: [],
  refine: (incident) => dateOnly({
    ...incident,
    locationLabel: hundredBlock(incident.locationLabel.replace(APPROXIMATE_LOCATION_PREFIX, '')),
  }),
}, { layerName: 'Crime (Last Year to Date)', dateField: 'offendate', objectIdField: 'ObjectID' });

export const mapRiversideFeature = riverside.mapFeature;
export const riversideProvider = riverside.provider;

// ── Tempe ────────────────────────────────────────────────────────────────────

export const TEMPE_META: ProviderMeta = {
  id: 'tempe',
  city: 'Tempe',
  state: 'AZ',
  label: 'Tempe, Arizona',
  agency: 'Tempe Police Department',
  datasetName: 'General Offenses (Open Data)',
  endpoint: 'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/General_Offenses_(Open_Data)/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=1563be5b343b4f78b1163e97a9a503ad',
  timeZone: 'America/Phoenix',
  center: [-111.94, 33.4255],
  zoom: 11.6,
  bounds: { west: -111.985, south: 33.315, east: -111.875, north: 33.47 },
  cadence: 'Updated at least weekly',
  delayNote: 'Offense reports keep arriving for about three weeks, so the window excludes the newest twenty-one days.',
  settlingDays: 21,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are obfuscated to the block and coordinates are rounded to an approximately one-hundred-meter grid; the publisher randomizes sexual-violence call locations.',
  coverageNote: 'General offense reports, excluding service calls, information reports, collisions and other non-criminal codes ([SC-0], and [GO-0] except hit-and-run). Arizona State University police incidents on campus are published separately.',
  lastVerified: VERIFIED,
};

/** `[SC-0]` service calls and `[GO-0]` non-criminal reports, except hit-and-run collisions. */
export const TEMPE_FILTER = "OffenseCustom NOT LIKE '%SC-0]%' AND (OffenseCustom NOT LIKE '%GO-0]%' OR OffenseCustom LIKE '%HIT AND RUN%')";

const tempe = cityProvider({
  meta: TEMPE_META,
  epochSemantics: 'local-clock',
  idFields: ['PrimaryKey'],
  dateFields: ['OccurrenceDatetime'],
  categoryFields: ['OffenseCustom'],
  descriptionFields: ['OffenseCustom'],
  locationFields: ['ObfuscatedAddress', 'NeighborhoodName'],
  locationFallback: 'Obfuscated block',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  coordinateDigits: 3,
}, { layerName: 'General Offense', dateField: 'OccurrenceDatetime', objectIdField: 'OBJECTID', filter: TEMPE_FILTER });

export const mapTempeFeature = tempe.mapFeature;
export const tempeProvider = tempe.provider;

// ── Mesa (Socrata, date only) ────────────────────────────────────────────────

export const MESA_META: ProviderMeta = {
  id: 'mesa',
  city: 'Mesa',
  state: 'AZ',
  label: 'Mesa, Arizona',
  agency: 'Mesa Police Department',
  datasetName: 'Police Criminal Offenses 2020-present (Public)',
  endpoint: 'https://citydata.mesaaz.gov/resource/t445-fism.json',
  sourceUrl: 'https://citydata.mesaaz.gov/d/t445-fism',
  timeZone: 'America/Phoenix',
  center: [-111.8315, 33.4152],
  zoom: 10.8,
  bounds: { west: -111.895, south: 33.27, east: -111.575, north: 33.52 },
  cadence: 'Replaced daily',
  delayNote: 'Offenses appear as reports are reviewed; about sixteen of the newest days are still filling in, so the window excludes them.',
  settlingDays: 16,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Addresses are rounded to the hundred block and coordinates are derived from that rounded address.',
  coverageNote: 'One row per offense, so an incident can appear several times; occurrence dates carry no time of day. Locations of sensitive incidents (homicide, sex offenses, kidnapping and others) are withheld, so they are never mapped; addresses the city could not match are excluded.',
  lastVerified: VERIFIED,
};

const MESA_FIELDS = fields({
  id: 'offense_uid',
  date: 'occurred_date',
  category: 'offense_description',
  // Row-level; crime_type describes the whole incident and would mislabel its other offenses.
  description: 'local_offense_description',
  location: 'address',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapMesaRow(row: Row): Incident | null {
  return incidentFromRow(MESA_META, row, MESA_FIELDS, {
    // No time column: the date keeps midnight and the hour stays unknown.
    combineTime: true,
    locationFallback: 'Published hundred block',
    locationKeys: ['location'],
  });
}

export const mesaProvider = createSocrataProvider<FieldKey>({
  meta: MESA_META,
  schema: { fields: MESA_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  // verified = 0: the address could not be matched and the point defaults to Center and Main.
  filter: 'verified != 0',
  mapRow: mapMesaRow,
});

// ── Tucson (annual layer, one row per incident) ──────────────────────────────

export const TUCSON_META: ProviderMeta = {
  id: 'tucson',
  city: 'Tucson',
  state: 'AZ',
  label: 'Tucson, Arizona',
  agency: 'Tucson Police Department',
  datasetName: 'TPD Reported Crimes 2026',
  endpoint: 'https://services3.arcgis.com/9coHY2fvuFjG9HQX/arcgis/rest/services/TPDOpenData_ReportedCrimes_2026/FeatureServer/0',
  sourceUrl: 'https://policeanalysis.tucsonaz.gov/',
  timeZone: 'America/Phoenix',
  center: [-110.9747, 32.2226],
  zoom: 10.8,
  bounds: { west: -111.065, south: 31.985, east: -110.7, north: 32.33 },
  cadence: 'Updated daily',
  delayNote: 'Reports are added as they are approved; the newest eleven days are still filling in. Occurrence times are rounded down to the hour.',
  settlingDays: 11,
  datasetStart: '2026-01-01',
  precision: 'approximate',
  precisionNote: 'TPD skews public points for privacy and reports addresses at the block level.',
  coverageNote: 'Crimes that occurred in 2026, one row per incident (its most serious offense); the annual layer must be reviewed when 2027 begins. Some records are not mapped.',
  lastVerified: VERIFIED,
};

const tucson = cityProvider({
  meta: TUCSON_META,
  epochSemantics: 'local-clock',
  idFields: ['IncidentNumber'],
  dateFields: ['OccurredDateTime'],
  categoryFields: ['UCRSummaryDescription'],
  descriptionFields: ['StatuteDescription'],
  locationFields: ['Address100Block'],
  locationFallback: 'Published block',
  longitudeFields: ['PublicLongitude'],
  latitudeFields: ['PublicLatitude'],
}, {
  layerName: 'TPDReportedCrimes2026',
  dateField: 'OccurredDateTime',
  objectIdField: 'OBJECTID',
  pageSize: 1000,
  // The layer has one row per person and offense; MaxGRC marks one row per incident.
  filter: "MaxGRC = '1'",
});

export const mapTucsonFeature = tucson.mapFeature;
export const tucsonProvider = tucson.provider;

// ── Registry exports ─────────────────────────────────────────────────────────

/** Bay Area first, then roughly north to south. */
export const WEST_PROVIDERS: readonly IncidentProvider[] = [
  berkeleyProvider,
  sanMateoProvider,
  tacomaProvider,
  saltLakeCityProvider,
  boulderProvider,
  auroraCoProvider,
  coloradoSpringsProvider,
  sacramentoProvider,
  lasVegasProvider,
  bakersfieldProvider,
  riversideProvider,
  tempeProvider,
  mesaProvider,
  tucsonProvider,
];

/** One travel spot inside each provider's jurisdiction, in `WEST_PROVIDERS` order. */
export const WEST_FEATURED_PLACES: readonly SelectedPlace[] = [
  { label: 'Downtown Berkeley', detail: 'Berkeley, California', coordinates: [-122.2681, 37.8701] },
  { label: 'Downtown San Mateo', detail: 'San Mateo, California', coordinates: [-122.3237, 37.5649] },
  { label: 'Museum of Glass', detail: 'Tacoma, Washington', coordinates: [-122.4339, 47.2457] },
  { label: 'Temple Square', detail: 'Salt Lake City, Utah', coordinates: [-111.8929, 40.7704] },
  { label: 'Pearl Street Mall', detail: 'Boulder, Colorado', coordinates: [-105.2797, 40.0182] },
  { label: 'Aurora Town Center', detail: 'Aurora, Colorado', coordinates: [-104.8213, 39.7088] },
  { label: 'Garden of the Gods', detail: 'Colorado Springs, Colorado', coordinates: [-104.8786, 38.8784] },
  { label: 'Old Sacramento', detail: 'Sacramento, California', coordinates: [-121.5048, 38.5843] },
  { label: 'Las Vegas Strip', detail: 'Las Vegas, Nevada', coordinates: [-115.1745, 36.1126] },
  { label: 'Downtown Bakersfield', detail: 'Bakersfield, California', coordinates: [-119.0187, 35.3733] },
  { label: 'Mission Inn', detail: 'Riverside, California', coordinates: [-117.3753, 33.9832] },
  { label: 'Mill Avenue', detail: 'Tempe, Arizona', coordinates: [-111.9399, 33.4237] },
  { label: 'Mesa Arts Center', detail: 'Mesa, Arizona', coordinates: [-111.8226, 33.4155] },
  { label: 'Fourth Avenue', detail: 'Tucson, Arizona', coordinates: [-110.9665, 32.229] },
];

/**
 * Provider id → Census place GEOID(s) of the police jurisdiction; `cdp:` marks a census
 * designated place. LVMPD also patrols unincorporated Clark County around the city.
 */
export const WEST_JURISDICTIONS: Readonly<Record<string, string | readonly string[]>> = {
  berkeley: '0606000',
  'san-mateo': '0668252',
  tacoma: '5370000',
  'salt-lake-city': '4967000',
  boulder: '0807850',
  'aurora-co': '0804000',
  'colorado-springs': '0816000',
  sacramento: '0664000',
  'las-vegas': [
    '3240000',
    'cdp:3254600', // Paradise (the Strip)
    'cdp:3284600', // Winchester
    'cdp:3268585', // Spring Valley
    'cdp:3223770', // Enterprise
    'cdp:3271400', // Sunrise Manor
    'cdp:3283800', // Whitney
    'cdp:3270900', // Summerlin South
  ],
  bakersfield: '0603526',
  riverside: '0662000',
  tempe: '0473000',
  mesa: '0446000',
  tucson: '0477000',
};
