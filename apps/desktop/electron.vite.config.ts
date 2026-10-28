import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preloads can only require 'electron', so bundle everything else.
    build: { externalizeDeps: false }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          launcher: resolve(__dirname, 'src/renderer/launcher.html')
        }
      }
    }
  }
})
