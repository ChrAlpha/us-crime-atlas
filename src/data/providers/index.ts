import { pointIsWithinBounds } from '../../domain/geo';
import type { Coordinates, IncidentProvider, ProviderMeta, SelectedPlace } from '../../types';
import { isWithinJurisdiction, jurisdictionFor } from '../jurisdictions';
import {
  denverProvider,
  detroitProvider,
  nashvilleProvider,
  philadelphiaProvider,
  washingtonDcProvider,
} from './arcgisCities';
import {
  chicagoProvider,
  dallasProvider,
  losAngelesProvider,
  newYorkProvider,
  oaklandProvider,
  sanFranciscoProvider,
  seattleProvider,
} from './socrataCities';
import { NORTHEAST_FEATURED_PLACES, NORTHEAST_PROVIDERS } from './northeastCities';
import { SOUTH_FEATURED_PLACES, SOUTH_PROVIDERS } from './southCities';
import { WEST_FEATURED_PLACES, WEST_PROVIDERS } from './westCities';

/**
 * Registered providers: the first-release cities east to west, then each regional expansion
 * wave. FEATURED_PLACES follows the same order.
 */
export const providers: readonly IncidentProvider[] = [
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
  oaklandProvider,
  seattleProvider,
  ...NORTHEAST_PROVIDERS,
  ...SOUTH_PROVIDERS,
  ...WEST_PROVIDERS,
];

export const providerMetadata: readonly ProviderMeta[] = providers.map((provider) => provider.meta);

/**
 * The provider whose city limits contain `point`. The rectangular `bounds` alone would also
 * claim neighbors such as Jersey City or Beverly Hills, where the city feed has no records,
 * and would miss in-city edges beyond the rectangle, so they apply only without limits.
 */
export function findProviderForPoint(point: Coordinates): IncidentProvider | null {
  return providers.find((provider) => {
    const jurisdiction = jurisdictionFor(provider.meta.id);
    return jurisdiction ? isWithinJurisdiction(point, jurisdiction) : pointIsWithinBounds(point, provider.meta.bounds);
  }) ?? null;
}

export const FEATURED_PLACES: readonly SelectedPlace[] = [
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
  { label: 'Lake Merritt', detail: 'Oakland, California', coordinates: [-122.2585, 37.8027] },
  { label: 'Pike Place', detail: 'Seattle, Washington', coordinates: [-122.3422, 47.6097] },
  ...NORTHEAST_FEATURED_PLACES,
  ...SOUTH_FEATURED_PLACES,
  ...WEST_FEATURED_PLACES,
];
