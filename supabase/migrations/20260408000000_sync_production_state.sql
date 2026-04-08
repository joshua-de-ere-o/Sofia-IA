-- Migration: Sincronizar estado de producción (RLS, Storage, Cron)
-- Generado tras auditoría de entorno de producción

-- 1. Políticas RLS para tablas del negocio
-- Políticas para pacientes
CREATE POLICY "policy_pacientes_select" ON public.pacientes FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_pacientes_insert" ON public.pacientes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_pacientes_update" ON public.pacientes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para citas
CREATE POLICY "policy_citas_select" ON public.citas FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_citas_insert" ON public.citas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_citas_update" ON public.citas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para conversaciones
CREATE POLICY "policy_conversaciones_select" ON public.conversaciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_conversaciones_insert" ON public.conversaciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_conversaciones_update" ON public.conversaciones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para pagos
CREATE POLICY "policy_pagos_select" ON public.pagos FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_pagos_insert" ON public.pagos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_pagos_update" ON public.pagos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para handoffs
CREATE POLICY "policy_handoffs_select" ON public.handoffs FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_handoffs_insert" ON public.handoffs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_handoffs_update" ON public.handoffs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para configuracion
CREATE POLICY "policy_configuracion_select" ON public.configuracion FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_configuracion_insert" ON public.configuracion FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_configuracion_update" ON public.configuracion FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Políticas para feriados
CREATE POLICY "policy_feriados_select" ON public.feriados FOR SELECT TO authenticated USING (true);
CREATE POLICY "policy_feriados_insert" ON public.feriados FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "policy_feriados_update" ON public.feriados FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 2. Políticas RLS para User Settings (Autenticación estricta por auth.uid())
CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 3. Storage Bucket 'comprobantes'
INSERT INTO storage.buckets (id, name, public) 
VALUES ('comprobantes', 'comprobantes', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Permitir lectura pública de comprobantes" ON storage.objects FOR SELECT TO public USING (bucket_id = 'comprobantes'::text);
CREATE POLICY "Permitir subida de comprobantes" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'comprobantes'::text);

-- 4. Extensión pg_net y Cron Job para Recordatorios
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'enviar-recordatorios-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://azrftqhescniopmleolm.supabase.co/functions/v1/enviar-recordatorios',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'kelly-cron-secret-2024'
    )::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
