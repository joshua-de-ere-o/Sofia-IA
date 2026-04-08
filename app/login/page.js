'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const supabase = createClient()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
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
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <div className="w-full max-w-md bg-card p-8 rounded-lg shadow-md border">
        <h1 className="text-2xl font-bold mb-6 text-center text-kely-green">Sistema Dra. Kely</h1>
        <p className="mb-4 text-center text-sm text-muted-foreground">
          Ingresa con tu correo electrónico para recibir un enlace mágico de acceso.
        </p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kely@example.com"
            required
          />
          <Button type="submit" disabled={loading} className="w-full bg-kely-green hover:bg-kely-green/90 text-white">
            {loading ? 'Enviando...' : 'Enviar enlace mágico'}
          </Button>
        </form>
        {message && <p className="mt-4 text-center text-sm text-muted-foreground">{message}</p>}
      </div>
    </div>
  )
}
