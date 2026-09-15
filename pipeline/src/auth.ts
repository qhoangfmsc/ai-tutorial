import type { BrowserContext } from "playwright";
import type { TutorialScript } from "./schema";

type Auth = NonNullable<TutorialScript["auth"]>;

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
