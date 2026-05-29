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
      <main className="flex-1 overflow-y-auto w-full">
        <header className="flex h-14 md:hidden items-center border-b bg-card px-4 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm">
              <img
                src="/icon.svg"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            </div>
            <span className="text-lg font-bold text-kely-green tracking-tight">Dra. Kely León</span>
          </div>
        </header>
        <div className="mobile-content-shell mx-auto min-h-full max-w-6xl p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
