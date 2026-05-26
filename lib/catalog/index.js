/**
 * lib/catalog/index.js
 *
 * Thin Node re-export for the shared catalog JSON files.
 * Consumed by lib/servicios.js (Node/CRM side).
 * The Deno side (config.ts) imports the JSON files directly.
 */

import zonas from './zonas.json'
import servicios from './servicios.json'

export const ZONAS_CATALOG = zonas

export const SERVICIOS_CATALOG = servicios

/**
 * Returns a zone object by id, or null if not found.
 * @param {string} id
 */
export function getZona(id) {
  return ZONAS_CATALOG.find(z => z.id === id) ?? null
}

/**
 * Returns all zone IDs as a Set for O(1) lookup.
 * @returns {Set<string>}
 */
export function getZonaIds() {
  return new Set(ZONAS_CATALOG.map(z => z.id))
}
