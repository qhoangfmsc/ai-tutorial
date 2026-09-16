import { chromium } from "playwright";
import type { Action, TutorialScript } from "./schema";
import { resolveLocator, clickCatchingPopup, withRetry, TIMING } from "./actor";
import { applyAuth, loadStorageState } from "./auth";

function describeTarget(action: Action): string {
  if ("selector" in action && action.selector) return `selector "${action.selector}"`;
  if ("find" in action && action.find) {
    const { text, role, near } = action.find;
    let desc = `văn bản "${text}"`;
    if (role) desc += ` (role: ${role})`;
    if (near) desc += ` trong khu vực "${near}"`;
    return desc;
  }
  return "";
}

/**
 * Runs the script's actions for real (state is sequential, so there's no
 * way around that) but skips every visual/audio effect and video recording
 * — just to confirm each step's target actually resolves on the live page
 * before spending time on TTS + a full recording pass.
 */
export async function validateScript(script: TutorialScript): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: script.viewport,
    storageState: script.auth?.storageState ? loadStorageState(script.auth.storageState) : undefined,
  });
  await applyAuth(context, script.auth);
  const page = await context.newPage();

  try {
    for (let i = 0; i < script.steps.length; i++) {
      const step = script.steps[i];
      const action = step.action;
      const stepLabel = `Bước ${i + 1} ("${step.narration}")`;

      try {
        const targetLocator = step.highlightSelector
          ? page.locator(step.highlightSelector)
          : resolveLocator(page, action);
        if (targetLocator) {
          // A slow/flaky network response can make the target show up just
          // after a single wait would have given up — retry the wait
          // itself (read-only, safe to repeat) before failing the step.
          await withRetry(() => targetLocator.waitFor({ timeout: TIMING.targetWaitMs }));
        }

        switch (action.type) {
          case "goto":
            await withRetry(() => page.goto(action.url, { waitUntil: "load" }));
            break;
          case "click": {
            const popupUrl = await clickCatchingPopup(page, resolveLocator(page, action)!);
            if (popupUrl) {
              await page.goto(popupUrl, { waitUntil: "load" });
            }
            break;
          }
          case "type":
            await resolveLocator(page, action)!.fill(action.value);
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
              await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
            } else {
              await page.mouse.wheel(0, action.y ?? 400);
            }
            break;
          }
          case "wait":
            break; // no need to actually sleep during validation
          case "waitForSelector":
            break; // already waited for above
          case "upload":
            // Unlike the other actions here, actually uploading hits a real
            // server (and for something like an avatar, changes real
            // account state) — not worth doing twice per run just to
            // validate. Confirm the <input type="file"> exists instead;
            // it's commonly hidden (class="hidden"), so check "attached"
            // rather than the default "visible".
            await resolveLocator(page, action)!.waitFor({
              timeout: TIMING.targetWaitMs,
              state: "attached",
            });
            break;
        }
      } catch (err) {
        const target = describeTarget(action);
        const targetInfo = target ? ` — không tìm thấy ${target}` : "";
        throw new Error(
          `${stepLabel}, action "${action.type}"${targetInfo}.\n  Chi tiết: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}
