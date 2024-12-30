import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/web-ext-types.js'],
  format: ['cjs'],
})
