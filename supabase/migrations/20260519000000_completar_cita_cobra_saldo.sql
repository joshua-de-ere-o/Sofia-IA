-- Migration: al pasar una cita a `completada`, registrar automaticamente el
-- saldo cobrado en consulta como pago cash verificado.
--
-- Contexto de negocio (04-pagos.md):
--   - Sur:       adelanto $0, paciente paga el plan completo en consulta.
--   - Norte:     adelanto 50%, saldo 50% en consulta.
--   - Virtual:   adelanto 50%, saldo 50% en consulta.
--   - Valle:     adelanto 50% de (plan + $5), saldo 50% en consulta.
--   - Domicilio: adelanto $20 fijo, saldo (monto_total - 20) en consulta.
--
-- Antes: al marcar `completada` (CRM o Telegram) la cita cambiaba de estado
--        pero el dinero cobrado en consulta NO se registraba en `pagos`, por
--        lo que la pestaña Finanzas no reflejaba la plata real cobrada.
--
-- Ahora: un trigger en BD calcula `saldo = monto_total - SUM(pagos verificados)`
--        y, si saldo > 0, inserta un `pago` cash verificado con referencia
--        `cobro_consulta`. Idempotente: si ya existe un pago con esa
--        referencia para la misma cita, no inserta nada.
--
-- Por que en BD y no en codigo:
--   - Una sola fuente de verdad: da igual quien dispare el cambio de estado
--     (CRM, Telegram, futuros canales, SQL Editor manual).
--   - Atomico: si falla el insert del pago, revierte la transicion de estado.
--   - El agente (Sofia) no necesita saber nada de esto.

-- Asegurar que la columna monto_total exista (se agrego manualmente en prod
-- el 2026-05-18; este IF NOT EXISTS garantiza reconstruccion desde cero).
ALTER TABLE public.citas
  ADD COLUMN IF NOT EXISTS monto_total NUMERIC(10, 2);

CREATE OR REPLACE FUNCTION public.cobrar_saldo_al_completar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pagado NUMERIC(10, 2);
  saldo NUMERIC(10, 2);
BEGIN
  -- Solo actuar en la transicion explicita a `completada`.
  IF NEW.estado <> 'completada' OR OLD.estado = 'completada' THEN
    RETURN NEW;
  END IF;

  -- Si no tenemos monto_total (cita vieja anterior al cambio de mayo 2026),
  -- no podemos calcular el saldo de forma confiable: no hacemos nada.
  IF NEW.monto_total IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotencia: si ya cobramos el saldo de esta cita antes, no duplicar.
  IF EXISTS (
    SELECT 1 FROM public.pagos
    WHERE cita_id = NEW.id AND referencia = 'cobro_consulta'
  ) THEN
    RETURN NEW;
  END IF;

  -- Sumar pagos verificados previos (adelantos por transfer, etc).
  SELECT COALESCE(SUM(monto), 0)
    INTO pagado
    FROM public.pagos
   WHERE cita_id = NEW.id AND verificado = TRUE;

  saldo := NEW.monto_total - pagado;

  -- Si no falta cobrar nada (o quedo negativo por algun ajuste), no insertar.
  IF saldo <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pagos (cita_id, monto, metodo, referencia, verificado)
  VALUES (NEW.id, saldo, 'cash', 'cobro_consulta', TRUE);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS citas_cobrar_saldo_al_completar ON public.citas;

CREATE TRIGGER citas_cobrar_saldo_al_completar
  AFTER UPDATE OF estado ON public.citas
  FOR EACH ROW
  EXECUTE FUNCTION public.cobrar_saldo_al_completar();
