import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,mjs,ts}', 'lib/**/*.test.{js,mjs,ts}'],
    globals: false,
    pool: process.platform === 'win32' ? 'threads' : 'forks',
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      reportOnFailure: true,
    },
  },
})
