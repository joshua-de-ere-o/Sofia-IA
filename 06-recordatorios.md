# 06 — Recordatorios Automáticos

## Secuencia

| Tipo | Cuándo | Canal | Destinatario |
|---|---|---|---|
| Recordatorio 1 | 24 horas antes de la cita | WhatsApp | Paciente |
| Recordatorio 2 | 2 horas antes de la cita | WhatsApp | Paciente |
| Reactivación | 8 días sin actividad | WhatsApp | Paciente |
| No-show | Tras ausencia sin aviso | Telegram | Dra. Kely |

## Implementación

### Cron Job

Un cron (Supabase Edge Function con pg_cron o Vercel Cron) ejecuta cada hora:

1. Consulta citas confirmadas cuya fecha/hora esté a 24h o 2h.
2. Filtra las que ya recibieron ese recordatorio (campo `reminder_24h_sent`, `reminder_2h_sent` en tabla `citas`).
3. Genera mensajes usando **Batch API de Anthropic** (50% descuento) para personalizar el texto.
4. Envía vía YCloud.
5. Marca recordatorio como enviado.

### Reactivación (8 días)

1. Consulta tabla `conversaciones` donde `ultima_actividad < now() - 8 días` y `reactivacion_enviada = false`.
2. Envía mensaje de Sofía invitando a retomar — tono cálido, sin presión.
3. Marca `reactivacion_enviada = true`.

### No-Show

1. Después de la hora de la cita + 15 min de gracia, si la cita sigue en estado `confirmada` → marcar como `no_show`.
2. Enviar reporte a Kelly por Telegram.

## Tono de Mensajes

- Recordatorio 24h: informativo y amigable. Incluir fecha, hora y ubicación/modalidad.
- Recordatorio 2h: breve y directo. "¡Nos vemos en 2 horas!"
- Reactivación: cálido y sin presión. "Hola [nombre], ¿cómo has estado? Si quieres retomar, aquí estoy."

## Campos Adicionales en Tabla `citas`

| Campo | Tipo | Default |
|---|---|---|
| reminder_24h_sent | boolean | false |
| reminder_2h_sent | boolean | false |

## Campos Adicionales en Tabla `conversaciones`

| Campo | Tipo | Default |
|---|---|---|
| ultima_actividad | timestamptz | now() |
| reactivacion_enviada | boolean | false |

## Batch API

Usar Anthropic Batch API para generar textos de recordatorios en lote:
- Agrupar todos los recordatorios de la hora.
- Enviar como batch → recibir respuestas.
- Distribuir vía YCloud.
- Ahorro estimado: 50% vs llamadas individuales.
