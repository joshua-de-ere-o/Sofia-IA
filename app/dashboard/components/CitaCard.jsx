import { Calendar, Clock, Phone, MapPin } from 'lucide-react'
import { getServicioLabel } from '@/lib/servicios'
import { CitaStatusBadge } from './CitaStatusBadge'
import { CitaActions } from './CitaActions'

export function CitaCard({ cita, actionLoading, onEstado, onVerificarPago, onReagendar, onOpenVoucher }) {
  const hora = cita.hora?.substring(0, 5)
  const esBloqueo = cita.estado === 'agenda_bloqueada'
  const modalidadLabel =
    cita.modalidad === 'virtual'
      ? 'Virtual'
      : `Presencial${cita.paciente?.zona ? ` · ${cita.paciente.zona}` : ''}`

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">
            {esBloqueo
              ? cita.motivo_bloqueo || 'Bloqueo personal'
              : cita.paciente?.nombre || 'Sin nombre'}
          </p>
          {!esBloqueo && cita.paciente?.telefono && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" />
              {cita.paciente.telefono}
            </p>
          )}
        </div>
        <CitaStatusBadge estado={cita.estado} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="truncate">{cita.fecha}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          <span>{hora}</span>
        </div>
      </div>

      {!esBloqueo && (
        <div className="mt-2 text-sm">
          <p className="font-medium text-foreground">{getServicioLabel(cita.servicio)}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs capitalize text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {modalidadLabel}
          </p>
        </div>
      )}

      <div className="mt-3 flex justify-end border-t pt-3">
        <CitaActions
          cita={cita}
          actionLoading={actionLoading}
          onEstado={onEstado}
          onVerificarPago={onVerificarPago}
          onReagendar={onReagendar}
          onOpenVoucher={onOpenVoucher}
        />
      </div>
    </div>
  )
}
