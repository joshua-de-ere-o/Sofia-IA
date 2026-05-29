// Ventana del recordatorio 24h: siempre POR ENCIMA de las 24h estrictas, para
// que el botón "Cancelar cita" del template cumpla la política de cancelación
// (mínimo 24h de anticipación). 30 min de ancho para que con un cron cada 10min
// toda cita reciba el recordatorio (≥2 oportunidades).
const TWENTY_FOUR_HOUR_WINDOW_MS = {
  min: 24 * 60 * 60 * 1000 + 10 * 60 * 1000,
  max: 24 * 60 * 60 * 1000 + 40 * 60 * 1000,
};

const TWO_HOUR_WINDOW_MS = {
  min: 1 * 60 * 60 * 1000 + 50 * 60 * 1000,
  max: 2 * 60 * 60 * 1000 + 10 * 60 * 1000,
};

export type ReminderCandidate = {
  id: string;
  fecha: string;
  hora: string;
  modalidad: string;
  zona: string | null;
  servicio?: string | null;
  estado?: string | null;
  reminder_24h_sent: boolean;
  reminder_2h_sent: boolean;
  pacientes?: {
    nombre?: string | null;
    telefono?: string | null;
  } | null;
};

export type PendingAppointmentReminder = {
  citaId: string;
  reminderType: "24h" | "2h";
  phone: string;
  nombre: string;
  fecha: string;
  hora: string;
  modalidad: string;
  zona: string | null;
  servicio?: string | null;
};

function isInsideWindow(deltaMs: number, window: { min: number; max: number }) {
  return deltaMs >= window.min && deltaMs <= window.max;
}

function toAppointmentDateTime(fecha: string, hora: string) {
  return new Date(`${fecha}T${hora}`);
}

export function collectPendingAppointmentReminders(
  citas: ReminderCandidate[],
  now: Date = new Date(),
): PendingAppointmentReminder[] {
  const reminders: PendingAppointmentReminder[] = [];

  for (const cita of citas ?? []) {
    if (cita?.estado && cita.estado !== "confirmada") continue;

    const phone = cita?.pacientes?.telefono?.trim();
    const nombre = cita?.pacientes?.nombre?.trim();

    if (!phone || !nombre || !cita?.fecha || !cita?.hora) continue;

    const appointmentDateTime = toAppointmentDateTime(cita.fecha, cita.hora);
    const deltaMs = appointmentDateTime.getTime() - now.getTime();

    if (!cita.reminder_24h_sent && isInsideWindow(deltaMs, TWENTY_FOUR_HOUR_WINDOW_MS)) {
      reminders.push({
        citaId: cita.id,
        reminderType: "24h",
        phone,
        nombre,
        fecha: cita.fecha,
        hora: cita.hora,
        modalidad: cita.modalidad,
        zona: cita.zona,
        servicio: cita.servicio,
      });
      continue;
    }

    if (!cita.reminder_2h_sent && isInsideWindow(deltaMs, TWO_HOUR_WINDOW_MS)) {
      reminders.push({
        citaId: cita.id,
        reminderType: "2h",
        phone,
        nombre,
        fecha: cita.fecha,
        hora: cita.hora,
        modalidad: cita.modalidad,
        zona: cita.zona,
        servicio: cita.servicio,
      });
    }
  }

  return reminders;
}
