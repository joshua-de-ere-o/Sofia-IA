import { hasPinSetup } from './actions'
import { PinSetupForm, PinVerifyForm } from './pin-forms'
import { redirect } from 'next/navigation'

export default async function PinPage() {
  const status = await hasPinSetup()
  
  // Si no está autenticado, lo echamos al login
  if (status.error === 'No autorizado') {
    redirect('/login')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-kely-teal">
      <div className="w-full max-w-sm bg-kely-white p-8 rounded-lg shadow-md border flex flex-col items-center">
        <div className="w-16 h-16 bg-kely-teal rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-kely-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold mb-6 text-center text-kely-green">Acceso Rápido</h1>
        {status.setup ? <PinVerifyForm /> : <PinSetupForm />}
      </div>
    </div>
  )
}
