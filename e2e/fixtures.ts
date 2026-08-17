import type { Page } from '@playwright/test';

function sourceDate(daysAgo: number, hour = 12) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const day = date.toISOString().slice(0, 10);
  return {
    date: `${day}T00:00:00.000`,
    time: `${String(hour).padStart(2, '0')}:15:00`,
    timestamp: `${day}T${String(hour).padStart(2, '0')}:15:00.000`,
  };
}

const nycPoint = (id: string, daysAgo: number, category: string, description: string, longitude: number, latitude: number, hour = 12) => {
  const date = sourceDate(daysAgo, hour);
  return {
    cmplnt_num: id,
    cmplnt_fr_dt: date.date,
    cmplnt_fr_tm: date.time,
    ofns_desc: category,
    pd_desc: description,
    law_cat_cd: category.includes('ASSAULT') || category.includes('ROBBERY') ? 'FELONY' : 'MISDEMEANOR',
    loc_of_occur_desc: 'FRONT OF',
    prem_typ_desc: 'STREET',
    boro_nm: 'MANHATTAN',
    latitude: String(latitude),
    longitude: String(longitude),
  };
};

export const nycFixture = [
  nycPoint('ny-1', 1, 'FELONY ASSAULT', 'AGGRAVATED ASSAULT', -73.985, 40.758, 23),
  nycPoint('ny-2', 2, 'ROBBERY', 'ROBBERY, OPEN AREA', -73.98, 40.758, 1),
  nycPoint('ny-3', 3, 'PETIT LARCENY', 'PICKPOCKET', -73.988, 40.754, 14),
  nycPoint('ny-4', 4, 'GRAND LARCENY OF MOTOR VEHICLE', 'AUTO THEFT', -73.99, 40.76, 18),
  nycPoint('ny-5', 5, 'BURGLARY', 'COMMERCIAL BURGLARY', -73.981, 40.762, 3),
  nycPoint('ny-prev-1', 34, 'PETIT LARCENY', 'LARCENY', -73.984, 40.758),
  nycPoint('ny-prev-2', 38, 'ROBBERY', 'ROBBERY', -73.987, 40.756),
  ...Array.from({ length: 12 }, (_, index) =>
    nycPoint(
      `ny-outer-${index}`,
      2 + (index % 8),
      index % 3 === 0 ? 'FELONY ASSAULT' : 'PETIT LARCENY',
      index % 3 === 0 ? 'ASSAULT' : 'LARCENY',
      -73.963 + index * 0.0004,
      40.758 + (index % 2) * 0.003,
      10 + (index % 12),
    ),
  ),
];

const chicagoPoint = (id: string, daysAgo: number, type: string, longitude: number, latitude: number) => {
  const date = sourceDate(daysAgo, 22);
  return {
    id,
    date: date.timestamp,
    block: '001XX N STATE ST',
    primary_type: type,
    description: type === 'BATTERY' ? 'AGGRAVATED' : 'OVER $500',
    location_description: 'SIDEWALK',
    latitude: String(latitude),
    longitude: String(longitude),
  };
};

export const chicagoFixture = [
  chicagoPoint('chi-1', 2, 'BATTERY', -87.629, 41.884),
  chicagoPoint('chi-2', 3, 'ROBBERY', -87.631, 41.882),
  chicagoPoint('chi-3', 4, 'THEFT', -87.628, 41.88),
  chicagoPoint('chi-4', 5, 'MOTOR VEHICLE THEFT', -87.626, 41.885),
  chicagoPoint('chi-prev', 40, 'THEFT', -87.63, 41.883),
  ...Array.from({ length: 8 }, (_, index) =>
    chicagoPoint(`chi-outer-${index}`, 2 + index, 'THEFT', -87.608 + index * 0.0003, 41.884),
  ),
];

export async function mockOfficialSources(page: Page, mode: 'success' | 'error' = 'success') {
  await page.route('**/resource/5uac-w243.json?*', async (route) => {
    if (mode === 'error') {
      await route.fulfill({ status: 503, body: 'Service unavailable' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nycFixture) });
  });
  await page.route('**/resource/ijzp-q8t2.json?*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chicagoFixture) });
  });
  await page.route('**/resource/wg3w-h783.json?*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}
