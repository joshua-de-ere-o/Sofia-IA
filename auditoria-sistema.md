# Auditoría Completa del Sistema — Dra. Kely León
## Fecha: 7 de Abril de 2026 (Actualización corregida)
## Proyecto Supabase: `azrftqhescniopmleolm` (Sistema Dra. Kely) — Estado: ACTIVE_HEALTHY

---

## 1. ESTADO POR FASE

### Fase 0 — Proyecto (00-proyecto.md)
| Aspecto | Estado |
|---|---|
| Inicialización Next.js 14 | ✅ Completo |
| Estructura de directorios | ✅ Completo |
| Configuración Supabase | ✅ Completo |
| Variables de entorno | ⚠️ Parcial — solo URL y anon key reales; todo lo demás son PLACEHOLDERs |
| Archivos de spec (00–08) | ✅ Los 9 specs están presentes en la raíz |

**Notas:** El proyecto fue inicializado correctamente. Los specs se mantienen en la raíz.

---

### Fase 1 — Agente IA (01-agente.md)
| Aspecto | Estado |
|---|---|
| System Prompt de Sofía | ✅ Completo y detallado |
| Tool definitions (4 herramientas) | ✅ Completo |
| Catálogo de servicios | ✅ Completo |
| Model Adapter (multi-proveedor) | ✅ Completo |
| Agent loop en Edge Function | ✅ Estructura completa |
| Prompt caching (Anthropic) | ✅ Implementado |
| Condensación de historial | ✅ Implementado |
| Despliegue en Supabase | ✅ **DESPLEGADO** |

**Qué funciona:** La lógica del agente y el adaptador están operativos. La Edge Function `agent-runner` ya está desplegada y activa en Supabase.
**Mejora realizada:** Se sincronizaron los enums de `servicio_id` en `config.ts`, corrigiendo la discrepancia previa.

---

### Fase 2 — WhatsApp / YCloud (02-whatsapp.md)
| Aspecto | Estado |
|---|---|
| `lib/ycloud.js` — envío de texto/imágenes | ✅ Completo |
| `app/api/webhook/route.js` | ✅ Completo |
| Verificación de firma de YCloud | ❌ No implementada (TODO en código) |
| Integración con pre-filter | ✅ Completo |
| Fire & Forget al agent-runner | ✅ Implementado |

---

### Fase 3 — Agenda (03-agenda.md)
| Aspecto | Estado |
|---|---|
| `tools.ts` — consultar_disponibilidad | ✅ Completo |
| `tools.ts` — agendar_cita | ✅ Completo |
| `calcular-precio` Edge Function | ✅ Desplegada y activa |
| Lógica de horarios y slots | ✅ Implementada |
| Cancelación y reprogramación (F7) | ❌ No implementada |

---

### Fase 4 — Pagos (04-pagos.md)
| Aspecto | Estado |
|---|---|
| `lib/payments.js` | ✅ Completo |
| Upload a Supabase Storage | ✅ Funcionando |
| Notificación a Kelly por Telegram | ✅ Implementado |
| Actualización de estado cita | ✅ Implementado |

**Qué falta:** El `monto` del pago se guarda como `0` en la tabla `pagos`. Se requiere auditoría visual por la doctora en esta versión.

---

### Fase 5 — Handoff (05-handoff.md)
| Aspecto | Estado |
|---|---|
| `tools.ts` — derivar_a_kelly | ✅ Completo |
| `lib/telegram.js` — envío de mensajes | ✅ Completo |
| Botón inline / Resolución IA | ✅ Implementado |
| Cron timeout 30 min | ✅ Implementado |

**Nota:** Se mantiene el comportamiento donde si el paciente no está registrado (`paciente_id` es null), el log en la tabla `handoffs` se omite, aunque la notificación a Telegram sí se envía.

---

### Fase 6 — Recordatorios (06-recordatorios.md)
| Aspecto | Estado |
|---|---|
| `enviar-recordatorios` Edge Function | ✅ Desplegada y activa |
| Batch API de Anthropic | ✅ Implementado |
| Cron job (`pg_cron`) | ✅ Configurado y activo |

---

### Fase 7 — CRM Dashboard (07-crm.md)
| Aspecto | Estado |
|---|---|
| Pestañas Mensajes/Citas/Reportes | ✅ Operativas |
| Configuración IA/Whitelist | ✅ Funcionando (Tablas actualizadas) |
| Dark mode / Realtime | ✅ Implementado |

**Mejora realizada:** Las tablas `configuracion` y `conversaciones` ya tienen todas las columnas necesarias para que el dashboard sea funcional.

---

### Fase 8 — Autenticación (08-auth.md)
| Aspecto | Estado |
|---|---|
| Supabase Auth + PIN 4 dígitos | ✅ Completo |
| RLS Policies | ✅ **CONFIGURADAS** |

**Mejora realizada:** Se aplicó la migración `enable_app_rls` que crea políticas de SELECT, INSERT y UPDATE para usuarios autenticados en todas las tablas críticas.

---

## 2. ARCHIVOS CREADOS
*(Sin cambios significativos desde la auditoría anterior, excepto la aplicación de migraciones)*

---

## 3. VARIABLES DE ENTORNO
*Se mantienen con PLACEHOLDERs para servicios externos (Telegram, YCloud, IA Keys).*

---

## 4. BASE DE DATOS (Actualizada)

### Tablas Actualizadas (Producción)
| Tabla | Corrección Realizada |
|---|---|
| `conversaciones` | ✅ Se agregaron `mensajes_raw` y `telefono_contacto` |
| `configuracion` | ✅ Se agregaron `ai_provider`, `ai_api_key`, `ycloud_daily_messages`, `ycloud_last_reset` |

### RLS (Row Level Security) - ACTUALIZADO
| Tabla | RLS Habilitado | Policies Definidas |
|---|---|---|
| pacientes | ✅ | ✅ `policy_pacientes_select/insert/update` |
| citas | ✅ | ✅ `policy_citas_select/insert/update` |
| conversaciones | ✅ | ✅ `policy_conversaciones_select/insert/update` |
| pagos | ✅ | ✅ `policy_pagos_select/insert/update` |
| handoffs | ✅ | ✅ `policy_handoffs_select/insert/update` |
| configuracion | ✅ | ✅ `policy_configuracion_select/insert/update` |
| feriados | ✅ | ✅ `policy_feriados_select/insert/update` |
| user_settings | ✅ | ✅ policies por usuario (auth.uid()) |

### Edge Functions (Actualizado)
| Función | Estado |
|---|---|
| `calcular-precio` | ✅ ACTIVE |
| `enviar-recordatorios` | ✅ ACTIVE |
| `agent-runner` | ✅ **ACTIVE** |

---

## 5. PROBLEMAS CONOCIDOS (Actualizado)

### 🔴 Críticos
1. **API Keys con PLACEHOLDER:** Sigue siendo el único bloqueante para funcionamiento real con WhatsApp/Telegram/LLMs.
2. **`SUPABASE_SERVICE_ROLE_KEY` es PLACEHOLDER:** Bloquea operaciones administrativas desde el backend.

### 🟡 Importantes
3. **Validación de firma YCloud:** Pendiente para seguridad en producción.
4. **Monto de pago $0:** Pendiente automatizar cálculo de monto en `payments.js`.
5. **Seguridad de cookie PIN:** Pendiente configurar `httpOnly`, `secure` y `maxAge`.

---

## 6. LO QUE FALTA PARA PRODUCCIÓN
1. [ ] Reemplazar todos los PLACEHOLDERs por claves reales.
2. [ ] Configurar dominio en Vercel.
3. [ ] Implementar flujo de Cancelación/Reprogramación (F7).
4. [ ] Pruebas E2E con número real de WhatsApp.
5. [ ] Mejorar seguridad de la cookie del PIN.

---

## 7. RECOMENDACIONES
- Se recomienda proceder con la configuración de claves reales para iniciar la fase de testing Beta.
- Implementar la lógica de cálculo de montos en `lib/payments.js` para evitar discrepancias en los reportes financieros.
- Añadir paginación al dashboard para manejar volúmenes altos de mensajes y citas.
