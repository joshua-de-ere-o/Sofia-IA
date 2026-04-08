'use client'

import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'kely-theme'

const ThemeContext = createContext({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'light',
})

function getSystemTheme() {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeToDocument(mode) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const resolved = mode === 'system' ? getSystemTheme() : mode

  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = mode
  root.style.colorScheme = resolved

  return resolved
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'system'
    return localStorage.getItem(STORAGE_KEY) || document.documentElement.dataset.theme || 'system'
  })
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  })

  // Load saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || 'system'
    setThemeState(saved)
    const resolved = applyThemeToDocument(saved)
    setResolvedTheme(resolved || 'light')
  }, [])

  // Apply theme class to <html> and resolve system preference
  useEffect(() => {
    const resolved = applyThemeToDocument(theme)
    setResolvedTheme(resolved || 'light')

    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      const nextResolved = applyThemeToDocument('system')
      setResolvedTheme(nextResolved || 'light')
    }

    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = (newTheme) => {
    setThemeState(newTheme)
    localStorage.setItem(STORAGE_KEY, newTheme)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
