# Rules — Agente de Construcción (Antigravity)

> Estas reglas gobiernan al agente de Antigravity que **construye** el software.
> NO confundir con Sofía, el agente que **vive dentro** del sistema y atiende pacientes.

---

## Proyecto

- **Nombre:** agente-kelly
- **Cliente:** Dra. Kely León — Nutricionista Clínica y Deportiva, Quito, Ecuador
- **Producto:** Sistema de agendamiento por WhatsApp con agente IA (Sofía)
- **Stack:** Next.js 14 App Router · Supabase (PostgreSQL + Edge Functions + Auth + Realtime) · Vercel (free) · YCloud (WhatsApp API) · Telegram Bot API · Claude Haiku 4.5 · shadcn/ui

---

## Arquitectura — Decisiones Cerradas

Estas decisiones están tomadas. No propongas alternativas ni las cuestiones.

1. **Agent loop en Supabase Edge Functions** — no en Vercel API Routes (evita timeout de 10s del plan gratuito).
2. **Webhook de entrada en `app/api/webhook/route.js`** — Vercel recibe, valida y enruta a la Edge Function.
3. **Telegram para notificaciones a la doctora** — no email, no SMS, no push.
4. **Claude Haiku 4.5 como modelo de producción** — no Sonnet, no GPT. Endpoint: `https://api.anthropic.com/v1/messages`, modelo: `claude-haiku-4-5-20250315`.
5. **Supabase Auth + PIN de 4 dígitos** para acceso al CRM.
6. **YCloud como puente WhatsApp** — no Twilio, no Meta directo.
7. **shadcn/ui** para componentes del CRM.
8. **Agenda propia en Supabase (V1)** — Google Calendar es V2.
9. **PayPhone preparado en schema pero no implementado en V1** — solo transferencia bancaria.
10. **Supabase Realtime** para chat en vivo en el CRM — no polling.

---

## Specs como Fuente de Verdad

- Toda la lógica de negocio está en los archivos `specs/*.md`.
- Si hay contradicción entre el código y un spec, **el spec tiene razón**.
- No inventes reglas de negocio. Si algo no está en los specs, pregunta.
- Los specs están numerados por dependencia: `00-proyecto.md` → `08-auth.md`.

---

## Convenciones de Código

### General
- Lenguaje del código: **inglés** (variables, funciones, comentarios técnicos).
- Lenguaje de UI y mensajes al usuario: **español** (Ecuador).
- Archivos: kebab-case (`agent-runner.ts`, `payment-logic.js`).
- Componentes React: PascalCase (`AppointmentCard.jsx`).

### Next.js
- App Router — no Pages Router.
- Server Components por defecto. `"use client"` solo cuando sea necesario.
- API Routes en `app/api/`.
- Imports con `@/` alias apuntando a la raíz del proyecto.

### Supabase
- Cliente server-side: `createServerComponentClient` o `createRouteHandlerClient`.
- Cliente client-side: `createBrowserClient`.
- Edge Functions en TypeScript (`supabase/functions/*/index.ts`).
- Row Level Security (RLS) activo en todas las tablas.
- Migraciones SQL en `supabase/migrations/`.

### Estilo UI (CRM)
- Paleta: blanco `#FFFFFF`, teal suave `#F0FDFA`, verde `#22C55E`, grises elegantes.
- Tipografía: Plus Jakarta Sans.
- Componentes: shadcn/ui — no instalar otras librerías de UI.
- Responsive: mobile-first (Kelly accede desde el teléfono).

---

## Lógica del Agente Sofía — Reglas Críticas

Estas reglas aplican al system prompt y herramientas que construyas para Sofía:

1. **Sofía NUNCA da recomendaciones médicas, dosifica medicamentos ni diagnostica.**
2. **Plan Esencial ($35) es el plan por defecto** si el paciente no especifica.
3. **Adelanto por zona:** Sur de Quito = sin adelanto. Norte/Virtual = 50%. Valle = 50% de (plan + $5). Domicilio = 50% de $40 fijo.
4. **Franja almuerzo (13:00–15:00) siempre bloqueada.**
5. **Ventana de agenda: máximo 14 días calendario.**
6. **Separación entre citas: 30 minutos.**
7. **Handoff a Telegram** ante: medicamentos, dudas clínicas, reclamos, disputas de pago, urgencias, convenios, prensa.
8. **Timeout de handoff: 30 min por conversación individual** — el sistema sigue activo para otros chats.
9. **Confirmación instantánea** al recibir comprobante de transferencia — Kelly audita después.
10. **Recordatorios:** 24h antes, 2h antes, reactivación a los 8 días.

---

## Seguridad y Datos

- Nunca loguear datos personales de pacientes en texto plano (nombres, teléfonos, fechas de nacimiento).
- Comprobantes de pago (imágenes) se guardan en Supabase Storage, referenciados por ID en la tabla de pagos.
- Las API keys (Anthropic, YCloud, Telegram) van en variables de entorno — nunca hardcodeadas.
- Validar todo input del webhook de YCloud antes de procesarlo.

---

## Optimización de Costos — Implementar Siempre

- **Prompt caching** activo en cada llamada a Claude (system prompt cacheado).
- **Historial resumido** después de 6 mensajes en una conversación.
- **max_tokens:** 300 para respuestas normales, 100 para confirmaciones.
- **Filtro pre-LLM de 3 capas** antes de invocar a Claude: whitelist de teléfonos → detección de keywords → clasificador IA opcional.
- **Batch API** para envío de recordatorios en lote.

---

## Qué NO Hacer

- No agregar dependencias sin que estén en el stack definido.
- No crear endpoints que no estén mapeados en los specs.
- No implementar PayPhone en V1 — solo dejar el schema preparado.
- No usar Google Calendar en V1 — campo `external_calendar_id` nullable y listo.
- No cambiar el nombre del agente (es Sofía, no "Asistente", no "Bot").
- No mezclar la lógica del CRM con la lógica del agente — son capas separadas.
