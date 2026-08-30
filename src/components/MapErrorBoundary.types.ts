import type { ReactNode } from 'react';

export interface MapErrorBoundaryProps {
  children: ReactNode;
}

export interface MapErrorBoundaryState {
  failed: boolean;
}
