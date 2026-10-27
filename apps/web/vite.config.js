import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API has no CORS; in development the browser talks to Vite, which forwards to the API.
const target = process.env.API_URL ?? 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep MUI (charts, stepper, slider) out of the main bundle so first paint stays light.
        manualChunks: { mui: ['@mui/material', '@mui/x-charts', '@emotion/react', '@emotion/styled'] },
      },
    },
  },
});
