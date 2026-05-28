import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/app/dashboard/components/HorariosEspecialesCard.jsx', () => ({
  HorariosEspecialesCard: () => React.createElement('div', { 'data-testid': 'horarios-especiales-card' }),
}))

vi.mock('@/app/dashboard/components/ManualAppointmentDialog.jsx', () => ({
  ManualAppointmentDialog: () => null,
}))

vi.mock('@/app/dashboard/components/appointment-import-dialog.jsx', () => ({
  AppointmentImportDialog: () => null,
}))

vi.mock('@/app/dashboard/components/CitasCalendar.jsx', () => ({
  CitasCalendar: () => React.createElement('div', { 'data-testid': 'citas-calendar' }),
}))

import { CitasAgendaView } from '@/app/dashboard/tabs/CitasTab.jsx'

describe('CitasAgendaView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders an imported appointment through the normal CRM agenda path even when the patient has no phone yet', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CitasAgendaView, {
        citas: [
          {
            id: 'cita-importada-1',
            fecha: '2026-06-10',
            hora: '09:00:00',
            estado: 'confirmada',
            modalidad: 'presencial',
            servicio: 'alimentario_exclusivo',
            import_source: 'csv',
            paciente: {
              nombre: 'Ana Torres',
              telefono: null,
              zona: 'norte',
            },
            pagos: [],
          },
        ],
        loading: false,
        actionLoading: null,
        manualError: '',
        importError: '',
        importResult: null,
        clearManualError: () => {},
        clearImportFeedback: () => {},
        handleEstado: () => {},
        handleVerificarPago: () => {},
        handleReagendar: () => {},
        handleCreateManual: () => {},
        handleImportCsv: () => {},
        openVoucher: () => {},
      }),
    )

    expect(markup).toContain('Agenda de Citas')
    expect(markup).toContain('Ana Torres')
    expect(markup).toContain('2026-06-10')
    expect(markup).toContain('09:00')
    expect(markup).toContain('Plan Alimentario Exclusivo')
  })
})
