# Changelog

Tất cả thay đổi đáng chú ý của extension **Element Filter** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-07-26

### Added

- **Inspect Element Mode** — cùng picker sẵn có, thêm tab `Inspect` bên cạnh `Block`. Mở từ popup (`🔍 Inspect element`), context menu (`Element Filter` → `Inspect element`), hoặc bấm chuyển tab khi đang chọn xong element mà không cần chọn lại.
- **Selector kèm số match** — panel Inspect hiện cả 4 level của specificity slider, mỗi level kèm badge số element khớp: xanh = unique, vàng = nhiều, đỏ = 0 hoặc invalid. Đây là thứ trước đây phải đoán khi kéo slider ở tab Block.
- **XPath** — neo theo id ổn định gần nhất (`//*[@id="main"]/div[2]`), fallback absolute path; kèm số node khớp và nút copy.
- **Contrast ratio theo WCAG 2.1** — màu nền lấy bằng cách đi ngược lên cây cha và alpha-composite từng lớp `background-color` cho tới lớp đục, cuối cùng composite lên nền trắng của canvas; màu chữ có alpha cũng được composite trước khi tính. Ngưỡng phân biệt text thường và text lớn (≥ 24px, hoặc ≥ 18.66px + bold).
- **12 accessibility check** — thiếu `alt`, element tương tác không có accessible name, form control không có label, `role` tương tác mà `tabindex < 0`, `aria-hidden` bọc nội dung focusable, `tabindex > 0`, contrast dưới AA… Phân 3 mức error / warn / info.
- Computed styles chính: size, display, position + z-index, font, overflow, opacity, margin/border/padding.
- Module mới `element-inspector.js` (phân tích thuần tuý) và `SelectorGenerator` export thêm `isUnstableClass` / `isUnstableId` để dùng lại.

### Fixed

- **Bấm `Create` không có phản ứng gì sau khi reload extension** — content script cũ vẫn chạy trên các tab đang mở, nhưng `chrome.runtime` của nó đã bị gỡ, nên `chrome.runtime.sendMessage` ném `TypeError: Cannot read properties of undefined (reading 'sendMessage')` và click trôi đi im lặng. Giờ picker kiểm tra `chrome.runtime.id` trước khi gửi, bắt cả `lastError`, và hiện hộp lỗi đỏ ngay trong panel: "Element Filter was reloaded or updated. Refresh this page (F5), then pick the element again." `content.js` cũng guard tương tự để không ném lỗi ở mỗi lần page load trong tab orphaned. Lỗi này có từ trước, không phải do bản 1.1.0 gây ra — chỉ là dev reload extension thì gặp thường xuyên.

- **Specificity slider không nhìn rõ trên một số site** — panel nằm trong DOM của trang nên CSS của site đè được lên `input[type=range]`, làm thanh trượt gần như tàng hình. Giờ track và thumb được vẽ tường minh (`-webkit-appearance: none` + màu cụ thể, có `!important` để rule của trang không ghi đè), kèm bản dựng cho `::-moz-range-*`.

### Changed

- **Icon đổi sang hình mắt nhắm** (nguồn: SVG Repo, lưu ở `icons/eye-closed-source.svg`), hợp nghĩa "element bị ẩn" hơn biển cấm cũ. Path gốc là stroke đã convert thành fill nên dữ liệu là hàng trăm đoạn bezier vụn; generator không chép lại mà bóc các điểm neo rồi dựng lại đường tâm — cung mí là spline Catmull-Rom đi qua đúng 7 điểm đó, 5 lông mi là đoạn thẳng, tất cả tô theo khoảng cách đúng như stroke gốc.
- **Tab `Block` / `Inspect` chuyển lên hàng trên cùng của panel**, nằm ngay trong thanh header màu tím thay vì là một hàng riêng bên dưới. Tiêu đề cũ ("Block Element" / "Inspect Element") bị bỏ vì trùng nghĩa với tên tab đang chọn — đổi lại panel gọn hơn một hàng. Tab đang chọn có gạch chân trắng. Màn hình "Filter Created" vẫn dùng header dạng tiêu đề như cũ.
- **Specificity hiện rõ đang ở level nào** — thêm badge `3/4 · Specific` cạnh nhãn, và hàng 4 nút số bấm chọn trực tiếp được (không phụ thuộc vào việc slider có render đúng hay không). Sửa selector bằng tay thì badge đổi thành `edited by hand`.
- Panel rộng 340px → 380px, body của tab Inspect scroll trong `max-height: 62vh`.
- Panel giờ render lại theo tab; state của tab Block (level slider, selector đã sửa tay, scope domain, custom domain) được giữ nguyên khi chuyển tab qua lại.
- Chuyển sang tab Inspect sẽ tự tắt Preview trước, vì Preview ẩn element nên mọi computed style sẽ đọc ra "không hiển thị".

### Notes

- Contrast chỉ tính khi element có **text node trực tiếp**. Element chỉ chứa element con sẽ báo "no direct text" thay vì đưa ra con số sai — muốn đo thì chọn đúng element chứa chữ.
- Nếu trên đường đi lên có `background-image`/gradient, kết quả được đánh dấu là ước lượng: extension đọc computed style chứ không sample pixel thật.
- Bộ check accessibility là bản rút gọn, bắt các lỗi phổ biến chứ **không thay thế** axe-core hay Lighthouse.
- Copy dùng `navigator.clipboard`, có fallback `execCommand` cho trang chặn clipboard API bằng permissions policy.

## [1.0.1] - 2026-07-22

### Fixed

- **Filter biến mất khi domain có `www.`** — rule tạo cho `website.com` giờ áp dụng cho cả `website.com`, `www.website.com` và mọi subdomain. Trước đây một exact rule chỉ khớp đúng hostname đã lưu, nên khi trang redirect sang `www.` (ví dụ trang chủ `animevietsub.wiki` → trang con `www.animevietsub.wiki`) thì filter không còn áp dụng. Việc so khớp giờ bỏ tiền tố `www.` theo cả hai chiều nên rule lưu là `www.website.com` cũng tương đương `website.com`.
- **Pattern `*.website.*` không áp dụng ở root domain** — nhánh so khớp trước đây bắt buộc phải có subdomain (`idx > 0`), nên `*.website.*` khớp `www.website.com` nhưng bỏ qua chính `website.com`. Giờ `*.website.*` khớp cả root domain lẫn subdomain, trên mọi TLD.

### Changed

- Khi tạo rule, tùy chọn scope mặc định lưu domain gốc (đã bỏ `www.`) thay vì hostname đầy đủ, giúp rule gọn và dùng lại được giữa `www.` và non-`www.`. Nhãn trong picker đổi thành `website.com (+ www & subdomains)` để phản ánh phạm vi mới.
- Cập nhật tài liệu so khớp domain trong `docs/spec.md` cho khớp hành vi mới.

### Notes

- Rule đã tạo từ trước **không cần tạo lại** — sau khi cập nhật, hãy reload extension (`chrome://extensions` → Reload) rồi refresh trang.
- Bảng so khớp domain sau bản vá:

  | Pattern         | Khớp                                      |
  | --------------- | ----------------------------------------- |
  | `website.com`   | root domain + `www.` + mọi subdomain      |
  | `*.website.com` | chỉ subdomain (không gồm root domain)     |
  | `website.*`     | root domain trên mọi TLD                  |
  | `*.website.*`   | root domain + mọi subdomain, trên mọi TLD |

## [1.0.0] - Initial release

### Added

- Chọn element trực tiếp trên page bằng picker UI (hover highlight + click để chọn).
- Tự generate CSS selector với slider điều chỉnh độ specificity.
- Preview element sẽ bị ẩn trước khi lưu rule.
- Lưu, quản lý, bật/tắt và xoá custom filter theo từng website.
- Wildcard domain: `website.*`, `*.website.com`, `*.website.*`.
- Tự động áp dụng rule khi page load, kèm MutationObserver cho nội dung động.
- Bật/tắt filter theo từng site trong popup.
- Context menu "Block element".
