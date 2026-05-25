/**
 * test/pre-filter.test.mjs
 *
 * Contract tests for the pre-filter + normalization pipeline.
 * Tests the full path: normalizeYCloudPayload (inside route.js) → preFilter.
 *
 * Because normalizeYCloudPayload is NOT exported, we test the observable contract:
 * given a raw YCloud payload, what does preFilter return after normalization?
 * We do this by testing preFilter directly with pre-normalized payloads
 * (valid approach per design §5 ADR-5: "test pre-filter directly with
 * an already-normalized type:'image' payload").
 *
 * Covers:
 *   S1-prefilter  — document with image/jpeg mime → normalized type:'image' → action:'pass'
 *   S3-prefilter  — document with application/pdf → type unchanged → action:'unsupported'
 *   S6-prefilter  — document with null doc → action:'unsupported', no throw
 *   S6-prefilter  — document with empty mime → action:'unsupported', no throw
 *   Smoke text    — text type → action:'pass'
 *   Smoke image   — native image type → action:'pass'
 *   Smoke audio   — audio type → action:'unsupported'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase — pre-filter queries blocklist, configuracion, conversaciones.
// Return empty (no block, no handoff) so type-routing is the deciding factor.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table) => {
      if (table === 'blocklist') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
      }
      if (table === 'configuracion') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { blocklist_numeros: [] }, error: null })) }
      }
      if (table === 'conversaciones') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { handoff_activo: false }, error: null })) }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
    }),
  })),
}))

import { preFilter } from '../lib/pre-filter.js'

/** Build a normalized message.created payload (as normalizeYCloudPayload would produce) */
function normalizedPayload(type, extras = {}) {
  return {
    type: 'message.created',
    message: {
      id: 'test-id',
      wamid: 'wamid-test',
      from: '+593999000111',
      from_me: false,
      type,
      ...extras,
    },
  }
}

describe('pre-filter contract — type routing', () => {
  // S1-prefilter: after normalization, document-image appears as type:'image' → pass
  it('S1: normalized image type (from document-image) → action:pass', async () => {
    const payload = normalizedPayload('image', {
      image: { url: 'https://cdn.ycloud.com/abc123', mime_type: 'image/jpeg' },
    })
    const result = await preFilter(payload)
    expect(result.action).toBe('pass')
  })

  // S3-prefilter: PDF document stays type:'document' after normalization → unsupported
  it('S3: document type (pdf) stays as document → action:unsupported', async () => {
    const payload = normalizedPayload('document', {
      document: { mime_type: 'application/pdf', link: 'https://cdn.ycloud.com/doc789' },
    })
    const result = await preFilter(payload)
    expect(result.action).toBe('unsupported')
    expect(result.reply).toBeDefined()
  })

  // S6-prefilter: document with null doc → no throw, unsupported
  it('S6: document type with null document field → no throw, action:unsupported', async () => {
    const payload = normalizedPayload('document', { document: null })
    await expect(preFilter(payload)).resolves.toMatchObject({ action: 'unsupported' })
  })

  // S6-prefilter: document with empty mime → no throw, unsupported
  it('S6: document type with empty mime_type → no throw, action:unsupported', async () => {
    const payload = normalizedPayload('document', {
      document: { mime_type: '' },
    })
    await expect(preFilter(payload)).resolves.toMatchObject({ action: 'unsupported' })
  })

  // Smoke: text passes
  it('smoke: text type → action:pass', async () => {
    const payload = normalizedPayload('text', { text: { body: 'hola' } })
    const result = await preFilter(payload)
    expect(result.action).toBe('pass')
  })

  // Smoke: native image passes
  it('smoke: native image type → action:pass', async () => {
    const payload = normalizedPayload('image', {
      image: { url: 'https://cdn.ycloud.com/img000', mime_type: 'image/jpeg' },
    })
    const result = await preFilter(payload)
    expect(result.action).toBe('pass')
  })

  // Smoke: audio unsupported
  it('smoke: audio type → action:unsupported', async () => {
    const payload = normalizedPayload('audio', { audio: { url: 'https://cdn.ycloud.com/audio.ogg' } })
    const result = await preFilter(payload)
    expect(result.action).toBe('unsupported')
  })
})
