import { ReportesTab } from '../tabs/ReportesTab'

export default function ReportesPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-sm text-muted-foreground">Métricas de rendimiento del asistente IA.</p>
      </div>
      <ReportesTab />
    </div>
  )
}
