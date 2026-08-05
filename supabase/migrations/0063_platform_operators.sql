-- 0063_platform_operators — who at KeyPlayers can run the operator surfaces.
--
-- THE PROBLEM: operator surfaces (Portal Admin, Industry Templates) were gated on
-- requireHq(), meaning membership of the KeyPlayers HQ workspace. In production only two
-- accounts are in it, mitch@ and brayson@. Everyone else — including Olivia, who leads
-- Client Success — has their own separate workspace and is treated exactly like a
-- client. So the tooling built FOR Client Success was unreachable BY Client Success.
--
-- The obvious fix, adding them to the HQ workspace, does not work: there is no workspace
-- switcher, and resolveTenant() follows the JWT tenant claim, so a second membership
-- would not change which workspace they actually land in. It would also hand them the
-- platform engineering surfaces (KeyWatch/Issues, the Security Console), which is a much
-- bigger grant than "can set up a client".
--
-- So: an explicit, small allow-list, keyed by email and independent of which workspace
-- someone happens to sit in.
--
-- DELIBERATELY NOT a role on workspace_members: this is a PLATFORM-level fact about a
-- KeyPlayers employee, not a fact about their relationship to one workspace.
--
-- Two tiers of gate remain, and they are different on purpose:
--   requireHq()       → platform engineering: Issues, Security Console. Unchanged.
--   requireOperator() → running the business: Portal Admin, Industry Templates.
--                       HQ membership OR an entry here.

create table if not exists public.platform_operators (
  email      text primary key,
  note       text,                    -- who they are, so the list stays readable
  created_at timestamptz not null default now()
);

alter table public.platform_operators enable row level security;

-- No policy at all: under RLS the anon/authenticated roles therefore cannot read OR
-- write this table from the browser. The server reads it through the postgres role,
-- which bypasses RLS. An allow-list a client can enumerate is a worse allow-list.

-- Seed with the two people Mitch named. Emails are lowercased on both write and read,
-- so a capitalised address can never silently fail to match.
insert into public.platform_operators (email, note) values
  ('mitch@keyplayershq.com',  'Founder & CEO'),
  ('olivia@keyplayershq.com', 'Client Success Lead')
on conflict (email) do nothing;
