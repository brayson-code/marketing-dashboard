'use client';

// Mounts global browser error hooks once and forwards everything to KeyWatch.
// Catches errors React's boundaries miss: async/event-handler throws and
// unhandled promise rejections.
import { useEffect } from 'react';
import { reportClientError } from '@/lib/report-client-error';

export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError({
        message: event.message || event.error?.message || 'Uncaught error',
        stack: event.error?.stack ?? null,
        context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportClientError({
        message: reason?.message || String(reason) || 'Unhandled promise rejection',
        stack: reason?.stack ?? null,
        context: { kind: 'unhandledrejection' },
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
