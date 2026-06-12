/**
 * scripts/loadtest/hot-paths.k6.js
 *
 * LOAD-TEST ARTIFACT — DO NOT RUN AGAINST PRODUCTION.
 *
 * k6 load-test script targeting the hot read paths of the Command Center.
 * Uses whatever BASE_URL is configured — point it at a preview/staging deploy
 * or localhost, NEVER at prod with real tenant data.
 *
 * NO-SPEND GUARANTEE:
 *   This script calls read-only GET endpoints only. No POST/PUT/DELETE routes
 *   are exercised, so no agent tasks are spawned and no Claude API calls are made.
 *   Even if a synthetic tenant somehow ended up with a cron job, read endpoints
 *   do not trigger them — the cron dispatcher only runs on POST /api/cron/dispatch.
 *
 * ── Prerequisites ──────────────────────────────────────────────────────────────
 * 1. Install k6 as a standalone binary (NOT via npm):
 *      macOS:  brew install k6
 *      Linux:  https://k6.io/docs/get-started/installation/
 *      Windows: winget install k6 --source winget
 *
 * 2. Get a valid session cookie:
 *    a. Open the app in a browser (BASE_URL).
 *    b. Open DevTools → Application → Cookies.
 *    c. Copy the value of the `sb-<ref>-auth-token` cookie (Supabase JWT).
 *       It will look like a long base64-encoded JSON string.
 *    d. Pass it as the SESSION_COOKIE env var (see run command below).
 *    NOTE: The cookie encodes the Supabase access token. It expires; re-grab
 *    it if you see widespread 401s in your k6 output.
 *
 * ── Run commands ───────────────────────────────────────────────────────────────
 *   # Against local dev server:
 *   BASE_URL=http://localhost:3000 \
 *   SESSION_COOKIE="sb-zgtiviorskkcuzxnpvha-auth-token=<value>" \
 *   k6 run scripts/loadtest/hot-paths.k6.js
 *
 *   # Against a Vercel preview deploy:
 *   BASE_URL=https://marketing-dashboard-<hash>.vercel.app \
 *   SESSION_COOKIE="sb-zgtiviorskkcuzxnpvha-auth-token=<value>" \
 *   k6 run scripts/loadtest/hot-paths.k6.js
 *
 *   # With HTML report (k6 >= 0.46):
 *   k6 run --out json=results.json scripts/loadtest/hot-paths.k6.js
 *
 * ── WARNING ────────────────────────────────────────────────────────────────────
 *   DO NOT run this against the production deploy (https://app.keyplayers.co or
 *   whatever the prod alias is). It WILL spike the Supabase pooler connections and
 *   may saturate the free-plan RLS evaluator. Use a preview or local instance only.
 */

// k6 built-ins — these are NOT Node.js imports.
// eslint-disable-next-line import/no-unresolved
import http from 'k6/http';
// eslint-disable-next-line import/no-unresolved
import { check, sleep } from 'k6';
// eslint-disable-next-line import/no-unresolved
import { Trend, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SESSION_COOKIE = __ENV.SESSION_COOKIE || '';

if (!SESSION_COOKIE) {
  console.warn(
    '[warn] SESSION_COOKIE is not set. All requests will hit the unauthenticated path ' +
    'and most endpoints will return 401/403. See the header comment for how to get a cookie.',
  );
}

// ── Custom metrics (one Trend per endpoint for clear p95 breakdown) ───────────

const trendHome    = new Trend('p95_home',    true);
const trendAgents  = new Trend('p95_squad',   true);
const trendKg      = new Trend('p95_kg',      true);
const trendCron    = new Trend('p95_cron',    true);
const trendUsage   = new Trend('p95_usage',   true);
const trendMissions= new Trend('p95_missions',true);

const errorRate = new Rate('custom_error_rate');

// ── k6 options (stages + global thresholds) ───────────────────────────────────

export const options = {
  stages: [
    { duration: '30s', target: 10  },  // warm-up: 0 → 10 VUs
    { duration: '60s', target: 50  },  // ramp:    10 → 50 VUs
    { duration: '90s', target: 100 },  // peak:    50 → 100 VUs
    { duration: '60s', target: 100 },  // soak:    hold 100 VUs
    { duration: '30s', target: 0   },  // cool-down
  ],
  thresholds: {
    // Overall p95 across all requests must be under 800ms.
    http_req_duration: ['p(95)<800'],
    // Less than 1% of requests should fail (non-2xx or network error).
    http_req_failed: ['rate<0.01'],
    // Per-endpoint p95s (informational — do not gate the run).
    p95_home:     ['p(95)<800'],
    p95_squad:    ['p(95)<800'],
    p95_kg:       ['p(95)<800'],
    p95_cron:     ['p(95)<800'],
    p95_usage:    ['p(95)<800'],
    p95_missions: ['p(95)<800'],
  },
};

// ── Shared request params ──────────────────────────────────────────────────────

function makeParams(tag) {
  return {
    headers: {
      Cookie: SESSION_COOKIE,
      Accept: 'application/json',
    },
    tags: { endpoint: tag },
  };
}

// ── VU scenario ───────────────────────────────────────────────────────────────

export default function () {
  // Each VU runs a rotation of all hot paths in one "think-time" cycle.
  // The 100-VU peak simulates a realistic burst of concurrent dashboard users.

  // ── GET / (app shell) ──────────────────────────────────────────────────────
  {
    const res = http.get(`${BASE_URL}/`, makeParams('home'));
    const ok = check(res, {
      'home: status 200 or 307': (r) => r.status === 200 || r.status === 307,
    });
    trendHome.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // ── GET /api/squad — agent list ────────────────────────────────────────────
  {
    const res = http.get(`${BASE_URL}/api/squad`, makeParams('squad'));
    const ok = check(res, {
      'squad: status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    trendAgents.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // ── GET /api/kg — knowledge graph entities ─────────────────────────────────
  {
    const res = http.get(`${BASE_URL}/api/kg`, makeParams('kg'));
    const ok = check(res, {
      'kg: status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    trendKg.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // ── GET /api/cron/jobs — cron job list ─────────────────────────────────────
  // NOTE: This hits the read endpoint for listing cron jobs, NOT the dispatch
  // endpoint (/api/cron/dispatch). The dispatcher requires a Vercel cron secret
  // and would trigger agent runs — we intentionally target the read-only jobs list.
  {
    const res = http.get(`${BASE_URL}/api/cron/jobs`, makeParams('cron'));
    const ok = check(res, {
      'cron/jobs: status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    trendCron.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // ── GET /api/usage — token / spend usage ──────────────────────────────────
  {
    const res = http.get(`${BASE_URL}/api/usage`, makeParams('usage'));
    const ok = check(res, {
      'usage: status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    trendUsage.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // ── GET /api/missions — wave run list ─────────────────────────────────────
  {
    const res = http.get(`${BASE_URL}/api/missions`, makeParams('missions'));
    const ok = check(res, {
      'missions: status 2xx': (r) => r.status >= 200 && r.status < 300,
    });
    trendMissions.add(res.timings.duration);
    errorRate.add(!ok);
    sleep(0.1);
  }

  // Think time between full cycles — simulates a user pausing between navigations.
  sleep(0.5);
}
