-- 0006_message_attachments
-- Lets KeyPlayer "see" images: stores attachments on a boardroom message, from
-- both inbound MMS (LoopMessage) and boardroom uploads/pastes. The orchestrator
-- passes these to Claude as vision content blocks.
-- Shape: jsonb array of { url, type, storage_path?, name? }.
alter table public.boardroom_messages add column if not exists attachments jsonb;
