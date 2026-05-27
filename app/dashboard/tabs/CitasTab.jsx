'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Filter, List, CalendarRange } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCitas } from '../hooks/useCitas'
import { CitasTable } from '../components/CitasTable'
import { CitaCard } from '../components/CitaCard'
import { CitasCalendar } from '../components/CitasCalendar'
import { HorariosEspecialesCard } from '../components/HorariosEspecialesCard'
import { ManualAppointmentDialog } from '../components/ManualAppointmentDialog'

export function CitasTab() {
  const {
    citas,
    loading,
    actionLoading,
    manualError,
    clearManualError,
    handleEstado,
    handleVerificarPago,
    handleReagendar,
    handleCreateManual,
    openVoucher,
  } = useCitas()

  const today = new Date().toISOString().split('T')[0]
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [fechaFiltro, setFechaFiltro] = useState(today)
  const [vista, setVista] = useState('lista')
  const [showLoading, setShowLoading] = useState(false)
  const [manualDialogOpen, setManualDialogOpen] = useState(false)

  useEffect(() => {
    if (!loading) {
      setShowLoading(false)
      return
    }
    const t = setTimeout(() => setShowLoading(true), 250)
    return () => clearTimeout(t)
  }, [loading])

  const citasFiltradas = citas.filter((cita) => {
    const matchEstado = estadoFiltro === 'todos' || cita.estado === estadoFiltro
    const matchFecha = !fechaFiltro || cita.fecha === fechaFiltro
    return matchEstado && matchFecha
  })

  const citasParaCalendario = citas.filter(
    (cita) => estadoFiltro === 'todos' || cita.estado === estadoFiltro,
  )

  const emptyMessage = loading
    ? showLoading
      ? 'Cargando citas...'
      : ''
    : vista === 'calendario' && fechaFiltro
      ? 'No hay citas para el día seleccionado.'
      : 'No hay citas con los filtros actuales.'

  const hasFilters = estadoFiltro !== 'todos' || fechaFiltro

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h2 className="text-lg font-semibold">Agenda de Citas</h2>
          <p className="text-sm text-muted-foreground">Revisa las citas agendadas y pendientes.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setVista('lista')}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors',
                vista === 'lista'
                  ? 'bg-kely-teal text-kely-green'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="h-3.5 w-3.5" />
              Lista
            </button>
            <button
              type="button"
              onClick={() => setVista('calendario')}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors',
                vista === 'calendario'
                  ? 'bg-kely-teal text-kely-green'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Calendario
            </button>
          </div>

          <div className="relative">
            <Filter className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
              className="flex h-8 w-36 rounded-md border border-input bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green appearance-none cursor-pointer"
            >
              <option value="todos">Todos los Estados</option>
              <option value="confirmada">Confirmada</option>
              <option value="pendiente_pago">Pdte. Pago</option>
              <option value="completada">Completada</option>
              <option value="no_show">No Show</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>

          {vista === 'lista' && (
            <div className="relative">
              <input
                type="date"
                value={fechaFiltro}
                onChange={(e) => setFechaFiltro(e.target.value)}
                className="flex h-8 w-36 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green cursor-pointer text-muted-foreground"
              />
            </div>
          )}

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setEstadoFiltro('todos'); setFechaFiltro('') }}
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
            >
              Quitar Filtros
            </Button>
          )}

          <Button onClick={() => { clearManualError(); setManualDialogOpen(true) }}>
            Agendar cita
          </Button>
        </div>
      </div>

      {vista === 'calendario' && (
        <CitasCalendar
          citas={citasParaCalendario}
          selectedDate={fechaFiltro}
          onSelectDate={setFechaFiltro}
        />
      )}

      <div className="hidden md:block">
        <CitasTable
          citas={citasFiltradas}
          actionLoading={actionLoading}
          onEstado={handleEstado}
          onVerificarPago={handleVerificarPago}
          onReagendar={handleReagendar}
          onOpenVoucher={openVoucher}
          emptyMessage={emptyMessage}
        />
      </div>

      <div className="md:hidden flex flex-col gap-3">
        {citasFiltradas.length === 0 ? (
          <div className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          citasFiltradas.map((cita) => (
            <CitaCard
              key={cita.id}
              cita={cita}
              actionLoading={actionLoading}
              onEstado={handleEstado}
              onVerificarPago={handleVerificarPago}
              onReagendar={handleReagendar}
              onOpenVoucher={openVoucher}
            />
          ))
        )}
      </div>

      {/* Horarios especiales — collapsible card below agenda (ADR-7) */}
      <HorariosEspecialesCard />

      <ManualAppointmentDialog
        open={manualDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) clearManualError()
          setManualDialogOpen(nextOpen)
        }}
        onSubmit={handleCreateManual}
        loading={actionLoading === 'manual-create'}
        errorMessage={manualError}
        onCreated={(result) => {
          if (result?.date) setFechaFiltro(result.date)
        }}
      />
    </div>
  )
}
