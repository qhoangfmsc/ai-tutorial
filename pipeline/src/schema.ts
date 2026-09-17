import { z } from "zod";

const baseAction = z.object({
  /** Pause after the action completes, in milliseconds — gives the resulting UI a beat to settle. */
  waitAfterMs: z.number().int().nonnegative().default(200),
});

/**
 * Describes a target by what it looks like on screen instead of a CSS
 * selector — for pages you can't (or don't want to) add data attributes to.
 * Resolved at runtime via Playwright's accessibility-based locators
 * (getByRole/getByText), so it works on any real page, not just ones you
 * control the HTML of.
 */
const FindSchema = z.object({
  /** Visible text of the target itself, e.g. "Bắt đầu". */
  text: z.string().min(1),
  /** Optional ARIA role to disambiguate, e.g. "button", "link", "textbox". */
  role: z.string().min(1).optional(),
  /** Visible text of an enclosing section/heading to search within, e.g. "Nhập form". */
  near: z.string().min(1).optional(),
  /** CSS selector of an <iframe> to search inside (e.g. a widget from another domain). */
  frame: z.string().min(1).optional(),
});

export type Find = z.infer<typeof FindSchema>;

/** A step target: either a CSS selector or a natural-language description. */
const TargetFields = {
  selector: z.string().min(1).optional(),
  find: FindSchema.optional(),
};

function requireOneTarget<T extends { selector?: string; find?: unknown }>(action: T) {
  return Boolean(action.selector) !== Boolean(action.find);
}

const TARGET_ISSUE = { message: "cần khai báo đúng một trong 'selector' hoặc 'find'" };

export const ActionSchema = z.discriminatedUnion("type", [
  baseAction.extend({
    type: z.literal("goto"),
    url: z.string().url(),
  }),
  baseAction
    .extend({ type: z.literal("click"), ...TargetFields })
    .refine(requireOneTarget, TARGET_ISSUE),
  baseAction
    .extend({
      type: z.literal("type"),
      ...TargetFields,
      value: z.string(),
      /** Delay between keystrokes in ms, to simulate human typing on camera. */
      typeDelayMs: z.number().int().nonnegative().default(70),
    })
    .refine(requireOneTarget, TARGET_ISSUE),
  baseAction.extend({
    type: z.literal("press"),
    key: z.string().min(1),
  }),
  baseAction
    .extend({ type: z.literal("hover"), ...TargetFields })
    .refine(requireOneTarget, TARGET_ISSUE),
  baseAction.extend({
    type: z.literal("scroll"),
    selector: z.string().optional(),
    y: z.number().optional(),
  }),
  baseAction.extend({
    type: z.literal("wait"),
    ms: z.number().int().nonnegative(),
  }),
  baseAction
    .extend({ type: z.literal("waitForSelector"), ...TargetFields })
    .refine(requireOneTarget, TARGET_ISSUE),
  baseAction
    .extend({
      type: z.literal("upload"),
      ...TargetFields,
      /**
       * Absolute path to the file to upload, or `~/...` for the user's home
       * dir. Sets the target `<input type="file">`'s files directly — no
       * real OS file-picker dialog is opened (Playwright can't drive those),
       * so this works whether the target is the hidden input itself or is
       * targeted via `targetSelector` pointing at the visible control that
       * would normally open it.
       */
      filePath: z.string().min(1),
    })
    .refine(requireOneTarget, TARGET_ISSUE),
]);

export type Action = z.infer<typeof ActionSchema>;

export const StepSchema = z.object({
  narration: z.string().min(1),
  caption: z.string().min(1).optional(),
  action: ActionSchema,
  /**
   * The element this step's cursor movement, camera zoom, and (if
   * `highlight` is true) red focus box all key off of. Defaults to the
   * action's own selector/find target when omitted — only set this when
   * that target isn't a good visual stand-in, most commonly a hidden
   * `<input type="file">` behind an `upload` action, where this should
   * point at the visible label/button that represents it on screen.
   *
   * This is deliberately a *visual target*, not a highlight-only setting —
   * whether the box actually gets drawn is controlled independently by
   * `highlight` below, so "where the cursor goes" and "is there a red box"
   * never get tangled into one setting.
   */
  targetSelector: z.string().min(1).optional(),
  /**
   * Whether to draw the red focus box for this step. Defaults to true for
   * any step whose target (see `targetSelector` above) resolves to a real,
   * visible element. Set to false to keep the cursor/zoom behavior but hide
   * the box — independent of `targetSelector`, which only decides *where*,
   * never *whether to draw*.
   */
  highlight: z.boolean().default(true),
  /** Camera zoom-in on the step's target while it plays; zooms back out after the action. */
  zoom: z
    .object({
      level: z.number().min(1.05).max(3).default(1.6),
    })
    .optional(),
});

export type Step = z.infer<typeof StepSchema>;

const BrandScreenSchema = z.object({
  heading: z.string().min(1),
  subheading: z.string().min(1).optional(),
  narration: z.string().min(1).optional(),
  durationMs: z.number().int().positive().default(2000),
});

export type BrandScreen = z.infer<typeof BrandScreenSchema>;

export const ScriptSchema = z.object({
  title: z.string().min(1),
  /**
   * The *site's* viewport — the final video is this height plus the 44px
   * chrome bar on top (see CHROME_HEIGHT in actor.ts). Defaults to 676 so
   * the delivered video lands on a clean 1280x720 (16:9) instead of an odd
   * height that gets pillarboxed oddly on platforms expecting standard
   * aspect ratios.
   */
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 676 }),
  /** macOS `say` voice name. Ignored when `tts.provider` is `omnivoice`. */
  voice: z.string().default("Linh"),
  /** Speech rate in words-per-minute passed to macOS `say` — lower reads slower/calmer. */
  voiceRate: z.number().int().positive().default(175),
  /**
   * TTS backend. `say` (default) is macOS's offline built-in voice — always
   * available, no setup. `omnivoice` calls the OmniVoice API for a much more
   * natural voice; needs `OMNIVOICE_API_KEY` set (see `.env`) and a real
   * `voice` slug from that account's `GET /api/voices`.
   */
  tts: z
    .object({
      provider: z.enum(["say", "omnivoice"]).default("say"),
      baseUrl: z.string().url().default("http://omnivoice.tunnel.zobite.com"),
      /** Voice slug from `GET /api/voices` — required once `provider` is `omnivoice`. */
      voice: z.string().optional(),
      language: z.enum(["vi", "en"]).default("vi"),
      /** Playback speed multiplier, 0.5–2.0. */
      speed: z.number().min(0.5).max(2).default(1.0),
    })
    .default({ provider: "say", baseUrl: "http://omnivoice.tunnel.zobite.com", language: "vi", speed: 1.0 }),
  intro: BrandScreenSchema.optional(),
  outro: BrandScreenSchema.optional(),
  /**
   * Silent hold on the last frame before cutting to outro — keeps its
   * narration from bleeding into the last step's audio. Kept small: the
   * last step already ends with its own breathing gap (narration finishes,
   * then a short pause) before this even starts, so this only needs to
   * cover the little bit extra a full scene-change deserves, not a second
   * full pause on top of it.
   */
  outroGapMs: z.number().int().nonnegative().default(400),
  /**
   * How to start the browser already logged in. Pick whichever the target
   * app actually needs — a full session snapshot, plain cookies, or just
   * localStorage — and combine them if it needs more than one. Keep
   * anything sensitive (the `storageState` file, or literal values here)
   * OUTSIDE git.
   */
  auth: z
    .object({
      /** Path to a Playwright storageState JSON file (cookies + localStorage). */
      storageState: z.string().min(1).optional(),
      /** Cookies to set directly, for apps that only need a session cookie. */
      cookies: z
        .array(
          z.object({
            name: z.string().min(1),
            value: z.string(),
            domain: z.string().min(1),
            path: z.string().default("/"),
            httpOnly: z.boolean().default(false),
            secure: z.boolean().default(false),
            sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
            /** Unix seconds; omit for a session cookie (expires with the browser). */
            expires: z.number().optional(),
          }),
        )
        .optional(),
      /** localStorage entries to seed per-origin, for apps that don't use cookies at all. */
      localStorage: z
        .array(
          z.object({
            origin: z.string().url(),
            items: z.record(z.string(), z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
  steps: z.array(StepSchema).min(1),
});

export type TutorialScript = z.infer<typeof ScriptSchema>;
