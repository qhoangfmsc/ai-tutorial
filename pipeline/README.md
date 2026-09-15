# AI Tutorial Pipeline

Sinh video hướng dẫn từ một file kịch bản YAML: AI chỉ **thực thi lại đúng
action đã khai báo** (không tự suy luận thao tác), quay màn hình liên tục
bằng Playwright, khoanh vùng (highlight) mục tiêu, đọc narration bằng TTS,
rồi dựng thành video hoàn chỉnh bằng ffmpeg.

## Chạy thử

```bash
yarn generate pipeline/examples/onboarding-flow.yaml
```

Kết quả nằm ở `pipeline/output/<tên-file-script>/final.mp4`. Cần Next.js
dev server đang chạy (`yarn dev`) nếu kịch bản trỏ vào `localhost:3000`.

## Cấu trúc kịch bản

Xem `pipeline/examples/onboarding-flow.yaml`. Ở cấp script:

- `title`, `viewport` (mặc định 1280×720).
- `voice` / `voiceRate`: giọng và tốc độ đọc cho macOS `say` (mặc định
  `Linh`, 130 wpm).
- `intro` / `outro` *(tuỳ chọn)*: màn hình thương hiệu đầu/cuối —
  `heading`, `subheading`, `narration`, `durationMs`.
- `steps`: danh sách bước, mỗi step gồm:
  - `narration`: câu sẽ được đọc bằng TTS.
  - `caption` *(tuỳ chọn)*: chữ hiển thị trên clip trong lúc step diễn ra.
  - `action`: thao tác Playwright — `goto`, `click`, `type`, `press`,
    `hover`, `scroll`, `wait`, `waitForSelector`. Xem `src/schema.ts` để
    biết đầy đủ tham số từng loại.
  - `highlightSelector` *(tuỳ chọn)*: mặc định lấy theo selector của
    action; khoanh khung đỏ quanh phần tử này.
  - `minDurationMs`: thời gian tối thiểu step hiển thị (mặc định 1500ms).

## Kiến trúc

```
schema.ts       → định nghĩa & validate cấu trúc kịch bản (zod)
parser.ts       → đọc file YAML, validate theo schema
tts.ts          → sinh audio narration bằng macOS `say`, đo duration thật
audio-utils.ts  → tiện ích chạy lệnh con + đo duration qua ffprobe
actor.ts        → Playwright chạy toàn bộ script trong 1 phiên liên tục:
                  vẽ highlight → giữ 2s → tắt highlight → thao tác →
                  giữ kết quả ≥1.5s → sang step kế; ghi video + timestamp
assemble.ts     → burn caption theo timestamp, mux audio từng step vào
                  đúng offset, dựng màn hình intro/outro, crossfade nối
                  các đoạn lại thành final.mp4
generate.ts     → CLI orchestrator (TTS → record → assemble)
```

Quay liên tục trong **một** phiên trình duyệt (thay vì cắt video theo từng
step) giúp giữ đúng trạng thái trang (cookie, form, URL) xuyên suốt — giống
người thật demo — và tránh việc ghép nhiều đoạn quay không khớp trạng thái.

### Trình tự mỗi step có highlight

1. Khung đỏ fade-in quanh mục tiêu, giữ nguyên ~2s (đọc narration).
2. Khung đỏ fade-out, tắt hẳn.
3. Thao tác (click/type/...) thực thi trên màn hình sạch.
4. Giữ kết quả tối thiểu 1.5s (hoặc lâu hơn nếu narration còn dài) trước khi
   sang step kế tiếp.

## Yêu cầu hệ thống

- macOS (dùng `say` làm TTS offline, miễn phí).
- Node 18+, Playwright Chromium (`npx playwright install chromium`).
- **ffmpeg build có filter `drawtext`** (cần libfreetype). ffmpeg mặc định
  từ `brew install ffmpeg` KHÔNG có filter này. Dùng:
  ```bash
  brew tap homebrew-ffmpeg/ffmpeg
  brew install homebrew-ffmpeg/ffmpeg/ffmpeg
  ```

## Giới hạn hiện tại

- TTS chỉ dùng giọng có sẵn trên máy qua `say` — phát âm tiếng Việt tốt
  nhưng chỉ có 1 giọng ("Linh") trên macOS mặc định.
- Highlight là hình chữ nhật đơn giản quanh 1 selector; chưa hỗ trợ
  khoanh vùng tự do hoặc nhiều mục tiêu cùng lúc trong 1 step.
