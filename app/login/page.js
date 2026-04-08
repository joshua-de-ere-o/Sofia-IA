'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Mail, MoonStar } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const supabase = createClient()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || location.origin).replace(/\/$/, '')
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${appUrl}/auth/callback`,
      },
    })

    if (error) {
      setMessage('Error al enviar el enlace: ' + error.message)
    } else {
      setMessage('¡Enlace mágico enviado! Revisa tu correo.')
    }
    setLoading(false)
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.14),_transparent_35%),linear-gradient(180deg,_transparent,_rgba(15,23,42,0.08))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-kely-green/10 to-transparent" />

      <div className="relative w-full max-w-md rounded-3xl border border-border/70 bg-card/95 p-8 shadow-2xl shadow-black/10 backdrop-blur">
        <div className="mb-8 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-kely-green/15 text-kely-green ring-1 ring-kely-green/20">
            <MoonStar className="h-7 w-7" />
          </div>
        </div>

        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-kely-green">Acceso seguro</p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Sistema Dra. Kely</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Ingresa con tu correo electrónico para recibir un enlace mágico y continuar con tu acceso.
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 flex flex-col gap-4">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">Correo electrónico</span>
            <div className="flex h-11 items-center rounded-xl border border-input bg-background/80 px-3 ring-offset-background transition focus-within:ring-2 focus-within:ring-kely-green/40">
              <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
              <input
                className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kely@example.com"
                required
              />
            </div>
          </label>

          <Button type="submit" disabled={loading} className="h-11 w-full rounded-xl bg-kely-green text-white shadow-lg shadow-kely-green/20 hover:bg-kely-green/90">
            {loading ? 'Enviando...' : 'Enviar enlace mágico'}
          </Button>
        </form>

        {message && (
          <div className="mt-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-center text-sm text-muted-foreground">
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
