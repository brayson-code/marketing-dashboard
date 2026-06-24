'use client';

import { useState } from 'react';
import Link from 'next/link';

function ResetPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Anti-enumeration: even a network error shows the same neutral confirmation —
      // we never reveal whether the email exists or whether sending succeeded.
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--foreground)] bg-[var(--muted)] px-3 py-3 rounded-lg leading-relaxed">
          If an account exists for that email, a reset link is on its way.
        </p>
        <Link
          href="/login"
          className="block text-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          autoComplete="email"
          autoFocus
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? 'Sending...' : 'Send reset link'}
      </button>

      <Link
        href="/login"
        className="block text-center text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
      >
        Back to sign in
      </Link>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm p-8 rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kp-logo.png" alt="KeyPlayers" width={56} height={56} className="mx-auto mb-4 w-14 h-14 object-contain" />
          {/* Inline type styles mirror the login card: Geist at a calmer weight/size
              reads cleaner here than the heavy global .text-h1 (Sora 600). */}
          <h1
            className="text-[var(--foreground)]"
            style={{ fontFamily: 'var(--font-geist), system-ui, sans-serif', fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.012em' }}
          >
            Reset your password
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">
            Enter your email and we’ll send you a reset link.
          </p>
        </div>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
