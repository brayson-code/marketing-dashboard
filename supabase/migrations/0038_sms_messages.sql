-- SMS history (Twilio) — inbound + outbound, kept OUT of boardroom_messages so it
-- surfaces in the Engagement inbox, not the Boardroom. Also backs the per-day
-- outbound send limit (count today's direction='out' rows). RLS mirrors the
-- standard tenant policy; the backend postgres role bypasses it and scopes by
-- tenantId() in app code.

create table if not exists public.sms_messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  direction text not null check (direction in ('in','out')),
  message_sid text,
  from_number text,
  to_number text,
  body text,
  status text,
  created_at timestamptz not null default now()
);
create index if not exists sms_messages_tenant_created_idx on public.sms_messages (tenant_id, created_at desc);
create index if not exists sms_messages_tenant_dir_created_idx on public.sms_messages (tenant_id, direction, created_at desc);

alter table public.sms_messages enable row level security;
drop policy if exists sms_messages_rw on public.sms_messages;
create policy sms_messages_rw on public.sms_messages for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
