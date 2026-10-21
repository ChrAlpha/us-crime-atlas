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
- Oakland Police Department CrimeWatch Data, Socrata dataset `ppgh-7dqv`.
- Seattle Police Department Crime Data: 2008–Present, Socrata dataset `tazs-3rd5`.
- Forty more city and county agencies in the Northeast and Midwest, South, and West, listed in [Regional expansion providers](#regional-expansion-providers).

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

The application never substitutes synthetic events. Where no local incident-level provider covers a point, it falls back, visibly, to FBI jurisdiction totals (see [Nationwide fallback](#nationwide-fallback-fbi-jurisdiction-totals)); those are never blended with, or presented as, incident evidence.

Candidate sources are deferred when the current official publication lacks usable public coordinates or the reviewed machine-readable endpoint is no longer live. Coverage count is not treated as evidence quality.

## Provider boundaries

### Stable Socrata schemas

New York City, Chicago, San Francisco, and Oakland bind a reviewed fixed field contract: explicit `$select`, day-aligned date range, coordinate bounds, a stable `date DESC, :id` sort, and bounded paging. The live contract job compares every fixed field with the dataset's published metadata, so a rename fails visibly.

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
- an explicit attribute list, including the published coordinate attributes (feature geometry is requested only from layers that publish no coordinate attributes, as WGS84 via `outSR=4326`; skipping it roughly halves response time on the slower services);
- a stable `date DESC, objectid ASC` sort with count-based paging.

Two reviewed per-layer additions handle less tidy publications: a SQL `filter` that every query (including the newest-record lookup) adds, for example one row per incident or reports only rather than calls; and, for tables, which ignore envelope geometry, a bounding box compared against the coordinate attributes inside the SQL predicate. Socrata providers accept the same kind of reviewed `filter`, so excluded rows never spend the record budget.

The health contract verifies every registered layer name and its required identity, date, category, and coordinate fields. Annual layer rollovers for Washington, DC and Detroit must be reviewed explicitly rather than guessed. Philadelphia publishes hundred-block locations, Detroit publishes nearest intersections, while Denver and Nashville coordinates are treated as approximate and rounded where needed.

### Regional expansion providers

The regional waves trade some precision for coverage: report-time instead of occurrence-time feeds, monthly or quarterly publishers, and coordinates the atlas rounds to an approximately one-hundred-meter grid wherever a feed's points look like exact geocodes. Every compromise is stated in that provider's source card. Settling days were reviewed from daily counts on 2026-10-21; "UTC" epochs are converted to the city's zone, "local clock" epochs are used as is, and "date only" rows keep midnight for windowing with no hour of day.

| City | Agency and dataset | Backend | Settling days | Time semantics | Notes |
| --- | --- | --- | ---: | --- | --- |
| Boston, MA | Boston PD, Crime Incident Reports (`Boston_Incidents_Public_v2_view/FeatureServer/0`) | ArcGIS | 1 | UTC | No address published; non-crime rows excluded |
| Hartford, CT | Hartford PD, Police Incidents (`OpenData_PublicSafety/FeatureServer/21`) | ArcGIS | 0 | Date plus published time | Published 10 days after the fact; non-NIBRS rows excluded; exact addresses generalized |
| Rochester, NY | Rochester PD, Part I Crime (`RPD/RPD_Part_I_Crime/FeatureServer/3`) | ArcGIS | 8 | UTC | Part I only; exact addresses generalized |
| Buffalo, NY | Buffalo PD, Crime Incidents, Socrata `d6g9-xbgu` | Socrata | 2 | Local clock | Part I only; exact addresses generalized |
| Cleveland, OH | Cleveland Division of Police, Crime Incidents (`Crime_Incidents_P1RMS/FeatureServer/0`) | ArcGIS | 1 | UTC | New records system from 2025-11-11 |
| Columbus, OH | Columbus Division of Police, Police Incident Reports (`Police_Incident_Reports/FeatureServer/0`) | ArcGIS | 2 | Local clock | Non-crime subjects excluded |
| Cincinnati, OH | Cincinnati PD, Reported Crime, Socrata `t9kw-3jfx` | Socrata | 2 | Local clock | Weekly; points offset by the publisher |
| Indianapolis, IN | Indianapolis Metropolitan PD, IMPD Public Data (`IMPD/IMPD_Public_Data/FeatureServer/1`) | ArcGIS | 1 | Local clock | IMPD rows only; traffic and unfounded excluded |
| Aurora, IL | Aurora PD, Police Incidents (`AuroraIL.Police_Incidents/FeatureServer/0`) | ArcGIS | 1 | UTC, report time | Broad groupings only |
| Minneapolis, MN | Minneapolis PD, Police Incidents 2026 (`Police_Incidents_2026/FeatureServer/0`) | ArcGIS | 7 | Date plus published time | Annual layer; Part I only |
| Des Moines, IA | Des Moines PD, Public Safety Data Portal (`PSDP_Crime_Layer_View/FeatureServer/0`) | ArcGIS | 0 | Report day plus hour | Deliberate 28-day delay |
| Kansas City, MO | Kansas City Missouri PD, Crime Data 2026, Socrata `f7wj-ckmw` | Socrata | 2 | Local clock | Annual dataset; per-person rows collapsed |
| Omaha, NE | Omaha PD, Police Incident Data (`Omaha_Police_Incident_Data_(View)/FeatureServer/0`) | ArcGIS | 2 | UTC, window midpoint | Sensitive groups withheld by the publisher |
| Baltimore, MD | Baltimore PD, NIBRS Group A Crime Data (`NIBRS_GroupA_Crime_Data/FeatureServer/0`) | ArcGIS | 2 | UTC | One row per victim, collapsed per case and offense; exact addresses generalized |
| Montgomery County, MD | Montgomery County PD, Crime, Socrata `icn6-v9z3` | Socrata | 4 | Local clock | Countywide, with the Rockville, Gaithersburg and Takoma Park police; non-criminal reports excluded |
| Raleigh, NC | Raleigh PD, Police Incidents (`Police_Incidents/FeatureServer/0`) | ArcGIS | 2 | Local date parts, report time | The epoch switched from UTC to local clock in September 2026, so the time is rebuilt from the local `reported_*` fields |
| Charleston, SC | Charleston PD, PDI Reported Incidents (`PDI_Reported_Incidents/FeatureServer/0`) | ArcGIS | 2 | Local date plus published hour | About two weeks behind; only three published categories |
| Charlotte, NC | Charlotte-Mecklenburg PD, CMPD Incidents (`CMPD/CMPDIncidents/MapServer/0`) | ArcGIS | 3 | Date only | Most serious offense per report; non-criminal reports excluded |
| Orlando, FL | Orlando PD, OPD Cases (`OPD_Cases_Viewing/FeatureServer/0`) | ArcGIS | 4 | Local clock, case-created time | Reviewed non-crime case types excluded; no address, labeled by neighborhood |
| Jacksonville, FL | Jacksonville Sheriff's Office, Public Transparency Data (`Public_Transparency_Data_View_10_03_2025/FeatureServer/0`) | ArcGIS | 1 | UTC | Consolidated city plus Baldwin; sexual offenses not published |
| Tampa, FL | Tampa PD, Crimes Public, Last 365 Days (`crimes_public_365days/FeatureServer/0`) | ArcGIS | 2 | Date only | Only 13 Part I offense types; nearest intersection |
| Atlanta, GA | Atlanta PD, Open Data Crime (`OpenDataWebsite_Crime_view/FeatureServer/0`) | ArcGIS | 3 | UTC | Exact addresses generalized |
| Memphis, TN | Memphis PD, Public Safety Incidents (`MPD_Public_Safety_Incidents/FeatureServer/0`) | ArcGIS | 2 | UTC | Irregular batches; points rounded by the publisher; sex and juvenile offenses omitted |
| New Orleans, LA | New Orleans PD, Calls for Service 2026, Socrata `es9j-6y5d` | Socrata | 0 | Local clock | Calls for service, not crime reports: reviewed crime call types only; annual dataset |
| Baton Rouge, LA | Baton Rouge PD, Crime Incidents, Socrata `pbin-pcm7` | Socrata | 8 | Local clock | One row per charge; violations without a NIBRS offense excluded |
| Arlington, TX | Arlington PD, Crime Data Rolling Day (`Police/PoliceExternal/MapServer/1`) | ArcGIS | 9 | UTC features, local-clock newest-record statistic | Rolling year; no address, labeled by beat |
| Berkeley, CA | Berkeley PD, BPD Transparency Hub cases (`cases_latlon/FeatureServer/0`) | ArcGIS | 2 | UTC | One row per statute |
| San Mateo, CA | San Mateo PD, PD Crime Data (`PD_Crime_Data_All/FeatureServer/1`) | ArcGIS | 3 | Date only | Quarterly; reports only; exact addresses generalized to hundred blocks |
| Sacramento, CA | Sacramento PD, Police Crime (3 Years) (`Police_Crime_3Years/FeatureServer/0`) | ArcGIS | 2 | UTC | About 14-day embargo; confidential rows have no location |
| Bakersfield, CA | Bakersfield PD, Public Crime View (`PublicCrimeView/FeatureServer/0`) | ArcGIS | 5 | Local clock | Selected serious offenses; no address |
| Riverside, CA | Riverside PD, Crimes (`View_CrimesRPD/FeatureServer/4`) | ArcGIS | 12 | Date only | Dates are record-entry dates |
| Las Vegas, NV | Las Vegas Metropolitan PD, Reported NIBRS Crimes (`Weekly_Public_Crimes/FeatureServer/0`) | ArcGIS | 9 | UTC, report time | Weekly; covers the city and unincorporated Clark County, including the Strip |
| Tucson, AZ | Tucson PD, Reported Crimes 2026 (`TPDOpenData_ReportedCrimes_2026/FeatureServer/0`) | ArcGIS | 11 | Local clock | Annual layer; one row per incident (`MaxGRC='1'`) |
| Tempe, AZ | Tempe PD, General Offenses (`General_Offenses_(Open_Data)/FeatureServer/0`) | ArcGIS | 21 | Local clock | Service calls and non-criminal codes excluded |
| Mesa, AZ | Mesa PD, Police Criminal Offenses, Socrata `t445-fism` | Socrata | 16 | Date only | Sensitive incidents have no location |
| Salt Lake City, UT | Salt Lake City PD, Public Crime at Intersections (`PublicCrime_At_Intersections/FeatureServer/0`) | ArcGIS | 0 | UTC day plus published hour | Monthly; Part I only; nearest intersection |
| Boulder, CO | Boulder PD, BPD Offenses (`BPD_Offenses/FeatureServer/0`) | ArcGIS | 5 | Local clock | About three weeks behind |
| Aurora, CO | Aurora PD, APD Transparency RMS Public View (`APD_Transparency_RMS_Public_View/FeatureServer/36`) | ArcGIS | 3 | Date only | Monthly; major offense categories only |
| Colorado Springs, CO | Colorado Springs PD, Crime Level Data, Socrata `bc88-hemr` | Socrata | 11 | Local clock | "Not a crime" rows excluded |
| Tacoma, WA | Tacoma PD, Reported Crime (`TPD_RMS_Crime/FeatureServer/0`, a table) | ArcGIS | 4 | Date plus approximate time | Publisher omits domestic violence and sex offenses; collisions excluded |

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
| Oakland | 3 | Newest three days are partial |
| Denver | 4 | First-occurrence dates keep arriving for several days |
| Seattle | 6 | Reports publish only after records approval |

Some files only begin partway through the analysis span: the NYPD year-to-date file restarts every January 1, and the Los Angeles, Washington, DC and Detroit layers start on 2026-01-01. Days before a dataset's first day are unpublished, not quiet. When the previous window reaches back before that day, the trend is withheld; when the current window does, the interface says the window is partial.

If a provider has published nothing in the last 400 days, no counts, trend or comparison are shown at all; the panel says so instead of reporting zero incidents.

The interface shows the exact dates, notes the excluded settling days, and calls out a feed whose newest record is three or more days old (for example "Feed is 113 days behind" for NYPD's quarterly release). Without this, a quarterly feed would show an empty window for months, and every daily feed's trend would be biased downward by its own reporting tail.

## Jurisdiction coverage

Each feed only contains incidents inside its own police jurisdiction, so coverage follows legal city limits rather than a rectangle. The limits come from the U.S. Census Bureau TIGERweb "Incorporated Places" layer (January 1, 2026 vintage), simplified to about 50 m, with annexed fragments smaller than about 0.02 km² dropped, and committed as `src/data/jurisdictions.json`; `pnpm run data:jurisdictions` regenerates it. Nashville and Indianapolis use the consolidated government's balance, which excludes the included cities that run their own police departments. Agencies that patrol beyond one city use a union of Census areas: Las Vegas Metropolitan Police adds the unincorporated Clark County communities around the city, including the Strip; the Jacksonville Sheriff's Office adds Baldwin; and Montgomery County, Maryland uses the whole county.

- **Choosing a provider.** A point is covered only if it lies inside a provider's limits. A neighboring city inside the same rectangle (Jersey City and Hoboken beside New York, Beverly Hills, Santa Monica and Culver City inside Los Angeles, Evanston and Oak Park beside Chicago, Hamtramck and Highland Park inside Detroit) shows the coverage state, not a falsely quiet result.
- **Covered area.** Near the limits, part of the circle or annulus has no records because it belongs to another jurisdiction or lies beyond a shoreline boundary. The share of each area inside the limits is estimated from 1,024 equal-area samples, and densities divide by the covered area only. Without this correction, a waterfront or border location reads as more active than it is. At the 1 km default, about 12% of the Times Square annulus lies in New Jersey, and about 23% of the Loop's lies on Lake Michigan.
- **Disclosure and limits.** The panel says how much of either area lies outside the limits whenever it is more than 5%. If less than 25% of either area is covered, the nearby comparison is withheld.
- **Water inside the limits.** Some cities' legal limits include open water (San Francisco Bay, New York Harbor). That water counts as covered area with no incidents, so the correction removes the bias only where the limits follow the shoreline.

## Nationwide fallback: FBI jurisdiction totals

Local incident feeds cover a few cities. Everywhere else in the 50 states and DC, the atlas shows coarser evidence rather than nothing.

### Source

The FBI Crime Data Explorer's summarized offenses known to law enforcement: monthly violent and property offense counts per reporting agency, combining SRS submissions and summarized NIBRS, with the population the FBI assigns to each agency. The Explorer sends no CORS headers, so `scripts/fetch-agency-stats.mjs` takes a snapshot of every city and county agency (about 15,000) and commits it per state in `src/data/agencyStats/`. Each state's file loads only when a point in that state needs it.

Agencies submit on their own schedules. The snapshot therefore ends three months before the Explorer's refresh month (two months before a mid-October refresh, Texas had reported only about three quarters of a normal month), and each agency's twelve-month window ends at its own newest reported month. Trailing zero months from an agency that normally reports ten or more offenses a month are treated as unsubmitted, not quiet.

### Matching a point to an agency

1. Census TIGERweb returns the incorporated place and the county subdivision containing the point (the subdivision's GEOID also identifies the state and county).
2. The place's own police agency is used when one was matched.
3. Otherwise the town or township agency of the county subdivision (New England towns, Mid-Atlantic and Midwest townships).
4. Otherwise the county agency: the county sheriff or county police serving the most residents, with reviewed overrides where a city agency patrols unincorporated land (Las Vegas Metropolitan Police for unincorporated Clark County, including the Strip; Honolulu Police for the City and County of Honolulu).
5. If the point lies inside a city that has no matched agency of its own (for example a city that contracts with the sheriff), the county agency's totals are shown with a note that they may not include the city.
6. If no agency matches, or the matched agency submitted nothing, only the statewide rate is shown, as context.

Agencies are matched to Census places and county subdivisions by normalized name within the state ("St." and "Saint", "Mt." and "Mount", suffixes such as "Police Department" or "Township"), consolidated-government names ("Nashville-Davidson", "Louisville/Jefferson County"), and parenthetical alternates ("San Buenaventura (Ventura)"). Ambiguous names are resolved by the agency's county, then by distance from its listed location. When several agencies claim one area, the one serving the most residents is kept. The generator reports the share of reporting population that was matched and lists the largest unmatched agencies.

### What the panel shows

- Violent and property offense counts over the agency's newest twelve reported months.
- Rates per 100,000 residents, annualized when fewer than twelve months were submitted (at least six are required).
- The state's rate over the same months (from the Explorer's rates per 100,000 residents of reporting agencies), and the ratio to it, banded with the local comparison's thresholds.
- The change from the previous twelve months, only when both windows are complete.
- Monthly totals, with unreported months marked.

### Limitations specific to the fallback

- A jurisdiction-wide rate cannot tell one neighborhood from another; a downtown hotel and a quiet suburb in the same city get the same figures.
- Resident population is a poor denominator for downtowns, airports and tourist districts, so central-city rates read high relative to their state.
- Cities are compared with their state, which includes rural areas with lower rates.
- Agencies that report late, skip months, or serve few residents are called out, but their figures remain less reliable.
- Name matching can miss agencies whose names differ from their Census place, and some places (for example census-designated places with police districts) are not matched at all.

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

Display bands:

- below `0.65×`: lower reported activity;
- `0.65×` to below `1.25×`: similar to nearby;
- `1.25×` to below `2×`: elevated reported activity;
- `2×` or above: markedly elevated reported activity;
- fewer than five current selected-plus-nearby observations, or no usable nearby denominator: not enough evidence;
- a truncated comparison query, or less than 25% of either area inside the jurisdiction: comparison withheld.

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
