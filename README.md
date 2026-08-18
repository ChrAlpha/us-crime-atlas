# US Crime Atlas

An evidence-first, responsive MapLibre application for examining recently published crime incidents around a US travel destination.

The atlas deliberately avoids an opaque “safety score.” It shows observed incident counts, violent and nighttime shares, change from the previous equal time window, and a transparent density comparison between the selected radius and its surrounding area.

## Current official incident coverage

| City | Publisher | Backend | Public location precision |
| --- | --- | --- | --- |
| New York City | NYPD | Socrata | Block midpoint |
| Washington, DC | Metropolitan Police Department | ArcGIS Feature Service | Generalized block |
| Chicago | Chicago Police Department | Socrata | Shifted block location |
| Los Angeles | Los Angeles Police Department | Socrata | Approximate block |
| San Francisco | San Francisco Police Department | Socrata | Nearby intersection |
| Seattle | Seattle Police Department | Socrata | Approximate one-hundred block |

The map and place search work throughout the United States. Incident analysis is enabled only where a verified provider adapter exists, so unsupported areas never silently receive fabricated events, a citywide average, or a national proxy.

This coverage wave adds Los Angeles, Seattle, and Washington, DC to the original New York City, Chicago, and San Francisco providers. It deliberately excludes candidate feeds that do not currently expose usable public point locations or whose reviewed endpoint has disappeared. Coverage count is never allowed to outrank source integrity.

## Product behavior

- Search a US hotel, address, landmark, or city through OpenStreetMap Nominatim.
- Drop a pin directly on the MapLibre map or use browser geolocation.
- Analyze a 500 m, 1 km, or 2 km radius over 14, 30, 60, or 90 days.
- Filter violent, property, vehicle, weapons, and other incidents.
- Inspect raw incident points and clustered context, with lower-opacity observations outside the selected circle.
- Compare the selected area with the surrounding ring from 1× to 3× the radius.
- Review source cadence, publication delay, spatial blurring, query completeness, and the latest observed report.
- Share the exact view through URL state.
- Use a purpose-built desktop layout or a draggable mobile evidence sheet, with light and dark themes.

## Why the atlas uses a nearby-area comparison

A resident-population “crime rate” can be misleading for airports, downtowns, campuses, transit hubs, and tourist districts because the exposed population can be much larger than the resident population. US Crime Atlas instead compares weighted published-incident density in the selected circle with the surrounding annulus during the same dates:

```text
relative activity = selected weighted incidents / km²
                    ---------------------------------
                    nearby weighted incidents / km²
```

This is a local activity signal, not a prediction of personal harm. Raw counts are always shown beside it. See [Data methodology](docs/DATA-METHODOLOGY.md) for category weights, thresholds, source boundaries, and limitations.

## Development

Requirements: Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run typecheck
npm run test:unit
npm run build
npm run test:data
npm run test:runtime
npx playwright install chromium
npm run test:e2e
```

`test:data` validates live source metadata, required fields, usable sample geometry, and the OpenFreeMap style. `test:runtime` executes the same 180-day date and spatial query shape used by the product against all six registered city sources. Playwright mocks source responses so browser acceptance remains deterministic while the live jobs detect upstream drift.

## Architecture

```text
Official Socrata metadata + rows       Official ArcGIS feature layer
                 │                                  │
                 └──────── Provider boundaries ─────┘
                                  │
                                  ▼
         Normalize category, time, geometry, identity, precision
                                  │
                                  ▼
   Analysis engine ── radius filter, equal-window trend, nearby annulus density
                                  │
                ├── MapLibre clustered GeoJSON layers
                └── responsive evidence inspector
```

Stable Socrata providers use explicit schemas. Expansion providers resolve only reviewed aliases from live dataset metadata. Seattle’s published coordinates are text fields, so its bounded query excludes privacy placeholders and applies fixed-degree textual bounds before numeric parsing and exact Haversine filtering. Washington, DC uses the official 2026 MPD Feature Layer directly rather than selecting a similarly titled ArcGIS item heuristically.

A new provider must declare its publisher, machine-readable endpoint, row identity, occurrence-time semantics, geographic bounds, update cadence, known lag, and public spatial transformation. It joins the registry only after mapper tests, live metadata checks, a runtime-shaped spatial query, and responsive browser acceptance pass.

## Acceptance evidence

The CI workflow requires:

1. strict TypeScript checking;
2. unit coverage thresholds for geospatial, normalization, URL-state, analysis, Socrata, ArcGIS, and city mapper contracts;
3. a production Vite build;
4. live official-source and MapLibre-style contracts;
5. live runtime-shaped date and spatial queries for all six cities;
6. Chromium acceptance at desktop and iPhone-class viewports;
7. an explicit browser path through an ArcGIS-backed provider;
8. horizontal-overflow checks and a serious/critical axe accessibility audit;
9. retained desktop/mobile screenshots and Playwright traces as workflow artifacts.

The detailed release criteria are in [Acceptance criteria](docs/ACCEPTANCE.md).

## Provider health

`.github/workflows/provider-health.yml` runs every Monday and Thursday and can also be dispatched manually. It checks live metadata, required semantics, usable geometry, runtime-shaped source queries, and the base-map style. A failing source remains a failure to investigate; the workflow does not silently drop it or substitute proxy data.

## Responsible-use notice

Published incident records are incomplete observations shaped by reporting behavior, police practices, approval workflows, and privacy transformations. A point does not identify a particular building, and a quiet historical window does not guarantee safety. Use this atlas alongside current local guidance, lighting and foot-traffic conditions, transit status, and ordinary situational awareness.

## License

MIT. Data remains subject to each source publisher’s terms and caveats.
