import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 8080,
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      // Trailing slash matters: a bare "/api" prefix also matches "/apiClient.js"
      // (string-prefix match), which silently 404s against the backend and breaks
      // the apiClient module import for the whole app.
      '/api/': {
        target: process.env.VITE_BACKEND_URL || 'http://backend:3000',
        changeOrigin: true,
      },
    },
  },
});
