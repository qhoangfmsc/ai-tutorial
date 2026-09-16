import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { chromium, type Page, type Locator, type FrameLocator, type Frame } from "playwright";
import type { Action, Find, TutorialScript } from "./schema";
import { applyAuth, loadStorageState } from "./auth";

/** Expands a leading `~` to the user's home dir; absolute paths pass through unchanged. */
export function expandHome(path: string): string {
  return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

/**
 * Every pacing/animation/timeout duration lives here — tune the overall
 * feel (or how patient network waits are) in one place instead of hunting
 * through each helper for a magic number.
 */
export const TIMING = {
  /** How long the highlight box takes to fade/scale in or out. */
  highlightFadeMs: 300,
  /**
   * Floor on how long the highlight sits fully visible before the action
   * fires — just enough for a viewer to register the target even when the
   * step has no narration at all. The *actual* hold time tracks the
   * step's narration length (see recordScript), so the click lands right
   * as the sentence about it finishes instead of always waiting a fixed
   * amount regardless of how short (or long) that sentence is.
   */
  minHighlightSettleMs: 800,
  /** Floor/ceiling on cursor glide duration — actual time scales with travel distance (see cursorMoveDuration). */
  cursorMoveMinMs: 220,
  cursorMoveMaxMs: 650,
  /** Camera zoom in/out transition. */
  zoomTransitionMs: 500,
  /** `scrollIntoView`/manual-scroll animation. */
  scrollAnimationMs: 600,
  /** Per-character delay while "typing" a URL, before the total-time cap kicks in. */
  urlTypeCharMs: 45,
  /** Hard cap on total URL-typing time regardless of length — a long admin-panel URL shouldn't stretch the scene out. */
  urlTypeMaxMs: 1800,
  /** Pause after typing finishes, like a person pausing before hitting Enter. */
  urlTypeEnterPauseMs: 350,
  /** Loading-bar sweep animation duration — must match the CSS keyframe in `buildWrapperHtml`. */
  loadingBarSweepMs: 550,
  /**
   * Fixed breathing pause after a step's narration *and* action have both
   * finished, before the next step starts — like a person pausing between
   * sentences, not a padded-out minimum scene length.
   */
  stepGapMs: 500,
  /**
   * How long to wait for a target="_blank" popup before assuming there
   * isn't one. This has no early-exit — a click with no popup always pays
   * this in full — so it's kept short: a real popup opens within a few ms
   * of the click, it doesn't need anywhere near a full second of margin.
   */
  popupWaitMs: 400,
  /** How long to wait for a triggered navigation to actually commit before giving up on it. */
  navigationWaitMs: 5000,
  /** How long to wait for a step's target element to appear before giving up on highlighting/acting on it. */
  targetWaitMs: 5000,
  /** How many times to retry a flaky, side-effect-free wait (target lookup, navigation) before failing for real. */
  retryAttempts: 2,
  /** Pause between retry attempts. */
  retryDelayMs: 800,
} as const;

/**
 * Retries a flaky async operation a couple of times with a short delay.
 * Scoped to read-only/idempotent operations (waiting for a target to
 * appear, navigating to a URL) — never wrap a click/type/upload in this,
 * since retrying one that partially succeeded could double-fire a real
 * mutation (double-submit a form, upload twice, ...).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = TIMING.retryAttempts,
  delayMs: number = TIMING.retryDelayMs,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export interface StepTiming {
  caption?: string;
  /** Offset from the start of the recording, in ms, when this step begins. */
  startMs: number;
}

/**
 * A locator root that's either the top-level page (validate.ts drives the
 * real site directly, no wrapper) or a FrameLocator scoped into the
 * `#site-frame` iframe that recordScript nests the target site inside — see
 * the comment above `recordScript` for why.
 */
type LocatorRoot = Page | FrameLocator;

export interface RecordingResult {
  videoPath: string;
  totalDurationMs: number;
  steps: StepTiming[];
}

/**
 * Height (px) reserved for the mockup browser window. Unlike the earlier
 * post-production version of this tool, the chrome bar is now real HTML
 * rendered live in the recording (see `buildWrapperHtml`), and the target
 * site is loaded in a same-height-shorter `<iframe>` below it — so this
 * value both sizes the bar and tells assemble.ts/generate.ts how much
 * taller the recorded video is than the script's own `viewport`.
 */
export const CHROME_HEIGHT = 44;
const PILL_HEIGHT = 24;
const DOT_SIZE = 11;
const DOT_GAP = 6;
const BAR_PADDING_X = 14;

/**
 * The wrapper page recordScript actually navigates to and records. It is
 * *our own* document — the target site never runs in it directly, only
 * inside `#site-frame`. Because `position: fixed`/`sticky`/`transform`
 * inside an iframe are always scoped to that iframe's own viewport (a CSS
 * fact, not a per-site guess), nothing the target site's CSS does can ever
 * reach outside the iframe box to collide with the chrome bar — no DOM
 * scanning or site-specific patching required, and it holds for arbitrary
 * sites the same way a real browser's own chrome never gets covered by a
 * page's `position: fixed` header.
 */
function buildWrapperHtml(viewportWidth: number, viewportHeight: number): string {
  const dotsY = (CHROME_HEIGHT - DOT_SIZE) / 2;
  const dots = ["#ff5f57", "#febc2e", "#28c840"]
    .map(
      (c, i) =>
        `<span style="position:absolute;top:${dotsY}px;left:${BAR_PADDING_X + i * (DOT_SIZE + DOT_GAP)}px;` +
        `width:${DOT_SIZE}px;height:${DOT_SIZE}px;border-radius:50%;background:${c};"></span>`,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;overflow:hidden;width:${viewportWidth}px;height:${viewportHeight + CHROME_HEIGHT}px;}
    #chrome{position:absolute;top:0;left:0;width:${viewportWidth}px;height:${CHROME_HEIGHT}px;
      box-sizing:border-box;background:#e7e7e7;border-bottom:1px solid #cfcfcf;
      font-family:system-ui,sans-serif;}
    #pill{position:absolute;top:${(CHROME_HEIGHT - PILL_HEIGHT) / 2}px;left:50%;transform:translateX(-50%);
      width:min(520px,80%);height:${PILL_HEIGHT}px;box-sizing:border-box;background:white;
      border:1px solid #d5d5d5;border-radius:999px;display:flex;align-items:center;justify-content:center;padding:0 14px;
      overflow:hidden;white-space:nowrap;}
    #url-text{font-size:13px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    #loading-bar{position:absolute;bottom:0;left:0;width:100%;height:2px;overflow:hidden;}
    #loading-bar::after{content:'';position:absolute;top:0;left:-30%;width:30%;height:100%;
      background:#2563eb;}
    #loading-bar.active::after{animation:loading-sweep ${TIMING.loadingBarSweepMs}ms ease-in-out;}
    @keyframes loading-sweep{from{left:-30%;}to{left:100%;}}
    #site-viewport{position:absolute;top:${CHROME_HEIGHT}px;left:0;width:${viewportWidth}px;
      height:${viewportHeight}px;overflow:hidden;}
    #site-frame{position:absolute;top:0;left:0;width:100%;height:100%;border:0;}
  </style></head><body>
    <div id="chrome">${dots}<div id="pill"><span id="url-text"></span></div><div id="loading-bar"></div></div>
    <div id="site-viewport"><iframe id="site-frame" src="about:blank"></iframe></div>
  </body></html>`;
}

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  width: number;
  height: number;
}

function centerOfBox(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Resolves a `find` description (text + optional role/section) into a
 * Playwright locator using accessibility-based lookups — works on any real
 * page's rendered output, no HTML/data-attribute access required.
 */
function locateByDescription(root: LocatorRoot, find: Find): Locator {
  let scope: LocatorRoot | Locator = find.frame ? root.frameLocator(find.frame) : root;

  if (find.near) {
    // The smallest container that mentions both the section label and the
    // target's own text — `.last()` picks the most specific (deepest) match
    // since ancestors always precede their descendants in document order.
    scope = scope
      .locator("section, form, div, main, article, li, header, footer")
      .filter({ hasText: find.near })
      .filter({ hasText: find.text })
      .last();
  }

  // Real pages often render a hidden responsive duplicate (mobile/desktop
  // variants) of the same element — prefer whichever match is actually
  // visible instead of blindly taking the first one in DOM order.
  if (find.role) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return scope
      .getByRole(find.role as any, { name: find.text })
      .filter({ visible: true })
      .first();
  }
  return scope.getByText(find.text, { exact: false }).filter({ visible: true }).first();
}

/** Resolves whichever target form (`selector` or `find`) an action declares. */
export function resolveLocator(root: LocatorRoot, action: Action): Locator | null {
  switch (action.type) {
    case "click":
    case "hover":
    case "waitForSelector":
    case "type":
    case "upload":
      if (action.selector) return root.locator(action.selector);
      if (action.find) return locateByDescription(root, action.find);
      return null;
    case "scroll":
      return action.selector ? root.locator(action.selector) : null;
    default:
      return null;
  }
}

const HIGHLIGHT_ID = "__tutorial_highlight__";

async function showHighlight(page: Page, box: Box): Promise<void> {
  await page.evaluate(
    ({ box, id, fadeMs }) => {
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const el = document.createElement("div");
      el.id = id;
      Object.assign(el.style, {
        position: "fixed",
        left: `${box.x - 8}px`,
        top: `${box.y - 8}px`,
        width: `${box.width + 16}px`,
        height: `${box.height + 16}px`,
        border: "3px solid #ff3b30",
        borderRadius: "10px",
        boxShadow: "0 0 0 4px rgba(255,59,48,0.25), 0 0 16px rgba(255,59,48,0.5)",
        zIndex: "2147483647",
        pointerEvents: "none",
        opacity: "0",
        transform: "scale(0.92)",
        transition: `opacity ${fadeMs}ms ease-out, transform ${fadeMs}ms ease-out`,
      });
      document.body.appendChild(el);

      // Double rAF so the browser paints the 0-opacity state before we
      // transition it in — otherwise the fade never gets a chance to run.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.opacity = "1";
          el.style.transform = "scale(1)";
        });
      });
    },
    { box, id: HIGHLIGHT_ID, fadeMs: TIMING.highlightFadeMs },
  );
}

/** Fades the box out, then removes it once the transition finishes. */
async function clearHighlight(page: Page): Promise<void> {
  const didFade = await page
    .evaluate(
      ({ id, fadeMs }) => {
        const el = document.getElementById(id) as HTMLElement | null;
        if (!el) return false;
        el.style.transition = `opacity ${fadeMs}ms ease-in, transform ${fadeMs}ms ease-in`;
        el.style.opacity = "0";
        el.style.transform = "scale(0.92)";
        return true;
      },
      { id: HIGHLIGHT_ID, fadeMs: TIMING.highlightFadeMs },
    )
    .catch(() => false);

  if (didFade) {
    await page.waitForTimeout(TIMING.highlightFadeMs);
  }

  await page
    .evaluate((id) => {
      document.getElementById(id)?.remove();
    }, HIGHLIGHT_ID)
    .catch(() => {
      // Page may have navigated away already — the box is gone with it.
    });
}

const CURSOR_ID = "__tutorial_cursor__";
/** Shared with the highlight box so the cursor visually "belongs" to the same focus cue. */
const ACCENT_COLOR = "255,59,48";

/**
 * A classic arrow-pointer silhouette, tip at (0,0) — matching a real OS
 * cursor's hotspot — so positioning the element's top-left corner at the
 * target point lines the tip up exactly with the click location. Sized
 * slightly above a real OS cursor (20x27 vs. ~16x22) so it's easier to spot
 * without looking like an artificial overlay.
 */
const CURSOR_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='22' viewBox='0 0 16 22'>` +
      `<path d='M0 0 L0 15.5 L3.8 12 L6.8 19 L9.4 17.8 L6.5 11 L12.5 11 Z' fill='white' stroke='black' stroke-width='1' stroke-linejoin='miter'/>` +
      `</svg>`,
  );

/** Creates the cursor icon at `pos` if it doesn't exist yet, or snaps it there instantly. */
async function ensureCursor(page: Page, pos: Point): Promise<void> {
  await page
    .evaluate(
      ({ id, x, y, svg }) => {
        let el = document.getElementById(id) as HTMLDivElement | null;
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          Object.assign(el.style, {
            position: "fixed",
            width: "20px",
            height: "27px",
            backgroundImage: `url("${svg}")`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.5))",
            zIndex: "2147483646",
            pointerEvents: "none",
          });
          document.body.appendChild(el);
        }
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      },
      { id: CURSOR_ID, x: pos.x, y: pos.y, svg: CURSOR_SVG },
    )
    .catch(() => {
      // Page mid-navigation — the next step will (re-)create the cursor.
    });
}

/**
 * How long a cursor glide of `distance` px should take — short hops read as
 * snappy, long cross-screen jumps take a bit longer but sublinearly
 * (roughly Fitts's law), capped so a corner-to-corner move never drags the
 * scene out.
 */
function cursorMoveDuration(distance: number): number {
  const t = Math.min(1, distance / 900);
  return TIMING.cursorMoveMinMs + (TIMING.cursorMoveMaxMs - TIMING.cursorMoveMinMs) * Math.sqrt(t);
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
async function moveCursorTo(page: Page, from: Point, to: Point, durationMs: number): Promise<void> {
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
async function showClickRipple(page: Page, pos: Point): Promise<void> {
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

function isPointerAction(
  action: Action,
): action is Extract<Action, { type: "click" | "type" | "hover" | "upload" }> {
  return (
    action.type === "click" ||
    action.type === "type" ||
    action.type === "hover" ||
    action.type === "upload"
  );
}

const SITE_FRAME_SELECTOR = "#site-frame";

/**
 * Zooms the *site iframe* in/out around `origin` (a page-relative point —
 * what `locator.boundingBox()` returns even for elements inside the
 * iframe), keeping that point visually still. Scoped to the iframe, not the
 * whole page, so the chrome bar stays crisp and un-zoomed.
 */
async function setZoom(page: Page, level: number, origin: Point | null): Promise<void> {
  await page
    .evaluate(
      ({ level, origin, durationMs, chromeHeight, sel }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return;
        el.style.transition = `transform ${durationMs}ms ease`;
        if (origin) {
          el.style.transformOrigin = `${origin.x}px ${origin.y - chromeHeight}px`;
        }
        el.style.transform = level === 1 ? "" : `scale(${level})`;
      },
      { level, origin, durationMs: TIMING.zoomTransitionMs, chromeHeight: CHROME_HEIGHT, sel: SITE_FRAME_SELECTOR },
    )
    .catch(() => {});
}

/** Scrolls the site frame's own document by `deltaY` with an eased animation. */
async function smoothScrollBy(siteFrame: Frame, deltaY: number): Promise<void> {
  await siteFrame.evaluate(
    // Same inline-IIFE-with-`while`-loop shape as moveCursorTo, for the same
    // reason: no named function binding for `page.evaluate` to trip over.
    async ({ deltaY, durationMs }) => {
      const startY = window.scrollY;
      const start = performance.now();
      let t = 0;
      while (t < 1) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        t = Math.min(1, durationMs > 0 ? (now - start) / durationMs : 1);
        // easeInOutQuad, inlined to avoid a named helper closure.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + deltaY * eased);
      }
    },
    { deltaY, durationMs: TIMING.scrollAnimationMs },
  );
}

const URL_TEXT_SELECTOR = "#url-text";
const LOADING_BAR_SELECTOR = "#loading-bar";

/** Sets the mockup address bar's text directly (no animation). */
async function setUrlBarText(page: Page, text: string): Promise<void> {
  await page
    .evaluate(
      ({ sel, text }) => {
        const el = document.querySelector(sel);
        if (el) el.textContent = text;
      },
      { sel: URL_TEXT_SELECTOR, text },
    )
    .catch(() => {});
}

/** Replays the thin loading-sweep animation under the chrome bar. */
async function triggerLoadingBar(page: Page): Promise<void> {
  await page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.classList.remove("active");
      void (el as HTMLElement).offsetWidth; // force reflow so the animation restarts
      el.classList.add("active");
    }, LOADING_BAR_SELECTOR)
    .catch(() => {});
}

/**
 * Reveals `url` into the mockup address bar one character at a time, at a
 * natural per-character pace — sped up (never slowed down) so a very long
 * URL still finishes within `TIMING.urlTypeMaxMs` total instead of stretching
 * the scene out.
 */
async function typeUrlBarText(page: Page, url: string): Promise<void> {
  if (url.length === 0) return;
  const charMs = Math.min(TIMING.urlTypeCharMs, TIMING.urlTypeMaxMs / url.length);
  for (let c = 1; c <= url.length; c++) {
    await setUrlBarText(page, url.slice(0, c));
    await page.waitForTimeout(charMs);
  }
}

async function setSiteFrameSrc(page: Page, url: string): Promise<void> {
  await page.evaluate(
    ({ sel, url }) => {
      (document.querySelector(sel) as HTMLIFrameElement).src = url;
    },
    { sel: SITE_FRAME_SELECTOR, url },
  );
}

/**
 * `X-Frame-Options`/CSP `frame-ancestors` exist to stop a hostile third
 * party framing a site for clickjacking — irrelevant here, since the outer
 * page is our own private recording harness. But rewriting *every* site's
 * document response to strip it (via `route.fetch()` + `route.fulfill()`)
 * turns out to be its own hazard: on at least one real dev server, doing
 * that at all — even leaving every header untouched — silently broke
 * hydration (the page rendered fine but every click handler went dead, no
 * error anywhere). So this is applied reactively, per-origin, only once a
 * navigation actually gets blocked — never as a blanket default.
 */
const framingBypassOrigins = new Set<string>();

async function ensureFramingBypass(page: Page, origin: string): Promise<void> {
  if (framingBypassOrigins.has(origin)) return;
  framingBypassOrigins.add(origin);
  await page.context().route(`${origin}/**`, async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];
    delete headers["content-encoding"];
    delete headers["content-length"];
    await route.fulfill({ response, headers });
  });
}

/** One plain attempt at pointing the site iframe at `url` and waiting for it to land. */
async function attemptNavigateSiteFrame(page: Page, siteFrame: Frame, url: string): Promise<void> {
  const navigated = page
    .waitForEvent("framenavigated", { predicate: (f) => f === siteFrame, timeout: TIMING.navigationWaitMs })
    .catch(() => null);
  await setSiteFrameSrc(page, url);
  await navigated;
  await siteFrame.waitForLoadState("load").catch(() => {});
}

/**
 * Points the site iframe at `url` and waits for it to actually land — the
 * live `framenavigated` listener set up in recordScript keeps the mockup
 * address bar's text in sync automatically the instant that happens, so
 * there's no manual bookkeeping needed here.
 *
 * If it doesn't land, retries plain first (a slow/flaky network response
 * looks identical to a framing block at this point) — only once that keeps
 * failing does it assume a framing header is actually the cause and reach
 * for `ensureFramingBypass`, which carries its own real risk (see there),
 * so it's worth ruling out a simple timeout before applying it.
 */
async function navigateSiteFrame(page: Page, siteFrame: Frame, url: string): Promise<void> {
  const origin = new URL(url).origin;
  const landed = () => siteFrame.url().startsWith(origin);

  for (let attempt = 1; attempt <= TIMING.retryAttempts; attempt++) {
    await attemptNavigateSiteFrame(page, siteFrame, url);
    if (landed()) return;
  }

  await ensureFramingBypass(page, origin);
  await attemptNavigateSiteFrame(page, siteFrame, url);
}

/**
 * Clicks `locator`, catching a `target="_blank"` popup if the click opens
 * one — closing it and returning its URL instead of leaving it in a new
 * tab, which would otherwise escape the single continuous recording (or,
 * during validate.ts's dry run, escape the one page it's driving). Returns
 * `null` when the click didn't open a popup. Shared by actor.ts and
 * validate.ts, which each apply the resulting URL differently (into the
 * site iframe vs. a plain page navigation).
 */
export async function clickCatchingPopup(page: Page, locator: Locator): Promise<string | null> {
  const popupPromise = page
    .context()
    .waitForEvent("page", { timeout: TIMING.popupWaitMs })
    .catch(() => null);
  await locator.click();
  const popup = await popupPromise;
  if (!popup) return null;

  await popup.waitForLoadState("load").catch(() => {});
  const popupUrl = popup.url();
  await popup.close();
  return popupUrl;
}

async function runAction(
  page: Page,
  siteFrame: Frame,
  siteRoot: LocatorRoot,
  action: Action,
  cursorAt: Point | null,
): Promise<void> {
  switch (action.type) {
    case "goto": {
      // A `goto` step means the user is typing a URL by hand — animate that
      // for real in the mockup bar, then actually navigate the iframe.
      await typeUrlBarText(page, action.url);
      await page.waitForTimeout(TIMING.urlTypeEnterPauseMs);
      await navigateSiteFrame(page, siteFrame, action.url);
      break;
    }
    case "click": {
      if (cursorAt) await showClickRipple(page, cursorAt);
      const popupUrl = await clickCatchingPopup(page, resolveLocator(siteRoot, action)!);
      if (popupUrl) {
        await navigateSiteFrame(page, siteFrame, popupUrl);
      }
      break;
    }
    case "type": {
      if (cursorAt) await showClickRipple(page, cursorAt);
      const locator = resolveLocator(siteRoot, action)!;
      // Per-character jitter instead of one fixed delay — nobody types at a
      // perfectly even cadence, and a constant delay reads as robotic on camera.
      for (const ch of action.value) {
        const jitteredDelay = Math.max(0, action.typeDelayMs * (0.6 + Math.random() * 0.8));
        await locator.pressSequentially(ch, { delay: jitteredDelay });
      }
      break;
    }
    case "press":
      await page.keyboard.press(action.key);
      break;
    case "hover":
      await resolveLocator(siteRoot, action)!.hover();
      break;
    case "scroll": {
      const locator = resolveLocator(siteRoot, action);
      if (locator) {
        await locator.evaluate((el) => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        await page.waitForTimeout(TIMING.scrollAnimationMs);
      } else {
        await smoothScrollBy(siteFrame, action.y ?? 400);
      }
      break;
    }
    case "wait":
      await page.waitForTimeout(action.ms);
      break;
    case "waitForSelector":
      await resolveLocator(siteRoot, action)!.waitFor({ timeout: TIMING.targetWaitMs });
      break;
    case "upload":
      // No real OS file-picker dialog opens (Playwright can't drive those) —
      // this sets the target <input type="file">'s files directly, which
      // fires the same `change` event the page's own upload handler expects.
      if (cursorAt) await showClickRipple(page, cursorAt);
      await resolveLocator(siteRoot, action)!.setInputFiles(expandHome(action.filePath));
      break;
  }

  if (action.waitAfterMs) {
    await page.waitForTimeout(action.waitAfterMs);
  }
}

/**
 * Runs the whole script in a single continuous browser session so the
 * output is one uninterrupted screen recording (state like login/cookies
 * carries naturally from step to step, exactly like a human demoing it).
 *
 * The recorded page is *our own* wrapper document (mockup chrome bar +
 * `#site-frame` iframe) — the target site always runs inside the iframe,
 * never directly in the recorded page. `position: fixed` (or sticky, or
 * transformed-ancestor tricks) inside an iframe is always scoped to that
 * iframe's own viewport per the CSS spec, so nothing the target site does
 * can ever collide with the chrome bar. That's what keeps this generic
 * across arbitrary sites without scanning/patching any of their DOM.
 */
export async function recordScript(
  script: TutorialScript,
  outputDir: string,
  audioDurationsMs: number[],
): Promise<RecordingResult> {
  mkdirSync(outputDir, { recursive: true });

  const recordingViewport = {
    width: script.viewport.width,
    height: script.viewport.height + CHROME_HEIGHT,
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: recordingViewport,
    recordVideo: { dir: outputDir, size: recordingViewport },
    storageState: script.auth?.storageState ? loadStorageState(script.auth.storageState) : undefined,
  });
  await applyAuth(context, script.auth);
  const page = await context.newPage();
  await page.setContent(buildWrapperHtml(script.viewport.width, script.viewport.height));

  const siteFrameHandle = await page.$(SITE_FRAME_SELECTOR);
  const siteFrame = await siteFrameHandle!.contentFrame();
  if (!siteFrame) {
    throw new Error("Không lấy được frame của #site-frame — trình duyệt có thể chưa render kịp.");
  }
  const siteRoot: LocatorRoot = page.frameLocator(SITE_FRAME_SELECTOR);

  // The mockup address bar tracks the iframe's real URL live — any
  // navigation (our own typed `goto`, a plain link click, an in-app
  // redirect) updates it the instant it actually happens, with zero
  // per-step timing bookkeeping. A quick loading-bar sweep rides along on
  // the same event, so any URL change gets the same "page is loading" cue
  // a real browser gives, purely decorative.
  page.on("framenavigated", (frame) => {
    if (frame === siteFrame) {
      setUrlBarText(page, frame.url()).catch(() => {});
      triggerLoadingBar(page).catch(() => {});
    }
  });

  const startedAt = Date.now();
  const steps: StepTiming[] = [];
  let cursorPos: Point = { x: script.viewport.width / 2, y: script.viewport.height / 2 + CHROME_HEIGHT };

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    steps.push({
      caption: step.caption,
      startMs: Date.now() - startedAt,
    });

    const targetLocator = step.highlightSelector
      ? siteRoot.locator(step.highlightSelector)
      : resolveLocator(siteRoot, step.action);
    let cursorAt: Point | null = null;
    let zoomTarget: Point | null = null;

    if (targetLocator) {
      // A slow/flaky network response can make the target show up just
      // after a single wait would have given up — retry the wait itself
      // (read-only, safe to repeat) before falling back to "no highlight".
      await withRetry(() => targetLocator.waitFor({ timeout: TIMING.targetWaitMs })).catch(() => {});
      const box = await targetLocator.boundingBox().catch(() => null);

      if (box) {
        if (step.highlight) await showHighlight(page, box);
        const target = centerOfBox(box);

        if (step.zoom) {
          zoomTarget = target;
          await setZoom(page, step.zoom.level, target);
        }

        // Hold the highlight roughly until the narration finishes — not a
        // fixed pause regardless of what's being said — so the click lands
        // right as the sentence about it ends, with just a floor so a
        // narration-free (or very short) step still gives viewers a beat
        // to register the target before it fires.
        const elapsedSoFar = Date.now() - startedAt - steps[i].startMs;
        const settleMs = Math.max(TIMING.minHighlightSettleMs, (audioDurationsMs[i] ?? 0) - elapsedSoFar);

        const pointerTarget = isPointerAction(step.action) ? target : null;
        if (pointerTarget) {
          await ensureCursor(page, cursorPos);
          const distance = Math.hypot(pointerTarget.x - cursorPos.x, pointerTarget.y - cursorPos.y);
          const moveMs = Math.min(cursorMoveDuration(distance), settleMs);
          await moveCursorTo(page, cursorPos, pointerTarget, moveMs);
          cursorPos = pointerTarget;
          cursorAt = pointerTarget;
          const remaining = settleMs - moveMs;
          if (remaining > 0) await page.waitForTimeout(remaining);
        } else {
          await page.waitForTimeout(settleMs);
        }
      }

      // Turn the focus box off *before* acting — the click/type must land on
      // a clean screen, never on a frame that still shows the highlight.
      await clearHighlight(page);
    } else {
      await clearHighlight(page);
    }

    await runAction(page, siteFrame, siteRoot, step.action, cursorAt);

    if (zoomTarget) {
      // Zoom back out to reveal the full result, not just the close-up crop.
      await setZoom(page, 1, null);
    }

    // The scene is only ever as long as it actually needs to be: enough for
    // the narration to finish playing *and* for the action to have actually
    // happened — whichever takes longer — plus one fixed breathing gap
    // before the next step starts. No artificial floor beyond that.
    const elapsedForStep = Date.now() - startedAt - steps[i].startMs;
    const remainingAudioMs = (audioDurationsMs[i] ?? 0) - elapsedForStep;
    await page.waitForTimeout(Math.max(0, remainingAudioMs) + TIMING.stepGapMs);
  }

  const totalDurationMs = Date.now() - startedAt;

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) {
    throw new Error("Playwright không trả về video cho phiên ghi này.");
  }

  const recordedPath = await video.path();
  const finalPath = join(outputDir, "raw-recording.webm");
  renameSync(recordedPath, finalPath);

  return { videoPath: finalPath, totalDurationMs, steps };
}
