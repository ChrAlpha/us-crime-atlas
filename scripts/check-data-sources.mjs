const sources = [
  {
    name: 'Chicago Crimes — 2001 to Present',
    endpoint: 'https://data.cityofchicago.org/resource/ijzp-q8t2.json',
    fields: ['id', 'date', 'primary_type', 'latitude', 'longitude'],
    where: 'latitude IS NOT NULL AND longitude IS NOT NULL',
    order: 'date DESC',
  },
  {
    name: 'NYPD Complaint Data Current (YTD)',
    endpoint: 'https://data.cityofnewyork.us/resource/5uac-w243.json',
    fields: ['cmplnt_num', 'cmplnt_fr_dt', 'ofns_desc', 'latitude', 'longitude'],
    where: 'latitude IS NOT NULL AND longitude IS NOT NULL',
    order: 'cmplnt_fr_dt DESC',
  },
  {
    name: 'SFPD Incident Reports — 2018 to Present',
    endpoint: 'https://data.sfgov.org/resource/wg3w-h783.json',
    fields: ['row_id', 'incident_datetime', 'incident_category', 'latitude', 'longitude'],
    where: 'latitude IS NOT NULL AND longitude IS NOT NULL',
    order: 'incident_datetime DESC',
  },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

async function checkSocrataSource(source) {
  const params = new URLSearchParams({
    $select: source.fields.join(','),
    $where: source.where,
    $order: source.order,
    $limit: '1',
  });
  const response = await fetchWithRetry(`${source.endpoint}?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      Origin: 'https://us-crime-atlas.example',
    },
  });
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`${source.name}: expected at least one record`);
  }
  const row = payload[0];
  const missing = source.fields.filter((field) => !(field in row));
  if (missing.length > 0) {
    throw new Error(`${source.name}: missing fields ${missing.join(', ')}`);
  }
  const cors = response.headers.get('access-control-allow-origin') ?? 'not advertised to this request';
  console.log(`✓ ${source.name}`);
  console.log(`  fields: ${source.fields.join(', ')}`);
  console.log(`  CORS: ${cors}`);
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
  for (const source of sources) {
    try {
      await checkSocrataSource(source);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
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
  console.log('\nAll live source contracts passed.');
}

await main();
