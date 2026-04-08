import { ConfigTab } from '../tabs/ConfigTab'

export default function ConfiguracionPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 hidden md:block">
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">Parametros de atención, bancarios y whitelist.</p>
      </div>
      <ConfigTab />
    </div>
  )
}
