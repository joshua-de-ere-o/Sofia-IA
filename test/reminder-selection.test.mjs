import { describe, expect, it } from 'vitest'

import { collectPendingAppointmentReminders } from '@/supabase/functions/enviar-recordatorios/reminder-selection.ts'

describe('collectPendingAppointmentReminders', () => {
  it('selects a safely linked imported appointment for the 24h reminder pipeline', () => {
    const reminders = collectPendingAppointmentReminders([
      {
        id: 'cita-importada-1',
        fecha: '2026-06-10',
        hora: '09:00:00',
        modalidad: 'presencial',
        zona: 'norte',
        estado: 'confirmada',
        servicio: 'alimentario_exclusivo',
        import_source: 'csv',
        reminder_24h_sent: false,
        reminder_2h_sent: false,
        pacientes: {
          nombre: 'Ana Torres',
          telefono: '593999999999',
        },
      },
      // 24h20m antes de la cita — dentro de la ventana nueva [24h10m, 24h40m].
    ], new Date('2026-06-09T08:40:00'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toMatchObject({
      citaId: 'cita-importada-1',
      reminderType: '24h',
      phone: '593999999999',
    })
  })

  it('skips unlinked imported appointments and still selects the linked one once it is inside the 2h window', () => {
    const reminders = collectPendingAppointmentReminders([
      {
        id: 'cita-sin-telefono',
        fecha: '2026-06-10',
        hora: '11:00:00',
        modalidad: 'presencial',
        zona: 'norte',
        estado: 'confirmada',
        import_source: 'csv',
        reminder_24h_sent: false,
        reminder_2h_sent: false,
        pacientes: {
          nombre: 'Paciente sin link',
          telefono: null,
        },
      },
      {
        id: 'cita-linkeada-2h',
        fecha: '2026-06-10',
        hora: '11:00:00',
        modalidad: 'virtual',
        zona: null,
        estado: 'confirmada',
        import_source: 'csv',
        reminder_24h_sent: true,
        reminder_2h_sent: false,
        pacientes: {
          nombre: 'Ana Torres',
          telefono: '593999999999',
        },
      },
    ], new Date('2026-06-10T09:00:00'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0]).toMatchObject({
      citaId: 'cita-linkeada-2h',
      reminderType: '2h',
      phone: '593999999999',
    })
  })
})
