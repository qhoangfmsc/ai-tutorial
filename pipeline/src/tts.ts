import { unlinkSync, writeFileSync } from "node:fs";
import { run, getAudioDurationMs } from "./audio-utils";

export interface TtsResult {
  path: string;
  durationMs: number;
}

export interface OmniVoiceConfig {
  baseUrl: string;
  voice?: string;
  language: string;
  speed: number;
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

/**
 * Synthesizes narration via the OmniVoice API for a much more natural voice
 * than `say`. Uses the blocking `/api/generate` endpoint (returns WAV
 * directly, up to a 300s server-side timeout) instead of the enqueue/poll
 * flow — narration lines are short, so there's nothing to gain from polling.
 */
export async function synthesizeWithOmniVoice(
  text: string,
  config: OmniVoiceConfig,
  outWavPath: string,
): Promise<TtsResult> {
  const apiKey = process.env.OMNIVOICE_API_KEY;
  if (!apiKey) {
    throw new Error("Thiếu OMNIVOICE_API_KEY — đặt biến này trong .env trước khi dùng tts.provider: omnivoice");
  }
  if (!config.voice) {
    throw new Error(
      "script.yaml thiếu tts.voice — lấy slug hợp lệ từ GET /api/voices của OmniVoice rồi khai vào đó",
    );
  }

  // The tunnel this API is served behind strips the `Authorization` header
  // in transit (verified: header auth gets a 401, query-param auth works
  // against the same key) — so the key is passed as `?api_key=` instead.
  const url = `${config.baseUrl}/api/generate?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice: config.voice,
      language: config.language,
      speed: config.speed,
    }),
  });
  if (!res.ok) {
    throw new Error(`OmniVoice (${config.baseUrl}) trả về lỗi ${res.status}: ${await res.text()}`);
  }

  // /api/generate already returns audio/wav — no ffmpeg conversion needed.
  writeFileSync(outWavPath, Buffer.from(await res.arrayBuffer()));

  const durationMs = await getAudioDurationMs(outWavPath);
  return { path: outWavPath, durationMs };
}
