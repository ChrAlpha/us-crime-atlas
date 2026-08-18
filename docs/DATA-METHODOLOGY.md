# Data methodology

## Design objective

US Crime Atlas answers a narrow question:

> What do recently published official incident records show around this travel area, and how does that observation compare with the immediately surrounding area?

It does not claim to estimate the probability that a particular traveler will be harmed. The distinction is reflected in the UI: the product uses “reported activity” and “observed evidence,” never an absolute neighborhood safety grade.

## Source hierarchy

The first release uses incident-level portals published by local law-enforcement agencies:

- New York City Police Department Complaint Data Current (YTD), Socrata dataset `5uac-w243`.
- Chicago Police Department Crimes — 2001 to Present, Socrata dataset `ijzp-q8t2`.
- San Francisco Police Department Incident Reports — 2018 to Present, Socrata dataset `wg3w-h783`.

Each adapter declares:

- the agency and dataset name;
- the endpoint and official landing page;
- geographic bounds;
- publication cadence and known lag;
- public location precision;
- coverage caveats;
- the date on which the field contract was last verified.

The application does not substitute synthetic events or a national city-level average when a local provider is unavailable.

## Query geometry

For a selected radius `r`, the client requests a bounding box that covers `3r`. Exact Haversine distance is then calculated client-side.

The analysis divides observations into:

- **Selected area:** distance `≤ r`.
- **Nearby comparator:** distance `> r` and `≤ 3r`.
- **Current window:** the selected number of days ending now.
- **Previous window:** the immediately preceding equal-duration window.

A bounding-box API query is used for broad compatibility across Socrata datasets. The circle and annulus are applied after normalization, so corner records from the bounding box do not enter the analysis.

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

The raw source category and description remain attached to each incident for inspection.

## Severity weighting

The nearby comparison uses explicit category weights so high-volume theft does not numerically overwhelm rare violent reports:

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

Local portals publish timezone-free local timestamps. The adapter preserves the source timestamp for display and extracts the published local hour for the nighttime metric. A consistent pseudo-UTC epoch is used for equal-window filtering. This avoids applying the viewer’s browser timezone to the source’s local clock, but window boundaries can differ from true local civil time by several hours.

Nighttime is defined as 10:00 PM through 4:59 AM in the source timestamp.

## Spatial precision

The product treats every public coordinate as approximate unless a provider explicitly documents otherwise:

- Chicago records are shifted and published at block level.
- New York records identify a block midpoint.
- San Francisco records are remapped to a nearby intersection.

Map popovers and source notes state the precision. The UI must not imply that a point identifies a particular business, hotel, residence, or person.

## Known limitations

1. **Underreporting and differential reporting.** Not every event is reported, and the probability of reporting differs by offense and community.
2. **Police-practice effects.** Enforcement deployment and classification practices affect observed records.
3. **Publication delay.** A current date range does not make the underlying portal real-time.
4. **Preliminary records.** Categories and outcomes can change after review.
5. **Duplicate or multi-offense structure.** A complaint or incident can contain more than one underlying offense; local row semantics differ.
6. **Activity denominator.** Nearby land area is a transparent comparator but does not measure pedestrians, riders, visitors, or time spent at risk.
7. **Small samples.** Short windows and small radii can be unstable even when the UI labels confidence low.
8. **Environmental conditions.** Lighting, crowding, special events, weather, service disruptions, and time of day can matter more than a historical aggregate.

## Adding a provider

A provider should not be added until all of the following are documented and tested:

- official publisher and landing page;
- stable machine-readable endpoint;
- occurrence/report date semantics;
- row identity semantics;
- category and description fields;
- usable coordinates and documented privacy transformation;
- update cadence and expected lag;
- geographic bounds;
- a live contract test for required fields;
- mapper unit tests for representative and invalid rows;
- a source card with plain-language caveats.
