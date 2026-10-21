# US Crime Atlas

An evidence-first, responsive MapLibre application for examining recently published crime incidents around a US travel destination.

The atlas deliberately avoids an opaque “safety score.” It shows observed incident counts, violent and nighttime shares, change from the previous equal time window, and a transparent density comparison between the selected radius and its surrounding area.

## Current official incident coverage

| City | Publisher | Backend | Public location precision |
| --- | --- | --- | --- |
| New York City | NYPD | Socrata | Block midpoint |
| Washington, DC | Metropolitan Police Department | ArcGIS Feature Service | Generalized block |
| Philadelphia | Philadelphia Police Department | ArcGIS Feature Service | Hundred block |
| Chicago | Chicago Police Department | Socrata | Shifted block location |
| Detroit | Detroit Police Department | ArcGIS Feature Service | Nearest intersection |
| Nashville | Metropolitan Nashville Police Department | ArcGIS Feature Service | Approximate public location |
| Dallas | Dallas Police Department | Socrata | Approximate public location |
| Denver | Denver Police Department | ArcGIS Feature Service | Approximate hundred-meter grid |
| Los Angeles | Los Angeles Police Department | Socrata | Approximate block |
| San Francisco | San Francisco Police Department | Socrata | Nearby intersection |
| Seattle | Seattle Police Department | Socrata | Approximate one-hundred block |

The map and place search work throughout the United States. Incident analysis is enabled only inside the legal limits of a city with a verified provider adapter (Census TIGERweb boundaries), so unsupported areas, including neighboring cities such as Jersey City or Beverly Hills, never silently receive fabricated events, a falsely quiet result, a citywide average, or a national proxy.

The current expansion waves add Dallas, Denver, Detroit, Los Angeles, Nashville, Philadelphia, Seattle, and Washington, DC to the original New York City, Chicago, and San Francisco providers. They accept clearly disclosed lower-precision official locations when exact public points are unavailable, but still exclude feeds without usable recent incident-level geometry or a live reviewed endpoint.

## Product behavior

- Search a US hotel, address, landmark, or city through OpenStreetMap Nominatim.
- Drop a pin directly on the MapLibre map or use browser geolocation.
- Analyze a 500 m, 1 km, or 2 km radius over 14, 30, 60, or 90 days, ending at each publisher's newest complete day rather than at "now", so publication lag never reads as quiet days.
- Filter violent, property, vehicle, weapons, and other incidents.
- Inspect raw incident points and clustered context, with lower-opacity observations outside the selected circle.
- Compare the selected area with the surrounding ring from 1× to 3× the radius, counting only the area inside city limits.
- Review the exact date window, source cadence, publication delay, spatial blurring, query completeness, and the latest observed report. Delayed publishers (for example NYPD's quarterly release) are called out explicitly.
- Share the exact view through URL state.
- Use a purpose-built desktop layout or a single-column mobile flow with collapsible analysis settings, in light and dark themes.

## Why windows end at the newest published record

Official feeds are publication products, not live dispatch consoles. NYPD releases complaint data quarterly, Chicago withholds the most recent seven days, and daily feeds keep adding reports for the newest few days. Ending every window "today" would show NYC as empty for months at a time and push every equal-window trend downward.

Each analysis therefore asks the provider for its newest published record, drops that provider's reviewed number of still-filling days, and ends both the current and previous windows there. The panel shows the exact dates and says when a feed is behind.

## Why the atlas uses a nearby-area comparison

A resident-population “crime rate” can be misleading for airports, downtowns, campuses, transit hubs, and tourist districts because the exposed population can be much larger than the resident population. US Crime Atlas instead compares weighted published-incident density in the selected circle with the surrounding annulus during the same dates:

```text
relative activity = selected weighted incidents / km²
                    ---------------------------------
                    nearby weighted incidents / km²
```

This is a local activity signal, not a prediction of personal harm. Raw counts are always shown beside it. See [Data methodology](docs/DATA-METHODOLOGY.md) for category weights, thresholds, source boundaries, and limitations.

## Development

Requirements: Node.js 22.12 or newer and pnpm.

```bash
pnpm install
pnpm run dev
```

Quality gates:

```bash
pnpm run typecheck
pnpm run test:unit        # Vitest: node + jsdom projects, coverage thresholds over all of src/
pnpm run build
pnpm run test:contracts   # live official sources (test:data + test:runtime)
pnpm exec playwright install chromium
pnpm run test:e2e
```

City limits are committed in `src/data/jurisdictions.json`; regenerate them from Census TIGERweb with `pnpm run data:jurisdictions` when the Census vintage changes.

`test:unit` covers domain logic, provider adapters, hooks, components, the map wrapper (with a mocked MapLibre), and the app shell. Coverage is measured over every source file except the entry point and type declarations; thresholds are 98% lines, statements and functions and 95% branches.

`test:data` and `test:runtime` run the application's real provider code against the live publishers through `vitest.live.config.ts`. `test:data` checks every reviewed Socrata field and ArcGIS layer contract plus both OpenFreeMap styles; `test:runtime` loads a full 1 km, 30-day evidence bundle at each city's featured place and checks freshness, window bounds, and that the quietest hours fall in the early morning, which catches time-zone drift. Playwright mocks source responses so browser acceptance stays deterministic while the live jobs detect upstream drift.

## Architecture

```text
Official Socrata datasets             Official ArcGIS feature layers
            │                                       │
            └──────────── provider adapters ────────┘
                 fixed or metadata-resolved fields, paging,
                 local-clock timestamps, newest-record lookup
                                  │
                                  ▼
          loadEvidence ── window anchored to newest complete day
                       ── current window over 3r, previous over r
                                  │
                                  ▼
   analyzeIncidents ── Haversine circle and annulus, equal-window trend,
                       weighted density comparison
                                  │
                ├── MapLibre clustered GeoJSON layers
                └── responsive evidence inspector
```

```text
src/
  domain/        pure logic: geo, time, categories, analysis, evidence windows, URL state
  data/
    evidence.ts  newest record → window → parallel current/previous queries
    providers/   socrata.ts, arcgis.ts (backends), socrataCities.ts, arcgisCities.ts (city contracts)
  hooks/         useIncidentAnalysis, usePlaceSearch
  components/    map, panels, dialog; mapLayers.ts holds the map's pure helpers
live/            live contract and runtime suites against official publishers
e2e/             Playwright acceptance with deterministic source mocks
```

Socrata providers either bind a reviewed fixed schema (NYC, Chicago, San Francisco) or resolve reviewed aliases from live dataset metadata (Dallas, Los Angeles, Seattle). Shared one-off loads such as metadata and the newest-record lookup run on their own timeout, so a cancelled request can never poison them for the next caller. ArcGIS providers bind reviewed official layers, request explicit attributes, and declare whether the layer's epochs are true UTC or local wall-clock time.

A new provider must declare its publisher, machine-readable endpoint, row identity, occurrence-time semantics and time zone, settling days, geographic bounds, update cadence, known lag, and public spatial transformation. It joins the registry only after mapper tests, live contract and runtime checks, and responsive browser acceptance pass.

## Acceptance evidence

The CI workflow requires:

1. strict TypeScript checking;
2. unit and component coverage thresholds across all application source;
3. a production Vite build;
4. live official-source and MapLibre-style contracts;
5. live evidence loads through the real providers for all eleven cities;
6. Chromium acceptance at desktop and iPhone-class viewports;
7. explicit browser paths through an ArcGIS provider, a metadata-resolved Socrata provider, and a delayed publisher;
8. horizontal-overflow checks and a serious/critical axe accessibility audit;
9. retained desktop/mobile screenshots and Playwright traces as workflow artifacts.

The detailed release criteria are in [Acceptance criteria](docs/ACCEPTANCE.md).

## Provider health

`.github/workflows/provider-health.yml` runs every Monday and Thursday and can also be dispatched manually. It runs `pnpm run test:contracts`: reviewed field and layer contracts, the base-map styles, and a full evidence load through every real provider. A failing source remains a failure to investigate; the workflow does not silently drop it or substitute proxy data.

## Responsible-use notice

Published incident records are incomplete observations shaped by reporting behavior, police practices, approval workflows, and privacy transformations. A point does not identify a particular building, and a quiet historical window does not guarantee safety. Use this atlas alongside current local guidance, lighting and foot-traffic conditions, transit status, and ordinary situational awareness.

## License

MIT. Data remains subject to each source publisher’s terms and caveats.
