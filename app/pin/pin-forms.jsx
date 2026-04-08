'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setupPin, verifyPin } from './actions'
import { Button } from '@/components/ui/button'

export function PinSetupForm() {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    
    const res = await setupPin(pin)
    if (res.error) {
      setError(res.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <p className="mb-2 text-center text-sm leading-6 text-muted-foreground">
        Parece que es tu primer acceso. Crea tu PIN de 4 dígitos para accesos rápidos.
      </p>
      <input
        className="flex h-14 w-full rounded-2xl border border-input bg-background/80 px-3 py-2 text-center text-2xl tracking-[0.45em] outline-none transition focus:ring-2 focus:ring-kely-green/40"
        type="password"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        placeholder="----"
        required
      />
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" disabled={loading || pin.length !== 4} className="h-11 w-full rounded-xl bg-kely-green text-white shadow-lg shadow-kely-green/20 hover:bg-kely-green/90">
        {loading ? 'Guardando...' : 'Crear PIN'}
      </Button>
    </form>
  )
}

export function PinVerifyForm() {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    
    const res = await verifyPin(pin)
    if (res.error) {
      setError(res.error)
      setPin('')
      if (res.locked) {
        setTimeout(() => router.push('/login'), 2000)
      } else {
        setLoading(false)
      }
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <p className="mb-2 text-center text-sm leading-6 text-muted-foreground">
        Ingresa tu PIN de 4 dígitos para acceder al CRM.
      </p>
      <input
        className="flex h-14 w-full rounded-2xl border border-input bg-background/80 px-3 py-2 text-center text-2xl tracking-[0.45em] outline-none transition focus:ring-2 focus:ring-kely-green/40"
        type="password"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        placeholder="----"
        required
        autoFocus
      />
      {error && <p className="text-center text-sm font-medium text-destructive">{error}</p>}
      <Button type="submit" disabled={loading || pin.length !== 4} className="h-11 w-full rounded-xl bg-kely-green text-white shadow-lg shadow-kely-green/20 hover:bg-kely-green/90">
        {loading ? 'Verificando...' : 'Acceder'}
      </Button>
    </form>
  )
}
