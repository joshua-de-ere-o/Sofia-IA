'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getManualAppointmentFormOptions, normalizeManualAppointmentPayload } from '@/lib/manual-appointment'

function buildInitialForm() {
  const initialOptions = getManualAppointmentFormOptions()
  const service = initialOptions.services[0]?.value ?? ''
  const modalidad = initialOptions.modalidades[0]?.value ?? 'presencial'
  const resolvedOptions = getManualAppointmentFormOptions(service, modalidad)

  return {
    patientName: '',
    patientPhone: '',
    patientBirthDate: '',
    service,
    date: '',
    time: '',
    modalidad,
    zona: resolvedOptions.zonas[0]?.value ?? '',
    estado: 'confirmada',
    motivo: '',
  }
}

export function ManualAppointmentDialog({ open, onOpenChange, onSubmit, loading, errorMessage, onCreated }) {
  const [form, setForm] = useState(() => buildInitialForm())
  const options = useMemo(() => getManualAppointmentFormOptions(form.service, form.modalidad), [form.modalidad, form.service])

  useEffect(() => {
    if (!open) return

    setForm((current) => {
      const currentZonaIsValid = options.zonas.some((zona) => zona.value === current.zona)
      const nextModalidad = options.modalidades.some((modalidad) => modalidad.value === current.modalidad)
        ? current.modalidad
        : (options.modalidades[0]?.value ?? current.modalidad)

      return {
        ...current,
        modalidad: nextModalidad,
        zona: currentZonaIsValid ? current.zona : (options.zonas[0]?.value ?? ''),
      }
    })
  }, [open, options])

  const updateField = (field, value) => {
    setForm((current) => {
      const next = { ...current, [field]: value }

      if (field === 'service' || field === 'modalidad') {
        const nextOptions = getManualAppointmentFormOptions(
          field === 'service' ? value : next.service,
          field === 'modalidad' ? value : next.modalidad,
        )

        if (!nextOptions.modalidades.some((modalidad) => modalidad.value === next.modalidad)) {
          next.modalidad = nextOptions.modalidades[0]?.value ?? next.modalidad
        }

        if (!nextOptions.zonas.some((zona) => zona.value === next.zona)) {
          next.zona = nextOptions.zonas[0]?.value ?? ''
        }
      }

      return next
    })
  }

  const resetAndClose = () => {
    setForm(buildInitialForm())
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    const payload = normalizeManualAppointmentPayload(form)
    const result = await onSubmit(payload)

    if (result?.error) return

    onCreated?.(result)
    resetAndClose()
  }

  const handleDialogOpenChange = (nextOpen) => {
    if (!nextOpen) return resetAndClose()
    onOpenChange(true)
  }

  const selectClassName =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green'
  const renderOptions = (items) => items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="flex max-h-[95vh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh] sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Agendar cita manual</DialogTitle>
          <DialogDescription>Creá una cita desde el CRM sin pasar por el flujo automático de Sofía.</DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="manual-patient-name">Nombre del paciente</Label>
              <Input id="manual-patient-name" value={form.patientName} onChange={(e) => updateField('patientName', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-patient-phone">Teléfono</Label>
              <Input id="manual-patient-phone" value={form.patientPhone} onChange={(e) => updateField('patientPhone', e.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="manual-patient-birthdate">Fecha de nacimiento</Label>
              <Input id="manual-patient-birthdate" type="date" value={form.patientBirthDate} onChange={(e) => updateField('patientBirthDate', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-service">Servicio</Label>
              <select id="manual-service" value={form.service} onChange={(e) => updateField('service', e.target.value)} className={selectClassName}>
                {renderOptions(options.services)}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="manual-date">Fecha</Label>
              <Input id="manual-date" type="date" value={form.date} onChange={(e) => updateField('date', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-time">Hora</Label>
              <Input id="manual-time" type="time" value={form.time} onChange={(e) => updateField('time', e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-modalidad">Modalidad</Label>
              <select id="manual-modalidad" value={form.modalidad} onChange={(e) => updateField('modalidad', e.target.value)} className={selectClassName}>
                {renderOptions(options.modalidades)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-zona">Zona</Label>
              <select id="manual-zona" value={form.zona} onChange={(e) => updateField('zona', e.target.value)} className={selectClassName}>
                {renderOptions(options.zonas)}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="manual-estado">Estado inicial</Label>
              <select id="manual-estado" value={form.estado} onChange={(e) => updateField('estado', e.target.value)} className={selectClassName}>
                {renderOptions(options.estados)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-motivo">Motivo</Label>
              <Input id="manual-motivo" value={form.motivo} onChange={(e) => updateField('motivo', e.target.value)} placeholder="Ej. control mensual" />
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar cita'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
