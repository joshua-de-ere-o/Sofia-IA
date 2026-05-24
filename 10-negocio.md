# 10 — Información del Negocio

> **Fuente técnica autoritativa:** `lib/servicios.js` (Node/CRM) y `supabase/functions/agent-runner/config.ts` (Deno/agente).
> Este documento es de referencia humana — útil para onboarding, reuniones y revisión con la doctora.
> Si hay discrepancia entre este MD y el código, **el código gana**. Actualizar este MD junto con cualquier cambio al catálogo.

---

## Identidad

| | |
|---|---|
| **Profesional** | Dra. Kely León — Nutrióloga Clínica y Deportiva |
| **Ubicación** | Quito, Ecuador |
| **Web** | https://nutriologakelyleon.com/ |
| **Dirección consultorio** | Diego Céspedes OE823 y Joaquín Ruales, Quito Sur |
| **WhatsApp / Teléfono** | +593 99 712 9263 |
| **Instagram** | [@nutriologa_kely_leon](https://instagram.com/nutriologa_kely_leon) |
| **TikTok** | [@kelyleon](https://tiktok.com/@kelyleon) |
| **Facebook** | Kely León Nutrióloga |

### Horarios de atención

| Día | Mañana | Tarde |
|---|---|---|
| Lunes a Viernes | 08:00 – 12:00 | 15:00 – 17:00 |
| Sábados | 08:00 – 12:00 | — |
| Almuerzo | — | 13:00 – 15:00 (bloqueado) |

---

## Catálogo de Servicios

### Planes Alimentarios

| ID | Nombre | Precio | Duración | Modalidades | Zonas | Adelanto |
|---|---|---|---|---|---|---|
| `alimentario_quincenal` | Plan Alimentario Quincenal | $25 | 60 min | Presencial | Sur, Norte | 50% |
| `alimentario_mensual` | Plan Alimentario Mensual | $35 | 60 min | Presencial | Sur, Norte | 50% |
| `alimentario_exclusivo` | Plan Alimentario Exclusivo | $70 | 60 min | Presencial, Virtual | Sur, Norte, Domicilio, Virtual | 50% |
| `trimestral` | Plan Trimestral | $90 | 60 min | Presencial | Sur, Norte | 50% |
| `virtual` | Consulta Virtual | $20 | 45 min | Virtual | Virtual | 50% |

### Planes Deportivos

| ID | Nombre | Precio | Duración | Modalidades | Zonas | Adelanto |
|---|---|---|---|---|---|---|
| `deportivo_quincenal` | Plan Deportivo Quincenal | $30 | 60 min | Presencial† | Sur, Norte† | 50%† |
| `deportivo_mensual` | Plan Deportivo Mensual | $40 | 60 min | Presencial† | Sur, Norte† | 50%† |
| `deportivo_exclusivo` | Plan Deportivo Exclusivo | $100 | 60 min | Presencial, Virtual† | Sur, Norte, Domicilio, Virtual† | 50%† |

*† Pendientes de confirmar: ¿modalidad virtual? ¿zonas adicionales? ¿política de adelanto? (OQ-2, OQ-7)*

### Complementarios

| ID | Nombre | Precio | Duración | Modalidades | Zonas | Adelanto |
|---|---|---|---|---|---|---|
| `inbody` | InBody (composición corporal) | $20 | 20 min | Presencial | Sur | Sin adelanto |
| `masaje` | Masaje Terapéutico | $15 | 30 min | Presencial | Sur | Sin adelanto |

### Talleres

| ID | Nombre | Precio | Duración | Agendable | Nota |
|---|---|---|---|---|---|
| `taller_individual` | Taller Individual | $20 | 60 min | Sí‡ | Presencial, zona Sur‡ |
| `taller_grupal` | Taller Grupal | $80 | 90 min | Sí‡ | Presencial, zona Sur‡ |
| `taller_empresarial` | Taller Empresarial | A cotizar | Variable | **No** — deriva a Kely | Requiere cotización personalizada |

*‡ Pendiente confirmar zonas y si hay modalidad virtual (OQ-1)*

### Servicios derivados (NO se agendan automáticamente)

Estos servicios no se pueden agendar a través de Sofía. Cuando un paciente los solicita, Sofía deriva directamente con la Dra. Kely.

**Reducción de Medidas** (`reduccion_medidas`)

Programa personalizado de reducción de medidas. Tres niveles de inversión:

| Nivel | Precio aproximado | Descripción |
|---|---|---|
| Básico | $400 | — |
| Intermedio | $1.000 | — |
| Avanzado | $1.950 | — |

*El detalle exacto de qué incluye cada nivel está pendiente de confirmación (OQ-4).*

**Taller Empresarial** (`taller_empresarial`)

Talleres de nutrición para empresas y grupos corporativos. Cotización según cantidad de participantes y temática. La Dra. Kely coordina directamente.

---

## Zonas y Política de Adelanto

| Zona | Adelanto requerido |
|---|---|
| Sur | Sin adelanto |
| Norte | 50% del plan |
| Virtual | 50% del plan |
| Valle (Los Chillos) | 50% del plan + $5 de recargo |
| Domicilio | $20 fijo |

*Nota: la columna "Adelanto" de los servicios indica si el servicio requiere adelanto. El monto y condición por zona se aplica sobre esa base.*

---

## Mapeo Objetivo → Plan

Referencia para entender qué recomienda Sofía según lo que expresa el paciente. Esto es documentación humana — la lógica real está en el `SYSTEM_PROMPT` de `config.ts`.

| Objetivo del paciente | Familia recomendada | Ejemplo de servicio |
|---|---|---|
| Bajar de peso, alimentación saludable, nutrición | Alimentarios | `alimentario_mensual` |
| Composición corporal, definición | Alimentarios + InBody | `alimentario_exclusivo` + `inbody` |
| Gym, subir masa muscular, rendimiento deportivo, hipertrofia | Deportivos | `deportivo_mensual` |
| Tensión muscular, estrés, relajación | Masaje | `masaje` |
| Medir grasa / músculo antes de empezar | Complementario | `inbody` |
| Charla grupal educativa | Talleres | `taller_grupal` |
| Reducir cintura, moldear el cuerpo, reducción de medidas | Derivación a Kely | `reduccion_medidas` |
| Capacitación para empresa o grupo corporativo | Derivación a Kely | `taller_empresarial` |
| Embarazo de alto riesgo, post-cirugía bariátrica, TCA activo | Derivación a Kely | `caso_clinico_complejo` |
| Medicación para bajar de peso (Ozempic, etc.) | Derivación a Kely | `medicacion` |

---

## Diferenciadores

- **Medicación para bajar de peso:** la Dra. Kely puede orientar sobre medicación (Ozempic y similares) — diferenciador clave respecto a otros nutriólogos.
- **Formación dual:** nutriología clínica y deportiva. Atiende desde pacientes con objetivos estéticos hasta atletas de alto rendimiento.
- **Sin juzgar:** enfoque libre de culpa. El paciente no siente vergüenza de su historial alimentario.
- **Red interdisciplinaria:** trabaja con psicóloga para casos de TCA, embarazo con componente emocional, depresión y ansiedad.
- **Coherencia:** la doctora aplica lo que recomienda — sus redes muestran su propio proceso.
- **Especialización en Quito Sur:** consultorio accesible para una zona históricamente desatendida en servicios de salud de calidad.

---

## Reglas de Derivación a Kely

Cuándo Sofía escala en lugar de agendar. Referencia humana — el código está en `DERIVACION_TEMPLATES` en `config.ts`.

| Motivo (`motivo` en el código) | Cuándo aplica |
|---|---|
| `reduccion_medidas` | El paciente pregunta por reducción de medidas, moldear el cuerpo o tratamientos de reducción |
| `taller_empresarial` | Solicitan taller o charla para empresa / grupo corporativo |
| `caso_clinico_complejo` | Embarazo de alto riesgo, post-cirugía bariátrica, TCA activo, condición que requiere evaluación médica previa |
| `medicacion` | Preguntas sobre medicación (Ozempic, pastillas, inyecciones para bajar de peso) |
| `pago_disputa` | El paciente reclama un pago, dice haber pagado y no ver confirmación, o hay un malentendido de cobro |
| `urgencia` | Cualquier señal de urgencia médica o situación que requiere atención inmediata |
| `default` | Cualquier otro caso fuera del flujo estándar |

---

## Open Questions — Reunión 2026-05-25

Pendientes para confirmar con la Dra. Kely el lunes. Los valores actuales en el catálogo son editables en 1 línea.

| # | Pregunta | Estado base actual |
|---|---|---|
| OQ-1 | **Talleres** — ¿`taller_individual` y `taller_grupal` son solo presencial Sur, o también Norte? ¿Virtual disponible para taller individual? | Solo presencial, zona Sur |
| OQ-2 | **Deportivos — virtual** — ¿`deportivo_quincenal/mensual/exclusivo` permiten modalidad virtual? | Solo presencial |
| OQ-3 | **Masaje — combo** — ¿Hay descuento si se contrata masaje junto con plan mensual alimentario o deportivo? | Sin descuento, `permite_combo: false` |
| OQ-4 | **Reducción de medidas** — ¿Qué información sobre los 3 niveles ($400/$1.000/$1.950) debe conocer Sofía para contextualizar la derivación? | Solo precios y nombres, sin detalle de contenido |
| OQ-5 | **Eventos** — ¿Los eventos mencionados en la web entran al sistema como servicio agendable, derivación a Kely, o quedan fuera del sistema? | Out-of-scope hasta confirmar |
| OQ-6 | **InBody** — ¿Sigue siendo standalone a $20, o se incluye gratis con algún plan deportivo? | Standalone $20 |
| OQ-7 | **Adelanto para deportivos** — ¿Misma política que alimentarios (50%) o diferente? | `requiere_adelanto: true`, igual que alimentarios |

---

*Documento creado el 2026-05-24. Actualizar junto con cualquier cambio al catálogo.*
