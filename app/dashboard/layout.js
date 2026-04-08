import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { DashboardNav } from './components/DashboardNav'

export default async function DashboardLayout({ children }) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      redirect('/login')
    }
  }

  return (
    <div className="flex h-screen w-full flex-col bg-background md:flex-row">
      <DashboardNav />

      {/* Main Content Area */}
      <main className="mobile-content-shell flex-1 overflow-y-auto w-full md:pb-0">
        <header className="flex h-14 md:hidden items-center border-b bg-card px-4 sticky top-0 z-10 shadow-sm">
          <span className="text-lg font-bold text-kely-green">Dra. Kely CRM</span>
        </header>
        <div className="mx-auto h-full max-w-6xl p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
