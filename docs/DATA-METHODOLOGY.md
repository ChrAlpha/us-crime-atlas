# Data methodology

## Design objective

US Crime Atlas answers a narrow question:

> What do recently published official incident records show around this travel area, and how does that observation compare with the immediately surrounding area?

It does not claim to estimate the probability that a particular traveler will be harmed. The distinction is reflected in the UI: the product uses “reported activity” and “observed evidence,” never an absolute neighborhood safety grade.

## Source hierarchy and current coverage

The application uses incident-level publications from local law-enforcement agencies. The first nationwide expansion wave covers:

- New York City Police Department Complaint Data Current (YTD), Socrata dataset `5uac-w243`.
- Metropolitan Police Department of the District of Columbia current-year Crime Incidents layer, official ArcGIS Feature Service resolved through the DCGIS catalog.
- Baltimore Police Department Part 1 Crime Data, Socrata dataset `wsfq-mvij`.
- Chicago Police Department Crimes — 2001 to Present, Socrata dataset `ijzp-q8t2`.
- Metropolitan Nashville Police Department Incidents, Socrata dataset `2u6v-ujjs`.
- Austin Police Department Crime Reports, Socrata dataset `fdj4-gpfu`.
- Los Angeles Police Department Crime Data from 2020 to Present, Socrata dataset `2nrs-mtv8`.
- San Francisco Police Department Incident Reports — 2018 to Present, Socrata dataset `wg3w-h783`.
- Seattle Police Department Crime Data: 2008–Present, Socrata dataset `tazs-3rd5`.

Each provider declares:

- the agency and dataset name;
- the endpoint and official landing page;
- geographic bounds;
- occurrence/report date semantics;
- publication cadence and known lag;
- public location precision;
- coverage caveats;
- the date on which the field contract was last verified.

The application does not substitute synthetic events, a citywide aggregate, or a national average when a local incident-level provider is unavailable.

## Provider boundaries

### Socrata

Legacy providers with stable schemas use an explicit `$select`, date range, coordinate bounds, sort order, and record limit. New expansion providers use the adaptive Socrata boundary:

1. Fetch the official dataset metadata from `/api/views/{dataset-id}`.
2. Resolve each semantic role—identity, occurrence date, offense, and geometry—from a documented ordered alias list.
3. Accept geometry only as an explicit latitude/longitude pair or an explicitly named Socrata Point field.
4. Fail closed when a required semantic role cannot be resolved.
5. Build the bounded query only from resolved fields.
6. Preserve the resolved source category and description on every normalized incident.

The alias mechanism handles publisher field renames that retain an explicitly reviewed synonym. It does not guess arbitrary columns or silently accept a semantically different replacement.

### ArcGIS Feature Service

The Washington, DC provider resolves the current-year Crime Incidents service through the official DCGIS ArcGIS catalog. It then queries the feature layer using:

- a SQL timestamp occurrence-date predicate;
- an `esriGeometryEnvelope` around the analysis request;
- WGS84 input and output spatial references;
- publisher attributes plus returned feature geometry;
- a fixed result limit and explicit `exceededTransferLimit` handling.

Catalog resolution is cached for the session but retried after a failed lookup. The provider fails rather than falling back to a similarly titled unofficial item.

## Query geometry

For a selected radius `r`, the provider receives a bounding request covering `3r`. Exact Haversine distance is then calculated client-side.

The analysis divides observations into:

- **Selected area:** distance `≤ r`.
- **Nearby comparator:** distance `> r` and `≤ 3r`.
- **Current window:** the selected number of days ending now.
- **Previous window:** the immediately preceding equal-duration window.

Bounding-box or envelope queries are used for broad portal compatibility. The circle and annulus are applied after normalization, so corner records from the request envelope do not enter the analysis.

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
- `Aᵢ = πr²` be its area;
- `Wₒ` be the weighted sum in the nearby annulus;
- `Aₒ = π(3r)² - πr²` be the annulus area.

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
- fewer than five current selected-plus-nearby observations, or no usable nearby denominator: not enough evidence.

Evidence confidence is based on current selected-plus-nearby sample size and is forced to low when the upstream query reaches its record limit.

## Time handling

Many local portals publish timezone-free local timestamps. Socrata adapters preserve the source timestamp for display and extract the published local hour for the nighttime metric. A consistent pseudo-UTC epoch is used for equal-window filtering. This avoids applying the viewer’s browser timezone to the source’s local clock, but window boundaries can differ from true local civil time by several hours.

ArcGIS epoch attributes are converted to ISO timestamps after the service applies the timestamp predicate. Publishers may encode local civil time or UTC differently; the provider caveat and raw source remain authoritative.

Nighttime is defined as 10:00 PM through 4:59 AM in the normalized source timestamp.

## Identity and duplicate semantics

Whenever the publisher exposes a stable complaint, report, offense, or object identifier, it is namespaced by provider. A compound key is used when the source separates incident and offense identifiers. Baltimore’s adapter can derive a deterministic fallback from occurrence time, offense code, coordinates, and published category when a stable row identifier is absent.

A normalized row is still not guaranteed to equal one victim or one underlying event. Local portals differ in whether a row represents a complaint, offense, victim, report, or later administrative revision.

## Spatial precision

Every public coordinate is treated as approximate unless a provider explicitly documents otherwise. Current transformations include block midpoints, 100-block locations, shifted blocks, nearby intersections, generalized blocks, and approximate report coordinates.

Map popovers and source notes state the precision. The UI must not imply that a point identifies a particular business, hotel, residence, or person.

## Live contracts and health monitoring

`npm run test:data` checks all nine sources and the base-map style. For Socrata sources it verifies metadata alias resolution and requests one geocoded record using only resolved columns. This distinguishes a true schema removal from a normal sparse JSON row in which an optional value is null and therefore omitted.

For Washington, DC it resolves the official current-year catalog item, inspects layer fields, and requests one WGS84 feature. The scheduled provider-health workflow runs every Monday and Thursday. A contract failure must be investigated against the official publisher; it must not be suppressed merely to keep a green badge.

## Known limitations

1. **Underreporting and differential reporting.** Not every event is reported, and the probability of reporting differs by offense and community.
2. **Police-practice effects.** Enforcement deployment and classification practices affect observed records.
3. **Publication delay.** A current date range does not make the underlying portal real-time.
4. **Preliminary records.** Categories and outcomes can change after review.
5. **Duplicate or multi-offense structure.** A complaint or incident can contain more than one underlying offense; local row semantics differ.
6. **Cross-city comparability.** Normalized labels do not remove differences in statutes, agency coding rules, reporting systems, or publication exclusions.
7. **Activity denominator.** Nearby land area is a transparent comparator but does not measure pedestrians, riders, visitors, or time spent at risk.
8. **Small samples.** Short windows and small radii can be unstable even when the UI labels confidence low.
9. **Environmental conditions.** Lighting, crowding, special events, weather, service disruptions, and time of day can matter more than a historical aggregate.
10. **Portal availability.** A public API can be rate-limited, moved, revised, or temporarily unavailable despite passing the last health check.

## Adding a provider

A provider should not be added until all of the following are documented and tested:

- official publisher and landing page;
- stable machine-readable endpoint or official catalog resolution rule;
- occurrence/report date semantics;
- row identity semantics;
- category and description fields;
- usable coordinates and documented privacy transformation;
- update cadence and expected lag;
- geographic bounds;
- a live contract test for required semantics;
- mapper unit tests for representative and invalid rows;
- deterministic browser coverage for every newly introduced backend family;
- a source card with plain-language caveats.
