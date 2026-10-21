import { normalizeCategory } from '../../domain/categories';
import { combineDateAndTime } from '../../domain/time';
import type { Incident, ProviderMeta } from '../../types';
import { buildIncident, joinLabels, roundCoordinates } from './incident';
import {
  createSocrataProvider,
  resolvedCoordinates,
  resolvedText,
  resolvedValue,
  type ResolvedSocrataFields,
  type SocrataAliasMap,
} from './socrata';

export type Row = Record<string, unknown>;

export type FieldKey =
  | 'id'
  | 'secondaryId'
  | 'date'
  | 'time'
  | 'category'
  | 'subcategory'
  | 'description'
  | 'detail'
  | 'location'
  | 'premises'
  | 'area'
  | 'latitude'
  | 'longitude'
  | 'point';

export type Fields = ResolvedSocrataFields<FieldKey>;

const NO_FIELDS: Fields = {
  id: null,
  secondaryId: null,
  date: null,
  time: null,
  category: null,
  subcategory: null,
  description: null,
  detail: null,
  location: null,
  premises: null,
  area: null,
  latitude: null,
  longitude: null,
  point: null,
};

export function fields(overrides: Partial<Fields>): Fields {
  return { ...NO_FIELDS, ...overrides };
}

export function aliases(overrides: Partial<SocrataAliasMap<FieldKey>>): SocrataAliasMap<FieldKey> {
  const empty = Object.fromEntries(Object.keys(NO_FIELDS).map((key) => [key, []])) as unknown as SocrataAliasMap<FieldKey>;
  return { ...empty, ...overrides };
}

export const COORDINATE_KEYS = { latitudeKey: 'latitude', longitudeKey: 'longitude', pointKey: 'point' } as const;

/** Reads an `HHMM` number (LAPD) or `HH:MM` text time (Dallas) as `HH:MM:00`, or `null`. */
export function localClock(timeValue: unknown): string | null {
  const raw = typeof timeValue === 'number' && Number.isFinite(timeValue)
    ? String(Math.trunc(timeValue))
    : typeof timeValue === 'string' ? timeValue.trim() : '';
  const clock = /^\d{1,4}$/.test(raw)
    ? raw.padStart(4, '0')
    : /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw)?.slice(1, 3).map((part) => part.padStart(2, '0')).join('');
  if (!clock) return null;
  const hour = clock.slice(0, 2);
  const minute = clock.slice(2, 4);
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return `${hour}:${minute}:00`;
}

/** Joins a date with a separate time column; an unreadable time falls back to midnight. */
export function localTimestamp(dateValue: string, timeValue: unknown): string {
  return combineDateAndTime(dateValue, localClock(timeValue) ?? undefined);
}

export interface RowOptions {
  /** Combine the date column with a separate time column. */
  combineTime?: boolean;
  locationFallback: string;
  description?(row: Row, fields: Fields, rawCategory: string): string;
  classificationText?(row: Row, fields: Fields, rawCategory: string, description: string): string;
  locationKeys?: readonly FieldKey[];
}

export function incidentFromRow(meta: ProviderMeta, row: Row, fieldMap: Fields, options: RowOptions): Incident | null {
  const coordinates = resolvedCoordinates(row, fieldMap, COORDINATE_KEYS);
  const sourceDate = resolvedText(row, fieldMap, 'date');
  if (!coordinates || !sourceDate) return null;

  const primaryId = resolvedText(row, fieldMap, 'id');
  const secondaryId = resolvedText(row, fieldMap, 'secondaryId');
  const rawCategory = resolvedText(row, fieldMap, 'category', 'Unclassified');
  const sourceId = primaryId
    ? [primaryId, secondaryId].filter(Boolean).join(':')
    : [sourceDate, secondaryId, coordinates.join(','), rawCategory].filter(Boolean).join(':');
  const clock = options.combineTime ? localClock(resolvedValue(row, fieldMap, 'time')) : sourceDate.slice(11);
  const occurredAt = combineDateAndTime(sourceDate, clock ?? undefined);
  const description = options.description?.(row, fieldMap, rawCategory)
    ?? resolvedText(row, fieldMap, 'description', rawCategory);

  return buildIncident(meta, {
    sourceId,
    occurredAt,
    rawCategory,
    description,
    // A date-only record keeps a midnight timestamp for windowing, but its hour is unknown.
    timeKnown: clock !== null && /^\d{2}:\d{2}/.test(clock),
    classificationText: options.classificationText?.(row, fieldMap, rawCategory, description),
    locationLabel: joinLabels(
      (options.locationKeys ?? ['location', 'area']).map((key) => resolvedText(row, fieldMap, key)),
      options.locationFallback,
    ),
    coordinates,
  });
}

// ── New York City ────────────────────────────────────────────────────────────

export const NEW_YORK_META: ProviderMeta = {
  id: 'new-york',
  city: 'New York City',
  state: 'NY',
  label: 'New York City, New York',
  agency: 'New York City Police Department',
  datasetName: 'NYPD Complaint Data Current (YTD)',
  endpoint: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
  sourceUrl: 'https://data.cityofnewyork.us/d/5uac-w243',
  timeZone: 'America/New_York',
  center: [-73.9855, 40.758],
  zoom: 11.2,
  bounds: { west: -74.27, south: 40.48, east: -73.68, north: 40.93 },
  cadence: 'Published quarterly',
  delayNote: 'The current-year dataset generally reflects the latest completed quarter, not live dispatches.',
  settlingDays: 0,
  datasetStart: 'calendar-year',
  precision: 'block',
  precisionNote: 'Coordinates identify the midpoint of the block where the incident was reported.',
  coverageNote: 'Complaint records are preliminary and can be revised; one complaint may contain multiple offenses.',
  lastVerified: '2026-10-21',
};

const NEW_YORK_FIELDS = fields({
  id: 'cmplnt_num',
  date: 'cmplnt_fr_dt',
  time: 'cmplnt_fr_tm',
  category: 'ofns_desc',
  description: 'pd_desc',
  detail: 'law_cat_cd',
  location: 'loc_of_occur_desc',
  premises: 'prem_typ_desc',
  area: 'boro_nm',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapNewYorkRow(row: Row): Incident | null {
  return incidentFromRow(NEW_YORK_META, row, NEW_YORK_FIELDS, {
    combineTime: true,
    locationFallback: 'Block midpoint',
    locationKeys: ['location', 'premises', 'area'],
    description: (source, map, rawCategory) => joinLabels(
      [resolvedText(source, map, 'description'), resolvedText(source, map, 'detail')],
      rawCategory,
    ),
    classificationText: (source, map, rawCategory) => `${rawCategory} ${resolvedText(source, map, 'description')}`,
  });
}

export const newYorkProvider = createSocrataProvider<FieldKey>({
  meta: NEW_YORK_META,
  schema: { fields: NEW_YORK_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapNewYorkRow,
});

// ── Chicago ──────────────────────────────────────────────────────────────────

export const CHICAGO_META: ProviderMeta = {
  id: 'chicago',
  city: 'Chicago',
  state: 'IL',
  label: 'Chicago, Illinois',
  agency: 'Chicago Police Department',
  datasetName: 'Crimes — 2001 to Present',
  endpoint: 'https://data.cityofchicago.org/resource/ijzp-q8t2.json',
  sourceUrl: 'https://data.cityofchicago.org/d/ijzp-q8t2',
  timeZone: 'America/Chicago',
  center: [-87.6298, 41.8781],
  zoom: 11.2,
  bounds: { west: -87.95, south: 41.63, east: -87.5, north: 42.03 },
  cadence: 'Updated daily',
  delayNote: 'The public feed excludes the most recent seven days.',
  settlingDays: 1,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published at block level and shifted for privacy.',
  coverageNote: 'Reported incidents within Chicago city limits; classification can change after review.',
  lastVerified: '2026-10-21',
};

const CHICAGO_FIELDS = fields({
  id: 'id',
  date: 'date',
  category: 'primary_type',
  description: 'description',
  location: 'block',
  area: 'location_description',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapChicagoRow(row: Row): Incident | null {
  return incidentFromRow(CHICAGO_META, row, CHICAGO_FIELDS, { locationFallback: 'Location withheld' });
}

export const chicagoProvider = createSocrataProvider<FieldKey>({
  meta: CHICAGO_META,
  schema: { fields: CHICAGO_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapChicagoRow,
});

// ── San Francisco ────────────────────────────────────────────────────────────

export const SAN_FRANCISCO_META: ProviderMeta = {
  id: 'san-francisco',
  city: 'San Francisco',
  state: 'CA',
  label: 'San Francisco, California',
  agency: 'San Francisco Police Department',
  datasetName: 'Police Department Incident Reports — 2018 to Present',
  endpoint: 'https://data.sfgov.org/resource/wg3w-h783.json',
  sourceUrl: 'https://data.sfgov.org/d/wg3w-h783',
  timeZone: 'America/Los_Angeles',
  center: [-122.4194, 37.7749],
  zoom: 11.5,
  bounds: { west: -122.54, south: 37.69, east: -122.33, north: 37.84 },
  cadence: 'Updated daily',
  delayNote: 'Published reports can lag occurrence and may be updated as investigations progress.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'intersection',
  precisionNote: 'Public coordinates are remapped to a nearby intersection for privacy.',
  coverageNote: 'Incident reports exclude some confidential cases and are not equivalent to calls for service.',
  lastVerified: '2026-08-17',
};

const SAN_FRANCISCO_FIELDS = fields({
  id: 'row_id',
  date: 'incident_datetime',
  category: 'incident_category',
  subcategory: 'incident_subcategory',
  description: 'incident_description',
  detail: 'resolution',
  location: 'intersection',
  area: 'police_district',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapSanFranciscoRow(row: Row): Incident | null {
  return incidentFromRow(SAN_FRANCISCO_META, row, SAN_FRANCISCO_FIELDS, {
    locationFallback: 'Nearby intersection',
    description: (source, map, rawCategory) => joinLabels(
      [resolvedText(source, map, 'description'), resolvedText(source, map, 'detail')],
      rawCategory,
    ),
    classificationText: (source, map, rawCategory) => [
      rawCategory,
      resolvedText(source, map, 'subcategory'),
      resolvedText(source, map, 'description'),
    ].join(' '),
  });
}

export const sanFranciscoProvider = createSocrataProvider<FieldKey>({
  meta: SAN_FRANCISCO_META,
  schema: { fields: SAN_FRANCISCO_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapSanFranciscoRow,
});

// ── Oakland ──────────────────────────────────────────────────────────────────

export const OAKLAND_META: ProviderMeta = {
  id: 'oakland',
  city: 'Oakland',
  state: 'CA',
  label: 'Oakland, California',
  agency: 'Oakland Police Department',
  datasetName: 'CrimeWatch Data',
  endpoint: 'https://data.oaklandca.gov/resource/ppgh-7dqv.json',
  sourceUrl: 'https://data.oaklandca.gov/d/ppgh-7dqv',
  timeZone: 'America/Los_Angeles',
  center: [-122.2712, 37.8044],
  zoom: 11.4,
  bounds: { west: -122.36, south: 37.7, east: -122.11, north: 37.89 },
  cadence: 'Updated daily',
  delayNote: 'CrimeWatch reports publish after entry into the records system; the newest days keep filling in.',
  settlingDays: 3,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Locations are published as a block address and its geocoded point, not a premises.',
  coverageNote: 'One case can list several offenses as separate rows; a case\'s crime type can differ from an offense row\'s description.',
  lastVerified: '2026-10-21',
};

const OAKLAND_FIELDS = fields({
  id: 'casenumber',
  secondaryId: 'description',
  date: 'datetime',
  category: 'crimetype',
  description: 'description',
  location: 'address',
  area: 'policebeat',
  point: 'location',
});

export function mapOaklandRow(row: Row): Incident | null {
  return incidentFromRow(OAKLAND_META, row, OAKLAND_FIELDS, {
    locationFallback: 'Published block',
    locationKeys: ['location'],
    // A case's crime type is shared by all of its offense rows; the row's own description is specific.
    classificationText: (_source, _map, rawCategory, description) => (
      normalizeCategory(description) === 'other' ? `${description} ${rawCategory}` : description
    ),
  });
}

export const oaklandProvider = createSocrataProvider<FieldKey>({
  meta: OAKLAND_META,
  schema: { fields: OAKLAND_FIELDS },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapOaklandRow,
});

// ── Los Angeles (aliases resolved from live metadata) ─────────────────────────

export const LOS_ANGELES_META: ProviderMeta = {
  id: 'los-angeles',
  city: 'Los Angeles',
  state: 'CA',
  label: 'Los Angeles, California',
  agency: 'Los Angeles Police Department',
  datasetName: 'LAPD NIBRS Offenses Dataset 2026 to Present',
  endpoint: 'https://data.lacity.org/resource/k7nn-b2ep.json',
  sourceUrl: 'https://data.lacity.org/d/k7nn-b2ep',
  timeZone: 'America/Los_Angeles',
  center: [-118.2437, 34.0522],
  zoom: 10.7,
  bounds: { west: -118.68, south: 33.7, east: -118.15, north: 34.34 },
  cadence: 'Updated on the LAPD publication cycle',
  delayNote: 'The NIBRS offense feed is a publication product and can be revised after release.',
  settlingDays: 1,
  datasetStart: '2026-01-01',
  precision: 'block',
  precisionNote: 'Coordinates identify the published hundred-block location, not a premises.',
  coverageNote: 'NIBRS offense rows for 2026 onward; one incident can contain multiple offenses.',
  lastVerified: '2026-10-21',
};

export const LOS_ANGELES_ALIASES = aliases({
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

const LOS_ANGELES_FIELDS = fields({
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
});

export function mapLosAngelesRow(row: Row, fieldMap: Fields = LOS_ANGELES_FIELDS): Incident | null {
  return incidentFromRow(LOS_ANGELES_META, row, fieldMap, {
    combineTime: true,
    locationFallback: 'Published hundred block',
  });
}

export const losAngelesProvider = createSocrataProvider<FieldKey>({
  meta: LOS_ANGELES_META,
  schema: { aliases: LOS_ANGELES_ALIASES, requiredKeys: ['id', 'category'] },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapLosAngelesRow,
});

// ── Seattle (text coordinates, aliases resolved from live metadata) ──────────

export const SEATTLE_META: ProviderMeta = {
  id: 'seattle',
  city: 'Seattle',
  state: 'WA',
  label: 'Seattle, Washington',
  agency: 'Seattle Police Department',
  datasetName: 'SPD Crime Data: 2008–Present',
  endpoint: 'https://cos-data.seattle.gov/resource/tazs-3rd5.json',
  sourceUrl: 'https://cos-data.seattle.gov/d/tazs-3rd5',
  timeZone: 'America/Los_Angeles',
  center: [-122.3321, 47.6062],
  zoom: 11.1,
  bounds: { west: -122.46, south: 47.47, east: -122.22, north: 47.75 },
  cadence: 'Updated daily',
  delayNote: 'Only finalized reports are released; publication follows records approval rather than dispatch.',
  settlingDays: 6,
  datasetStart: null,
  precision: 'block',
  precisionNote: 'Addresses and coordinates are blurred to an approximate one-hundred block.',
  coverageNote: 'One report can contain multiple offense rows identified by distinct offense IDs.',
  lastVerified: '2026-10-21',
};

export const SEATTLE_ALIASES = aliases({
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

const SEATTLE_FIELDS = fields({
  id: 'offense_id',
  secondaryId: 'report_number',
  date: 'offense_date',
  category: 'offense_sub_category',
  description: 'nibrs_crime_against_category',
  location: 'block_address',
  area: 'neighborhood',
  latitude: 'latitude',
  longitude: 'longitude',
});

export function mapSeattleRow(row: Row, fieldMap: Fields = SEATTLE_FIELDS): Incident | null {
  return incidentFromRow(SEATTLE_META, row, fieldMap, { locationFallback: 'Approximate one-hundred block' });
}

export const seattleProvider = createSocrataProvider<FieldKey>({
  meta: SEATTLE_META,
  schema: { aliases: SEATTLE_ALIASES, requiredKeys: ['id', 'category'] },
  dateKey: 'date',
  latitudeKey: 'latitude',
  longitudeKey: 'longitude',
  coordinateFieldsAreText: true,
  coordinatePlaceholders: ['REDACTED', '-', ''],
  mapRow: mapSeattleRow,
});

// ── Dallas (text date column, rounded public points) ─────────────────────────

export const DALLAS_META: ProviderMeta = {
  id: 'dallas',
  city: 'Dallas',
  state: 'TX',
  label: 'Dallas, Texas',
  agency: 'Dallas Police Department',
  datasetName: 'Police Incidents',
  endpoint: 'https://www.dallasopendata.com/resource/qv6i-rri7.json',
  sourceUrl: 'https://www.dallasopendata.com/d/qv6i-rri7',
  timeZone: 'America/Chicago',
  center: [-96.797, 32.7767],
  zoom: 10.7,
  bounds: { west: -97.04, south: 32.61, east: -96.52, north: 33.03 },
  cadence: 'Updated daily',
  delayNote: 'Published records are preliminary and can change as investigations and classifications progress.',
  settlingDays: 2,
  datasetStart: null,
  precision: 'approximate',
  precisionNote: 'Published coordinates are rounded to an approximately one-hundred-meter grid and addresses to a hundred block.',
  coverageNote: 'Dallas Police RMS incidents from June 2014 onward; one service report can contain multiple offense rows.',
  lastVerified: '2026-10-21',
};

export const DALLAS_ALIASES = aliases({
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

const DALLAS_FIELDS = fields({
  id: 'servnumid',
  date: 'date1',
  time: 'time1',
  category: 'nibrs_crime',
  description: 'offincident',
  location: 'incident_address',
  area: 'division',
  point: 'geocoded_column',
});

/** Replaces a leading house number with its hundred block. */
export function generalizedDallasAddress(value: string): string {
  return value.replace(/^(\d+)\s+/, (_match, houseNumber: string) => (
    `${Math.floor(Number(houseNumber) / 100) * 100} BLOCK `
  ));
}

export function mapDallasRow(row: Row, fieldMap: Fields = DALLAS_FIELDS): Incident | null {
  const incident = incidentFromRow(DALLAS_META, row, fieldMap, {
    combineTime: true,
    locationFallback: 'Approximate public location',
  });
  if (!incident) return null;
  return {
    ...incident,
    coordinates: roundCoordinates(incident.coordinates, 3),
    locationLabel: generalizedDallasAddress(incident.locationLabel),
  };
}

export const dallasProvider = createSocrataProvider<FieldKey>({
  meta: DALLAS_META,
  schema: { aliases: DALLAS_ALIASES, requiredKeys: ['id', 'category'] },
  dateKey: 'date',
  ...COORDINATE_KEYS,
  mapRow: mapDallasRow,
});
