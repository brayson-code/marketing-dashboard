'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

// `nonce` is threaded from RootLayout (read off the x-nonce request header the
// middleware sets) so next-themes can stamp it onto the inline flash-prevention
// <script> it injects into <head>. Without it, the strict nonce-based CSP
// ('strict-dynamic', no 'unsafe-inline') blocks that script → a theme flash on
// every load. next-themes only applies the nonce during SSR (its own guard).
export function ThemeProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="light" enableSystem={false} nonce={nonce}>
      {children}
    </NextThemeProvider>
  );
}
