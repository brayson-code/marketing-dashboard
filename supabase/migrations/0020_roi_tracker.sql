-- Time-saved + ROI tracker (KeyCommand V2, Track A). Single-tenant for now
-- (tenant_id = DEFAULT_TENANT_ID, same pattern as the rest of the app). Additive
-- only — revert with: DROP TABLE time_savings_log; DROP TABLE key_audit;

CREATE TABLE IF NOT EXISTS public.key_audit (
  tenant_id        uuid PRIMARY KEY,
  annual_revenue   numeric,
  annual_profit    numeric,
  hours_per_week   numeric,
  admin_percentage numeric,
  presets          jsonb,   -- { "<action_type>": <minutes_saved> }
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.time_savings_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid NOT NULL,
  agent_id           text,
  action_type        text NOT NULL,
  minutes_saved      numeric NOT NULL,
  dollar_value_saved numeric NOT NULL DEFAULT 0,
  source             text,
  task_id            bigint,
  logged_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_time_savings_log_tenant
  ON public.time_savings_log (tenant_id, logged_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_savings_task
  ON public.time_savings_log (tenant_id, task_id) WHERE task_id IS NOT NULL;
