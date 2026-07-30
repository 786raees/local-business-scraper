import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: {
      // The offscreen recorder page isn't referenced by the manifest, so crxjs
      // won't discover it — declare it as an extra HTML input (story 15).
      input: { offscreen: 'src/offscreen/index.html' },
    },
  },
})
