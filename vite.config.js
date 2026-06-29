import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/transport-freight/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: '/transport-freight/',
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        navigateFallback: '/transport-freight/index.html',
        navigateFallbackAllowlist: [/^\/transport-freight/],
      },
      manifest: {
        name: 'Transport Freight Hisab',
        short_name: 'Freight',
        description: 'Daily transport freight, advances and per-gaadiwala hisab',
        theme_color: '#1e293b',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/transport-freight/',
        scope: '/transport-freight/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
