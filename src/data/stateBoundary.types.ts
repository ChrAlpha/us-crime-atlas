import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export interface StateBoundaryProperties {
  code: string;
  name: string;
}

export type StateBoundaryCollection = FeatureCollection<Polygon | MultiPolygon, StateBoundaryProperties>;

export interface StateJurisdiction {
  code: string;
  name: string;
}
