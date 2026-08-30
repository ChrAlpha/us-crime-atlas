import { describe, expect, it } from 'vitest';
import { philadelphiaProvider } from './providers/arcgisCities';
import { dallasProvider } from './providers/nationwide';
import type { FbiStateEstimate, FbiStateSnapshot } from './fbiState.types';
import type { StateBoundaryCollection } from './stateBoundary.types';
import { resolveCoverageForPoint } from './coverage';

const texasEstimate: FbiStateEstimate = {
  stateCode: 'TX',
  stateName: 'Texas',
  year: 2024,
  population: 31_000_000,
  counts: {
    violentCrime: 120_000,
    homicide: 2_000,
    rape: 15_000,
    robbery: 22_000,
    aggravatedAssault: 81_000,
    propertyCrime: 700_000,
    burglary: 100_000,
    larceny: 500_000,
    motorVehicleTheft: 100_000,
  },
  ratesPer100k: {
    violentCrime: 387.1,
    homicide: 6.5,
    rape: 48.4,
    robbery: 71,
    aggravatedAssault: 261.3,
    propertyCrime: 2_258.1,
    burglary: 322.6,
    larceny: 1_612.9,
    motorVehicleTheft: 322.6,
  },
  caveats: null,
};

function texasBoundary(name = 'Texas', code = 'TX'): StateBoundaryCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { code, name },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-107, 25], [-93, 25], [-93, 37], [-107, 37], [-107, 25]]],
      },
    }],
  };
}

const snapshot: FbiStateSnapshot = { year: 2024, states: [texasEstimate] };

describe('coverage resolution', () => {
  it('keeps a local incident provider ahead of the statewide aggregate', () => {
    const result = resolveCoverageForPoint(
      dallasProvider.meta.center,
      [dallasProvider],
      texasBoundary(),
      snapshot,
    );

    expect(result).toEqual({ kind: 'local-incidents', provider: dallasProvider });
  });

  it('uses state aggregate evidence where no local incident provider exists', () => {
    const result = resolveCoverageForPoint([-97.7431, 30.2672], [dallasProvider], texasBoundary(), snapshot);

    expect(result).toEqual({
      kind: 'state-aggregate',
      jurisdiction: { code: 'TX', name: 'Texas' },
      estimate: texasEstimate,
    });
  });

  it('does not let a city rectangle claim a point across a state border', () => {
    const newJerseyEstimate: FbiStateEstimate = {
      ...texasEstimate,
      stateCode: 'NJ',
      stateName: 'New Jersey',
    };
    const newJerseyBoundary = texasBoundary('New Jersey', 'NJ');
    newJerseyBoundary.features[0]!.geometry = {
      type: 'Polygon',
      coordinates: [[[-75.3, 39.7], [-74.8, 39.7], [-74.8, 40.2], [-75.3, 40.2], [-75.3, 39.7]]],
    };

    expect(resolveCoverageForPoint(
      [-75.1196, 39.9259],
      [philadelphiaProvider],
      newJerseyBoundary,
      { year: 2024, states: [newJerseyEstimate] },
    )).toEqual({
      kind: 'state-aggregate',
      jurisdiction: { code: 'NJ', name: 'New Jersey' },
      estimate: newJerseyEstimate,
    });
  });

  it('keeps points outside covered US jurisdictions unsupported', () => {
    expect(resolveCoverageForPoint([-79.3832, 43.6532], [], texasBoundary(), snapshot)).toEqual({
      kind: 'unsupported',
    });
    const puertoRicoBoundary = texasBoundary('Puerto Rico', 'PR');
    puertoRicoBoundary.features[0]!.geometry = {
      type: 'Polygon',
      coordinates: [[[-67.5, 17.8], [-65.2, 17.8], [-65.2, 18.6], [-67.5, 18.6], [-67.5, 17.8]]],
    };
    const puertoRicoProvider = {
      ...dallasProvider,
      meta: {
        ...dallasProvider.meta,
        id: 'puerto-rico-test',
        state: 'PR',
        bounds: { west: -67.5, south: 17.8, east: -65.2, north: 18.6 },
      },
    };
    expect(resolveCoverageForPoint([-66.1, 18.4], [puertoRicoProvider], puertoRicoBoundary, snapshot)).toEqual({
      kind: 'unsupported',
    });
  });

  it('fails closed when state boundaries and estimates disagree', () => {
    expect(() => resolveCoverageForPoint(
      [-97.7431, 30.2672],
      [],
      texasBoundary(),
      { year: 2024, states: [] },
    )).toThrow(/missing TX/i);
    expect(() => resolveCoverageForPoint(
      [-97.7431, 30.2672],
      [],
      texasBoundary('Not Texas'),
      snapshot,
    )).toThrow(/name mismatch/i);
    expect(() => resolveCoverageForPoint(
      [-97.7431, 30.2672],
      [],
      texasBoundary(),
      { year: 2023, states: [texasEstimate] },
    )).toThrow(/year mismatch/i);
  });
});
