'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, X, Eye, ShieldCheck, CalendarClock } from 'lucide-react'

export function CitaActions({ cita, actionLoading, onEstado, onVerificarPago, onOpenVoucher, onReagendar }) {
  const pago = cita.pagos?.[0]
  const isLoading = actionLoading === cita.id
  const isPendientePago = cita.estado === 'pendiente_pago'
  const isActionable = ['confirmada', 'pendiente_pago'].includes(cita.estado)
  const hasComprobante = isPendientePago && pago?.comprobante_url

  const [reagendarOpen, setReagendarOpen] = useState(false)
  const horaPrellenada = (cita.hora || '').slice(0, 5)
  const [nuevaFecha, setNuevaFecha] = useState(cita.fecha || '')
  const [nuevaHora, setNuevaHora] = useState(horaPrellenada)

  if (!hasComprobante && !isActionable) return null

  const abrirReagendar = () => {
    setNuevaFecha(cita.fecha || '')
    setNuevaHora(horaPrellenada)
    setReagendarOpen(true)
  }

  const confirmarReagendar = async () => {
    if (!nuevaFecha || !nuevaHora) return
    if (nuevaFecha === cita.fecha && nuevaHora === horaPrellenada) {
      setReagendarOpen(false)
      return
    }
    const result = await onReagendar?.(cita.id, nuevaFecha, nuevaHora)
    if (!result?.error) setReagendarOpen(false)
  }

  return (
    <div className="flex gap-1">
      {hasComprobante && (
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onOpenVoucher(pago)}
            title="Ver Comprobante"
          >
            <Eye className="w-4 h-4 text-blue-500" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={isLoading}
            onClick={() => onVerificarPago(cita.id)}
            title="Verificar Pago"
          >
            <ShieldCheck className="w-4 h-4 text-kely-green" />
          </Button>
        </>
      )}

      {isActionable && (
        <>
          <Button
            size="icon"
            variant="ghost"
            disabled={isLoading}
            onClick={() => onEstado(cita.id, 'completada')}
            className="text-kely-green hover:text-kely-green hover:bg-kely-teal dark:hover:bg-kely-teal/20"
            title="Marcar Completada"
          >
            <Check className="w-4 h-4" />
          </Button>
          {onReagendar && (
            <Button
              size="icon"
              variant="ghost"
              disabled={isLoading}
              onClick={abrirReagendar}
              className="text-blue-600 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              title="Reagendar"
            >
              <CalendarClock className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            disabled={isLoading}
            onClick={() => onEstado(cita.id, 'cancelada')}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            title="Cancelar"
          >
            <X className="w-4 h-4" />
          </Button>
        </>
      )}

      <Dialog open={reagendarOpen} onOpenChange={setReagendarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reagendar cita</DialogTitle>
            <DialogDescription>
              {cita.paciente?.nombre || 'Paciente'} — actualmente {cita.fecha} {horaPrellenada}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`reagendar-fecha-${cita.id}`}>Nueva fecha</Label>
              <Input
                id={`reagendar-fecha-${cita.id}`}
                type="date"
                value={nuevaFecha}
                onChange={(e) => setNuevaFecha(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`reagendar-hora-${cita.id}`}>Nueva hora</Label>
              <Input
                id={`reagendar-hora-${cita.id}`}
                type="time"
                value={nuevaHora}
                onChange={(e) => setNuevaHora(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReagendarOpen(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button onClick={confirmarReagendar} disabled={isLoading || !nuevaFecha || !nuevaHora}>
              {isLoading ? 'Guardando…' : 'Reagendar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
