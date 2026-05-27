import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,mjs,ts}', 'lib/**/*.test.{js,mjs,ts}'],
    globals: false,
    reporters: 'default',
  },
})
