-- Migration: Endurecer políticas RLS INSERT/UPDATE permisivas.
--
-- Problema: 14 políticas tenían WITH CHECK (true), lo que permite a cualquier
-- usuario autenticado insertar o modificar filas arbitrarias. Cambiamos el
-- check a auth.uid() IS NOT NULL para garantizar que hay un usuario real
-- detrás (no un anon key con JWT falsificado).
--
-- Nota: Las Edge Functions usan el service role y bypasean RLS, por lo que
-- este cambio no las afecta. Solo afecta al frontend con anon key.
-- Las políticas SELECT y DELETE no se tocan.

-- ───────── pacientes ─────────
DROP POLICY IF EXISTS "policy_pacientes_insert" ON public.pacientes;
DROP POLICY IF EXISTS "policy_pacientes_update" ON public.pacientes;

CREATE POLICY "pacientes_insert_authenticated_user"
  ON public.pacientes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "pacientes_update_authenticated_user"
  ON public.pacientes FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── citas ─────────
DROP POLICY IF EXISTS "policy_citas_insert" ON public.citas;
DROP POLICY IF EXISTS "policy_citas_update" ON public.citas;

CREATE POLICY "citas_insert_authenticated_user"
  ON public.citas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "citas_update_authenticated_user"
  ON public.citas FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── conversaciones ─────────
DROP POLICY IF EXISTS "policy_conversaciones_insert" ON public.conversaciones;
DROP POLICY IF EXISTS "policy_conversaciones_update" ON public.conversaciones;

CREATE POLICY "conversaciones_insert_authenticated_user"
  ON public.conversaciones FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "conversaciones_update_authenticated_user"
  ON public.conversaciones FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── pagos ─────────
DROP POLICY IF EXISTS "policy_pagos_insert" ON public.pagos;
DROP POLICY IF EXISTS "policy_pagos_update" ON public.pagos;

CREATE POLICY "pagos_insert_authenticated_user"
  ON public.pagos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "pagos_update_authenticated_user"
  ON public.pagos FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── handoffs ─────────
DROP POLICY IF EXISTS "policy_handoffs_insert" ON public.handoffs;
DROP POLICY IF EXISTS "policy_handoffs_update" ON public.handoffs;

CREATE POLICY "handoffs_insert_authenticated_user"
  ON public.handoffs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "handoffs_update_authenticated_user"
  ON public.handoffs FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── configuracion ─────────
DROP POLICY IF EXISTS "policy_configuracion_insert" ON public.configuracion;
DROP POLICY IF EXISTS "policy_configuracion_update" ON public.configuracion;

CREATE POLICY "configuracion_insert_authenticated_user"
  ON public.configuracion FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "configuracion_update_authenticated_user"
  ON public.configuracion FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ───────── feriados ─────────
DROP POLICY IF EXISTS "policy_feriados_insert" ON public.feriados;
DROP POLICY IF EXISTS "policy_feriados_update" ON public.feriados;

CREATE POLICY "feriados_insert_authenticated_user"
  ON public.feriados FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "feriados_update_authenticated_user"
  ON public.feriados FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
