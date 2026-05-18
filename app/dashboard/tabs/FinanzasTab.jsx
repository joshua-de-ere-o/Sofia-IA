'use client'

import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, TrendingDown, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getServicioLabel } from '@/lib/servicios'
import { getFinanzasMetrics } from '../actions'

const PERIODOS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mes' },
  { key: 'mes-anterior', label: 'Mes anterior' },
]

function formatMoney(n) {
  const v = Number(n) || 0
  return `$${v.toFixed(2)}`
}

function CardMetric({ titulo, total, cantidad, items, color, icon: Icon, footer, emptyText }) {
  const [open, setOpen] = useState(false)
  const hasItems = items.length > 0

  return (
    <div className={cn('rounded-lg border bg-card shadow-sm overflow-hidden', color.border)}>
      <button
        type="button"
        onClick={() => hasItems && setOpen((v) => !v)}
        disabled={!hasItems}
        className={cn(
          'flex w-full items-center justify-between gap-3 p-4 text-left transition-colors',
          hasItems ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', color.bg)}>
            <Icon className={cn('h-5 w-5', color.icon)} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
            <p className="text-2xl font-bold tabular-nums">{formatMoney(total)}</p>
            <p className="text-xs text-muted-foreground">
              {cantidad === 0 ? emptyText : `${cantidad} ${cantidad === 1 ? 'item' : 'items'}`}
            </p>
          </div>
        </div>
        {hasItems && (
          <div className="shrink-0 text-muted-foreground">
            {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        )}
      </button>

      {footer && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">{footer}</div>
      )}

      {open && hasItems && (
        <div className="border-t bg-muted/20 divide-y">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{it.paciente_nombre}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {getServicioLabel(it.servicio)} · {it.fecha}
                  {it.hora ? ` ${it.hora.substring(0, 5)}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(it.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function FinanzasTab() {
  const [periodo, setPeriodo] = useState('mes')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async (p) => {
    setLoading(true)
    setError(null)
    const result = await getFinanzasMetrics(p)
    if (result?.error) {
      setError(result.error)
      setData(null)
    } else {
      setData(result)
    }
    setLoading(false)
  }, [])

  useEffect(() => { cargar(periodo) }, [cargar, periodo])

  const delta = data?.comparacion?.deltaPct
  const deltaLabel = delta == null
    ? 'Sin datos del periodo anterior'
    : delta === 0
      ? 'Sin cambios vs periodo anterior'
      : `${delta > 0 ? '+' : ''}${delta}% vs periodo anterior (${formatMoney(data.comparacion.cobradoPrev)})`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Resumen financiero</h2>
          <p className="text-sm text-muted-foreground">
            {data?.periodo?.label || 'Cargando...'} · {data?.periodo?.desde} a {data?.periodo?.hasta}
          </p>
        </div>
        <div className="inline-flex rounded-md border bg-background p-0.5 w-fit">
          {PERIODOS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriodo(p.key)}
              className={cn(
                'h-7 rounded px-3 text-xs font-medium transition-colors',
                periodo === p.key
                  ? 'bg-kely-teal text-kely-green'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Error al cargar finanzas: {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-sm text-muted-foreground">Cargando finanzas...</div>
      )}

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <CardMetric
            titulo="Cobrado"
            total={data.cobrado.total}
            cantidad={data.cobrado.cantidad}
            items={data.cobrado.items}
            emptyText="Sin cobros en el periodo"
            icon={CheckCircle2}
            color={{
              bg: 'bg-kely-green/10',
              icon: 'text-kely-green',
              border: 'border-kely-green/30',
            }}
            footer={
              <span className="flex items-center gap-1.5">
                {delta != null && delta !== 0 && (
                  delta > 0
                    ? <TrendingUp className="h-3.5 w-3.5 text-kely-green" />
                    : <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                )}
                {deltaLabel}
              </span>
            }
          />

          <CardMetric
            titulo="Por verificar"
            total={data.porVerificar.total}
            cantidad={data.porVerificar.cantidad}
            items={data.porVerificar.items}
            emptyText="Sin comprobantes esperando"
            icon={Clock}
            color={{
              bg: 'bg-orange-100 dark:bg-orange-900/30',
              icon: 'text-orange-600 dark:text-orange-400',
              border: 'border-orange-200 dark:border-orange-900/40',
            }}
            footer={
              data.porVerificar.cantidad > 0
                ? 'Tocá la tarjeta para ver los comprobantes esperando confirmación'
                : null
            }
          />

          <CardMetric
            titulo="Pendiente"
            total={data.pendiente.total}
            cantidad={data.pendiente.cantidad}
            items={data.pendiente.items}
            emptyText="Sin pagos pendientes"
            icon={AlertCircle}
            color={{
              bg: 'bg-red-100 dark:bg-red-900/30',
              icon: 'text-red-600 dark:text-red-400',
              border: 'border-red-200 dark:border-red-900/40',
            }}
            footer={
              data.pendiente.cantidad > 0
                ? 'Citas reservadas sin pago de adelanto todavía'
                : null
            }
          />
        </div>
      )}
    </div>
  )
}
