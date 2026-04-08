-- Migration: Inicialización del esquema de base de datos
-- Proyecto: Sistema IA Dra. Kely

-- Enable pgcrypto for UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum Definitions
CREATE TYPE zona_enum AS ENUM ('sur', 'norte', 'virtual', 'valle', 'domicilio');
CREATE TYPE cita_estado_enum AS ENUM ('bloqueado', 'pendiente_pago', 'confirmada', 'completada', 'cancelada', 'no_show');
CREATE TYPE modalidad_enum AS ENUM ('presencial', 'virtual');
CREATE TYPE canal_enum AS ENUM ('whatsapp', 'telegram');
CREATE TYPE conv_estado_enum AS ENUM ('activa', 'cerrada');
CREATE TYPE urgencia_enum AS ENUM ('alto', 'medio', 'bajo');
CREATE TYPE handoff_estado_enum AS ENUM ('activo', 'resuelto', 'timeout');
CREATE TYPE payment_method_enum AS ENUM ('transfer', 'cash', 'payphone');

-- 1. Pacientes
CREATE TABLE public.pacientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    fecha_nacimiento DATE,
    telefono TEXT NOT NULL UNIQUE,
    email TEXT,
    zona zona_enum NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Citas
CREATE TABLE public.citas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
    servicio TEXT NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    duracion_min INT NOT NULL DEFAULT 30,
    estado cita_estado_enum NOT NULL DEFAULT 'bloqueado',
    modalidad modalidad_enum NOT NULL,
    payment_method payment_method_enum,
    payment_reference TEXT,
    external_calendar_id TEXT,
    reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_2h_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Conversaciones
CREATE TABLE public.conversaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id UUID REFERENCES public.pacientes(id) ON DELETE SET NULL,
    canal canal_enum NOT NULL DEFAULT 'whatsapp',
    estado conv_estado_enum NOT NULL DEFAULT 'activa',
    historial_resumido TEXT,
    handoff_activo BOOLEAN NOT NULL DEFAULT FALSE,
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reactivacion_enviada BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Pagos
CREATE TABLE public.pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cita_id UUID NOT NULL REFERENCES public.citas(id) ON DELETE CASCADE,
    monto DECIMAL(10, 2) NOT NULL,
    metodo payment_method_enum NOT NULL,
    referencia TEXT,
    comprobante_url TEXT,
    verificado BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Handoffs
CREATE TABLE public.handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversacion_id UUID NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
    paciente_id UUID NOT NULL REFERENCES public.pacientes(id) ON DELETE CASCADE,
    motivo TEXT NOT NULL,
    nivel_urgencia urgencia_enum NOT NULL DEFAULT 'medio',
    estado handoff_estado_enum NOT NULL DEFAULT 'activo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- 6. Configuración
CREATE TABLE public.configuracion (
    id INT PRIMARY KEY DEFAULT 1,
    datos_bancarios JSONB,
    whitelist_activa BOOLEAN NOT NULL DEFAULT FALSE,
    whitelist_numeros TEXT[] DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT only_one_row CHECK (id = 1)
);

-- Insertar configuración inicial por defecto
INSERT INTO public.configuracion (id, whitelist_activa) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

-- 7. User Settings (App Auth)
CREATE TABLE public.user_settings (
    id UUID PRIMARY KEY, -- Esto vendrá de auth.users.id
    pin_hash TEXT NOT NULL,
    pin_intentos_fallidos INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Feriados
CREATE TABLE public.feriados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha DATE NOT NULL,
    nombre TEXT NOT NULL,
    anio INT NOT NULL
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION current_timestamp_on_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER citas_update
    BEFORE UPDATE ON public.citas
    FOR EACH ROW
    EXECUTE PROCEDURE current_timestamp_on_update();

CREATE TRIGGER configuracion_update
    BEFORE UPDATE ON public.configuracion
    FOR EACH ROW
    EXECUTE PROCEDURE current_timestamp_on_update();

CREATE TRIGGER user_settings_update
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW
    EXECUTE PROCEDURE current_timestamp_on_update();

-- Row Level Security (RLS) base constraints
-- As of V1, everything is only accessible via service_role or authenticated with PIN

ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

-- Note: We will add detailed RLS policies tailored to edge functions and auth in the next phase if needed.
