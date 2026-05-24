// SYNC: este catálogo refleja supabase/functions/agent-runner/config.ts (Deno). Cambios → actualizar ambos.

export const SERVICIOS = {
  alimentario_quincenal: {
    id: 'alimentario_quincenal',
    label: 'Plan Alimentario Quincenal',
    precio: 25,
    duracion_min: 60,
    categoria: 'alimentario',
    agendable: true,
    modalidades: ['presencial'],
    zonas_permitidas: ['sur', 'norte'],
    requiere_adelanto: true,
    permite_combo: true,
    derivacion_motivo: null,
  },
  alimentario_mensual: {
    id: 'alimentario_mensual',
    label: 'Plan Alimentario Mensual',
    precio: 35, // TODO confirmar lunes (spec dice $40, código actual dice $35)
    duracion_min: 60,
    categoria: 'alimentario',
    agendable: true,
    modalidades: ['presencial'],
    zonas_permitidas: ['sur', 'norte'],
    requiere_adelanto: true,
    permite_combo: true,
    derivacion_motivo: null,
  },
  alimentario_exclusivo: {
    id: 'alimentario_exclusivo',
    label: 'Plan Alimentario Exclusivo',
    precio: 70,
    duracion_min: 60,
    categoria: 'alimentario',
    agendable: true,
    modalidades: ['presencial', 'virtual'],
    zonas_permitidas: ['sur', 'norte', 'domicilio', 'virtual'],
    requiere_adelanto: true,
    permite_combo: true,
    derivacion_motivo: null,
  },
  trimestral: {
    id: 'trimestral',
    label: 'Plan Trimestral',
    precio: 90,
    duracion_min: 60,
    categoria: 'alimentario',
    agendable: true,
    modalidades: ['presencial'],
    zonas_permitidas: ['sur', 'norte'],
    requiere_adelanto: true,
    permite_combo: true,
    derivacion_motivo: null,
  },
  virtual: {
    id: 'virtual',
    label: 'Consulta Virtual',
    precio: 20,
    duracion_min: 45,
    categoria: 'alimentario',
    agendable: true,
    modalidades: ['virtual'],
    zonas_permitidas: ['virtual'],
    requiere_adelanto: true,
    permite_combo: false,
    derivacion_motivo: null,
  },
  inbody: {
    id: 'inbody',
    label: 'InBody',
    precio: 20,
    duracion_min: 20,
    categoria: 'complementario',
    agendable: true,
    modalidades: ['presencial'],
    zonas_permitidas: ['sur'],
    requiere_adelanto: false,
    permite_combo: true, // TODO Q6: ¿gratis con plan deportivo?
    derivacion_motivo: null,
  },
  deportivo_quincenal: {
    id: 'deportivo_quincenal',
    label: 'Plan Deportivo Quincenal',
    precio: 30,
    duracion_min: 60,
    categoria: 'deportivo',
    agendable: true,
    modalidades: ['presencial'], // TODO Q2: ¿virtual también?
    zonas_permitidas: ['sur', 'norte'], // TODO Q7
    requiere_adelanto: true, // TODO Q7
    permite_combo: true,
    derivacion_motivo: null,
  },
  deportivo_mensual: {
    id: 'deportivo_mensual',
    label: 'Plan Deportivo Mensual',
    precio: 40,
    duracion_min: 60,
    categoria: 'deportivo',
    agendable: true,
    modalidades: ['presencial'], // TODO Q2
    zonas_permitidas: ['sur', 'norte'], // TODO Q7
    requiere_adelanto: true, // TODO Q7
    permite_combo: true,
    derivacion_motivo: null,
  },
  deportivo_exclusivo: {
    id: 'deportivo_exclusivo',
    label: 'Plan Deportivo Exclusivo',
    precio: 100,
    duracion_min: 60,
    categoria: 'deportivo',
    agendable: true,
    modalidades: ['presencial', 'virtual'], // TODO Q2
    zonas_permitidas: ['sur', 'norte', 'domicilio', 'virtual'], // TODO Q7
    requiere_adelanto: true, // TODO Q7
    permite_combo: true,
    derivacion_motivo: null,
  },
  masaje: {
    id: 'masaje',
    label: 'Masaje Terapéutico',
    precio: 15,
    duracion_min: 30,
    categoria: 'masaje',
    agendable: true,
    modalidades: ['presencial'],
    zonas_permitidas: ['sur'], // TODO Q3: ¿descuento combo con plan mensual?
    requiere_adelanto: false,
    permite_combo: false,
    derivacion_motivo: null,
  },
  taller_individual: {
    id: 'taller_individual',
    label: 'Taller Individual',
    precio: 20,
    duracion_min: 60,
    categoria: 'taller',
    agendable: true,
    modalidades: ['presencial'], // TODO Q1: ¿también virtual?
    zonas_permitidas: ['sur'], // TODO Q1: ¿también norte?
    requiere_adelanto: true,
    permite_combo: false,
    derivacion_motivo: null,
  },
  taller_grupal: {
    id: 'taller_grupal',
    label: 'Taller Grupal',
    precio: 80,
    duracion_min: 90,
    categoria: 'taller',
    agendable: true,
    modalidades: ['presencial'], // TODO Q1
    zonas_permitidas: ['sur'], // TODO Q1
    requiere_adelanto: true,
    permite_combo: false,
    derivacion_motivo: null,
  },
  taller_empresarial: {
    id: 'taller_empresarial',
    label: 'Taller Empresarial',
    precio: 0,
    duracion_min: null,
    categoria: 'taller',
    agendable: false,
    modalidades: ['presencial'],
    zonas_permitidas: [],
    requiere_adelanto: false,
    permite_combo: false,
    derivacion_motivo: 'taller_empresarial',
  },
  reduccion_medidas: {
    id: 'reduccion_medidas',
    label: 'Reducción de Medidas',
    precio: 0,
    duracion_min: null,
    categoria: 'derivacion',
    agendable: false,
    modalidades: ['presencial'],
    zonas_permitidas: [],
    requiere_adelanto: false,
    permite_combo: false,
    derivacion_motivo: 'reduccion_medidas', // TODO Q4: niveles $400/$1000/$1950 en 10-negocio.md
  },
}

export function getServicioLabel(id) {
  if (!id) return ''
  return SERVICIOS[id]?.label ?? id
}

export function getServicioPrecio(id) {
  if (!id) return null
  return SERVICIOS[id]?.precio ?? null
}

export function getServicio(id) {
  return SERVICIOS[id] ?? null
}
