-- Agrega columna monto_adelanto a citas para que el sistema registre
-- el monto calculado (plan + zona) y no dependa de regex sobre mensajes.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS monto_adelanto NUMERIC(10,2) DEFAULT 0;
