# Acceptance criteria

A change is release-ready only when the relevant automated gates pass and the visual evidence has been reviewed.

## Functional

- [ ] A supported featured place selects the correct local provider.
- [ ] All eleven registered provider bounds resolve to the intended agency and do not overlap an unrelated city.
- [ ] A map click updates the analysis point and URL state.
- [ ] Place search is submitted explicitly; it does not issue per-keystroke requests.
- [ ] Radius options of 500 m, 1 km, and 2 km update the circle and analysis.
- [ ] Window options of 14, 30, 60, and 90 days update current and previous equal windows.
- [ ] Windows end at the provider's newest published day minus its settling days, never later than today, and the exact dates are shown.
- [ ] A publisher whose newest record is three or more days old shows a delayed-feed notice instead of an empty or quiet-looking window.
- [ ] Shared coordinates without a place name are labeled "Dropped pin", not a featured place.
- [ ] At least one incident group remains active.
- [ ] Cluster and point layers render normalized incidents.
- [ ] Selecting a point or list row exposes the same underlying incident.
- [ ] Unsupported locations show a clear coverage state and no fabricated result, including neighboring cities inside a provider's bounding box.
- [ ] Analysis areas that cross city limits use only the covered area in densities and disclose the uncovered share; under 25% coverage withholds the comparison.
- [ ] Network errors show source-specific failure text and a retry action.
- [ ] The production bundle, served under the Pages subpath, loads every asset and starts the MapLibre worker (`pnpm run test:e2e:production`).
- [ ] Reaching a request's record budget visibly lowers confidence and warns the user; affected selected-area counts read as lower bounds (`N+`) and the trend or nearby comparison is withheld rather than understated.
- [ ] A feed with no records in the last 400 days shows a no-records state, never zero counts.
- [ ] A window that starts before a dataset's first day is called out, and a previous window that does so withholds the trend.
- [ ] Changing place or filters quickly never leaves a cancelled request's failure on screen, and never shows a previous place's numbers for the new place.

## Data integrity

- [ ] All eleven live city endpoints resolve the required identity, date, category, and geometry semantics through the real provider code.
- [ ] ArcGIS epochs are interpreted per layer (true UTC versus local wall-clock), and each city's quietest hours fall in the early morning.
- [ ] Current and previous windows use separate, paged requests; if the wider comparison request is truncated, the selected circle's current window is re-fetched on its own budget.
- [ ] Adaptive Socrata providers resolve only explicitly reviewed aliases from official dataset metadata.
- [ ] A missing required Socrata semantic fails closed rather than guessing another column.
- [ ] Socrata providers support either a reviewed latitude/longitude pair or a reviewed Point field.
- [ ] Text-valued coordinates exclude documented privacy placeholders, use fixed-degree textual bounds, and are parsed numerically before exact Haversine filtering.
- [ ] Every ArcGIS city uses a reviewed official Feature Layer and verifies its layer name and required fields.
- [ ] Counts beyond a request's paging budget, or pages shorter than the count promised, are surfaced as truncated evidence.
- [ ] Adapter tests cover representative violent, property, vehicle, and weapons classifications across both backend families.
- [ ] Invalid identifiers, dates, zero coordinates, sentinel coordinates, and out-of-range coordinates are dropped.
- [ ] Compound row identities are deterministic and provider-namespaced.
- [ ] Circle and annulus membership use Haversine distance rather than the request envelope.
- [ ] Current and previous windows do not overlap.
- [ ] Raw counts remain visible beside weighted comparisons.
- [ ] Provider cadence, lag, precision, and coverage caveats are visible.
- [ ] No production fallback creates synthetic incident records or substitutes a citywide/national proxy.
- [ ] A candidate source without usable public coordinates or a live reviewed endpoint is not registered merely to increase the city count.

## Responsive UI and interaction

- [ ] Desktop at 1440 × 960 keeps map, explorer, and evidence inspector usable simultaneously.
- [ ] The eleven-place featured strip remains usable without page-level overflow.
- [ ] The source dialog remains usable with eleven provider cards at desktop, tablet, and mobile widths.
- [ ] iPhone-class viewport keeps 44 px-class primary touch targets and has no horizontal overflow.
- [ ] The mobile layout keeps the map and evidence in one readable document flow, with collapsible analysis settings.
- [ ] Search and analysis controls remain reachable without trapping page scroll.
- [ ] Safe-area insets are respected.
- [ ] Light and dark themes preserve semantic incident colors and readable surfaces.
- [ ] Reduced-motion preference disables nonessential transitions and animations.

## Accessibility

- [ ] Search has a programmatic label and submit control.
- [ ] Toggle states expose `aria-pressed` or `aria-expanded`.
- [ ] Loading, error, and update states are announced.
- [ ] Dialog has a name, modal semantics, Escape close behavior, and an explicit close button.
- [ ] Keyboard focus is visible.
- [ ] Provider cards and official-source links have distinct accessible names.
- [ ] Axe reports no serious or critical violations outside third-party MapLibre controls/canvas.

## Automated gates

- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:unit` with coverage thresholds over all application source (98% lines/statements/functions, 95% branches)
- [ ] `pnpm run build`
- [ ] `pnpm run test:data` across all eleven official city contracts and both base-map styles
- [ ] `pnpm run test:runtime` loading live evidence through all eleven real providers
- [ ] `pnpm run test:e2e` in desktop, tablet, and mobile Chromium projects
- [ ] Browser acceptance explicitly exercises a fixed Socrata, a metadata-resolved Socrata, an ArcGIS, and a delayed provider
- [ ] Scheduled `.github/workflows/provider-health.yml` can run manually and is configured for twice-weekly checks

## Visual review evidence

The browser job retains:

- a full-page overview screenshot for each browser project (`<project>-overview.png`) and the mobile document-flow screenshot (`mobile-chromium-expanded.png`);
- viewport screenshots for each project from `e2e/visual.spec.ts`: light and dark themes, controls, the sources dialog and its methodology section, source failure, unsupported place, a selected report, map failure, map loading, and the mobile guardrail toast (`<project>-viewport-*.png`);
- Playwright HTML report;
- trace, video, and failure screenshot when a retry or failure occurs.

Review screenshots for overlap, clipped text, cramped controls, accidental red-heavy styling, unreadable map points, featured-place truncation, source-card density, and mismatched light/dark surfaces before merge.
