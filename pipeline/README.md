# AI Tutorial Pipeline

Sinh video hướng dẫn từ một file kịch bản YAML: AI chỉ **thực thi lại đúng
action đã khai báo** (không tự suy luận thao tác), quay màn hình liên tục
bằng Playwright, khoanh vùng (highlight) mục tiêu, đọc narration bằng TTS,
rồi dựng thành video hoàn chỉnh bằng ffmpeg.

## Mỗi tutorial là 1 project tự chứa

```
pipeline/projects/<tên-project>/
├── script.yaml   ← kịch bản (bắt buộc)
├── auth.json     ← session đã đăng nhập, nếu cần (tuỳ chọn, gitignored)
├── final.mp4     ← video hoàn chỉnh — thứ duy nhất bạn thực sự cần
└── process/      ← toàn bộ file trung gian (audio, raw recording, các clip
                    lẻ trước khi ghép) — gitignored, chỉ để debug khi cần
```

Muốn xem/sửa 1 demo nào, chỉ cần mở đúng 1 thư mục — không cần lục 3 chỗ
khác nhau. Muốn xem kết quả thì chỉ cần đúng 1 file `final.mp4` ngay đó,
không phải chui vào thư mục con nào. Tạo project mới bằng cách copy 1 thư
mục có sẵn (vd `pipeline/projects/onboarding-flow`) sang tên mới, sửa
`script.yaml`.

## Chạy thử

```bash
yarn generate onboarding-flow
```

(tên project, không phải đường dẫn file). Kết quả nằm ở
`pipeline/projects/onboarding-flow/final.mp4`. Cần Next.js dev server
đang chạy (`yarn dev`) nếu kịch bản trỏ vào `localhost:3000`.

## Cấu trúc kịch bản

Xem `pipeline/projects/onboarding-flow/script.yaml`. Ở cấp script:

- `title`, `viewport` (mặc định 1280×720).
- `voice` / `voiceRate`: giọng và tốc độ đọc cho macOS `say` (mặc định
  `Linh`, 130 wpm).
- `intro` / `outro` _(tuỳ chọn)_: màn hình thương hiệu đầu/cuối —
  `heading`, `subheading`, `narration`, `durationMs`.
- `steps`: danh sách bước, mỗi step gồm:
  - `narration`: câu sẽ được đọc bằng TTS.
  - `caption` _(tuỳ chọn)_: chữ hiển thị trên clip trong lúc step diễn ra.
  - `action`: thao tác Playwright — `goto`, `click`, `type`, `press`,
    `hover`, `scroll`, `wait`, `waitForSelector`, `upload`. Xem
    `src/schema.ts` để biết đầy đủ tham số từng loại.
  - `targetSelector` _(tuỳ chọn)_: phần tử cursor/zoom/khung đỏ đều nhắm
    vào; mặc định lấy theo selector/find của chính action. Chỉ cần khai khi
    mục tiêu thật của action không hiển thị được (vd input file ẩn sau
    `upload` — trỏ sang label/nút hiển thị thay thế).
  - `highlight` _(tuỳ chọn, mặc định `true`)_: có vẽ khung đỏ quanh
    `targetSelector` hay không — tách biệt hoàn toàn khỏi việc cursor/zoom
    có nhắm tới đó hay không.
  - Mỗi step kéo dài đúng bằng thời gian đọc narration hoặc thời gian action
    thực thi (tuỳ cái nào lâu hơn), cộng thêm một khoảng nghỉ nhịp cố định
    trước khi sang step kế — không có "thời lượng tối thiểu" ép buộc nữa.

## Kiến trúc

```
schema.ts       → định nghĩa & validate cấu trúc kịch bản (zod)
parser.ts       → đọc file YAML, validate theo schema
tts.ts          → sinh audio narration (macOS `say` hoặc OmniVoice), đo duration thật
audio-utils.ts  → tiện ích chạy lệnh con + đo duration qua ffprobe
cursor.ts       → toàn bộ phần con trỏ chuột: icon SVG (mũi tên/bàn tay/I-beam),
                  di chuyển mượt (requestAnimationFrame), đổi icon theo CSS
                  `cursor` thật của mục tiêu, ripple/bounce lúc click
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

## Demo app cần đăng nhập sẵn

Nếu app cần login trước khi demo, đừng gõ tài khoản/mật khẩu thật trong
kịch bản. Thay vào đó, lưu session (cookie + localStorage) ra file
`auth.json` **ngay trong thư mục project đó** (đã có trong `.gitignore`):

```bash
yarn capture-auth https://app.example.com/login pipeline/projects/<tên-project>/auth.json
```

Lệnh trên mở 1 trình duyệt thật — đăng nhập thủ công, xong quay lại
terminal nhấn Enter để lưu session. Sau đó khai báo trong `script.yaml`
của project (đường dẫn tính từ thư mục project, nên chỉ cần tên file):

```yaml
auth:
  storageState: "auth.json"
```

Từ giờ mỗi lần `yarn generate` chạy, trình duyệt sẽ khởi động **đã đăng
nhập sẵn** — không cần quay lại bước login mỗi lần, và không có thông tin
nhạy cảm nào nằm trong file kịch bản có thể commit lên git.

### 3 cách khai `auth`, dùng riêng hoặc kết hợp

Không phải app nào cũng cần đủ cả cookie lẫn localStorage — chọn đúng cái
app bạn demo thực sự cần:

- **`storageState`** _(khuyên dùng)_: snapshot đầy đủ cookie + localStorage,
  lấy từ `yarn capture-auth`. Phù hợp khi không chắc app cần gì, cứ đăng
  nhập tay 1 lần là có đủ.
- **`cookies`**: khai trực tiếp trong YAML, cho app chỉ cần 1-2 session
  cookie đơn giản (không cần chạy `capture-auth`):
  ```yaml
  auth:
    cookies:
      - name: "session_id"
        value: "abc123"
        domain: "app.example.com"
  ```
- **`localStorage`**: cho app không dùng cookie mà lưu token trong
  `localStorage` (phổ biến với SPA dùng JWT):
  ```yaml
  auth:
    localStorage:
      - origin: "https://app.example.com"
        items:
          auth_token: "eyJhbGciOi..."
          user_id: "42"
  ```

Cả 3 field trong `auth` độc lập nhau — khai bao nhiêu cũng được, không bắt
buộc chọn 1. Giá trị nhạy cảm gõ trực tiếp trong YAML thì tự chịu trách
nhiệm không commit file đó lên git (dùng `storageState` sẽ an toàn hơn vì
dữ liệu nằm ở file riêng, không lẫn vào kịch bản).

## Nhắm mục tiêu: `selector` hay `find`

Mỗi action cần chọn phần tử (`click`, `type`, `hover`, `waitForSelector`)
dùng đúng 1 trong 2 cách:

- `selector`: CSS selector thường (id/class/attribute) — cần bạn kiểm soát
  được HTML.
- `find: { text, role?, near?, frame? }`: mô tả bằng văn bản hiển thị/accessible
  name — dùng được trên **bất kỳ trang nào**, kể cả trang bạn không kiểm
  soát HTML. `near` khoanh vùng tìm trong đúng khu vực khi có nhiều phần tử
  trùng tên; `frame` trỏ vào 1 `<iframe>` (kể cả khác domain) nếu mục tiêu
  nằm trong đó.

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
