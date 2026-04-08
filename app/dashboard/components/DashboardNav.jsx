'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageSquare, CalendarDays, BarChart3, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DashboardNav() {
  const pathname = usePathname()

  const navItems = [
    { href: '/dashboard', icon: MessageSquare, label: 'Mensajes', exact: true },
    { href: '/dashboard/citas', icon: CalendarDays, label: 'Citas' },
    { href: '/dashboard/reportes', icon: BarChart3, label: 'Reportes' },
    { href: '/dashboard/configuracion', icon: Settings, label: 'Ajustes' },
  ]

  const isActive = (itemHref, exact = false) => {
    if (exact) {
      return pathname === itemHref
    }
    return pathname.startsWith(itemHref)
  }

  return (
    <>
      <aside className="hidden w-64 flex-col border-r bg-card px-4 py-6 md:flex">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="h-8 w-8 rounded-full bg-kely-teal flex items-center justify-center text-kely-green font-bold shadow-sm">
            K
          </div>
          <span className="text-lg font-bold text-kely-green tracking-tight">Dra. Kely</span>
        </div>
        
        <nav className="flex-1 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href, item.exact)
            return (
              <Link 
                key={item.href} 
                href={item.href} 
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active 
                    ? "bg-kely-teal text-kely-green" 
                    : "text-muted-foreground hover:bg-auto hover:text-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", active ? "text-kely-green" : "")} />
                {item.label}
              </Link>
            )
          })}
        </nav>
        
        <div className="border-t pt-4">
          <form action="/auth/signout" method="post">
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut className="h-5 w-5" />
              Cerrar Sesión
            </button>
          </form>
        </div>
      </aside>

      {/* Bottom Navigation for Mobile */}
      <nav className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-50 flex w-full items-center justify-around border-t border-border/80 bg-card/95 px-2 backdrop-blur md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href, item.exact)
          return (
            <Link 
              key={item.href} 
              href={item.href} 
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-medium transition-colors",
                active ? "text-kely-green" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className={cn(
                "flex h-10 w-10 items-center justify-center rounded-2xl transition-colors",
                active ? "bg-kely-green/10 text-kely-green" : "text-muted-foreground"
              )}>
                <Icon className="h-5 w-5" />
              </div>
              <span>{item.label}</span>
            </Link>
          )
        })}

        <form action="/auth/signout" method="post" className="flex h-full w-full">
          <button
            type="submit"
            className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive transition-colors">
              <LogOut className="h-5 w-5" />
            </div>
            <span>Cerrar</span>
          </button>
        </form>
      </nav>
    </>
  )
}
