/**
 * test/catalog-sync.test.mjs
 *
 * Post-unification invariant: lib/servicios.js (Node/CRM) and
 * supabase/functions/agent-runner/config.ts (Deno/Edge) MUST both
 * read from lib/catalog/servicios.json — the single source of truth.
 *
 * Previously this test compared two duplicated catalogs. After the
 * unification (refactor/unify-servicios-catalog), the duplication is
 * gone and this test just guards the invariant so nobody re-introduces
 * a hardcoded catalog on either side.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { SERVICIOS } from '../lib/servicios.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '../supabase/functions/agent-runner/config.ts')
const NODE_CATALOG_PATH = resolve(__dirname, '../lib/catalog/index.js')

describe('Catalog source-of-truth invariant', () => {
  it('config.ts (Deno side) imports the shared servicios.json', () => {
    const src = readFileSync(CONFIG_PATH, 'utf-8')
    expect(
      src,
      'config.ts must import from lib/catalog/servicios.json — do not hardcode a service list here'
    ).toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/lib\/catalog\/servicios\.json['"]/)
  })

  it('config.ts builds CATALOGO_SERVICIOS from the imported data (no inline literal object)', () => {
    const src = readFileSync(CONFIG_PATH, 'utf-8')
    // The unified pattern is: CATALOGO_SERVICIOS = Object.fromEntries(...)
    // A regression would re-introduce a literal: CATALOGO_SERVICIOS = { alimentario_quincenal: {...
    expect(src).toMatch(/CATALOGO_SERVICIOS[^=]*=\s*Object\.fromEntries/)
  })

  it('lib/catalog/index.js (Node side) imports the shared servicios.json', () => {
    const src = readFileSync(NODE_CATALOG_PATH, 'utf-8')
    expect(src).toMatch(/from\s+['"]\.\/servicios\.json['"]/)
  })

  it('SERVICIOS on the Node side is non-empty and has the expected shape', () => {
    const ids = Object.keys(SERVICIOS)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const s = SERVICIOS[id]
      expect(s.id, `${id} missing id`).toBe(id)
      expect(s.label, `${id} missing label`).toBeTruthy()
      expect(typeof s.precio, `${id} precio must be a number`).toBe('number')
    }
  })
})
