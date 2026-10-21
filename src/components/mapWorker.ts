import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// MapLibre looks for its worker next to its own module file. Bundling moves that module
// into a hashed chunk without emitting the worker, which leaves the map blank in
// production, so point MapLibre at the worker Vite bundles instead.
setWorkerUrl(workerUrl);
