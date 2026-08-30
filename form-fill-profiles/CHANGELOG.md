# Changelog

Tất cả thay đổi đáng chú ý của extension **Form Fill Profiles** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-08-30

### Fixed

- **Autofill sang site của người khác** — `*.website.*` trước đây khớp bằng `parts.indexOf(middle)`, tức nhãn nằm ở **bất kỳ vị trí nào** trong hostname cũng tính là khớp. Ai sở hữu `evil.com` chỉ cần dựng `www.facebook.evil.com` là profile đã lưu cho `*.facebook.*` được điền vào form của họ — gồm cả thông tin cá nhân và mật khẩu. Nay pattern neo vào registrable domain: nhãn phải **là** site đó (`getSiteLabel(hostname) === label`), không phải chỉ xuất hiện đâu đó trong host.
- Tương tự với pattern `website.*`: `facebook.*` từng khớp `facebook.evil.com` vì chỉ kiểm tra `parts[0]`. Nay yêu cầu host đúng bằng registrable domain của chính nó.
- **Pattern đề xuất mặc định quá rộng** — `SECOND_LEVEL_TLDS` là list chép tay, thiếu `co.id`, `com.my`, `co.th`, `edu.vn`… nên `shop.tokopedia.co.id` bị đề xuất `*.co.*`, mà pattern đó khớp mọi site `.co.uk` / `.co.id` / `.co.th` / `.co.jp`. Đây là giá trị **mặc định** hiện trong ô Domain pattern khi capture form, chỉ cần bấm Save là profile bị áp cho hàng loạt site lạ. Nay dùng luật suy diễn dùng chung nên ra `*.tokopedia.*`.
- Host là IP, một nhãn, hoặc chỉ là public suffix thì đề xuất chính hostname thay vì pattern wildcard.

### Changed

- Phần tách eTLD+1 chuyển sang dùng block dùng chung từ `shared/domain-suffix.js`, đồng bộ bằng `make sync-domain-suffix`.

## [1.0.0] - 2026-07-26

Bản MVP đầu tiên, theo scope mục 19 của [docs/spec.md](docs/spec.md).

### Added

- **Capture form ở path hiện tại** — popup có nút `Capture form on this page`, scan toàn bộ `input` / `textarea` / `select` / radio / checkbox / `contenteditable` của page, kể cả field **không nằm trong** thẻ `<form>` (gom vào pseudo-form `__orphan__`). Page có nhiều form thì popup cho chọn form nào cần lưu.
- **Label detection** 9 tầng: `label[for]` → label bọc ngoài → `aria-label` → `aria-labelledby` → `placeholder` → `title` → text đứng trước → `name` → `Field #n`. Radio group lấy label từ `<legend>` của `fieldset`.
- **Selector ổn định cho từng field** — ưu tiên `[name]`, `#id` không random, `data-testid`/`data-test`/`data-qa`, rồi mới tới class/path; bỏ qua class hash kiểu `css-1x2y3z`, `sc-AbCdEf`, id chứa UUID hoặc số dài.
- **Profile editor trong options page** — render lại form vừa capture thành form thật để điền câu trả lời, lưu thành profile có tên + note, chọn 1 profile làm default. Một form có nhiều profile; duplicate / rename / delete được.
- **Apply profile từ popup** — điền toàn bộ field và báo cáo `filled / not found / skipped / failed` kèm tên field và lý do.
- **Apply engine** ghi value qua **native setter** (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) rồi dispatch `focus → input → change → blur`, nên form React/Vue controlled input không bị reset giá trị. Checkbox/radio dùng `click()` để UI library nghe được.
- **7 tầng fallback tìm lại field** khi apply: selector → `[name]` → `#id` → `data-testid` → label text → `placeholder`/`aria-label` → vị trí trong DOM. Không tìm được thì báo `not found`, không đoán bừa.
- **Select match theo label** — profile lưu cả `value` và `label` của option, nên option đổi `value` vẫn điền đúng; option biến mất thì báo `option-missing`.
- **Retry cho form động** — `MutationObserver` + interval 300ms trong `retryWindowMs` (mặc định 3000ms) để điền field render muộn (SPA, wizard nhiều bước).
- **Domain pattern wildcard** giống `rule-matcher.js` của Element Filter: `example.com` (kèm mọi subdomain), `*.example.com`, `example.*`, `*.example.*`. Pattern mặc định khi capture là `*.{tên-domain}.*` nên profile dùng chung được cho dev/staging/prod và nhiều TLD.
- **Path pattern** exact + prefix wildcard (`/register/*`) + `*`; bỏ qua query string/hash, chuẩn hoá trailing slash. Nhiều form match cùng URL thì xếp theo độ cụ thể của path → domain → `updatedAt`.
- **Re-capture** giữ nguyên `fieldId` nên câu trả lời của các field cũ không mất; field mới thêm vào, field không còn được giữ lại kèm cờ `removed` và bị skip khi apply.
- **Export/import JSON** (`form-fill-profiles.json`) với 3 strategy khi trùng form: `merge` / `replace` / `skip`; id được sinh lại nhưng giữ đúng liên kết form ↔ profile.
- **Settings** — bật/tắt report chi tiết, dispatch event, retry form động + retry window, include password field, include hidden field, xoá toàn bộ dữ liệu.
- Icon tự sinh bằng `node generate-icons.js` (chỉ dùng built-in của Node, không cần dependency).

### Security

- **Mặc định không lưu** `input[type=password]`, `input[type=file]`, field `hidden`, field `disabled`/`readonly`, field không visible, và field có dấu hiệu OTP/CVV/captcha (`autocomplete="one-time-code"` hoặc name/label khớp regex). Field bị loại trừ vẫn hiện trong danh sách kèm lý do, chỉ là không có value nào được lưu.
- Password chỉ được capture khi user bật `Include password fields` trong Settings, kèm cảnh báo dữ liệu lưu **plain text** trong `chrome.storage.local`.
- Export có chứa value của password field sẽ hỏi confirm trước khi tải file.
- **Không auto-submit** form, không click element nào ngoài checkbox/radio, không gửi dữ liệu ra ngoài browser. Extension chỉ scan khi user bấm, không đọc field khi user đang nhập.
- Permission tối thiểu: `activeTab`, `scripting`, `tabs`, `storage`. Không xin `cookies`, `webRequest`, `downloads`.

### Notes

- Chưa có trong MVP (dự kiến 1.1, xem mục 19 của spec): auto-apply khi page load, `Undo` sau apply, UI diff chi tiết cho re-capture, form trong iframe.
- `chrome.storage.local` không mã hoá. Không nên dùng cho dữ liệu thật của người dùng cuối (PII, thẻ, mật khẩu thật).
