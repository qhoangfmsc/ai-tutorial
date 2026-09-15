import { spawn } from "node:child_process";
import type { RecordingResult } from "./actor";
import type { BrandScreen } from "./schema";
import type { TtsResult } from "./tts";

const DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thoát với mã lỗi ${code}`));
    });
  });
}

/** Escapes a value for safe use inside an ffmpeg filtergraph string. */
function escapeDrawtext(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeFontPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

export interface AssembleOptions {
  fontPath?: string;
  fontSize?: number;
}

/**
 * Burns per-step captions onto the raw screen recording and mixes each
 * step's narration audio in at the moment that step starts.
 */
export async function assembleMainVideo(
  recording: RecordingResult,
  stepAudio: TtsResult[],
  outputPath: string,
  options: AssembleOptions = {},
): Promise<void> {
  const fontPath = escapeFontPath(options.fontPath ?? DEFAULT_FONT);
  const fontSize = options.fontSize ?? 32;

  const drawtextFilters = recording.steps
    .map((step, i) => {
      if (!step.caption) return null;
      const startSec = (step.startMs / 1000).toFixed(3);
      const nextStep = recording.steps[i + 1];
      const endSec = (
        (nextStep ? nextStep.startMs : recording.totalDurationMs) / 1000
      ).toFixed(3);
      const text = escapeDrawtext(step.caption);

      return (
        `drawtext=fontfile='${fontPath}':text='${text}'` +
        `:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12` +
        `:x=(w-text_w)/2:y=h-th-60:enable='between(t,${startSec},${endSec})'`
      );
    })
    .filter((f): f is string => f !== null);

  const totalDurationSec = (recording.totalDurationMs / 1000).toFixed(3);

  const args = ["-y", "-i", recording.videoPath];
  for (const audio of stepAudio) {
    args.push("-i", audio.path);
  }

  const videoLabel = drawtextFilters.length > 0 ? "[vout]" : "[0:v]";
  const filterParts: string[] = [];
  if (drawtextFilters.length > 0) {
    filterParts.push(`[0:v]${drawtextFilters.join(",")}${videoLabel}`);
  }

  const delayedLabels = recording.steps.map((step, i) => {
    const label = `[a${i}]`;
    filterParts.push(`[${i + 1}:a]adelay=${Math.round(step.startMs)}:all=1${label}`);
    return label;
  });
  filterParts.push(
    `${delayedLabels.join("")}amix=inputs=${delayedLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad[aout]`,
  );

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", videoLabel, "-map", "[aout]");
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-t",
    totalDurationSec,
    outputPath,
  );

  await runFfmpeg(args);
}

export interface BrandClipOptions {
  width: number;
  height: number;
  fontPath?: string;
}

/** Renders a static brand screen (greeting / thank-you) as its own mp4 clip. */
export async function buildBrandClip(
  screen: BrandScreen,
  audio: TtsResult | null,
  outputPath: string,
  options: BrandClipOptions,
): Promise<void> {
  const fontPath = escapeFontPath(options.fontPath ?? DEFAULT_FONT);
  const durationMs = Math.max(screen.durationMs, audio ? audio.durationMs + 500 : 0);
  const durationSec = (durationMs / 1000).toFixed(3);

  const filters = [
    `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(screen.heading)}'` +
      `:fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-20`,
  ];
  if (screen.subheading) {
    filters.push(
      `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(screen.subheading)}'` +
        `:fontsize=28:fontcolor=0xcccccc:x=(w-text_w)/2:y=(h-text_h)/2+50`,
    );
  }

  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x0a0a0a:s=${options.width}x${options.height}:d=${durationSec}:r=25`,
  ];

  if (audio) {
    args.push("-i", audio.path);
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  }

  args.push(
    "-vf",
    filters.join(","),
    "-af",
    "apad",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    durationSec,
    outputPath,
  );

  await runFfmpeg(args);
}

/**
 * Holds the clip's last frame with silence for `gapMs` extra time at the
 * end — a real pause, not just a longer crossfade, so the next clip's
 * narration never overlaps this one's tail audio.
 */
export async function padVideoEnd(
  inputPath: string,
  gapMs: number,
  outputPath: string,
): Promise<void> {
  const gapSec = (gapMs / 1000).toFixed(3);
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-vf",
    `tpad=stop_mode=clone:stop_duration=${gapSec}`,
    "-af",
    `apad=pad_dur=${gapSec}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

async function probeDurationSec(path: string): Promise<number> {
  const out = await new Promise<string>((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.on("error", reject);
    proc.on("close", () => resolve(stdout));
  });
  return parseFloat(out.trim());
}

/**
 * Concatenates clips (in order) into one final video, crossfading between
 * them (instead of a hard cut) so scene changes feel smooth.
 */
export async function concatClips(
  clipPaths: string[],
  outputPath: string,
  crossfadeSec = 0.4,
): Promise<void> {
  if (clipPaths.length === 1) {
    await runFfmpeg(["-y", "-i", clipPaths[0], "-c", "copy", outputPath]);
    return;
  }

  const durations = await Promise.all(clipPaths.map(probeDurationSec));

  const args = ["-y"];
  for (const clip of clipPaths) {
    args.push("-i", clip);
  }

  const filterParts: string[] = [];
  let prevV = "0:v";
  let prevA = "0:a";
  let cumulativeSec = durations[0];

  for (let i = 1; i < clipPaths.length; i++) {
    const d = Math.min(crossfadeSec, durations[i - 1], durations[i]);
    const offset = Math.max(0, cumulativeSec - d);
    const vOut = `v${i}`;
    const aOut = `a${i}`;
    filterParts.push(
      `[${prevV}][${i}:v]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`,
    );
    filterParts.push(`[${prevA}][${i}:a]acrossfade=d=${d.toFixed(3)}[${aOut}]`);
    prevV = vOut;
    prevA = aOut;
    cumulativeSec = cumulativeSec - d + durations[i];
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", `[${prevV}]`, "-map", `[${prevA}]`);
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-c:a",
    "aac",
    outputPath,
  );

  await runFfmpeg(args);
}
