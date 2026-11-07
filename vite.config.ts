import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export const THEME_COLOR = '#4f46e5';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/main.tsx
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        id: '/',
        name: 'Airhead',
        short_name: 'Airhead',
        description: 'Capture anything, sorted later.',
        lang: 'en-IE',
        start_url: '/',
        scope: '/',
        display: 'standalone', // the only display mode iOS supports
        orientation: 'any',
        theme_color: THEME_COLOR,
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Android and desktop Chrome: "Share" to Airhead lands on /share (Task 7.4).
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp,woff2}'],
        // PDF reading is only used when importing a schedule (online, with AI): load on demand.
        globIgnores: ['**/pdf*.js', '**/pdf*.mjs'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, strictPort: true },
});
