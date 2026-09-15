import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { ScriptSchema, type TutorialScript } from "./schema";

export function parseScript(filePath: string): TutorialScript {
  const raw = readFileSync(filePath, "utf-8");
  const data = load(raw);
  const result = ScriptSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Kịch bản không hợp lệ (${filePath}):\n${issues}`);
  }

  return result.data;
}
