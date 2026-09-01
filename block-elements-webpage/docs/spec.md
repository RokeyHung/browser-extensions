# Spec: Extension filter / hide element theo website

## 1. Mục tiêu

Xây dựng browser extension cho phép user chọn một element bất kỳ trên website hiện tại và tạo filter để element đó không hiển thị nữa trong các lần truy cập sau.

Extension hoạt động tương tự tính năng **Content Filter / Block Element** của Brave:

- User có thể chọn element trực tiếp trên page.
- Extension tự generate CSS selector tương ứng.
- User có thể điều chỉnh độ cụ thể của selector.
- User tạo rule để ẩn element.
- Rule được lưu theo từng website.
- Khi user vào lại website đó, extension tự apply rule và ẩn element.

Extension cần hỗ trợ filter theo domain và pattern dạng:

```text id="4dsm59"
website.com
website.vn
website.*
*.website.com
```

Trong đó `website.*` dùng để match nhiều TLD khác nhau, ví dụ:

```text id="3au01a"
website.com
website.vn
website.co.jp
website.net
```

## 2. Phạm vi

### 2.1. Trong scope

Extension hỗ trợ:

- Chọn element trên page bằng UI trực quan.
- Hover highlight element.
- Click để chọn element cần block.
- Generate CSS selector cho element được chọn.
- Cho phép chỉnh độ specificity của selector.
- Preview element nào sẽ bị ẩn.
- Tạo filter rule.
- Lưu rule theo website/domain.
- Apply rule tự động khi page load.
- Quản lý danh sách custom filters.
- Enable/disable rule.
- Delete rule.
- Edit rule thủ công.
- Support wildcard domain dạng `website.*`.
- Support subdomain pattern dạng `*.website.com`.
- Support path-specific rule nếu cần.

### 2.2. Ngoài scope ở MVP

Không xử lý trong version đầu:

- Block network request.
- Block script execution.
- Block tracking.
- Sync rule qua cloud.
- Import full EasyList / uBlock filter list.
- AI detect element.
- Remove element server-side.
- Bypass anti-adblock phức tạp.
- Tự động nhận diện ads.
- Hỗ trợ extended CSS selector kiểu `:has-text`, `:contains`, `:matches-css` nếu chưa cần.

Ghi chú: MVP chỉ tập trung vào **cosmetic filtering**, tức là ẩn hoặc remove element ở phía DOM/CSS sau khi page load.

## 3. User stories

### US-01: Block element trên page hiện tại

Là user, tôi muốn right-click hoặc bấm icon extension rồi chọn element trên page để ẩn element đó khỏi website.

### US-02: Filter theo từng website

Là user, tôi muốn rule chỉ áp dụng cho website hiện tại, không ảnh hưởng website khác.

### US-03: Filter theo wildcard domain

Là user, tôi muốn tạo rule áp dụng cho nhiều domain tương tự nhau, ví dụ:

```text id="psp5wn"
website.*
```

để rule có hiệu lực trên:

```text id="3n8znh"
website.com
website.vn
website.net
```

### US-04: Chỉnh độ cụ thể của selector

Là user, tôi muốn tăng/giảm độ cụ thể của selector để có thể chọn:

- Chỉ đúng element hiện tại.
- Tất cả element cùng loại.
- Một nhóm element cùng class.
- Một container lớn hơn.

### US-05: Quản lý custom filters

Là user, tôi muốn xem, sửa, xoá, bật/tắt các filter đã tạo.

## 4. UX chính

## 4.1. Cách mở Block Element Mode

User có thể mở chế độ chọn element bằng một trong các cách:

### Cách 1: Context menu

User right-click trên webpage:

```text id="vz15mv"
My Extension
└── Block element
```

### Cách 2: Popup extension

User click icon extension:

```text id="n064tn"
Current site: https://website.com

[Block element]
[Manage filters]
```

Khi click `Block element`, extension inject picker UI vào page hiện tại.

## 4.2. Block Element Mode

Khi vào mode chọn element:

- Page chuyển sang trạng thái muted/dimmed.
- Cursor đổi sang dấu `+` hoặc crosshair.
- Khi hover vào element nào thì element đó được highlight.
- Extension hiển thị outline quanh element đang hover.
- Có tooltip nhỏ hiển thị selector tạm thời.

Ví dụ tooltip:

```text id="0fmpgn"
div.article-card > div.banner
```

User có thể:

- Click vào element để chọn.
- Nhấn `Esc` để cancel.
- Di chuột qua element khác để đổi target.

## 4.3. Filter creation panel

Sau khi user click chọn element, hiển thị panel ở góc dưới bên phải.

Ví dụ:

```text id="5i21bq"
Block element

Site:
website.com

Apply to:
( ) website.com  (+ www & subdomains)
( ) *.website.com
( ) website.*
( ) Custom

Selector:
div.article-card > div.banner

Specificity:
[ less specific ----●------ more specific ]

Matched elements: 1

[Preview] [Create] [Cancel]
```

Không có lựa chọn `Current page path only` — bản mock trước 1.2.0 liệt kê nó nhưng picker chưa bao giờ dựng nút đó; rule tạo từ picker luôn có `pathPattern: null`. Lọc theo path vẫn chạy ở tầng matcher (§5, `matchPathPattern`) và sửa được tay trong trang Manage Filters.

## 4.4. Specificity slider

Slider dùng để thay đổi selector được generate.

Ví dụ với element:

```html id="jfho9g"
<div id="ad-banner" class="banner sticky top">...</div>
```

Các level có thể là:

### Level 1: Less specific

```css id="8yeo7d"
.banner
```

Có thể match nhiều element hơn.

### Level 2: Medium

```css id="6kjgfv"
div.banner.sticky
```

Match nhóm element tương tự.

### Level 3: Specific

```css id="yv4dgk"
#ad-banner
```

Match chính xác element có ID.

### Level 4: Very specific

```css id="uffoch"
body > main > div:nth-of-type(2) > div#ad-banner.banner.sticky
```

Match gần như đúng element đã chọn.

Khi user kéo slider, extension phải:

- Update selector.
- Highlight toàn bộ element sẽ bị affected.
- Hiển thị số lượng matched elements.

## 4.5. Preview

Khi user click `Preview`:

- Các element match selector sẽ tạm thời bị ẩn.
- Rule chưa được lưu.
- User có thể restore bằng `Cancel`.

## 4.6. Create rule

Panel có bốn lựa chọn phạm vi, đứng ở `news.shop.co.uk` thì lần lượt là:

| Nút        | Pattern sinh ra     | Ghi chú                                   |
| ---------- | ------------------- | ----------------------------------------- |
| Bare       | `news.shop.co.uk`   | root + `www.` + mọi subdomain (§6.1)      |
| `*.domain` | `*.news.shop.co.uk` | chỉ subdomain (§6.2)                      |
| Any TLD    | `shop.*`            | nhãn site trên mọi TLD (§6.3)             |
| Custom     | user tự gõ          | dùng khi ba nút trên không diễn tả đúng ý |

Nhãn cho nút `Any TLD` là **nhãn site**, không phải "hostname bỏ nhãn cuối". Lấy nhãn kế cuối rồi bước sang trái chừng nào còn gặp nhãn registry (`co`, `com`, `net`, `org`, `edu`, `gov`, `ac`, `or`, `ne`, `go`, `mil`, `gob`, `nom`):

```text
shop.test             -> shop
www.shop.test         -> shop
news.shop.test        -> shop
shop.co.uk            -> shop
news.example.co.uk    -> example
```

Đây là **phỏng đoán để gợi ý pattern**, không phải cơ chế phân định phạm vi bảo mật — nó không cần chính xác tuyệt đối vì user luôn thấy pattern trước khi bấm `Create`, và `Custom` có sẵn cho những trường hợp đoán trượt. Host không có nhãn nào để khái quát (`localhost`, IP) thì nút `Any TLD` không hiện.

Trước 1.2.0 nhãn này được tính bằng `hostname.split('.').slice(0, -1).join('.')`, ra `news.shop` và `shop.co` — những chuỗi mà không hostname nào khớp được, nên nút này lặng lẽ tạo rule chết trên mọi host trừ dạng `label.tld` trần.

Khi user click `Create`:

- Rule được lưu vào extension storage.
- Element đang match selector bị ẩn ngay.
- Rule sẽ tự động apply lại khi user reload hoặc truy cập lại website.

Thông báo sau khi tạo:

```text id="2g4ihm"
Filter created.

website.com##div.article-card > div.banner
```

## 5. Rule syntax

Extension hỗ trợ 2 dạng rule.

## 5.1. Standard cosmetic rule

Dạng giống adblock cosmetic filter:

```text id="vmj3c6"
domain##selector
```

Ví dụ:

```text id="qa60fe"
example.com##.ad-banner
example.com##div.sidebar > div.promo
```

Ý nghĩa:

- Phần trước `##` là domain scope.
- Phần sau `##` là CSS selector.
- Element match selector sẽ bị ẩn trên domain đó.

## 5.2. Custom wildcard domain rule

Extension bổ sung cú pháp wildcard domain:

```text id="kkxgjm"
website.*##selector
*.website.com##selector
```

Ví dụ:

```text id="6m0kky"
website.*##.ad-banner
*.website.com##.popup
```

Ý nghĩa:

| Rule                    | Match                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| `website.com##.ad`      | Match `website.com`, `www.website.com` và mọi subdomain           |
| `*.website.com##.ad`    | Match `a.website.com`, `b.website.com` (không match root domain)  |
| `website.*##.ad`        | Match `website.com`, `website.vn`, `website.net`, `website.co.jp` |
| `*.website.*##.ad`      | Match root domain + mọi subdomain, trên mọi TLD                   |
| `example.com/path##.ad` | Chỉ match path cụ thể nếu hỗ trợ path rule                        |

## 5.3. Exception rule

Có thể hỗ trợ rule exception ở phase sau:

```text id="tvigcp"
domain#@#selector
```

Ví dụ:

```text id="j2azvr"
news.website.com#@#.ad-banner
```

Ý nghĩa:

- Không apply rule hide `.ad-banner` trên `news.website.com`.
- Dùng để override rule tổng quát như `website.*##.ad-banner`.

MVP có thể chưa cần exception rule.

## 6. Domain matching

## 6.1. Exact domain

Rule:

```text id="6vrvbc"
website.com##.banner
```

Match:

```text id="ewbcfr"
website.com
```

Cũng match (www + subdomain):

```text id="ewbcf2"
www.website.com
m.website.com
news.website.com
```

Không match:

```text id="otc7k3"
website.vn
another-website.com
```

Hành vi:

- `website.com` = root domain + `www.` + mọi subdomain (bỏ tiền tố `www.` khi so khớp).
- `*.website.com` = chỉ subdomain, không gồm root domain.

Ghi chú: một rule nhập là `www.website.com` được xử lý tương đương `website.com`.

## 6.2. Subdomain wildcard

Rule:

```text id="yyjotw"
*.website.com##.banner
```

Match:

```text id="gns90n"
a.website.com
news.website.com
dev.website.com
```

Không match:

```text id="4v3ow3"
website.com
website.vn
```

Nếu muốn match cả root domain và subdomain, user có thể tạo 2 rule:

```text id="nnsixr"
website.com##.banner
*.website.com##.banner
```

Hoặc extension có option:

```text id="ztsc3f"
[✓] Include root domain
```

## 6.3. TLD wildcard

Rule:

```text id="9p49bw"
website.*##.banner
```

Match — nhãn `website` đứng ở **bất kỳ vị trí nào** trong hostname, miễn là còn ít nhất một nhãn phía sau:

```text id="348je6"
website.com
website.vn
website.net
website.co.jp
www.website.com
news.website.co.jp
website.example.com
```

Không match:

```text id="17dyz5"
anotherwebsite.com
mywebsite.com
website
```

Quy tắc so khớp là **theo nhãn nguyên vẹn**, nên `mywebsite.com` không dính: `mywebsite` là một nhãn khác, không phải `website`. Yêu cầu còn ít nhất một nhãn phía sau là thứ giữ cho pattern không bao giờ khớp một TLD trần.

`base` được phép nhiều nhãn, nên pattern gõ tay như `example.co.*` vẫn chạy: khớp `example.co.uk`, `shop.example.co.uk`, không khớp `example.com`.

### Vì sao rộng đến mức này

Bản 1.1.0 định nghĩa `website.*` là "chỉ root domain trên mọi TLD" (`parts[0] === base`). Hệ quả là nút scope `Any TLD` trong picker tạo ra rule **không phủ chính trang vừa tạo nó**: đứng ở `www.shop.test` hay `news.shop.test` bấm nút đó thì rule lưu xong, hiện màn "Filter Created", rồi không bao giờ chạy. Xem §4.6.

Mở rộng sang "nhãn ở bất kỳ đâu" khiến `website.*` và `*.website.*` (§6.4) trở thành **đồng nghĩa**. Đây là đánh đổi có ý thức: giữ hai pattern phân biệt thì phải biết đâu là public suffix để tách nhãn site, tức phải mang theo một danh sách eTLD — đã cân nhắc và bỏ. `*.website.*` được giữ lại như một cách viết tương đương, không phải một ngữ nghĩa khác.

Đổi lại, `website.*` phủ rộng hơn ý user hay nghĩ: rule `shop.*` sẽ ẩn element trên `shop.bất-kỳ-đâu.com`. Với một extension chỉ ẩn element thì hậu quả tối đa là vỡ giao diện một site không liên quan, không đụng tới dữ liệu; ai cần hẹp hơn thì dùng scope `Custom`.

## 6.4. Root + subdomain + TLD wildcard

Có thể hỗ trợ advanced pattern:

```text id="s2jfry"
*.website.*##.banner
```

Match (gồm cả root domain, mọi TLD):

```text id="3uyoba"
website.com
news.website.com
m.website.vn
dev.website.co.jp
```

Từ 1.2.0, pattern này **đồng nghĩa với `website.*`** (§6.3) — cùng một hàm so khớp theo nhãn. Giữ lại vì rule cũ đã viết theo dạng này, và vì `*.website.*` đọc ra ý "mọi subdomain, mọi TLD" rõ hơn với người mới. Không có trường hợp nào hai pattern cho kết quả khác nhau.

## 7. Apply rule behavior

## 7.1. Khi page load

Extension content script chạy ở `document_start` hoặc `document_idle`.

Khuyến nghị:

- Inject CSS sớm nhất có thể để giảm flicker.
- Với rule đơn giản, dùng CSS injection.
- Với dynamic DOM, dùng MutationObserver để ẩn element mới xuất hiện.

Flow:

1. Content script lấy hostname/path hiện tại.
2. Gửi request sang background để lấy rules match website hiện tại.
3. Convert rules thành CSS.
4. Inject style tag vào document.
5. Theo dõi DOM bằng MutationObserver nếu cần.
6. Với element mới match selector, tiếp tục hide.

## 7.2. Hide strategy

MVP nên dùng CSS để ẩn element:

```css id="hidbts"
selector {
  display: none !important;
}
```

Có thể hỗ trợ thêm mode:

```css id="fbkytv"
visibility: hidden !important;
```

Hoặc remove khỏi DOM:

```js id="2an9yv"
element.remove();
```

Khuyến nghị MVP:

- Default là `display: none !important`.
- Không remove DOM thật để giảm risk làm hỏng logic website.
- Có option nâng cao `Remove from DOM` nếu user bật.

## 8. Data model

Rule được lưu trong `chrome.storage.local`.

Ví dụ:

```json id="xs5c0a"
{
  "rules": [
    {
      "id": "rule_001",
      "enabled": true,
      "domainPattern": "website.*",
      "pathPattern": null,
      "selector": ".ad-banner",
      "action": "hide",
      "hideMode": "display-none",
      "createdFromUrl": "https://website.com/news/1",
      "createdAt": "2026-07-09T11:00:00.000Z",
      "updatedAt": "2026-07-09T11:00:00.000Z",
      "matchedCountAtCreation": 1
    }
  ]
}
```

## 9. Manage Filters page

Extension cần có trang quản lý filter.

URL nội bộ:

```text id="20kt57"
chrome-extension://<extension-id>/options.html
```

Hoặc mở từ popup:

```text id="9pfwor"
[Manage filters]
```

## 9.1. Danh sách filter

Hiển thị dạng bảng:

| Enabled | Domain pattern | Selector     | Action | Created from         | Actions       |
| ------- | -------------- | ------------ | ------ | -------------------- | ------------- |
| ✓       | `website.*`    | `.ad-banner` | Hide   | `website.com/news/1` | Edit / Delete |

## 9.2. Edit rule

User có thể sửa:

- Domain pattern
- Selector
- Enabled/disabled
- Hide mode
- Path condition

Sau khi sửa, click:

```text id="8rntnb"
[Save changes]
```

## 9.3. Delete rule

Khi user xoá rule:

- Rule bị remove khỏi storage.
- Extension reload/apply lại filters.
- Element sẽ hiển thị lại sau khi page reload hoặc khi user click `Re-apply`.

Confirm message:

```text id="mlptdc"
Delete this filter?

website.*##.ad-banner

[Delete] [Cancel]
```

## 10. Popup UI

Khi click icon extension:

```text id="8w06cg"
Element Filter

Current site:
website.com

Active rules on this site: 3

[Block element]
[Inspect element]
[Show rules for this site]
[Manage all filters]

Toggle:
[✓] Enable filtering on this site
```

## 10bis. Inspect Element Mode

Cùng một picker, hai tab: `Block` tạo rule, `Inspect` báo cáo thông tin về element đã chọn. Mục tiêu là **xem trước khi ẩn** — biết selector có unique không, element đang chứa gì, và có vấn đề accessibility nào, trước khi quyết định block.

### 10bis.1. Cách mở

- Popup → `🔍 Inspect element`.
- Context menu → `Element Filter` → `Inspect element`.
- Đang ở tab `Block` thì bấm sang tab `Inspect` (không phải chọn lại element).

Inspect là read-only nên vẫn dùng được khi filtering đã tắt cho site đó.

### 10bis.2. Nội dung panel

| Mục             | Nội dung                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| Identity        | `tag#id.class` + đoạn text đầu của element                                        |
| CSS selectors   | Cả 4 level của specificity slider, mỗi level kèm số element khớp và nút Copy      |
| XPath           | Path neo theo id ổn định gần nhất, hoặc absolute path; kèm số node khớp           |
| Contrast        | Tỉ lệ tương phản WCAG, swatch màu chữ/nền, verdict AA/AAA/Fail                    |
| Accessibility   | Danh sách phát hiện, phân 3 mức error / warn / info                               |
| Computed styles | Size, display, position + z-index, font, overflow, opacity, margin/border/padding |

Badge số match dùng màu để đọc nhanh: xanh = unique (1 element), vàng = nhiều element, đỏ = 0 hoặc selector invalid. Đây là tín hiệu quan trọng khi chọn selector để block — selector khớp 30 element thường là quá rộng.

### 10bis.3. Contrast ratio

Công thức WCAG 2.1: `(L1 + 0.05) / (L2 + 0.05)` với `L` là relative luminance.

- Màu nền **không** lấy trực tiếp từ element mà đi ngược lên cây cha, alpha-composite từng lớp `background-color` cho tới khi gặp lớp đục. Nếu lên tới `<html>` vẫn còn trong suốt thì composite tiếp lên nền trắng mặc định của canvas.
- Màu chữ có alpha < 1 cũng được composite lên nền trước khi tính.
- Ngưỡng: text thường AA ≥ 4.5, AAA ≥ 7; text lớn (≥ 24px, hoặc ≥ 18.66px và bold ≥ 700) AA ≥ 3, AAA ≥ 4.5.
- Chỉ tính khi element có **direct text node**. Element chỉ chứa element con thì báo "không có text trực tiếp" thay vì đưa ra số sai.
- Nếu trên đường đi có `background-image`/gradient, hoặc có `background-color` không parse được, kết quả được đánh dấu là **ước lượng** — extension đọc computed style chứ không sample pixel thật.
- Trường hợp **không lớp cha nào tô gì cả** thì ngược lại: đó là trường hợp chắc chắn nhất, nền đúng bằng canvas trắng. Không được đánh dấu ước lượng. Trước 1.2.0 nhánh này dùng chung cờ với nhánh gradient, nên mọi element chữ thường trên mọi trang không set `background-color` (tức phần lớn trang) đều bị gắn dòng "Background involves an image or gradient" — sai nội dung, và làm cờ đó mất hết ý nghĩa ở chỗ nó thực sự đúng.

### 10bis.4. Accessibility checks

| Check                                               | Mức   |
| --------------------------------------------------- | ----- |
| `<img>` không có attribute `alt`                    | error |
| `alt=""` (ảnh trang trí)                            | info  |
| Element tương tác không có accessible name          | error |
| Accessible name chỉ đến từ `title`/`placeholder`    | warn  |
| Form control không có `<label>`/`aria-label`        | error |
| `<a>` không có `href`                               | warn  |
| `role` tương tác nhưng `tabindex < 0`               | error |
| `tabindex > 0`                                      | warn  |
| `aria-hidden="true"` bọc nội dung focusable         | error |
| Contrast dưới ngưỡng AA                             | error |
| Contrast đạt AA nhưng chưa AAA                      | info  |
| Element không hiển thị (display/visibility/opacity) | info  |

Accessible name được resolve theo thứ tự rút gọn: `aria-labelledby` → `aria-label` → `alt` → `<label>` → text content → `img[alt]` con → `title` → `placeholder`. Đây là bản đơn giản hoá của accname spec, đủ bắt các lỗi phổ biến chứ không thay thế axe-core.

## 11. Context menu

Extension cần tạo context menu:

```text id="2u49i7"
Element Filter
├── Block element
└── Inspect element
```

Khi user chọn `Block element` / `Inspect element`:

- Extension inject picker vào tab hiện tại.
- Bắt đầu picker với tab tương ứng đang mở.

## 12. Permissions

Chrome Manifest V3:

```json id="xt73mt"
{
  "manifest_version": 3,
  "name": "Element Filter",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "storage", "contextMenus", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ],
  "options_page": "options.html"
}
```

## 13. Technical components

## 13.1. File structure

```text id="f8b51f"
extension/
├── manifest.json
├── background.js
├── content.js
├── element-picker.js
├── element-inspector.js
├── selector-generator.js
├── rule-matcher.js
├── popup.html
├── popup.js
├── options.html
├── options.js
├── styles/
│   ├── picker.css
│   └── popup.css
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 13.2. `background.js`

Phụ trách:

- Tạo context menu.
- Nhận request từ popup/content script.
- Load/save rules từ `chrome.storage.local`.
- Inject element picker.
- Gửi matched rules cho content script.

`saveRule`, `updateRule` và `deleteRule` đều là read-modify-write trên **cả mảng** `rules`, nên hai lời gọi chồng nhau cùng đọc một trạng thái gốc rồi ghi đè nhau — rule của lượt trước biến mất không dấu vết. Cả ba nối tiếp qua **một hàng đợi promise** để mỗi lượt đọc được đúng thứ lượt trước vừa ghi. Cửa sổ đua đo được dưới 2ms nên không cú bấm nào chạm tới, nhưng picker mở ở tab thứ hai, hoặc một lượt Import rơi đúng lúc đang tạo rule, thì không cần chậm mới va vào nhau.

`matchDomainPattern` và `matchPathPattern` được **chép nguyên si** sang `rule-matcher.js` vì service worker không nạp được content script. Hai bản phải luôn cho cùng kết quả; hiện chưa có cơ chế chặn drift tự động, nên mọi thay đổi phải sửa cả hai file cùng lúc.

## 13.3. `content.js`

Phụ trách:

- Chạy trên page.
- Request danh sách rule match current URL.
- Inject CSS để hide element.
- Observe DOM changes.
- Nhận command bật/tắt picker.

## 13.4. `element-picker.js`

Phụ trách:

- Bật Block Element Mode.
- Làm mờ page.
- Highlight element khi hover.
- Detect element được click.
- Mở filter creation panel.
- Preview selector.
- Cancel/create rule.

## 13.4bis. `element-inspector.js`

Phụ trách phân tích thuần tuý, không đụng DOM và không render UI:

- Sinh XPath (neo theo id ổn định, hoặc absolute) và đếm số node khớp.
- Alpha-composite background qua các lớp cha để ra màu nền thực tế.
- Tính contrast ratio theo WCAG 2.1 và so với ngưỡng AA/AAA.
- Resolve accessible name theo bản rút gọn của accname spec.
- Chạy bộ check accessibility, trả về list `{ level, message }`.

`element-picker.js` gọi `ElementInspector.inspect(element)` rồi render kết quả.

## 13.5. `selector-generator.js`

Phụ trách generate selector theo nhiều level specificity:

- By ID.
- By class.
- By tag + class.
- By parent chain.
- By nth-of-type.
- By attribute nếu cần.

## 13.6. `rule-matcher.js`

Phụ trách:

- Parse rule string.
- Validate domain pattern.
- Match current hostname/path với rule.
- Convert wildcard domain sang regex nội bộ.
- Trả về rules cần apply.

## 14. Selector generation rules

## 14.1. Ưu tiên selector ổn định

Khi generate selector, extension nên ưu tiên:

1. `id` nếu id có vẻ ổn định.
2. Class name có ý nghĩa.
3. Attribute phổ biến:

   - `data-testid`
   - `data-test`
   - `aria-label`
   - `role`

4. Tag + class.
5. Parent chain.
6. `nth-of-type` là fallback cuối cùng.

## 14.2. Tránh selector không ổn định

Không nên ưu tiên selector chứa:

```text id="dp2yce"
random hash
dynamic generated class
timestamp
uuid
session id
```

Ví dụ class không ổn định:

```text id="bnqb9f"
.css-1abc23
.sc-fzqBkg
.jsx-123456
```

Nếu bắt buộc dùng, hiển thị warning:

```text id="5y1stz"
This selector may be unstable because it contains generated class names.
```

## 15. Preview & matched count

Khi selector thay đổi:

- Query DOM bằng `document.querySelectorAll(selector)`.
- Highlight tất cả matched elements.
- Hiển thị số lượng match.

Ví dụ:

```text id="hwl6vv"
Matched elements: 5
```

Nếu selector invalid:

```text id="jnhp0g"
Invalid CSS selector
```

Không cho Create rule nếu selector invalid.

## 16. Dynamic content support

Nhiều website render element sau khi page load, ví dụ SPA, lazy loading, infinite scroll.

Extension cần dùng `MutationObserver`:

```js id="h6gbkc"
const observer = new MutationObserver(() => {
  applyMatchedRules();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
```

Cần debounce để tránh ảnh hưởng performance.

Khuyến nghị:

```text id="1uqexq"
debounce: 100ms - 300ms
```

## 17. Performance requirements

- Không scan DOM liên tục không kiểm soát.
- Không tạo quá nhiều style tag.
- Rule nên được compile một lần sau khi load.
- MutationObserver cần debounce.
- Nếu số lượng rules quá lớn, group selector theo domain.
- Apply CSS selector bằng style tag thay vì loop remove từng node nếu có thể.

Ví dụ inject một style tag:

```css id="vn0uof"
.ad-banner,
.popup-promo,
div[data-testid='sponsor'] {
  display: none !important;
}
```

## 18. Error handling

## 18.1. Unsupported page

Không hỗ trợ:

```text id="vd4y9a"
chrome://
edge://
about:
file://
devtools://
```

Message:

```text id="3q1nur"
This page is not supported.
Please open a normal http/https website.
```

## 18.2. Invalid selector

Nếu selector không hợp lệ:

```text id="vnjige"
Invalid CSS selector. Please edit the selector.
```

## 18.3. No matched element

Nếu selector hiện tại không match element nào:

```text id="v9tldq"
No elements matched this selector.
```

Vẫn có thể cho lưu rule nếu user muốn, nhưng hiển thị warning.

## 18.4. Permission denied

Nếu không inject được script:

```text id="yi4hur"
Cannot access this page. Please check extension permissions.
```

## 19. Security & privacy

Extension không được:

- Gửi URL hoặc selector ra server.
- Thu thập browsing history.
- Đọc nội dung cookies/localStorage.
- Tự động tạo rule nếu user chưa xác nhận.
- Inject script từ remote source.
- Lưu nội dung HTML của page.
- Ghi log nhạy cảm.

Extension chỉ lưu:

- Domain pattern.
- CSS selector.
- Rule config.
- Created URL nếu cần debug.

## 20. Acceptance criteria

### AC-01: Mở Block Element Mode

Khi user click `Block element`, page hiện tại chuyển sang mode chọn element:

- Page bị làm mờ.
- Hover element thì element được highlight.
- Cursor đổi sang dạng chọn element.
- Nhấn `Esc` thì thoát mode.

### AC-02: Tạo filter

Khi user click vào một element và chọn `Create`, extension lưu rule và element đó bị ẩn ngay lập tức.

### AC-03: Apply lại sau reload

Sau khi user reload page, element đã block vẫn không hiển thị.

### AC-04: Filter theo website hiện tại

Rule tạo cho `website.com` không ảnh hưởng đến `another-site.com`.

### AC-05: Support `website.*`

Rule:

```text id="irwkn1"
website.*##.ad-banner
```

phải apply trên:

```text id="g0j7va"
website.com
website.vn
website.net
website.co.jp
www.website.com
news.website.co.jp
website.example.com
```

và không apply trên:

```text id="bgn11d"
anotherwebsite.com
mywebsite.com
website
```

Thêm: rule tạo bằng nút scope `Any TLD` phải apply trên **chính trang vừa tạo nó**, với mọi hình dạng hostname — `shop.test`, `www.shop.test`, `news.shop.test`, `shop.co.uk`, `news.example.co.uk`.

### AC-06: Support `*.website.com`

Rule:

```text id="a32d5i"
*.website.com##.ad-banner
```

phải apply trên:

```text id="d9x7k0"
news.website.com
m.website.com
```

và không apply trên:

```text id="s22wvj"
website.com
website.vn
```

### AC-07: Specificity slider

Khi user kéo slider specificity:

- Selector thay đổi.
- Matched count thay đổi tương ứng.
- Các element affected được highlight.

### AC-08: Preview

Khi user click `Preview`, element bị ẩn tạm thời nhưng rule chưa được lưu.

### AC-09: Cancel

Khi user click `Cancel` hoặc nhấn `Esc`, extension thoát Block Element Mode và không lưu rule.

### AC-10: Manage filters

User có thể:

- Xem danh sách rule.
- Edit rule.
- Disable rule.
- Delete rule.

Sau khi rule bị delete hoặc disable, element sẽ hiển thị lại sau khi reload hoặc re-apply filters.

## 21. MVP

Version đầu cần có:

- Popup extension.
- Context menu `Block element`.
- Element picker.
- Hover highlight.
- Click chọn element.
- Generate CSS selector.
- Specificity slider cơ bản.
- Preview.
- Create rule.
- Lưu rule bằng `chrome.storage.local`.
- Apply rule khi page load.
- Support exact domain.
- Support `website.*`.
- Support `*.website.com`.
- Manage filters page đơn giản.
- Enable/disable/delete rule.

## 22. Future improvements

Có thể mở rộng:

- Import/export custom filters.
- Support exception rule `#@#`.
- Support path-specific rule.
- Support regex domain.
- Support advanced selector.
- Support `:has()`.
- Support text-based selector.
- Sync filters qua browser account.
- One-click hide similar elements.
- Temporary hide until reload.
- Undo last created rule.
- Show rule hit count.
- Auto-detect unstable selector.
- Group rules by website.
