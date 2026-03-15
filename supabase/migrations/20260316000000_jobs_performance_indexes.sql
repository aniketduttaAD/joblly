-- Composite index for list/paginate: WHERE owner_id = ? ORDER BY applied_at DESC
CREATE INDEX IF NOT EXISTS jobs_owner_id_applied_at_idx
  ON public.jobs (owner_id, applied_at DESC);

-- Composite index for search with status: WHERE owner_id = ? AND status = ? ORDER BY applied_at DESC
CREATE INDEX IF NOT EXISTS jobs_owner_id_status_applied_at_idx
  ON public.jobs (owner_id, status, applied_at DESC);
