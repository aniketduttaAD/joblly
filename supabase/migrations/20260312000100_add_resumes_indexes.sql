

CREATE INDEX IF NOT EXISTS resumes_owner_updated_at_idx
  ON public.resumes (owner_id, updated_at DESC);

