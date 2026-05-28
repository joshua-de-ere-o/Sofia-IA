import { calcularPrecio } from '@/lib/calcular-precio-logic.js'
import { getServicio } from '@/lib/servicios.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const HEADER_ALIASES = {
  nombre: 'patientName',
  paciente: 'patientName',
  nombrepaciente: 'patientName',
  nombredelpaciente: 'patientName',
  fecha: 'date',
  fechacita: 'date',
  hora: 'time',
  horacita: 'time',
  dia: 'dayLabel',
}

function stripAccents(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeHeader(value) {
  return stripAccents(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeDayLabel(value) {
  return normalizeWhitespace(stripAccents(value)).toLowerCase()
}

function getWeekdayLabel(dateIso) {
  const date = new Date(`${dateIso}T12:00:00Z`)
  return ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][date.getUTCDay()]
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (character === ',' && !insideQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += character
  }

  cells.push(current)
  return cells
}

function parseCsvText(csvText) {
  const text = String(csvText ?? '').replace(/^\uFEFF/, '').trim()
  if (!text) return { headers: [], rows: [] }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return { headers: [], rows: [] }

  const rawHeaders = parseCsvLine(lines[0])
  const headers = rawHeaders.map((header) => HEADER_ALIASES[normalizeHeader(header)] ?? normalizeHeader(header))
  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line)
    const record = {}
    headers.forEach((header, headerIndex) => {
      record[header] = values[headerIndex] ?? ''
    })

    return {
      rowNumber: index + 2,
      record,
    }
  })

  return { headers, rows }
}

export function normalizeImportedPatientName(value) {
  return normalizeWhitespace(value)
}

export function normalizeComparablePatientName(value) {
  return stripAccents(normalizeImportedPatientName(value)).toLowerCase()
}

export function normalizeImportedDate(value) {
  const input = normalizeWhitespace(value)
  if (!input) return { ok: false, reason: 'missing_date' }

  if (DATE_RE.test(input)) {
    return { ok: true, value: input }
  }

  const numeric = input.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (!numeric) return { ok: false, reason: 'invalid_date' }

  const day = Number(numeric[1])
  const month = Number(numeric[2])
  const year = Number(numeric[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return { ok: false, reason: 'invalid_date' }
  }

  return {
    ok: true,
    value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

export function normalizeImportedTime(value) {
  const input = normalizeWhitespace(value)
  if (!input) return { ok: false, reason: 'missing_time' }

  const twelveHour = input.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i)
  if (twelveHour) {
    let hour = Number(twelveHour[1])
    const minutes = Number(twelveHour[2])
    const meridiem = twelveHour[3].toLowerCase()

    if (minutes > 59 || hour < 1 || hour > 12) return { ok: false, reason: 'invalid_time' }
    if (hour === 12) hour = 0
    if (meridiem === 'p') hour += 12

    return { ok: true, value: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00` }
  }

  const twentyFourHour = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!twentyFourHour) return { ok: false, reason: 'invalid_time' }

  const hour = Number(twentyFourHour[1])
  const minutes = Number(twentyFourHour[2])
  const seconds = Number(twentyFourHour[3] ?? '0')

  if (hour > 23 || minutes > 59 || seconds > 59) {
    return { ok: false, reason: 'invalid_time' }
  }

  return {
    ok: true,
    value: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
  }
}

export function buildAppointmentImportKey({ patientName, date, time }) {
  return [date, time, normalizeComparablePatientName(patientName)].join('|')
}

function validateImportDefaults(defaults = {}) {
  const serviceId = normalizeWhitespace(defaults.service)
  const modalidad = normalizeWhitespace(defaults.modalidad)
  const zona = normalizeWhitespace(defaults.zona)
  const estado = normalizeWhitespace(defaults.estado)
  const motivo = normalizeWhitespace(defaults.motivo)

  if (!serviceId || !modalidad || !zona || !estado || !motivo) {
    return { error: 'Completá servicio, modalidad, zona, estado y motivo para importar.' }
  }

  const service = getServicio(serviceId)
  if (!service?.agendable) {
    return { error: 'Seleccioná un servicio agendable para la importación.' }
  }

  if (!service.modalidades.includes(modalidad)) {
    return { error: 'La modalidad elegida no aplica para ese servicio.' }
  }

  if (!service.zonas_permitidas.includes(zona)) {
    return { error: 'La zona elegida no aplica para ese servicio.' }
  }

  const pricing = calcularPrecio(serviceId, zona)
  if (pricing.error) {
    return { error: 'No se pudo calcular el precio para ese servicio y zona.' }
  }

  return {
    defaults: {
      service: serviceId,
      modalidad,
      zona,
      estado,
      motivo,
      durationMinutes: service.duracion_min || 30,
      pricing,
    },
  }
}

export function prepareAppointmentImportRows(csvText, { defaults, existingKeys = new Set() } = {}) {
  const defaultsValidation = validateImportDefaults(defaults)
  if (defaultsValidation.error) {
    return { error: defaultsValidation.error, imported: 0, duplicates: 0, warnings: 0, rejected: 0, rows: [] }
  }

  const { rows: parsedRows } = parseCsvText(csvText)
  if (parsedRows.length === 0) {
    return { error: 'El archivo CSV no tiene filas para importar.', imported: 0, duplicates: 0, warnings: 0, rejected: 0, rows: [] }
  }

  const rows = []
  const fileKeys = new Set()

  for (const parsedRow of parsedRows) {
    const warnings = []
    const patientName = normalizeImportedPatientName(parsedRow.record.patientName)
    if (!patientName) {
      rows.push({ ...parsedRow, status: 'rejected', warnings, rejectionReason: 'missing_name' })
      continue
    }

    const date = normalizeImportedDate(parsedRow.record.date)
    if (!date.ok) {
      rows.push({ ...parsedRow, patientName, status: 'rejected', warnings, rejectionReason: date.reason })
      continue
    }

    const time = normalizeImportedTime(parsedRow.record.time)
    if (!time.ok) {
      rows.push({ ...parsedRow, patientName, date: date.value, status: 'rejected', warnings, rejectionReason: time.reason })
      continue
    }

    const dayLabel = normalizeDayLabel(parsedRow.record.dayLabel)
    if (dayLabel && dayLabel !== getWeekdayLabel(date.value)) {
      warnings.push('day_mismatch')
    }

    const patientNameNormalized = normalizeComparablePatientName(patientName)
    const importKey = buildAppointmentImportKey({ patientName, date: date.value, time: time.value })
    let status = 'ready'
    let duplicateScope = null

    if (fileKeys.has(importKey)) {
      status = 'duplicate'
      duplicateScope = 'file'
    } else if (existingKeys.has(importKey)) {
      status = 'duplicate'
      duplicateScope = 'database'
    }

    if (status === 'ready') {
      fileKeys.add(importKey)
    }

    rows.push({
      ...parsedRow,
      patientName,
      patientNameNormalized,
      date: date.value,
      time: time.value,
      importKey,
      dayLabel,
      status,
      duplicateScope,
      warnings,
      rejectionReason: null,
      defaults: defaultsValidation.defaults,
    })
  }

  return {
    imported: rows.filter((row) => row.status === 'ready').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    warnings: rows.filter((row) => row.warnings.length > 0).length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
    rows,
  }
}

function buildExistingAppointmentKey(row) {
  const patientName = row.patient_name_normalized || row.paciente?.nombre || ''
  if (!row.fecha || !row.hora || !patientName) return null
  return buildAppointmentImportKey({
    patientName,
    date: row.fecha,
    time: row.hora,
  })
}

function buildImportAuditRows(rows, batchId) {
  return rows.map((row) => ({
    batch_id: batchId,
    row_number: row.rowNumber,
    raw_payload: row.record,
    cleaned_payload: row.status === 'rejected'
      ? null
      : {
          patient_name: row.patientName,
          patient_name_normalized: row.patientNameNormalized,
          fecha: row.date,
          hora: row.time,
          servicio: row.defaults.service,
          modalidad: row.defaults.modalidad,
          zona: row.defaults.zona,
          estado: row.defaults.estado,
          motivo: row.defaults.motivo,
        },
    status: row.status,
    duplicate_scope: row.duplicateScope,
    warning_codes: row.warnings,
    rejection_reason: row.rejectionReason,
  }))
}

export async function importAppointmentsIntoCrm(supabase, { csvText, defaults, actorUserId = null, sourceFileName = 'appointments.csv' } = {}) {
  const parsed = parseCsvText(csvText)
  if (parsed.rows.length === 0) {
    return { error: 'El archivo CSV no tiene filas para importar.' }
  }

  const uniqueDates = [...new Set(parsed.rows.map((row) => normalizeImportedDate(row.record.date)).filter((row) => row.ok).map((row) => row.value))]
  const { data: existingAppointments, error: existingAppointmentsError } = await supabase
    .from('citas')
    .select('fecha, hora, patient_name_normalized, paciente:pacientes(nombre)')
    .in('fecha', uniqueDates)

  if (existingAppointmentsError) return { error: existingAppointmentsError.message }

  const existingKeys = new Set(
    (existingAppointments || [])
      .map(buildExistingAppointmentKey)
      .filter(Boolean),
  )

  const prepared = prepareAppointmentImportRows(csvText, { defaults, existingKeys })
  if (prepared.error) return { error: prepared.error }

  const { data: batch, error: batchError } = await supabase
    .from('citas_import_batches')
    .insert({
      source_file_name: sourceFileName,
      source_row_count: prepared.rows.length,
      created_by: actorUserId,
    })
    .select()
    .single()

  if (batchError) return { error: batchError.message }

  const readyRows = prepared.rows.filter((row) => row.status === 'ready')
  const exactNames = [...new Set(readyRows.map((row) => row.patientName))]
  const { data: existingPatients, error: existingPatientsError } = await supabase
    .from('pacientes')
    .select('id, nombre, telefono, zona')
    .in('nombre', exactNames)

  if (existingPatientsError) return { error: existingPatientsError.message }

  const patientsByNormalizedName = new Map()
  for (const patient of existingPatients || []) {
    const key = normalizeComparablePatientName(patient.nombre)
    const bucket = patientsByNormalizedName.get(key) || []
    bucket.push(patient)
    patientsByNormalizedName.set(key, bucket)
  }

  const createdPatientIds = new Map()

  for (const row of readyRows) {
    let patientId = createdPatientIds.get(row.patientNameNormalized) || null

    if (!patientId) {
      const existingMatches = patientsByNormalizedName.get(row.patientNameNormalized) || []
      if (existingMatches.length === 1) {
        patientId = existingMatches[0].id
      }
    }

    if (!patientId) {
      const { data: createdPatient, error: createPatientError } = await supabase
        .from('pacientes')
        .insert({
          nombre: row.patientName,
          telefono: null,
          zona: row.defaults.zona,
        })
        .select()
        .single()

      if (createPatientError) return { error: createPatientError.message }
      patientId = createdPatient.id
    }

    createdPatientIds.set(row.patientNameNormalized, patientId)

    const { error: createAppointmentError } = await supabase
      .from('citas')
      .insert({
        paciente_id: patientId,
        servicio: row.defaults.service,
        fecha: row.date,
        hora: row.time,
        duracion_min: row.defaults.durationMinutes,
        estado: row.defaults.estado,
        modalidad: row.defaults.modalidad,
        zona: row.defaults.zona,
        motivo: row.defaults.motivo,
        monto_adelanto: row.defaults.pricing.monto_adelanto,
        monto_total: row.defaults.pricing.precio_total,
        import_batch_id: batch.id,
        import_source: 'csv',
        patient_name_normalized: row.patientNameNormalized,
      })
      .select()
      .single()

    if (createAppointmentError) return { error: createAppointmentError.message }
  }

  const auditRows = buildImportAuditRows(prepared.rows, batch.id)
  const { error: auditError } = await supabase.from('citas_import_rows').insert(auditRows)
  if (auditError) return { error: auditError.message }

  const { error: batchUpdateError } = await supabase
    .from('citas_import_batches')
    .update({
      imported_count: prepared.imported,
      duplicate_count: prepared.duplicates,
      warning_count: prepared.warnings,
      rejected_count: prepared.rejected,
    })
    .eq('id', batch.id)

  if (batchUpdateError) return { error: batchUpdateError.message }

  return {
    status: 'ok',
    batchId: batch.id,
    imported: prepared.imported,
    duplicates: prepared.duplicates,
    warnings: prepared.warnings,
    rejected: prepared.rejected,
    rows: prepared.rows.map((row) => ({
      rowNumber: row.rowNumber,
      patientName: row.patientName || '',
      date: row.date || null,
      time: row.time || null,
      status: row.status,
      duplicateScope: row.duplicateScope,
      warnings: row.warnings,
      rejectionReason: row.rejectionReason,
    })),
  }
}
