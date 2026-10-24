import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The API has no CORS; in development the browser talks to Vite, which forwards to the API.
const target = process.env.API_URL ?? 'http://localhost:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
    },
  },
});
