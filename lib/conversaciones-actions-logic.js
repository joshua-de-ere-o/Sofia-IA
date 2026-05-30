/**
 * lib/conversaciones-actions-logic.js
 *
 * Lógica pura (sin Supabase ni Next.js) para las server actions de
 * conversaciones. Se mantiene aparte para poder testear sin levantar la
 * maquinaria de Server Actions — mismo enfoque que lib/excepciones-logic.js.
 */

/**
 * Validar la lista de ids a borrar.
 *
 * @param {unknown} ids
 * @returns {{ ok: true, ids: string[] } | { ok: false, message: string }}
 */
export function validateConversacionIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, message: 'No hay conversaciones seleccionadas.' }
  }

  const clean = ids.filter((id) => typeof id === 'string' && id.trim() !== '')
  if (clean.length !== ids.length) {
    return { ok: false, message: 'Hay ids de conversación inválidos en la selección.' }
  }

  // Deduplicar para no pedir el mismo borrado dos veces.
  return { ok: true, ids: [...new Set(clean)] }
}
