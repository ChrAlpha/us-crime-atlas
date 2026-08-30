import { describe, expect, it } from 'vitest';
import type { StateBoundaryCollection } from './stateBoundary.types';
import { findStateForPoint } from './stateBoundary';

const boundaries: StateBoundaryCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: 'SQ', name: 'Square State' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-102, 30], [-98, 30], [-98, 34], [-102, 34], [-102, 30]],
          [[-100.5, 31.5], [-99.5, 31.5], [-99.5, 32.5], [-100.5, 32.5], [-100.5, 31.5]],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { code: 'IS', name: 'Island State' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[-160, 20], [-158, 20], [-158, 22], [-160, 22], [-160, 20]]],
          [[[179, 50], [-179, 50], [-179, 52], [179, 52], [179, 50]]],
        ],
      },
    },
  ],
};

describe('state boundary lookup', () => {
  it('resolves polygon interiors and includes their outer boundary', () => {
    expect(findStateForPoint([-101, 31], boundaries)).toEqual({ code: 'SQ', name: 'Square State' });
    expect(findStateForPoint([-102, 32], boundaries)).toEqual({ code: 'SQ', name: 'Square State' });
  });

  it('excludes polygon holes and points outside every state', () => {
    expect(findStateForPoint([-100, 32], boundaries)).toBeNull();
    expect(findStateForPoint([-100.5, 32], boundaries)).toBeNull();
    expect(findStateForPoint([-90, 32], boundaries)).toBeNull();
  });

  it('resolves multipolygon islands on either side of the antimeridian', () => {
    expect(findStateForPoint([-159, 21], boundaries)?.code).toBe('IS');
    for (const longitude of [179.5, -179.5, 180.5, 540.5, 180, -180]) {
      expect(findStateForPoint([longitude, 51], boundaries)?.code).toBe('IS');
    }
    expect(findStateForPoint([0, 51], boundaries)).toBeNull();
    expect(findStateForPoint([360, 51], boundaries)).toBeNull();
  });

  it('fails closed for malformed or unsupported GeoJSON features', () => {
    const malformed = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { code: 'NL', name: 'Null' }, geometry: null },
        {
          type: 'Feature',
          properties: { code: 'DG', name: 'Degenerate' },
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] },
        },
        {
          type: 'Feature',
          properties: { code: 'NF', name: 'Non-finite' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [Number.NaN, 1], [0, 0]]],
          },
        },
        {
          type: 'Feature',
          properties: { code: 'PT', name: 'Point' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          properties: { code: 'SH', name: 'Short position' },
          geometry: { type: 'Polygon', coordinates: [[[0], [1, 0], [0, 1], [0]]] },
        },
        {
          type: 'Feature',
          properties: { code: 'UC', name: 'Unclosed' },
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [1, 1]]] },
        },
        {
          type: 'Feature',
          properties: { code: 'NS', name: 'Nesting' },
          geometry: { type: 'Polygon', coordinates: [42] },
        },
        {
          type: 'Feature',
          properties: null,
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
        },
      ],
    } as unknown as StateBoundaryCollection;

    expect(findStateForPoint([0.5, 0], malformed)).toBeNull();
    expect(findStateForPoint([0, 0], malformed)).toBeNull();
  });
});
