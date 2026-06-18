"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Whitelist the injection source (security: this hook does `fetch(src) → innerHTML`,
 * so a malicious `src` could serve attacker HTML that runs in the app's origin —
 * DOM-XSS, audit finding #6). Every real caller passes a static, same-origin sprite
 * path (`/sprites/<name>.svg`). We hard-restrict to exactly that shape so the hook
 * can never be pointed at an external URL, a non-SVG asset, or a path-traversal
 * escape, even if a future caller wires `src` from untrusted input.
 *
 * Rules: must be a root-relative path under `/sprites/`, end in `.svg`, contain no
 * `..` traversal, no protocol/scheme, no protocol-relative `//`, and no backslashes.
 */
const SAFE_SVG_SRC = /^\/sprites\/[a-zA-Z0-9._-]+\.svg(?:\?[a-zA-Z0-9._=&-]*)?$/;

export function isSafeSpriteSrc(src: string): boolean {
  if (typeof src !== "string") return false;
  if (src.includes("..") || src.includes("\\") || src.startsWith("//")) return false;
  // A scheme (http:, https:, data:, javascript:) means it's not our root-relative path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  return SAFE_SVG_SRC.test(src);
}

/**
 * Fetches a real SVG asset from /public at runtime and injects it into a host
 * <div> via innerHTML, then hands back the live root <svg> element so callers
 * can query the injected DOM nodes (the article's exact element IDs / frame
 * groups) and drive them with GSAP.
 *
 * Why runtime fetch + inject instead of importing the markup?
 *   - The frame SVGs are large (gym ~57KB, flag ~54KB). Fetching keeps them out
 *     of the JS bundle and lets the browser cache them like any other asset.
 *   - innerHTML injection preserves the baked-in ids + data-svg-origin exactly
 *     as authored, which the GSAP timelines rely on.
 *
 * Returns:
 *   hostRef  — attach to the container <div>
 *   svg      — the injected <svg> element once ready (null until injected)
 *   ready    — convenience boolean
 *   error    — fetch/parse failure message, if any
 */
export function useInjectedSvg(src: string) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    // Reset prior injection state when `src` changes mid-life so consumers
    // rebuild against the new asset. (Intentional sync reset on src change.)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSvg(null);
    setError(null);

    // SECURITY GATE: refuse to fetch+inject anything that isn't a known same-origin
    // sprite. We inject the response via innerHTML, so an off-whitelist src is a
    // potential DOM-XSS sink (audit finding #6). Bail before any network call.
    if (!isSafeSpriteSrc(src)) {
      setError("Refused to inject SVG from a non-whitelisted source");
      if (process.env.NODE_ENV !== "production") {
        console.error(`[useInjectedSvg] blocked non-sprite src: ${String(src)}`);
      }
      return;
    }

    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((markup) => {
        if (cancelled) return;
        // Inject raw markup; the SVG keeps its authored viewBox + class so it
        // scales responsively inside the host. We make it fill the host width.
        host.innerHTML = markup;
        const el = host.querySelector("svg") as SVGSVGElement | null;
        if (!el) {
          setError("No <svg> root found in fetched markup");
          return;
        }
        // Normalize sizing: let the host control the box, SVG fills it.
        el.removeAttribute("width");
        el.removeAttribute("height");
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.display = "block";
        el.style.overflow = "visible";
        setSvg(el);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      // `host` is captured at effect start (stable for the component's life),
      // so it's safe to clear here without re-reading the ref.
      host.innerHTML = "";
    };
  }, [src]);

  return { hostRef, svg, ready: !!svg, error };
}
