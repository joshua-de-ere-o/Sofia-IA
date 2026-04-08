# 07 — CRM (Dashboard de Kelly)

## Acceso

- URL: `/dashboard` (protegida por auth).
- Solo la Dra. Kely tiene acceso.
- Auth: Supabase Auth (ver spec 08).

## Diseño Visual

| Propiedad | Valor |
|---|---|
| Paleta | Blanco `#FFFFFF`, Teal suave `#F0FDFA`, Verde `#22C55E`, Grises elegantes |
| Tipografía | Plus Jakarta Sans |
| Componentes | shadcn/ui |
| Diseño | Mobile-first (Kelly accede desde el teléfono) |

## Pestañas

### 1. Mensajes

- Lista de conversaciones activas con pacientes.
- Chat en tiempo real usando Supabase Realtime.
- Indicador de handoff activo (badge rojo).
- Botón para retomar conversación manualmente.
- Muestra último mensaje y timestamp.

### 2. Citas

- Vista de agenda: lista cronológica de citas del día / semana.
- Filtros: por estado (confirmada, pendiente_pago, completada, cancelada, no_show), por fecha.
- Cada cita muestra: paciente, servicio, hora, estado, modalidad, zona.
- Acción: marcar como completada, cancelar, ver comprobante de pago.
- Verificación de comprobante: botón para marcar pago como verificado.

### 3. Reportes

- KPIs básicos V1:
  - Citas de hoy / semana / mes.
  - Leads recibidos.
  - Tasa de agendamiento.
  - No-shows.
  - Casos escalados.
- Datos desde tablas de Supabase con queries directos.

### 4. Configuración

- Datos bancarios para transferencias (editable).
- Horarios de atención (editable con validación).
- Whitelist de teléfonos (activar/desactivar, agregar/quitar números).
- Feriados del año (agregar/quitar).
- Estado del sistema (conexión YCloud, Telegram, Edge Functions).

## Tablas Supabase Adicionales

### `configuracion`

| Campo | Tipo | Nota |
|---|---|---|
| id | int | PK, siempre 1 (singleton) |
| datos_bancarios | jsonb | {banco, tipo_cuenta, numero, titular, cedula} |
| whitelist_activa | boolean | Default false |
| whitelist_numeros | text[] | Array de números |
| updated_at | timestamptz | |

## Realtime

- Suscripción a tabla `conversaciones` para actualizar lista de chats.
- Suscripción a tabla `citas` para actualizar agenda en vivo.
- No polling — solo Supabase Realtime channels.
