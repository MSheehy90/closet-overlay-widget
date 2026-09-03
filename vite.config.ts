import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/closet-overlay-widget/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png',
        'fonts/*',
        'creator/catalog.json',
      ],
      manifest: {
        name: 'Closet Overlay',
        short_name: 'Closet',
        description: 'Clothes and hair overlay + cleanup studio',
        start_url: '/closet-overlay-widget/',
        scope: '/closet-overlay-widget/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1a1410',
        theme_color: '#1a1410',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Bump cache when creator pack lands
        cacheId: 'closet-overlay-v2-creator',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest,json}'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
