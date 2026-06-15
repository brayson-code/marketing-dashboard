-- Dual messaging providers (Twilio SMS + LoopMessage iMessage).
--
-- Tag every sms_messages row with the channel it travelled over so the unified
-- inbox can show both, and the auto-router can detect iMessage-capable contacts
-- from history ("have we ever received an iMessage from this number?").
--
-- Existing rows + Twilio inserts default to 'sms', so this is backward-compatible.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';

-- Supports the auto-router's iMessage-capability lookup and inbox channel badges.
CREATE INDEX IF NOT EXISTS sms_messages_channel_idx
  ON public.sms_messages (tenant_id, channel, direction, from_number);
