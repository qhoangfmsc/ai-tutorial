import { unlinkSync } from "node:fs";
import { run, getAudioDurationMs } from "./audio-utils";

export interface TtsResult {
  path: string;
  durationMs: number;
}

/** Synthesizes narration using macOS's built-in `say` (offline, no API key needed). */
export async function synthesize(
  text: string,
  voice: string,
  outWavPath: string,
  rateWpm = 175,
): Promise<TtsResult> {
  const tmpAiff = `${outWavPath}.tmp.aiff`;
  await run("say", ["-v", voice, "-r", String(rateWpm), "-o", tmpAiff, text]);
  await run("ffmpeg", ["-y", "-i", tmpAiff, outWavPath]);
  unlinkSync(tmpAiff);

  const durationMs = await getAudioDurationMs(outWavPath);
  return { path: outWavPath, durationMs };
}
