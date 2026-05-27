/**
 * test/catalog-parity-zones.test.mjs  (T-05, W-01)
 *
 * CI catalog-parity test:
 *   1. Zones: lib/catalog/zonas.json IDs MUST match agent-runner/config.ts zona enums.
 *   2. Services: lib/catalog/servicios.json IDs MUST match CATALOGO_SERVICIOS keys in config.ts.
 *
 * RED: written before implementation — fails until T-01/T-03/T-04 land.
 *
 * Strategy:
 *  - Node side: read lib/catalog/zonas.json and extract IDs.
 *  - Deno side: parse config.ts as text, extract the ServicioZona type
 *    union literals + the consultar_disponibilidad zona enum array.
 *  - Assert set equality.
 *  - Assert santo_domingo is present on both sides.
 *
 * W-01 extension: also asserts servicios.json IDs match CATALOGO_SERVICIOS keys
 * to prevent the alimentario_mensual class of silent desync bugs for services.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ZONAS_JSON_PATH = resolve(__dirname, '../lib/catalog/zonas.json')
const SERVICIOS_JSON_PATH = resolve(__dirname, '../lib/catalog/servicios.json')
const CONFIG_PATH = resolve(__dirname, '../supabase/functions/agent-runner/config.ts')

/**
 * Parse the zona enum array from the consultar_disponibilidad tool schema.
 * Looks for: enum: ["sur", "norte", "virtual", "valle", "domicilio", ...]
 * inside the consultar_disponibilidad block in config.ts.
 */
function extractZonasFromConfigTs() {
  const src = readFileSync(CONFIG_PATH, 'utf-8')

  // Find the consultar_disponibilidad tool definition block
  const consultar = src.indexOf('"consultar_disponibilidad"')
  if (consultar === -1) throw new Error('"consultar_disponibilidad" tool not found in config.ts')

  // Within that block, find the zona property and its enum array
  // Pattern: zona\b ... enum: [...zone strings...]
  const block = src.slice(consultar, consultar + 2000)

  // Find the zona property block (may be quoted or unquoted key in TypeScript object)
  const zonaIdx = block.search(/["']?zona["']?\s*:/)
  if (zonaIdx === -1) throw new Error('"zona" property not found in consultar_disponibilidad block')

  // Extract the enum array
  const zonaBlock = block.slice(zonaIdx, zonaIdx + 500)
  const enumMatch = zonaBlock.match(/enum:\s*\[([^\]]+)\]/)
  if (!enumMatch) throw new Error('zona enum array not found in config.ts tool schema')

  // Parse the string values from the array
  const zones = [...enumMatch[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
  return new Set(zones)
}

describe('Catalog parity: lib/catalog/zonas.json ⇄ agent-runner/config.ts', () => {
  it('lib/catalog/zonas.json exists', () => {
    expect(existsSync(ZONAS_JSON_PATH), 'lib/catalog/zonas.json must exist').toBe(true)
  })

  it('zonas.json is valid JSON with an array of zone objects', () => {
    const raw = readFileSync(ZONAS_JSON_PATH, 'utf-8')
    const data = JSON.parse(raw)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })

  it('every zone in zonas.json has required fields: id, label, tier', () => {
    const zones = JSON.parse(readFileSync(ZONAS_JSON_PATH, 'utf-8'))
    for (const z of zones) {
      expect(z.id, `zone missing id`).toBeTruthy()
      expect(z.label, `${z.id} missing label`).toBeTruthy()
      expect(z.tier, `${z.id} missing tier`).toBeTruthy()
    }
  })

  it('zonas.json includes santo_domingo', () => {
    const zones = JSON.parse(readFileSync(ZONAS_JSON_PATH, 'utf-8'))
    const ids = zones.map(z => z.id)
    expect(ids).toContain('santo_domingo')
  })

  it('config.ts zona enum includes santo_domingo', () => {
    const zonas = extractZonasFromConfigTs()
    expect(zonas.has('santo_domingo')).toBe(true)
  })

  it('zone IDs in zonas.json match zone enum in config.ts tool schema', () => {
    const jsonZones = new Set(JSON.parse(readFileSync(ZONAS_JSON_PATH, 'utf-8')).map(z => z.id))
    const configZones = extractZonasFromConfigTs()

    const inJsonNotConfig = [...jsonZones].filter(z => !configZones.has(z))
    const inConfigNotJson = [...configZones].filter(z => !jsonZones.has(z))

    expect(
      inJsonNotConfig,
      `Zones in zonas.json but not in config.ts: ${inJsonNotConfig.join(', ')}`
    ).toHaveLength(0)

    expect(
      inConfigNotJson,
      `Zones in config.ts but not in zonas.json: ${inConfigNotJson.join(', ')}`
    ).toHaveLength(0)
  })

  it('santo_domingo tier is presencial (same as norte/sur)', () => {
    const zones = JSON.parse(readFileSync(ZONAS_JSON_PATH, 'utf-8'))
    const sd = zones.find(z => z.id === 'santo_domingo')
    expect(sd).not.toBeNull()
    expect(sd.tier).toBe('presencial')
  })
})

/**
 * Extract service IDs from CATALOGO_SERVICIOS in config.ts.
 * Matches top-level object keys inside the `export const CATALOGO_SERVICIOS = { ... }` block.
 */
function extractServiciosFromConfigTs() {
  const src = readFileSync(CONFIG_PATH, 'utf-8')

  // Find the CATALOGO_SERVICIOS object
  const start = src.indexOf('export const CATALOGO_SERVICIOS')
  if (start === -1) throw new Error('CATALOGO_SERVICIOS not found in config.ts')

  // Slice to the closing `};` — roughly 200 lines, so 8000 chars is safe
  const block = src.slice(start, start + 8000)

  // Find the opening brace
  const braceIdx = block.indexOf('{')
  if (braceIdx === -1) throw new Error('CATALOGO_SERVICIOS opening brace not found')

  // Walk forward tracking brace depth to find the closing `}`
  let depth = 0
  let closeIdx = -1
  for (let i = braceIdx; i < block.length; i++) {
    if (block[i] === '{') depth++
    else if (block[i] === '}') {
      depth--
      if (depth === 0) { closeIdx = i; break }
    }
  }
  if (closeIdx === -1) throw new Error('CATALOGO_SERVICIOS closing brace not found')

  const body = block.slice(braceIdx + 1, closeIdx)

  // Top-level keys are unquoted identifiers or quoted strings at depth=0
  // Pattern: line starts with optional whitespace then `key:` (TS object shorthand)
  const ids = new Set()
  // Match top-level keys: identifier or quoted string followed by a colon
  const keyPattern = /^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm
  let m
  while ((m = keyPattern.exec(body)) !== null) {
    // Only top-level keys have exactly one level of indentation (2 spaces)
    // We detect "top-level" by checking that the key is a direct property of the catalog
    // (inner props like `id:`, `label:` etc are nested). We extract all keys and then filter
    // by matching them against the servicios.json IDs — but that creates a circular dependency.
    // Instead, extract all candidate keys and let the set-equality assertion surface mismatches.
    ids.add(m[1])
  }

  // Filter to only the known service-level keys by removing nested property names.
  // We know nested props from the Servicio shape: id, label, precio, duracion_min, categoria,
  // agendable, modalidades, zonas_permitidas, requiere_adelanto, permite_combo, derivacion_motivo.
  const NESTED_PROPS = new Set([
    'id', 'label', 'precio', 'duracion_min', 'categoria',
    'agendable', 'modalidades', 'zonas_permitidas', 'requiere_adelanto',
    'permite_combo', 'derivacion_motivo',
  ])
  return new Set([...ids].filter(k => !NESTED_PROPS.has(k)))
}

describe('Catalog parity: lib/catalog/servicios.json ⇄ agent-runner/config.ts (W-01)', () => {
  it('lib/catalog/servicios.json exists', () => {
    expect(existsSync(SERVICIOS_JSON_PATH), 'lib/catalog/servicios.json must exist').toBe(true)
  })

  it('servicios.json is valid JSON with an array of service objects', () => {
    const raw = readFileSync(SERVICIOS_JSON_PATH, 'utf-8')
    const data = JSON.parse(raw)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })

  it('every service in servicios.json has required fields: id, label, precio', () => {
    const services = JSON.parse(readFileSync(SERVICIOS_JSON_PATH, 'utf-8'))
    for (const s of services) {
      expect(s.id, 'service missing id').toBeTruthy()
      expect(s.label, `${s.id} missing label`).toBeTruthy()
      expect(typeof s.precio, `${s.id} precio must be a number`).toBe('number')
    }
  })

  it('service IDs in servicios.json match CATALOGO_SERVICIOS keys in config.ts', () => {
    const jsonIds = new Set(JSON.parse(readFileSync(SERVICIOS_JSON_PATH, 'utf-8')).map(s => s.id))
    const configIds = extractServiciosFromConfigTs()

    const inJsonNotConfig = [...jsonIds].filter(id => !configIds.has(id))
    const inConfigNotJson = [...configIds].filter(id => !jsonIds.has(id))

    expect(
      inJsonNotConfig,
      `Services in servicios.json but not in config.ts CATALOGO_SERVICIOS: ${inJsonNotConfig.join(', ')}`
    ).toHaveLength(0)

    expect(
      inConfigNotJson,
      `Services in config.ts CATALOGO_SERVICIOS but not in servicios.json: ${inConfigNotJson.join(', ')}`
    ).toHaveLength(0)
  })

  it('both sides have the same service count', () => {
    const jsonIds = JSON.parse(readFileSync(SERVICIOS_JSON_PATH, 'utf-8')).map(s => s.id)
    const configIds = extractServiciosFromConfigTs()
    expect(jsonIds.length).toBe(configIds.size)
  })
})

describe('SYSTEM_PROMPT — santo_domingo zone rules', () => {
  it('SYSTEM_PROMPT contains santo_domingo', () => {
    const src = readFileSync(CONFIG_PATH, 'utf-8')
    const match = src.match(/export const SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/)
    const prompt = match ? match[1] : ''
    expect(prompt).toContain('santo_domingo')
  })

  it('SYSTEM_PROMPT does not enumerate specific exception dates', () => {
    const src = readFileSync(CONFIG_PATH, 'utf-8')
    const match = src.match(/export const SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;/)
    const prompt = match ? match[1] : ''
    // Should not contain specific ISO dates in the prompt (spec R-SP-02)
    expect(prompt).not.toMatch(/202[0-9]-[0-1][0-9]-[0-3][0-9]/)
  })
})
