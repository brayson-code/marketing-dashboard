'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Where an invited client lands from their one-time recovery link. The Supabase
// browser client auto-detects the session from the link's URL fragment
// (detectSessionInUrl) and fires PASSWORD_RECOVERY, so by the time this renders they
// hold a recovery session — which lets them set a FIRST password without a current
// one (works even with "Secure password change" on). After that they log in normally
// with email + password.
export default function SetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let done = false;
    supabase.auth.getSession().then(({ data }) => {
      if (done) return;
      setHasSession(!!data.session);
      setChecking(false);
    });
    // The fragment may be processed slightly after mount — catch the SIGNED_IN event.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
      setChecking(false);
    });
    return () => { done = true; sub.subscription.unsubscribe(); };
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) { setError(updErr.message || 'Could not set password'); return; }
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [password, confirm, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-sm p-8 rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-lg font-semibold">K</div>
          <h1 className="text-h1 text-[var(--foreground)]">Set your password</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">Choose a password to finish setting up your account.</p>
        </div>

        {checking ? (
          <p className="text-sm text-center text-[var(--muted-foreground)]">Verifying your invite&hellip;</p>
        ) : !hasSession ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-[var(--destructive)]">This invite link is invalid or has expired.</p>
            <p className="text-xs text-[var(--muted-foreground)]">Ask your administrator to send you a fresh invite link.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="pw" className="block text-sm font-medium mb-1.5">New password</label>
              <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                autoComplete="new-password" autoFocus required minLength={8} />
            </div>
            <div>
              <label htmlFor="pw2" className="block text-sm font-medium mb-1.5">Confirm password</label>
              <input id="pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                autoComplete="new-password" required minLength={8} />
            </div>
            {error && <p className="text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={busy}
              className="w-full py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {busy ? 'Saving…' : 'Set password & continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
