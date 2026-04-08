'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Check, X, Eye, ShieldCheck, Filter } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { actualizarEstadoCita, verificarPago } from '../actions'

export function CitasTab() {
  const [citas, setCitas] = useState([])
  const [loading, setLoading] = useState(true)
  const [estadoFiltro, setEstadoFiltro] = useState('todos')
  const [fechaFiltro, setFechaFiltro] = useState(new Date().toISOString().split('T')[0])
  const [actionLoading, setActionLoading] = useState(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchCitas = useCallback(async () => {
    const { data, error } = await supabase
      .from('citas')
      .select('*, paciente:pacientes(nombre, telefono, zona), pagos(comprobante_url, verificado)')
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })

    if (data) {
      setCitas(data)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchCitas()

    const channelCitas = supabase
      .channel('public:citas_pagos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'citas' }, fetchCitas)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, fetchCitas)
      .subscribe()

    return () => {
      supabase.removeChannel(channelCitas)
    }
  }, [fetchCitas, supabase])

  const citasFiltradas = citas.filter(cita => {
    const matchEstado = estadoFiltro === 'todos' || cita.estado === estadoFiltro
    const matchFecha = !fechaFiltro || cita.fecha === fechaFiltro
    return matchEstado && matchFecha
  })

  const handleEstado = async (id, estado) => {
    setActionLoading(id)
    await actualizarEstadoCita(id, estado)
    setActionLoading(null)
    // No need to fetchCitas here, realtime will trigger it, but just in case:
    fetchCitas()
  }

  const handleVerificarPago = async (id) => {
    setActionLoading(id)
    await verificarPago(id)
    setActionLoading(null)
    fetchCitas()
  }

  const openVoucher = (url) => {
    window.open(url, '_blank')
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold">Agenda de Citas</h2>
          <p className="text-sm text-muted-foreground">Revisa las citas agendadas y pendientes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <div className="relative">
            <input 
              type="date"
              value={fechaFiltro}
              onChange={(e) => setFechaFiltro(e.target.value)}
              className="flex h-8 w-36 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green cursor-pointer text-muted-foreground"
            />
          </div>
          {(estadoFiltro !== 'todos' || fechaFiltro) && (
            <Button variant="ghost" size="sm" onClick={() => { setEstadoFiltro('todos'); setFechaFiltro(''); }} className="h-8 px-2 text-muted-foreground hover:text-foreground">
              Quitar Filtros
            </Button>
          )}
        </div>
      </div>

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
            {loading ? (
               <TableRow>
                 <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Cargando citas...</TableCell>
               </TableRow>
            ) : citasFiltradas.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No hay citas con los filtros actuales.</TableCell>
               </TableRow>
            ) : (
             citasFiltradas.map(cita => {
              const pago = cita.pagos?.[0]
              
              return (
                <TableRow key={cita.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <div>{cita.fecha}</div>
                    <div className="text-xs text-muted-foreground">{cita.hora.substring(0,5)}</div>
                  </TableCell>
                  <TableCell>
                    <div>{cita.paciente?.nombre}</div>
                    <div className="text-xs text-muted-foreground">{cita.paciente?.telefono}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{cita.servicio}</span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {cita.modalidad} {cita.modalidad !== 'virtual' ? `(${cita.paciente?.zona})` : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {cita.estado === 'confirmada' && <Badge className="bg-kely-green hover:bg-kely-green/90 text-white">Confirmada</Badge>}
                    {cita.estado === 'pendiente_pago' && <Badge variant="secondary" className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">Pdte. Pago</Badge>}
                    {cita.estado === 'completada' && <Badge variant="outline" className="text-muted-foreground">Completada</Badge>}
                    {cita.estado === 'no_show' && <Badge variant="destructive" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">No Show</Badge>}
                    {cita.estado === 'cancelada' && <Badge variant="outline" className="text-red-700 dark:text-red-400 border-red-200">Cancelada</Badge>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1">
                      {cita.estado === 'pendiente_pago' && pago?.comprobante_url && (
                         <>
                           <Button size="icon" variant="ghost" onClick={() => openVoucher(pago.comprobante_url)} title="Ver Comprobante">
                             <Eye className="w-4 h-4 text-blue-500" />
                           </Button>
                           <Button size="icon" variant="ghost" disabled={actionLoading === cita.id} onClick={() => handleVerificarPago(cita.id)} title="Verificar Pago">
                             <ShieldCheck className="w-4 h-4 text-kely-green" />
                           </Button>
                         </>
                      )}
                      
                      {['confirmada', 'pendiente_pago'].includes(cita.estado) && (
                        <>
                          <Button size="icon" variant="ghost" disabled={actionLoading === cita.id} onClick={() => handleEstado(cita.id, 'completada')} className="text-kely-green hover:text-kely-green hover:bg-kely-teal dark:hover:bg-kely-teal/20" title="Marcar Completada">
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={actionLoading === cita.id} onClick={() => handleEstado(cita.id, 'cancelada')} className="text-destructive hover:text-destructive hover:bg-destructive/10" title="Cancelar">
                            <X className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
             })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
