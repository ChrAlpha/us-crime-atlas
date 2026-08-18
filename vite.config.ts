import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { host: '127.0.0.1', port: 4173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { sourcemap: true },
});
