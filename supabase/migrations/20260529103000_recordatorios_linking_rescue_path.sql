-- Migration: recordatorios_linking_rescue_path
-- Purpose: add safe rescue queries for reminder linking when the provided date
-- is wrong/forgotten, while keeping linking conservative and deterministic.

CREATE OR REPLACE FUNCTION public.verificar_paciente_match(
  p_nombre TEXT,
  p_fecha_cita DATE DEFAULT NULL,
  p_hora_cita TIME DEFAULT NULL,
  p_allow_nearby BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  telefono TEXT,
  fecha DATE,
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
    c.fecha,
    c.hora,
    CASE
      WHEN p_fecha_cita IS NOT NULL AND c.fecha = p_fecha_cita THEN 1::REAL
      WHEN p_fecha_cita IS NOT NULL THEN 0.6::REAL
      ELSE 0.5::REAL
    END AS score
  FROM public.citas c
  INNER JOIN public.pacientes p
    ON p.id = c.paciente_id
  CROSS JOIN normalized_input ni
  WHERE c.estado NOT IN ('cancelada', 'no_show')
    AND (p_hora_cita IS NULL OR c.hora = p_hora_cita)
    AND lower(regexp_replace(COALESCE(c.patient_name_normalized, public.f_unaccent(trim(p.nombre))), '\s+', ' ', 'g')) = ni.nombre_normalizado
    AND (
      (
        p_allow_nearby = FALSE
        AND p_fecha_cita IS NOT NULL
        AND c.fecha = p_fecha_cita
      )
      OR (
        p_allow_nearby = TRUE
        AND p_fecha_cita IS NOT NULL
        AND c.fecha BETWEEN (p_fecha_cita - INTERVAL '2 days')::date
                        AND (p_fecha_cita + INTERVAL '2 days')::date
      )
      OR (
        p_allow_nearby = TRUE
        AND p_fecha_cita IS NULL
        AND c.fecha BETWEEN (CURRENT_DATE - INTERVAL '1 day')::date
                        AND (CURRENT_DATE + INTERVAL '14 days')::date
      )
    )
  ORDER BY
    CASE WHEN p_fecha_cita IS NULL THEN 0 ELSE ABS(c.fecha - p_fecha_cita) END ASC,
    c.fecha ASC,
    c.hora ASC,
    p.created_at ASC NULLS LAST
  LIMIT 5;
$$;
