-- Treat all resumes as usable: default is_verified to true and backfill existing rows.
ALTER TABLE public.resumes
  ALTER COLUMN is_verified SET DEFAULT true;

UPDATE public.resumes
  SET is_verified = true
  WHERE is_verified = false;
