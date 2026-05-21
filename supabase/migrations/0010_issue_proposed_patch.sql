-- 0010_issue_proposed_patch
-- Store the Fixer's proposed patch as structured files so an "Approve" action
-- can open the PR deterministically (commit exactly these files) without
-- re-running the LLM. Shape: jsonb array of { path, new_content }.
alter table public.issues add column if not exists proposed_patch jsonb;
