import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

// Version de l'interface, figée à la construction de l'image. Comparée à celle
// que renvoie l'API, elle révèle une coque servie depuis un cache périmé.
const appVersion = process.env.APP_VERSION ?? 'dev';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // « prompt » et non « autoUpdate » : l'application propose la mise à
      // jour par un bandeau au lieu de recharger la page d'elle-même, ce qui
      // interromprait une session de scan en cours. L'enregistrement est fait
      // par le code (voir lib/pwa.ts), pas injecté automatiquement.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-maskable.svg'],
      manifest: {
        name: 'Inventaire',
        short_name: 'Inventaire',
        description: 'Inventaire alimentaire : scan, péremptions, stock réel',
        lang: 'fr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        background_color: '#111716',
        theme_color: '#111716',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Coque applicative seulement : l'API et les médias ne passent jamais par le cache du service worker.
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    // En développement et en test, le paquet partagé est lu depuis ses sources : pas de build préalable.
    alias: { '@kitchen/shared': sharedSource },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
