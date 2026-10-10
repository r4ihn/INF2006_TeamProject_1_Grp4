import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API runs on :3000 during development. Proxying lets the browser call
// relative URLs (`/health`, `/api/...`) with no CORS setup, which is also how
// it will work behind the ALB in production.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly if 5173 is taken (e.g. another project's dev server), instead of
    // silently moving to 5174 while you keep looking at the other app on 5173.
    strictPort: true,
    // Open the browser at the right address automatically.
    open: true,
    proxy: {
      '/health': API_TARGET,
      '/auth': API_TARGET,
      '/api': API_TARGET,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Room for the 5 s waits configured in src/test/setup.ts on a busy machine
    testTimeout: 15_000,
  },
});
