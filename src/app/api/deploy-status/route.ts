import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Cloud deploy status. The legacy version shelled out to systemctl/pgrep/openclaw
// on a VPS; on Vercel there's no service/lockfile/openclaw binary, so we report
// the managed deployment state from Vercel's build env. Shape is kept compatible
// with the old endpoint so the /deploy page renders unchanged.
export async function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  const env = process.env.VERCEL_ENV ?? 'production';
  return NextResponse.json({
    instance: 'default',
    service: { name: 'keyplayers-command-center', state: 'active' },
    deploy: { script_path: null, lock_file: null, lock_exists: false, running_pids: [] },
    openclaw: { bin: null, config_validate: { available: false, ok: true } },
    latest_log: null,
    vercel: {
      env,
      sha,
      short_sha: sha ? sha.slice(0, 7) : null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      url: process.env.VERCEL_URL ?? null,
    },
  });
}
