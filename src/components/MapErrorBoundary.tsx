import { Component } from 'react';
import type { MapErrorBoundaryProps, MapErrorBoundaryState } from './MapErrorBoundary.types';

export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): MapErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="map-stage map-stage--failed" role="alert">
        <div className="map-failure">
          <strong>Map unavailable</strong>
          <span>Incident evidence and place controls remain available.</span>
          <button onClick={() => window.location.reload()} type="button">Reload map</button>
        </div>
      </div>
    );
  }
}
