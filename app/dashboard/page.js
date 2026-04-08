import { MensajesTab } from './tabs/MensajesTab'

export default function MensajesPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Mensajes</h1>
        <p className="text-sm text-muted-foreground">Gestiona las conversaciones de los pacientes con Sofía.</p>
      </div>
      <MensajesTab />
    </div>
  )
}
