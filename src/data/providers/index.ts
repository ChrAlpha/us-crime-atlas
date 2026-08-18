import { pointIsWithinBounds } from '../../domain/geo';
import type { Coordinates, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { chicagoProvider, CHICAGO_META } from './chicago';
import { newYorkProvider, NEW_YORK_META } from './newYork';
import {
  losAngelesProvider,
  LOS_ANGELES_META,
  seattleProvider,
  SEATTLE_META,
  washingtonDcProvider,
  WASHINGTON_DC_META,
} from './nationwide';
import { sanFranciscoProvider, SAN_FRANCISCO_META } from './sanFrancisco';

export const providers: IncidentProvider[] = [
  newYorkProvider,
  washingtonDcProvider,
  chicagoProvider,
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
  { label: 'The Loop', detail: 'Chicago, Illinois', coordinates: [-87.6298, 41.8837] },
  { label: 'Hollywood', detail: 'Los Angeles, California', coordinates: [-118.3406, 34.1016] },
  { label: 'Union Square', detail: 'San Francisco, California', coordinates: [-122.4075, 37.788] },
  { label: 'Pike Place', detail: 'Seattle, Washington', coordinates: [-122.3422, 47.6097] },
];

export const PROVIDER_CENTERS: Record<string, SelectedPlace> = {
  [NEW_YORK_META.id]: FEATURED_PLACES[0]!,
  [WASHINGTON_DC_META.id]: FEATURED_PLACES[1]!,
  [CHICAGO_META.id]: FEATURED_PLACES[2]!,
  [LOS_ANGELES_META.id]: FEATURED_PLACES[3]!,
  [SAN_FRANCISCO_META.id]: FEATURED_PLACES[4]!,
  [SEATTLE_META.id]: FEATURED_PLACES[5]!,
};
