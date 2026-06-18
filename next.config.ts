import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // better-sqlite3 + impit are native (.node) modules — keep them external so Next
  // doesn't try to bundle the binary; they're required from node_modules at runtime.
  serverExternalPackages: ['better-sqlite3', 'impit'],
  // Prevent Next.js from inferring a parent workspace root from monorepo traversal, which
  // changes the standalone output path layout and breaks systemd start paths.
  outputFileTracingRoot: path.join(__dirname),
  // The orchestrator + sub-agent prompt files (agents/**/{soul,agent,skills}.md)
  // are read from disk at runtime via process.cwd()-relative paths, so Next's
  // static file tracing can't discover them — on Vercel they'd be missing from
  // the function bundle and the reads would silently return empty prompts. Force
  // them into every API function (spawns + the Agent Studio editor fallback).
  outputFileTracingIncludes: {
    // agents/** → spawn prompts. docs/** → the in-app Help assistant (/api/help)
    // reads the public docs at runtime to ground its answers, so they must be
    // traced into the function bundle (same reason as agents/**).
    // impit's platform binding (linux-x64-gnu on Vercel) is resolved via a dynamic
    // platform-specific require that nft can't follow — force the .node into the
    // bundle. The glob is a no-op locally on Windows (that binding isn't installed).
    '/api/**/*': ['./agents/**/*', './docs/**/*', './node_modules/impit-linux-x64-gnu/**/*'],
  },
  // Baseline security headers (the safe set — addresses the common DAST/ZAP-baseline
  // "missing security header" findings). HSTS is already added by Vercel. CSP is
  // deliberately NOT set here yet: a strict policy needs testing against Next's
  // inline scripts + Supabase/Vercel origins so it doesn't break the app.
  async headers() {
    // Static baseline headers only. The Content-Security-Policy is NONCE-BASED and
    // therefore set PER-REQUEST in the middleware (src/lib/supabase/middleware.ts) —
    // it can't live here because the nonce changes every request. HSTS is added by Vercel.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
