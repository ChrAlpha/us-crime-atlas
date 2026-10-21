# Data methodology

## Design objective

US Crime Atlas answers a narrow question:

> What do recently published official incident records show around this travel area, and how does that observation compare with the immediately surrounding area?

It does not claim to estimate the probability that a particular traveler will be harmed. The product uses “reported activity” and “observed evidence,” never an absolute neighborhood safety grade.

## Source hierarchy and current coverage

The application uses incident-level publications from local law-enforcement agencies. The current release covers:

- New York City Police Department Complaint Data Current (YTD), Socrata dataset `5uac-w243`.
- Metropolitan Police Department of the District of Columbia Crime Incidents - 2026, official ArcGIS Feature Layer `FEEDS/MPD/FeatureServer/41`.
- Philadelphia Police Department Crime Incidents 2006 to Present, official ArcGIS Feature Layer `INCIDENTS_PART1_PART2/FeatureServer/0`.
- Chicago Police Department Crimes — 2001 to Present, Socrata dataset `ijzp-q8t2`.
- Detroit Police Department RMS Crime Incidents 2026, official ArcGIS Feature Layer `RMS_Crime_Incidents_2026/FeatureServer/0`.
- Metropolitan Nashville Police Department Incidents, official ArcGIS Feature Layer `Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0`.
- Dallas Police Department Police Incidents, Socrata dataset `qv6i-rri7`.
- Denver Police Department Crime Offenses, official ArcGIS Feature Layer `ODC_CRIME_OFFENSES_P/FeatureServer/324`.
- Los Angeles Police Department NIBRS Offenses Dataset 2026 to Present, Socrata dataset `k7nn-b2ep`.
- San Francisco Police Department Incident Reports — 2018 to Present, Socrata dataset `wg3w-h783`.
- Seattle Police Department Crime Data: 2008–Present, Socrata dataset `tazs-3rd5`.

Each provider declares:

- the agency and dataset name;
- the endpoint and official landing page;
- geographic bounds and, through `scripts/fetch-jurisdictions.mjs`, the Census place GEOID of its jurisdiction;
- occurrence/report date semantics and the publisher's IANA time zone;
- publication cadence and known lag;
- settling days: how many of the newest published days are still filling in;
- public location precision;
- coverage caveats;
- the date on which the field contract was last verified.

The application does not substitute synthetic events, a citywide aggregate, or a national average when a local incident-level provider is unavailable.

Candidate sources are deferred when the current official publication lacks usable public coordinates or the reviewed machine-readable endpoint is no longer live. Coverage count is not treated as evidence quality.

## Provider boundaries

### Stable Socrata schemas

New York City, Chicago, and San Francisco bind a reviewed fixed field contract: explicit `$select`, day-aligned date range, coordinate bounds, a stable `date DESC, :id` sort, and bounded paging. The live contract job compares every fixed field with the dataset's published metadata, so a rename fails visibly.

### Adaptive Socrata schemas

Dallas, Los Angeles, and Seattle use the adaptive Socrata boundary:

1. Fetch the official dataset metadata from `/api/views/{dataset-id}`.
2. Resolve each semantic role—identity, occurrence date, offense, and geometry—from a documented ordered alias list.
3. Accept geometry only as an explicit latitude/longitude pair or an explicitly named Socrata Point field.
4. Fail closed when a required semantic role cannot be resolved.
5. Build the bounded query only from resolved fields.
6. Preserve the resolved source category and description on every normalized incident.

The alias mechanism handles publisher field renames that retain an explicitly reviewed synonym. It does not guess arbitrary columns or silently accept a semantically different replacement.

Seattle publishes latitude and longitude as text and uses privacy placeholders such as `REDACTED` and `-`. Because the registered Seattle bounds remain inside fixed latitude and longitude degree bands, its query excludes those placeholders and applies sign-aware textual bounds. Coordinates are then parsed numerically and exact Haversine filtering remains authoritative. Rows with nonnumeric, sentinel, zero, or out-of-range coordinates are rejected after retrieval.

Dallas publishes its occurrence date as text (`2026-10-19 00:00:00.0000000`). Because every window boundary is midnight, the query uses date-only literals (`'2026-10-19'`), which compare correctly against both text and floating-timestamp columns.

Dallas uses the official public geocoded point attached to each RMS offense row, then rounds it to an approximately one-hundred-meter grid and generalizes a leading house number to its hundred block. The interface therefore does not present the source row as a specific premises.

### ArcGIS Feature Service

Washington, DC, Philadelphia, Detroit, Denver, and Nashville use reviewed official layers directly rather than selecting similarly titled public items heuristically. Each provider queries its layer using:

- a SQL timestamp occurrence-date predicate, padded by a day on each side because layers compare literals in different reference zones (the exact window is applied client-side);
- an `esriGeometryEnvelope` around the analysis request with a WGS84 input reference;
- an explicit attribute list, including the published coordinate attributes (feature geometry is not requested; it roughly halves response time on the slower services);
- a stable `date DESC, objectid ASC` sort with count-based paging.

The health contract verifies every registered layer name and its required identity, date, category, and coordinate fields. Annual layer rollovers for Washington, DC and Detroit must be reviewed explicitly rather than guessed. Philadelphia publishes hundred-block locations, Detroit publishes nearest intersections, while Denver and Nashville coordinates are treated as approximate and rounded where needed.

## Evidence windows

Every analysis uses two equal, non-overlapping, day-aligned windows:

- **Current window:** the selected number of days ending at the window end.
- **Previous window:** the immediately preceding window of the same length.

The window end is not "now". The provider is first asked for its newest published occurrence (bounded to the last 400 days). The window ends at midnight after that record's day, minus the provider's reviewed settling days, and never later than today:

```text
window end = start of (newest record day + 1) − settlingDays
```

Settling days were reviewed from citywide daily counts on 2026-10-21:

| Provider | Settling days | Observation |
| --- | ---: | --- |
| New York City | 0 | Quarterly batch is complete when released |
| Chicago, Los Angeles, Philadelphia | 1 | Newest day is partial |
| Washington, DC, Detroit, Nashville, Dallas, San Francisco | 2 | Newest two days are partial |
| Denver | 4 | First-occurrence dates keep arriving for several days |
| Seattle | 6 | Reports publish only after records approval |

Some files only begin partway through the analysis span: the NYPD year-to-date file restarts every January 1, and the Los Angeles, Washington, DC and Detroit layers start on 2026-01-01. Days before a dataset's first day are unpublished, not quiet. When the previous window reaches back before that day, the trend is withheld; when the current window does, the interface says the window is partial.

If a provider has published nothing in the last 400 days, no counts, trend or comparison are shown at all; the panel says so instead of reporting zero incidents.

The interface shows the exact dates, notes the excluded settling days, and calls out a feed whose newest record is three or more days old (for example "Feed is 113 days behind" for NYPD's quarterly release). Without this, a quarterly feed would show an empty window for months, and every daily feed's trend would be biased downward by its own reporting tail.

## Jurisdiction coverage

Each feed only contains incidents inside its own police jurisdiction, so coverage follows legal city limits rather than a rectangle. The limits come from the U.S. Census Bureau TIGERweb "Incorporated Places" layer (January 1, 2026 vintage), simplified to about 20 m and committed as `src/data/jurisdictions.json`; `pnpm run data:jurisdictions` regenerates it. Nashville uses the consolidated government's balance, which excludes the satellite cities that run their own police departments.

- **Choosing a provider.** A point is covered only if it lies inside a provider's limits. A neighboring city inside the same rectangle (Jersey City and Hoboken beside New York, Beverly Hills, Santa Monica and Culver City inside Los Angeles, Evanston and Oak Park beside Chicago, Hamtramck and Highland Park inside Detroit) shows the coverage state, not a falsely quiet result.
- **Covered area.** Near the limits, part of the circle or annulus has no records because it belongs to another jurisdiction or lies beyond a shoreline boundary. The share of each area inside the limits is estimated from 1,024 equal-area samples, and densities divide by the covered area only. Without this correction, a waterfront or border location reads as more active than it is. At the 1 km default, about 12% of the Times Square annulus lies in New Jersey, and about 23% of the Loop's lies on Lake Michigan.
- **Disclosure and limits.** The panel says how much of either area lies outside the limits whenever it is more than 5%. If less than 25% of either area is covered, the nearby comparison is withheld.
- **Water inside the limits.** Some cities' legal limits include open water (San Francisco Bay, New York Harbor). That water counts as covered area with no incidents, so the correction removes the bias only where the limits follow the shoreline.

## Query geometry and record limits

For a selected radius `r`, two provider requests run in parallel:

- the **comparison query:** the current window across an envelope covering `3r`, so it holds both the selected circle and the nearby annulus;
- the **previous window** across an envelope covering `r`, because only the selected circle is compared over time.

Each request has its own record budget. It asks the service for a count alongside its first page, then fetches exactly the remaining pages in parallel: up to 4 × 5,000 rows for Socrata and 5 × 2,000 rows for ArcGIS. Washington, DC uses 10 × 1,000, because some of its load-balanced servers serve no more than 1,000 rows per page; the live contract checks each layer's advertised page size against the size the client requests. A request is marked truncated when its count exceeds the budget, or when fewer rows arrive than the count promised (for example, a service that serves smaller pages than requested). Rows are ordered newest first, so truncation drops the oldest rows of that window.

The busy annulus can exhaust the comparison query's budget before the selected circle is complete. When that happens, a third request fetches the selected circle's current window on its own budget, and each consequence is reported separately:

| Truncated request | Effect |
| --- | --- |
| Comparison query only | The nearby comparison is withheld (its density would be understated); selected-area counts and the trend remain exact |
| Selected circle, current or previous window | Counts are shown as lower bounds (`120+`) and the trend is withheld |
| Any | Evidence confidence is forced to low and a warning names the record limit |

Exact Haversine distance is then calculated client-side:

- **Selected area:** distance `≤ r`.
- **Nearby comparator:** distance `> r` and `≤ 3r`.

Bounding-box or envelope queries are used for broad portal compatibility. The circle and annulus, and the exact half-open time windows, are applied after normalization, so corner records and padded dates do not enter the analysis.

## Category normalization

Provider-specific offense strings are mapped to a compact common vocabulary:

| Normalized category | Examples from source strings | Group |
| --- | --- | --- |
| Homicide | murder, manslaughter | Violent |
| Sexual offense | rape, sexual abuse, indecent offense | Violent |
| Robbery | robbery, carjacking | Violent |
| Assault | assault, battery, aggravated assault | Violent |
| Burglary | burglary, breaking and entering | Property |
| Theft | larceny, shoplifting, pickpocket | Property |
| Vehicle theft | motor-vehicle theft, grand larceny auto | Vehicle |
| Weapons | weapon violation, firearm offense | Weapons |
| Other | unmatched published categories | Other |

The raw source category and description remain attached to each incident for inspection. The cross-city vocabulary is a display normalization layer, not a claim that local legal classifications are identical.

## Severity weighting

The nearby comparison uses explicit category weights so high-volume theft does not numerically overwhelm rarer violent reports:

| Category | Weight |
| --- | ---: |
| Homicide | 5.0 |
| Sexual offense | 4.5 |
| Robbery | 4.0 |
| Assault | 3.7 |
| Weapons | 3.4 |
| Burglary | 2.5 |
| Vehicle theft | 2.1 |
| Theft | 1.3 |
| Other | 1.0 |

These are product-level salience weights, not claims about legal severity, monetary loss, or individual victim harm. Raw incident counts, category composition, violent share, and nighttime share are shown independently.

## Relative activity

Let:

- `Wᵢ` be the sum of category weights in the selected circle;
- `Aᵢ = πr² × cᵢ` be its area inside the jurisdiction, where `cᵢ` is the covered share;
- `Wₒ` be the weighted sum in the nearby annulus;
- `Aₒ = (π(3r)² - πr²) × cₒ` be the annulus area inside the jurisdiction.

Then:

```text
selected density = Wᵢ / Aᵢ
nearby density   = Wₒ / Aₒ
relative activity = selected density / nearby density
```

Display bands, with the label the panel uses:

- below `0.65×`: lower reported activity ("Lower");
- `0.65×` to below `1.25×`: similar to nearby ("Similar");
- `1.25×` to below `2×`: elevated reported activity ("Higher");
- `2×` or above: markedly elevated reported activity ("Much higher");
- fewer than five current selected-plus-nearby observations, or no usable nearby denominator: not enough evidence;
- a truncated comparison query, or less than 25% of either area inside the jurisdiction: comparison withheld.

The panel leads with the result in plain words, such as "62% fewer reports per km² than the surrounding area", "About as many reports per km² as the surrounding area", or "4.9× as many reports per km² as the surrounding area", and marks it on a logarithmic scale from `0.25×` to `4×` with the four bands above. It never turns the ratio into a safety score or rating.

Evidence confidence is based on current selected-plus-nearby sample size and is forced to low when any upstream query reaches its record limit. A truncated comparison query withholds the comparison entirely rather than reporting an inflated ratio.

## Time handling

Every normalized incident carries the publisher's local wall-clock time (`occurredAt`, zone-free) and that same wall-clock time encoded as if it were UTC (`occurredAtEpochMs`). All providers therefore share one comparable local-clock frame, independent of the viewer's browser zone, and "now" is converted into each provider's zone before windows are computed.

- **Socrata** publishes zone-free floating timestamps (or text dates), which are already local wall-clock time.
- **ArcGIS** publishes epoch milliseconds, whose meaning differs by layer. This was verified against each layer's own text date/time fields and hourly distributions on 2026-10-21:

| Layer | Epoch semantics | Conversion |
| --- | --- | --- |
| Washington, DC, Detroit, Nashville | True UTC instants | Converted to the city's IANA zone, DST-aware |
| Philadelphia, Denver | Local wall-clock time stored as UTC | Used as is |

The live runtime suite checks that the quietest three hours of each city's sample fall between 01:00 and 10:00 local time, which fails loudly if a publisher changes its time semantics.

Nighttime is defined as 10:00 PM through 4:59 AM local time. Some records carry a date but no time of day; they still count toward totals, but are excluded from the nighttime share's numerator and denominator, and the interface says how many there are.

## Identity and duplicate semantics

Whenever the publisher exposes a stable complaint, report, offense, or object identifier, it is namespaced by provider. Seattle combines offense and report identifiers because one report can contain multiple offenses.

A normalized row is still not guaranteed to equal one victim or one underlying event. Local portals differ in whether a row represents a complaint, offense, victim, report, or later administrative revision.

## Spatial precision

Every public coordinate is treated as approximate unless a provider explicitly documents otherwise. Current transformations include block midpoints, one-hundred-block locations, shifted blocks, nearby intersections, generalized blocks, and approximate report coordinates.

Map popovers and source notes state the precision. The UI must not imply that a point identifies a particular business, hotel, residence, or person.

## Live contracts and health monitoring

The live checks run the application's real provider code through `vitest.live.config.ts`, so they cannot drift from what the browser does.

`pnpm run test:data` compares every reviewed Socrata field (fixed or alias-resolved) with live dataset metadata, verifies each ArcGIS layer's reviewed name, date field type, and requested attributes, and validates both OpenFreeMap styles.

`pnpm run test:runtime` loads a full 1 km, 30-day evidence bundle at each city's featured place. It requires a newest record within 200 days, no truncated request, a non-empty result inside the computed windows and comparison area, and early-morning quiet hours. The contract suite also checks that every ArcGIS layer serves pages at least as large as the client requests.

The scheduled provider-health workflow runs `pnpm run test:contracts` (both suites) every Monday and Thursday. A contract failure must be investigated against the official publisher; it must not be suppressed merely to keep a green badge.

## Known limitations

1. **Underreporting and differential reporting.** Not every event is reported, and the probability of reporting differs by offense and community.
2. **Police-practice effects.** Enforcement deployment and classification practices affect observed records.
3. **Publication delay.** Windows end at the newest complete published day, which can be weeks or months before today. Settling days reduce, but cannot remove, the bias from reports that arrive late.
4. **Preliminary records.** Categories and outcomes can change after review.
5. **Duplicate or multi-offense structure.** A complaint or incident can contain more than one underlying offense; local row semantics differ.
6. **Cross-city comparability.** Normalized labels do not remove differences in statutes, agency coding rules, reporting systems, or publication exclusions.
7. **Activity denominator.** Covered area is a transparent comparator but does not measure pedestrians, riders, visitors, or time spent at risk. Parks, rail yards and water inside city limits count as area with few or no incidents.
8. **Small samples.** Short windows and small radii can be unstable even when the UI labels confidence low.
9. **Environmental conditions.** Lighting, crowding, special events, weather, service disruptions, and time of day can matter more than a historical aggregate.
10. **Other agencies inside city limits.** Federal parkland (for example the National Mall, patrolled by the U.S. Park Police), campuses, airports and transit systems can be policed by agencies whose incidents are not in the city feed, so those areas can read as quieter than they are.
11. **Portal availability.** A public API can be rate-limited, moved, revised, or temporarily unavailable despite passing the last health check.

## Adding a provider

A provider should not be added until all of the following are documented and tested:

- official publisher and landing page;
- stable machine-readable endpoint or reviewed official layer-resolution rule;
- occurrence/report date semantics;
- row identity semantics;
- category and description fields;
- usable coordinates and documented privacy transformation;
- update cadence, expected lag, and reviewed settling days;
- publisher time zone and, for ArcGIS, epoch semantics;
- geographic bounds and, through `scripts/fetch-jurisdictions.mjs`, the Census place GEOID of its jurisdiction;
- a live contract test for required semantics;
- a live runtime evidence load;
- mapper unit tests for representative and invalid rows;
- deterministic browser coverage for every newly introduced backend family;
- a source card with plain-language caveats.
