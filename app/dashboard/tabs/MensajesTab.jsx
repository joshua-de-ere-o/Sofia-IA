'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, UserCheck, MessageSquareText, Send, ArrowLeft, Trash2, X, CheckSquare, Square, Power, PowerOff } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { sendManualMessage, resolveHandoff, deleteConversaciones, setConversacionMode, getAgenteGlobal, setAgenteGlobal } from '../actions'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

function cleanIncomingContent(content) {
  if (typeof content !== 'string') return content || ''
  const marker = '[MENSAJE DEL USUARIO]:'
  const idx = content.indexOf(marker)
  if (idx === -1) return content
  return content.slice(idx + marker.length).trim()
}

export function MensajesTab() {
  const [conversaciones, setConversaciones] = useState([])
  const [selectedConv, setSelectedConv] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [showLoading, setShowLoading] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingByConv, setPendingByConv] = useState({})
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [togglingSofia, setTogglingSofia] = useState(false)
  const [agenteActivo, setAgenteActivo] = useState(true)
  const [togglingGlobal, setTogglingGlobal] = useState(false)
  const messagesEndRef = useRef(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchConversaciones = useCallback(async () => {
    const { data } = await supabase
      .from('conversaciones')
      .select('*, paciente:pacientes(nombre, telefono)')
      .order('ultima_actividad', { ascending: false })

    if (data) setConversaciones(data)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchConversaciones()

    const channel = supabase
      .channel('public:conversaciones')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones' }, () => {
        fetchConversaciones()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchConversaciones, supabase])

  useEffect(() => {
    let cancelled = false
    getAgenteGlobal().then(res => {
      if (!cancelled && res && !res.error) setAgenteActivo(res.activo)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loading) {
      setShowLoading(false)
      return
    }
    const t = setTimeout(() => setShowLoading(true), 250)
    return () => clearTimeout(t)
  }, [loading])

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [selectedConv, conversaciones, pendingByConv])

  const conversacionesFiltradas = conversaciones.filter(conv => {
    const nombre = conv.paciente?.nombre || conv.telefono_contacto || ''
    return nombre.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const activeConvData = conversaciones.find(c => c.id === selectedConv)

  // Reconcile optimistic messages: drop pending entries that now appear in server data
  useEffect(() => {
    if (!activeConvData) return
    const pending = pendingByConv[activeConvData.id]
    if (!pending || pending.length === 0) return

    const serverContents = new Set(
      (activeConvData.mensajes_raw || [])
        .filter(m => m.sender === 'kelly' || m.role === 'assistant')
        .map(m => m.content)
    )
    const remaining = pending.filter(p => !serverContents.has(p.content))
    if (remaining.length !== pending.length) {
      setPendingByConv(prev => ({ ...prev, [activeConvData.id]: remaining }))
    }
  }, [activeConvData, pendingByConv])

  const handleRetomar = async () => {
    if (!activeConvData) return
    await resolveHandoff(activeConvData.id)
    fetchConversaciones()
  }

  const handleToggleSofia = async () => {
    if (!activeConvData || togglingSofia) return
    const sofiaActiva = activeConvData.mode !== 'manual' && activeConvData.mode !== 'personal'
    const nextMode = sofiaActiva ? 'manual' : 'auto'
    setTogglingSofia(true)
    const res = await setConversacionMode(activeConvData.id, nextMode)
    setTogglingSofia(false)
    if (res?.error) {
      alert('No se pudo cambiar el estado de Sofía: ' + res.error)
      return
    }
    fetchConversaciones()
  }

  const handleToggleGlobal = async () => {
    if (togglingGlobal) return
    const next = !agenteActivo
    setTogglingGlobal(true)
    setAgenteActivo(next) // optimista
    const res = await setAgenteGlobal(next)
    setTogglingGlobal(false)
    if (res?.error) {
      setAgenteActivo(!next) // revertir
      alert('No se pudo cambiar el estado global de Sofía: ' + res.error)
    }
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelectionMode = () => {
    if (selectionMode) {
      exitSelectionMode()
    } else {
      setSelectionMode(true)
    }
  }

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0 || deleting) return
    setDeleting(true)
    const ids = [...selectedIds]
    const res = await deleteConversaciones(ids)
    setDeleting(false)

    if (res?.error) {
      alert('Error borrando conversaciones: ' + res.error)
      return
    }

    // Si el chat abierto fue borrado, cerralo.
    if (selectedConv && ids.includes(selectedConv)) {
      setSelectedConv(null)
    }
    setConfirmOpen(false)
    exitSelectionMode()
    fetchConversaciones()
  }

  const handleSendMessage = async () => {
    const text = inputText.trim()
    if (!text || !activeConvData || sending) return

    const telefono = activeConvData.paciente?.telefono || activeConvData.telefono_contacto
    const convId = activeConvData.id
    const optimistic = {
      role: 'assistant',
      sender: 'kelly',
      content: text,
      timestamp: new Date().toISOString(),
      _pending: true,
    }

    setPendingByConv(prev => ({
      ...prev,
      [convId]: [...(prev[convId] || []), optimistic],
    }))
    setInputText('')
    setSending(true)

    const res = await sendManualMessage(convId, telefono, text)
    setSending(false)

    if (res?.error) {
      setPendingByConv(prev => ({
        ...prev,
        [convId]: (prev[convId] || []).filter(m => m !== optimistic),
      }))
      alert('Error enviando mensaje: ' + res.error)
      setInputText(text)
      return
    }

    fetchConversaciones()
  }

  const formatTime = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const mensajesParaMostrar = activeConvData
    ? [
        ...(activeConvData.mensajes_raw || []),
        ...(pendingByConv[activeConvData.id] || []),
      ]
    : []

  const showChat = !!selectedConv

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      {/* Switch maestro global de Sofía */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 ${
          agenteActivo ? 'bg-card' : 'bg-destructive/10 border-destructive'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {agenteActivo ? (
            <Power className="h-4 w-4 shrink-0 text-kely-green" />
          ) : (
            <PowerOff className="h-4 w-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {agenteActivo ? 'Sofía activa' : 'Sofía pausada (global)'}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {agenteActivo
                ? 'Responde automáticamente a todos los pacientes'
                : 'No responde a nadie; los mensajes entrantes igual se guardan'}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={agenteActivo ? 'outline' : 'destructive'}
          onClick={handleToggleGlobal}
          disabled={togglingGlobal}
          className="shrink-0"
        >
          {togglingGlobal ? '…' : agenteActivo ? 'Pausar' : 'Activar'}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      {/* Lista de Chats */}
      <div
        className={`${showChat ? 'hidden md:flex' : 'flex'} w-full flex-col gap-4 md:w-1/3 md:border-r md:pr-4`}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar paciente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green pl-9"
            />
          </div>
          <Button
            size="icon"
            variant={selectionMode ? 'secondary' : 'outline'}
            onClick={toggleSelectionMode}
            className="shrink-0"
            title={selectionMode ? 'Salir de selección' : 'Seleccionar para borrar'}
            aria-label={selectionMode ? 'Salir de selección' : 'Seleccionar para borrar'}
          >
            {selectionMode ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>

        {selectionMode && (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={exitSelectionMode}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Borrar ({selectedIds.size})
              </Button>
            </div>
          </div>
        )}
        <div className="min-h-[220px] flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar md:min-h-0">
          {loading ? (
            <p className="text-center text-xs text-muted-foreground mt-4">{showLoading ? 'Cargando...' : null}</p>
          ) : conversacionesFiltradas.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground mt-4">No se encontraron conversaciones.</p>
          ) : (
            conversacionesFiltradas.map(conv => {
              const nombre = conv.paciente?.nombre || conv.telefono_contacto
              const msgRaw = conv.mensajes_raw || []
              let ultimoMensaje = ''
              if (msgRaw.length > 0) {
                const last = msgRaw[msgRaw.length - 1]
                const isUser = last.role === 'user'
                ultimoMensaje = (isUser ? cleanIncomingContent(last.content) : last.content) || 'Mensaje multimedia'
              }

              const isSelected = selectedIds.has(conv.id)

              return (
                <div
                  key={conv.id}
                  onClick={() => (selectionMode ? toggleSelected(conv.id) : setSelectedConv(conv.id))}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectionMode && isSelected
                      ? 'bg-destructive/10 border-destructive'
                      : selectedConv === conv.id
                        ? 'bg-kely-teal/30 border-kely-green dark:bg-kely-teal/10'
                        : 'bg-card hover:border-kely-green'
                  }`}
                >
                  {selectionMode && (
                    <span className="mt-0.5 shrink-0 text-muted-foreground">
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-destructive" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm truncate">{nombre}</span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                        {formatTime(conv.ultima_actividad)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{ultimoMensaje}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {conv.handoff_activo && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Requiere Atención</Badge>
                      )}
                      {conv.mode === 'personal' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive text-destructive">Personal</Badge>
                      )}
                      {conv.mode === 'manual' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-500 text-orange-600">Manual</Badge>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Área de Chat */}
      <div
        className={`${showChat ? 'flex' : 'hidden md:flex'} min-h-[420px] flex-1 flex-col rounded-lg border bg-background md:min-h-0`}
      >
        {activeConvData ? (
          <>
            <div className="flex items-center gap-3 border-b p-4 bg-card rounded-t-lg">
              <button
                onClick={() => setSelectedConv(null)}
                className="md:hidden -ml-1 p-1.5 rounded hover:bg-muted text-muted-foreground"
                aria-label="Volver a la lista"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">
                  {activeConvData.paciente?.nombre || activeConvData.telefono_contacto}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {activeConvData.mode === 'personal'
                    ? 'Modo PERSONAL — Sofía no responde'
                    : activeConvData.mode === 'manual'
                      ? 'Modo MANUAL — Sofía silenciada temporalmente'
                      : activeConvData.estado === 'activa' && !activeConvData.handoff_activo
                        ? 'Sofía está atendiéndolo (Agente Activo)'
                        : activeConvData.handoff_activo ? 'Esperando respuesta manual' : 'Chat inactivo'}
                </p>
              </div>

              {activeConvData.mode !== 'personal' && (() => {
                const sofiaActiva = activeConvData.mode !== 'manual'
                return (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleSofia}
                    disabled={togglingSofia}
                    title={sofiaActiva ? 'Apagar a Sofía en este chat' : 'Encender a Sofía en este chat'}
                    className={`shrink-0 ${
                      sofiaActiva
                        ? 'text-kely-green border-kely-green hover:bg-kely-teal hover:text-kely-green dark:hover:bg-kely-teal/20'
                        : 'text-orange-600 border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10'
                    }`}
                  >
                    {sofiaActiva ? <Power className="w-4 h-4 mr-2" /> : <PowerOff className="w-4 h-4 mr-2" />}
                    {sofiaActiva ? 'Sofía ON' : 'Sofía OFF'}
                  </Button>
                )
              })()}

              {activeConvData.handoff_activo && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetomar}
                  className="text-kely-green border-kely-green hover:bg-kely-teal hover:text-kely-green dark:hover:bg-kely-teal/20 shrink-0"
                >
                  <UserCheck className="w-4 h-4 mr-2" /> Marcar Resuelto
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30">
              {mensajesParaMostrar.map((msg, i) => {
                if (msg.role === 'system') return null
                const isOutgoing = msg.role === 'assistant'
                const text = isOutgoing ? msg.content : cleanIncomingContent(msg.content)
                if (!text) return null

                return (
                  <div key={i} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
                        isOutgoing
                          ? `bg-kely-green text-white rounded-br-none ${msg._pending ? 'opacity-70' : ''}`
                          : 'bg-card border rounded-bl-none'
                      }`}
                    >
                      {text}
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="message-input-safe-area flex gap-2 rounded-b-lg border-t bg-card p-3 items-center">
              <input
                type="text"
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green"
                placeholder="Escribe un mensaje..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                disabled={sending}
              />
              <Button
                onClick={handleSendMessage}
                disabled={sending || !inputText.trim()}
                size="icon"
                className="bg-kely-green hover:bg-kely-green/90 text-white shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground flex-col gap-2">
            <MessageSquareText className="w-12 h-12 opacity-20" />
            <p className="text-sm">Selecciona una conversación para ver el chat</p>
          </div>
        )}
      </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Borrar conversaciones</DialogTitle>
            <DialogDescription>
              {`Vas a borrar ${selectedIds.size} conversación${selectedIds.size === 1 ? '' : 'es'} del CRM, con todo su historial. Esta acción no se puede deshacer.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteSelected} disabled={deleting}>
              {deleting ? 'Borrando…' : 'Borrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
