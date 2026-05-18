import { Badge } from '@/components/ui/badge'

const STATUS_CONFIG = {
  confirmada: {
    label: 'Confirmada',
    className: 'bg-kely-green hover:bg-kely-green/90 text-white',
    variant: 'default',
  },
  pendiente_pago: {
    label: 'Pdte. Pago',
    className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    variant: 'secondary',
  },
  completada: {
    label: 'Completada',
    className: 'text-muted-foreground',
    variant: 'outline',
  },
  no_show: {
    label: 'No Show',
    className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    variant: 'destructive',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'text-red-700 dark:text-red-400 border-red-200',
    variant: 'outline',
  },
}

export function CitaStatusBadge({ estado }) {
  const config = STATUS_CONFIG[estado]
  if (!config) return null
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  )
}
