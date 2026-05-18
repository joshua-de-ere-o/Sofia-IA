import { FinanzasTab } from '../tabs/FinanzasTab'

export default function FinanzasPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Finanzas</h1>
        <p className="text-sm text-muted-foreground">Ingresos cobrados, comprobantes por verificar y pagos pendientes.</p>
      </div>
      <FinanzasTab />
    </div>
  )
}
