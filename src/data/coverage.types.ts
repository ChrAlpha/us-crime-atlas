import type { IncidentProvider } from '../types';
import type { FbiStateEstimate } from './fbiState.types';
import type { StateJurisdiction } from './stateBoundary.types';

export type CoverageResolution =
  | { kind: 'local-incidents'; provider: IncidentProvider }
  | { kind: 'state-aggregate'; jurisdiction: StateJurisdiction; estimate: FbiStateEstimate }
  | { kind: 'unsupported' };
