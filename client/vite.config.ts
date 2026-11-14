import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    // Code découpé en morceaux : le navigateur garde en cache les bibliothèques, qui changent rarement
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('livekit')) return 'livekit';
          if (id.includes('react') || id.includes('scheduler') || id.includes('zustand')) return 'react';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
