import { join, isAbsolute } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { parseScript } from "./parser";
import { recordScript, CHROME_HEIGHT } from "./actor";
import { assembleMainVideo, buildBrandClip, concatClips, padVideoEnd } from "./assemble";
import { synthesize, type TtsResult } from "./tts";
import { validateScript } from "./validate";

/**
 * Each tutorial is a self-contained folder under pipeline/projects/<name>/:
 *   script.yaml   — the tutorial script (required)
 *   auth.json     — optional storageState (cookies/localStorage), gitignored
 *   final.mp4     — the one file that actually matters, right next to the script
 *   process/      — every intermediate/working file, gitignored
 * Keeping all of this together is what makes "which folder has the X demo?"
 * a one-hop question instead of a three-directory hunt.
 */
async function main() {
  const projectName = process.argv[2];
  if (!projectName) {
    console.error("Cách dùng: tsx pipeline/src/generate.ts <tên-project>");
    console.error("  (project phải nằm ở pipeline/projects/<tên-project>/script.yaml)");
    process.exit(1);
  }

  const projectDir = join("pipeline", "projects", projectName);
  const scriptPath = join(projectDir, "script.yaml");
  if (!existsSync(scriptPath)) {
    console.error(`✘ Không tìm thấy ${scriptPath}`);
    process.exit(1);
  }

  const script = parseScript(scriptPath);

  // `auth.storageState` in the YAML is relative to the project folder, so
  // a project stays self-contained and movable as one unit.
  if (script.auth?.storageState && !isAbsolute(script.auth.storageState)) {
    script.auth.storageState = join(projectDir, script.auth.storageState);
  }

  const processDir = join(projectDir, "process");
  const audioDir = join(processDir, "audio");
  mkdirSync(audioDir, { recursive: true });

  console.log("▶ Kiểm tra kịch bản (dry-run, chưa quay hình)...");
  await validateScript(script);
  console.log("✔ Kịch bản hợp lệ, mọi mục tiêu đều tìm thấy.");

  const synth = (text: string, baseNameNoExt: string): Promise<TtsResult> =>
    synthesize(text, script.voice, join(audioDir, `${baseNameNoExt}.wav`), script.voiceRate);

  console.log(`▶ Sinh giọng đọc (${script.voice})...`);
  // Every narration line is an independent `say`+ffmpeg subprocess pair —
  // running them concurrently instead of one-by-one cuts this phase's wall
  // time roughly by the number of lines, with no effect on the result.
  const [introAudio, stepAudio, outroAudio] = await Promise.all([
    script.intro?.narration ? synth(script.intro.narration, "intro") : Promise.resolve(null),
    Promise.all(script.steps.map((step, i) => synth(step.narration, `step-${i}`))),
    script.outro?.narration ? synth(script.outro.narration, "outro") : Promise.resolve(null),
  ]);

  const audioDurationsMs = stepAudio.map((a) => a.durationMs);

  console.log(`▶ Đang thực thi kịch bản "${script.title}" (${script.steps.length} bước)...`);
  const recording = await recordScript(script, processDir, audioDurationsMs);
  console.log(
    `✔ Ghi hình xong: ${recording.videoPath} (${(recording.totalDurationMs / 1000).toFixed(1)}s)`,
  );

  console.log("▶ Đang dựng video chính (caption + giọng đọc)...");
  const mainClipPath = join(processDir, "main.mp4");
  await assembleMainVideo(recording, stepAudio, mainClipPath);

  const clips: string[] = [];

  if (script.intro) {
    console.log("▶ Đang dựng màn hình chào mở đầu...");
    const introPath = join(processDir, "intro.mp4");
    await buildBrandClip(script.intro, introAudio, introPath, {
      width: script.viewport.width,
      height: script.viewport.height + CHROME_HEIGHT,
    });
    clips.push(introPath);
  }

  if (script.outro && script.outroGapMs > 0) {
    // A real pause on the last frame, not just a longer crossfade — keeps
    // the outro's narration from starting while the last step's is still
    // trailing off.
    const paddedMainPath = join(processDir, "main-padded.mp4");
    await padVideoEnd(mainClipPath, script.outroGapMs, paddedMainPath);
    clips.push(paddedMainPath);
  } else {
    clips.push(mainClipPath);
  }

  if (script.outro) {
    console.log("▶ Đang dựng màn hình cảm ơn kết thúc...");
    const outroPath = join(processDir, "outro.mp4");
    await buildBrandClip(script.outro, outroAudio, outroPath, {
      width: script.viewport.width,
      height: script.viewport.height + CHROME_HEIGHT,
    });
    clips.push(outroPath);
  }

  const finalPath = join(projectDir, "final.mp4");
  console.log("▶ Đang ghép các đoạn lại thành video hoàn chỉnh...");
  await concatClips(clips, finalPath);

  console.log(`✔ Hoàn tất: ${finalPath}`);
}

main().catch((err) => {
  console.error("✘ Lỗi:", err.message ?? err);
  process.exit(1);
});
