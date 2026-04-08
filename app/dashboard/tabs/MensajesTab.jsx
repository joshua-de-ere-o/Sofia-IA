'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Search, UserCheck, MessageSquareText, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { sendManualMessage, resolveHandoff } from '../actions'

export function MensajesTab() {
  const [conversaciones, setConversaciones] = useState([])
  const [selectedConv, setSelectedConv] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchConversaciones = useCallback(async () => {
    const { data, error } = await supabase
      .from('conversaciones')
      .select('*, paciente:pacientes(nombre, telefono)')
      .order('ultima_actividad', { ascending: false })

    if (data) {
      setConversaciones(data)
    }
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
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [selectedConv, conversaciones])

  const conversacionesFiltradas = conversaciones.filter(conv => {
    const nombre = conv.paciente?.nombre || conv.telefono_contacto || ''
    return nombre.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const activeConvData = conversaciones.find(c => c.id === selectedConv)

  const handleRetomar = async () => {
    if (!activeConvData) return
    await resolveHandoff(activeConvData.id)
    fetchConversaciones()
  }

  const handleSendMessage = async () => {
    if (!inputText.trim() || !activeConvData || sending) return
    
    setSending(true)
    const telefono = activeConvData.paciente?.telefono || activeConvData.telefono_contacto
    await sendManualMessage(activeConvData.id, telefono, inputText.trim())
    setInputText('')
    setSending(false)
    fetchConversaciones()
  }

  const formatTime = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col md:flex-row gap-4">
      {/* Lista de Chats (Sidebar) */}
      <div className="w-full md:w-1/3 border-r pr-4 flex flex-col gap-4">
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
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {loading ? (
            <p className="text-center text-xs text-muted-foreground mt-4">Cargando...</p>
          ) : conversacionesFiltradas.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground mt-4">No se encontraron conversaciones.</p>
          ) : (
            conversacionesFiltradas.map(conv => {
              const nombre = conv.paciente?.nombre || conv.telefono_contacto
              const msgRaw = conv.mensajes_raw || []
              let ultimoMensaje = ''
              if (msgRaw.length > 0) {
                 ultimoMensaje = msgRaw[msgRaw.length - 1].content || 'Mensaje multimedia'
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
                  {conv.handoff_activo && (
                    <Badge variant="destructive" className="mt-2 text-[10px] px-1.5 py-0">Requiere Atención</Badge>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Área de Chat (Main) */}
      <div className="flex-1 flex flex-col min-h-0 bg-background rounded-lg border">
        {activeConvData ? (
          <>
             <div className="flex justify-between items-center border-b p-4 bg-card rounded-t-lg">
              <div>
                <h3 className="font-semibold">{activeConvData.paciente?.nombre || activeConvData.telefono_contacto}</h3>
                <p className="text-xs text-muted-foreground">
                  {activeConvData.estado === 'activa' && !activeConvData.handoff_activo 
                    ? 'Sofía está atendiéndolo (Agente Activo)'
                    : activeConvData.handoff_activo ? 'Esperando respuesta manual' : 'Chat inactivo'}
                </p>
              </div>
              {activeConvData.handoff_activo && (
                 <Button size="sm" variant="outline" onClick={handleRetomar} className="text-kely-green border-kely-green hover:bg-kely-teal hover:text-kely-green dark:hover:bg-kely-teal/20">
                  <UserCheck className="w-4 h-4 mr-2" /> Marcar Resuelto
                </Button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30">
              {(activeConvData.mensajes_raw || []).map((msg, i) => {
                 const isBot = msg.role === 'assistant' || msg.role === 'system';
                 const isSystem = msg.role === 'system'
                 if (isSystem) return null; // We can hide system messages
                 
                 return (
                  <div key={i} className={`flex ${isBot ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${isBot ? 'bg-kely-green text-white rounded-br-none' : 'bg-card border rounded-bl-none'}`}>
                      {msg.content}
                    </div>
                  </div>
                 )
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-card border-t rounded-b-lg flex gap-2 items-center">
              <input 
                type="text" 
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-kely-green" 
                placeholder="Escribe un mensaje..." 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                disabled={sending}
              />
              <Button onClick={handleSendMessage} disabled={sending} size="icon" className="bg-kely-green hover:bg-kely-green/90 text-white shrink-0">
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
