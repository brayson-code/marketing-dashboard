import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
  // Prevent Next.js from inferring a parent workspace root from monorepo traversal, which
  // changes the standalone output path layout and breaks systemd start paths.
  outputFileTracingRoot: path.join(__dirname),
  // The orchestrator + sub-agent prompt files (agents/**/{soul,agent,skills}.md)
  // are read from disk at runtime via process.cwd()-relative paths, so Next's
  // static file tracing can't discover them — on Vercel they'd be missing from
  // the function bundle and the reads would silently return empty prompts. Force
  // them into every API function (spawns + the Agent Studio editor fallback).
  outputFileTracingIncludes: {
    '/api/**/*': ['./agents/**/*'],
  },
  // Baseline security headers (the safe set — addresses the common DAST/ZAP-baseline
  // "missing security header" findings). HSTS is already added by Vercel. CSP is
  // deliberately NOT set here yet: a strict policy needs testing against Next's
  // inline scripts + Supabase/Vercel origins so it doesn't break the app.
  async headers() {
    // First-pass CSP: deliberately NON-BREAKING. It enforces the high-value, low-risk
    // directives (default-src self, object-src none, frame-ancestors/base-uri/form-action
    // self) while staying permissive on script/style/frame/connect (https: + 'unsafe-inline'
    // /'unsafe-eval') so Next's inline hydration, Supabase (incl. realtime wss), and the
    // in-app reel embeds keep working. TODO: tighten to a nonce-based strict script-src.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
