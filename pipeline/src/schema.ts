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
]);

export type Action = z.infer<typeof ActionSchema>;

export const StepSchema = z.object({
  narration: z.string().min(1),
  caption: z.string().min(1).optional(),
  action: ActionSchema,
  /**
   * Selector to draw a rectangle highlight around while this step plays.
   * Defaults to the action's own selector when the action targets one.
   */
  highlightSelector: z.string().min(1).optional(),
  /** Minimum time this step stays on screen, in ms. */
  minDurationMs: z.number().int().nonnegative().default(1500),
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
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 720 }),
  /** macOS `say` voice name. */
  voice: z.string().default("Linh"),
  /** Speech rate in words-per-minute passed to macOS `say` — lower reads slower/calmer. */
  voiceRate: z.number().int().positive().default(175),
  intro: BrandScreenSchema.optional(),
  outro: BrandScreenSchema.optional(),
  /** Silent hold on the last frame before cutting to outro — keeps its narration from bleeding into the last step's audio. */
  outroGapMs: z.number().int().nonnegative().default(1000),
  steps: z.array(StepSchema).min(1),
});

export type TutorialScript = z.infer<typeof ScriptSchema>;
