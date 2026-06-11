# Hyperframes

**Hyperframes** turns a one-line brief into a short-form video **script + storyboard** — broken down scene by scene, with on-screen text, visuals, and audio — that you can review, lay out, and **render to a finished video** without leaving the app.

![the Hyperframes hub with the generator and a storyboard open](images/hyperframes-1.png)

---

## What it is

Hyperframes is a tab in the **Content** hub. You give it a brief; an agent writes a 9:16 short-form script and lays it out as a storyboard — a hook, a timeline of scenes, and a call to action — plus production notes and any claims worth double-checking. Every storyboard is saved, editable, and lives alongside your reel scripts.

> You can lay out each scene visually in the built-in **scene editor** — drag on-screen text onto a live 9:16 frame, set backgrounds and b-roll from your own **clip library**, add word-by-word **captions**, and tune timing — then hit **Render** to produce the finished video in-app via HeyGen. No round-trip to another tool.

## Why it matters

A script is a wall of text; a storyboard tells you what to put on screen, *when*. Hyperframes closes the gap between "here's the idea" and "here's the shot list," so the video is ready to produce without a separate planning pass.

---

## The layout

- **Generate (top).** A brief box with a **platform** and **length** picker, and a **Generate** button.
- **Left column — your storyboards.** Every storyboard you've generated, newest first, with its platform and who created it. Click one to open it. Reel scripts created from [Ideas](./content-lab.md) or [Competitors](./competitors.md) show up here too.
- **Right column — the storyboard.** The selected storyboard rendered as scene cards, with controls to copy, edit, open the **scene editor**, and open HeyGen.

---

## How to use it

### Generate a storyboard

1. In the **Generate a storyboard** box, type your brief — what the video is about. Hook-first and punchy works best (e.g. *"3 mistakes new founders make hiring their first sales rep"*).
2. Pick a **platform** — Reels, TikTok, or YT Short.
3. Pick a **length** — 15, 30, 45, or 60 seconds.
4. Click **Generate**. The new storyboard opens automatically when it's ready.

### Read the storyboard

A parsed storyboard shows up as cards:

- **Meta chips** — platform, length, and aspect ratio at a glance.
- **Hook** — the opening beat, with its on-screen text, visual, and audio.
- **Scenes** — a numbered timeline. Each scene card gives the **timecode**, the **visual**, the **on-screen text** (in quotes), and the **audio**.
- **CTA** — the closing call to action.
- **Production** — music, pacing, B-roll notes, and a ready-to-paste **Hyperframes prompt** for generative shots.
- **Claims to verify** — any factual claims the agent flagged for you to fact-check before publishing.

If the agent's output doesn't parse into scenes, the card falls back to showing the raw text — you can still read and edit it.

### Edit a storyboard

1. Click **Edit** (top-right of the storyboard).
2. Adjust the source text in the editor.
3. Click **Save** (or the **X** to cancel).

### Lay out scenes in the editor

The **Editor** button (top-right of a storyboard) opens the **visual scene editor** — a 9:16 frame where you position on-screen text, set the background, and tune timing before you render. The first time you open it, the editor seeds itself from your storyboard's scenes; after that it remembers your layout.

The editor has three columns:

- **Left — scene strip.** Every scene as a 9:16 thumbnail, in order. Click one to edit it. The arrows reorder a scene, and the trash icon deletes it. **Add scene** appends a new blank scene to the end.
- **Middle — the frame.** A live 9:16 preview of the selected scene. **Drag any text block** to reposition it; click an empty part of the frame to deselect. The timecode and aspect ratio show underneath.
- **Right — properties.** Settings for whatever's selected:
  - *With nothing selected* — the **scene**: its background (a solid **color**, an **image** / **video (b-roll)** URL, or a clip from your **clip library**), **start** and **end** times in seconds, a **voiceover** line, and a **captions** line (the spoken words, popped on screen word-by-word at the bottom — the signature short-form look). Any visual direction the agent wrote shows here as a hint. Use **Add text** to drop a new text block on the frame.
  - *With a text block selected* — its **content**, **size**, **color**, **alignment**, **weight**, and **width**.

Click **Save** to store the layout on the storyboard. The button reads **Saved** until you make another change.

### Use your clip library

In the scene panel, **Your clips** is your workspace's media library — a-roll and b-roll you've uploaded, shown as 9:16 thumbnails.

- **Upload** adds a video or image from your computer; once it's in, it drops straight onto the current scene's background.
- Click any thumbnail to set it as the selected scene's background.

Clips are stored against your workspace and stay available across every storyboard. It's the same library you manage on the [Media](./media.md) tab — upload there ahead of time and your footage is ready to drop onto any scene.

### Render the video

When the layout looks right, click **Render** (editor top bar). KeyCommand saves the current composition, then produces the video through **HeyGen's** cloud renderer — captions, text, backgrounds, and timing baked in.

- The button shows **Queued…** then **Rendering…** while it works (usually about a minute).
- When it finishes, a **preview** opens automatically — play it inline, **Download** the MP4, or close and come back later. The **Preview** button stays in the top bar so you can reopen a finished render anytime.
- Rendering uses **your** HeyGen connection, so it runs on your account's credits. If HeyGen isn't connected yet, connect it first on the [Connections page](./connections.md).

The **HeyGen** button still opens [HeyGen Hyperframes](https://hyperframes.heygen.com) in a new tab if you'd rather finish there.

### Copy and hand off to HeyGen

- **Copy** grabs the **Hyperframes prompt** when one exists, or the full storyboard otherwise — ready to paste.
- **HeyGen** opens [HeyGen Hyperframes](https://hyperframes.heygen.com) in a new tab, where you produce the actual video.

---

## Tips

- **Keep briefs tight.** One sharp sentence beats a paragraph — the hook drives the whole storyboard.
- **Match length to platform.** 15–30s reads as a punchy reel; 45–60s gives room for a teaching arc.
- **Check the "Claims to verify" box** before you produce — it's there to keep a confident-sounding script from shipping a wrong number.
- **Blocked from generating?** If autonomy is set to a level that blocks new drafts, switch to **Propose** mode in Autonomy settings and try again.
