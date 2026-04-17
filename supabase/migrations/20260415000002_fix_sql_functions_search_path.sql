-- Migration: Fijar search_path en funciones SQL vulnerables.
--
-- Problema: funciones sin search_path fijo son vulnerables a search_path
-- hijacking: un usuario con permiso CREATE en cualquier schema visible podría
-- anteponer objetos maliciosos que se resolverían antes que los reales.
-- Mitigación: SET search_path = public, pg_temp.

-- 1. current_timestamp_on_update (trigger usado en citas/configuracion/user_settings)
CREATE OR REPLACE FUNCTION public.current_timestamp_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. trigger_enviar_recordatorios (si existe en la BD de producción pero no en
--    las migraciones del repo). Usamos un bloque defensivo: si la función no
--    existe, no rompemos la migración. Si existe, le aplicamos search_path
--    fijo preservando su código actual.
DO $$
DECLARE
  v_src text;
  v_lang text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'trigger_enviar_recordatorios'
    AND n.nspname = 'public'
  LIMIT 1;

  IF v_src IS NULL THEN
    RAISE NOTICE 'trigger_enviar_recordatorios no existe, se omite.';
  ELSE
    -- Aplica el SET directamente a la función existente sin reescribirla.
    EXECUTE 'ALTER FUNCTION public.trigger_enviar_recordatorios() SET search_path = public, pg_temp';
    RAISE NOTICE 'search_path fijado en trigger_enviar_recordatorios.';
  END IF;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'trigger_enviar_recordatorios() con firma vacía no encontrada, se omite.';
END $$;
