# US Crime Atlas

An evidence-first, responsive MapLibre application for examining recently published crime incidents around a US travel destination.

The atlas deliberately avoids an opaque “safety score.” It shows the observed incident count, violent and nighttime shares, change from the previous equal time window, and a transparent density comparison between the selected radius and its surrounding area.

## Current coverage

| City | Publisher | Dataset | Public location precision |
| --- | --- | --- | --- |
| New York City | NYPD | Complaint Data Current (YTD) | Block midpoint |
| Chicago | Chicago Police Department | Crimes — 2001 to Present | Shifted block location |
| San Francisco | San Francisco Police Department | Incident Reports — 2018 to Present | Nearby intersection |

The map and place search work throughout the United States. Incident analysis is enabled only where a verified provider adapter exists, so unsupported areas never silently receive fabricated or city-level proxy data.

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

A resident-population “crime rate” can be misleading for airports, downtowns, campuses, transit hubs, and tourist districts because the exposed population is much larger than the resident population. US Crime Atlas instead compares weighted published-incident density in the selected circle with the surrounding annulus during the same dates:

```text
relative activity = selected weighted incidents / km²
                    ---------------------------------
                    nearby weighted incidents / km²
```

This is a local activity signal, not a prediction of personal harm. Raw counts are always shown beside it. See [Data methodology](docs/DATA-METHODOLOGY.md) for category weights, thresholds, and limitations.

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

`test:data` performs live schema checks against all three official city endpoints and validates the OpenFreeMap MapLibre style. Playwright mocks incident responses so browser acceptance remains deterministic while the separate contract job detects upstream schema drift.

## Architecture

```text
Official Socrata feeds
        │
        ▼
Provider adapters ── normalize category, time, coordinates, precision
        │
        ▼
Analysis engine ── radius filter, equal-window trend, nearby annulus density
        │
        ├── MapLibre clustered GeoJSON layers
        └── responsive evidence inspector
```

The provider boundary is intentionally small. A new city implements `IncidentProvider`, declares its publication caveats, normalizes rows to `Incident`, and joins the registry in `src/data/providers/index.ts`.

## Acceptance evidence

The CI workflow requires:

1. strict TypeScript checking;
2. unit coverage thresholds for geospatial, normalization, URL-state, analysis, and provider contracts;
3. a production Vite build;
4. live official-source and MapLibre-style contract tests;
5. Chromium acceptance at desktop and iPhone-class viewports;
6. interaction checks for provider switching, filters, radius and URL state;
7. horizontal-overflow checks and a serious/critical axe accessibility audit;
8. retained desktop/mobile screenshots and Playwright traces as workflow artifacts.

The detailed release criteria are in [Acceptance criteria](docs/ACCEPTANCE.md).

## Responsible-use notice

Published incident records are incomplete observations shaped by reporting behavior, police practices, approval workflows, and privacy transformations. A point does not identify a particular building, and a quiet historical window does not guarantee safety. Use this atlas alongside current local guidance, lighting and foot-traffic conditions, transit status, and ordinary situational awareness.

## License

MIT. Data remains subject to each source publisher’s terms and caveats.
