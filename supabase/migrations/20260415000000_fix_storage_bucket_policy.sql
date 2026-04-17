-- Migration: Cerrar acceso público al bucket 'comprobantes'
-- Motivo: los comprobantes de pago son datos privados del paciente.
-- Solo usuarios autenticados (CRM) pueden leerlos. El service role (Edge Functions)
-- bypasea RLS y sigue pudiendo subir/leer sin restricciones.

-- 1. Marcar el bucket como privado
UPDATE storage.buckets SET public = false WHERE id = 'comprobantes';

-- 2. Eliminar políticas SELECT públicas existentes sobre storage.objects
--    relacionadas al bucket 'comprobantes'.
DROP POLICY IF EXISTS "Permitir lectura pública de comprobantes" ON storage.objects;
DROP POLICY IF EXISTS "Public read comprobantes" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read on comprobantes" ON storage.objects;

-- 3. Nueva política SELECT restringida a usuarios autenticados
CREATE POLICY "comprobantes_select_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'comprobantes' AND auth.role() = 'authenticated');

-- 4. La política INSERT existente se mantiene (el service role la usa para subir
--    los comprobantes desde la Edge Function / lib/payments.js). Si por algún
--    motivo no existe, la re-creamos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Permitir subida de comprobantes'
  ) THEN
    CREATE POLICY "Permitir subida de comprobantes"
      ON storage.objects
      FOR INSERT
      TO public
      WITH CHECK (bucket_id = 'comprobantes');
  END IF;
END $$;
