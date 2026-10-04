# Changelog

Tất cả thay đổi đáng chú ý của extension **Element Filter** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.2.1] - 2026-10-04

### Fixed

- **Import một rule hỏng làm tắt filter trên mọi site** — `parseImport()` chỉ kiểm `r.domainPattern && r.selector` (truthy), nên file JSON có `domainPattern: 123` lọt vào storage. Ở `getRulesForUrl`, `matchDomainPattern` gọi `pattern.startsWith` trên số và ném lỗi giữa `rules.filter`, lỗi rơi vào `catch` chung và hàm trả `[]` — **cho mọi URL**. Đo: sau khi import đúng một rule như vậy, rule `shop.test##.content` không liên quan gì hết tác dụng (`display: block`). Trang options cũng chết theo vì `renderRules()` gọi `.toLowerCase()` trên cùng field đó. Nay sửa ở cả hai đầu: import chỉ nhận chuỗi khác rỗng, và worker bỏ qua **từng** rule sai hình dạng thay vì để một rule kéo sập cả danh sách — cần vì rule đã import trước bản này vẫn nằm trong storage. Trang options vẫn liệt kê những rule đó (qua `String()`) để user xoá được.
- **Một selector hỏng tắt luôn các rule đứng sau nó trên cùng trang** — `content.js` ghép mọi selector vào một style tag. Hộp `Edit` lưu mọi chuỗi khác rỗng, nên `.bad {` vào được storage và sinh ra `.bad { { display: none !important; }` — một block lồng nuốt rule `.after` phía sau (`display: block`). Import text cũng không kiểm selector.
- `isValidSelector()` trước đây chỉ thử `querySelector`, và đo trên Chrome 154 thì không parser nào đủ một mình: `.bad {` trượt `querySelector` nhưng qua `insertRule` (CSS nesting parse nó thành rule lồng), còn `a /*` qua `querySelector` nhưng khi ghép vào CSS thì mở comment tới cuối sheet. Nay hàm đòi qua **cả hai** — `querySelector` và `insertRule` vào một `CSSStyleSheet` nháp, phải ra đúng một `CSSStyleRule`. Picker, `Edit`, Import và `content.js` dùng chung hàm này: `Edit` báo `Invalid CSS selector. Please edit the selector.` và không lưu, Import gắn tag `INVALID` và bỏ qua, `content.js` lọc rule hỏng còn sót trong storage — một lần mỗi lượt nạp rule, không chạy lại theo MutationObserver.
- **Import và Clear All làm mất rule picker vừa lưu — 10/10 lần khi trùng thời điểm** — hàng đợi ghi của 1.2.0 chỉ bọc `saveRule`/`updateRule`/`deleteRule`; Import và Clear All vẫn đọc-sửa-ghi `rules` thẳng từ trang options, nằm ngoài hàng đợi. Spec §13.2 khi đó lại ghi rằng hàng đợi đã che trường hợp "Import rơi đúng lúc đang tạo rule" — điều đó sai. Đo bằng cách bắn `saveRule` và bấm Import cùng lúc, 10 lượt: mất rule 10/10. Nay cả hai đi qua hai message mới `importRules` / `clearRules` vào cùng hàng đợi: 0/10.
- **Không chặn được element chỉ mang class kiểu Tailwind** — `selector-generator.js` nối tên class, id và giá trị attribute thẳng vào selector. `md:flex` bị đọc thành pseudo-class, `w-1/2` là lỗi cú pháp. Đo trên `<div class="md:flex w-1/2 promo">` không có id: **cả 4 level** (`.md:flex`, `div.md:flex.w-1/2`…) đều invalid, nút Create bị khoá ở mọi level, user chỉ còn cách tự viết selector. Element có id thì chỉ level 2 hỏng. `aria-label='Close "dialog"'` cũng sinh ra `button[aria-label="Close "dialog""]`, là selector invalid. Nay mọi tên và giá trị đều qua `CSS.escape`: level mặc định ra `div.md\:flex.w-1\/2.promo`, khớp 1 element, Create bật, và rule tạo từ picker ẩn đúng element đó sau khi reload.
- **Cancel / ✕ / Esc để lại viền cam trên trang** — `deactivate()` gỡ overlay, panel và style preview nhưng quên style tag tô viền các element khớp selector (`ef-selector-match-style`). Đo sau Cancel: tag vẫn còn, `.content` vẫn `outline-style: solid` tới khi reload. Nay `deactivate()` gọi `clearHighlights()`.
- **`Show rules for this site` luôn trống** — popup mở `options.html?site=<hostname>` và trang options nhét hostname vào ô search, tức so chuỗi con với text của pattern. Đứng ở `www.shop.test`, popup báo "Active rules on this site: 1" mà danh sách hiện `0 of 1 filter`: `shop.test` không chứa chuỗi `www.shop.test`, và rule `shop.*` thì không bao giờ chứa. Nay trang options nạp `rule-matcher.js` và lọc bằng chính `matchDomainPattern`, hiện chip `Rules for www.shop.test` kèm nút ✕ để xem tất cả. Rule đang tắt vẫn được liệt kê để bật lại được. Đo lại với 3 rule `shop.test`, `shop.*` (tắt), `other.test`: hiện 2 rule đúng, `2 of 3 filters`.

### Security

- `importRules` và `clearRules` thay thế hoặc xoá cả danh sách rule, nên worker chỉ nhận chúng từ trang của chính extension (`sender.url` bắt đầu bằng `chrome.runtime.getURL('')`). Content script chạy trên mọi trang web; gửi hai message này từ đó nhận về `{ success: false }` và storage không đổi — đã kiểm. Không thêm permission nào.

### Notes

- Kiểm chứng end-to-end trên Chrome for Testing 154 qua CDP (popup, picker điều khiển bằng chuột thật, phím Esc thật, trang options, Export ra file thật, content script trong isolated world): 168 assertion pass trên hai bộ kịch bản, gồm các kịch bản đo lỗi ở trên chạy lại trên code đã sửa. Phủ thêm context menu (cả 3 mục tồn tại, `startPickerInTab` mở đúng tab), 15 check accessibility của Inspect với số contrast đo được, sinh selector, mọi đường Cancel của trang options, Export JSON/text rồi Import lại.
- Phát hiện của cùng đợt test **chưa sửa** trong bản này: `hideMode: visibility-hidden` chọn được ở `Edit` nhưng `content.js` luôn dùng `display: none`; rule chỉ áp sau `DOMContentLoaded` nên trên trang có script tải chậm 1.5s element vẫn hiện tới khoảng mốc 1540ms; script của chính trang có thể mở picker bằng `window.dispatchEvent(new CustomEvent('elementFilter:startPicker'))`; `pathPattern` không được xét lại khi SPA đổi URL bằng `pushState`; bấm `Block element` trong popup khi site đang tắt filter không có phản hồi gì. Nội dung trong iframe (kể cả cùng origin) không được lọc vì content script không chạy `all_frames` — spec chưa nói gì về iframe.
- Chưa kiểm được trong môi trường này: content script bị bỏ lại sau khi reload extension (`chrome.runtime.reload()` trên Chrome for Testing headless không nạp lại bản unpacked, trang extension báo `ERR_BLOCKED_BY_CLIENT`), và bấm context menu bằng chuột phải thật.
- Chrome 154 có component extension cũng chạy worker tên `background.js`, nên harness nhận diện extension qua `chrome.runtime.getManifest().name`. Fixture dùng `.zz` thay cho `.dev` vì `.dev` cũng nằm trong HSTS preload.

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
