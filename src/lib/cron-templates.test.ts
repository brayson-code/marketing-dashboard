import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCronTemplate, deleteCronTemplate, listCronTemplates, updateCronTemplate } from './cron-templates';

// NOTE: cron_templates is now Supabase-backed (tenant-scoped). This test exercises
// the create/list/update/delete flow against the live DB; it requires SUPABASE_DB_URL
// (run via `node --import tsx --env-file=.env.local`). It cleans up after itself.
test('cron templates create/list/update/delete', async () => {
  const uniqueName = `Morning research ${Date.now()}`;
  const created = await createCronTemplate({
    name: uniqueName,
    description: 'Template for research crons',
    job: { id: 'x', agentId: 'hermes', schedule: { expr: '0 9 * * 1-5' }, payload: { kind: 'agentTurn', message: 'hi' } },
  });
  assert.ok(created.id);
  assert.equal(created.name, uniqueName);

  const list1 = await listCronTemplates(200);
  assert.ok(list1.some((t) => t.name === uniqueName));

  const updated = await updateCronTemplate({
    id: created.id,
    name: `${uniqueName} v2`,
    job: { id: 'y', agentId: 'hermes', payload: { kind: 'agentTurn', message: 'hello' } },
  });
  assert.equal(updated.name, `${uniqueName} v2`);
  assert.match(updated.job_json, /"message": "hello"/);

  await deleteCronTemplate(created.id);
  const list2 = await listCronTemplates(200);
  assert.ok(!list2.some((t) => t.id === created.id));
});
