import { chromium } from "playwright";
import type { Action, TutorialScript } from "./schema";
import { resolveLocator, expandHome } from "./actor";
import { applyAuth } from "./auth";

const TARGET_TIMEOUT_MS = 5000;

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
    storageState: script.auth?.storageState,
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
          await targetLocator.waitFor({ timeout: TARGET_TIMEOUT_MS });
        }

        switch (action.type) {
          case "goto":
            await page.goto(action.url, { waitUntil: "load" });
            break;
          case "click": {
            // Mirror actor.ts: a target="_blank" link would otherwise open a
            // popup the rest of the script never sees, breaking validation.
            const popupPromise = page
              .context()
              .waitForEvent("page", { timeout: 1500 })
              .catch(() => null);
            await resolveLocator(page, action)!.click();
            const popup = await popupPromise;
            if (popup) {
              await popup.waitForLoadState("load").catch(() => {});
              const popupUrl = popup.url();
              await popup.close();
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
            await resolveLocator(page, action)!.setInputFiles(expandHome(action.filePath));
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
