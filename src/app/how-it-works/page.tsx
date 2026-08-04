'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Compass, MessageSquare, ChevronRight, ChevronDown, ArrowRight,
  BookOpen, Sparkles, CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import {
  FLOW, SECTION_GUIDES, RECIPES, ROLE_LABEL, ROLE_BLURB, type Role,
} from '@/lib/how-it-works';

// "How to use this" — the guide that teaches operation, as opposed to the setup
// walkthrough (src/components/walkthrough), which teaches configuration and retires
// once a workspace is set up.
//
// Deliberately NOT a DOM-anchored click-through tour. A tour that points at real
// elements breaks silently every time the UI moves, and this app is being actively
// redesigned. A self-contained map that explains itself survives that, and it answers
// the question people actually ask — "how does this all fit together?" — which a
// step-by-step tour of individual buttons never does.
//
// Everything is role-aware, because a founder and an assistant use the same section for
// different reasons, and chat-first, because most real use is a group chat rather than
// this app.

const ROLE_KEY = 'how-it-works:role';

export default function HowItWorksPage() {
  const [role, setRole] = useState<Role>('ea');
  const [open, setOpen] = useState<string | null>(null);

  // Persist the role so someone who identified once isn't asked again on every visit.
  useEffect(() => {
    try {
      const v = localStorage.getItem(ROLE_KEY);
      if (v === 'founder' || v === 'ea') setRole(v);
    } catch { /* ignore */ }
  }, []);

  const pickRole = (r: Role) => {
    setRole(r);
    try { localStorage.setItem(ROLE_KEY, r); } catch { /* ignore */ }
  };

  // Group the sections the same way the nav does, so the map matches what's on screen.
  const grouped = SECTION_GUIDES.reduce<Record<string, typeof SECTION_GUIDES[number][]>>((acc, g) => {
    (acc[g.section] ??= []).push(g);
    return acc;
  }, {});

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<Compass size={20} />}
        title="How to use this"
        subtitle="What everything is, who uses it, and what to say to get it done."
      />

      {/* Role switcher — the page rewrites itself around whoever is reading. */}
      <div className="panel p-4 space-y-3">
        <p className="text-xs font-medium">Who are you?</p>
        <div className="flex flex-wrap gap-2">
          {(['founder', 'ea'] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => pickRole(r)}
              className={`btn btn-sm ${role === r ? 'btn-primary' : 'btn-ghost'}`}
            >
              {role === r && <CheckCircle2 size={13} />} {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <p className="text-small">{ROLE_BLURB[role]}</p>
      </div>

      {/* The single most important idea, stated before anything else. */}
      <div
        className="panel p-4 flex items-start gap-3"
        style={{
          background: 'color-mix(in srgb, var(--primary) 7%, transparent)',
          borderColor: 'color-mix(in srgb, var(--primary) 28%, transparent)',
        }}
      >
        <MessageSquare size={18} className="text-[var(--primary)] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">Most of the time, you won&apos;t be in here.</p>
          <p className="text-small">
            KeyCommand is mainly used through a group chat — iMessage or Telegram — with KeyPlayer,
            your orchestrator. You text it like you&apos;d text a person. This app is where you set
            things up, decide things, and see what happened.
          </p>
          <p className="text-xs text-muted-foreground pt-1">
            Not connected yet? <Link href="/agents/comms" className="underline">Set up Messages</Link> first.
          </p>
        </div>
      </div>

      {/* The core loop. */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">How the whole thing works</h2>
        <div className="space-y-2">
          {FLOW.map((f) => (
            <div key={f.step} className="panel p-4 flex gap-3">
              <div
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)', color: 'var(--primary)' }}
              >
                {f.step}
              </div>
              <div className="space-y-1.5 min-w-0">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-small">{f.body}</p>
                <p className="text-xs flex items-start gap-1.5">
                  <span className="badge badge-neutral shrink-0">{ROLE_LABEL[role]}</span>
                  <span className="text-muted-foreground">{role === 'founder' ? f.founder : f.ea}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Start-here recipes for whoever is reading. */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">
          Start here &mdash; three things a {ROLE_LABEL[role]} should be able to do today
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {RECIPES[role].map((r) => (
            <div key={r.title} className="panel p-4 space-y-2">
              <p className="text-sm font-medium flex items-start gap-1.5">
                <Sparkles size={13} className="text-[var(--primary)] shrink-0 mt-0.5" />
                {r.title}
              </p>
              <ol className="space-y-1.5">
                {r.steps.map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-2">
                    <span className="text-[var(--primary)] font-semibold shrink-0">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {/* The map — click anything to see what it is, who uses it and what to say. */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Every section, and what connects to what</h2>
        <p className="text-small">Click any section to see what it does and what you&apos;d say to use it.</p>
        {Object.entries(grouped).map(([section, items]) => (
          <div key={section} className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase pt-2">
              {section}
            </p>
            {items.map((g) => {
              const isOpen = open === g.href;
              return (
                <div key={g.href} className="panel overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : g.href)}
                    className="w-full p-3 flex items-center gap-2 text-left"
                    aria-expanded={isOpen}
                  >
                    {isOpen
                      ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                      : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                    <span className="text-sm font-medium flex-1 min-w-0">{g.label}</span>
                    {g.say && !isOpen && (
                      <span className="hidden sm:inline text-[11px] text-muted-foreground truncate max-w-[45%]">
                        {g.say}
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-3 pl-9 space-y-2.5">
                      <p className="text-small">{g.what}</p>

                      <p className="text-xs flex items-start gap-1.5">
                        <span className="badge badge-neutral shrink-0">{ROLE_LABEL[role]}</span>
                        <span className="text-muted-foreground">{role === 'founder' ? g.founder : g.ea}</span>
                      </p>

                      {g.say && (
                        <div
                          className="rounded-lg p-2.5 text-xs flex items-start gap-2"
                          style={{ background: 'var(--surface-2)' }}
                        >
                          <MessageSquare size={12} className="text-[var(--primary)] shrink-0 mt-0.5" />
                          <span>
                            <span className="text-muted-foreground">Say this in the group chat: </span>
                            <span className="font-medium">{g.say}</span>
                          </span>
                        </div>
                      )}

                      {g.feeds && g.feeds.length > 0 && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <ArrowRight size={11} className="shrink-0" />
                          <span>Feeds</span>
                          {g.feeds.map((f) => (
                            <span key={f} className="badge badge-neutral">{f}</span>
                          ))}
                        </p>
                      )}

                      <Link href={g.href} className="btn btn-ghost btn-sm">
                        Open {g.label} <ArrowRight size={12} />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="panel p-4 flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Want the detail?</p>
          <p className="text-small">Full documentation covers every screen in depth.</p>
        </div>
        <Link href="/docs" className="btn btn-ghost btn-sm shrink-0">
          <BookOpen size={13} /> Open the docs
        </Link>
      </div>
    </div>
  );
}
