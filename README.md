# Demo Tutorial Video Generator

Viết kịch bản (script.yaml) → công cụ tự mở trình duyệt thao tác đúng như
kịch bản, đọc thuyết minh, ghép thành 1 video hoàn chỉnh.

## 1. Cài đặt & khởi động

```bash
yarn install
npx playwright install chromium   # 1 lần duy nhất
```

ffmpeg cần bản có filter `drawtext` — bản `brew install ffmpeg` thường thiếu,
phải cài qua tap riêng:

```bash
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

Nếu kịch bản của bạn demo app Next.js trong chính repo này (`localhost:3000`),
mở 1 terminal khác chạy:

```bash
yarn dev
```

rồi để nguyên đó, mở terminal thứ 2 để chạy lệnh generate ở các bước sau.

**Giọng đọc:** mặc định dùng lệnh `say` có sẵn trên macOS — không cần cài
thêm gì. Muốn giọng tự nhiên hơn thì đổi sang **OmniVoice** (API ngoài, không
cần cài gì thêm, chỉ cần API key) — xem phần "Đổi giọng đọc" bên dưới.

## 2. Viết kịch bản

Mỗi video là 1 thư mục trong `pipeline/projects/<tên-project>/`, bên trong
chỉ bắt buộc có `script.yaml`. Cách nhanh nhất: copy 1 project có sẵn (vd
`pipeline/projects/onboarding-flow`) sang tên mới rồi sửa lại.

```yaml
title: "Tên video"
voice: "Linh"

steps:
  - narration: "Câu thuyết minh sẽ đọc trong lúc bước này diễn ra."
    caption: "Chữ hiện trên màn hình" # tuỳ chọn
    action:
      type: goto
      url: "http://localhost:3000"

  - narration: "Nhấn nút Tạo dự án mới."
    zoom: { level: 1.6 } # tuỳ chọn, phóng to cho dễ nhìn
    action:
      type: click
      find: { text: "Tạo dự án mới", role: "button" }
```

`url` trong action `goto` chính là "nhắm vào app nào" — đổi thành địa chỉ app
thật của bạn (local hay đã deploy đều được), không giới hạn ở `localhost:3000`.

Mỗi phần tử cần bấm/gõ/hover chọn 1 trong 2 cách để trỏ tới:

- `selector: "..."` — CSS selector, khi bạn kiểm soát được HTML.
- `find: { text: "...", role: "...", near: "..." }` — mô tả bằng chữ hiển
  thị trên màn hình, dùng được với **bất kỳ trang nào** kể cả không sửa được
  HTML. `role`/`near` chỉ cần khi có nhiều phần tử trùng tên.

**Cursor/zoom/khung đỏ nhắm vào đâu, và có vẽ khung đỏ hay không, là 2 việc
tách biệt:**

- `targetSelector` _(tuỳ chọn)_: phần tử mà cursor sẽ bay tới + camera zoom
  vào + (nếu bật) khung đỏ khoanh quanh. Mặc định lấy theo `selector`/`find`
  của chính action đó. Chỉ cần khai riêng khi mục tiêu thật của action
  **không hiển thị được** trên màn hình — ví dụ action `upload` thường trỏ
  vào 1 `<input type="file">` bị ẩn (`display:none`), lúc đó `targetSelector`
  trỏ sang cái nút/label hiển thị thay thế, để cursor có chỗ mà bay tới.
- `highlight: true/false` _(mặc định `true`)_: có vẽ khung đỏ hay không.
  Không liên quan gì tới `targetSelector` — tắt khung đỏ không có nghĩa
  cursor cũng ngừng di chuyển tới đó.

```yaml
  - narration: "Đưa chuột vào avatar."
    highlight: false # tắt khung đỏ, cursor vẫn bay tới bình thường
    action:
      type: hover
      selector: "..."

  - narration: "Nhấn bút chì để đổi ảnh."
    targetSelector: "label[for='input-avatar']" # input file thật bị ẩn, phải trỏ sang label
    action:
      type: upload
      selector: "#input-avatar"
      filePath: "~/anh-moi.jpg"
```

### Các loại `action` có sẵn

| `type`            | Thao tác                          |
| ----------------- | ---------------------------------- |
| `goto`            | Điều hướng đến 1 URL                |
| `click`           | Bấm vào 1 phần tử                   |
| `type`            | Gõ chữ vào ô input                  |
| `press`           | Nhấn 1 phím (vd `"Enter"`)          |
| `hover`           | Rê chuột vào, không bấm             |
| `scroll`          | Cuộn trang (theo phần tử hoặc theo px) |
| `wait`            | Dừng lại một khoảng thời gian       |
| `waitForSelector` | Chờ 1 phần tử xuất hiện rồi mới đi tiếp |
| `upload`          | Chọn file cho ô upload              |

## 3. Sau khi có kịch bản — có cần chuẩn bị gì thêm?

Chỉ khi app **cần đăng nhập trước** mới cần thêm bước này (nếu không thì bỏ
qua, sang bước 4 luôn). Đừng gõ tài khoản/mật khẩu thật vào `script.yaml` —
đăng nhập 1 lần và lưu session lại:

```bash
yarn capture-auth https://app-cua-ban.com/login pipeline/projects/<tên-project>/auth.json
```

Lệnh này mở trình duyệt thật để bạn đăng nhập tay, quay lại terminal nhấn
Enter để lưu. Rồi khai báo trong `script.yaml`:

```yaml
auth:
  storageState: "auth.json"
```

Từ đó video sẽ tự bắt đầu ở trạng thái đã đăng nhập.

## 4. Chạy lệnh tạo video

```bash
yarn generate <tên-project>
```

`<tên-project>` là **tên thư mục** trong `pipeline/projects/`, không phải
đường dẫn file — đây cũng là cách "cấu hình" project nào sẽ được dựng thành
video, không cần sửa gì khác. Ví dụ:

```bash
yarn generate onboarding-flow
```

## 5. Video ra ở đâu

Ngay tại `pipeline/projects/<tên-project>/final.mp4` — không nằm rải rác chỗ
khác. Các file trung gian (audio, bản ghi thô) nằm trong `process/` cùng
thư mục, chỉ để debug khi cần, có thể xoá.

## Đổi giọng đọc (tuỳ chọn)

Muốn dùng OmniVoice thay cho `say` mặc định:

1. Thêm vào `.env` ở gốc dự án: `OMNIVOICE_API_KEY=...` (script `generate` tự
   nạp file này, không cần export tay).
2. Lấy đúng tên giọng (slug) tài khoản của bạn có bằng
   `GET http://omnivoice.tunnel.zobite.com/api/voices`.
3. Khai vào `script.yaml`:
   ```yaml
   tts:
     provider: "omnivoice"
     voice: "tên-slug-lấy-ở-bước-2"
     language: "vi" # hoặc "en"
   ```

## Muốn hiểu sâu hơn cách hoạt động bên trong

Xem [`pipeline/README.md`](pipeline/README.md).
