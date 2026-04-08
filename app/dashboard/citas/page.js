import { CitasTab } from '../tabs/CitasTab'

export default function CitasPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Citas</h1>
        <p className="text-sm text-muted-foreground">Revisa las citas agendadas y pendientes.</p>
      </div>
      <CitasTab />
    </div>
  )
}
