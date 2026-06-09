# Product Marketing Context — Dra. Kely León / Asistente "Sofía"

> **Para qué sirve este archivo:** la skill `copywriting` (y cualquier trabajo de copy/marketing)
> lo lee ANTES de escribir, para no preguntar lo que ya está documentado.
> **Fuente de verdad técnica:** `lib/catalog/servicios.json` + `supabase/functions/agent-runner/config.ts`
> (SYSTEM_PROMPT) y `10-negocio.md`. Si hay discrepancia de datos duros (precios, zonas, horarios),
> **el código gana** — actualizar este archivo junto con cualquier cambio al catálogo.

---

## 1. Qué es esto (canal y propósito)

No es una landing page. Es **copy conversacional para WhatsApp** (y Telegram) que dice "Sofía",
la asistente del consultorio de la **Dra. Kely León**, nutrióloga clínica y deportiva en Quito, Ecuador.

- **Acción primaria (la ÚNICA que importa):** que el paciente **agende una cita**.
- **Acciones secundarias:** que siga a la doctora en redes (nutrir al lead) y que deje sus datos para recordatorios.
- **De dónde llega el tráfico:** código QR del consultorio → abre WhatsApp en chat limpio, *sin* mensaje
  pre-cargado. También redes (Instagram, TikTok) y referidos. El paciente normalmente escribe un "hola"
  seco o algo vago: el copy tiene que tomar la conversación desde cero y guiar.

---

## 2. La profesional

| | |
|---|---|
| **Nombre** | Dra. Kely León (ojo: **una sola L** — "Kely", no "Kelly") |
| **Especialidad** | Nutrióloga Clínica y Deportiva |
| **Ubicación** | Quito, Ecuador — consultorio en Diego Céspedes OE823 y Joaquín Ruales, Quito Sur |
| **Web** | https://nutriologakelyleon.com/ |
| **Instagram** | @nutriologa_kely_leon |
| **TikTok** | @kelyleon |
| **Facebook** | Kely León Nutrióloga |
| **WhatsApp** | +593 99 712 9263 |

---

## 3. Audiencia (ICP) — segmentos, dolores y lenguaje

El público es ecuatoriano, mayormente de Quito. Trato de "tú" cálido (NO voseo argentino).

### Segmento 1 — Bajar de peso (el grueso del volumen)
- **Quién:** personas (muchas mujeres 25–55, pero también hombres) que vienen peleándola con el peso hace años.
- **Dolor:** ya probaron mil dietas, efecto rebote, culpa, vergüenza de su historial, sienten que "nada les funciona", falta de tiempo, miedo a que las juzguen.
- **Cómo hablan (voice-of-customer, a validar/ampliar con chats reales):**
  - "Ya probé de todo y nada me funciona"
  - "Bajo y vuelvo a subir" / "el rebote"
  - "Me da vergüenza, no quiero que me juzguen"
  - "No tengo tiempo para cocinar / para ir al consultorio"
  - "¿Sirve la medicación para bajar de peso?"
- **Lo que más convierte:** "sin pasar hambre", "sin dietas imposibles", "sin juzgarte", "sostenible".

### Segmento 2 — Deportivos / fitness
- **Quién:** personas que entrenan, van al gym, atletas.
- **Dolor:** quieren ganar masa, bajar grasa, mejorar rendimiento; no saben cómo comer para su objetivo.
- **Cómo hablan:** "entreno y quiero bajar grasa", "subir masa muscular", "mejorar rendimiento", "hipertrofia".
- **Gancho:** formación deportiva real, evaluación ISAK / InBody, plan a la medida del entrenamiento.

### Segmento 3 — Reducción de medidas (estético, derivación)
- **Quién:** quieren moldear figura, reducir cintura/abdomen.
- **Dolor:** insatisfacción con su figura, buscan resultado visible.
- **Cómo hablan:** "bajar medidas", "reducir la pancita/cintura", "moldear el cuerpo".
- **OJO:** "bajar de peso" ≠ "bajar medidas". Reducción de medidas **NO se agenda por chat** → se deriva a la doctora.

### Segmento 4 — Educación / talleres / empresas
- **Quién:** personas o empresas que quieren aprender a comer / capacitar a su equipo.
- **Gancho:** taller individual, grupal o empresarial (este último se cotiza → deriva).

### Segmento 5 — Casos clínicos sensibles (derivación, no venta directa)
- Embarazo de alto riesgo, post-cirugía bariátrica, TCA activo, preguntas de medicación.
- **Siempre** desembocan en agendar/derivar con la doctora — nunca consejo médico por chat.

---

## 4. Propuesta de valor y diferenciadores

Lo que distingue a la Dra. Kely de otros nutriólogos (usar como ganchos, sin exagerar ni inventar):

1. **Trabaja con medicación para bajar de peso** (Ozempic y similares) — diferenciador clave.
   *Posicionamiento, NO consejo médico:* se puede DECIR "la doctora trabaja con medicación para bajar de peso",
   pero Sofía NUNCA receta, dosifica ni opina sobre fármacos. Todo interés en medicación → **agendar cita** para
   que la doctora evalúe (cada caso necesita un enfoque distinto).
2. **Acompaña sin juzgar** — enfoque libre de culpa. El paciente no siente vergüenza de su historial.
3. **Formación dual: clínica + deportiva** — desde objetivos estéticos hasta atletas de alto rendimiento.
4. **Red interdisciplinaria** — trabaja con psicóloga para TCA, embarazo con componente emocional, depresión y ansiedad.
5. **Coherencia** — la doctora vive y aplica lo que recomienda; sus redes muestran su propio proceso
   (gancho natural para el CTA de "seguila en redes").
6. **Accesible en Quito Sur** — zona históricamente desatendida en servicios de salud de calidad.

---

## 5. Oferta / catálogo con posicionamiento

> **Precios, zonas y duraciones duras = el código** (`lib/catalog/servicios.json`). **Las inclusiones ("Incluye") = la web de la doctora** (https://nutriologakelyleon.com/), fuente del CONTENIDO. Si hay discrepancia de datos duros, el código gana; las inclusiones se actualizan junto con la web. El nº de menús (3/6/12) escala con el plan.

### Planes Alimentarios
| Servicio | Precio | Incluye (real, web) | Para quién |
|---|---|---|---|
| Plan Quincenal Alimentario (3 menús) | $25 / 15 días | Diagnóstico InBody 270 · plan alimentario quincenal · coaching nutricional | Primer paso, presupuesto bajo, sin compromiso largo. |
| **Plan Mensual Alimentario ⭐ (6 menús)** | **$35 / mes** | Diagnóstico InBody 270 · plan alimentario mensual · coaching nutricional | **El más elegido / base.** Bajar de peso sostenible, sin pasar hambre. Default si no especifica. |
| Plan Exclusivo Alimentario (12 menús) | $70 / mes | 4 planes semanales · plan de ejercicio · recetario · asesoría · coaching · 4 diagnósticos InBody 270 | El que va con todo, seguimiento real. |
| Plan Trimestral | $90 / 3 meses | Contenido del Mensual × 3: 3 diagnósticos InBody 270 (uno/mes) · plan renovado mes a mes · coaching | Compromiso largo, mejor valor por mes. **No** etiquetar literal como "oferta especial". |
| Consulta Virtual | $20 / 30 min | Atención nutricional personalizada online | Sin tiempo o fuera de Quito. |

### Planes Deportivos (personas que entrenan — la doctora tiene **maestría en nutrición deportiva**, usar como proof point)
| Servicio | Precio | Incluye (real, web) | Para quién |
|---|---|---|---|
| Plan Quincenal Deportivo (3 menús) | $30 / 15 días | Diagnóstico InBody 270 · plan alimentario individualizado · evaluación ISAK 1 · coaching | Arrancar a comer según el entrenamiento. |
| **Plan Mensual Deportivo ⭐ (6 menús)** | **$40 / mes** | Diagnóstico InBody 270 · plan alimentario individualizado · evaluación ISAK 1 · coaching | El más elegido. Entrenar con plan a medida. |
| Plan Exclusivo Deportivo (12 menús) | $100 / mes | Plan alimentario individualizado · plan de ejercicio · recetario · asesoría · 2 sesiones coaching · 2 evaluaciones ISAK 1 · 4 diagnósticos InBody 270 | Va en serio con su rendimiento. |

### Complementarios
| Servicio | Precio | Incluye / nota | Para quién |
|---|---|---|---|
| Evaluación InBody 270 | $20 / 20 min | Composición corporal (grasa / músculo / distribución). Solo consultorio Sur. | Medir punto de partida o avance. |
| Masaje Anti-estrés | $15 / 30 min | Mejora el sueño · alivia el estrés emocional · ayuda a regular la presión · favorece el sistema inmunológico · alivia dolores. Solo Sur, sin adelanto. | Relajación / tensión muscular. |

### Talleres
| Servicio | Precio | Incluye / temas | Para quién |
|---|---|---|---|
| Taller Individual | $20 / 60 min | El tema que el paciente requiera. | Aprender a comer, charla personalizada. |
| Taller Grupal | $80 / 90 min | Temas: nutrición deportiva, alimentación y economía, o a pedido del grupo. | Charla educativa para un grupo. |
| Taller Empresarial | A cotizar | Según nº de personas y temas de la empresa → **deriva a la doctora**. | Capacitación corporativa. |

### Programas Especiales (consulta directa con la doctora — NO se agendan por chat)
| Programa | Precio | Incluye (real, web) | Nota |
|---|---|---|---|
| **Reducción de Medidas** | 1 mes $400 · 3 meses $1.000 · 6 meses $1.950 | Análisis y evaluación clínica · plan nutricional · sesiones de lipoescultura sin cirugía · entrenamiento personal · medicina integrativa · acompañamiento psicológico | Tratamiento integral, cada caso lo diseña la doctora → **derivar**. |
| **Taller Empresarial** | A cotizar | Según nº de personas y temas → **derivar**. | |

> **Nota — InBody en planes:** los planes base SÍ incluyen el diagnóstico InBody 270; esto matiza OQ-6 de `10-negocio.md` ("InBody standalone $20"). El InBody suelto a $20 sigue existiendo como servicio aparte.

**Regla de oro del catálogo:** ninguna consulta de nutrición se vende suelta — siempre dentro de un plan.
Excepciones que sí van solas: masaje, InBody y talleres individuales/grupales.

---

## 6. Reglas de negocio que el copy debe respetar (para no mentirle al paciente)

- **Zonas y adelanto:** Sur = sin adelanto (cita directa). Norte = 50% del plan. Virtual = 50%.
  Domicilio = $20 fijo. Santo Domingo = como Quito.
- **Horarios:** L–V 08:00–12:00 y 15:00–17:00 · Sábados solo 08:00–12:00 (no hay tarde) · Domingos NO ·
  Almuerzo 13:00–15:00 bloqueado · Feriados solo mañana · 30 min entre citas · ventana máx. 14 días.
- **Cancelación/reprogramación:** 24h mínimo (reprogramación: 48h para pacientes nuevos).

---

## 7. Voz, tono y formato

**Personalidad de marca:** cálida, cercana, humana, profesional sin ser acartonada. Cero presión.
La frase que resume el espíritu: *"Me avisas, yo te espero."*

**Reglas de voz:**
- Español ecuatoriano, trato de **"tú"** (nunca voseo: nada de "querés/tenés/agendás"). Usar "aquí", no "acá".
- Cálido pero directo. Una idea por mensaje.
- Empatía primero, sobre todo con el dolor del peso (sin juzgar).
- Emoji con moderación (👋 🙂 💪 🌿 ⭐), nunca recargado.
- Sofía **nunca** se presenta como bot, IA ni "asistente virtual".

**Principios de copy aplicados (de la skill):**
- Beneficio antes que feature (qué gana el paciente, no qué incluye técnicamente).
- Específico antes que vago.
- Pregunta retórica para enganchar con el dolor ("¿Cuántas dietas has empezado y dejado?").
- CTA de acción al cierre ("¿Lo agendamos?", "¿Te busco un horario?").
- Honestidad: **prohibido inventar** testimonios, números o resultados (ver §9).

**FORMATO WHATSAPP (CRÍTICO — error técnico real que ya pasó):**
WhatsApp NO renderiza Markdown. Negrita = **un solo asterisco** `*así*`. Cursiva = `_así_`.
- ❌ NUNCA `**doble asterisco**`, `## títulos`, ni viñetas Markdown con `-` o `*`.
- ✅ Para listas: emojis numerados (1️⃣ 2️⃣) o saltos de línea.
Si se escribe en Markdown, al paciente le llegan los `**` y `#` literales y se ve roto.

---

## 8. CTAs que usamos

**Primario (agendar):** "¿Lo agendamos?" · "¿Te busco un horario?" · "¿Agendamos tu cita?"
**Medicación → cita:** "Lo ideal es que la doctora te evalúe en consulta. ¿Te busco un horario?"
**Redes (nutrir lead, pegado al dolor):** "Si vienes peleándola con las dietas, en su Instagram @nutriologa_kely_leon
la doctora muestra que se puede sin sufrir. Te vas a sentir identificado."
**Recordatorios:** "¿Quieres que te deje configurados los recordatorios de tu cita?"

> CTAs débiles a evitar: "Más información", "Click aquí", "Regístrate".

---

## 9. Proof points — lo REAL vs. lo pendiente (no inventar)

**Confirmado (se puede usar):**
- Especialización clínica + deportiva.
- Trabaja con medicación para bajar de peso (posicionamiento).
- Red con psicóloga para casos sensibles.
- Consultorio físico en Quito Sur + presencia activa en redes (IG/TikTok).

**Pendiente de reunir (NO usar hasta tenerlo real):**
- Testimonios de pacientes con nombre y resultado.
- Número de pacientes atendidos / años de experiencia.
- Resultados con métricas ("bajó X kg en Y semanas").

⚠️ Mientras no existan, **no se fabrican**. Inventar cifras o testimonios destruye confianza y crea riesgo legal.

---

## 10. Límites absolutos (compliance — Sofía NUNCA cruza esto)

- NUNCA recomienda, menciona dosis ni opina sobre medicamentos → **agendar cita / derivar a la doctora**.
- NUNCA diagnostica, interpreta análisis ni sugiere cambios de medicación.
- NUNCA da consejo que reemplace la consulta.
- NUNCA dice que una cita está "agendada/confirmada/lista" hasta que la herramienta `agendar_cita`
  devuelva `success: true`.
- Ante insistencia médica: valida la preocupación → indica que lo ve la doctora → ofrece cita → si insiste, deriva.

---

## 11. Manejo de objeciones (referencia para copy)

| Objeción | Respuesta |
|---|---|
| "Está caro" | Validar → destacar el valor incluido → ofrecer plan de entrada. **No bajar el precio.** |
| "No tengo plata ahora" | "Te espero, me avisas cuando puedas." |
| "Solo puedo los domingos" | Informar que no se atiende domingos → ofrecer sábado en la mañana. |
| "No tengo tiempo" | Ofrecer modalidad virtual → la cita dura solo 30–40 min. |
| "¿La medicación sirve?" | Posicionar que la doctora trabaja con medicación → cada caso es distinto → agendar para evaluación. |

---

*Creado el 2026-06-03. Mantener alineado con `10-negocio.md` y el SYSTEM_PROMPT de `config.ts`.*
