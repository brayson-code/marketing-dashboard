import { randomBytes } from 'node:crypto';
import { sql, jsonb, DEFAULT_TENANT_ID } from '@/lib/db/client';

export type CronTemplate = {
  id: string;
  name: string;
  description: string | null;
  job_json: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export type CronTemplateRow = Pick<CronTemplate, 'id' | 'name' | 'description' | 'job_json' | 'updated_at_ms'>;

const MAX_NAME = 80;
const MAX_DESC = 240;
const MAX_JOB_JSON_BYTES = 128 * 1024;

// Raw row from postgres.js. `job_json` is jsonb (comes back parsed); timestamps
// are timestamptz (Date objects). We re-serialize/convert to the legacy contract.
interface RawTemplateRow {
  id: string;
  name: string;
  description: string | null;
  job_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toMs(v: Date | string): number {
  return new Date(v).getTime();
}

// Re-serialize jsonb back to the indented-string contract callers expect.
function jobToString(job: unknown): string {
  return JSON.stringify(job, null, 2);
}

function normalizeName(value: unknown): string | null {
  const name = String(value ?? '').trim();
  if (!name) return null;
  if (name.length > MAX_NAME) return null;
  return name;
}

function normalizeDescription(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > MAX_DESC) return null;
  return v;
}

function normalizeId(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > 128) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(v)) return null;
  return v;
}

function validateJobJson(job: unknown): string {
  // Store the exact JSON the user provides, but enforce it's valid and bounded.
  const json = JSON.stringify(job, null, 2);
  const bytes = Buffer.byteLength(json, 'utf-8');
  if (bytes > MAX_JOB_JSON_BYTES) {
    throw new Error('Template job JSON too large');
  }
  if (!job || typeof job !== 'object') {
    throw new Error('Template job must be an object');
  }
  return json;
}

function isUniqueViolation(e: unknown): boolean {
  const msg = String(e);
  // Postgres unique_violation = 23505; also catch the textual hint.
  return msg.includes('23505') || msg.includes('UNIQUE') || msg.includes('unique');
}

function newTemplateId(): string {
  return `tmpl_${randomBytes(6).toString('hex')}`;
}

export async function listCronTemplates(limit = 50): Promise<CronTemplateRow[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await sql()`
    SELECT id, name, description, job_json, updated_at
    FROM cron_templates
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY updated_at DESC
    LIMIT ${n}
  ` as unknown as RawTemplateRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    job_json: jobToString(r.job_json),
    updated_at_ms: toMs(r.updated_at),
  }));
}

export async function createCronTemplate(input: { name: unknown; description?: unknown; job: unknown }): Promise<CronTemplate> {
  const name = normalizeName(input.name);
  if (!name) throw new Error(`Invalid name (max ${MAX_NAME} chars)`);
  const description = normalizeDescription(input.description);
  const job_json = validateJobJson(input.job);

  const now = Date.now();
  const id = newTemplateId();
  try {
    await sql()`
      INSERT INTO cron_templates (tenant_id, id, name, description, job_json, created_at, updated_at)
      VALUES (
        ${DEFAULT_TENANT_ID}, ${id}, ${name}, ${description},
        ${jsonb(input.job)}, now(), now()
      )
    `;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('Template name already exists');
    throw e;
  }

  return {
    id,
    name,
    description,
    job_json,
    created_at_ms: now,
    updated_at_ms: now,
  };
}

export async function updateCronTemplate(input: { id: unknown; name?: unknown; description?: unknown; job?: unknown }): Promise<CronTemplate> {
  const id = normalizeId(input.id);
  if (!id) throw new Error('Invalid id');

  const s = sql();
  const existingRows = await s`
    SELECT id, name, description, job_json, created_at, updated_at
    FROM cron_templates
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  ` as unknown as RawTemplateRow[];
  const existing = existingRows[0];
  if (!existing) throw new Error('Not found');

  const name = input.name === undefined ? existing.name : normalizeName(input.name);
  if (!name) throw new Error(`Invalid name (max ${MAX_NAME} chars)`);
  const description = input.description === undefined ? existing.description : normalizeDescription(input.description);
  // Validate when provided; carry the existing jsonb forward otherwise.
  const job_json = input.job === undefined ? jobToString(existing.job_json) : validateJobJson(input.job);
  const jobValue = input.job === undefined ? existing.job_json : input.job;
  const now = Date.now();

  try {
    await s`
      UPDATE cron_templates
      SET name = ${name}, description = ${description}, job_json = ${jsonb(jobValue)}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
    `;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error('Template name already exists');
    throw e;
  }

  return {
    id: existing.id,
    name,
    description,
    job_json,
    created_at_ms: toMs(existing.created_at),
    updated_at_ms: now,
  };
}

export async function deleteCronTemplate(idInput: unknown): Promise<void> {
  const id = normalizeId(idInput);
  if (!id) throw new Error('Invalid id');
  const result = await sql()`
    DELETE FROM cron_templates
    WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
  if (result.count === 0) throw new Error('Not found');
}

