#!/usr/bin/env node
/**
 * scripts/check-catalog-sync.mjs
 * Checks that lib/servicios.js and supabase/functions/agent-runner/config.ts
 * have matching service IDs and prices.
 *
 * Usage: node scripts/check-catalog-sync.mjs
 * Exit 0: catalogs in sync
 * Exit 1: differences found
 *
 * NOTE: Not integrated in CI by design (ADR-2). Run manually before deploying.
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { SERVICIOS } from '../lib/servicios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../supabase/functions/agent-runner/config.ts')

/**
 * Extracts { id -> precio } from config.ts by scanning for id/precio pairs
 * within the CATALOGO_SERVICIOS block.
 */
function extractFromConfigTs() {
  const src = readFileSync(CONFIG_PATH, 'utf-8')

  const startIdx = src.indexOf('CATALOGO_SERVICIOS')
  if (startIdx === -1) {
    throw new Error('CATALOGO_SERVICIOS not found in config.ts')
  }

  const result = {}
  const block = src.slice(startIdx)
  const entryRe = /id:\s*['"]([^'"]+)['"]/g
  const precioRe = /precio:\s*(\d+)/

  let m
  while ((m = entryRe.exec(block)) !== null) {
    const id = m[1]
    const snippet = block.slice(m.index, m.index + 300)
    const pm = precioRe.exec(snippet)
    if (pm) {
      result[id] = parseInt(pm[1], 10)
    }
  }
  return result
}

const nodeIds = Object.keys(SERVICIOS).sort()
const configCatalog = extractFromConfigTs()
const denoIds = Object.keys(configCatalog).sort()

let hasDiff = false

// Check IDs
const onlyInNode = nodeIds.filter(id => !denoIds.includes(id))
const onlyInDeno = denoIds.filter(id => !nodeIds.includes(id))

if (onlyInNode.length > 0) {
  console.error(`IDs in lib/servicios.js but NOT in config.ts: ${onlyInNode.join(', ')}`)
  hasDiff = true
}
if (onlyInDeno.length > 0) {
  console.error(`IDs in config.ts but NOT in lib/servicios.js: ${onlyInDeno.join(', ')}`)
  hasDiff = true
}

// Check prices for shared IDs
const sharedIds = nodeIds.filter(id => denoIds.includes(id))
for (const id of sharedIds) {
  const nodePrice = SERVICIOS[id].precio
  const denoPrice = configCatalog[id]
  if (nodePrice !== denoPrice) {
    console.error(`PRICE MISMATCH [${id}]: lib/servicios.js=$${nodePrice}, config.ts=$${denoPrice}`)
    hasDiff = true
  }
}

if (!hasDiff) {
  console.log(`OK — ${nodeIds.length} services in sync (IDs and prices match)`)
  process.exit(0)
} else {
  process.exit(1)
}
