# US Crime Atlas

An evidence-first, responsive MapLibre application for examining recently published crime incidents around a US travel destination.

The atlas deliberately avoids an opaque “safety score.” It shows observed incident counts, violent and nighttime shares, change from the previous equal time window, and a transparent density comparison between the selected radius and its surrounding area.

## Current official incident coverage

| City | Publisher | Backend | Public location precision |
| --- | --- | --- | --- |
| New York City | NYPD | Socrata | Block midpoint |
| Washington, DC | Metropolitan Police Department | ArcGIS Feature Service | Generalized block |
| Baltimore | Baltimore Police Department | Socrata | Approximate incident location |
| Chicago | Chicago Police Department | Socrata | Shifted block location |
| Nashville | Metropolitan Nashville Police Department | Socrata | Approximate incident location |
| Austin | Austin Police Department | Socrata | Approximate report location |
| Los Angeles | Los Angeles Police Department | Socrata | Approximate block |
| San Francisco | San Francisco Police Department | Socrata | Nearby intersection |
| Seattle | Seattle Police Department | Socrata | Approximate 100-block |

The map and place search work throughout the United States. Incident analysis is enabled only where a verified provider adapter exists, so unsupported areas never silently receive fabricated events, a citywide average, or a national proxy.

This first nationwide expansion wave deliberately prioritizes maintainable official feeds over a large but unverifiable city list. Socrata providers resolve documented field aliases from live dataset metadata, while the Washington, DC provider resolves the current-year incident Feature Service through the official DCGIS ArcGIS catalog. A scheduled workflow checks every provider twice weekly for schema drift, sample geometry, and endpoint availability.

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
npx playwright install chromium
npm run test:e2e
```

`test:data` performs live metadata and sample-record checks against all nine official city feeds and validates the OpenFreeMap MapLibre style. Playwright mocks source responses so browser acceptance remains deterministic while the separate live contract job detects upstream schema drift.

## Architecture

```text
Official Socrata metadata + rows       Official ArcGIS catalog + features
                 │                                      │
                 └──────── Provider boundaries ─────────┘
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

A new provider must declare its publisher, machine-readable endpoint, field aliases or feature schema, row identity, occurrence-time semantics, geographic bounds, update cadence, known lag, and public spatial transformation. It then joins the registry in `src/data/providers/index.ts` only after mapper tests and a live source contract pass.

## Acceptance evidence

The CI workflow requires:

1. strict TypeScript checking;
2. unit coverage thresholds for geospatial, normalization, URL-state, analysis, Socrata, ArcGIS, and city mapper contracts;
3. a production Vite build;
4. live official-source and MapLibre-style contract tests;
5. Chromium acceptance at desktop and iPhone-class viewports;
6. interaction checks for provider switching, filters, radius and URL state;
7. an explicit browser path through an ArcGIS-backed provider;
8. horizontal-overflow checks and a serious/critical axe accessibility audit;
9. retained desktop/mobile screenshots and Playwright traces as workflow artifacts.

The detailed release criteria are in [Acceptance criteria](docs/ACCEPTANCE.md).

## Provider health

`.github/workflows/provider-health.yml` runs every Monday and Thursday and can also be dispatched manually. It fails when a required source field disappears, a sample record no longer exposes usable geometry, an ArcGIS catalog item cannot be resolved, or the base-map style contract changes. A failing health run is a signal to investigate the publisher before changing or suppressing a contract.

## Responsible-use notice

Published incident records are incomplete observations shaped by reporting behavior, police practices, approval workflows, and privacy transformations. A point does not identify a particular building, and a quiet historical window does not guarantee safety. Use this atlas alongside current local guidance, lighting and foot-traffic conditions, transit status, and ordinary situational awareness.

## License

MIT. Data remains subject to each source publisher’s terms and caveats.
