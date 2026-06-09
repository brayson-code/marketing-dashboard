import type { Composition, CompositionScene } from './hyperframes-composition';

// Turn our structured composition (what the visual editor produces) into a
// Hyperframes HTML composition that HeyGen's cloud renderer accepts. Format
// learned from `hyperframes init`: a #root with data-duration/width/height, and
// .clip divs with data-start/data-duration (seconds) positioned via inline CSS;
// a paused GSAP timeline in window.__timelines["main"] drives entrance animation
// (the renderer scrubs it frame by frame). Pure + dependency-free.

const FRAME = { '9:16': { w: 1080, h: 1920 } } as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const sec = (ms: number) => Math.max(0, ms / 1000);

function backgroundClip(scene: CompositionScene, start: number, dur: number, W: number, H: number): string {
  const bg = scene.background;
  const base = `class="clip" data-start="${start}" data-duration="${dur}" data-track-index="0" style="left:0;top:0;width:${W}px;height:${H}px;z-index:0;`;
  if (bg.type === 'image' && bg.value) {
    return `<div ${base}overflow:hidden"><img src="${esc(bg.value)}" style="width:100%;height:100%;object-fit:cover" /></div>`;
  }
  if (bg.type === 'video' && bg.value) {
    return `<div ${base}overflow:hidden"><video src="${esc(bg.value)}" autoplay muted loop playsinline style="width:100%;height:100%;object-fit:cover"></video></div>`;
  }
  return `<div ${base}background:${esc(bg.value || '#0B0B0F')}"></div>`;
}

export function compositionToHtml(comp: Composition): string {
  const { w: W, h: H } = FRAME['9:16']; // editor is 9:16-only today
  const total = comp.scenes.length ? Math.max(...comp.scenes.map((s) => sec(s.endMs))) : 1;

  const clips: string[] = [];
  const tweens: string[] = [];

  comp.scenes.forEach((scene) => {
    const start = sec(scene.startMs);
    const dur = Math.max(0.1, sec(scene.endMs) - start);
    clips.push(backgroundClip(scene, start, dur, W, H));

    scene.layers.forEach((l) => {
      if (l.type !== 'text') return;
      clips.push(
        `<div id="${esc(l.id)}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="1" ` +
        `style="left:${l.xPct}%;top:${l.yPct}%;transform:translate(-50%,-50%);width:${l.widthPct}%;z-index:1;` +
        `font-size:${l.fontSize}px;color:${esc(l.color)};text-align:${l.align};font-weight:${l.weight};` +
        `line-height:1.12;text-shadow:0 2px 12px rgba(0,0,0,.45);white-space:pre-wrap">${esc(l.text)}</div>`,
      );
      // Gentle entrance so text doesn't just pop in. Positioned at the scene's start.
      tweens.push(`tl.from("#${cssEsc(l.id)}", { opacity: 0, y: -40, duration: 0.5 }, ${start});`);
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
