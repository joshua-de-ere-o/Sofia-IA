import { Button } from '@/components/ui/button'
import { Check, X, Eye, ShieldCheck } from 'lucide-react'

export function CitaActions({ cita, actionLoading, onEstado, onVerificarPago, onOpenVoucher }) {
  const pago = cita.pagos?.[0]
  const isLoading = actionLoading === cita.id
  const isPendientePago = cita.estado === 'pendiente_pago'
  const isActionable = ['confirmada', 'pendiente_pago'].includes(cita.estado)
  const hasComprobante = isPendientePago && pago?.comprobante_url

  if (!hasComprobante && !isActionable) return null

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
    </div>
  )
}
