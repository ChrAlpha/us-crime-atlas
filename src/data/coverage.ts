import { pointIsWithinBounds } from '../domain/geo';
import type { Coordinates, IncidentProvider } from '../types';
import type { CoverageResolution } from './coverage.types';
import { FBI_STATE_CODES } from './fbiState.constants';
import { findFbiStateEstimate } from './fbiState';
import type { FbiStateSnapshot } from './fbiState.types';
import { findStateForPoint } from './stateBoundary';
import type { StateBoundaryCollection } from './stateBoundary.types';

const supportedStateCodes = new Set<string>(FBI_STATE_CODES);

export function resolveCoverageForPoint(
  point: Coordinates,
  localProviders: readonly IncidentProvider[],
  stateBoundaries: StateBoundaryCollection,
  stateSnapshot: FbiStateSnapshot,
): CoverageResolution {
  const jurisdiction = findStateForPoint(point, stateBoundaries);
  if (!jurisdiction) return { kind: 'unsupported' };
  if (!supportedStateCodes.has(jurisdiction.code)) return { kind: 'unsupported' };

  const localProvider = localProviders.find((provider) => (
    provider.meta.state.toUpperCase() === jurisdiction.code
    && pointIsWithinBounds(point, provider.meta.bounds)
  ));
  if (localProvider) return { kind: 'local-incidents', provider: localProvider };

  const estimate = findFbiStateEstimate(stateSnapshot, jurisdiction.code);
  if (!estimate) throw new Error(`FBI state snapshot is missing ${jurisdiction.code}`);
  if (estimate.year !== stateSnapshot.year) {
    throw new Error(`FBI state snapshot year mismatch for ${jurisdiction.code}`);
  }
  if (estimate.stateName.toLocaleLowerCase('en-US') !== jurisdiction.name.trim().toLocaleLowerCase('en-US')) {
    throw new Error(`Census and FBI state name mismatch for ${jurisdiction.code}`);
  }

  return { kind: 'state-aggregate', jurisdiction, estimate };
}
