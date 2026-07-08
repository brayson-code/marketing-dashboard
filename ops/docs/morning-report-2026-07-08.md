# Morning Report — Tue, July 8, 2026

Written for you overnight. You're closing Bobby's Landscaping ($7k, done-for-you). Everything below is aimed at getting that call closed and the account actually working on day one.

---

## 1. TL;DR — the 5 things that matter

1. **Two things will make Bobby's account DEAD on day one unless you act.** His agents can't run without an Anthropic key, and 9 of his 16 agents can't run without Jobber keys. Both are yours to set — no engineer can do it. See your action list.
2. **There's a critical chat bug.** If the database hiccups for a second, a client's message in the dashboard chat gets NO reply and nothing tells them why. This is the screen Bobby uses every day. It's #1 on my fix list.
3. **The gap that isn't on anyone's radar:** there is currently **no production path that builds a landscaping-tuned command center for a real paying client.** The tuning exists, but only in a test-only script that refuses to run against the real system. This is the single biggest build gap between now and Bobby being live.
4. **The closing artifact (the preview page prospects see) looks like a build log, not a $7k proposal** — it shows a "Test" badge, raw slugs, and provisioning logs on the same page as your payment buttons. Fixing this is the highest closing-impact UI work.
5. **Overnight I shipped a lot:** the test environment is live and fixed up, onboarding now pre-fills client info (and I killed a data-wipe bug), and the industry-specific widget boards for construction/landscaping are building now.

---

## 2. YOUR action list (only you can do these)

These are keys, apps, and decisions. No engineer can do them for you. Ranked by what blocks the deal.

### A1. Decide the Anthropic key model — BLOCKING, do this first
Without it, every one of Bobby's agents is inert. A Rhode Island landscaper won't create an Anthropic account. Your choice:
- **(a) Recommended for speed:** Get one Anthropic API key for Bobby, paste it into his workspace at onboarding. Works today, zero build.
- **(b) Cleaner long-term:** We build a managed/metered key path so you sponsor it centrally. Needs a small build first (a day or two).
- **Decision needed:** (a) or (b). If you want to close this week, pick (a).

### A2. Create the Jobber app + give me the keys — BLOCKING for all Jobber value
9 of Bobby's 16 agents need this. Steps:
1. Go to **developer.getjobber.com**, register a new app.
2. Set the redirect URI to **exactly** `https://command.keyplayershq.com/api/integrations/jobber/callback` (byte-for-byte, no trailing slash).
3. Copy the **Client ID** and **Client Secret**.
4. Send both to me, or paste them into the Vercel production project as `JOBBER_CLIENT_ID` and `JOBBER_CLIENT_SECRET`.

### A3. Get me a live Jobber account to test against — BLOCKING for Jobber data
Our Jobber field names are marked "verify against a real account." A wrong name makes Jobber reject the whole request. Steps:
1. Have Bobby (or a Jobber sandbox) connect his account once through the dashboard.
2. Tell me it's connected — I'll run each tool once and lock the field names. ~15 min on your side.

### A4. Confirm the production domain / APP_URL
Confirm we're locked to **command.keyplayershq.com** in the production Vercel project. A2's redirect URI and the client invite links both depend on this being right. If it's already set, just reply "confirmed."

### A5. One decision for call-ingestion (see section 6)
Where do the recordings come from? Just answer: **upload/paste, email-drop, or auto-pull from Zoom/Meet.** My recommendation is in section 6.

---

## 3. Confirmed bugs I should fix next (ranked)

1. **CRITICAL — Chat can silently swallow a client's message.** *(src/app/api/boardroom/ask/route.ts)* If the database blips for even a second at the start of a chat turn, the client's message is saved but they get **no reply and no error they can understand** — on the exact screen they use daily. The "I hit a snag" safety net that's supposed to catch this doesn't fire on this path. **Client impact: Bobby types a question, gets nothing back, thinks the product is broken.** I'll wrap the call so it always returns a graceful reply.

2. **MAJOR — Publishing an Instagram Reel can time out and create a duplicate.** *(src/app/api/drafts/route.ts)* Reel publishing can take up to 3.5 minutes, but this route has no extended time limit, so Vercel kills it early. The draft never gets marked "published," so a retry can post the **same Reel twice.** **Client impact: double-posted Reels, embarrassing on a client's real IG.** Fix is a one-line time-limit override plus not double-publishing on retry.

3. **MINOR — Stuck cron jobs show "running" forever.** *(src/lib/cron-runner.ts)* If a scheduled job gets killed by the hourly time cap, the dashboard shows it stuck on "running" with no self-heal. **Client impact: Bobby sees a scheduled task that looks frozen.** Fix: a janitor that resets stuck jobs.

4. **MINOR — Silent failures in CRM.** *(src/app/crm/page.tsx)* Dragging a lead card or clicking "Done" on a task fails silently if the network hiccups — no toast, no message. **Client impact: Bobby moves a lead, it snaps back, he has no idea why.**

5. **COSMETIC — Em-dash rendering.** *(src/app/content/page.tsx)* A couple of spots literally print `&mdash;` instead of "—". Small but visible on first load with real content. Cheap to fix, worth it before a demo.

---

## 4. KeyCommand UI/UX — top improvements (ranked by closing-impact)

The reason it feels like "an ugly questionnaire and toggle board": three different tools are wearing one plain internal-admin skin, and the one prospects see (the preview page) looks like a status page, not a proposal.

1. **Split the prospect view from your operator view on the preview page.** Today the closing artifact shows the "Test" badge, raw industry slugs, and a provisioning log **on the same page as your Approve / Simulate payment / Stripe buttons.** If a rep screen-shares or emails that link, the prospect sees internal machinery. Hide operator controls behind an "Operator tools" toggle, collapsed by default. **This is the single biggest risk to "would a prospect be impressed."**
2. **Live "time reclaimed" ticker on the intake form itself.** The hours-saved number is the whole emotional sell — and right now it only appears *after* submit, when the prospect has stopped watching. Put a running total at the top that climbs as the rep sorts tasks during the call. Small build, big live moment.
3. **A persistent nav bar across the app.** Right now there's no header at all — every page is an island, you navigate by browser back button. A thin top bar (Home / New intake / Command Centers) removes daily friction for whoever runs deals.
4. **Searchable industry picker.** 22 industries in an unsorted native dropdown — finding "Landscaping / Lawn Care" at the bottom is the slowest manual step on a live call. Alphabetize + type-to-filter.
5. **Real brand polish on the preview page.** Logo, one real accent color, a light hero around the hours number. This is the page the $7k hinges on; today it's indistinguishable from an internal status screen.
6. **Field-level inline validation** instead of a top-of-page error list the rep has to scroll up to read.

---

## 5. The deal punch-list (gap analysis)

**Central finding: there are two "provisioning" worlds and only one is the real product.**

- The **keycommand-provisioning** repo (the quiz → Stripe demo) is a *proof that zero-touch is possible.* It's test-only by design and never touches the real product database. **Bobby does not log into this.**
- The **marketing-dashboard** repo is the real command center Bobby uses. But creating a client there stands up a **bare** tenant — no landscaping tuning.

**The gap:** Bobby's actual tuning (his 5 custom agents, genes, company brief, nav views) exists in exactly ONE place — a script called `provision-demo-client.ts` — which is **test-gated** (refuses to run against production), **uncommitted**, and builds a **fake demo owner**, not a real invited client.

> **So today there is no production path that produces a niche-tuned landscaping command center for a real paying client. This is the #1 build gap and it wasn't on the known-state list.**

**The good news:** everything the tuning depends on is real and live in production — genes injection, missions/waves, persistent memory, the onboarding wizard (already reframes to "built for landscaping" when a tenant is pre-tuned), and the Jobber tools are fully registered. **The parts exist; the wiring to assemble them for a real client does not.** That's the build I'd prioritize right after your keys land.

**Punch-list to "Bobby is live":**
- [ ] **You:** Anthropic key decision (A1)
- [ ] **You:** Jobber app + keys (A2)
- [ ] **You:** live Jobber account to verify fields (A3)
- [ ] **You:** confirm APP_URL/domain (A4)
- [ ] **Me:** production provisioning path that tunes a real client for landscaping (the big gap)
- [ ] **Me:** verify Jobber field names on first real connect
- [ ] **Me:** fix the critical chat bug (#1 above) before Bobby is in daily
- [ ] **Website:** forward the inbound quiz to `/api/keymatrix/record` (still todo)

---

## 6. Call-ingestion plan

**What it does:** Bobby's team talks about what they need the command center to do. Instead of someone listening and relaying it to us by hand, you drop the call in — the system transcribes it, has Claude pull out the **decisions, requirements, action items, and who-owns-what**, and files that straight into the two places our agents already read on every run (an Active doc + the knowledge graph), tagged by call and date. Nothing gets typed up manually.

**Why it's small:** it's assembly, not invention. Four pieces already exist and snap together:
- Transcription is already wired (Deepgram `transcribeUrl`, per-tenant key).
- File upload is already wired (the assets upload pattern → Vercel Blob → a URL Deepgram can fetch).
- The extraction pass has a proven, reliable template (the SOP generator — a tool-forced Claude call that never crashes on a bad shape).
- The output already gets read by agents automatically (Active docs + knowledge graph are injected every run).

**Pipeline:** Capture → land it → transcribe → extract → review → file. (Audio is deleted right after transcription — call audio is sensitive and shouldn't linger in public blob storage.)

**My recommendation: build Phase 1 (P1) now** — paste-a-transcript or upload-an-audio-file, transcribe, extract, show you a review screen, then file. It's mostly gluing existing parts together and it delivers the whole value for Bobby immediately. Auto-pull from Zoom/Meet is a nice Phase 2, not needed to close.

**Your one decision:** where do the recordings come from?
- **(a) Upload / paste** — simplest, ready fastest. **← my recommendation for P1**
- **(b) Email-drop** — forward a recording to an address; slightly more setup.
- **(c) Auto-pull from Zoom/Meet** — best experience, most build; do it as Phase 2.

Just reply with a letter.

---

## 7. What shipped while you slept

- **Test environment is live** at `keyplayers-command-center-test.vercel.app` with fixes deployed: settings toggles work, load errors fixed, responsive layout fixed, and Instagram/Facebook upgraded to Graph API v23 (from v19) with real error surfacing so failures are visible instead of silent.
- **Onboarding now pre-fills** the client's info from provisioning — and I found and **fixed a bug that was wiping the business profile** during that prefill.
- **Industry widget boards are building now** (overnight): the Lobsterboard widget board plus industry templates. Construction and landscaping boards correctly hide the content/social widgets a landscaper doesn't need.
- **Inbound quiz bridge + owner approval gate are live in keycommand.** The production quiz is reversed and on version 3, posting to `/api/keymatrix/record`. (Remaining: the website side still needs to forward the quiz to that endpoint.)
- **KeyCommand milestones M0–M5 are done.** M6 is in progress, M7 not started.
- **Jobber integration is committed but dark** — it's in the codebase, waiting on your dev-app keys (A2). Field names need one live verification on the first real connect (A3).

---

*Bottom line: your four key/decision items (A1–A4) are the gate. The moment those land, my priority order is: build the real landscaping provisioning path (the big gap), fix the critical chat bug, verify Jobber fields, and split the prospect view on the preview page. Give me A1–A5 and I'll run.*
