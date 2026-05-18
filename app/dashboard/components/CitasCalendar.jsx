'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function toDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const jsWeekday = firstOfMonth.getDay()
  const mondayOffset = (jsWeekday + 6) % 7
  const start = new Date(year, month, 1 - mondayOffset)

  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  return cells
}

export function CitasCalendar({ citas, selectedDate, onSelectDate }) {
  const initial = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  const citasByDate = useMemo(() => {
    const map = new Map()
    for (const cita of citas) {
      if (!cita.fecha) continue
      map.set(cita.fecha, (map.get(cita.fecha) || 0) + 1)
    }
    return map
  }, [citas])

  const cells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const todayKey = toDateKey(new Date())

  const goPrev = () => {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const goNext = () => {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const goToday = () => {
    const t = new Date()
    setViewYear(t.getFullYear())
    setViewMonth(t.getMonth())
    onSelectDate(toDateKey(t))
  }

  return (
    <div className="rounded-lg border bg-card p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold capitalize sm:text-base">
          {MONTH_LABELS[viewMonth]} {viewYear}
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={goToday} className="h-8 px-2 text-xs">
            Hoy
          </Button>
          <Button variant="ghost" size="icon" onClick={goPrev} className="h-8 w-8" aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goNext} className="h-8 w-8" aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const key = toDateKey(d)
          const inMonth = d.getMonth() === viewMonth
          const count = citasByDate.get(key) || 0
          const isToday = key === todayKey
          const isSelected = key === selectedDate

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              className={cn(
                'relative flex aspect-square flex-col items-center justify-center rounded-md border text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green',
                inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                isSelected
                  ? 'border-kely-green bg-kely-green text-white hover:bg-kely-green/90'
                  : isToday
                    ? 'border-kely-green/60 bg-kely-teal/30 hover:bg-kely-teal/50'
                    : 'border-transparent hover:bg-muted',
              )}
            >
              <span className={cn('leading-none', count > 0 && !isSelected && 'font-semibold')}>
                {d.getDate()}
              </span>
              {count > 0 && (
                <span
                  className={cn(
                    'mt-1 min-w-[1.25rem] rounded-full px-1 text-[10px] font-semibold leading-tight',
                    isSelected
                      ? 'bg-white/25 text-white'
                      : 'bg-kely-green/15 text-kely-green',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
