import { SERVICIOS_CATALOG, ZONAS_CATALOG } from '@/lib/catalog/index.js'
import { calcularPrecio } from '@/lib/calcular-precio-logic.js'
import { getServicio } from '@/lib/servicios.js'

export const MANUAL_APPOINTMENT_ALLOWED_STATES = ['confirmada', 'pendiente_pago']
export const MANUAL_APPOINTMENT_REUSABLE_STATES = ['cancelada', 'no_show']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
// Ecuador mobile in E.164: +593 followed by 9 + 8 more digits (e.g. +593983480029)
const EC_MOBILE_E164_RE = /^\+5939\d{8}$/

/**
 * Normalizes an Ecuadorian phone number to E.164 (+593XXXXXXXXX), the format
 * the reminder sender (YCloud) requires. Accepts common local inputs:
 *   "0983480029"     -> "+593983480029"  (local with leading 0)
 *   "983480029"      -> "+593983480029"  (bare 9-digit mobile)
 *   "593983480029"   -> "+593983480029"  (country code without +)
 *   "+593983480029"  -> "+593983480029"  (already E.164)
 * Returns "" for empty input. Non-numeric chars (spaces, dashes) are stripped.
 * Does not validate length here — use validateManualAppointmentPayload for that.
 */
export function normalizeEcuadorPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('593')) return `+${digits}`
  if (digits.startsWith('0')) return `+593${digits.slice(1)}`
  return `+593${digits}`
}

export function normalizeManualAppointmentPayload(input = {}) {
  return {
    patientName: String(input.patientName ?? '').trim(),
    patientPhone: normalizeEcuadorPhone(input.patientPhone),
    patientBirthDate: String(input.patientBirthDate ?? '').trim(),
    service: String(input.service ?? '').trim(),
    date: String(input.date ?? '').trim(),
    time: String(input.time ?? '').trim(),
    modalidad: String(input.modalidad ?? '').trim(),
    zona: String(input.zona ?? '').trim(),
    estado: String(input.estado ?? '').trim(),
    motivo: String(input.motivo ?? '').trim(),
  }
}

export function getManualAppointmentFormOptions(serviceId, modalidad) {
  const services = SERVICIOS_CATALOG
    .filter((service) => service.agendable)
    .map((service) => ({ value: service.id, label: service.label }))

  const service = getServicio(serviceId) ?? SERVICIOS_CATALOG.find((item) => item.agendable) ?? null
  const resolvedModalidad = service?.modalidades?.includes(modalidad)
    ? modalidad
    : service?.modalidades?.[0] ?? 'presencial'

  const modalidades = (service?.modalidades ?? ['presencial']).map((value) => ({
    value,
    label: value === 'virtual' ? 'Virtual' : 'Presencial',
  }))

  const zonas = ZONAS_CATALOG
    .filter((zona) => (service?.zonas_permitidas ?? []).includes(zona.id))
    .filter((zona) => {
      if (resolvedModalidad === 'virtual') return zona.id === 'virtual'
      return zona.id !== 'virtual'
    })
    .map((zona) => ({
      value: zona.id,
      label: zona.id === 'virtual' ? 'Virtual' : zona.label,
    }))

  return {
    services,
    modalidades,
    zonas,
    estados: [
      { value: 'confirmada', label: 'Confirmada' },
      { value: 'pendiente_pago', label: 'Pendiente de pago' },
    ],
  }
}

export function validateManualAppointmentPayload(rawInput) {
  const input = normalizeManualAppointmentPayload(rawInput)

  if (!input.patientName || !input.patientPhone || !input.patientBirthDate || !input.service || !input.date || !input.time || !input.modalidad || !input.zona || !input.estado || !input.motivo) {
    return { error: 'Completá nombre, teléfono, fecha de nacimiento, servicio, fecha, hora, modalidad, zona, estado y motivo.' }
  }

  if (!DATE_RE.test(input.patientBirthDate) || !DATE_RE.test(input.date)) {
    return { error: 'Usá fechas válidas en formato YYYY-MM-DD.' }
  }

  if (!EC_MOBILE_E164_RE.test(input.patientPhone)) {
    return { error: 'El teléfono debe ser un celular de Ecuador válido (ej. 0983480029 o +593983480029).' }
  }

  if (!TIME_RE.test(input.time)) {
    return { error: 'Usá una hora válida en formato HH:MM.' }
  }

  if (!MANUAL_APPOINTMENT_ALLOWED_STATES.includes(input.estado)) {
    return { error: 'Estado manual inválido.' }
  }

  const service = getServicio(input.service)
  if (!service || !service.agendable) {
    return { error: 'Seleccioná un servicio agendable.' }
  }

  if (!service.modalidades.includes(input.modalidad)) {
    return { error: 'La modalidad elegida no aplica para ese servicio.' }
  }

  if (!service.zonas_permitidas.includes(input.zona)) {
    return { error: 'La zona elegida no aplica para ese servicio.' }
  }

  if (input.modalidad === 'virtual' && input.zona !== 'virtual') {
    return { error: 'Las citas virtuales deben usar la zona virtual.' }
  }

  if (input.modalidad !== 'virtual' && input.zona === 'virtual') {
    return { error: 'Las citas presenciales no pueden usar la zona virtual.' }
  }

  return { input, service }
}

export async function createManualAppointmentRecord(supabase, rawInput) {
  const validation = validateManualAppointmentPayload(rawInput)
  if (validation.error) return { error: validation.error }

  const { input, service } = validation
  const normalizedTime = `${input.time}:00`

  const { data: slotRows, error: slotError } = await supabase
    .from('citas')
    .select('id, estado')
    .eq('fecha', input.date)
    .eq('hora', normalizedTime)
    .not('estado', 'in', '(cancelada,no_show)')

  if (slotError) return { error: slotError.message }

  const activeConflicts = (slotRows ?? []).filter(
    (row) => !MANUAL_APPOINTMENT_REUSABLE_STATES.includes(row.estado),
  )

  if (activeConflicts.length > 0) {
    return { error: 'Ya existe una cita activa en ese horario. Elegí otro turno.' }
  }

  const pricing = calcularPrecio(input.service, input.zona)
  if (pricing.error) {
    return { error: 'No se pudo calcular el precio para ese servicio y zona.' }
  }

  const { data: existingPatient, error: patientLookupError } = await supabase
    .from('pacientes')
    .select('id, nombre, telefono, zona')
    .eq('telefono', input.patientPhone)
    .maybeSingle()

  if (patientLookupError) return { error: patientLookupError.message }

  let patientId = existingPatient?.id ?? null
  const patientPayload = {
    nombre: input.patientName,
    fecha_nacimiento: input.patientBirthDate,
  }

  if (existingPatient) {
    const { error: updateError } = await supabase
      .from('pacientes')
      .update(patientPayload)
      .eq('id', existingPatient.id)

    if (updateError) return { error: updateError.message }
  } else {
    const { data: createdPatient, error: createPatientError } = await supabase
      .from('pacientes')
      .insert({
        ...patientPayload,
        telefono: input.patientPhone,
        zona: input.zona,
      })
      .select()
      .single()

    if (createPatientError) return { error: createPatientError.message }
    patientId = createdPatient.id
  }

  const { data: createdAppointment, error: createAppointmentError } = await supabase
    .from('citas')
    .insert({
      paciente_id: patientId,
      servicio: input.service,
      fecha: input.date,
      hora: normalizedTime,
      duracion_min: service.duracion_min || 30,
      estado: input.estado,
      modalidad: input.modalidad,
      zona: input.zona,
      motivo: input.motivo,
      monto_adelanto: pricing.monto_adelanto,
      monto_total: pricing.precio_total,
    })
    .select()
    .single()

  if (createAppointmentError) return { error: createAppointmentError.message }

  return {
    success: true,
    citaId: createdAppointment.id,
    patientId,
    patientReused: Boolean(existingPatient),
  }
}
