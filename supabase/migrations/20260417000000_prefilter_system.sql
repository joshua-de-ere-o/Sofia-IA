-- Migration: Sistema de Pre-filtro (Spec 09)
-- Agrega columnas de configuración (blocklist, keywords, canned), columnas de
-- conversaciones (mode, canned_sent_at, last_message_at, manual_until) y la
-- tabla independiente `blocklist` para gestión persistente.

-- ──────────────────────────────────────────────────────────────
-- 4.1  configuracion — campos nuevos
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS blocklist_numeros TEXT[] DEFAULT '{}';

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS keywords_intencion TEXT[] DEFAULT ARRAY[
    'precio', 'precios', 'cita', 'agendar', 'agenda', 'plan', 'planes',
    'consulta', 'bajar', 'peso', 'músculo', 'musculo', 'dieta', 'nutrición',
    'nutricion', 'doctora', 'dra', 'kely', 'kelly', 'medicamento', 'pastilla',
    'inyección', 'inyeccion', 'ozempic', 'saxenda', 'medicación', 'medicacion',
    'cuánto', 'cuanto', 'costo', 'valor', 'disponibilidad', 'horario',
    'fármaco', 'farmaco', 'pastillas'
  ];

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS keywords_spam TEXT[] DEFAULT ARRAY[
    'casino', 'crypto', 'cripto', 'bitcoin', 'inversiones', 'forex',
    'préstamo', 'prestamo', 'publicidad', 'colaboración', 'colaboracion',
    'mlm', 'emprendimiento', 'oportunidad de negocio', 'gana dinero'
  ];

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS canned_texto TEXT DEFAULT
    E'Hola 👋 Soy Sofía, asistente de la Dra. Kely. ¿En qué puedo ayudarte hoy?\n\n1. Quiero agendar una cita\n2. Servicios y precios\n3. Tengo una consulta o duda';

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS canned_cooldown_horas INTEGER DEFAULT 12;

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS manual_timeout_horas INTEGER DEFAULT 6;

-- ──────────────────────────────────────────────────────────────
-- 4.2  conversaciones — campos nuevos
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'auto'
    CHECK (mode IN ('auto', 'manual', 'personal'));

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS canned_sent_at TIMESTAMPTZ;

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS manual_until TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────────
-- 4.3  blocklist — tabla nueva
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blocklist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT NOT NULL UNIQUE,
  tipo       TEXT NOT NULL DEFAULT 'personal'
             CHECK (tipo IN ('personal', 'spam')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT DEFAULT 'kelly'
);

ALTER TABLE public.blocklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocklist_select_authenticated" ON public.blocklist;
CREATE POLICY "blocklist_select_authenticated"
  ON public.blocklist FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "blocklist_insert_authenticated" ON public.blocklist;
CREATE POLICY "blocklist_insert_authenticated"
  ON public.blocklist FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "blocklist_update_authenticated" ON public.blocklist;
CREATE POLICY "blocklist_update_authenticated"
  ON public.blocklist FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "blocklist_delete_authenticated" ON public.blocklist;
CREATE POLICY "blocklist_delete_authenticated"
  ON public.blocklist FOR DELETE TO authenticated USING (true);

-- Index para consulta rápida desde pre-filter
CREATE INDEX IF NOT EXISTS idx_blocklist_phone ON public.blocklist(phone);
CREATE INDEX IF NOT EXISTS idx_conversaciones_telefono_mode
  ON public.conversaciones(telefono_contacto, mode);
