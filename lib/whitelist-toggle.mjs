export async function toggleWhitelistActivaPersisted({ currentValue, updateFn }) {
  const nextValue = !currentValue

  try {
    const res = await updateFn({ whitelist_activa: nextValue })
    if (res?.error) return { ok: false, nextValue, error: res.error }
    return { ok: true, nextValue }
  } catch (err) {
    return { ok: false, nextValue, error: err?.message || String(err) }
  }
}
