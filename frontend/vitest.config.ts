import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Keep Playwright E2E specs out of vitest's glob — they import
    // `@playwright/test`, not vitest, and need a real browser.
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
