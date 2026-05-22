-- 0012_issue_revalidation
-- "Is this still a problem?" — store the latest re-validation verdict on an issue.
-- A re-validation re-runs the Fixer's diagnostic reasoning against the CURRENT
-- repo to judge (a) whether the original error still applies and (b) whether a
-- previously proposed patch still applies cleanly. Read-only; no repo writes.

alter table public.issues
  add column if not exists revalidated_at timestamptz,
  add column if not exists revalidation   jsonb;
