'use client';

// Last-resort boundary for errors thrown in the root layout itself (it replaces
// the whole document, so it must render its own <html>/<body>). Prevents the bare
// "Application error: a client-side exception has occurred" white screen.
import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || 'Global render error',
      stack: error.stack ?? null,
      level: 'fatal',
      context: { digest: error.digest ?? null, boundary: 'global' },
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#0b0b0c', color: '#e5e5e5' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, opacity: 0.7, maxWidth: 420 }}>
            The dashboard hit an unexpected error. This is usually temporary.
          </p>
          <button
            onClick={reset}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
