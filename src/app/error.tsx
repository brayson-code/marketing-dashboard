'use client';

// Route-level error boundary: contains a thrown client error to this page
// (keeping the app shell intact) and offers a retry instead of white-screening.
import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[route error]', error);
    reportClientError({
      message: error.message || 'Route render error',
      stack: error.stack ?? null,
      context: { digest: error.digest ?? null, boundary: 'route' },
    });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">Something went wrong loading this page</h2>
      <p className="text-sm text-[var(--muted-foreground)] max-w-md">
        A data request failed. This is usually temporary — try again.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
