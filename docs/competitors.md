# Competitor Reel Intel

**Competitor Reel Intel** lets you watch your competitors' Instagram Reels inside KeyCommand and get an agent's breakdown of *why each reel won* — the hook, the structure, the phrases that made it land — then turn the winners into your own scripts.

![the Competitors page with a reel being analyzed on the live board](images/competitors-1.png)

---

## What it is

You give KeyCommand a list of competitor Instagram handles (or just paste a single reel link). It scrapes their reels, pulls the real metrics (views, the caption, the spoken-word subtitle track), and hands each reel to a **reel analyst** agent that writes up why it performed. Results land in a grid with metrics, colored tags, a "Why it won" teardown, and a one-click way to generate your own adapted script.

## Why it matters

The fastest way to make content that works is to understand what's *already* working in your niche — not by guessing, but by systematically breaking down the reels that won. This turns competitor research from a manual, hours-long slog into a daily automatic feed.

> **About the data:** KeyCommand stores only the reel's transcript, caption, and metrics, and links to or embeds the original video — it never re-hosts competitors' videos.

---

## Before you start: connect Apify

Competitor Reel Intel needs an **Apify** API token to fetch reels. Connect it once on the [Connections page](./connections.md) (it's a free signup on apify.com, paste the token, save). **Deepgram** is optional — it transcribes a reel's audio when the reel has no on-screen subtitle track, giving the analyst a richer teardown.

---

## The page, section by section

The Competitors page has three stacked sections:

### 1. Watchlist
The competitor handles you track on a schedule.

### 2. Analyze reels
A box to paste one or more reel links and tear them down on demand.

### 3. Reels grid
Every reel you've scraped or analyzed, with metrics, tags, and the teardown.

Plus a **Live Analysis Board** that appears in the middle whenever reels are actively being processed, so you can watch them move through the pipeline in real time.

---

## How to use it

### Add a competitor to your watchlist

1. In the **Watchlist** box, type a competitor's Instagram handle (with or without the `@`).
2. Choose a cadence: **Daily**, **Weekly**, or **Paused**.
3. Click **Add**.

KeyCommand will automatically check that handle on the cadence you chose and pull in their new top reels. To change a competitor's cadence or pause them later, use the dropdown next to their name. The trash icon stops watching them.

![the Watchlist with a few competitor handles added](images/competitors-2.png)

**Turn on the daily watch in one click.** If you haven't set up the scheduled sweep yet, a banner at the top offers a one-click button to seed the **daily watchlist** job. Click it and your watchlist starts running automatically every day. (Under the hood this creates a scheduled job — see [Cron](./cron.md).)

### Analyze a reel on demand

1. In the **Analyze reels** box, paste an Instagram reel link (it looks like `https://www.instagram.com/reel/…`).
2. To analyze several at once, click **Add URL** and paste more (up to 10), or **Import list** to load a `.csv`/`.txt` of links — you can also just paste a whole list of links into one field and it'll split them out.
3. Optionally check:
   - **Also write a script** — generate an adapted script for you alongside the teardown.
   - **Deep analyze** — add live-trend research using web search. It's slower and costs more, so it's off by default; the standard pass is a single fast, cheap analysis.
4. Click **Analyze**.

The reels appear on the **Live Analysis Board** as they process, then settle into the grid below.

![the Analyze reels box with a link pasted and "Also write a script" checked](images/competitors-3.png)

### Watch the Live Analysis Board

When reels are in flight, the live board shows each one advancing through stages:

- **Scrape** — pulling the video, caption, subtitles, and metrics.
- **Analyze** — the reel analyst writing the "why it won" teardown.
- **Script** — (if you asked for one) writing your adapted script.

The page polls quickly while anything is live, so you see real-time progress with the agent shown working.

### Read "Why it Won"

Once a reel settles into the **Reels** grid, each card shows:

- The reel **cover** and **view count**.
- Whose reel it is.
- **Colored tags** describing what kind of reel it is (the hook style, format, and so on).
- A **"Why it won"** teardown you can open — the analyst's breakdown of the winning hook, key phrases, and structure.

![a reel card in the grid with tags and the "Why it won" teardown open](images/competitors-4.png)

### Turn a winner into your script

On any reel card, use **Generate script** to have KeyCommand write a script adapted to *your* brand based on that reel's winning angle. The script lands in your drafts and shows up in [Script Studio](./script-studio.md), where you can edit it and read it off the teleprompter.

### Re-analyze a reel

If a reel's cover image has expired or you want a fresh teardown (for example after you've tuned the analyst), click **Re-analyze** on the card. It does a fresh scrape and a fresh breakdown, refreshing the cover and tags.

### Run the watch now

Don't want to wait for the daily schedule? Click **Run watch now** in the Reels section to immediately sweep every due competitor and analyze their newest reels.

---

## The daily watch (automation)

Once you've added competitors and seeded the watch job, KeyCommand sweeps your watchlist on its schedule (daily by default) and quietly adds new reels and teardowns to your grid — so you have a fresh competitive feed every morning without lifting a finger. You can adjust or pause the schedule per-competitor in the watchlist, or manage the underlying job on the [Cron page](./cron.md).

---

## Tips

- **Start with the watchlist.** Add 5–10 strong competitors on a **daily** cadence and let the feed build over a few days — that's when the patterns become obvious.
- **Use the standard (fast) analysis for volume,** and save **Deep analyze** for the handful of reels you're seriously thinking about copying.
- **Reels with on-screen captions get the best teardowns,** because the subtitle track captures the spoken hook. For caption-less reels, connecting **Deepgram** lets the analyst transcribe the audio for a deeper read.
- **The colored tags are a shortcut.** Glance at the tags across your grid to spot which *kinds* of reels are winning in your niche — then feed that into the [Content Lab](./content-lab.md) Trend Radar.
- **"Generate script" is the payoff.** Don't just admire competitor reels — turn the best ones into your own scripts and record them.
