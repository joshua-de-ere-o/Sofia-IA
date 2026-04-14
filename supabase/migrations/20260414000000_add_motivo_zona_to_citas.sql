-- Migración para agregar motivo y zona a la tabla citas

-- Agregar columna motivo
ALTER TABLE citas ADD COLUMN IF NOT EXISTS motivo TEXT;

-- Agregar columna zona
ALTER TABLE citas ADD COLUMN IF NOT EXISTS zona TEXT;

-- Comentario para explicar el propósito de zona a nivel de cita
COMMENT ON COLUMN citas.zona IS 'Permite sobreescribir la zona del paciente para esta cita específica (ej: paciente del sur pero cita virtual).';
