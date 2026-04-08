# 05 — Protocolo de Handoff

## Canal

Telegram Bot API → chat directo con Dra. Kely.

## Triggers de Escalamiento

Sofía escala inmediatamente cuando detecta:

- Mención de medicamentos (keywords: medicamento, pastilla, medicación, inyección, fármaco, pastillas para bajar de peso).
- Dudas clínicas o preguntas que impliquen diagnóstico.
- Temas médicos sensibles.
- Paciente molesto o con reclamo.
- Pago no reconocido o disputa de cobro.
- Solicitudes especiales fuera del flujo estándar.
- Urgencias de cualquier tipo.
- Convenios o alianzas comerciales.
- Contacto de medios o prensa.

## Flujo de Handoff

1. Sofía detecta trigger.
2. Sofía **pausa el agente solo en esa conversación** — el sistema sigue activo para todos los demás chats.
3. Marca conversación con `handoff_activo = true` en tabla `conversaciones`.
4. Envía notificación a Kelly por Telegram con:
   - Nombre del paciente
   - Motivo del escalamiento
   - Resumen del historial de conversación
   - Nivel de urgencia (alto/medio/bajo)
   - Botón inline: **"Abrir WhatsApp"** (deep link al chat del paciente)
   - Botón inline: **"Terminé la atención"**
5. Sofía informa al paciente: "Te comunico con la Dra. Kely. En breve te contacta."
6. Kelly atiende al paciente directo en WhatsApp.
7. Agente retoma por cualquiera de estas vías:
   - **Botón "Terminé"** en Telegram (preferido).
   - **Comando `/listo`** en Telegram (interceptado server-side).
   - **Timeout de 30 minutos** de inactividad en esa conversación.

## Recordatorio a Kelly

- Si Kelly no responde en **10 minutos** → alerta Telegram: "Tienes un paciente esperando: [nombre] — [motivo]".
- Si **30 minutos** sin actividad → agente retoma automáticamente y escribe al paciente: "La Dra. Kely revisará tu caso pronto. ¿Hay algo más en lo que pueda ayudarte?"

## Herramienta `derivar_a_kelly`

**Input:**
```json
{
  "paciente_id": "uuid",
  "motivo": "Pregunta sobre medicación para bajar de peso",
  "nivel_urgencia": "medio",
  "historial_resumido": "Paciente preguntó por planes, luego mencionó que toma Ozempic..."
}
```

**Output:**
```json
{
  "notificacion_enviada": true,
  "handoff_id": "uuid"
}
```

**Lógica:**
1. Insertar registro en tabla `handoffs` (paciente_id, motivo, urgencia, timestamp).
2. Actualizar `conversaciones.handoff_activo = true`.
3. Enviar mensaje Telegram vía `lib/telegram.js`.
4. Retornar confirmación.

## Tabla `handoffs`

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | PK |
| conversacion_id | uuid | FK → conversaciones |
| paciente_id | uuid | FK → pacientes |
| motivo | text | |
| nivel_urgencia | text | `alto`, `medio`, `bajo` |
| estado | text | `activo`, `resuelto`, `timeout` |
| created_at | timestamptz | |
| resolved_at | timestamptz | Nullable |

## Reporte de No-Show

Cuando una cita queda en estado `no_show`, Sofía envía reporte automático a Kelly por Telegram:
- Nombre del paciente
- Fecha y hora de la cita
- Servicio/plan contratado

## Variables de Entorno

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=        # por confirmar con Kelly
```
