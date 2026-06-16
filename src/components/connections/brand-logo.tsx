'use client';

import { useId, type JSX } from 'react';
import { Plug } from 'lucide-react';

/**
 * BrandLogo — inline-SVG brand marks for the social + API-key providers we connect to.
 *
 * Why inline: keeps tiles offline-friendly (no CDN fetch / CSP exemption), avoids a
 * react-icons-style dependency, and lets us control color + size per usage. Where a
 * brand has an official Simple Icons (MIT-licensed) mark we transcribe its path
 * (anthropic, openai, gmail, googlecalendar, googleanalytics, plus the social marks);
 * for products with no canonical mark (agentmail, loopmessage, plausible, hyperframes)
 * we draw a clean purpose-built glyph in the brand color. Unknown providers fall back
 * to a generic plug icon — never crash.
 *
 * Colors match the codebase convention:
 *  - YouTube uses #ff0033 (matches existing YouTube panels in src/components/analytics)
 *  - X and OpenAI are monochrome via currentColor so they adapt to light/dark theme
 */

export interface BrandLogoProps {
  provider: string;
  size?: number;
  className?: string;
}

interface SvgRendererProps {
  size: number;
  className?: string;
  label: string;
}

function YoutubeMark({ size, className, label }: SvgRendererProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#ff0033"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function LinkedinMark({ size, className, label }: SvgRendererProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#0A66C2"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function InstagramMark({ size, className, label }: SvgRendererProps) {
  // Per-instance gradient id (useId is SSR-safe + collision-free) so multiple
  // InstagramMarks on the same page each resolve their own gradient.
  const rawId = useId();
  const gradientId = `ig-grad-${rawId.replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FCAF45" />
          <stop offset="50%" stopColor="#FD1D1D" />
          <stop offset="100%" stopColor="#833AB4" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"
      />
    </svg>
  );
}

function FacebookMark({ size, className, label }: SvgRendererProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#1877F2"
    >
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function FacebookAdsMark({ size, className, label }: SvgRendererProps) {
  // Facebook mark with a small green "ads" badge in the corner to differentiate from
  // the organic Facebook tile. We render the Facebook glyph into the top-left and a
  // bar-chart badge in the bottom-right of the viewBox.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      <g transform="translate(0,0) scale(0.85)">
        <path
          fill="#1877F2"
          d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
        />
      </g>
      {/* small bar-chart badge */}
      <g transform="translate(14,14)">
        <circle cx="5" cy="5" r="5" fill="#22c55e" />
        <rect x="2.5" y="5" width="1.2" height="2.5" fill="#fff" />
        <rect x="4.4" y="3.5" width="1.2" height="4" fill="#fff" />
        <rect x="6.3" y="2.2" width="1.2" height="5.3" fill="#fff" />
      </g>
    </svg>
  );
}

function XMark({ size, className, label }: SvgRendererProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function TiktokMark({ size, className, label }: SvgRendererProps) {
  // Official TikTok mark with the cyan + magenta offset layers behind the black
  // main glyph. Three copies of the same path, offset slightly via translate.
  const path =
    'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      {/* cyan offset (back-left) */}
      <path d={path} fill="#25F4EE" transform="translate(-1, 1)" />
      {/* magenta offset (back-right) */}
      <path d={path} fill="#FE2C55" transform="translate(1, -1)" />
      {/* main black glyph */}
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function AnthropicMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "anthropic" path. Burnt-orange brand color #D97757.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#D97757"
    >
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5527h3.7442L10.5363 3.541Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

function OpenAiMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "openai" blossom mark. currentColor so it adapts to theme.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="currentColor"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function AgentMailMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built glyph: an envelope with a small "spark" dot top-right, in indigo
  // #6366f1. AgentMail has no canonical Simple Icons mark — this reads as an
  // agent-driven mailbox without faking a real logo.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="none"
      stroke="#6366f1"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
      <circle cx="20" cy="5" r="2.3" fill="#6366f1" stroke="none" />
    </svg>
  );
}

function LoopMessageMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built iMessage-style speech bubble in green #34DA50. LoopMessage sends
  // via iMessage, so the green chat bubble reads true to the product.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#34DA50"
    >
      <path d="M12 2C6.477 2 2 5.91 2 10.732c0 2.74 1.447 5.184 3.71 6.785-.13 1.2-.6 2.49-1.45 3.49-.2.236-.03.6.27.56 1.93-.26 3.49-.93 4.62-1.66.9.19 1.85.29 2.85.29 5.523 0 10-3.91 10-8.732S17.523 2 12 2z" />
    </svg>
  );
}

function GmailMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "gmail" envelope outline rendered in Gmail red #EA4335.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#EA4335"
    >
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function GoogleCalendarMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "googlecalendar" mark, in Google blue #4285F4.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#4285F4"
    >
      <path d="M18 0H6C2.69 0 0 2.69 0 6v12c0 3.31 2.69 6 6 6h12c3.31 0 6-2.69 6-6V6c0-3.31-2.69-6-6-6zM7.06 17.74c-.74 0-1.4-.13-1.98-.39-.58-.26-1.05-.62-1.39-1.07-.34-.46-.53-.97-.55-1.55h1.74c.02.4.21.74.55 1.01.34.27.76.4 1.25.4.54 0 .96-.15 1.27-.45.31-.3.46-.69.46-1.16 0-.5-.18-.9-.53-1.18-.35-.29-.86-.43-1.5-.43h-.74v-1.46h.69c1.16 0 1.74-.39 1.74-1.16 0-.4-.13-.71-.4-.94-.27-.23-.63-.34-1.09-.34-.45 0-.81.12-1.08.37-.27.25-.41.55-.43.92H3.96c.02-.55.2-1.04.53-1.48.33-.43.78-.77 1.33-1.01.55-.24 1.17-.36 1.85-.36.74 0 1.39.13 1.94.39.55.26.97.62 1.27 1.07.3.45.45.96.45 1.51 0 .5-.14.94-.42 1.32-.28.38-.65.66-1.1.84.54.18.97.46 1.27.86.31.4.46.89.46 1.45 0 .58-.16 1.1-.49 1.55-.32.45-.77.81-1.34 1.06-.57.25-1.21.38-1.93.38zm9.42-.18h-1.74V9.42l-1.97 1.27V9.04l1.97-1.27h1.74v9.79z" />
    </svg>
  );
}

function PlausibleMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built bar/pulse mark in Plausible indigo #5850EC — three rising bars
  // with a pulse line, evoking privacy-friendly analytics.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="none"
      stroke="#5850EC"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 13l4-4 4 4 4-7 6 9" />
      <rect x="3" y="15" width="3" height="6" rx="1" fill="#5850EC" stroke="none" />
      <rect x="10.5" y="12" width="3" height="9" rx="1" fill="#5850EC" stroke="none" />
      <rect x="18" y="9" width="3" height="12" rx="1" fill="#5850EC" stroke="none" />
    </svg>
  );
}

function Ga4Mark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "googleanalytics" mark in GA orange #E37400.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="#E37400"
    >
      <path d="M22.84 2.998v17.999a2.983 2.983 0 0 1-2.967 2.998 2.98 2.98 0 0 1-.368-.02 3.06 3.06 0 0 1-2.61-3.1V3.071A3.06 3.06 0 0 1 19.474.02a2.983 2.983 0 0 1 3.367 2.978zM4.133 18.055a2.973 2.973 0 1 0 0 5.945 2.973 2.973 0 0 0 0-5.945zm7.872-9.01h-.05a3.06 3.06 0 0 0-2.892 3.126v7.985c0 2.167.954 3.482 2.35 3.763a2.978 2.978 0 0 0 3.57-2.927v-8.959a2.983 2.983 0 0 0-2.978-2.988z" />
    </svg>
  );
}

function HyperframesMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built play-in-frame glyph in HeyGen/Hyperframes purple #7C3AED —
  // a video frame with a centered play triangle (AI video generation).
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      fill="none"
      stroke="#7C3AED"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <path d="M10 9.2v5.6l4.8-2.8z" fill="#7C3AED" stroke="none" />
    </svg>
  );
}

function GoogleWorkspaceMark({ size, className, label }: SvgRendererProps) {
  // The canonical four-color Google "G" — this single tile now grants ALL of
  // Google (Drive, Docs, Sheets, Gmail, Calendar) off one OAuth connection, so
  // the umbrella Google mark reads truer than any one product's logo. Official
  // Google palette (blue / green / yellow / red).
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      <path fill="#4285F4" d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.01h3.878c2.269-2.09 3.578-5.166 3.578-8.819z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.956-1.075 7.942-2.908l-3.878-3.01c-1.075.72-2.45 1.146-4.064 1.146-3.125 0-5.77-2.112-6.714-4.949H1.276v3.11A11.997 11.997 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.286 14.279A7.213 7.213 0 0 1 4.91 12c0-.79.136-1.558.376-2.279v-3.11H1.276A11.997 11.997 0 0 0 0 12c0 1.936.464 3.769 1.276 5.389l4.01-3.11z" />
      <path fill="#EA4335" d="M12 4.772c1.762 0 3.344.606 4.589 1.795l3.44-3.44C17.951 1.19 15.235 0 12 0A11.997 11.997 0 0 0 1.276 6.611l4.01 3.11C6.23 6.884 8.875 4.772 12 4.772z" />
    </svg>
  );
}

function GeminiMark({ size, className, label }: SvgRendererProps) {
  // Google Gemini four-point spark, in the Gemini blue→purple gradient.
  const rawId = useId();
  const gid = `gem-${rawId.replace(/:/g, '')}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="55%" stopColor="#9b72f2" />
          <stop offset="100%" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gid})`} d="M12 0c.5 5.9 5.6 11 11.5 11.5C17.6 12 12.5 17.1 12 23c-.5-5.9-5.6-11-11.5-11.5C6.4 11 11.5 5.9 12 0z" />
    </svg>
  );
}

function TwilioMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "twilio" — ring with four dots, in Twilio red #F22F46.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={label} fill="#F22F46">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm0 21.6c-5.3 0-9.6-4.3-9.6-9.6S6.7 2.4 12 2.4s9.6 4.3 9.6 9.6-4.3 9.6-9.6 9.6zm5.99-12.81a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0zm0 6.04a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0zm-6.04 0a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0zm0-6.04a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0z" />
    </svg>
  );
}

function TelegramMark({ size, className, label }: SvgRendererProps) {
  // Simple Icons "telegram" paper plane, in Telegram blue #26A5E4.
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={label} fill="#26A5E4">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function ApifyMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built hexagon crawl glyph in Apify green #97D700 (no canonical SI mark).
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={label}>
      <path fill="#97D700" d="M12 1.7l8.93 5.15v10.3L12 22.3l-8.93-5.15V6.85z" />
      <path fill="#1a1a1a" d="M12 6.6l4.2 8.8h-2.05l-.74-1.66H10.6l-.74 1.66H7.8zm0 3.5l-.95 2.13h1.9z" />
    </svg>
  );
}

function DeepgramMark({ size, className, label }: SvgRendererProps) {
  // Purpose-built waveform glyph in Deepgram mint #13EF93 (speech-to-text).
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={label} fill="#13EF93">
      <rect x="3" y="10" width="2.4" height="4" rx="1.2" />
      <rect x="7.2" y="7" width="2.4" height="10" rx="1.2" />
      <rect x="11.4" y="4" width="2.4" height="16" rx="1.2" />
      <rect x="15.6" y="7.5" width="2.4" height="9" rx="1.2" />
      <rect x="19.8" y="10.5" width="2.4" height="3" rx="1.2" />
    </svg>
  );
}

function FallbackMark({ size, className, label }: SvgRendererProps) {
  return <Plug size={size} className={className} aria-label={label} />;
}

const RENDERERS: Record<string, (p: SvgRendererProps) => JSX.Element> = {
  youtube: YoutubeMark,
  linkedin: LinkedinMark,
  instagram: InstagramMark,
  facebook: FacebookMark,
  'facebook-ads': FacebookAdsMark,
  x: XMark,
  tiktok: TiktokMark,
  'google-workspace': GoogleWorkspaceMark,
  // API-key integration providers
  anthropic: AnthropicMark,
  openai: OpenAiMark,
  'google-ai': GeminiMark,
  twilio: TwilioMark,
  telegram: TelegramMark,
  apify: ApifyMark,
  deepgram: DeepgramMark,
  agentmail: AgentMailMark,
  loopmessage: LoopMessageMark,
  gmail: GmailMark,
  google_calendar: GoogleCalendarMark,
  plausible: PlausibleMark,
  ga4: Ga4Mark,
  hyperframes: HyperframesMark,
};

export function BrandLogo({ provider, size = 24, className }: BrandLogoProps): JSX.Element {
  const Renderer = RENDERERS[provider] ?? FallbackMark;
  return <Renderer size={size} className={className} label={`${provider} logo`} />;
}

export default BrandLogo;
