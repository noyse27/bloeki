/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const rootPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

function berlinBuildTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}${value('month')}${value('day')}${value('hour')}${value('minute')}`;
}

const buildTimestamp = process.env.BLOEKI_BUILD_TIMESTAMP || berlinBuildTimestamp(new Date());
const gameVersion = `${rootPackage.version}_${buildTimestamp}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __BLOEKI_GAME_VERSION__: JSON.stringify(gameVersion),
  },
  server: {
    host: true,
    port: 5173,
    // Mirrors frontend/nginx.conf's /api -> backend proxy so `npm run dev`
    // behaves the same as the Docker Compose setup without needing
    // VITE_API_BASE_URL for local, non-Docker development.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
