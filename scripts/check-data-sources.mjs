const socrataSources = [
  {
    name: 'Chicago Crimes — 2001 to Present',
    endpoint: 'https://data.cityofchicago.org/resource/ijzp-q8t2.json',
    requireIdentity: true,
    aliases: {
      id: ['id'],
      date: ['date'],
      category: ['primary_type'],
      latitude: ['latitude'],
      longitude: ['longitude'],
      point: ['location'],
    },
  },
  {
    name: 'NYPD Complaint Data Current (YTD)',
    endpoint: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
    requireIdentity: true,
    aliases: {
      id: ['cmplnt_num'],
      date: ['cmplnt_fr_dt'],
      category: ['ofns_desc'],
      latitude: ['latitude'],
      longitude: ['longitude'],
      point: ['lat_lon'],
    },
  },
  {
    name: 'SFPD Incident Reports — 2018 to Present',
    endpoint: 'https://data.sfgov.org/resource/wg3w-h783.json',
    requireIdentity: true,
    aliases: {
      id: ['row_id'],
      date: ['incident_datetime'],
      category: ['incident_category'],
      latitude: ['latitude'],
      longitude: ['longitude'],
      point: ['point'],
    },
  },
  {
    name: 'LAPD Crime Data from 2020 to Present',
    endpoint: 'https://data.lacity.org/resource/2nrs-mtv8.json',
    requireIdentity: true,
    aliases: {
      id: ['dr_no'],
      date: ['date_occ'],
      category: ['crm_cd_desc'],
      latitude: ['lat', 'latitude'],
      longitude: ['lon', 'longitude'],
      point: ['location_1', 'geocoded_column'],
    },
  },
  {
    name: 'Seattle SPD Crime Data: 2008–Present',
    endpoint: 'https://data.seattle.gov/resource/tazs-3rd5.json',
    requireIdentity: true,
    aliases: {
      id: ['offense_id', 'report_number'],
      date: ['offense_date', 'report_date_time'],
      category: ['offense_sub_category', 'offense_category', 'nibrs_crime_against_category'],
      latitude: ['latitude'],
      longitude: ['longitude'],
      point: [],
    },
  },
];

const dcArcgisSource = {
  name: 'Washington DC Crime Incidents - 2026',
  layerUrl: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41',
  requiredFields: ['CCN', 'START_DATE', 'OFFENSE', 'LATITUDE', 'LONGITUDE', 'OBJECTID'],
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1200);
    }
  }
  throw lastError;
}

function metadataUrl(endpoint) {
  const url = new URL(endpoint);
  const match = url.pathname.match(/\/resource\/([^/.]+)\.json$/);
  if (!match?.[1]) throw new Error(`Unsupported Socrata endpoint: ${endpoint}`);
  return `${url.origin}/api/views/${match[1]}`;
}

function resolveAliases(aliases, availableFields) {
  const available = new Set(availableFields);
  return Object.fromEntries(
    Object.entries(aliases).map(([key, candidates]) => [
      key,
      candidates.find((field) => available.has(field)) ?? null,
    ]),
  );
}

function finiteCoordinates(longitude, latitude) {
  const lon = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (Math.abs(lon) < 0.0001 && Math.abs(lat) < 0.0001) return null;
  if (lon === -1 && lat === -1) return null;
  return [lon, lat];
}

function pointCoordinates(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.coordinates) && value.coordinates.length >= 2) {
    return finiteCoordinates(value.coordinates[0], value.coordinates[1]);
  }
  return finiteCoordinates(value.longitude, value.latitude);
}

function rowCoordinates(row, fields) {
  if (fields.latitude && fields.longitude) {
    const coordinates = finiteCoordinates(row[fields.longitude], row[fields.latitude]);
    if (coordinates) return coordinates;
  }
  return fields.point ? pointCoordinates(row[fields.point]) : null;
}

async function checkSocrataSource(source) {
  const metadataResponse = await fetchWithRetry(metadataUrl(source.endpoint), {
    headers: { Accept: 'application/json', Origin: 'https://us-crime-atlas.example' },
  });
  const metadata = await metadataResponse.json();
  const availableFields = (metadata.columns ?? [])
    .map((column) => column.fieldName)
    .filter((field) => typeof field === 'string' && field.length > 0);
  const fields = resolveAliases(source.aliases, availableFields);

  const missing = ['date', 'category'].filter((key) => !fields[key]);
  if (source.requireIdentity && !fields.id) missing.push('id');
  const hasCoordinatePair = Boolean(fields.latitude && fields.longitude);
  const hasPoint = Boolean(fields.point);
  if (!hasCoordinatePair && !hasPoint) missing.push('geometry');
  if (missing.length > 0) {
    throw new Error(`${source.name}: metadata is missing ${missing.join(', ')}`);
  }

  const selected = [...new Set(Object.values(fields).filter(Boolean))];
  const geometryWhere = hasCoordinatePair
    ? `${fields.latitude} IS NOT NULL AND ${fields.longitude} IS NOT NULL`
    : `${fields.point} IS NOT NULL`;
  const params = new URLSearchParams({
    $select: selected.join(','),
    $where: `${fields.date} IS NOT NULL AND ${fields.category} IS NOT NULL AND ${geometryWhere}`,
    $order: `${fields.date} DESC`,
    $limit: '100',
  });
  const response = await fetchWithRetry(`${source.endpoint}?${params.toString()}`, {
    headers: { Accept: 'application/json', Origin: 'https://us-crime-atlas.example' },
  });
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`${source.name}: expected at least one recent record`);
  }
  const record = payload.find((row) => rowCoordinates(row, fields));
  if (!record) {
    throw new Error(`${source.name}: the latest 100 coordinate-bearing rows exposed no usable numeric location`);
  }

  const cors = response.headers.get('access-control-allow-origin') ?? 'not advertised to this request';
  console.log(`✓ ${source.name}`);
  console.log(`  resolved: ${Object.entries(fields).map(([key, value]) => `${key}=${value ?? '—'}`).join(', ')}`);
  console.log(`  CORS: ${cors}`);
}

function attributeName(available, expected) {
  return available.find((field) => field.toLowerCase() === expected.toLowerCase()) ?? null;
}

async function checkDcArcgisSource() {
  const metadataResponse = await fetchWithRetry(`${dcArcgisSource.layerUrl}?f=json`, {
    headers: { Accept: 'application/json' },
  });
  const metadata = await metadataResponse.json();
  if (metadata.error) throw new Error(`${dcArcgisSource.name}: ${metadata.error.message ?? 'layer metadata error'}`);
  if (metadata.name !== 'Crime Incidents - 2026') {
    throw new Error(`${dcArcgisSource.name}: layer 41 now identifies as ${metadata.name ?? 'an unnamed layer'}`);
  }
  const available = (metadata.fields ?? []).map((field) => field.name).filter(Boolean);
  const missing = dcArcgisSource.requiredFields.filter((field) => !attributeName(available, field));
  if (missing.length > 0) throw new Error(`${dcArcgisSource.name}: layer is missing ${missing.join(', ')}`);

  const params = new URLSearchParams({
    f: 'json',
    where: 'START_DATE IS NOT NULL',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    orderByFields: 'START_DATE DESC',
    resultRecordCount: '1',
  });
  const response = await fetchWithRetry(`${dcArcgisSource.layerUrl}/query?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${dcArcgisSource.name}: ${payload.error.message ?? 'query error'}`);
  if (!Array.isArray(payload.features) || payload.features.length === 0) {
    throw new Error(`${dcArcgisSource.name}: expected at least one feature`);
  }
  const feature = payload.features[0];
  const attributes = feature.attributes ?? {};
  const longitudeField = attributeName(Object.keys(attributes), 'LONGITUDE');
  const latitudeField = attributeName(Object.keys(attributes), 'LATITUDE');
  const coordinates = finiteCoordinates(
    longitudeField ? attributes[longitudeField] : feature.geometry?.x,
    latitudeField ? attributes[latitudeField] : feature.geometry?.y,
  );
  if (!coordinates) throw new Error(`${dcArcgisSource.name}: latest feature has no usable WGS84 location`);
  console.log(`✓ ${dcArcgisSource.name}`);
  console.log(`  layer: ${dcArcgisSource.layerUrl}`);
}

async function checkMapStyle() {
  const url = 'https://tiles.openfreemap.org/styles/positron';
  const response = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
  const style = await response.json();
  if (style.version !== 8 || !style.sources || !Array.isArray(style.layers) || style.layers.length === 0) {
    throw new Error('OpenFreeMap Positron did not return a valid MapLibre Style Specification v8 document');
  }
  console.log(`✓ OpenFreeMap Positron (${Object.keys(style.sources).length} sources, ${style.layers.length} layers)`);
}

async function main() {
  const failures = [];
  for (const source of socrataSources) {
    try {
      await checkSocrataSource(source);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    await checkDcArcgisSource();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  try {
    await checkMapStyle();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length > 0) {
    console.error('\nData contract failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${socrataSources.length + 1} live city source contracts passed.`);
}

await main();
