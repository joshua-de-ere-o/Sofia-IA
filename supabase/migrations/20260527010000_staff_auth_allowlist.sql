-- Staff auth hardening allowlist.
--
-- Security goals:
-- 1. Keep RLS enabled.
-- 2. Only active staff rows with approved roles (`doctor`, `admin`) are valid.
-- 3. Authenticated users can read only their own active row, matched by JWT email.
-- 4. Seed rows are intentionally omitted because this repository does not safely
--    disclose the two production staff emails.
--
-- Seed the initial authorized staff rows for the two known CRM operators.

CREATE TABLE IF NOT EXISTS public.staff_allowlist (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_allowlist_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT staff_allowlist_role_check CHECK (role IN ('doctor', 'admin'))
);

DROP TRIGGER IF EXISTS staff_allowlist_update ON public.staff_allowlist;

CREATE TRIGGER staff_allowlist_update
  BEFORE UPDATE ON public.staff_allowlist
  FOR EACH ROW
  EXECUTE PROCEDURE current_timestamp_on_update();

ALTER TABLE public.staff_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_allowlist_select_own_active" ON public.staff_allowlist;

CREATE POLICY "staff_allowlist_select_own_active"
  ON public.staff_allowlist FOR SELECT TO authenticated
  USING (
    is_active = TRUE
    AND email = lower(coalesce(auth.jwt()->>'email', ''))
    AND role IN ('doctor', 'admin')
  );

INSERT INTO public.staff_allowlist (email, role)
VALUES
  ('joshua.alexander.mad@gmail.com', 'admin'),
  ('kelyleon@outlook.es', 'doctor')
ON CONFLICT (email) DO UPDATE
SET
  role = EXCLUDED.role,
  is_active = TRUE,
  updated_at = NOW();
