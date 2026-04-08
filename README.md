# 🩺 Sistema IA Dra. Kelly

**Sistema IA Dra. Kelly** es una plataforma integral de gestión de citas y CRM médico impulsada por Inteligencia Artificial. Está diseñada para automatizar la atención de pacientes a través de WhatsApp, ofreciendo agendamiento automatizado, pagos integrados, notificaciones proactivas de recordatorios y un panel de administración CRM completo.

---

## 🌟 Características Principales

*   🤖 **Agente IA Conversacional:** Un asistente de Inteligencia Artificial ("Sofía") que gestiona atenciones, responde preguntas médicas y agenda citas las 24 horas del día.
*   💬 **WhatsApp UI Integrado:** Comunicación transparente con los pacientes utilizando la API de YCloud.
*   📅 **Agendamiento Automatizado:** Comprobación de disponibilidad, reserva de espacios y cancelación inteligente sincronizada con la base de datos de pacientes.
*   💳 **Gestión de Pagos:** Flujo automatizado para recepción de comprobantes de pago por transferencia, con almacenamiento seguro y revisión manual desde el panel.
*   🚨 **Handoff (Derivación Humana):** Cuando el agente IA detecta una solicitud compleja, deriva el caso a un agente humano usando Telegram con botones integrados para una rápida resolución.
*   ⏰ **Recordatorios Inteligentes:** Tareas programadas (cron jobs) que notifican a los pacientes sobre sus citas próximas de manera autónoma.
*   📊 **CRM Dashboard:** Panel de administración web para visualizar conversaciones en tiempo real, calendario de citas, métricas, y gestionar la configuración y accesos.
*   🔒 **Seguridad y Privacidad:** Autenticación de doble factor basada en Supabase Auth y PIN de 4 dígitos, además de Row Level Security (RLS) en base de datos.

---

## 🏗️ Arquitectura Técnica

El sistema está construido mediante un stack moderno de tecnologías robustas de nivel de producción:

*   **Frontend:** [Next.js 14](https://nextjs.org) (App Router), React, Tailwind CSS, shadcn/ui.
*   **Backend / Base de Datos:** [Supabase](https://supabase.com) (PostgreSQL).
*   **Seguridad BD:** Row Level Security (RLS) aplicado a todas las tablas (Pacientes, Citas, Conversaciones, Pagos, etc.).
*   **Lógica Serverless:** Funciones perimetrales (Edge Functions) en Deno (`agent-runner`, `calcular-precio`, `enviar-recordatorios`).
*   **Tareas Programadas:** Extensión `pg_cron` de PostgreSQL para cron jobs automáticos de recordatorios.
*   **Integraciones:** 
    *   **YCloud:** Para los webhooks y reenvíos de mensajes en WhatsApp.
    *   **Telegram:** Para el protocolo Handoff.
    *   **Anthropic:** Para inferencia y motor del Agente IA (con soporte para Model Adapter).

---

## 🚀 Despliegue e Instalación

### Requisitos Previos
*   [Node.js](https://nodejs.org/en/) & npm/yarn/pnpm
*   Cuenta de [Supabase](https://supabase.com) (Para la base de datos y Auth)
*   Cuenta de [YCloud](https://ycloud.com/) (Para la API de WhatsApp)
*   Bot de [Telegram](https://core.telegram.org/bots) (Para Handoffs)

### Configuración del Entorno (`.env.local`)

Clona el repositorio y crea un archivo `.env.local` en la raíz del proyecto (basado en el archivo `.env.local.example` si existe, o con las siguientes llaves):

```env
# URL y claves de Supabase
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# Proveedores de IA (Ej. Anthropic, OpenAI)
ANTHROPIC_API_KEY=tu_anthropic_api_key

# Proveedor SMS/WhatsApp (YCloud)
YCLOUD_API_KEY=tu_ycloud_api_key
YCLOUD_WHATSAPP_NUMBER=tu_numero_whatsapp

# Telegram (Emergencias / Handoff)
TELEGRAM_BOT_TOKEN=tu_telegram_token
TELEGRAM_CHAT_ID=tu_chat_id
```

### Iniciar el entorno de desarrollo local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en el navegador para acceder al CRM Dashboard.

### Scripts de Supabase (Migraciones y Edge Functions)
Las migraciones locales están configuradas en `supabase/migrations`. De igual manera, las funciones *Serverless* deben gestionarse utilizando el CLI de Supabase:
```bash
supabase link --project-ref tu-project-ref
supabase db push
supabase functions deploy agent-runner
supabase functions deploy calcular-precio
supabase functions deploy enviar-recordatorios
```

---

## 📂 Estructura del Proyecto

*   `app/`: Directorio principal de ruteo de Next.js (CRM Dashboard, API webhooks, Auth).
*   `components/`: Componentes universales de UI (shadcn y componentes principales).
*   `lib/`: Utilidades, controladores y adaptadores externos (`ycloud.js`, `telegram.js`, `agent.js`, `supabase.js`).
*   `supabase/`: DB Migrations (`supabase/migrations`) y Edge Functions (`supabase/functions`).

---

## 📝 Situación y Próximos Pasos (To-Do)

El sistema actualmente cuenta con su arquitectura fundacional desplegada (referencia: *Auditoría de Sistema v1*). Los próximos pasos se centrarán en:
- Reemplazar las variables de entorno (*placeholders*) en servicios externos.
- Adicionar dominios personalizados usando Vercel.
- End-to-End Testing (Pruebas E2E en flujos automatizados de WhatsApp y recordatorios automáticos).
- Integración final avanzada de tarifas zonales para pagos.

---
Elaborado para **Sistema IA Dra. Kelly**.
