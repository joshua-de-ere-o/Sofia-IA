'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import {
  actualizarEstadoCita,
  createManualAppointment,
  importAppointmentsCsv,
  reagendarCita,
  verificarPago,
} from '../actions'

export async function runCreateManualAppointmentFlow({
  payload,
  createManualAppointmentAction,
  fetchCitas,
  setActionLoading,
  setManualError,
}) {
  setActionLoading('manual-create')
  setManualError('')

  const result = await createManualAppointmentAction(payload)

  setActionLoading(null)

  if (result?.error) {
    setManualError(result.error)
    return { error: result.error }
  }

  await fetchCitas()
  return { success: true, date: payload.date }
}

export async function runImportAppointmentsFlow({
  formData,
  importAppointmentsCsvAction,
  fetchCitas,
  setActionLoading,
  setImportError,
  setImportResult,
}) {
  setActionLoading('import-csv')
  setImportError('')

  const result = await importAppointmentsCsvAction(formData)

  setActionLoading(null)

  if (result?.error) {
    setImportError(result.error)
    return { error: result.error }
  }

  setImportResult(result)
  await fetchCitas()

  return {
    success: true,
    imported: result.imported,
    duplicates: result.duplicates,
    warnings: result.warnings,
    rejected: result.rejected,
  }
}

export function useCitas() {
  const supabase = useMemo(() => createClient(), [])
  const [citas, setCitas] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [manualError, setManualError] = useState('')
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState(null)

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

  const handleReagendar = useCallback(async (id, nuevaFecha, nuevaHora) => {
    setActionLoading(id)
    const result = await reagendarCita(id, nuevaFecha, nuevaHora)
    setActionLoading(null)
    if (result?.error) {
      alert(`No se pudo reagendar: ${result.error}`)
      return { error: result.error }
    }
    fetchCitas()
    return { success: true }
  }, [fetchCitas])

  const handleCreateManual = useCallback(async (payload) => {
    return runCreateManualAppointmentFlow({
      payload,
      createManualAppointmentAction: createManualAppointment,
      fetchCitas,
      setActionLoading,
      setManualError,
    })
  }, [fetchCitas])

  const clearManualError = useCallback(() => {
    setManualError('')
  }, [])

  const handleImportCsv = useCallback(async (formData) => {
    return runImportAppointmentsFlow({
      formData,
      importAppointmentsCsvAction: importAppointmentsCsv,
      fetchCitas,
      setActionLoading,
      setImportError,
      setImportResult,
    })
  }, [fetchCitas])

  const clearImportFeedback = useCallback(() => {
    setImportError('')
    setImportResult(null)
  }, [])

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
    manualError,
    importError,
    importResult,
    clearManualError,
    clearImportFeedback,
    handleEstado,
    handleVerificarPago,
    handleReagendar,
    handleCreateManual,
    handleImportCsv,
    openVoucher,
  }
}
