'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Server, Activity, ShieldCheck, Sun, Moon, UploadCloud, Brain, Settings2, ShieldAlert, Landmark, CalendarOff, Trash2, Plus, Eye, EyeOff } from 'lucide-react'
import { useTheme } from '@/lib/theme-provider'
import { toggleWhitelistActivaPersisted } from '@/lib/whitelist-toggle.mjs'
import { getSystemConfig, updateSystemConfig } from '../actions'
import { createClient } from '@/lib/supabase'

export function ConfigTab() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)

  // Estados Locales para el formulario
  const [aiProvider, setAiProvider] = useState('anthropic')
  const [aiApiKey, setAiApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [whitelistActiva, setWhitelistActiva] = useState(false)
  const [whitelistInput, setWhitelistInput] = useState('')
  const [savingWhitelistToggle, setSavingWhitelistToggle] = useState(false)
  
  // Datos Bancarios
  const [banco, setBanco] = useState('')
  const [tipoCuenta, setTipoCuenta] = useState('')
  const [numeroCuenta, setNumeroCuenta] = useState('')
  const [titular, setTitular] = useState('')
  const [cedula, setCedula] = useState('')

  // Feriados
  const [feriados, setFeriados] = useState([])
  const [nuevoFeriadoFecha, setNuevoFeriadoFecha] = useState('')
  const [nuevoFeriadoNombre, setNuevoFeriadoNombre] = useState('')

  const supabase = createClient()

  const fetchFeriados = async () => {
    const { data } = await supabase.from('feriados').select('*').order('fecha', { ascending: true })
    if (data) setFeriados(data)
  }

  useEffect(() => {
    async function load() {
      const res = await getSystemConfig()
      if (res.config) {
        setConfig(res.config)
        setAiProvider(res.config.ai_provider || 'anthropic')
        setAiApiKey(res.config.ai_api_key || '')
        setWhitelistActiva(res.config.whitelist_activa || false)
        setWhitelistInput((res.config.whitelist_numeros || []).join(', '))
        
        const db = res.config.datos_bancarios || {}
        setBanco(db.banco || '')
        setTipoCuenta(db.tipo_cuenta || '')
        setNumeroCuenta(db.numero || '')
        setTitular(db.titular || '')
        setCedula(db.cedula || '')
      }
      await fetchFeriados()
      setLoading(false)
    }
    load()
  }, [])

  const handleSaveProviders = async () => {
    setSavingSettings(true)
    const updates = {
      ai_provider: aiProvider,
      ai_api_key: aiApiKey || null,
    }
    await updateSystemConfig(updates)
    setSavingSettings(false)
  }

  const handleSaveSecurity = async () => {
    setSavingSettings(true)
    const numeros = whitelistInput.split(',').map(n => n.trim()).filter(n => n.length > 0)
    const updates = {
      whitelist_activa: whitelistActiva,
      whitelist_numeros: numeros,
    }
    await updateSystemConfig(updates)
    setSavingSettings(false)
  }

  const handleToggleWhitelistActiva = async () => {
    if (savingWhitelistToggle) return

    const currentValue = whitelistActiva
    setWhitelistActiva(!currentValue) // optimista
    setSavingWhitelistToggle(true)

    try {
      const res = await toggleWhitelistActivaPersisted({
        currentValue,
        updateFn: updateSystemConfig,
      })

      if (!res?.ok) {
        console.error('Error actualizando whitelist_activa:', res?.error)
        setWhitelistActiva(currentValue)
      }
    } finally {
      setSavingWhitelistToggle(false)
    }
  }

  const handleSaveBank = async () => {
    setSavingSettings(true)
    const updates = {
      datos_bancarios: {
        banco,
        tipo_cuenta: tipoCuenta,
        numero: numeroCuenta,
        titular,
        cedula
      }
    }
    await updateSystemConfig(updates)
    setSavingSettings(false)
  }

  const handleAddFeriado = async () => {
    if (!nuevoFeriadoFecha || !nuevoFeriadoNombre) return
    const anio = parseInt(nuevoFeriadoFecha.split('-')[0])
    await supabase.from('feriados').insert([{
      fecha: nuevoFeriadoFecha,
      nombre: nuevoFeriadoNombre,
      anio
    }])
    setNuevoFeriadoFecha('')
    setNuevoFeriadoNombre('')
    await fetchFeriados()
  }

  const handleDeleteFeriado = async (id) => {
    await supabase.from('feriados').delete().eq('id', id)
    await fetchFeriados()
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">Cargando configuración...</div>
  }

  return (
    <div className="flex flex-col gap-6 h-full max-w-5xl pb-10">
      <div className="grid gap-6 md:grid-cols-2">
        
        {/* ==================================================== */}
        {/* COLUMNA IZQUIERDA                                    */}
        {/* ==================================================== */}
        <div className="space-y-6">
          <Card className="border-secondary/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Landmark className="h-5 w-5 text-kely-green" /> Datos Bancarios
              </CardTitle>
              <CardDescription className="text-xs">
                Información para transferencias que Sofía enviará a los pacientes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Banco</Label>
                <Input value={banco} onChange={e => setBanco(e.target.value)} placeholder="Ej: Banco Pichincha" className="h-8 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Cuenta</Label>
                  <select 
                    value={tipoCuenta} 
                    onChange={e => setTipoCuenta(e.target.value)}
                    className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-kely-green"
                  >
                    <option value="">Seleccione...</option>
                    <option value="Ahorros">Ahorros</option>
                    <option value="Corriente">Corriente</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Número de Cuenta</Label>
                  <Input value={numeroCuenta} onChange={e => setNumeroCuenta(e.target.value)} placeholder="Ej: 2200..." className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Titular de la Cuenta</Label>
                <Input value={titular} onChange={e => setTitular(e.target.value)} placeholder="Nombre completo" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cédula / RUC</Label>
                <Input value={cedula} onChange={e => setCedula(e.target.value)} placeholder="Identificación" className="h-8 text-sm" />
              </div>
            </CardContent>
            <CardFooter>
              <Button size="sm" onClick={handleSaveBank} disabled={savingSettings} className="bg-kely-green hover:bg-kely-green/90 text-white w-full">
                Guardar Datos Bancarios
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-secondary/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CalendarOff className="h-5 w-5 text-orange-500" /> Feriados y Días Libres
              </CardTitle>
              <CardDescription className="text-xs">
                Fechas en las que no habrá atención.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Nombre</Label>
                  <Input value={nuevoFeriadoNombre} onChange={e => setNuevoFeriadoNombre(e.target.value)} placeholder="Ej: Navidad" className="h-8 text-sm" />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Fecha</Label>
                  <Input type="date" value={nuevoFeriadoFecha} onChange={e => setNuevoFeriadoFecha(e.target.value)} className="h-8 text-sm" />
                </div>
                <Button size="icon" className="h-8 w-8 bg-kely-green hover:bg-kely-green/90 text-white shrink-0" onClick={handleAddFeriado}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="border rounded-md divide-y max-h-40 overflow-y-auto custom-scrollbar">
                {feriados.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground p-3">No hay feriados registrados.</p>
                ) : (
                  feriados.map(f => (
                    <div key={f.id} className="flex justify-between items-center p-2 text-sm hover:bg-muted/30">
                      <div>
                        <div className="font-medium">{f.nombre}</div>
                        <div className="text-[10px] text-muted-foreground">{f.fecha}</div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteFeriado(f.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>


        {/* ==================================================== */}
        {/* COLUMNA DERECHA                                      */}
        {/* ==================================================== */}
        <div className="space-y-6">
          <Card className="border-secondary/50 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5 text-kely-green" /> Configuración del Agente
              </CardTitle>
              <CardDescription className="text-xs">
                Selecciona el proveedor de IA que usará el agente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Proveedor IA</Label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-kely-green"
                >
                  <option value="anthropic">anthropic</option>
                  <option value="gemini">gemini</option>
                  <option value="openai">openai</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">API Key del proveedor IA</Label>
                <div className="relative">
                  <Input 
                    type={showApiKey ? "text" : "password"} 
                    value={aiApiKey} 
                    onChange={e => setAiApiKey(e.target.value)} 
                    placeholder="Introduce tu API Key" 
                    className="h-9 text-sm pr-9" 
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button size="sm" onClick={handleSaveProviders} disabled={savingSettings} className="w-full bg-kely-green hover:bg-kely-green/90 text-white">
                Guardar Proveedor IA
              </Button>
            </CardFooter>
          </Card>
          
          <Card className="border-destructive/20 relative overflow-hidden shadow-sm">
            <div className="absolute top-0 right-0 p-2">
               {whitelistActiva ? <ShieldCheck className="h-6 w-6 text-kely-green" /> : <ShieldAlert className="h-6 w-6 text-destructive" />}
            </div>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> Whitelist de Test
              </CardTitle>
              <CardDescription className="text-xs">
                Solo estos números podrán hablar con el sistema si esto está activado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm bg-muted/10">
                <div className="space-y-0.5">
                  <Label>Protección Pre-LLM (Activa)</Label>
                </div>
                <div>
                  <Button 
                    variant={whitelistActiva ? 'default' : 'outline'} 
                    size="sm" 
                    className={whitelistActiva ? "bg-kely-green text-white hover:bg-kely-green/90" : ""}
                    onClick={handleToggleWhitelistActiva}
                    disabled={savingWhitelistToggle}
                  >
                    {savingWhitelistToggle ? 'Guardando…' : (whitelistActiva ? 'Activada' : 'Desactivada')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">
                  Números Autorizados (Separados por Coma)
                </Label>
                <textarea 
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green"
                  placeholder="ej: 59399999999, 59388888888"
                  value={whitelistInput}
                  onChange={(e) => setWhitelistInput(e.target.value)}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button size="sm" onClick={handleSaveSecurity} disabled={savingSettings} variant="secondary" className="w-full">
                Guardar Whitelist
              </Button>
            </CardFooter>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Settings2 className="h-5 w-5" /> Configuración de UI
              </CardTitle>
              <CardDescription className="text-xs">
                Elige si quieres ver el CRM en claro, oscuro o siguiendo el tema del dispositivo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
               <div className="flex flex-wrap gap-2">
                  <Button
                    variant={theme === 'light' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('light')}
                    className={theme === 'light' ? 'bg-kely-green hover:bg-kely-green/90 text-white' : ''}
                  >
                    <Sun className="w-4 h-4 mr-2" /> Claro
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('dark')}
                    className={theme === 'dark' ? 'bg-kely-green hover:bg-kely-green/90 text-white' : ''}
                  >
                    <Moon className="w-4 h-4 mr-2" /> Oscuro
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('system')}
                    className={theme === 'system' ? 'bg-kely-green hover:bg-kely-green/90 text-white' : ''}
                  >
                    <Settings2 className="w-4 h-4 mr-2" /> Sistema
                  </Button>
               </div>
               <p className="text-xs text-muted-foreground">
                 Tema activo: <span className="font-medium text-foreground capitalize">{theme === 'system' ? `Sistema (${resolvedTheme})` : theme}</span>
               </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm bg-muted/30">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <CardTitle className="text-base font-semibold">Estado del Sistema</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="flex items-center gap-2 font-medium"><Server className="w-4 h-4 text-kely-green"/> Base de Datos</span>
                  <Badge variant="outline" className="text-kely-green border-kely-green bg-kely-green/10">Activa</Badge>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="flex items-center gap-2 font-medium"><UploadCloud className="w-4 h-4 text-blue-500"/> WhatsApp (YCloud)</span>
                  <Badge variant="outline" className="text-blue-500 border-blue-500 bg-blue-500/10">Conectado</Badge>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="flex items-center gap-2 font-medium"><Brain className="w-4 h-4 text-purple-500"/> Agente IA</span>
                  <Badge variant="outline" className="text-purple-500 border-purple-500 bg-purple-500/10">Lista</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
          
        </div>
      </div>
    </div>
  )
}
