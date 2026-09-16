import { readFileSync, writeFileSync } from "node:fs";
import type { BrowserContext, BrowserContextOptions } from "playwright";
import type { TutorialScript } from "./schema";

type Auth = NonNullable<TutorialScript["auth"]>;
type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

/**
 * Loads a Playwright storageState JSON file and normalizes its shape before
 * handing it to `browser.newContext`. Playwright is strict about
 * `origins[].localStorage` being an array of `{name, value}` pairs — but a
 * file hand-edited from a plain paste of DevTools' Application > Local
 * Storage panel naturally comes out as one flat `{key: value}` object
 * instead, which Playwright rejects outright. Accepting both here means a
 * manual token refresh never has to get Playwright's exact schema right —
 * and once a file needed fixing, the corrected shape is written straight
 * back to disk so it's fixed for good, not re-patched in memory every run.
 */
export function loadStorageState(path: string): StorageState {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    cookies?: StorageState["cookies"];
    origins?: Array<{ origin: string; localStorage?: unknown }>;
  };

  let neededFix = false;
  const origins = (raw.origins ?? []).map(({ origin, localStorage }) => {
    const isAlreadyPairs =
      Array.isArray(localStorage) &&
      localStorage.every((e) => e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string");
    if (isAlreadyPairs) return { origin, localStorage };

    neededFix = true;
    // Flatten whatever shape shows up (a single `{key: value}` object, or an
    // array of one) into the `{name, value}` pairs Playwright expects.
    const flat = Array.isArray(localStorage) ? Object.assign({}, ...localStorage) : (localStorage ?? {});
    return {
      origin,
      localStorage: Object.entries(flat as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: String(value),
      })),
    };
  });

  const normalized: StorageState = { cookies: raw.cookies ?? [], origins };

  if (neededFix) {
    writeFileSync(path, JSON.stringify(normalized, null, 2) + "\n");
    console.log(`  (đã tự sửa lại định dạng localStorage sai trong ${path})`);
  }

  return normalized;
}

/**
 * Applies whichever pieces of `auth` a script declares, on top of whatever
 * `storageState` already set at context-creation time. Cookies and
 * localStorage are independent — a site that only needs one doesn't have
 * to fake the other.
 */
export async function applyAuth(context: BrowserContext, auth: Auth | undefined): Promise<void> {
  if (!auth) return;

  if (auth.cookies?.length) {
    await context.addCookies(
      auth.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires ?? -1,
      })),
    );
  }

  if (auth.localStorage?.length) {
    for (const { origin, items } of auth.localStorage) {
      // addInitScript re-runs on every new document in this context, so the
      // values are there before the app's own code runs, on every navigation
      // that lands on this origin.
      await context.addInitScript({
        content: `(() => {
          if (window.location.origin === ${JSON.stringify(origin)}) {
            const items = ${JSON.stringify(items)};
            for (const key in items) window.localStorage.setItem(key, items[key]);
          }
        })();`,
      });
    }
  }
}
