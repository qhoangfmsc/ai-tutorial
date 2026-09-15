import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page, type Locator, type FrameLocator } from "playwright";
import type { Action, Find, TutorialScript } from "./schema";

export interface StepTiming {
  index: number;
  narration: string;
  caption?: string;
  /** Offset from the start of the recording, in ms, when this step begins. */
  startMs: number;
}

export interface RecordingResult {
  videoPath: string;
  totalDurationMs: number;
  steps: StepTiming[];
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
function locateByDescription(page: Page, find: Find): Locator {
  let scope: Page | Locator | FrameLocator = find.frame ? page.frameLocator(find.frame) : page;

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
export function resolveLocator(page: Page, action: Action): Locator | null {
  switch (action.type) {
    case "click":
    case "hover":
    case "waitForSelector":
    case "type":
      if (action.selector) return page.locator(action.selector);
      if (action.find) return locateByDescription(page, action.find);
      return null;
    case "scroll":
      return action.selector ? page.locator(action.selector) : null;
    default:
      return null;
  }
}

const HIGHLIGHT_ID = "__tutorial_highlight__";
/** How long the box takes to fade/scale in or out, in ms. */
const HIGHLIGHT_FADE_MS = 300;
/** Pause with the box fully visible before the action fires, so viewers register the target. */
const HIGHLIGHT_SETTLE_MS = 2000;
/** Minimum time to hold the resulting screen after an action, before cutting to the next step. */
const POST_ACTION_OBSERVE_MS = 1500;

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
    { box, id: HIGHLIGHT_ID, fadeMs: HIGHLIGHT_FADE_MS },
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
      { id: HIGHLIGHT_ID, fadeMs: HIGHLIGHT_FADE_MS },
    )
    .catch(() => false);

  if (didFade) {
    await page.waitForTimeout(HIGHLIGHT_FADE_MS);
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
const CURSOR_MOVE_MS = 500;

/**
 * A classic arrow-pointer silhouette, tip at (0,0) — matching a real OS
 * cursor's hotspot — so positioning the element's top-left corner at the
 * target point lines the tip up exactly with the click location.
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
            width: "16px",
            height: "22px",
            backgroundImage: `url("${svg}")`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))",
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

/** Animates the cursor dot from `from` to `to`, frame by frame. */
async function moveCursorTo(page: Page, from: Point, to: Point, durationMs: number): Promise<void> {
  const frameCount = 20;
  await page
    .evaluate(
      async ({ id, from, to, durationMs, frameCount }) => {
        const el = document.getElementById(id) as HTMLDivElement | null;
        if (!el) return;
        const frameDelay = durationMs / frameCount;
        for (let i = 1; i <= frameCount; i++) {
          const t = i / frameCount;
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          el.style.left = `${from.x + (to.x - from.x) * eased}px`;
          el.style.top = `${from.y + (to.y - from.y) * eased}px`;
          await new Promise((r) => setTimeout(r, frameDelay));
        }
      },
      { id: CURSOR_ID, from, to, durationMs, frameCount },
    )
    .catch(() => {});
}

/** A brief expanding ring at `pos` to mark a click. */
async function showClickRipple(page: Page, pos: Point): Promise<void> {
  await page
    .evaluate(({ x, y }) => {
      const ripple = document.createElement("div");
      Object.assign(ripple.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: "10px",
        height: "10px",
        marginLeft: "-5px",
        marginTop: "-5px",
        borderRadius: "50%",
        border: "2px solid rgba(20,20,20,0.6)",
        zIndex: "2147483645",
        pointerEvents: "none",
        transition: "transform 400ms ease-out, opacity 400ms ease-out",
        transform: "scale(1)",
        opacity: "1",
      });
      document.body.appendChild(ripple);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ripple.style.transform = "scale(3.5)";
          ripple.style.opacity = "0";
        });
      });
      setTimeout(() => ripple.remove(), 450);
    }, pos)
    .catch(() => {});
}

function isPointerAction(action: Action): action is Extract<Action, { type: "click" | "type" | "hover" }> {
  return action.type === "click" || action.type === "type" || action.type === "hover";
}

/** Height (px) reserved at the top of the recording for the fake browser chrome. */
export const CHROME_HEIGHT = 44;
const CHROME_ID = "__tutorial_chrome__";

/** Injects (once) a macOS-style toolbar with a live address bar showing `url`. */
async function ensureBrowserChrome(page: Page, url: string): Promise<void> {
  await page
    .evaluate(
      ({ id, height, url }) => {
        if (!document.body.style.paddingTop) {
          document.body.style.paddingTop = `${height}px`;
        }

        let bar = document.getElementById(id);
        if (!bar) {
          bar = document.createElement("div");
          bar.id = id;
          Object.assign(bar.style, {
            position: "fixed",
            top: "0",
            left: "0",
            right: "0",
            height: `${height}px`,
            background: "#e7e7e7",
            borderBottom: "1px solid #cfcfcf",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "0 14px",
            zIndex: "2147483647",
            fontFamily: "system-ui, sans-serif",
          });

          const dots = document.createElement("div");
          Object.assign(dots.style, { display: "flex", gap: "6px", flex: "none" });
          for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
            const dot = document.createElement("span");
            Object.assign(dot.style, {
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              background: color,
              display: "inline-block",
            });
            dots.appendChild(dot);
          }
          bar.appendChild(dots);

          const addressWrap = document.createElement("div");
          Object.assign(addressWrap.style, {
            flex: "1",
            display: "flex",
            justifyContent: "center",
          });
          const address = document.createElement("div");
          address.id = `${id}-address`;
          Object.assign(address.style, {
            background: "white",
            border: "1px solid #d5d5d5",
            borderRadius: "999px",
            padding: "5px 18px",
            fontSize: "13px",
            color: "#333",
            maxWidth: "520px",
            width: "100%",
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            transition: "transform 260ms ease, box-shadow 260ms ease",
          });
          addressWrap.appendChild(address);
          bar.appendChild(addressWrap);
          document.body.appendChild(bar);
        }

        const addressEl = document.getElementById(`${id}-address`);
        if (addressEl) addressEl.textContent = url;
      },
      { id: CHROME_ID, height: CHROME_HEIGHT, url },
    )
    .catch(() => {
      // Page mid-navigation — the next step re-injects the chrome anyway.
    });
}

/** Briefly scales/glows the address bar to draw the eye to a URL change. */
async function pulseAddressBar(page: Page): Promise<void> {
  await page
    .evaluate((id) => {
      const el = document.getElementById(`${id}-address`) as HTMLElement | null;
      if (!el) return;
      el.style.transform = "scale(1.15)";
      el.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.35)";
      setTimeout(() => {
        el.style.transform = "scale(1)";
        el.style.boxShadow = "none";
      }, 280);
    }, CHROME_ID)
    .catch(() => {});
}

const LOADING_BAR_ID = "__tutorial_loading_bar__";
const LOADING_BAR_MS = 450;

/** Shows a thin indeterminate progress bar under the chrome, like a real page load. */
async function showLoadingBar(page: Page): Promise<void> {
  await page
    .evaluate(
      ({ id, chromeHeight, durationMs }) => {
        document.getElementById(id)?.remove();

        const track = document.createElement("div");
        track.id = id;
        Object.assign(track.style, {
          position: "fixed",
          top: `${chromeHeight}px`,
          left: "0",
          right: "0",
          height: "3px",
          background: "transparent",
          zIndex: "2147483647",
          overflow: "hidden",
        });

        const bar = document.createElement("div");
        Object.assign(bar.style, {
          position: "absolute",
          top: "0",
          bottom: "0",
          width: "40%",
          background: "#2563eb",
          borderRadius: "0 2px 2px 0",
          transition: `left ${durationMs}ms ease-in-out`,
          left: "-40%",
        });
        track.appendChild(bar);
        document.body.appendChild(track);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bar.style.left = "100%";
          });
        });
      },
      { id: LOADING_BAR_ID, chromeHeight: CHROME_HEIGHT, durationMs: LOADING_BAR_MS },
    )
    .catch(() => {});
}

async function hideLoadingBar(page: Page): Promise<void> {
  await page
    .evaluate((id) => {
      document.getElementById(id)?.remove();
    }, LOADING_BAR_ID)
    .catch(() => {});
}

const URL_TYPE_DELAY_MS = 45;
const URL_TYPE_ENTER_PAUSE_MS = 350;

/**
 * Simulates a person clicking the address bar and typing a URL by hand —
 * distinct from an in-app redirect, which just updates the text and pulses.
 * Runs entirely before the real navigation, on the page that's about to
 * be left, so it must be called before `page.goto()`.
 */
async function typeUrlIntoAddressBar(page: Page, url: string, cursorPos: Point): Promise<Point> {
  const addressBox = await page
    .locator(`#${CHROME_ID}-address`)
    .boundingBox()
    .catch(() => null);
  const addressCenter = addressBox ? centerOfBox(addressBox) : null;

  if (addressCenter) {
    await ensureCursor(page, cursorPos);
    await moveCursorTo(page, cursorPos, addressCenter, CURSOR_MOVE_MS);
    await showClickRipple(page, addressCenter);
  }

  await page
    .evaluate((id) => {
      const el = document.getElementById(`${id}-address`) as HTMLElement | null;
      if (!el) return;
      el.style.outline = "2px solid #2563eb";
      el.style.outlineOffset = "1px";
      el.style.textAlign = "left";
      el.textContent = "";
    }, CHROME_ID)
    .catch(() => {});

  for (let i = 1; i <= url.length; i++) {
    await page
      .evaluate(
        ({ id, text }) => {
          const el = document.getElementById(`${id}-address`);
          if (el) el.textContent = text;
        },
        { id: CHROME_ID, text: url.slice(0, i) },
      )
      .catch(() => {});
    await page.waitForTimeout(URL_TYPE_DELAY_MS);
  }

  // A beat to read the finished URL before "pressing Enter".
  await page.waitForTimeout(URL_TYPE_ENTER_PAUSE_MS);

  await page
    .evaluate((id) => {
      const el = document.getElementById(`${id}-address`) as HTMLElement | null;
      if (!el) return;
      el.style.outline = "none";
      el.style.textAlign = "center";
    }, CHROME_ID)
    .catch(() => {});

  return addressCenter ?? cursorPos;
}

const ZOOM_TRANSITION_MS = 500;

/** Zooms the whole page in/out around `origin`, keeping that point visually still. */
async function setZoom(page: Page, level: number, origin: Point | null): Promise<void> {
  await page
    .evaluate(
      ({ level, origin, durationMs }) => {
        const html = document.documentElement;
        html.style.overflow = "hidden";
        html.style.transition = `transform ${durationMs}ms ease`;
        if (origin) {
          html.style.transformOrigin = `${origin.x}px ${origin.y}px`;
        }
        html.style.transform = level === 1 ? "" : `scale(${level})`;
      },
      { level, origin, durationMs: ZOOM_TRANSITION_MS },
    )
    .catch(() => {});
}

const SCROLL_ANIMATION_MS = 600;

/** Scrolls the page by `deltaY` with an eased animation, visible frame by frame. */
async function smoothScrollBy(page: Page, deltaY: number): Promise<void> {
  const frameCount = 24;
  await page.evaluate(
    async ({ deltaY, durationMs, frameCount }) => {
      const startY = window.scrollY;
      const frameDelay = durationMs / frameCount;
      for (let i = 1; i <= frameCount; i++) {
        const t = i / frameCount;
        // easeInOutQuad, inlined to avoid a named helper closure.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + deltaY * eased);
        await new Promise((r) => setTimeout(r, frameDelay));
      }
    },
    { deltaY, durationMs: SCROLL_ANIMATION_MS, frameCount },
  );
}

async function runAction(page: Page, action: Action, cursorAt: Point | null): Promise<void> {
  switch (action.type) {
    case "goto": {
      await showLoadingBar(page);
      await page.waitForTimeout(LOADING_BAR_MS);
      await page.goto(action.url, { waitUntil: "load" });
      await hideLoadingBar(page);
      break;
    }
    case "click": {
      if (cursorAt) await showClickRipple(page, cursorAt);
      // Some links open in a new tab (target="_blank") — that would escape
      // the single continuous recording. Catch the popup, if any, and fold
      // it back into the current page instead of leaving it in a new tab.
      const popupPromise = page.context().waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await resolveLocator(page, action)!.click();
      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState("load").catch(() => {});
        const popupUrl = popup.url();
        await popup.close();
        await showLoadingBar(page);
        await page.goto(popupUrl, { waitUntil: "load" });
        await hideLoadingBar(page);
      }
      break;
    }
    case "type":
      if (cursorAt) await showClickRipple(page, cursorAt);
      await resolveLocator(page, action)!.pressSequentially(action.value, {
        delay: action.typeDelayMs,
      });
      break;
    case "press":
      await page.keyboard.press(action.key);
      break;
    case "hover":
      await resolveLocator(page, action)!.hover();
      break;
    case "scroll": {
      const locator = resolveLocator(page, action);
      if (locator) {
        await locator.evaluate((el) => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        await page.waitForTimeout(SCROLL_ANIMATION_MS);
      } else {
        await smoothScrollBy(page, action.y ?? 400);
      }
      break;
    }
    case "wait":
      await page.waitForTimeout(action.ms);
      break;
    case "waitForSelector":
      await resolveLocator(page, action)!.waitFor();
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
 */
export async function recordScript(
  script: TutorialScript,
  outputDir: string,
  stepDurationsMs: number[],
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
  });
  const page = await context.newPage();

  const startedAt = Date.now();
  const steps: StepTiming[] = [];
  let cursorPos: Point = { x: script.viewport.width / 2, y: script.viewport.height / 2 };

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i];
    steps.push({
      index: i,
      narration: step.narration,
      caption: step.caption,
      startMs: Date.now() - startedAt,
    });

    // Re-injected every step (idempotent) since a full page navigation wipes
    // the previous step's DOM additions, including this bar.
    const urlAtStepStart = page.url();
    await ensureBrowserChrome(page, urlAtStepStart);

    const targetLocator = step.highlightSelector
      ? page.locator(step.highlightSelector)
      : resolveLocator(page, step.action);
    let cursorAt: Point | null = null;
    let zoomTarget: Point | null = null;

    if (targetLocator) {
      await targetLocator.waitFor({ timeout: 5000 }).catch(() => {});
      const box = await targetLocator.boundingBox().catch(() => null);

      if (box) {
        await showHighlight(page, box);
        const target = centerOfBox(box);

        if (step.zoom) {
          zoomTarget = target;
          await setZoom(page, step.zoom.level, target);
        }

        const pointerTarget = isPointerAction(step.action) ? target : null;
        if (pointerTarget) {
          await ensureCursor(page, cursorPos);
          const moveMs = Math.min(CURSOR_MOVE_MS, HIGHLIGHT_SETTLE_MS);
          await moveCursorTo(page, cursorPos, pointerTarget, moveMs);
          cursorPos = pointerTarget;
          cursorAt = pointerTarget;
          const remaining = HIGHLIGHT_SETTLE_MS - moveMs;
          if (remaining > 0) await page.waitForTimeout(remaining);
        } else {
          await page.waitForTimeout(HIGHLIGHT_SETTLE_MS);
        }
      }

      // Turn the focus box off *before* acting — the click/type must land on
      // a clean screen, never on a frame that still shows the highlight.
      await clearHighlight(page);
    } else {
      await clearHighlight(page);
    }

    // A `goto` step means the user is typing a URL by hand — show that
    // typing on the *current* page before the navigation replaces it. A
    // click that happens to redirect is different (the app decided that,
    // not the user), so it only gets the pulse below, not typed text.
    if (step.action.type === "goto") {
      cursorPos = await typeUrlIntoAddressBar(page, step.action.url, cursorPos);
    }

    await runAction(page, step.action, cursorAt);

    if (zoomTarget) {
      // Zoom back out to reveal the full result, not just the close-up crop.
      await setZoom(page, 1, null);
    }

    // The action may have navigated (goto, or a click that routes elsewhere)
    // — re-sync the chrome and, for an in-app redirect only, pulse to draw
    // attention to the URL that just changed on its own.
    await ensureBrowserChrome(page, page.url());
    if (page.url() !== urlAtStepStart && step.action.type !== "goto") {
      await pulseAddressBar(page);
    }

    // Always give viewers time to see the *result* of the action before the
    // scene changes — independent of narration/caption timing.
    const actionDoneOffsetMs = Date.now() - startedAt - steps[i].startMs;
    const minDurationMs = Math.max(
      stepDurationsMs[i] ?? step.minDurationMs,
      actionDoneOffsetMs + POST_ACTION_OBSERVE_MS,
    );
    const elapsedForStep = Date.now() - startedAt - steps[i].startMs;
    if (minDurationMs > elapsedForStep) {
      await page.waitForTimeout(minDurationMs - elapsedForStep);
    }
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
