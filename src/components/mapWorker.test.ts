import { describe, expect, it, vi } from 'vitest';

const setWorkerUrl = vi.hoisted(() => vi.fn());
vi.mock('maplibre-gl', () => ({ setWorkerUrl }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/assets/maplibre-gl-worker-abc123.js' }));

describe('mapWorker', () => {
  it('points MapLibre at the bundled worker when imported', async () => {
    await import('./mapWorker');
    expect(setWorkerUrl).toHaveBeenCalledOnce();
    expect(setWorkerUrl).toHaveBeenCalledWith('/assets/maplibre-gl-worker-abc123.js');
  });
});
