'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { actualizarEstadoCita, verificarPago } from '../actions'

export function useCitas() {
  const supabase = useMemo(() => createClient(), [])
  const [citas, setCitas] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  const fetchCitas = useCallback(async () => {
    const { data } = await supabase
      .from('citas')
      .select('*, paciente:pacientes(nombre, telefono, zona), pagos(comprobante_url, referencia, verificado)')
      .order('fecha', { ascending: true })
      .order('hora', { ascending: true })

    if (data) setCitas(data)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchCitas()

    const channel = supabase
      .channel('public:citas_pagos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'citas' }, fetchCitas)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, fetchCitas)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchCitas, supabase])

  const handleEstado = useCallback(async (id, estado) => {
    setActionLoading(id)
    await actualizarEstadoCita(id, estado)
    setActionLoading(null)
    fetchCitas()
  }, [fetchCitas])

  const handleVerificarPago = useCallback(async (id) => {
    setActionLoading(id)
    await verificarPago(id)
    setActionLoading(null)
    fetchCitas()
  }, [fetchCitas])

  const openVoucher = useCallback(async (pago) => {
    const path = pago?.referencia
    if (!path) {
      alert('Este pago no tiene comprobante asociado.')
      return
    }
    const { data, error } = await supabase
      .storage
      .from('comprobantes')
      .createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) {
      console.error('Error generando URL firmada:', error)
      alert('No se pudo abrir el comprobante.')
      return
    }
    window.open(data.signedUrl, '_blank')
  }, [supabase])

  return {
    citas,
    loading,
    actionLoading,
    handleEstado,
    handleVerificarPago,
    openVoucher,
  }
}
