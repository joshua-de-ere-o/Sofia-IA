'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, CalendarCheck, TrendingUp, AlertCircle, PhoneOff } from 'lucide-react'
import { getDashboardMetrics } from '../actions'

export function ReportesTab() {
  const [metrics, setMetrics] = useState({
    leads_recibidos: 0,
    citas_agendadas: 0,
    no_shows: 0,
    casos_escalados: 0,
    tasa_agendamiento: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const data = await getDashboardMetrics()
      setMetrics(data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground text-sm">Cargando métricas...</div>
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div>
        <h2 className="text-lg font-semibold">Métricas de Rendimiento</h2>
        <p className="text-sm text-muted-foreground">Resumen de la atención del asistente Sofía y Citas Globales.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="hover:border-kely-green transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads Recibidos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.leads_recibidos}</div>
            <p className="text-xs text-muted-foreground">Pacientes registrados en el sistema</p>
          </CardContent>
        </Card>
        
        <Card className="hover:border-kely-green transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Citas Agendadas</CardTitle>
            <CalendarCheck className="h-4 w-4 text-kely-green" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.citas_agendadas}</div>
            <p className="text-xs text-muted-foreground">Total histórico de citas</p>
          </CardContent>
        </Card>
        
        <Card className="hover:border-kely-green transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de Agendamiento</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.tasa_agendamiento}%</div>
            <p className="text-xs text-muted-foreground">Eficiencia de cierre de Sofía</p>
          </CardContent>
        </Card>
        
        <Card className="hover:border-red-500 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">No-shows</CardTitle>
            <PhoneOff className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{metrics.no_shows}</div>
            <p className="text-xs text-muted-foreground">Pacientes que no asistieron</p>
          </CardContent>
        </Card>
        
        <Card className="hover:border-orange-500 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Casos Escalados</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{metrics.casos_escalados}</div>
            <p className="text-xs text-muted-foreground">Intervenciones Handoff ejecutadas</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
