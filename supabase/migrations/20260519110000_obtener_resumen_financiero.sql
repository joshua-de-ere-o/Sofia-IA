-- Migration: funcion SQL obtener_resumen_financiero(p_desde, p_hasta).
--
-- Contexto:
--   La tool consultar_finanzas del modo-Kelly por Telegram necesita devolver
--   los mismos numeros que muestra la pestania Finanzas del CRM
--   (app/dashboard/actions.js getFinanzasMetrics). Una sola fuente de verdad
--   SQL para evitar drift entre canales.
--
-- Semantica (identica a la del CRM):
--   - Cobrado:        SUM(pagos.monto) WHERE verificado=true, filtrado por
--                     pagos.created_at dentro del rango.
--   - Por verificar:  SUM(pagos.monto) WHERE verificado=false, mismo filtro.
--   - Pendiente:      SUM(citas.monto_adelanto) WHERE estado='pendiente_pago'
--                     AND la cita NO tiene pagos asociados todavia, filtrado
--                     por citas.fecha dentro del rango.
--
-- El trigger cobrar_saldo_al_completar inserta pagos verificado=true al marcar
-- una cita 'completada'; esos saldos quedan automaticamente contados en cobrado.
--
-- Devuelve UNA fila con totales y counts. No incluye items: la pestania
-- Finanzas mantiene su query de detalle aparte.

CREATE OR REPLACE FUNCTION public.obtener_resumen_financiero(
  p_desde DATE,
  p_hasta DATE
)
RETURNS TABLE (
  cobrado_total NUMERIC,
  cobrado_count INT,
  por_verificar_total NUMERIC,
  por_verificar_count INT,
  pendiente_total NUMERIC,
  pendiente_count INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  pagos_periodo AS (
    SELECT monto, verificado
    FROM public.pagos
    WHERE created_at >= p_desde::TIMESTAMP
      AND created_at < (p_hasta + INTERVAL '1 day')::TIMESTAMP
  ),
  citas_pendientes AS (
    SELECT c.monto_adelanto
    FROM public.citas c
    LEFT JOIN public.pagos pg ON pg.cita_id = c.id
    WHERE c.estado = 'pendiente_pago'
      AND c.fecha >= p_desde
      AND c.fecha <= p_hasta
      AND pg.id IS NULL
  )
  SELECT
    COALESCE(SUM(CASE WHEN p.verificado THEN p.monto END), 0) AS cobrado_total,
    COUNT(*) FILTER (WHERE p.verificado)::INT AS cobrado_count,
    COALESCE(SUM(CASE WHEN NOT p.verificado THEN p.monto END), 0) AS por_verificar_total,
    COUNT(*) FILTER (WHERE NOT p.verificado)::INT AS por_verificar_count,
    (SELECT COALESCE(SUM(monto_adelanto), 0) FROM citas_pendientes) AS pendiente_total,
    (SELECT COUNT(*)::INT FROM citas_pendientes) AS pendiente_count
  FROM pagos_periodo p;
$$;
