export const SERVICIOS = {
  inbody: { label: 'Evaluación InBody 270', precio: 20 },
  virtual: { label: 'Consulta Virtual', precio: 20 },
  quincenal: { label: 'Plan Quincenal', precio: 25 },
  esencial: { label: 'Plan Esencial', precio: 35 },
  premium: { label: 'Plan Mensual Premium', precio: 70 },
  trimestral: { label: 'Plan Trimestral', precio: 90 },
}

export function getServicioLabel(id) {
  if (!id) return ''
  return SERVICIOS[id]?.label || id
}

export function getServicioPrecio(id) {
  if (!id) return null
  return SERVICIOS[id]?.precio ?? null
}
