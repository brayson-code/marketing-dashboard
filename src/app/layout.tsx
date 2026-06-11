import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { LayoutContent } from "@/components/layout/layout-content";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { ErrorReporter } from "@/components/error-reporter";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Display font for headlines — the "Liquid Glass Command" headline face.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "KeyPlayers Dashboard",
  description: "Executive command center for agency operations",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The middleware (src/lib/supabase/middleware.ts) mints a per-request CSP nonce
  // and forwards it on the x-nonce request header. Read it here so next-themes can
  // stamp it onto its inline flash-prevention <script> — otherwise the strict CSP
  // blocks that script. Reading headers() opts the layout into dynamic rendering,
  // which is expected (and already true) for this per-request, auth-gated app.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} ${sora.variable} antialiased`}>
        <ThemeProvider nonce={nonce}>
          <ErrorReporter />
          <LayoutContent>{children}</LayoutContent>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
