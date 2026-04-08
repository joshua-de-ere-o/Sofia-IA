/**
 * lib/agent.js
 * System prompt + Tool definitions for Sofía (Claude Haiku 4.5)
 * Spec references: 01-agente.md, 03-agenda.md, 04-pagos.md, 05-handoff.md
 */

// ─── System Prompt ────────────────────────────────────────────────────────────
// Movido a supabase/functions/agent-runner/config.ts para evitar duplicación.
// ─── Tool Definitions (Anthropic Tool Use format) ─────────────────────────────
export const TOOLS = [
  {
    name: "consultar_disponibilidad",
    description:
      "Consulta los slots de agenda disponibles para agendar una cita con la Dra. Kely León. Retorna un array de fechas y horarios libres dentro de la ventana de 14 días.",
    input_schema: {
      type: "object",
      properties: {
        fecha_inicio: {
          type: "string",
          description: "Fecha de inicio del rango en formato YYYY-MM-DD (normalmente hoy).",
        },
        fecha_fin: {
          type: "string",
          description: "Fecha fin del rango en formato YYYY-MM-DD (máximo hoy + 14 días).",
        },
        modalidad: {
          type: "string",
          enum: ["presencial", "virtual"],
          description: "Modalidad de la cita.",
        },
      },
      required: ["fecha_inicio", "fecha_fin", "modalidad"],
    },
  },
  {
    name: "calcular_precio",
    description:
      "Calcula el precio total y el monto de adelanto requerido para un servicio según la zona del paciente. Usa esto ANTES de informar precios al paciente.",
    input_schema: {
      type: "object",
      properties: {
        servicio_id: {
          type: "string",
          enum: ["inbody", "virtual", "quincenal", "esencial", "premium", "trimestral"],
          description: "ID del servicio/plan seleccionado.",
        },
        zona: {
          type: "string",
          enum: ["sur", "norte", "virtual", "valle", "domicilio"],
          description: "Zona del paciente.",
        },
      },
      required: ["servicio_id", "zona"],
    },
  },
  {
    name: "agendar_cita",
    description:
      "Agenda una cita para el paciente. Crea el registro en la base de datos y bloquea el slot. Si la zona es 'sur', la cita se confirma directamente. Para otras zonas, queda en estado pendiente_pago hasta recibir comprobante.",
    input_schema: {
      type: "object",
      properties: {
        paciente_nombre: {
          type: "string",
          description: "Nombre completo del paciente.",
        },
        paciente_fecha_nacimiento: {
          type: "string",
          description: "Fecha de nacimiento del paciente en formato YYYY-MM-DD.",
        },
        paciente_telefono: {
          type: "string",
          description: "Número de teléfono del paciente en formato internacional (ej: +593999123456).",
        },
        paciente_email: {
          type: "string",
          description: "Correo electrónico del paciente (opcional).",
        },
        servicio_id: {
          type: "string",
          enum: ["inbody", "virtual", "quincenal", "esencial", "premium", "trimestral"],
          description: "ID del servicio/plan.",
        },
        fecha: {
          type: "string",
          description: "Fecha de la cita en formato YYYY-MM-DD.",
        },
        hora: {
          type: "string",
          description: "Hora de la cita en formato HH:MM (24h).",
        },
        modalidad: {
          type: "string",
          enum: ["presencial", "virtual"],
          description: "Modalidad de la cita.",
        },
        zona: {
          type: "string",
          enum: ["sur", "norte", "virtual", "valle", "domicilio"],
          description: "Zona del paciente.",
        },
        motivo: {
          type: "string",
          description: "Motivo o razón de la consulta.",
        },
      },
      required: [
        "paciente_nombre",
        "paciente_fecha_nacimiento",
        "paciente_telefono",
        "servicio_id",
        "fecha",
        "hora",
        "modalidad",
        "zona",
        "motivo",
      ],
    },
  },
  {
    name: "derivar_a_kelly",
    description:
      "Escala la conversación a la Dra. Kely León vía Telegram. Usa esto cuando detectes: medicamentos, dudas clínicas, reclamos, disputas de pago, urgencias, convenios, prensa, o solicitudes fuera del flujo estándar. El agente se PAUSA solo en esta conversación.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "Motivo por el que se escala la conversación.",
        },
        nivel_urgencia: {
          type: "string",
          enum: ["alto", "medio", "bajo"],
          description: "Nivel de urgencia del escalamiento.",
        },
        historial_resumido: {
          type: "string",
          description: "Resumen breve del historial de la conversación para contexto de la doctora.",
        },
      },
      required: ["motivo", "nivel_urgencia", "historial_resumido"],
    },
  },
];

// ─── Service catalog (shared reference) ───────────────────────────────────────
export const SERVICE_CATALOG = {
  inbody: { name: "Evaluación InBody 270", price: 20 },
  virtual: { name: "Consulta Virtual", price: 20 },
  quincenal: { name: "Plan Quincenal", price: 25 },
  esencial: { name: "Plan Esencial ⭐", price: 35 },
  premium: { name: "Plan Mensual Premium", price: 70 },
  trimestral: { name: "Plan Trimestral", price: 90 },
};

// ─── Model config (agnóstico al proveedor) ────────────────────────────────────
export const MODEL_CONFIG = {
  max_tokens_normal: 300,
  max_tokens_confirmation: 100,
  history_condensation_threshold: 6, // Condensar después de 6 mensajes
};

// ─── Factory deprecado ─────────────────────────────────────────────────────────
// El adaptador real vive en supabase/functions/agent-runner/model-adapter.ts.
export function getModelAdapter() {
  throw new Error(
    "getModelAdapter en lib/agent.js está deprecado. Usa supabase/functions/agent-runner/model-adapter.ts."
  );
}
