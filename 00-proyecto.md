# 00 — Visión General del Proyecto

## Producto

Sistema de agendamiento por WhatsApp para la consulta nutricional de la Dra. Kely León (Quito, Ecuador). Un agente IA llamado **Sofía** atiende pacientes por WhatsApp, agenda citas, cobra adelantos y notifica a la doctora por Telegram.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend + API Routes | Next.js 14 App Router |
| Base de datos + Auth + Realtime | Supabase (PostgreSQL) |
| Agent loop | Supabase Edge Functions (TypeScript) |
| Hosting | Vercel (plan gratuito) |
| WhatsApp API | YCloud |
| Notificaciones doctora | Telegram Bot API |
| Modelo IA | Claude Haiku 4.5 |
| UI | shadcn/ui · Plus Jakarta Sans |

## Flujo Principal

```
Paciente (WhatsApp)
  → YCloud webhook
  → app/api/webhook/route.js (Vercel — valida, enruta)
  → supabase/functions/agent-runner/index.ts (Edge Function — loop agéntico)
      → Filtro 3 capas (whitelist → keywords → clasificador IA)
      → Claude Haiku 4.5 con tools
      → Supabase BD
  → YCloud → respuesta WhatsApp al paciente
  → Telegram Bot → notificación a Kelly (si handoff)
```

## Estructura de Archivos

```
agente-kelly/
├── .antigravity/rules.md
├── specs/                          ← fuente de verdad de negocio
├── app/
│   ├── api/webhook/route.js        ← webhook YCloud
│   ├── api/telegram/route.js       ← webhook Telegram
│   ├── dashboard/page.js           ← CRM
│   └── login/page.js               ← login + PIN
├── lib/
│   ├── agent.js                    ← system prompt + tools
│   ├── supabase.js                 ← cliente BD
│   ├── ycloud.js                   ← enviar mensajes WA
│   ├── telegram.js                 ← notificaciones
│   └── handoff.js                  ← lógica de transferencia
└── supabase/
    ├── functions/agent-runner/index.ts
    └── migrations/                 ← SQL schema
```

## Alcance V1

- Agente Sofía funcional en WhatsApp.
- Agenda propia en Supabase.
- Pago por transferencia (comprobante por imagen).
- CRM básico con pestañas: Mensajes, Citas, Reportes, Configuración.
- Handoff a Telegram.
- Recordatorios automáticos (24h, 2h, reactivación 8 días).

## Fuera de Alcance V1

- PayPhone (schema preparado, no implementado).
- Google Calendar (campo `external_calendar_id` nullable).
- Métricas avanzadas en CRM.
