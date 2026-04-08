# 02 — Integración WhatsApp (YCloud)

## Proveedor

YCloud — puente oficial con Meta WhatsApp Business API.

## Webhook de Entrada

**Endpoint:** `app/api/webhook/route.js` (Vercel)

**Responsabilidades del webhook:**
1. Verificar firma/token de YCloud.
2. Extraer: número del remitente, tipo de mensaje (texto/imagen/otro), contenido.
3. Pasar por filtro de 3 capas (ver abajo).
4. Si pasa filtro → invocar Edge Function `agent-runner` vía fetch.
5. Responder 200 a YCloud inmediatamente (no bloquear).

**Tipos de mensaje soportados:**
- `text` → contenido de texto al agente.
- `image` → comprobante de pago (guardar en Supabase Storage, vincular a cita pendiente).
- Otros tipos → ignorar o respuesta genérica.

## Filtro Pre-LLM (3 Capas)

| Capa | Lógica | Si no pasa |
|---|---|---|
| 1. Whitelist de teléfonos | Solo números en lista blanca (configurable desde CRM) | Ignorar mensaje silenciosamente |
| 2. Keywords | Detectar intención por palabras clave (saludo, cita, precio, cancelar, etc.) | Ruteo rápido sin IA |
| 3. Clasificador IA (opcional) | Mini-prompt a Claude para evaluar si merece agente completo | Respuesta genérica |

**Nota:** En fase inicial, la whitelist puede estar desactivada (todos pasan). Se activa cuando haya spam.

## Envío de Mensajes

**Archivo:** `lib/ycloud.js`

**Función principal:** `sendWhatsAppMessage(to, text)`

- Llama a la API de YCloud para enviar mensaje de texto.
- `to`: número en formato internacional (ej: `+593999123456`).
- Manejar errores y reintentar 1 vez si falla.

**Función de imagen:** `sendWhatsAppImage(to, imageUrl, caption)`

- Para enviar comprobantes o imágenes cuando sea necesario.

## Recepción de Imágenes (Comprobantes)

Cuando YCloud entrega un mensaje tipo `image`:
1. Descargar la imagen usando la URL temporal de YCloud.
2. Subir a Supabase Storage bucket `comprobantes/`.
3. Guardar referencia (storage path) en campo `payment_reference` de la cita pendiente.
4. Marcar cita como `confirmada`.
5. Notificar a Kelly por Telegram con imagen adjunta.

## Variables de Entorno

```
YCLOUD_API_KEY=
YCLOUD_WEBHOOK_SECRET=
YCLOUD_PHONE_NUMBER_ID=
```

## Pendiente Técnico

- Número de WhatsApp Business activo en YCloud — en proceso de configuración.
