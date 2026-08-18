import { pointIsWithinBounds } from '../../domain/geo';
import type { Coordinates, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { chicagoProvider, CHICAGO_META } from './chicago';
import { newYorkProvider, NEW_YORK_META } from './newYork';
import {
  austinProvider,
  AUSTIN_META,
  baltimoreProvider,
  BALTIMORE_META,
  losAngelesProvider,
  LOS_ANGELES_META,
  nashvilleProvider,
  NASHVILLE_META,
  seattleProvider,
  SEATTLE_META,
  washingtonDcProvider,
  WASHINGTON_DC_META,
} from './nationwide';
import { sanFranciscoProvider, SAN_FRANCISCO_META } from './sanFrancisco';

export const providers: IncidentProvider[] = [
  newYorkProvider,
  washingtonDcProvider,
  baltimoreProvider,
  chicagoProvider,
  nashvilleProvider,
  austinProvider,
  losAngelesProvider,
  sanFranciscoProvider,
  seattleProvider,
];

export const providerMetadata: ProviderMeta[] = providers.map((provider) => provider.meta);

export function findProviderForPoint(point: Coordinates) {
  return providers.find((provider) => pointIsWithinBounds(point, provider.meta.bounds)) ?? null;
}

export const FEATURED_PLACES: SelectedPlace[] = [
  { label: 'Times Square', detail: 'Manhattan · New York City', coordinates: [-73.9855, 40.758] },
  { label: 'National Mall', detail: 'Washington, District of Columbia', coordinates: [-77.0365, 38.8895] },
  { label: 'Inner Harbor', detail: 'Baltimore, Maryland', coordinates: [-76.6105, 39.2866] },
  { label: 'The Loop', detail: 'Chicago, Illinois', coordinates: [-87.6298, 41.8837] },
  { label: 'Lower Broadway', detail: 'Nashville, Tennessee', coordinates: [-86.7742, 36.1601] },
  { label: 'Downtown Austin', detail: 'Austin, Texas', coordinates: [-97.7431, 30.2672] },
  { label: 'Hollywood', detail: 'Los Angeles, California', coordinates: [-118.3406, 34.1016] },
  { label: 'Union Square', detail: 'San Francisco, California', coordinates: [-122.4075, 37.788] },
  { label: 'Pike Place', detail: 'Seattle, Washington', coordinates: [-122.3422, 47.6097] },
];

export const PROVIDER_CENTERS: Record<string, SelectedPlace> = {
  [NEW_YORK_META.id]: FEATURED_PLACES[0]!,
  [WASHINGTON_DC_META.id]: FEATURED_PLACES[1]!,
  [BALTIMORE_META.id]: FEATURED_PLACES[2]!,
  [CHICAGO_META.id]: FEATURED_PLACES[3]!,
  [NASHVILLE_META.id]: FEATURED_PLACES[4]!,
  [AUSTIN_META.id]: FEATURED_PLACES[5]!,
  [LOS_ANGELES_META.id]: FEATURED_PLACES[6]!,
  [SAN_FRANCISCO_META.id]: FEATURED_PLACES[7]!,
  [SEATTLE_META.id]: FEATURED_PLACES[8]!,
};
