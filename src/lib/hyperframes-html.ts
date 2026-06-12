import {
  DEFAULT_ACCENT, normalizeComposition,
  type BrollOverlay, type Composition, type CompositionScene, type Infographic, type SceneTransition,
} from './hyperframes-composition';

// Turn our structured composition (what the visual editor produces) into a
// Hyperframes HTML composition that HeyGen's cloud renderer accepts. Format
// learned from `hyperframes init`: a #root with data-duration/width/height, and
// .clip divs with data-start/data-duration (seconds) positioned via inline CSS;
// a paused GSAP timeline in window.__timelines["main"] drives entrance animation
// (the renderer scrubs it frame by frame). Pure + dependency-free.
//
// Rich format (phase 2): scene transitions (punch_in/whip/pop), punch-in beats,
// b-roll overlays (full-bleed cutaway / inset PiP), stat/list/bar infographics,
// and caption presets (boxed/highlight). Every rich feature is opt-in — a
// composition without the new fields emits byte-identical HTML to before.

const FRAME = { '9:16': { w: 1080, h: 1920 } } as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const sec = (ms: number) => Math.max(0, ms / 1000);
// Keep float sums readable in the emitted JS (0.30000000000000004 → 0.3).
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Overlays carry a bare URL (the background has an explicit type) — sniff
// images by extension; everything else renders as video. Video elements use the
// same attribute set as the per-scene video background (autoplay muted loop
// playsinline inside a timed .clip), which is the mechanism the Hyperframes
// renderer already syncs to the paused timeline frame-by-frame.
const IMG_URL = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
function mediaEl(src: string): string {
  return IMG_URL.test(src)
    ? `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:cover" />`
    : `<video src="${esc(src)}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover"></video>`;
}

// `idAttr`/`group` are '' for plain scenes so legacy output is unchanged; they
// only appear when a scene uses punch beats (bg id) or a transition (group class).
function backgroundClip(scene: CompositionScene, start: number, dur: number, W: number, H: number, idAttr: string, group: string): string {
  const bg = scene.background;
  const base = `${idAttr}class="clip${group}" data-start="${start}" data-duration="${dur}" data-track-index="0" style="left:0;top:0;width:${W}px;height:${H}px;z-index:0;`;
  if (bg.type === 'image' && bg.value) {
    return `<div ${base}overflow:hidden"><img src="${esc(bg.value)}" style="width:100%;height:100%;object-fit:cover" /></div>`;
  }
  if (bg.type === 'video' && bg.value) {
    return `<div ${base}overflow:hidden"><video src="${esc(bg.value)}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover"></video></div>`;
  }
  return `<div ${base}background:${esc(bg.value || '#0B0B0F')}"></div>`;
}

// Scene-entrance tweens applied to every clip in the scene's group class.
// Durations 0.1–0.3s — snappy, never floaty.
function transitionTweens(t: SceneTransition, sel: string, start: number): string[] {
  if (t === 'punch_in') {
    return [
      `tl.fromTo("${sel}", { scale: 1 }, { scale: 1.08, duration: 0.1, ease: "power2.out" }, ${start});`,
      `tl.to("${sel}", { scale: 1, duration: 0.2, ease: "power2.out" }, ${r3(start + 0.1)});`,
    ];
  }
  if (t === 'whip') {
    return [`tl.from("${sel}", { x: 140, filter: "blur(16px)", duration: 0.22, ease: "power3.out" }, ${start});`];
  }
  // pop — slight undershoot with an overshooting settle.
  return [`tl.from("${sel}", { scale: 0.92, duration: 0.28, ease: "back.out(2.4)" }, ${start});`];
}

// One infographic → a positioned .clip (same coordinate system as text layers).
// Bold/minimal: accent number/check/fill, white labels, the body Inter stack.
function infographicClip(g: Infographic, id: string, start: number, dur: number, accent: string): string {
  const base =
    `<div id="${esc(id)}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="1" ` +
    `style="left:${g.xPct}%;top:${g.yPct}%;transform:translate(-50%,-50%);width:${g.widthPct}%;z-index:1;`;
  const shadow = 'text-shadow:0 2px 12px rgba(0,0,0,.5)';
  if (g.kind === 'stat') {
    return base + 'text-align:center">' +
      `<div style="font-size:150px;font-weight:800;line-height:1;color:${esc(accent)};${shadow}">${esc(g.data.value)}</div>` +
      (g.data.label ? `<div style="font-size:44px;font-weight:600;margin-top:10px;color:#FFFFFF;${shadow}">${esc(g.data.label)}</div>` : '') +
      '</div>';
  }
  if (g.kind === 'list') {
    const rows = g.data.items.map((item, i) =>
      `<div id="${esc(id)}-i${i}" style="display:flex;align-items:center;gap:18px;margin:14px 0;font-size:50px;font-weight:700;color:#FFFFFF;${shadow}">` +
      `<span style="color:${esc(accent)};font-weight:800">&#10003;</span><span>${esc(item)}</span></div>`,
    ).join('');
    return base + `text-align:left">${rows}</div>`;
  }
  const capLine = g.data.caption
    ? `<div style="font-size:32px;font-weight:600;margin-top:10px;color:rgba(255,255,255,.78);${shadow}">${esc(g.data.caption)}</div>`
    : '';
  return base + 'text-align:left">' +
    `<div style="font-size:42px;font-weight:700;margin-bottom:12px;color:#FFFFFF;${shadow}">${esc(g.data.label)}</div>` +
    '<div style="width:100%;height:52px;border-radius:26px;background:rgba(255,255,255,.16);overflow:hidden">' +
    `<div id="${esc(id)}-fill" style="width:${g.data.pct}%;height:100%;border-radius:26px;background:${esc(accent)}"></div></div>` +
    capLine + '</div>';
}

function infographicTweens(g: Infographic, id: string, start: number): string[] {
  if (g.kind === 'stat') {
    return [`tl.from("#${cssEsc(id)}", { scale: 0.6, opacity: 0, duration: 0.35, ease: "back.out(2)" }, ${start});`];
  }
  if (g.kind === 'list') {
    return g.data.items.map((_, i) =>
      `tl.from("#${cssEsc(id)}-i${i}", { opacity: 0, x: -36, duration: 0.3, ease: "power3.out" }, ${r3(start + i * 0.16)});`);
  }
  return [
    `tl.from("#${cssEsc(id)}", { opacity: 0, y: 24, duration: 0.3, ease: "power3.out" }, ${start});`,
    `tl.from("#${cssEsc(id)}-fill", { width: 0, duration: 0.5, ease: "power3.out" }, ${r3(start + 0.05)});`,
  ];
}

// One b-roll overlay → a timed .clip within its scene. full = cutaway directly
// over the background (text/captions stay on top, hard cut like a real splice);
// inset = rounded PiP, ~62% width, top- or bottom-anchored, with a quick pop.
function overlayClip(ov: BrollOverlay, sceneId: string, k: number, start: number, dur: number, W: number, H: number): { html: string; tweens: string[] } {
  if (ov.frame === 'inset') {
    const id = `${sceneId}-ov${k}`;
    const w = Math.round(W * 0.62);
    const h = Math.round((w * 9) / 16);
    const top = ov.anchor === 'bottom' ? Math.round(H * 0.52) : Math.round(H * 0.07);
    return {
      html:
        `<div id="${esc(id)}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="1" ` +
        `style="left:50%;top:${top}px;transform:translateX(-50%);width:${w}px;height:${h}px;z-index:1;overflow:hidden;` +
        `border-radius:28px;box-shadow:0 12px 40px rgba(0,0,0,.45)">${mediaEl(ov.src)}</div>`,
      tweens: [`tl.from("#${cssEsc(id)}", { scale: 0.9, opacity: 0, duration: 0.25, ease: "back.out(1.8)" }, ${start});`],
    };
  }
  return {
    html:
      `<div class="clip" data-start="${start}" data-duration="${dur}" data-track-index="0" ` +
      `style="left:0;top:0;width:${W}px;height:${H}px;z-index:0;overflow:hidden">${mediaEl(ov.src)}</div>`,
    tweens: [], // full-bleed cutaway is a hard cut — no entrance
  };
}

export function compositionToHtml(input: Composition): string {
  const comp = normalizeComposition(input);
  const { w: W, h: H } = FRAME['9:16']; // editor is 9:16-only today
  const total = comp.scenes.length ? Math.max(...comp.scenes.map((s) => sec(s.endMs))) : 1;

  // Caption styling — defaults reproduce today's band exactly.
  const capStyle = comp.caption_style;
  const capPreset = capStyle?.preset ?? 'classic';
  const accentRaw = capStyle?.accent_color || DEFAULT_ACCENT;
  const accent = /^[#a-zA-Z0-9(),.%\s-]+$/.test(accentRaw) ? accentRaw : DEFAULT_ACCENT; // also embedded in JS — keep it inert
  const capSize = capStyle?.size === 'lg' ? 76 : 62;
  const capCls = capPreset === 'boxed' ? ' cap-boxed' : capPreset === 'highlight' ? ' cap-highlight' : '';
  const presetCss =
    capPreset === 'boxed'
      ? '\n      .cap-boxed .cw { background: rgba(0,0,0,.68); padding: .05em .22em; border-radius: 14px; }'
      : capPreset === 'highlight'
        ? '\n      .cap-highlight .cw { padding: .04em .18em; border-radius: 14px; }'
        : '';

  const clips: string[] = [];
  const tweens: string[] = [];

  comp.scenes.forEach((scene) => {
    const start = sec(scene.startMs);
    const dur = Math.max(0.1, sec(scene.endMs) - start);
    const transition = scene.transition_in ?? 'cut';
    const punches = (scene.punches ?? []).filter((p) => p < dur);
    // Group/ids only appear when a scene uses a rich feature, so legacy
    // compositions emit byte-identical HTML.
    const group = transition !== 'cut' ? ` sc-${esc(scene.id)}` : '';
    const bgId = punches.length ? `${scene.id}-bg` : '';
    clips.push(backgroundClip(scene, start, dur, W, H, bgId ? `id="${esc(bgId)}" ` : '', group));

    // B-roll overlays — emitted right after the background so a full-bleed
    // cutaway covers it while text/infographics/captions stay on top.
    (scene.overlays ?? []).forEach((ov, k) => {
      if (ov.start >= dur) return;
      const oStart = r3(start + ov.start);
      const oDur = r3(Math.max(0.1, Math.min(ov.duration, dur - ov.start)));
      const o = overlayClip(ov, scene.id, k + 1, oStart, oDur, W, H);
      clips.push(o.html);
      tweens.push(...o.tweens);
    });

    scene.layers.forEach((l) => {
      if (l.type !== 'text') return;
      clips.push(
        `<div id="${esc(l.id)}" class="clip${group}" data-start="${start}" data-duration="${dur}" data-track-index="1" ` +
        `style="left:${l.xPct}%;top:${l.yPct}%;transform:translate(-50%,-50%);width:${l.widthPct}%;z-index:1;` +
        `font-size:${l.fontSize}px;color:${esc(l.color)};text-align:${l.align};font-weight:${l.weight};` +
        `line-height:1.12;text-shadow:0 2px 12px rgba(0,0,0,.45);white-space:pre-wrap">${esc(l.text)}</div>`,
      );
      // Gentle entrance so text doesn't just pop in. Positioned at the scene's start.
      tweens.push(`tl.from("#${cssEsc(l.id)}", { opacity: 0, y: -40, duration: 0.5 }, ${start});`);
    });

    // Infographics — positioned like text layers, animated in (~0.3–0.5s, ease-out).
    (scene.infographics ?? []).forEach((g, k) => {
      if (g.start >= dur) return;
      const gId = g.id || `${scene.id}-ig${k + 1}`;
      const gStart = r3(start + g.start);
      const gDur = r3(Math.max(0.1, Math.min(g.duration ?? dur - g.start, dur - g.start)));
      clips.push(infographicClip(g, gId, gStart, gDur, accent));
      tweens.push(...infographicTweens(g, gId, gStart));
    });

    // Caption track — the spoken words as a bottom karaoke band, popped in
    // word-by-word across the scene (the signature short-form caption look).
    if (scene.caption && scene.caption.trim()) {
      const words = scene.caption.trim().split(/\s+/);
      const capId = `${scene.id}-cap`;
      const spans = words.map((w, i) => `<span class="cw" id="${capId}-${i}">${esc(w)}</span>`).join(' ');
      clips.push(
        `<div class="clip cap${capCls}${group}" data-start="${start}" data-duration="${dur}" data-track-index="2" ` +
        `style="left:50%;top:80%;transform:translate(-50%,-50%);width:88%;z-index:2;text-align:center;` +
        `font-size:${capSize}px;font-weight:800;color:#fff;line-height:1.18">${spans}</div>`,
      );
      const per = Math.min(0.18, (dur * 0.6) / Math.max(1, words.length));
      words.forEach((_, i) => {
        const at = (start + i * per).toFixed(2);
        tweens.push(`tl.from("#${cssEsc(`${capId}-${i}`)}", { opacity: 0, y: 18, scale: 0.9, duration: 0.22 }, ${at});`);
        // highlight preset: the popping word gets an accent pill, released when
        // the next word pops (the last word keeps it through the scene).
        if (capPreset === 'highlight') {
          tweens.push(`tl.to("#${cssEsc(`${capId}-${i}`)}", { backgroundColor: "${accent}", color: "#111111", duration: 0.12 }, ${at});`);
          if (i < words.length - 1) {
            tweens.push(`tl.to("#${cssEsc(`${capId}-${i}`)}", { backgroundColor: "rgba(0,0,0,0)", color: "#FFFFFF", duration: 0.15 }, ${(start + (i + 1) * per).toFixed(2)});`);
          }
        }
      });
    }

    // Scene transition — tween every clip in the scene's group at its cut.
    if (transition !== 'cut') tweens.push(...transitionTweens(transition, `.sc-${scene.id}`, start));

    // Punch-in beats — bump the background ~6% with a fast settle (the fast-cut
    // feel without changing scenes).
    punches.forEach((p) => {
      const at = r3(start + p);
      tweens.push(`tl.fromTo("#${cssEsc(bgId)}", { scale: 1 }, { scale: 1.06, duration: 0.09, ease: "power2.out" }, ${at});`);
      tweens.push(`tl.to("#${cssEsc(bgId)}", { scale: 1, duration: 0.18, ease: "power2.out" }, ${r3(at + 0.09)});`);
    });
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0B0B0F; }
      body { font-family: "Inter", system-ui, sans-serif; }
      .clip { position: absolute; }
      .cap { text-shadow: 0 2px 10px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.9); }
      .cw { display: inline-block; margin: 0 .12em; }${presetCss}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
${clips.map((c) => '      ' + c).join('\n')}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tweens.map((t) => '      ' + t).join('\n')}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

// CSS.escape isn't available in Node; ids we generate are [A-Za-z0-9-], and a
// leading digit in an id would break a "#id" selector — escape that one case.
function cssEsc(id: string): string {
  return /^\d/.test(id) ? `\\3${id[0]} ${id.slice(1)}` : id;
}
