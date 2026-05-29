-- Migration: recordatorios_linking_safe_match
-- Purpose: make reminder linking match by normalized name + appointment date,
-- with optional appointment time as the only tiebreaker.

CREATE OR REPLACE FUNCTION public.verificar_paciente_match(
  p_nombre TEXT,
  p_fecha_cita DATE,
  p_hora_cita TIME DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  telefono TEXT,
  hora TIME,
  score REAL
) LANGUAGE sql STABLE AS $$
  WITH normalized_input AS (
    SELECT lower(regexp_replace(public.f_unaccent(trim(p_nombre)), '\s+', ' ', 'g')) AS nombre_normalizado
  )
  SELECT
    p.id,
    p.nombre,
    p.telefono,
    c.hora,
    1::REAL AS score
  FROM public.citas c
  INNER JOIN public.pacientes p
    ON p.id = c.paciente_id
  CROSS JOIN normalized_input ni
  WHERE c.fecha = p_fecha_cita
    AND (p_hora_cita IS NULL OR c.hora = p_hora_cita)
    AND c.estado NOT IN ('cancelada', 'no_show')
    AND lower(regexp_replace(COALESCE(c.patient_name_normalized, public.f_unaccent(trim(p.nombre))), '\s+', ' ', 'g')) = ni.nombre_normalizado
  ORDER BY c.hora ASC, p.created_at ASC NULLS LAST
  LIMIT 5;
$$;
