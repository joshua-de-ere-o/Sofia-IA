# 03 — Agenda y Reglas de Citas

## Horarios de Atención

| Bloque | Horario | Estado |
|---|---|---|
| Lunes–Viernes mañana | 08:00–12:00 | Agendable |
| Almuerzo | 13:00–15:00 | **BLOQUEADO siempre** |
| Lunes–Viernes tarde | 15:00–17:00 | Agendable |
| Sábados | 08:00–12:00 | Agendable |
| Domingos | — | No se atiende |
| Feriados | 08:00–12:00 | Agendable (calendario oficial Ecuador) |

## Reglas de Agendamiento

| Parámetro | Valor |
|---|---|
| Separación entre citas | 30 minutos |
| Anticipación mínima | 1 día (mismo día permitido si hay slot disponible) |
| Ventana máxima | 14 días calendario hacia adelante |
| Duración consulta inicial | 35–40 min |
| Duración consulta seguimiento | 30 min |

## Generación de Slots

La herramienta `consultar_disponibilidad` genera slots así:

1. Rango: desde hoy hasta hoy + 14 días.
2. Para cada día en el rango:
   - Si es domingo → saltar.
   - Si es feriado → slots solo de 08:00 a 12:00.
   - Si es sábado → slots de 08:00 a 12:00.
   - Si es lunes–viernes → slots de 08:00 a 12:00 y 15:00 a 17:00.
3. Slots cada 30 minutos dentro de cada franja.
4. Excluir slots ya ocupados o bloqueados en tabla `citas`.
5. Si anticipación mínima = 1 día → excluir slots de hoy EXCEPTO si hay disponibilidad explícita.

## Feriados Ecuador

Usar calendario oficial del Gobierno Ecuatoriano. Almacenar en tabla `feriados` con campos:
- `fecha` (date)
- `nombre` (text)
- `año` (int)

Cargar feriados del año actual al iniciar. Actualizar anualmente.

## Tabla `citas`

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | PK |
| paciente_id | uuid | FK → pacientes |
| servicio | text | Nombre del servicio/plan |
| fecha | date | |
| hora | time | |
| duracion_min | int | 30 o 40 |
| estado | text | `bloqueado`, `pendiente_pago`, `confirmada`, `completada`, `cancelada`, `no_show` |
| modalidad | text | `presencial`, `virtual` |
| zona | text | `sur`, `norte`, `virtual`, `valle`, `domicilio` |
| payment_method | text | `transfer`, `cash`, `payphone` (nullable) |
| payment_reference | text | ID de imagen o transacción (nullable) |
| external_calendar_id | text | Nullable — preparado para Google Calendar V2 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## Estados del Slot

```
bloqueado        → paciente eligió horario, esperando pago (si aplica)
pendiente_pago   → zona requiere adelanto, esperando comprobante
confirmada       → pago recibido o zona sin adelanto
completada       → cita atendida
cancelada        → cancelada por paciente o doctora
no_show          → paciente no se presentó
```

## Cancelación y Reprogramación

| Acción | Pacientes habituales | Pacientes nuevos |
|---|---|---|
| Cancelación | 24h de anticipación | 24h de anticipación |
| Reprogramación | 24h de anticipación | 48h de anticipación |

Al cancelar: liberar slot (estado → `cancelada`).
Al reprogramar: cancelar cita actual + crear nueva.

No-show: Sofía envía reporte automático a Kelly por Telegram con nombre, fecha y hora.
