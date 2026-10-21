# Product

## Register

product

## Users

Travelers deciding where to stay or walk in a US city: someone holding a hotel shortlist, an Airbnb address, or a landmark they plan to visit. They are usually on a phone, often mid-booking or already in transit, and they check one place at a time, then jump to the next candidate. They are not analysts; they want to understand what the published record says about the blocks around one point, quickly, without being frightened or misled.

The job: "Show me what has actually been reported around this spot recently, how that compares with the surrounding area, and how much I should trust it."

## Product Purpose

US Crime Atlas maps recently published, official police incident records around a chosen point and compares the selected circle with its surrounding ring over the same dates. It exists because the alternatives either sell a single opaque "safety score" or dump raw dispatch noise. Success is a traveler who, within a few seconds of choosing a place, can state in plain words what the local record shows, sees the evidence on the map, and knows the data's limits (lag, blurring, coverage) without having to read a methodology page first.

The product never fabricates, extrapolates, or substitutes proxy data. Unsupported places remain usable as a map but get an honest "no verified feed" state.

## Brand Personality

Calm, clear, trustworthy. Consumer-travel friendly in the way Airbnb and Google Maps are: approachable, plain-spoken, immediately legible, with the craft of a good map app rather than a data portal. The core finding is said in everyday words ("About 5× more reports than the surrounding blocks") with a visual scale, never as a grade, score, or verdict of "safe" or "dangerous". Numbers stay honest and visible, but jargon (weighted density, annulus, Haversine) lives in the details, not the headline.

## Anti-references

- Citizen-style crime apps: alarm red everywhere, pulsing alerts, push-notification fear, anything that manufactures anxiety.
- Real-estate "safety score" sites (NeighborhoodScout, AreaVibes): A–F grades, big composite scores, red/green verdicts about neighborhoods.
- Government GIS dashboards (ArcGIS Dashboards): dense grids of tiny widgets, gauges, and tables crammed around a map.

## Design Principles

1. **Answer first, evidence close behind.** Every place gets a one-sentence plain-language finding, then the map and counts that back it, then the caveats. Never make the user assemble the conclusion.
2. **The map is the product.** The map stays large and legible on every screen; panels serve the map rather than fence it in.
3. **Honest about uncertainty, without burying the answer.** Lag, blurring, partial coverage, and record limits are shown where they change the reading, at the right weight; they never block the finding or pile up as warnings.
4. **Calm, not alarming.** Color and motion describe the data; they never dramatize it. No color reads as "danger".
5. **One place, fast switching.** Choosing, changing, and adjusting a place should feel instant and reversible on a phone with one thumb.

## Accessibility & Inclusion

WCAG 2.2 AA. Category colors are colorblind-safe and never the only carrier of meaning (labels, shapes, or counts accompany them). Text contrast meets AA on both themes and over the map. Touch targets are at least 44 px on mobile. Reduced-motion preferences disable nonessential animation. Keyboard users can reach search, settings, evidence, and the incident list; axe reports no serious or critical violations. UI language is English only.
