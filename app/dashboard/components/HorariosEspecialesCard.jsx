'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { CalendarRange, Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import {
  listarExcepcionesProximas,
  crearExcepcionHorario,
  eliminarExcepcionHorario,
} from '@/app/dashboard/actions'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UBICACION_LABELS = {
  quito_extendido: 'Quito — horario extendido',
  solo_virtual: 'Solo virtual',
  santo_domingo: 'Santo Domingo',
}

const UBICACION_OPTIONS = [
  { value: 'quito_extendido', label: 'Quito — horario extendido' },
  { value: 'solo_virtual', label: 'Solo virtual' },
  { value: 'santo_domingo', label: 'Santo Domingo' },
]

const UBICACION_BADGE_VARIANT = {
  quito_extendido: 'secondary',
  solo_virtual: 'outline',
  santo_domingo: 'default',
}

function formatFecha(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ---------------------------------------------------------------------------
// HorariosEspecialesCard
// ---------------------------------------------------------------------------

export function HorariosEspecialesCard() {
  const [excepciones, setExcepciones] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const today = todayStr()
  const [fechaInicio, setFechaInicio] = useState(today)
  const [fechaFin, setFechaFin] = useState(today)
  const [ubicacion, setUbicacion] = useState('santo_domingo')
  const [horaFin, setHoraFin] = useState('19:30')
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  // Conflict / overlap alert state
  const [conflicts, setConflicts] = useState(null)   // Array<ConflictRow> | null
  const [overlaps, setOverlaps] = useState(null)     // string[] | null

  // Delete state
  const [deletingId, setDeletingId] = useState(null)

  const supabase = createClient()

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchExcepciones = useCallback(async () => {
    setLoadingList(true)
    const res = await listarExcepcionesProximas()
    if (!res.error) {
      setExcepciones(res.excepciones || [])
      // Auto-expand when there are upcoming exceptions
      if ((res.excepciones || []).length > 0) setExpanded(true)
    }
    setLoadingList(false)
  }, [])

  useEffect(() => {
    fetchExcepciones()
  }, [fetchExcepciones])

  // ---------------------------------------------------------------------------
  // Realtime subscription — refresh list on any change to excepciones_horario
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const channel = supabase
      .channel('excepciones_horario_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'excepciones_horario' },
        () => fetchExcepciones(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, fetchExcepciones])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const resetForm = () => {
    const t = todayStr()
    setFechaInicio(t)
    setFechaFin(t)
    setUbicacion('santo_domingo')
    setHoraFin('19:30')
    setMotivo('')
    setFormError(null)
    setConflicts(null)
    setOverlaps(null)
  }

  const handleFechaInicioChange = (val) => {
    setFechaInicio(val)
    // Keep fecha_fin >= fecha_inicio
    if (fechaFin < val) setFechaFin(val)
    setFormError(null)
    setConflicts(null)
    setOverlaps(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)
    setConflicts(null)
    setOverlaps(null)

    if (fechaFin < fechaInicio) {
      setFormError('La fecha de fin no puede ser anterior a la fecha de inicio.')
      return
    }

    setSaving(true)
    const result = await crearExcepcionHorario({
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      ubicacion,
      hora_fin: horaFin,
      motivo: motivo.trim() || undefined,
    })
    setSaving(false)

    if (result.status === 'ok') {
      resetForm()
      setShowForm(false)
      await fetchExcepciones()
    } else if (result.status === 'conflict') {
      setConflicts(result.conflicts)
    } else if (result.status === 'overlap') {
      setOverlaps(result.dates)
    } else {
      setFormError(result.message || 'Error al guardar la excepción.')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta excepción de horario?')) return
    setDeletingId(id)
    const result = await eliminarExcepcionHorario(id)
    setDeletingId(null)
    if (result.error) {
      alert('Error al eliminar: ' + result.error)
    } else {
      await fetchExcepciones()
    }
  }

  const copyPhones = (rows) => {
    const phones = [...new Set(rows.map((r) => r.paciente_telefono).filter(Boolean))]
    navigator.clipboard.writeText(phones.join('\n'))
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Card className="border-secondary/50 shadow-sm">
      {/* Header — always visible, toggles expand */}
      <CardHeader
        className="pb-3 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-kely-green" />
            <CardTitle className="text-base font-semibold">Horarios especiales</CardTitle>
            {excepciones.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {excepciones.length}
              </Badge>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <CardDescription className="text-xs">
          Días con modalidad o jornada diferente a la agenda habitual.
        </CardDescription>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Upcoming exceptions list */}
          {loadingList ? (
            <p className="text-xs text-muted-foreground animate-pulse">Cargando...</p>
          ) : excepciones.length === 0 ? (
            <p className="text-xs text-center text-muted-foreground py-3">
              No hay horarios especiales próximos.
            </p>
          ) : (
            <div className="border rounded-md divide-y max-h-52 overflow-y-auto custom-scrollbar">
              {excepciones.map((exc) => (
                <div
                  key={exc.id}
                  className="flex justify-between items-center p-2 text-sm hover:bg-muted/30"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{formatFecha(exc.fecha)}</span>
                      <Badge variant={UBICACION_BADGE_VARIANT[exc.ubicacion] || 'outline'} className="text-[10px] px-1.5">
                        {UBICACION_LABELS[exc.ubicacion] || exc.ubicacion}
                      </Badge>
                      <span className="text-muted-foreground text-xs">hasta {exc.hora_fin?.slice(0, 5)}</span>
                    </div>
                    {exc.motivo && (
                      <span className="text-xs text-muted-foreground truncate max-w-xs">{exc.motivo}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => handleDelete(exc.id)}
                    disabled={deletingId === exc.id}
                    title="Eliminar excepción"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Toggle form */}
          {!showForm ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs gap-1.5"
              onClick={() => { resetForm(); setShowForm(true) }}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar excepción
            </Button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 border rounded-md p-3 bg-muted/20">
              <p className="text-xs font-medium text-muted-foreground">Nueva excepción de horario</p>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Fecha inicio</Label>
                  <Input
                    type="date"
                    value={fechaInicio}
                    min={today}
                    onChange={(e) => handleFechaInicioChange(e.target.value)}
                    className="h-8 text-sm"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha fin</Label>
                  <Input
                    type="date"
                    value={fechaFin}
                    min={fechaInicio}
                    onChange={(e) => { setFechaFin(e.target.value); setFormError(null) }}
                    className="h-8 text-sm"
                    required
                  />
                </div>
              </div>

              {/* Ubicacion + hora_fin */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de jornada</Label>
                  <select
                    value={ubicacion}
                    onChange={(e) => setUbicacion(e.target.value)}
                    className="flex h-8 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-kely-green"
                  >
                    {UBICACION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hora fin</Label>
                  <Input
                    type="time"
                    value={horaFin}
                    min="12:01"
                    max="21:00"
                    onChange={(e) => setHoraFin(e.target.value)}
                    className="h-8 text-sm"
                    required
                  />
                </div>
              </div>

              {/* Motivo (optional) */}
              <div className="space-y-1">
                <Label className="text-xs">Motivo <span className="text-muted-foreground">(opcional)</span></Label>
                <Input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Consulta en clínica Santo Domingo"
                  className="h-8 text-sm"
                  maxLength={200}
                />
              </div>

              {/* Validation error */}
              {formError && (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Conflict alert (SC-08) */}
              {conflicts && conflicts.length > 0 && (
                <div className="space-y-2 bg-destructive/10 border border-destructive/30 rounded p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {conflicts.length === 1
                        ? '1 cita presencial entra en conflicto'
                        : `${conflicts.length} citas presenciales entran en conflicto`}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPhones(conflicts)}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      title="Copiar teléfonos"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar teléfonos
                    </button>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto custom-scrollbar">
                    {conflicts.map((c, i) => (
                      <div key={i} className="text-[11px] text-muted-foreground grid grid-cols-[auto_1fr] gap-x-2">
                        <span className="tabular-nums">{formatFecha(c.fecha)} {c.hora_inicio}</span>
                        <span className="truncate">{c.paciente_nombre} · {c.paciente_telefono}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Cancela o reagenda estas citas desde la agenda antes de volver a intentarlo.
                  </p>
                </div>
              )}

              {/* Overlap alert */}
              {overlaps && overlaps.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Ya existe una excepción en: {overlaps.map(formatFecha).join(', ')}. Eliminá la existente antes de crear una nueva.
                  </span>
                </div>
              )}

              {/* Form actions */}
              <div className="flex gap-2 pt-1">
                <Button
                  type="submit"
                  size="sm"
                  className="flex-1 h-8 bg-kely-green hover:bg-kely-green/90 text-white text-xs"
                  disabled={saving}
                >
                  {saving ? 'Guardando...' : 'Guardar excepción'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { setShowForm(false); resetForm() }}
                  disabled={saving}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      )}
    </Card>
  )
}
