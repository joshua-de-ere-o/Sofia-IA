/**
 * lib/availability/slot-generator.d.ts
 *
 * Ambient types for slot-generator.js.
 * Consumed by Deno's type checker without a build step.
 */

export declare const OPENING_HOUR: string;
export declare const BASE_MORNING_SLOTS: string[];
export declare const BASE_AFTERNOON_SLOTS: string[];

export declare function buildSlots(startTime: string, endTime: string): string[];

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
  timeZone: string;
  now?: Date;
  maxDays?: number;
}): Record<string, DayEntry>;
