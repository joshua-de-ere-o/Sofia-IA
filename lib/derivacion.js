/**
 * lib/derivacion.js
 *
 * Pure derivation logic extracted from executeDerivarAKelly (tools.ts) for testability.
 * tools.ts uses this same DERIVACION_TEMPLATES object (via its own copy — Deno can't import lib/).
 *
 * SYNC: the DERIVACION_TEMPLATES keys must match the enum in the derivar_a_kelly tool schema in config.ts.
 */

export const DERIVACION_TEMPLATES = {
  reduccion_medidas:
    'Te derivo con la Dra. Kely para evaluar tu caso de reducción de medidas. Ella se pondrá en contacto contigo a la brevedad.',
  taller_empresarial:
    'Los talleres para empresas requieren una cotización personalizada según el número de participantes. La Dra. Kely te contactará para coordinar los detalles.',
  caso_clinico_complejo:
    'Tu caso requiere atención directa de la doctora. La Dra. Kely se comunicará contigo en breve para orientarte mejor.',
  medicacion:
    'Las consultas sobre medicación las maneja directamente la Dra. Kely. Te contactará a la brevedad para ayudarte.',
  pago_disputa:
    'Te pongo en contacto con la Dra. Kely para revisar este tema de pago. Se pondrá en contacto contigo a la brevedad.',
  urgencia:
    'He notificado a la Dra. Kely de tu situación urgente. Se pondrá en contacto contigo lo antes posible.',
  default:
    'Te derivo con la Dra. Kely para que te atienda personalmente. Se pondrá en contacto contigo en breve.',
}

/**
 * Resolves the patient message and internal instruction for a given derivation motivo.
 *
 * @param {string|undefined} motivo - One of the DERIVACION_TEMPLATES keys
 * @returns {{ mensaje_paciente: string, mensaje_interno: string }}
 */
export function resolveDerivacion(motivo) {
  const mensaje_paciente =
    (motivo && DERIVACION_TEMPLATES[motivo]) || DERIVACION_TEMPLATES.default

  const mensaje_interno =
    `Notificación enviada a la doctora. ENVÍA TEXTUAL este mensaje al paciente, sin reescribirlo: "${mensaje_paciente}"`

  return { mensaje_paciente, mensaje_interno }
}
