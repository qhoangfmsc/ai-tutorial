import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

/**
 * Opens a real (headed) browser so you can log into an app by hand, then
 * saves the resulting cookies + localStorage to a JSON file. Point a
 * script's `auth.storageState` at that file to start future recordings
 * already logged in — the credentials themselves never touch the YAML.
 */
async function main() {
  const url = process.argv[2];
  const outPath = process.argv[3];

  if (!url || !outPath) {
    console.error("Cách dùng: yarn capture-auth <url> <đường-dẫn-lưu.json>");
    console.error(
      "Ví dụ:    yarn capture-auth https://app.example.com/login pipeline/projects/<tên-project>/auth.json",
    );
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);

  console.log("");
  console.log("▶ Đăng nhập thủ công trong cửa sổ trình duyệt vừa mở.");
  console.log("  Xong rồi quay lại đây và nhấn Enter để lưu session...");
  console.log("");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await context.storageState({ path: outPath });
  console.log(`✔ Đã lưu session vào ${outPath}`);
  console.log(
    `  Trong script.yaml của project, khai (đường dẫn tính từ thư mục project đó): auth: { storageState: "auth.json" }`,
  );

  await browser.close();
  process.exit(0);
}

main();
