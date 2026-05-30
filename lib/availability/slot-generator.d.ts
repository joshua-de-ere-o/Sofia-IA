/**
 * lib/availability/slot-generator.d.ts
 *
 * Ambient types for slot-generator.js.
 * Consumed by Deno's type checker without a build step.
 */

export declare const BASE_MORNING_SLOTS: string[];
export declare const BASE_AFTERNOON_SLOTS: string[];
export declare const NON_BLOCKING_APPOINTMENT_STATES: Set<string>;

export declare function buildSlots(startTime: string, endTime: string): string[];
export declare function normalizeTime(time: string): string;
export declare function timeToMinutes(time: string): number;
export declare function minutesToTime(totalMinutes: number): string;
export declare function addMinutesToTime(time: string, minutesToAdd: number): string;
export declare function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean;

export interface OccupiedRange {
  fecha: string;
  start: string;
  end: string;
  duracion_min: number;
}

export declare function buildOccupiedRanges(rows?: Array<Record<string, unknown>>): OccupiedRange[];
export declare function isSlotOccupied(params: {
  date: string;
  timeSlot: string;
  occupiedRanges?: OccupiedRange[];
  slotDurationMin?: number;
}): boolean;

export interface ExcepcionHorario {
  ubicacion: 'quito_extendido' | 'solo_virtual' | 'santo_domingo';
  hora_fin: string;
  fecha: string;
  [key: string]: unknown;
}

export type SlotTag = 'normal' | 'virtual_only' | 'santo_domingo';

export interface DaySlotResult {
  slots: string[];
  tag: SlotTag;
}

export declare function computeDaySlots(params: {
  dayOfWeek: number;
  isFeriado: boolean;
  excepcion: ExcepcionHorario | null;
}): DaySlotResult;

export interface DayEntry {
  dia_semana: string;
  horarios: string[];
  tag: string;
}

export declare function generateSlots(params: {
  fechaInicio: string;
  fechaFin: string;
  feriadosSet: Set<string>;
  excepcionesMap: Map<string, ExcepcionHorario>;
  occupiedSet: Set<string>;
  occupiedRanges?: OccupiedRange[];
  todayStr: string | null;
  currentHourStr: string | null;
  maxDays?: number;
}): Record<string, DayEntry>;

export declare function generateAvailability(params: {
  fechaInicio: string;
  fechaFin: string;
  feriadosSet: Set<string>;
  excepcionesMap: Map<string, ExcepcionHorario>;
  occupiedSet: Set<string>;
  occupiedRanges?: OccupiedRange[];
  timeZone: string;
  now?: Date;
  maxDays?: number;
}): Record<string, DayEntry>;
