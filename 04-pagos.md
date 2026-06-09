# 04 — Lógica de Pagos por Zona

## Catálogo de Servicios

| Servicio | Precio | ID |
|---|---|---|
| Evaluación InBody 270 | $20 | `inbody` |
| Consulta Virtual | $20 | `virtual` |
| Plan Quincenal | $25 | `quincenal` |
| Plan Mensual ⭐ | $35 | `mensual` |
| Plan Premium | $70 | `premium` |
| Plan Trimestral | $90 | `trimestral` |

**Regla:** Ninguna consulta se vende independiente — siempre dentro de un plan. Plan Mensual es el default. Si el paciente dice "mensual", corresponde a `mensual` ($35). El plan de $70 es `premium` y no debe llamarse "Mensual Premium".

## Lógica de Adelanto por Zona

| Zona | Adelanto | Fórmula |
|---|---|---|
| `sur` | No | $0 — cita confirmada directo |
| `norte` | 50% | `plan_precio * 0.5` |
| `virtual` | 50% | `plan_precio * 0.5` |
| `domicilio` | 50% | `40 * 0.5 = 20` (fijo, independiente del plan) |

### Ejemplos

| Zona | Plan Mensual ($35) | Plan Premium ($70) |
|---|---|---|
| Sur | $0 | $0 |
| Norte | $17.50 | $35 |
| Virtual | $17.50 | $35 |
| Domicilio | $20 | $20 |

## Herramienta `calcular_precio`

**Input:**
```json
{
  "servicio_id": "mensual",
  "zona": "norte"
}
```

**Output:**
```json
{
  "precio_base": 35,
  "ajuste_zona": 0,
  "precio_total": 35,
  "requiere_adelanto": true,
  "monto_adelanto": 17.5
}
```

**Lógica:**
1. Buscar precio base del servicio.
2. Si zona = `domicilio` → precio_total = $40 fijo (ignora plan).
3. Si zona = `sur` → requiere_adelanto = false, monto_adelanto = 0.
4. Si no → monto_adelanto = precio_total * 0.5.

> Nota: la zona `valle` (Los Chillos, a domicilio) ya **no se ofrece**. El motor todavía conserva su regla (`+$5`) como legado para citas históricas, pero Sofía no la propone ni la agenda.

## Métodos de Pago

| Método | V1 | V2 |
|---|---|---|
| `transfer` | ✅ Activo | ✅ |
| `cash` | ✅ (sur — pago en consulta) | ✅ |
| `payphone` | ❌ Schema listo | ✅ Implementar |

## Flujo de Transferencia (V1)

1. Sofía calcula adelanto con `calcular_precio`.
2. Si requiere adelanto → pregunta método de pago.
3. Si elige transferencia → Sofía envía datos bancarios.
4. Paciente envía imagen de comprobante por WhatsApp.
5. Sistema detecta imagen (webhook YCloud).
6. Imagen guardada en Supabase Storage → referencia en `payment_reference`.
7. Cita confirmada instantáneamente.
8. Kelly recibe notificación Telegram con comprobante adjunto.

**Principio:** El comprobante NO bloquea el agendamiento — lo respalda. Kelly audita a posteriori.

## Tabla `pagos`

| Campo | Tipo | Nota |
|---|---|---|
| id | uuid | PK |
| cita_id | uuid | FK → citas |
| monto | decimal | Monto del adelanto |
| metodo | text | `transfer`, `cash`, `payphone` |
| referencia | text | Storage path (V1) o transaction ID (V2) |
| comprobante_url | text | URL pública de Supabase Storage |
| verificado | boolean | Default false — Kelly marca manualmente |
| created_at | timestamptz | |

## Datos Bancarios

**Pendiente técnico:** Datos bancarios exactos por confirmar con Kelly. Campo configurable desde CRM (spec 07).

## Variables de Entorno (V2)

```
PAYPHONE_API_KEY=
PAYPHONE_WEBHOOK_SECRET=
```
