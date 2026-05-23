import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,mjs,ts}', 'lib/**/*.test.{js,mjs,ts}'],
    globals: false,
    reporters: 'default',
  },
})
