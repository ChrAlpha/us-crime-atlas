# Acceptance criteria

A change is release-ready only when the relevant automated gates pass and the visual evidence has been reviewed.

## Functional

- [ ] A supported featured place selects the correct local provider.
- [ ] A map click updates the analysis point and URL state.
- [ ] Place search is submitted explicitly; it does not issue per-keystroke requests.
- [ ] Radius options of 500 m, 1 km, and 2 km update the circle and analysis.
- [ ] Window options of 14, 30, 60, and 90 days update current and previous equal windows.
- [ ] At least one incident group remains active.
- [ ] Cluster and point layers render normalized incidents.
- [ ] Selecting a point or list row exposes the same underlying incident.
- [ ] Unsupported locations show a clear coverage state and no fabricated result.
- [ ] Network errors show source-specific failure text and a retry action.
- [ ] Reaching the API record limit visibly lowers confidence and warns the user.

## Data integrity

- [ ] Chicago, New York City, and San Francisco live endpoints return the required identity, date, category, latitude, and longitude fields.
- [ ] Adapter tests cover representative violent, property, and vehicle classifications.
- [ ] Invalid identifiers or coordinates are dropped.
- [ ] Circle and annulus membership use Haversine distance rather than the request bounding box.
- [ ] Current and previous windows do not overlap.
- [ ] Raw counts remain visible beside weighted comparisons.
- [ ] Provider cadence, lag, precision, and coverage caveats are visible.
- [ ] No production fallback creates synthetic incident records.

## Responsive UI and interaction

- [ ] Desktop at 1440 × 960 keeps map, explorer, and evidence inspector usable simultaneously.
- [ ] iPhone-class viewport keeps 44 px-class primary touch targets and has no horizontal overflow.
- [ ] The mobile evidence sheet supports peek, half, and full states.
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
- [ ] Axe reports no serious or critical violations outside third-party MapLibre controls/canvas.

## Automated gates

- [ ] `npm run typecheck`
- [ ] `npm run test:unit` with configured coverage thresholds
- [ ] `npm run build`
- [ ] `npm run test:data`
- [ ] `npm run test:e2e` in desktop and mobile Chromium projects

## Visual review evidence

The browser job retains:

- desktop overview screenshot;
- mobile overview screenshot;
- expanded mobile-sheet screenshot;
- Playwright HTML report;
- trace, video, and failure screenshot when a retry or failure occurs.

Review screenshots for overlap, clipped text, cramped controls, accidental red-heavy styling, unreadable map points, and mismatched light/dark surfaces before merge.
