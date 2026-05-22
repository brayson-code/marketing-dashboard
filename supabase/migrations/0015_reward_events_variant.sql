-- 0015_reward_events_variant — record which constraint VARIANT a scored run used,
-- so reward events are fully attributed (the agent_policy aggregate is already
-- variant-keyed; this adds it to the raw event log for audit + the Learning view).
alter table public.reward_events add column if not exists variant text not null default 'base';
