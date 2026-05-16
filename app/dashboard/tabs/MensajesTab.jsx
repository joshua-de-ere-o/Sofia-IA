'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, UserCheck, MessageSquareText, Send, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { sendManualMessage, resolveHandoff } from '../actions'

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
    <div className="flex min-h-0 flex-1 flex-col gap-4 pb-2 md:flex-row">
      {/* Lista de Chats */}
      <div
        className={`${showChat ? 'hidden md:flex' : 'flex'} w-full flex-col gap-4 md:w-1/3 md:border-r md:pr-4`}
      >
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar paciente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green pl-9"
          />
        </div>
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

              return (
                <div
                  key={conv.id}
                  onClick={() => setSelectedConv(conv.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedConv === conv.id ? 'bg-kely-teal/30 border-kely-green dark:bg-kely-teal/10' : 'bg-card hover:border-kely-green'}`}
                >
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
  )
}
