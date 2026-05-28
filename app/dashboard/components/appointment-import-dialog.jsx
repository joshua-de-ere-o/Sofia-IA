'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getManualAppointmentFormOptions } from '@/lib/manual-appointment'

function buildInitialForm() {
  const initialOptions = getManualAppointmentFormOptions()
  const service = initialOptions.services[0]?.value ?? ''
  const modalidad = initialOptions.modalidades[0]?.value ?? 'presencial'
  const resolvedOptions = getManualAppointmentFormOptions(service, modalidad)

  return {
    file: null,
    service,
    modalidad,
    zona: resolvedOptions.zonas[0]?.value ?? '',
    estado: 'confirmada',
    motivo: 'Importado desde CSV',
  }
}

function formatRowStatus(row) {
  if (row.status === 'ready') return row.warnings.length > 0 ? 'Importada con aviso' : 'Importada'
  if (row.status === 'duplicate') return row.duplicateScope === 'database' ? 'Duplicada en CRM' : 'Duplicada en archivo'
  return 'Rechazada'
}

export function AppointmentImportDialog({ open, onOpenChange, onSubmit, loading, errorMessage, result, onResetFeedback }) {
  const [form, setForm] = useState(() => buildInitialForm())
  const options = useMemo(() => getManualAppointmentFormOptions(form.service, form.modalidad), [form.modalidad, form.service])

  useEffect(() => {
    if (!open) return

    setForm((current) => {
      const next = { ...current }
      if (!options.modalidades.some((item) => item.value === next.modalidad)) {
        next.modalidad = options.modalidades[0]?.value ?? next.modalidad
      }
      if (!options.zonas.some((item) => item.value === next.zona)) {
        next.zona = options.zonas[0]?.value ?? ''
      }
      return next
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

        if (!nextOptions.modalidades.some((item) => item.value === next.modalidad)) {
          next.modalidad = nextOptions.modalidades[0]?.value ?? next.modalidad
        }

        if (!nextOptions.zonas.some((item) => item.value === next.zona)) {
          next.zona = nextOptions.zonas[0]?.value ?? ''
        }
      }

      return next
    })
  }

  const resetAndClose = () => {
    setForm(buildInitialForm())
    onResetFeedback?.()
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    const formData = new FormData()
    if (form.file) formData.set('file', form.file)
    formData.set('service', form.service)
    formData.set('modalidad', form.modalidad)
    formData.set('zona', form.zona)
    formData.set('estado', form.estado)
    formData.set('motivo', form.motivo)
    await onSubmit(formData)
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
      <DialogContent className="flex max-h-[95vh] flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh] sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-4 pt-6">
          <DialogTitle>Importar citas por CSV</DialogTitle>
          <DialogDescription>Subí un archivo, limpiá las filas y guardá las citas directo en la agenda viva del CRM.</DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="appointment-import-file">Archivo CSV</Label>
            <Input id="appointment-import-file" type="file" accept=".csv,text/csv" onChange={(event) => updateField('file', event.target.files?.[0] ?? null)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="appointment-import-service">Servicio</Label>
              <select id="appointment-import-service" value={form.service} onChange={(event) => updateField('service', event.target.value)} className={selectClassName}>
                {renderOptions(options.services)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appointment-import-modalidad">Modalidad</Label>
              <select id="appointment-import-modalidad" value={form.modalidad} onChange={(event) => updateField('modalidad', event.target.value)} className={selectClassName}>
                {renderOptions(options.modalidades)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appointment-import-zona">Zona</Label>
              <select id="appointment-import-zona" value={form.zona} onChange={(event) => updateField('zona', event.target.value)} className={selectClassName}>
                {renderOptions(options.zonas)}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="appointment-import-estado">Estado inicial</Label>
              <select id="appointment-import-estado" value={form.estado} onChange={(event) => updateField('estado', event.target.value)} className={selectClassName}>
                {renderOptions(options.estados)}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="appointment-import-motivo">Motivo</Label>
            <Input id="appointment-import-motivo" value={form.motivo} onChange={(event) => updateField('motivo', event.target.value)} placeholder="Ej. importación histórica de agenda" />
          </div>

          {errorMessage && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </div>
          )}

          {result && (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded-md border bg-background px-3 py-2 text-sm"><strong>{result.imported}</strong> importadas</div>
                <div className="rounded-md border bg-background px-3 py-2 text-sm"><strong>{result.duplicates}</strong> duplicadas</div>
                <div className="rounded-md border bg-background px-3 py-2 text-sm"><strong>{result.warnings}</strong> con aviso</div>
                <div className="rounded-md border bg-background px-3 py-2 text-sm"><strong>{result.rejected}</strong> rechazadas</div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Fila</th>
                      <th className="px-3 py-2 text-left font-medium">Paciente</th>
                      <th className="px-3 py-2 text-left font-medium">Fecha</th>
                      <th className="px-3 py-2 text-left font-medium">Hora</th>
                      <th className="px-3 py-2 text-left font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-background">
                    {result.rows?.map((row) => (
                      <tr key={`${row.rowNumber}-${row.patientName}-${row.date}-${row.time}`}>
                        <td className="px-3 py-2">{row.rowNumber}</td>
                        <td className="px-3 py-2">{row.patientName || 'Sin nombre válido'}</td>
                        <td className="px-3 py-2">{row.date || '—'}</td>
                        <td className="px-3 py-2">{row.time ? row.time.slice(0, 5) : '—'}</td>
                        <td className="px-3 py-2">
                          {formatRowStatus(row)}
                          {row.rejectionReason ? ` · ${row.rejectionReason}` : ''}
                          {row.warnings?.includes('day_mismatch') ? ' · Día no coincide' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t bg-background px-6 py-4 sm:gap-0">
          <Button variant="outline" onClick={resetAndClose} disabled={loading}>Cerrar</Button>
          <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Importando…' : 'Importar citas'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
