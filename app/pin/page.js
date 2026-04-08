import { hasPinSetup } from './actions'
import { PinSetupForm, PinVerifyForm } from './pin-forms'
import { redirect } from 'next/navigation'
import { LockKeyhole } from 'lucide-react'

export default async function PinPage() {
  const status = await hasPinSetup()
  
  // Si no está autenticado, lo echamos al login
  if (status.error === 'No autorizado') {
    redirect('/login')
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.16),_transparent_35%),linear-gradient(180deg,_transparent,_rgba(15,23,42,0.08))]" />
      <div className="relative flex w-full max-w-sm flex-col items-center rounded-3xl border border-border/70 bg-card/95 p-8 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-kely-green/15 text-kely-green ring-1 ring-kely-green/20">
          <LockKeyhole className="h-8 w-8" />
        </div>
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-kely-green">Acceso rápido</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">Protección con PIN</h1>
        </div>
        {status.setup ? <PinVerifyForm /> : <PinSetupForm />}
      </div>
    </div>
  )
}
