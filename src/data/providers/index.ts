import { pointIsWithinBounds } from '../../domain/geo';
import type { Coordinates, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { chicagoProvider, CHICAGO_META } from './chicago';
import {
  denverProvider,
  DENVER_META,
  detroitProvider,
  DETROIT_META,
  nashvilleProvider,
  NASHVILLE_META,
  philadelphiaProvider,
  PHILADELPHIA_META,
} from './arcgisCities';
import { newYorkProvider, NEW_YORK_META } from './newYork';
import {
  dallasProvider,
  DALLAS_META,
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
  philadelphiaProvider,
  chicagoProvider,
  detroitProvider,
  nashvilleProvider,
  dallasProvider,
  denverProvider,
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
  { label: 'Center City', detail: 'Philadelphia, Pennsylvania', coordinates: [-75.1652, 39.9526] },
  { label: 'The Loop', detail: 'Chicago, Illinois', coordinates: [-87.6298, 41.8837] },
  { label: 'Downtown Detroit', detail: 'Detroit, Michigan', coordinates: [-83.0458, 42.3314] },
  { label: 'Lower Broadway', detail: 'Nashville, Tennessee', coordinates: [-86.7742, 36.1601] },
  { label: 'Downtown Dallas', detail: 'Dallas, Texas', coordinates: [-96.797, 32.7767] },
  { label: 'Downtown Denver', detail: 'Denver, Colorado', coordinates: [-104.9903, 39.7392] },
  { label: 'Hollywood', detail: 'Los Angeles, California', coordinates: [-118.3406, 34.1016] },
  { label: 'Union Square', detail: 'San Francisco, California', coordinates: [-122.4075, 37.788] },
  { label: 'Pike Place', detail: 'Seattle, Washington', coordinates: [-122.3422, 47.6097] },
];

export const PROVIDER_CENTERS: Record<string, SelectedPlace> = {
  [NEW_YORK_META.id]: FEATURED_PLACES[0]!,
  [WASHINGTON_DC_META.id]: FEATURED_PLACES[1]!,
  [PHILADELPHIA_META.id]: FEATURED_PLACES[2]!,
  [CHICAGO_META.id]: FEATURED_PLACES[3]!,
  [DETROIT_META.id]: FEATURED_PLACES[4]!,
  [NASHVILLE_META.id]: FEATURED_PLACES[5]!,
  [DALLAS_META.id]: FEATURED_PLACES[6]!,
  [DENVER_META.id]: FEATURED_PLACES[7]!,
  [LOS_ANGELES_META.id]: FEATURED_PLACES[8]!,
  [SAN_FRANCISCO_META.id]: FEATURED_PLACES[9]!,
  [SEATTLE_META.id]: FEATURED_PLACES[10]!,
};
