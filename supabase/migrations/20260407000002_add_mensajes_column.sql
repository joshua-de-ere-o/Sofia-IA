-- Añadir columnas para gestionar la memoria a corto plazo y mapear usuarios de WA no registrados
ALTER TABLE public.conversaciones
ADD COLUMN IF NOT EXISTS mensajes_raw JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;

