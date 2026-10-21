import { categoryGroup, isViolentCategory, normalizeCategory, severityForCategory } from '../../domain/categories';
import { combineDateAndTime, hourFromTimestamp, sourceTimestampToEpoch } from '../../domain/time';
import type { Incident, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { attribute } from './arcgis';
import { cityProvider, firstText, type CityFeatureConfig } from './arcgisCities';
import { roundCoordinates } from './incident';
import { numberValue } from './shared';
import { createSocrataProvider, resolvedText } from './socrata';
import {
  COORDINATE_KEYS,
  fields,
  generalizedDallasAddress,
  incidentFromRow,
  localClock,
  type FieldKey,
  type Fields,
  type Row,
} from './socrataCities';

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Reviewed wording the shared category vocabulary does not recognize. A hint only adds a
 * category word, so the vocabulary's own priority (homicide before sexual before robbery…)
 * still decides between competing matches.
 */
const CLASSIFICATION_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  // Columbus "Molesting", Minneapolis "CSC" (criminal sexual conduct).
  [/\b(?:molest\w*|csc)\b/i, 'sexual'],
  // Minneapolis abbreviations (ASLT, ASSLT, ASLT4), strangulation (Cincinnati, Cleveland), Aurora's grouping.
  [/\b(?:as+lt\d?|strangulation|person crimes)\b/i, 'assault'],
  // Buffalo's parent type.
  [/\bbreaking\s*&\s*entering\b/i, 'burglary'],
  // Minneapolis "AUTOMOBILE THEFT", Buffalo "Theft of Vehicle" (but not vehicle parts).
  [/\b(?:automobile theft|theft of vehicle(?! parts))\b/i, 'vehicle theft'],
  // Aurora's grouping.
  [/\bproperty crimes\b/i, 'theft'],
];

/** Classification text with reviewed category hints appended. */
export function hintedClassification(text: string): string {
  const hints = CLASSIFICATION_HINTS.filter(([pattern]) => pattern.test(text)).map(([, hint]) => hint);
  return [text, ...hints].join(' ');
}

/** A whole-hour attribute (0–23) as `HH:00:00`, or `null`. */
export function hourClock(value: unknown): string | null {
  const hour = numberValue(value);
  if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:00:00`;
}

const socrataClassification = (_row: Row, _fields: Fields, rawCategory: string, description: string) => (
  hintedClassification(`${rawCategory} ${description}`)
);

/** Identity that joins every listed attribute (`case:object`), skipping empty parts. */
function identity(...names: string[]): Pick<CityFeatureConfig, 'idFields' | 'sourceId'> {
  return {
    idFields: names,
    sourceId: (row) => names.map((name) => firstText(row, [name])).filter(Boolean).join(':'),
  };
}

/** Replaces the time of a midnight timestamp; an unknown time keeps midnight but no hour. */
function withClock(timestamp: string, clock: string | null) {
  const occurredAt = combineDateAndTime(timestamp, clock ?? undefined);
  return {
    occurredAt,
    occurredAtEpochMs: sourceTimestampToEpoch(occurredAt),
    localHour: clock === null ? null : hourFromTimestamp(occurredAt),
  };
}

export interface Refinement {
  /**
   * Local `HH:MM:SS` from a separate attribute, or `null` when unknown; the mapped date
   * attribute then supplies only the day.
   */
  clock?(row: Row): string | null;
  /** Base text for category normalization; defaults to category plus description. Hints are always added. */
  classificationText?(incident: Incident, row: Row): string;
  /** The location is an exact address: show its hundred block. */
  generalizeAddress?: boolean;
}

/**
 * The `refine` step these layers share: a separate time of day, reviewed classification
 * hints and hundred-block generalization of exact addresses.
 */
export function refined({ clock, classificationText, generalizeAddress = false }: Refinement = {}) {
  return (incident: Incident, row: Row): Incident => {
    const category = normalizeCategory(hintedClassification(
      classificationText?.(incident, row) ?? `${incident.rawCategory} ${incident.description}`,
    ));
    return {
      ...incident,
      ...(clock ? withClock(incident.occurredAt, clock(row)) : {}),
      category,
      group: categoryGroup(category),
      severity: severityForCategory(category),
      isViolent: isViolentCategory(category),
      locationLabel: generalizeAddress ? generalizedDallasAddress(incident.locationLabel) : incident.locationLabel,
    };
  };
}

/** Classifies by the published category alone, ignoring free-text descriptions. */
const byCategory = (incident: Incident) => incident.rawCategory;

const ROUNDED_GRID = 'points are rounded to an approximately one-hundred-meter grid';

// ── Boston ───────────────────────────────────────────────────────────────────

export const BOSTON_META: ProviderMeta = {
  id: 'boston',
  city: 'Boston',
  state: 'MA',
  label: 'Boston, Massachusetts',
  agency: 'Boston Police Department',
  datasetName: 'Boston Crime Incidents v2.2 - All Data View',
  endpoint: 'https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Boston_Incidents_Public_v2_view/FeatureServer/0',
  sourceUrl: 'https://boston-pd-crime-hub-boston.hub.arcgis.com/',
  timeZone: 'America/New_York',
  center: [-71.0589, 42.3601],
  zoom: 11.3,
  bounds: { west: -71.2, south: 42.22, east: -70.74, north: 42.41 },
  cadence: 'Updated daily',
  delayNote: 'The public view withholds the newest 24 hours of reports; classifications can change after review.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: `No street address is published, only neighborhood and district; points lie near the reported address, so ${ROUNDED_GRID}.`,
  coverageNote: 'Part One and Part Two offense rows, one per offense in an incident; Part Three service incidents such as verbal disputes and found property are excluded.',
  lastVerified: '2026-10-21',
};

const boston = cityProvider({
  meta: BOSTON_META,
  epochSemantics: 'utc',
  ...identity('INC_NUM', 'OFF_SEQ_NUM'),
  dateFields: ['FROM_DATE'],
  categoryFields: ['CRIME', 'NIBRS_DESC'],
  descriptionFields: ['OFFENSE_DESC', 'NIBRS_DESC'],
  locationFields: ['NEIGHBORHOOD', 'DISTRICT'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  // CRIME_PART is read by the layer filter; requesting it lets the live contract verify it.
  refineFields: ['CRIME_PART'],
  refine: refined({
    // The NIBRS class, not the local offense text: "B&E MOTOR VEHICLE" is a theft from a vehicle, not a burglary.
    classificationText: (incident, row) => `${incident.rawCategory} ${firstText(row, ['NIBRS_DESC'])}`,
  }),
}, { layerName: 'Boston_Incidents_Public', dateField: 'FROM_DATE', objectIdField: 'OBJECTID', filter: "CRIME_PART <> 'Part Three'" });

export const mapBostonFeature = boston.mapFeature;
export const bostonProvider = boston.provider;

// ── Hartford ─────────────────────────────────────────────────────────────────

export const HARTFORD_META: ProviderMeta = {
  id: 'hartford',
  city: 'Hartford',
  state: 'CT',
  label: 'Hartford, Connecticut',
  agency: 'Hartford Police Department',
  datasetName: 'Police Incidents Current Year to 10 Days before the Current Date',
  endpoint: 'https://utility.arcgis.com/usrsvcs/servers/4bc28c820ebd45df8a62feae6dc8822d/rest/services/OpenData_PublicSafety/FeatureServer/21',
  sourceUrl: 'https://data.hartford.gov/datasets/4bc28c820ebd45df8a62feae6dc8822d_21',
  timeZone: 'America/New_York',
  center: [-72.6851, 41.7637],
  zoom: 12.2,
  bounds: { west: -72.72, south: 41.72, east: -72.64, north: 41.81 },
  cadence: 'Updated nightly',
  delayNote: 'By design the layer ends 10 days before the current date.',
  settlingDays: 0,
  datasetStart: '2026-01-01',
  precision: 'approximate',
  precisionNote: `The feed publishes exact addresses; they are shown as their hundred block and ${ROUNDED_GRID}.`,
  coverageNote: 'NIBRS-reportable offense rows, one per offense in a case; sexual assaults are excluded by statute. The current-year layer also still holds 2025, so its rollover must be reviewed.',
  lastVerified: '2026-10-21',
};

const hartford = cityProvider({
  meta: HARTFORD_META,
  // `Date` is the local calendar day stored as UTC midnight; `Time` is local `HHMM` text.
  epochSemantics: 'local-clock',
  ...identity('CaseNum', 'OBJECTID'),
  dateFields: ['Date'],
  categoryFields: ['NibrsDesc'],
  descriptionFields: ['OffenseDesc'],
  locationFields: ['Address'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refineFields: ['Time'],
  refine: refined({
    clock: (row) => localClock(attribute(row, 'Time')),
    // The offense text leads with a statute number; the NIBRS class is the comparable label.
    classificationText: byCategory,
    generalizeAddress: true,
  }),
}, {
  layerName: 'Police Incidents Current Year to 10 Days before the Current Date',
  dateField: 'Date',
  objectIdField: 'OBJECTID',
  filter: "NibrsDesc <> 'NOT NIBRS REPORTABLE'",
});

export const mapHartfordFeature = hartford.mapFeature;
export const hartfordProvider = hartford.provider;

// ── Rochester ────────────────────────────────────────────────────────────────

export const ROCHESTER_META: ProviderMeta = {
  id: 'rochester',
  city: 'Rochester',
  state: 'NY',
  label: 'Rochester, New York',
  agency: 'Rochester Police Department',
  datasetName: 'RPD Part I Crime - 2011 to Present',
  endpoint: 'https://maps.cityofrochester.gov/arcgis/rest/services/RPD/RPD_Part_I_Crime/FeatureServer/3',
  sourceUrl: 'https://data.cityofrochester.gov/datasets/74c62e65e3b347e289a07d02d4b8c899_3',
  timeZone: 'America/New_York',
  center: [-77.6109, 43.1566],
  zoom: 11.6,
  bounds: { west: -77.71, south: 43.1, east: -77.53, north: 43.27 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary reports keep arriving for about a week after the occurrence date.',
  settlingDays: 8,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: `The feed publishes exact addresses; they are shown as their hundred block and ${ROUNDED_GRID}.`,
  coverageNote: 'UCR Part I offenses only (homicide, robbery, aggravated assault, burglary, larceny, motor vehicle theft); rape is excluded for privacy.',
  lastVerified: '2026-10-21',
};

const rochester = cityProvider({
  meta: ROCHESTER_META,
  epochSemantics: 'utc',
  ...identity('Case_Number', 'OBJECTID'),
  dateFields: ['OccurredFrom_Timestamp'],
  categoryFields: ['Statute_Text'],
  descriptionFields: ['Statute_Description'],
  locationFields: ['Address_StreetFull'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  // The UCR Part I label; statute wording such as "GRAND LARCENY 4TH: FIREARM" would otherwise compete.
  refine: refined({ classificationText: byCategory, generalizeAddress: true }),
}, { layerName: 'RPD Part I Crime - 2011 to Present', dateField: 'OccurredFrom_Timestamp', objectIdField: 'OBJECTID' });

export const mapRochesterFeature = rochester.mapFeature;
export const rochesterProvider = rochester.provider;

// ── Buffalo (Socrata Point column, exact addresses) ──────────────────────────

export const BUFFALO_META: ProviderMeta = {
  id: 'buffalo',
  city: 'Buffalo',
  state: 'NY',
  label: 'Buffalo, New York',
  agency: 'Buffalo Police Department',
  datasetName: 'Crime Incidents',
  endpoint: 'https://data.buffalony.gov/resource/d6g9-xbgu.json',
  sourceUrl: 'https://data.buffalony.gov/d/d6g9-xbgu',
  timeZone: 'America/New_York',
  center: [-78.8784, 42.8864],
  zoom: 11.6,
  bounds: { west: -78.96, south: 42.82, east: -78.79, north: 42.97 },
  cadence: 'Updated daily',
  delayNote: 'Very preliminary reports; the newest days keep filling in as reports are entered.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Coordinates are published rounded to three decimals (about one hundred meters); addresses are shown as their hundred block.',
  coverageNote: 'Preliminary reports of theft, vehicle theft, assault, burglary, robbery, sexual offenses and homicide; classifications can change after investigation.',
  lastVerified: '2026-10-21',
};

const BUFFALO_FIELDS = fields({
  id: 'case_number',
  date: 'incident_datetime',
  category: 'parent_incident_type',
  description: 'incident_type_primary',
  location: 'address_1',
  area: 'neighborhood',
  point: 'location',
});

export function mapBuffaloRow(row: Row): Incident | null {
  const incident = incidentFromRow(BUFFALO_META, row, BUFFALO_FIELDS, {
    locationFallback: 'Approximate public location',
    classificationText: socrataClassification,
  });
  if (!incident) return null;
  return {
    ...incident,
    coordinates: roundCoordinates(incident.coordinates, 3),
    locationLabel: generalizedDallasAddress(incident.locationLabel),
  };
}

export const buffaloProvider = createSocrataProvider<FieldKey>({
  meta: BUFFALO_META,
  schema: { fields: BUFFALO_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapBuffaloRow,
});

// ── Cleveland ────────────────────────────────────────────────────────────────

export const CLEVELAND_META: ProviderMeta = {
  id: 'cleveland',
  city: 'Cleveland',
  state: 'OH',
  label: 'Cleveland, Ohio',
  agency: 'Cleveland Division of Police',
  datasetName: 'Crime Incidents',
  endpoint: 'https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Crime_Incidents_P1RMS/FeatureServer/0',
  sourceUrl: 'https://data.clevelandohio.gov/datasets/e15e8989c83e4cbd841fb171a6c62f68_0',
  timeZone: 'America/New_York',
  center: [-81.6944, 41.4993],
  zoom: 11,
  bounds: { west: -81.88, south: 41.39, east: -81.53, north: 41.61 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary records that are revised as statistics change; the newest day is partial.',
  settlingDays: 1,
  datasetStart: '2025-11-11',
  precision: 'approximate',
  precisionNote: `Addresses are published as a hundred block (for example 37XX Pearl Rd); ${ROUNDED_GRID}.`,
  coverageNote: 'NIBRS incidents since the November 11, 2025 records-system change, listing only the highest offense; about a fifth of rows carry no offense description and appear as Unclassified.',
  lastVerified: '2026-10-21',
};

const cleveland = cityProvider({
  meta: CLEVELAND_META,
  epochSemantics: 'utc',
  ...identity('CaseNumber', 'OBJECTID'),
  dateFields: ['OffenseDate'],
  categoryFields: ['IncidentDesc', 'StatDesc'],
  descriptionFields: ['StatDesc', 'IncidentDesc'],
  locationFields: ['Address_Public', 'NEIGHBORHOOD'],
  locationFallback: 'Approximate public location',
  longitudeFields: ['LON'],
  latitudeFields: ['LAT'],
  coordinateDigits: 3,
  refine: refined(),
}, { layerName: 'Crime_Incidents', dateField: 'OffenseDate', objectIdField: 'OBJECTID' });

export const mapClevelandFeature = cleveland.mapFeature;
export const clevelandProvider = cleveland.provider;

// ── Columbus ─────────────────────────────────────────────────────────────────

/** Reviewed non-criminal report subjects (service, missing persons, crashes, outside warrants). */
export const COLUMBUS_NON_CRIME_SUBJECTS = [
  'Accident Report',
  'Accidental Overdose',
  'Accidental Shooting',
  'Aid and Transport',
  'DOA',
  'Domestic Dispute',
  'Drowning',
  'Foreign Report',
  'Impounded Suspected Stolen Vehicle',
  'Lost License Plate',
  'Lost Motor Vehicle',
  'Lost Property',
  'Miscellaneous Incident',
  'Missing Person',
  'Recovered Firearm',
  'Shot Spotter',
  'Suicide',
  'Traffic Arrest',
  'Wanted Person Other Agency',
] as const;

export const COLUMBUS_META: ProviderMeta = {
  id: 'columbus',
  city: 'Columbus',
  state: 'OH',
  label: 'Columbus, Ohio',
  agency: 'Columbus Division of Police',
  datasetName: 'Police Incident Reports',
  endpoint: 'https://services1.arcgis.com/9yy6msODkIBzkUXU/arcgis/rest/services/Police_Incident_Reports/FeatureServer/0',
  sourceUrl: 'https://opendata.columbus.gov/datasets/b70656e5b22d4a7db8af9b4289bf8c27_0',
  timeZone: 'America/New_York',
  center: [-82.9988, 39.9612],
  zoom: 10.6,
  bounds: { west: -83.22, south: 39.8, east: -82.76, north: 40.16 },
  cadence: 'Updated nightly',
  delayNote: 'New reports appear three days after they are created.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: `Locations are published as a hundred block or intersection and ${ROUNDED_GRID}; some reports are unmapped for victim privacy.`,
  coverageNote: 'Incident reports over the past three years; reviewed non-criminal subjects (aid and transport, missing persons, lost property, crash reports, outside-agency warrants and similar) are excluded.',
  lastVerified: '2026-10-21',
};

const columbus = cityProvider({
  meta: COLUMBUS_META,
  // The layer's weekday attribute matches the epoch's UTC calendar day: local wall-clock time.
  epochSemantics: 'local-clock',
  ...identity('IncidentNo', 'OBJECTID'),
  dateFields: ['OccurredOn'],
  categoryFields: ['GeneralSubject'],
  descriptionFields: ['ColumbusSubject'],
  locationFields: ['IncidentLocation', 'ColumbusCommunity'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refine: refined(),
}, {
  layerName: 'PoliceIncidentReports',
  dateField: 'OccurredOn',
  objectIdField: 'OBJECTID',
  filter: `GeneralSubject IS NULL OR GeneralSubject NOT IN (${COLUMBUS_NON_CRIME_SUBJECTS.map((subject) => `'${subject}'`).join(', ')})`,
});

export const mapColumbusFeature = columbus.mapFeature;
export const columbusProvider = columbus.provider;

// ── Cincinnati (Socrata, offset points) ──────────────────────────────────────

export const CINCINNATI_META: ProviderMeta = {
  id: 'cincinnati',
  city: 'Cincinnati',
  state: 'OH',
  label: 'Cincinnati, Ohio',
  agency: 'Cincinnati Police Department',
  datasetName: 'Cincinnati Police Department Reported Crime Dataset',
  endpoint: 'https://data.cincinnati-oh.gov/resource/t9kw-3jfx.json',
  sourceUrl: 'https://data.cincinnati-oh.gov/d/t9kw-3jfx',
  timeZone: 'America/New_York',
  center: [-84.512, 39.1031],
  zoom: 11.2,
  bounds: { west: -84.72, south: 39.05, east: -84.36, north: 39.23 },
  cadence: 'Updated weekly (Mondays)',
  delayNote: 'Each weekly extract ends about a week before release, so the newest record is often more than a week old.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: `Addresses are generalized (for example 8XX WELLS ST) and points are offset by the publisher; ${ROUNDED_GRID}.`,
  coverageNote: 'Reported crimes grouped as violent, property or Part 2; one report can list several categories, and a homicide report has one row per victim.',
  lastVerified: '2026-10-21',
};

const CINCINNATI_FIELDS = fields({
  id: 'reportnumber',
  secondaryId: 'starscategory',
  date: 'eventdate',
  category: 'starscategorytype',
  description: 'starscategory',
  location: 'addressx',
  area: 'snaneighborhood',
  latitude: 'lat_x',
  longitude: 'lon_x',
});

export function mapCincinnatiRow(row: Row): Incident | null {
  const incident = incidentFromRow(CINCINNATI_META, row, CINCINNATI_FIELDS, {
    locationFallback: 'Approximate public location',
    classificationText: socrataClassification,
  });
  if (!incident) return null;
  return {
    ...incident,
    // Victim rows of one homicide share report and category; only their offset points differ.
    id: `${incident.id}:${incident.coordinates.join(',')}`,
    coordinates: roundCoordinates(incident.coordinates, 3),
  };
}

export const cincinnatiProvider = createSocrataProvider<FieldKey>({
  meta: CINCINNATI_META,
  schema: { fields: CINCINNATI_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapCincinnatiRow,
});

// ── Indianapolis ─────────────────────────────────────────────────────────────

/**
 * IMPD rows only. `N…` codes are NIBRS offenses and `AN…` non-reportable offenses such as
 * minor vandalism; `A…` codes are administrative (lost property, missing persons, deaths).
 */
export const INDIANAPOLIS_FILTER = "Agency = 'IMPD' AND CAIU_ClassType NOT IN ('Traffic', 'Unfounded') "
  + "AND (NIBRSClassCode LIKE 'N%' OR NIBRSClassCode LIKE 'AN%')";

export const INDIANAPOLIS_META: ProviderMeta = {
  id: 'indianapolis',
  city: 'Indianapolis',
  state: 'IN',
  label: 'Indianapolis, Indiana',
  agency: 'Indianapolis Metropolitan Police Department',
  datasetName: 'IMPD Public Data: Incidents',
  endpoint: 'https://gis.indy.gov/server/rest/services/IMPD/IMPD_Public_Data/FeatureServer/1',
  sourceUrl: 'https://data.indy.gov/datasets/0390f89c33c04556b7eb353dd31486e3_1',
  timeZone: 'America/Indiana/Indianapolis',
  center: [-86.1581, 39.7684],
  zoom: 10.6,
  bounds: { west: -86.33, south: 39.63, east: -85.93, north: 39.93 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary records; the newest day is partial.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block and its geocoded point.',
  coverageNote: 'IMPD offense rows, one per offense in a case; other Marion County agencies, traffic, unfounded and administrative reports are excluded. Beech Grove, Lawrence, Southport and Speedway have their own police.',
  lastVerified: '2026-10-21',
};

const indianapolis = cityProvider({
  meta: INDIANAPOLIS_META,
  // The layer's own sOccTime text equals the epoch's UTC clock time: local wall-clock time.
  epochSemantics: 'local-clock',
  ...identity('CaseNum', 'OBJECTID'),
  dateFields: ['OccurredFrom'],
  categoryFields: ['NIBRSClassDesc'],
  descriptionFields: ['CR_Desc'],
  locationFields: ['sAddress'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['Longitude'],
  latitudeFields: ['Latitude'],
  // Read by the layer filter; requesting them lets the live contract verify them.
  refineFields: ['Agency', 'CAIU_ClassType', 'NIBRSClassCode'],
  refine: refined({ classificationText: byCategory }),
}, { layerName: 'Incidents_Public', dateField: 'OccurredFrom', objectIdField: 'OBJECTID', filter: INDIANAPOLIS_FILTER });

export const mapIndianapolisFeature = indianapolis.mapFeature;
export const indianapolisProvider = indianapolis.provider;

// ── Aurora, Illinois ─────────────────────────────────────────────────────────

/** The groupings that are offenses; traffic, caretaking, assists and death investigations are not. */
export const AURORA_IL_OFFENSE_GROUPINGS = [
  'PERSON CRIMES',
  'SEX OFFENSES',
  'DOMESTIC RELATED/VIOLENCE',
  'PROPERTY CRIMES',
  'WEAPONS VIOLATION',
  'DRUG OFFENSES',
  'LIQUOR LAW VIOLATIONS',
  'OTHER OFFENSES',
] as const;

export const AURORA_IL_META: ProviderMeta = {
  id: 'aurora-il',
  city: 'Aurora',
  state: 'IL',
  label: 'Aurora, Illinois',
  agency: 'Aurora Police Department (Illinois)',
  datasetName: 'Aurora IL Police Incidents',
  endpoint: 'https://services1.arcgis.com/79UxTxnBeBW8JHY4/arcgis/rest/services/AuroraIL.Police_Incidents/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=9c951be1649c48bba529da7d153ffcf6',
  timeZone: 'America/Chicago',
  center: [-88.3201, 41.7606],
  zoom: 11.4,
  bounds: { west: -88.41, south: 41.67, east: -88.2, north: 41.83 },
  cadence: 'Updated daily',
  delayNote: 'Incidents are dated by when they were reported, not when they occurred.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: `Locations are published as a hundred block or intersection; ${ROUNDED_GRID}.`,
  coverageNote: 'Only broad groupings are published: person crimes count as assault, property crimes as theft, and domestic-related incidents as other. Traffic, caretaking, assists and death investigations are excluded.',
  lastVerified: '2026-10-21',
};

const auroraIl = cityProvider({
  meta: AURORA_IL_META,
  epochSemantics: 'utc',
  ...identity('INCIDENT_NUM', 'OBJECTID'),
  dateFields: ['REPORTED_ON'],
  categoryFields: ['GROUPING'],
  descriptionFields: ['GROUPING'],
  locationFields: ['STREETADDR'],
  locationFallback: 'Approximate public location',
  longitudeFields: [],
  latitudeFields: [],
  coordinateDigits: 3,
  refine: refined({ classificationText: byCategory }),
}, {
  layerName: 'AuroraIL.Police_Incidents',
  dateField: 'REPORTED_ON',
  objectIdField: 'OBJECTID',
  filter: `GROUPING IN (${AURORA_IL_OFFENSE_GROUPINGS.map((grouping) => `'${grouping}'`).join(', ')})`,
});

export const mapAuroraIlFeature = auroraIl.mapFeature;
export const auroraIlProvider = auroraIl.provider;

// ── Minneapolis ──────────────────────────────────────────────────────────────

export const MINNEAPOLIS_META: ProviderMeta = {
  id: 'minneapolis',
  city: 'Minneapolis',
  state: 'MN',
  label: 'Minneapolis, Minnesota',
  agency: 'Minneapolis Police Department',
  datasetName: 'Police Incidents 2026',
  endpoint: 'https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Police_Incidents_2026/FeatureServer/0',
  sourceUrl: 'https://opendata.minneapolismn.gov/datasets/1e98b5322dd64605ae9947762292a76f_0',
  timeZone: 'America/Chicago',
  center: [-93.265, 44.9778],
  zoom: 11.4,
  bounds: { west: -93.34, south: 44.88, east: -93.19, north: 45.06 },
  cadence: 'Refreshed daily by 9:30 AM',
  delayNote: 'Reports enter the records system over about a week, so recent occurrence dates keep filling in.',
  settlingDays: 7,
  datasetStart: '2026-01-01',
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block (for example 0011XX 39TH ST E) and the block\'s center point.',
  coverageNote: 'Part I offenses (homicide, rape, robbery, aggravated and domestic assault, burglary, theft, vehicle theft, arson) in the 2026 annual layer, dated by when they began.',
  lastVerified: '2026-10-21',
};

const minneapolis = cityProvider({
  meta: MINNEAPOLIS_META,
  // `beginDate` is the local day stored as UTC midnight; `beginTime` is local HHMM.
  epochSemantics: 'local-clock',
  ...identity('caseNumber', 'OBJECTID'),
  dateFields: ['beginDate'],
  categoryFields: ['description'],
  descriptionFields: ['description'],
  locationFields: ['publicaddress', 'neighborhood'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['centerLong'],
  latitudeFields: ['centerLat'],
  refineFields: ['beginTime'],
  refine: refined({ clock: (row) => localClock(attribute(row, 'beginTime')) }),
}, { layerName: 'Police_Incidents_2026', dateField: 'beginDate', objectIdField: 'OBJECTID' });

export const mapMinneapolisFeature = minneapolis.mapFeature;
export const minneapolisProvider = minneapolis.provider;

// ── Des Moines ───────────────────────────────────────────────────────────────

export const DES_MOINES_META: ProviderMeta = {
  id: 'des-moines',
  city: 'Des Moines',
  state: 'IA',
  label: 'Des Moines, Iowa',
  agency: 'Des Moines Police Department',
  datasetName: 'Public Safety Data Portal Crime View',
  endpoint: 'https://services.arcgis.com/HT7H9QGiZQoRJDpJ/arcgis/rest/services/PSDP_Crime_Layer_View/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=2198806b8e754079ad3d7970678c9900',
  timeZone: 'America/Chicago',
  center: [-93.625, 41.5868],
  zoom: 11.2,
  bounds: { west: -93.71, south: 41.48, east: -93.49, north: 41.66 },
  cadence: 'Updated daily',
  delayNote: 'Records are released with a deliberate 28-day delay.',
  settlingDays: 0,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Addresses are published as a hundred block and points are anonymized near it.',
  coverageNote: 'Dated by report day and hour, not occurrence; non-NIBRS "all other" reports are excluded.',
  lastVerified: '2026-10-21',
};

const desMoines = cityProvider({
  meta: DES_MOINES_META,
  // `reported_date` is the true UTC instant of local midnight (05:00Z in summer, 06:00Z in winter).
  epochSemantics: 'utc',
  ...identity('case_number', 'OBJECTID'),
  dateFields: ['reported_date'],
  categoryFields: ['offense_category'],
  descriptionFields: ['nibrs_offense'],
  locationFields: ['case_address_anonymized', 'police_district'],
  locationFallback: 'Approximate public location',
  longitudeFields: ['case_longitude_anonymized'],
  latitudeFields: ['case_latitude_anonymized'],
  // crime_code is read by the layer filter; requesting it lets the live contract verify it.
  refineFields: ['reported_hour_of_day', 'crime_code'],
  refine: refined({ clock: (row) => hourClock(attribute(row, 'reported_hour_of_day')) }),
}, { layerName: 'pd_crime_layer', dateField: 'reported_date', objectIdField: 'OBJECTID', filter: "crime_code <> '999'" });

export const mapDesMoinesFeature = desMoines.mapFeature;
export const desMoinesProvider = desMoines.provider;

// ── Kansas City, Missouri (Socrata, one row per involved person) ─────────────

export const KANSAS_CITY_META: ProviderMeta = {
  id: 'kansas-city',
  city: 'Kansas City',
  state: 'MO',
  label: 'Kansas City, Missouri',
  agency: 'Kansas City Missouri Police Department',
  datasetName: 'KCPD Crime Data 2026',
  endpoint: 'https://data.kcmo.org/resource/f7wj-ckmw.json',
  sourceUrl: 'https://data.kcmo.org/d/f7wj-ckmw',
  timeZone: 'America/Chicago',
  center: [-94.5786, 39.0997],
  zoom: 10.4,
  bounds: { west: -94.77, south: 38.82, east: -94.38, north: 39.36 },
  cadence: 'Updated weekly',
  delayNote: 'Weekly uploads; the newest days are partial and records are refined after upload.',
  settlingDays: 2,
  datasetStart: '2026-01-01',
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block or intersection and its geocoded point.',
  coverageNote: 'KCPD 2026 offense rows, repeated per involved person and collapsed here to one row per report and offense; administrative reports without a NIBRS code (warrant arrests, investigations, crashes) are excluded.',
  lastVerified: '2026-10-21',
};

// Demographic columns (involvement, race, sex, age) are deliberately never requested.
const KANSAS_CITY_FIELDS = fields({
  id: 'report',
  secondaryId: 'offense',
  date: 'from_date',
  time: 'from_time',
  category: 'description',
  description: 'offense',
  detail: 'ibrs',
  location: 'address',
  point: 'location',
});

/** Rows without a NIBRS description are categorized by the KCPD offense instead. */
const KANSAS_CITY_OFFENSE_FIELDS = fields({ ...KANSAS_CITY_FIELDS, category: 'offense' });

export function mapKansasCityRow(row: Row): Incident | null {
  const fieldMap = resolvedText(row, KANSAS_CITY_FIELDS, 'category') ? KANSAS_CITY_FIELDS : KANSAS_CITY_OFFENSE_FIELDS;
  return incidentFromRow(KANSAS_CITY_META, row, fieldMap, {
    combineTime: true,
    locationFallback: 'Published hundred block',
    locationKeys: ['location'],
    classificationText: socrataClassification,
  });
}

export const kansasCityProvider = createSocrataProvider<FieldKey>({
  meta: KANSAS_CITY_META,
  schema: { fields: KANSAS_CITY_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapKansasCityRow,
  filter: "ibrs IS NULL OR ibrs != '999'",
});

// ── Omaha ────────────────────────────────────────────────────────────────────

export const OMAHA_META: ProviderMeta = {
  id: 'omaha',
  city: 'Omaha',
  state: 'NE',
  label: 'Omaha, Nebraska',
  agency: 'Omaha Police Department',
  datasetName: 'Omaha Police Incident Data',
  endpoint: 'https://services1.arcgis.com/tIBLyYZX96jUntYm/arcgis/rest/services/Omaha_Police_Incident_Data_(View)/FeatureServer/0',
  sourceUrl: 'https://www.arcgis.com/home/item.html?id=15ef780ba6d84414a34c5c89a6500572',
  timeZone: 'America/Chicago',
  center: [-95.9345, 41.2565],
  zoom: 10.8,
  bounds: { west: -96.27, south: 41.19, east: -95.87, north: 41.4 },
  cadence: 'Updated daily',
  delayNote: 'Preliminary records; the newest two days are partial.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published as a hundred block and its point.',
  coverageNote: 'NIBRS offense rows dated at the midpoint of the reported occurrence window; some offense groups (for example sex offenses, homicides, weapon and drug offenses) are not in the public view.',
  lastVerified: '2026-10-21',
};

const omaha = cityProvider({
  meta: OMAHA_META,
  epochSemantics: 'utc',
  ...identity('RB', 'PK'),
  dateFields: ['dteMidpoint'],
  categoryFields: ['NIBRSCategory'],
  descriptionFields: ['NIBRSCategory'],
  locationFields: ['AddressBlock', 'Neighborhood_Associations'],
  locationFallback: 'Published hundred block',
  longitudeFields: ['LonBlock'],
  latitudeFields: ['LatBlock'],
  refine: refined(),
}, { layerName: 'crime_analysis_incidents_public', dateField: 'dteMidpoint', objectIdField: 'OBJECTID' });

export const mapOmahaFeature = omaha.mapFeature;
export const omahaProvider = omaha.provider;

// ── Registry exports ─────────────────────────────────────────────────────────

/** Northeast and Midwest providers, ordered east to west. */
export const NORTHEAST_PROVIDERS: readonly IncidentProvider[] = [
  bostonProvider,
  hartfordProvider,
  rochesterProvider,
  buffaloProvider,
  clevelandProvider,
  columbusProvider,
  cincinnatiProvider,
  indianapolisProvider,
  auroraIlProvider,
  minneapolisProvider,
  desMoinesProvider,
  kansasCityProvider,
  omahaProvider,
];

/** One travel spot inside each provider's city limits, in provider order. */
export const NORTHEAST_FEATURED_PLACES: readonly SelectedPlace[] = [
  { label: 'Faneuil Hall', detail: 'Boston, Massachusetts', coordinates: [-71.0562, 42.3601] },
  { label: 'Bushnell Park', detail: 'Hartford, Connecticut', coordinates: [-72.6808, 41.7646] },
  { label: 'The Strong Museum', detail: 'Rochester, New York', coordinates: [-77.6016, 43.1528] },
  { label: 'Canalside', detail: 'Buffalo, New York', coordinates: [-78.8774, 42.8768] },
  { label: 'Rock & Roll Hall of Fame', detail: 'Cleveland, Ohio', coordinates: [-81.6954, 41.5085] },
  { label: 'Short North', detail: 'Columbus, Ohio', coordinates: [-83.0039, 39.9783] },
  { label: 'Fountain Square', detail: 'Cincinnati, Ohio', coordinates: [-84.5128, 39.1016] },
  { label: 'Monument Circle', detail: 'Indianapolis, Indiana', coordinates: [-86.1581, 39.7684] },
  { label: 'Paramount Theatre', detail: 'Aurora, Illinois', coordinates: [-88.315, 41.757] },
  { label: 'Nicollet Mall', detail: 'Minneapolis, Minnesota', coordinates: [-93.2733, 44.9772] },
  { label: 'Pappajohn Sculpture Park', detail: 'Des Moines, Iowa', coordinates: [-93.6286, 41.5852] },
  { label: 'Country Club Plaza', detail: 'Kansas City, Missouri', coordinates: [-94.5927, 39.042] },
  { label: 'Old Market', detail: 'Omaha, Nebraska', coordinates: [-95.93, 41.2555] },
];

/** Provider id → Census place GEOID of its police jurisdiction (for scripts/fetch-jurisdictions.mjs). */
export const NORTHEAST_JURISDICTIONS: Readonly<Record<string, string | readonly string[]>> = {
  boston: '2507000',
  hartford: '0937000',
  rochester: '3663000',
  buffalo: '3611000',
  cleveland: '3916000',
  columbus: '3918000',
  cincinnati: '3915000',
  // The consolidated city's balance, without the included towns that keep their own police.
  indianapolis: '1836003',
  'aurora-il': '1703012',
  minneapolis: '2743000',
  'des-moines': '1921000',
  'kansas-city': '2938000',
  omaha: '3137000',
};
