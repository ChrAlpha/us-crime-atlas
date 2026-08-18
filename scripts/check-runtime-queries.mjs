const socrataSources = [
  {
    name: 'Chicago', endpoint: 'https://data.cityofchicago.org/resource/ijzp-q8t2.json',
    bounds: { west: -87.95, south: 41.63, east: -87.5, north: 42.03 },
    aliases: { date: ['date'], latitude: ['latitude'], longitude: ['longitude'], point: ['location'] },
  },
  {
    name: 'New York City', endpoint: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
    bounds: { west: -74.27, south: 40.48, east: -73.68, north: 40.93 },
    aliases: { date: ['cmplnt_fr_dt'], latitude: ['latitude'], longitude: ['longitude'], point: ['lat_lon'] },
  },
  {
    name: 'San Francisco', endpoint: 'https://data.sfgov.org/resource/wg3w-h783.json',
    bounds: { west: -122.54, south: 37.69, east: -122.33, north: 37.84 },
    aliases: { date: ['incident_datetime'], latitude: ['latitude'], longitude: ['longitude'], point: ['point'] },
  },
  {
    name: 'Los Angeles', endpoint: 'https://data.lacity.org/resource/2nrs-mtv8.json',
    bounds: { west: -118.68, south: 33.7, east: -118.15, north: 34.34 },
    aliases: { date: ['date_occ'], latitude: ['lat', 'latitude'], longitude: ['lon', 'longitude'], point: ['location_1', 'geocoded_column'] },
  },
  {
    name: 'Seattle', endpoint: 'https://data.seattle.gov/resource/tazs-3rd5.json',
    bounds: { west: -122.46, south: 47.47, east: -122.22, north: 47.75 },
    aliases: { date: ['offense_start_datetime', 'report_datetime'], latitude: ['latitude'], longitude: ['longitude'], point: ['report_location', 'geocoded_column'] },
  },
  {
    name: 'Austin', endpoint: 'https://data.austintexas.gov/resource/fdj4-gpfu.json',
    bounds: { west: -98.0, south: 30.05, east: -97.52, north: 30.55 },
    aliases: { date: ['occ_date_time', 'occurrence_date_time', 'occurred_date_time'], latitude: ['latitude'], longitude: ['longitude'], point: ['location', 'geocoded_column'] },
  },
  {
    name: 'Baltimore', endpoint: 'https://data.baltimorecity.gov/resource/wsfq-mvij.json',
    bounds: { west: -76.72, south: 39.19, east: -76.52, north: 39.38 },
    aliases: { date: ['crimedatetime', 'crime_date_time'], latitude: ['latitude'], longitude: ['longitude'], point: ['geolocation', 'location_1', 'geocoded_column'] },
  },
  {
    name: 'Nashville', endpoint: 'https://data.nashville.gov/resource/2u6v-ujjs.json',
    bounds: { west: -87.05, south: 35.95, east: -86.5, north: 36.42 },
    aliases: { date: ['incident_occurred', 'occurred', 'incident_reported'], latitude: ['latitude'], longitude: ['longitude'], point: ['mapped_location', 'location', 'geocoded_column'] },
  },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', Origin: 'https://us-crime-atlas.example' },
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
  const datasetId = url.pathname.match(/\/resource\/([^/.]+)\.json$/)?.[1];
  if (!datasetId) throw new Error(`Unsupported Socrata endpoint: ${endpoint}`);
  return `${url.origin}/api/views/${datasetId}`;
}

function resolveAliases(aliases, availableFields) {
  const available = new Set(availableFields);
  return Object.fromEntries(
    Object.entries(aliases).map(([key, candidates]) => [
      key,
      candidates.find((candidate) => available.has(candidate)) ?? null,
    ]),
  );
}

function sourceStamp(date) {
  return date.toISOString().replace(/Z$/, '');
}

async function checkSocrataRuntimeQuery(source) {
  const metadataResponse = await fetchWithRetry(metadataUrl(source.endpoint));
  const metadata = await metadataResponse.json();
  const availableFields = (metadata.columns ?? [])
    .map((column) => column.fieldName)
    .filter((field) => typeof field === 'string' && field.length > 0);
  const fields = resolveAliases(source.aliases, availableFields);
  if (!fields.date) throw new Error(`${source.name}: no occurrence date field`);

  const hasPair = Boolean(fields.latitude && fields.longitude);
  if (!hasPair && !fields.point) throw new Error(`${source.name}: no runtime coordinate fields`);

  const now = new Date();
  const start = new Date(now.getTime() - 180 * 86_400_000);
  const geometryWhere = hasPair
    ? [
        `${fields.latitude} >= ${source.bounds.south}`,
        `${fields.latitude} <= ${source.bounds.north}`,
        `${fields.longitude} >= ${source.bounds.west}`,
        `${fields.longitude} <= ${source.bounds.east}`,
      ].join(' AND ')
    : `within_box(${fields.point}, ${source.bounds.north}, ${source.bounds.west}, ${source.bounds.south}, ${source.bounds.east})`;
  const selected = [...new Set(Object.values(fields).filter(Boolean))];
  const params = new URLSearchParams({
    $select: selected.join(','),
    $where: [
      `${fields.date} >= '${sourceStamp(start)}'`,
      `${fields.date} <= '${sourceStamp(now)}'`,
      geometryWhere,
    ].join(' AND '),
    $order: `${fields.date} DESC`,
    $limit: '1',
  });
  const response = await fetchWithRetry(`${source.endpoint}?${params.toString()}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`${source.name}: runtime query did not return an array`);
  if (payload.length === 0) throw new Error(`${source.name}: runtime-shaped 180-day city query returned no records`);
  console.log(`✓ ${source.name} runtime-shaped Socrata query`);
}

function sqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function checkDcRuntimeQuery() {
  const year = new Date().getUTCFullYear();
  const search = new URL('https://www.arcgis.com/sharing/rest/search');
  search.search = new URLSearchParams({
    f: 'json',
    num: '100',
    q: `owner:DCGIS type:"Feature Service" "Crime Incidents in ${year}"`,
  }).toString();
  const catalogResponse = await fetchWithRetry(search);
  const catalog = await catalogResponse.json();
  const item = (catalog.results ?? []).find(
    (candidate) => candidate.title?.toLowerCase().includes(`crime incidents in ${year}`) && candidate.url,
  );
  if (!item?.url) throw new Error(`Washington DC: current-year Feature Service was not found`);
  const normalized = item.url.replace(/\/$/, '');
  const layer = /\/FeatureServer\/\d+$/i.test(normalized) ? normalized : `${normalized}/0`;

  const now = new Date();
  const start = new Date(now.getTime() - 180 * 86_400_000);
  const geometry = JSON.stringify({
    xmin: -77.13,
    ymin: 38.79,
    xmax: -76.9,
    ymax: 39.0,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    f: 'json',
    where: `START_DATE >= TIMESTAMP '${sqlTimestamp(start)}' AND START_DATE <= TIMESTAMP '${sqlTimestamp(now)}'`,
    outFields: '*',
    returnGeometry: 'true',
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    orderByFields: 'START_DATE DESC',
    resultRecordCount: '1',
  });
  const response = await fetchWithRetry(`${layer}/query?${params.toString()}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`Washington DC: ${payload.error.message ?? 'runtime ArcGIS query error'}`);
  if (!Array.isArray(payload.features) || payload.features.length === 0) {
    throw new Error('Washington DC: runtime-shaped 180-day city query returned no features');
  }
  console.log('✓ Washington DC runtime-shaped ArcGIS query');
}

async function main() {
  const failures = [];
  for (const source of socrataSources) {
    try {
      await checkSocrataRuntimeQuery(source);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    await checkDcRuntimeQuery();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  if (failures.length > 0) {
    console.error('\nRuntime query failures:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll nine runtime-shaped provider queries passed.');
}

await main();
