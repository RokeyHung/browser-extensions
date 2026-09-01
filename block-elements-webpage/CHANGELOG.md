# Changelog

Tất cả thay đổi đáng chú ý của extension **Element Filter** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-09-01

### Fixed

- **Nút scope `Any TLD` tạo ra rule chết ngay lúc tạo** — nặng nhất trong đợt này vì nó im lặng: rule lưu thành công, panel hiện màn "Filter Created", rồi rule không bao giờ chạy. Nhãn được tính bằng `hostname.split('.').slice(0, -1).join('.')`, nên `news.shop.test` ra pattern `news.shop.*` và `shop.co.uk` ra `shop.co.*` — những chuỗi mà `matchDomainPattern` không thể khớp, vì nhánh `X.*` khi đó đòi `parts[0] === X` tức X phải là **một** nhãn. Đo trên 5 hình dạng hostname: chỉ `shop.test` (đúng hai nhãn, không `www.`) là chạy, 4/5 còn lại rule chết.
- Nay nhãn được lấy là **nhãn site**: nhãn kế cuối, bước sang trái chừng nào còn gặp nhãn registry (`co`, `com`, `net`, `org`, `edu`…). Cả năm hình dạng đều ra pattern phủ đúng trang vừa tạo nó. Đây là phỏng đoán để gợi ý, không phải cơ chế phân định phạm vi — user luôn nhìn thấy pattern trước khi bấm `Create`, và `Custom` có sẵn cho lúc đoán trượt, nên không cần kéo theo một danh sách public suffix.
- **Inspect báo "Background involves an image or gradient" trên trang không hề có ảnh lẫn gradient** — `effectiveBackground()` bật cờ `uncertain` ở cả hai nhánh: gặp `background-image` thật, **và** không lớp cha nào tô gì cả. Nhánh sau lại là trường hợp _chắc chắn nhất_ — nền đúng bằng canvas trắng, tỉ lệ 21:1 chính xác tuyệt đối. Đo chuỗi cha trên trang trống: `background-image` là `none` ở cả `p`, `body`, `html`, vẫn dính cảnh báo. Vì trang không set `background-color` trên `html`/`body` là phần lớn trang, gần như mọi element chữ thường đều bị gắn dòng sai này, và cờ đó mất hết ý nghĩa ở chỗ nó thực sự đúng. Nay `uncertain` chỉ còn mang đúng nghĩa câu thông báo của nó.
- **Hai lượt ghi rule chồng nhau thì mất một** — `saveRule`, `updateRule`, `deleteRule` đều là read-modify-write trên cả mảng `rules`. Cùng loại lỗi với `Settings.save()` của full-page-capture 1.2.3. Đo cửa sổ đua: cách nhau 0–1ms thì mất một rule, từ 2ms trở lên thì không. Không cú bấm nào chạm tới được, và Import ghi cả mảng bằng một `set` nên cũng không lặp `saveRule` — tức đây là rủi ro tiềm ẩn chứ chưa cắn ai. Vẫn sửa: cả ba nối tiếp qua một hàng đợi promise.

### Changed

- **`website.*` mở rộng thành "nhãn ở bất kỳ đâu trong hostname, mọi TLD"** (§6.3). Trước đây là "chỉ root domain trên mọi TLD" (`parts[0] === base`), nên `website.*` không phủ `www.website.com` hay `news.website.co.jp` — chính là lý do nút `Any TLD` không phủ nổi trang đang đứng. So khớp theo **nhãn nguyên vẹn** nên `mywebsite.com` vẫn không dính, và vẫn đòi ít nhất một nhãn phía sau nên pattern không bao giờ khớp một TLD trần. `base` nhiều nhãn cũng chạy: `example.co.*` khớp `example.co.uk` và `shop.example.co.uk`, không khớp `example.com`.
- Hệ quả có ý thức: `website.*` và `*.website.*` (§6.4) nay **đồng nghĩa**. Giữ hai ngữ nghĩa phân biệt thì phải biết đâu là public suffix để tách nhãn site, tức phải mang theo danh sách eTLD — đã cân nhắc và bỏ. `*.website.*` giữ lại như cách viết tương đương.
- Đổi lại phạm vi rộng hơn ý user hay nghĩ: rule `shop.*` sẽ ẩn element trên `shop.bất-kỳ-đâu.com`. Với extension chỉ ẩn element thì hậu quả tối đa là vỡ giao diện một site không liên quan, không đụng dữ liệu; ai cần hẹp hơn dùng scope `Custom`.

### Notes

- Kiểm chứng end-to-end trên Chrome for Testing 152 qua CDP, 193/193 assertion. `rule-matcher.js`, `selector-generator.js` và `element-inspector.js` là content script nên nằm trong isolated world mà `Runtime.evaluate` mặc định không với tới; suite bắt `Runtime.executionContextCreated`, tìm context tên `Element Filter` rồi evaluate thẳng vào đó — thứ được test là code trình duyệt thực sự nạp, không phải bản chép lại require trong Node.
- 26 cặp domain pattern được chạy trên **cả hai** bản copy của `matchDomainPattern` và assert chúng đồng ý với nhau, vì `background.js` và `rule-matcher.js` giữ hai bản chép tay không có cơ chế chặn drift.
- Picker được điều khiển bằng chuột thật qua `Input.dispatchMouseEvent` (mouseover trước rồi mới click, vì picker bám target qua `mouseover`), phủ AC-01/02/07/08/09 và cả 5 hình dạng hostname cho nút `Any TLD`.
- Hostname trong fixture phải bịa dạng `.test`: `website.com`, `shop.com` là domain thật và HSTS-preloaded, Chrome nâng `http://` lên `https://` trước khi `--host-resolver-rules` kịp áp dụng và mọi trang chết ở `ERR_SSL_PROTOCOL_ERROR` — một lần lỗi này đã lọt qua vì trang lỗi vẫn đạt `readyState === "complete"`, nên suite giờ chặn thẳng ở bước điều hướng.

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

- **Logo trong header dùng chính icon của extension** thay cho ô chữ `F`, ở cả popup và trang options. Trước đây đây là extension duy nhất có logo trong UI không liên quan gì tới icon trên toolbar.
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
