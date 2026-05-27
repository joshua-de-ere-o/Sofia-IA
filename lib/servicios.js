// Single source of truth: lib/catalog/servicios.json
// This file re-exports the catalog and preserves the existing public API surface
// so all CRM consumers continue to work without changes.

import { SERVICIOS_CATALOG } from './catalog/index.js'

/**
 * SERVICIOS — indexed by id for O(1) lookup.
 * Built at module load from the shared catalog JSON.
 * @type {Record<string, object>}
 */
export const SERVICIOS = Object.fromEntries(
  SERVICIOS_CATALOG.map(s => [s.id, s])
)

export function getServicioLabel(id) {
  if (!id) return ''
  return SERVICIOS[id]?.label ?? id
}

export function getServicioPrecio(id) {
  if (!id) return null
  return SERVICIOS[id]?.precio ?? null
}

export function getServicio(id) {
  return SERVICIOS[id] ?? null
}
