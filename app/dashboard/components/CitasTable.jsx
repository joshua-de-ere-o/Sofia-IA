import React from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getServicioLabel } from '@/lib/servicios'
import { CitaStatusBadge } from './CitaStatusBadge'
import { CitaActions } from './CitaActions'

export function CitasTable({ citas, actionLoading, onEstado, onVerificarPago, onReagendar, onOpenVoucher, emptyMessage }) {
  return (
    <div className="border rounded-md overflow-x-auto bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha/Hora</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Servicio / Modalidad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {citas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            citas.map((cita) => (
              <TableRow key={cita.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  <div>{cita.fecha}</div>
                  <div className="text-xs text-muted-foreground">{cita.hora?.substring(0, 5)}</div>
                </TableCell>
                <TableCell>
                  {cita.estado === 'agenda_bloqueada' ? (
                    <div className="text-muted-foreground">{cita.motivo_bloqueo || 'Bloqueo personal'}</div>
                  ) : (
                    <>
                      <div>{cita.paciente?.nombre}</div>
                      <div className="text-xs text-muted-foreground">{cita.paciente?.telefono}</div>
                    </>
                  )}
                </TableCell>
                <TableCell>
                  {cita.estado === 'agenda_bloqueada' ? (
                    <span className="text-sm text-muted-foreground">Tiempo bloqueado</span>
                  ) : (
                    <div className="flex flex-col">
                      <span className="text-sm">{getServicioLabel(cita.servicio)}</span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {cita.modalidad} {cita.modalidad !== 'virtual' ? `(${cita.paciente?.zona})` : ''}
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <CitaStatusBadge estado={cita.estado} />
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex justify-end gap-1">
                    <CitaActions
                      cita={cita}
                      actionLoading={actionLoading}
                      onEstado={onEstado}
                      onVerificarPago={onVerificarPago}
                      onReagendar={onReagendar}
                      onOpenVoucher={onOpenVoucher}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
