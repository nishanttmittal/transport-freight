import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base is parameterized so the SAME source builds for two homes:
//   • GitHub Pages (default):  /transport-freight/   (npm run build / deploy)
//   • Firebase Hosting:        /freight/             (APP_BASE=/freight/ npm run build)
//     Same-origin as the Firebase authDomain, so Google sign-in works inside the
//     installed iPhone PWA and the hidden auth iframe is nearly free (github.io
//     paid 1,220 ms for it on a cold open vs 77 ms same-origin — measured 2026-08-04).
const BASE = process.env.APP_BASE || '/transport-freight/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: BASE,
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        navigateFallback: `${BASE}index.html`,
        navigateFallbackAllowlist: [new RegExp('^' + BASE)],
        // Never let the SW serve the app for Firebase's reserved /__/auth/* paths —
        // doing so boots the app inside the auth iframe → recursion → white screen.
        navigateFallbackDenylist: [/^\/__/],
      },
      manifest: {
        name: 'Transport Freight Hisab',
        short_name: 'Freight',
        description: 'Daily transport freight, advances and per-gaadiwala hisab',
        theme_color: '#1e293b',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
