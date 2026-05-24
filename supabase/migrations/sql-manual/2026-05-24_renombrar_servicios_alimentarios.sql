-- Migración manual ejecutada el 2026-05-24 en producción.
-- Renombrado de IDs de servicios alimentarios para alinear con el nuevo catálogo unificado.
-- Esta migración NO se auto-ejecuta — vive aquí como referencia histórica.
-- Ejecutada por: Joshua, desde SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS _backup_citas_servicio_2026_05_24 AS
  SELECT id, servicio, created_at FROM citas;

BEGIN;

UPDATE citas SET servicio = 'alimentario_quincenal' WHERE servicio = 'quincenal';
UPDATE citas SET servicio = 'alimentario_mensual'   WHERE servicio = 'mensual';
UPDATE citas SET servicio = 'alimentario_exclusivo' WHERE servicio = 'premium';

-- Verificación (esperado: 0 filas)
SELECT servicio, COUNT(*) FROM citas
  WHERE servicio IN ('quincenal','mensual','premium')
  GROUP BY servicio;

COMMIT;

-- Rollback (por si algún día hace falta):
-- BEGIN;
-- UPDATE citas SET servicio = 'quincenal' WHERE servicio = 'alimentario_quincenal';
-- UPDATE citas SET servicio = 'mensual'   WHERE servicio = 'alimentario_mensual';
-- UPDATE citas SET servicio = 'premium'   WHERE servicio = 'alimentario_exclusivo';
-- COMMIT;
