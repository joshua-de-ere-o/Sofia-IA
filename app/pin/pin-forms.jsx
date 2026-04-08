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
      <p className="text-sm text-center text-foreground/80 mb-2">
        Parece que es tu primer acceso. Crea tu PIN de 4 dígitos para accesos rápidos.
      </p>
      <input
        className="flex h-12 text-center text-2xl tracking-widest w-full rounded-md border border-input bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-kely-green"
        type="password"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        placeholder="----"
        required
      />
      {error && <p className="text-destructive text-sm font-medium">{error}</p>}
      <Button type="submit" disabled={loading || pin.length !== 4} className="w-full bg-kely-green hover:bg-kely-green/90 text-white">
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
      <p className="text-sm text-center text-foreground/80 mb-2">
        Ingresa tu PIN de 4 dígitos para acceder al CRM.
      </p>
      <input
        className="flex h-12 text-center text-2xl tracking-widest w-full rounded-md border border-input bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-kely-green"
        type="password"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        placeholder="----"
        required
        autoFocus
      />
      {error && <p className="text-destructive text-sm text-center font-medium">{error}</p>}
      <Button type="submit" disabled={loading || pin.length !== 4} className="w-full bg-kely-green hover:bg-kely-green/90 text-white">
        {loading ? 'Verificando...' : 'Acceder'}
      </Button>
    </form>
  )
}
