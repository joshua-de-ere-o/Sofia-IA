/**
 * test/catalog-sync.test.mjs
 * Validates that lib/servicios.js and the catalog embedded in agent-runner/config.ts
 * have matching IDs and prices.
 *
 * Strategy: since config.ts is Deno/TypeScript, we parse it as text and extract
 * the CATALOGO_SERVICIOS entries to compare with lib/servicios.js.
 * RED: written before implementation.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { SERVICIOS } from '../lib/servicios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../supabase/functions/agent-runner/config.ts')

/**
 * Extracts { id -> precio } from config.ts by scanning for lines matching
 *   id: '...',
 *   precio: <number>,
 * within CATALOGO_SERVICIOS.
 * This is a best-effort text extractor; it's intentionally simple because
 * the catalog follows a very regular format.
 */
function extractCatalogFromConfigTs() {
  const src = readFileSync(CONFIG_PATH, 'utf-8')

  // Find the CATALOGO_SERVICIOS block
  const startIdx = src.indexOf('CATALOGO_SERVICIOS')
  if (startIdx === -1) throw new Error('CATALOGO_SERVICIOS not found in config.ts')

  // Extract entries: look for id: '...' followed (within a few lines) by precio: <number>
  const result = {}
  // Match entry blocks by looking for id: 'xxx' and precio: N
  const entryRe = /id:\s*['"]([^'"]+)['"]/g
  const precioRe = /precio:\s*(\d+)/

  // Split by id: occurrences after CATALOGO_SERVICIOS
  const block = src.slice(startIdx)
  let m
  while ((m = entryRe.exec(block)) !== null) {
    const id = m[1]
    // Look for precio within the next 300 chars after the id match
    const snippet = block.slice(m.index, m.index + 300)
    const pm = precioRe.exec(snippet)
    if (pm) {
      result[id] = parseInt(pm[1], 10)
    }
  }
  return result
}

describe('Catalog sync: lib/servicios.js ⇄ agent-runner/config.ts', () => {
  it('config.ts contains CATALOGO_SERVICIOS', () => {
    const src = readFileSync(CONFIG_PATH, 'utf-8')
    expect(src).toContain('CATALOGO_SERVICIOS')
  })

  it('both catalogs have the same set of IDs', () => {
    const configCatalog = extractCatalogFromConfigTs()
    const nodeIds = Object.keys(SERVICIOS).sort()
    const denoIds = Object.keys(configCatalog).sort()
    expect(denoIds).toEqual(nodeIds)
  })

  it('prices match between both catalogs', () => {
    const configCatalog = extractCatalogFromConfigTs()
    const mismatches = []
    for (const [id, denoPrice] of Object.entries(configCatalog)) {
      const nodePrice = SERVICIOS[id]?.precio
      if (nodePrice !== denoPrice) {
        mismatches.push({ id, nodePrice, denoPrice })
      }
    }
    expect(mismatches, `Price mismatches: ${JSON.stringify(mismatches)}`).toHaveLength(0)
  })
})
