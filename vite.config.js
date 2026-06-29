import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/welder/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: '/welder/',
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        navigateFallback: '/welder/index.html',
        navigateFallbackAllowlist: [/^\/welder/],
      },
      manifest: {
        name: 'Welder Contractor',
        short_name: 'Welder',
        description: 'Welder contractor — material sent for chrome / powder / gold finishing',
        theme_color: '#b45309',
        background_color: '#f1f5f9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/welder/',
        scope: '/welder/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
