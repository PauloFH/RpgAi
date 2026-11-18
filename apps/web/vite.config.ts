import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': target,
      '/auth': target,
      '/files': target,
      '/ws': { target, ws: true },
    },
  },
});
