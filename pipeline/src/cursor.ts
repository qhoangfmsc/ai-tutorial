import type { Page, Locator } from "playwright";
import type { Action } from "./schema";

export interface Point {
  x: number;
  y: number;
}

/** Shared with the highlight box (see actor.ts) so the cursor visually "belongs" to the same focus cue. */
export const ACCENT_COLOR = "255,59,48";

/** Floor/ceiling on cursor glide duration — actual time scales with travel distance (see cursorMoveDuration). */
const CURSOR_MOVE_MIN_MS = 220;
const CURSOR_MOVE_MAX_MS = 650;

const CURSOR_ID = "__tutorial_cursor__";

/**
 * All three icons below are traced directly from Tabler Icons
 * (github.com/tabler/tabler-icons, MIT license — "pointer", "hand-finger",
 * "cursor-text") rather than hand-drawn, so the shapes themselves are the
 * real, professionally-designed cursor glyphs instead of an approximation.
 * Each is rendered twice on the same path data: a wide white "halo" stroke
 * first, then the original black stroke on top — the only change from the
 * source icons — so the cursor stays legible over dark backgrounds too,
 * matching the rest of this project's overlay elements (highlight box,
 * ripple) which all use the same white-halo/black-line convention.
 *
 * Each `viewBox` is cropped tight to that icon's own path bounding box
 * (plus a small margin so the halo stroke isn't clipped) instead of the
 * source's full 24x24 canvas — the tip/fingertip/beam then sits right at
 * the rendered box's top-left corner, matching this project's "div's
 * top-left corner = target point" cursor-positioning convention.
 */
const ARROW_CURSOR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='2 2 20 20'>` +
      `<path d='M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563' ` +
      `fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/>` +
      `<path d='M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563' ` +
      `fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/>` +
      `</svg>`,
  );

const POINTER_CURSOR_PATHS =
  `<path d='M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5'/>` +
  `<path d='M11 11.5v-2a1.5 1.5 0 1 1 3 0v2.5'/>` +
  `<path d='M14 10.5a1.5 1.5 0 0 1 3 0v1.5'/>` +
  `<path d='M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7a69.74 69.74 0 0 1 -.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47'/>`;
const POINTER_CURSOR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='21' height='24' viewBox='1.52 1 20.48 23'>` +
      `<g fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'>${POINTER_CURSOR_PATHS}</g>` +
      `<g fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${POINTER_CURSOR_PATHS}</g>` +
      `</svg>`,
  );

const TEXT_CURSOR_PATHS =
  `<path d='M10 12h4'/><path d='M9 4a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3'/><path d='M15 4a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3'/>`;
const TEXT_CURSOR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='11' height='22' viewBox='7 2 10 20'>` +
      `<g fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'>${TEXT_CURSOR_PATHS}</g>` +
      `<g fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${TEXT_CURSOR_PATHS}</g>` +
      `</svg>`,
  );

export type CursorKind = "arrow" | "pointer" | "text";
const CURSOR_ASSETS: Record<CursorKind, { svg: string; width: number; height: number }> = {
  arrow: { svg: ARROW_CURSOR_SVG, width: 20, height: 20 },
  pointer: { svg: POINTER_CURSOR_SVG, width: 21, height: 24 },
  text: { svg: TEXT_CURSOR_SVG, width: 11, height: 22 },
};

/** Creates the cursor icon at `pos` if it doesn't exist yet, or snaps it there instantly. */
export async function ensureCursor(page: Page, pos: Point): Promise<void> {
  await page
    .evaluate(
      ({ id, x, y, asset }) => {
        let el = document.getElementById(id) as HTMLDivElement | null;
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          Object.assign(el.style, {
            position: "fixed",
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.5))",
            zIndex: "2147483646",
            pointerEvents: "none",
          });
          document.body.appendChild(el);
        }
        el.style.width = `${asset.width}px`;
        el.style.height = `${asset.height}px`;
        el.style.backgroundImage = `url("${asset.svg}")`;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      },
      { id: CURSOR_ID, x: pos.x, y: pos.y, asset: CURSOR_ASSETS.arrow },
    )
    .catch(() => {
      // Page mid-navigation — the next step will (re-)create the cursor.
    });
}

/** Swaps the cursor overlay's icon to match what a real browser would show hovering there. */
export async function setCursorKind(page: Page, kind: CursorKind): Promise<void> {
  await page
    .evaluate(
      ({ id, asset }) => {
        const el = document.getElementById(id) as HTMLDivElement | null;
        if (!el) return;
        el.style.width = `${asset.width}px`;
        el.style.height = `${asset.height}px`;
        el.style.backgroundImage = `url("${asset.svg}")`;
      },
      { id: CURSOR_ID, asset: CURSOR_ASSETS[kind] },
    )
    .catch(() => {});
}

/**
 * Figures out which cursor icon a real browser would show for `targetLocator`
 * — the same element the overlay cursor is about to land on — by reading its
 * computed CSS `cursor` value. `type` actions skip the CSS check entirely:
 * typing always means a text field, regardless of what the element's own
 * (possibly unset) cursor style says.
 */
export async function detectCursorKind(targetLocator: Locator, action: Action): Promise<CursorKind> {
  if (action.type === "type") return "text";
  const cssCursor = await targetLocator
    .evaluate((el) => getComputedStyle(el as Element).cursor)
    .catch(() => "");
  if (cssCursor === "pointer") return "pointer";
  if (cssCursor === "text") return "text";
  return "arrow";
}

/**
 * How long a cursor glide of `distance` px should take — short hops read as
 * snappy, long cross-screen jumps take a bit longer but sublinearly
 * (roughly Fitts's law), capped so a corner-to-corner move never drags the
 * scene out.
 */
export function cursorMoveDuration(distance: number): number {
  const t = Math.min(1, distance / 900);
  return CURSOR_MOVE_MIN_MS + (CURSOR_MOVE_MAX_MS - CURSOR_MOVE_MIN_MS) * Math.sqrt(t);
}

/**
 * Animates the cursor dot from `from` to `to`, driven by
 * `requestAnimationFrame` against real elapsed time rather than a fixed
 * `setTimeout` step schedule — the latter drifts under event-loop load and
 * reads as micro-stutter on camera, exactly what a "silky" cursor can't
 * afford. Deliberately not a straight-line lerp either: this bows the path
 * slightly off the direct line and settles with a touch of overshoot near
 * arrival, like a real hand — but with no per-frame jitter, since random
 * noise is itself a form of stutter, not a human cue.
 */
export async function moveCursorTo(page: Page, from: Point, to: Point, durationMs: number): Promise<void> {
  await page
    .evaluate(
      // An inline async IIFE with a `while` loop, not a named recursive
      // helper — a named function/arrow bound to an identifier gets wrapped
      // in a `__name(...)` call by the build step, which breaks once
      // Playwright serializes this function's source and re-runs it
      // standalone in the page (the helper it calls doesn't exist there).
      async ({ id, from, to, durationMs }) => {
        const el = document.getElementById(id) as HTMLDivElement | null;
        if (!el) return;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy);

        const arcMax = 24;
        const arc = Math.min(arcMax, distance * 0.1) * (Math.random() < 0.5 ? -1 : 1);
        const nx = distance > 0 ? -dy / distance : 0;
        const ny = distance > 0 ? dx / distance : 0;
        const midX = from.x + dx / 2 + nx * arc;
        const midY = from.y + dy / 2 + ny * arc;

        const start = performance.now();
        let t = 0;
        while (t < 1) {
          const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
          t = Math.min(1, durationMs > 0 ? (now - start) / durationMs : 1);

          // Gentle easeOutBack: a small overshoot past the target before
          // settling, softer than a full bounce so it reads as a smooth
          // arrival rather than a wobble.
          const c1 = 0.28;
          const eased = t >= 1 ? 1 : 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

          const u = 1 - eased;
          const x = u * u * from.x + 2 * u * eased * midX + eased * eased * to.x;
          const y = u * u * from.y + 2 * u * eased * midY + eased * eased * to.y;
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }

        el.style.left = `${to.x}px`;
        el.style.top = `${to.y}px`;
      },
      { id: CURSOR_ID, from, to, durationMs },
    )
    .catch(() => {});
}

/**
 * A bold double-ring pulse at `pos` to mark a click, plus an exaggerated
 * squash-bounce on the cursor icon — deliberately more emphatic than a real
 * click's feedback would be, so every action reads as obvious at a glance
 * rather than blending into the recording.
 */
export async function showClickRipple(page: Page, pos: Point): Promise<void> {
  await page
    .evaluate(
      ({ x, y, cursorId, accent }) => {
        const cursor = document.getElementById(cursorId) as HTMLDivElement | null;
        if (cursor) {
          cursor.style.transformOrigin = "0 0";
          cursor.style.transition = "transform 90ms ease-out";
          cursor.style.transform = "scale(0.65)";
          setTimeout(() => {
            cursor.style.transition = "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)";
            cursor.style.transform = "scale(1.2)";
            setTimeout(() => {
              cursor.style.transition = "transform 140ms ease-out";
              cursor.style.transform = "scale(1)";
            }, 200);
          }, 90);
        }

        // Two concentric rings — a solid inner one and a softer outer one —
        // read as a much bolder "something just happened here" cue than a
        // single thin ring, especially at video-compressed bitrates.
        [
          { size: 14, border: `3px solid rgba(${accent},0.95)`, scale: 4, duration: 550 },
          { size: 14, border: `1.5px solid rgba(${accent},0.5)`, scale: 6, duration: 650 },
        ].forEach(({ size, border, scale, duration }) => {
          const ripple = document.createElement("div");
          Object.assign(ripple.style, {
            position: "fixed",
            left: `${x}px`,
            top: `${y}px`,
            width: `${size}px`,
            height: `${size}px`,
            marginLeft: `${-size / 2}px`,
            marginTop: `${-size / 2}px`,
            borderRadius: "50%",
            border,
            boxShadow: `0 0 10px rgba(${accent},0.4)`,
            zIndex: "2147483645",
            pointerEvents: "none",
            transition: `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
            transform: "scale(1)",
            opacity: "1",
          });
          document.body.appendChild(ripple);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              ripple.style.transform = `scale(${scale})`;
              ripple.style.opacity = "0";
            });
          });
          setTimeout(() => ripple.remove(), duration + 50);
        });
      },
      { x: pos.x, y: pos.y, cursorId: CURSOR_ID, accent: ACCENT_COLOR },
    )
    .catch(() => {});
}
