"use client";

import { useEffect, useRef, useState } from "react";

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
