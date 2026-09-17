# Spec: Link Param Cleaner

## 1. Mục tiêu

Xây dựng browser extension **xoá query param theo dõi khỏi URL trước khi trình duyệt mở sang website khác**.

Use case chính:

```text
User đang ở https://www.facebook.com/...
Bấm một link ra ngoài → URL đích bị gắn thêm ?fbclid=IwAR3...

User đang ở một forum
Bấm link ra ngoài → ?utm_source=forum&utm_medium=post&ref=abc123
```

Những param đó không phải của trang đích, chúng do **trang nguồn** gắn vào link. Extension theo dõi trang nguồn, ghi lại các param mà trang đó gắn vào link ra ngoài, và cho user tick chọn param nào cần xoá.

Ba quyết định định hình toàn bộ spec này:

- **Quy chiếu theo site nguồn**, không theo site đích. User "đang ở" đâu thì thêm site đó vào danh sách theo dõi — đúng như cách user gặp vấn đề.
- **Không tự ý xoá gì cả.** Thêm một site vào danh sách chỉ bật việc _thu thập_. Mỗi param mặc định `strip: false`; phải có một cú tick của user thì param đó mới bị xoá. Lý do: param không tự nó vô dụng — `?ref=`, `?id=`, `?token=` có thể là thứ trang đích cần để hiển thị đúng nội dung, xoá nhầm thì link gãy mà user không hiểu vì sao.
- **Chỉ đụng vào navigation ra ngoài site.** Đi lại trong cùng registrable domain không bị chạm tới, vì param nội bộ gần như luôn có nghĩa với chính site đó.

## 2. Định nghĩa

### 2.1. Watched site (site nguồn)

Một registrable domain (eTLD+1) mà user đã thêm vào danh sách theo dõi. Site được match **kèm mọi subdomain**: thêm `facebook.com` là bao luôn `www.facebook.com`, `m.facebook.com`, `l.facebook.com`.

Watched site luôn là nơi navigation **xuất phát**, không phải nơi nó đi tới.

### 2.2. External navigation

Một navigation main-frame mà:

- initiator là một watched site, và
- registrable domain của URL đích **khác** registrable domain của initiator.

Chỉ external navigation mới bị xử lý. `facebook.com → l.facebook.com` là nội bộ, không đụng tới.

### 2.3. Param

Một cặp `name=value` trong query string của URL đích. Extension làm việc ở mức **tên param**; giá trị chỉ dùng để hiển thị mẫu và mặc định không được lưu (§16).

### 2.4. Trạng thái của một param

| Trạng thái | Nghĩa                                                  |
| ---------- | ------------------------------------------------------ |
| `seen`     | Đã quan sát thấy, chưa tick — **không** bị xoá         |
| `strip`    | User đã tick — bị xoá khỏi mọi link ra ngoài của site  |
| `ignored`  | User đã "im lặng" param này — không xoá, không đếm nữa |

`ignored` tồn tại để bảng param không bị một param rác lặp lại làm nhiễu, mà vẫn không phải xoá record — xoá thì lần sau nó lại được thu thập lại từ đầu.

### 2.5. Registrable domain

Giống Clean Site Data / Storage Explorer: eTLD+1 suy ra từ hostname, có xử lý public suffix nhiều nhãn (`co.uk`, `com.vn`, `vercel.app`…). Dùng bản chép của [shared/domain-suffix.js](../../shared/domain-suffix.js) — extension này là đích thứ sáu trong [scripts/sync-domain-suffix.mjs](../../scripts/sync-domain-suffix.mjs).

Suy sai eTLD+1 ở đây có hậu quả thật: coi `github.io` là một site sẽ làm hai trang GitHub Pages của hai người khác nhau thành "nội bộ" của nhau, và rule xoá param của site này im lặng áp sang site kia.

## 3. Phạm vi

### 3.1. Trong phạm vi

- Thêm/xoá/bật/tắt watched site; thêm nhanh site đang mở từ popup.
- Tự động thu thập tên param trên link ra ngoài của watched site.
- Checkbox chọn param cần xoá, theo từng site.
- Xoá param ở tầng mạng, **trước khi** request đi ra.
- Trang quản lý: danh sách site → bảng param, bulk check/uncheck, thêm param thủ công.
- Export/import toàn bộ cấu hình ra file JSON.
- Log gọn các lần xoá (source → target, param nào bị xoá).
- Badge đếm số param đã xoá trên tab hiện tại.

### 3.2. Ngoài phạm vi (v1)

- Wildcard trong tên param (`utm_*`). Lý do kỹ thuật ở §6.3 — và mô hình thu-thập-rồi-tick làm cho nó phần lớn là thừa.
- Wildcard TLD trong site pattern (`facebook.*`) — §8.
- Xoá param theo cặp (site nguồn, site đích) cụ thể.
- Dọn param trong link khi user **copy link** hoặc khi hover (cần content script — §5.2).
- Bóc link redirect trung gian (`l.facebook.com/l.php?u=…`, `out.reddit.com/…`) để lấy URL thật.
- Danh sách tracking param dựng sẵn được bật tự động (extension có catalog nhưng chỉ dùng để gắn nhãn — §7.5).
- Sub-resource: chỉ xử lý main_frame, không đụng ảnh/XHR/iframe.
- Sửa POST body, sửa fragment (`#utm_source=…`).
- Firefox / Safari.

## 4. User stories

### US-01: Theo dõi site đang mở

User đang ở một site hay gắn param vào link ra ngoài → mở popup → bấm `Watch this site` → site vào danh sách ở chế độ thu thập, chưa xoá gì.

### US-02: Xem param mà site này gắn vào link

Sau vài lần bấm link ra ngoài, popup của site đó liệt kê các param đã quan sát được kèm số lần thấy và trang đích gần nhất.

### US-03: Chọn param cần xoá

User tick `fbclid` và ba param `utm_*` trong popup → từ lần bấm link kế tiếp, các param đó không còn trong URL của trang đích.

### US-04: Giữ lại param cần thiết

User **không** tick `id` và `ref` vì trang đích cần chúng → chúng vẫn được gửi đi nguyên vẹn. Mặc định của mọi param mới là không tick.

### US-05: Quản lý theo từng website

Trang options liệt kê mọi watched site, mỗi site có bảng param riêng; user tick/bỏ tick hàng loạt, xoá param, thêm param thủ công mà không cần chờ quan sát thấy.

### US-06: Export / import

User export cấu hình ra JSON để sao lưu hoặc mang sang máy khác, rồi import lại — có chọn ghi đè hay trộn.

### US-07: Kiểm chứng extension có làm gì đó không

User mở tab Activity để xem đúng những lần nào đã bị xoá param, xoá cái gì, từ đâu sang đâu.

## 5. Kiến trúc

```text
link-param-cleaner/
├── docs/spec.md
├── CHANGELOG.md
└── extension/
    ├── manifest.json
    ├── background.js              # service worker: router + webNavigation listener
    ├── popup.html / popup.js
    ├── options.html / options.js
    ├── modules/
    │   ├── domain-utils.js        # eTLD+1 (bản chép shared/domain-suffix.js) + so sánh cùng site
    │   ├── param-store.js         # CRUD site/param/settings/log trên chrome.storage.local
    │   ├── rule-builder.js        # site record → declarativeNetRequest dynamic rule
    │   ├── param-catalog.js       # nhãn gợi ý cho tên param đã biết
    │   └── collector.js           # đối chiếu navigation, rút param mới
    ├── styles/popup.css
    ├── styles/options.css
    └── generate-icons.js
```

### 5.1. Phân vai

| Thành phần      | Việc                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `background.js` | Nghe `webNavigation`, gọi `collector`, đồng bộ dynamic rule, trả lời message của popup/options |
| `rule-builder`  | Dịch trạng thái đã lưu thành rule DNR — **nguồn duy nhất** sinh rule                           |
| `collector`     | Quyết định một navigation có đáng ghi nhận không, và rút ra param mới                          |
| `param-store`   | Đọc/ghi `chrome.storage.local`, giữ nguyên hình dạng data model §9                             |
| popup / options | Chỉ render và gửi message — không chứa logic quyết định                                        |

### 5.2. Vì sao không có content script

Bản v1 **không inject gì vào trang**. Cách hiển nhiên hơn — content script bắt `click` rồi viết lại `href` — thua ở ba điểm biết trước:

- Nó chỉ thấy thẻ `<a>`. `window.open`, `location.href = …`, form GET submit đều lọt.
- Trang có thể viết lại `href` ở `mousedown`/`click` sau extension; đây là chiêu phổ biến của đúng loại trang hay gắn param.
- Nó bắt extension chạy code trên mọi trang, đổi lấy một thứ mà tầng mạng làm được sạch hơn.

Cái giá phải trả, nêu rõ ở đây để sau này không ai tưởng là bug: link hiện trên thanh trạng thái khi hover, và link user bấm chuột phải → _Copy link address_, vẫn là link bẩn. Chỉ URL **thực sự được mở** mới sạch.

## 6. Cơ chế xoá param

### 6.1. Dynamic rule của `declarativeNetRequest`

Mỗi watched site có **một** dynamic rule, sinh ra từ danh sách param đang `strip`:

```json
{
  "id": 1001,
  "priority": 1,
  "action": {
    "type": "redirect",
    "redirect": { "transform": { "queryTransform": { "removeParams": ["fbclid", "utm_source", "utm_medium"] } } }
  },
  "condition": {
    "initiatorDomains": ["facebook.com"],
    "excludedRequestDomains": ["facebook.com"],
    "resourceTypes": ["main_frame"],
    "requestMethods": ["get"]
  }
}
```

Đọc theo thứ tự các mệnh đề `condition`:

- `initiatorDomains` — chỉ áp dụng khi navigation **xuất phát từ** site đang theo dõi. Trường này khớp cả subdomain, nên nó chính là §2.1. Navigation do trình duyệt khởi tạo (gõ omnibox, bookmark, history) **không có initiator** nên không bao giờ khớp: URL user tự dán vào không bị đụng tới.
- `excludedRequestDomains` — loại đi navigation nội bộ (§2.2).
- `resourceTypes: ["main_frame"]` — chỉ URL trang, không đụng ảnh/XHR/iframe.
- `requestMethods: ["get"]` — §6.4.

Rule được ghi bằng `chrome.declarativeNetRequest.updateDynamicRules` mỗi khi site record đổi. `rule-builder` sinh toàn bộ rule từ store rồi thay trọn gói (`removeRuleIds` = mọi id đang có của extension, `addRules` = tập mới) — rẻ ở quy mô này và loại hẳn khả năng rule mồ côi khi user xoá site.

Site không có param nào `strip` thì **không sinh rule**. Danh sách theo dõi rỗng nghĩa là không có rule nào, đúng nghĩa "mặc định không xoá gì".

### 6.2. Vì sao redirect chứ không phải sửa link

`redirect` + `queryTransform` diễn ra trước khi request rời máy. URL bẩn **không bao giờ được gửi đi** — server đích không thấy `fbclid`, log của nó cũng không. Viết lại `href` trong trang chỉ sạch được những link mà extension kịp nhìn thấy.

Hệ quả phụ, là điều user sẽ thấy: address bar hiện URL sạch, và URL sạch mới là thứ vào history.

### 6.3. `removeParams` khớp tên **chính xác**

`queryTransform.removeParams` nhận một danh sách tên param, so khớp đúng chuỗi. Không wildcard, không regex. Nên `utm_*` không diễn đạt được — muốn wildcard thật phải chuyển sang `regexSubstitution`, tức tự viết regex xử lý vị trí đầu/giữa/cuối query, encoding, và dấu `?`/`&` còn lại. Đắt và dễ sai.

Mô hình của extension này né được chuyện đó: nó **thu thập tên param thật đã quan sát được**, nên khi user muốn bỏ `utm_*` thì `utm_source`, `utm_medium`, `utm_campaign` đã nằm sẵn trong bảng, tick một phát là xong. Nút `Select all matching utm_` ở §11.2 tick giúp, nhưng thứ được lưu vẫn là tên đầy đủ.

Một param xuất hiện lần đầu **không** bị xoá, kể cả khi nó là `utm_term` còn `utm_source` đã bị tick. Đây là chủ ý, không phải thiếu sót: quy tắc "chỉ xoá thứ user đã tick" không có ngoại lệ.

`removeParams` **phân biệt hoa thường** — đo trên Chrome 153: với `fbclid` đang tick, link `?FBCLID=upper&fbclid=lower&id=4` mở ra thành `?FBCLID=upper&id=4`. Nên collector giữ nguyên dạng chữ đã quan sát và để `FBCLID` với `fbclid` là hai dòng riêng; chỉ phần gắn nhãn (§7.5) mới hạ về chữ thường, vì nhãn không quyết định cái gì bị xoá.

Một tên xuất hiện nhiều lần trong cùng URL bị xoá **hết** mọi lần — đo: `?fbclid=one&fbclid=two&id=5` mở ra thành `?id=5` — và được đếm là một lần quan sát (`seen` 5 → 6).

### 6.4. Chỉ `GET`

Redirect một navigation `POST` sẽ biến nó thành `GET` và mất body — form gửi đi hỏng mà user không hiểu vì sao. `requestMethods: ["get"]` chặn hẳn khả năng đó. Form GET sang site khác vẫn được xử lý bình thường, vì tham số của nó nằm trong query.

### 6.5. Vòng lặp redirect

Khi rule khớp nhưng không có param nào để xoá, URL sau transform trùng URL gốc. Chrome bỏ qua redirect tới chính URL đang request, nên không có vòng lặp — **đã đo**, không phải suy: với rule của `site-a.test` đang bật, link sang `site-b.test/landing?id=9` (không param nào bị tick) mở bình thường, không `ERR_TOO_MANY_REDIRECTS`, và server fixture ghi nhận **đúng một** request cho URL đó.

Phương án dự phòng nếu hành vi này đổi ở bản Chrome sau: tách thành một rule cho mỗi (site, param), với `condition.urlFilter` chứa `<name>=` để rule chỉ khớp khi param thực sự có mặt. Đắt hơn về số rule (§6.6) nên chỉ dùng khi buộc phải.

### 6.6. Giới hạn số rule

Một rule/site giữ số rule bằng số watched site — xa giới hạn dynamic rule của Chrome. Store vẫn áp trần mềm ở §9.3 (`maxSites`) để một lần import hỏng không đẩy extension vượt giới hạn và làm `updateDynamicRules` ném lỗi cho **toàn bộ** tập rule.

## 7. Thu thập param

### 7.1. Nguồn dữ liệu: `webNavigation`, không phải DNR feedback

Việc ghi nhận đi qua hai event:

| Event                          | Dùng để                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `onBeforeNavigate` (frameId 0) | Chụp URL **trước khi** DNR đụng vào — đây là nơi thấy param nguyên bản     |
| `onCommitted` (frameId 0)      | Biết URL **thực sự** đã mở, và đọc `transitionType`/`transitionQualifiers` |

Hiệu số giữa hai URL chính là danh sách param đã bị xoá — dùng cho log (§14) và badge. Cách này tự kiểm chứng: log chỉ ghi thứ thật sự biến mất khỏi URL cuối cùng, không phải thứ extension _tưởng_ rule của mình đã làm.

Không dùng `declarativeNetRequest.getMatchedRules` vì nó đòi thêm permission `declarativeNetRequestFeedback` (Chrome cảnh báo "đọc lịch sử duyệt web" lúc cài) để lấy một thông tin mà `webNavigation` đã có sẵn.

`onBeforeNavigate` **có** fire với URL gốc trước khi DNR redirect — đo trên Chrome 153: với `fbclid` đang tick, một cú bấm link sinh ra log `removed: ["fbclid"], kept: ["id"]`, tức extension vẫn nhìn thấy param trước khi nó bị xoá. Đó cũng là điều kiện để §7.4 thu thập được param mới trên một URL mà rule đã động vào.

Một DNR redirect sinh ra **lần `onBeforeNavigate` thứ hai** cho URL đã sạch. Lần đầu là lần duy nhất còn thấy param, nên bản ghi pending không bị ghi đè khi URL mới trỏ cùng origin + path (§7.2).

### 7.2. Xác định site nguồn

`onBeforeNavigate` không nói navigation đến từ đâu, nhưng **tab thì có**: `tab.url` chỉ đổi lúc commit, nên tại thời điểm đó nó vẫn là trang đang rời đi (URL mới nằm ở `tab.pendingUrl`).

| Tình huống                       | Site nguồn                                                |
| -------------------------------- | --------------------------------------------------------- |
| Bấm link, cùng tab               | `tab.url` của chính tab đó                                |
| Link `target="_blank"` / tab mới | Tab mới chưa có URL → `tab.openerTabId` rồi đọc `tab.url` |
| Không tra được tab               | Bỏ qua navigation, không ghi nhận gì                      |

Đọc thẳng từ tab thay vì giữ map `tabId → URL` trong bộ nhớ: MV3 hay tắt service worker đúng vào lúc navigation xảy ra, mà map thì chết theo worker còn tab thì không. Popup Redirect Guard phải đẩy map của nó xuống `storage.session` vì lý do này; ở đây không cần map nào cả.

Bản ghi pending giữa `onBeforeNavigate` và `onCommitted` vẫn nằm trong RAM (TTL 60s): mất nó chỉ hụt một lần ghi nhận, còn rule — thứ không được phép mất — nằm ở Chrome chứ không ở worker.

### 7.3. Điều kiện ghi nhận

Một navigation được thu thập khi **tất cả** đúng:

1. Site nguồn khớp một watched site đang `enabled`.
2. Registrable domain đích khác site nguồn.
3. URL đích là `http`/`https` và có query string.
4. `onCommitted` báo `transitionType` là `link` hoặc `form_submit`, và `transitionQualifiers` không chứa `from_address_bar`.

Điều kiện 4 loại bỏ omnibox, bookmark, history — chuyện đã học ở Popup Redirect Guard (changelog 1.1.2 của extension đó): chỉ đọc `transitionType` mà bỏ qua qualifier là không đủ. Ở đây chi phí nhầm thấp hơn nhiều — nhầm chỉ làm bảng param có thêm một dòng thừa, không chặn ai đi đâu cả — nên không cần tới lớp heuristic gesture như bên đó.

### 7.4. Rút param

Với URL đích, duyệt `new URL(target).searchParams.keys()`:

- Tên đã có trong site record → tăng `seen`, cập nhật `lastSeenAt`, `lastTargetHost`. Param đang `ignored` chỉ cập nhật `lastSeenAt`.
- Tên chưa có → thêm record mới với `state: "seen"`.
- Param trùng tên xuất hiện nhiều lần trong một URL → đếm là một.
- Tên rỗng, hoặc dài hơn 100 ký tự → bỏ, không ghi.

Khi số param của một site chạm `maxParamsPerSite` (§9.3), param mới bị bỏ và site được gắn cờ `truncated` để UI hiện cảnh báo — thay vì âm thầm đẩy param cũ ra, vì param cũ có thể là param user đã tick.

### 7.5. Catalog nhãn gợi ý

`param-catalog.js` giữ một bảng tra tên param đã biết, chỉ để **gắn nhãn** trong UI:

| Nhãn                     | Ví dụ                                                            | Hiển thị                           |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------- |
| `tracking`               | `utm_*`, `fbclid`, `gclid`, `msclkid`, `igshid`, `mc_eid`, `_ga` | Badge xám "tracking"               |
| `functional`             | `id`, `q`, `page`, `v`, `t`, `lang`, `token`, `code`, `redirect` | Badge vàng "có thể trang đích cần" |
| (không có trong catalog) | —                                                                | Không badge                        |

Catalog **không bao giờ tự tick**. Nó xếp param `tracking` lên đầu bảng để user nhìn thấy trước, và cảnh báo trước khi tick một param `functional`. Nhãn là gợi ý, không phải phán quyết: `ref` có thể là tracking trên site này và là tham số bắt buộc trên site khác — người duy nhất biết là user.

## 8. Site pattern

v1 chỉ nhận **registrable domain**, khớp kèm mọi subdomain:

```text
facebook.com     ✅  khớp facebook.com, www.facebook.com, m.facebook.com
*.facebook.com   ❌  thừa — đã bao gồm sẵn
facebook.*       ❌  không hỗ trợ trong v1
```

Đây là **khác biệt có chủ ý** so với Element Filter / Popup Redirect Guard / Form Fill Profiles, vốn đều hỗ trợ wildcard TLD. Lý do: ở các extension đó việc match do code của extension tự làm nên muốn hình dạng nào cũng được; ở đây việc match do Chrome làm trong `condition.initiatorDomains`, và trường đó chỉ nhận danh sách domain cụ thể. Diễn đạt `facebook.*` sẽ phải liệt kê từng TLD đã quan sát được thành từng entry — một hình dạng sai lệch ngầm, user tưởng đã phủ hết mà thực ra chưa.

Nhập hostname đầy đủ (`www.facebook.com`) thì UI tự rút về eTLD+1 và **nói rõ đã rút**, chứ không im lặng lưu khác thứ user gõ.

## 9. Data model

`chrome.storage.local`.

### 9.1. Site record

```json
{
  "id": "site_1789600000000_4821",
  "site": "facebook.com",
  "enabled": true,
  "note": "",
  "truncated": false,
  "params": [
    {
      "name": "fbclid",
      "state": "strip",
      "seen": 27,
      "label": "tracking",
      "sample": null,
      "lastTargetHost": "example.com",
      "firstSeenAt": "2026-09-10T08:12:00.000Z",
      "lastSeenAt": "2026-09-17T03:41:00.000Z",
      "source": "collected"
    },
    {
      "name": "ref",
      "state": "seen",
      "seen": 4,
      "label": null,
      "sample": null,
      "lastTargetHost": "shop.example.com",
      "firstSeenAt": "2026-09-14T10:00:00.000Z",
      "lastSeenAt": "2026-09-16T21:05:00.000Z",
      "source": "collected"
    }
  ],
  "stats": { "cleanedCount": 118, "lastCleanedAt": "2026-09-17T03:41:00.000Z" },
  "createdAt": "2026-09-10T08:00:00.000Z",
  "updatedAt": "2026-09-17T03:41:00.000Z"
}
```

`source` là `collected` hoặc `manual` — để UI phân biệt param user tự thêm (chưa từng quan sát thấy, `seen: 0`) với param thật sự gặp.

### 9.2. Activity log

```json
{
  "id": "log_1789600000000_77",
  "sourceSite": "facebook.com",
  "sourceUrl": "https://www.facebook.com/groups/123",
  "targetHost": "example.com",
  "removed": ["fbclid"],
  "kept": ["id"],
  "createdAt": "2026-09-17T03:41:00.000Z"
}
```

`sourceUrl` giữ nguyên path vì nó giúp user nhận ra ngữ cảnh; đó cũng chính là lý do log bị giới hạn, tắt được và xoá được bằng một nút (§16).

### 9.3. Settings

```json
{
  "collectEnabled": true,
  "storeSampleValues": false,
  "showBadge": true,
  "logEnabled": true,
  "logLimit": 200,
  "maxSites": 200,
  "maxParamsPerSite": 100,
  "warnOnFunctionalParam": true
}
```

### 9.4. Export file

```json
{
  "version": "1",
  "extension": "link-param-cleaner",
  "exportedAt": "2026-09-17T04:00:00.000Z",
  "sites": [
    {
      "site": "facebook.com",
      "enabled": true,
      "note": "",
      "params": [{ "name": "fbclid", "state": "strip", "seen": 27 }]
    }
  ],
  "settings": {}
}
```

Export **không** kèm `sample`, `lastTargetHost`, `sourceUrl` hay activity log: file này sinh ra để mang đi chia sẻ, mà những trường đó là lịch sử duyệt web. Thứ đáng chia sẻ là cấu hình — site nào, param nào, tick hay không.

Import validate `version` + `extension`, bỏ qua site có `site` không phải eTLD+1 hợp lệ, và báo số site/param đã nạp, số bị bỏ qua kèm lý do.

## 10. Popup

Rộng 320px, dùng `popup.css` chung của repo.

### 10.1. Site chưa được theo dõi

1. Header gradient + logo 🔗.
2. Ô `Current site` hiện registrable domain (kèm hostname đầy đủ nếu khác).
3. Dòng trạng thái: `Not watched — no params are being removed here.`
4. Nút chính `👁 Watch this site`.
5. Link `⚙ Manage all sites` → options page.

### 10.2. Site đang được theo dõi

1. Toggle bật/tắt site.
2. Dòng tóm tắt: `12 params seen · 4 removed · 118 links cleaned`.
3. **Bảng param có checkbox** — phần chính của popup:
   - Mỗi dòng: checkbox · tên param · badge nhãn · `×27` số lần thấy.
   - Sắp xếp: đang `strip` trước, rồi `tracking`, rồi `seen` giảm dần.
   - Tick/bỏ tick lưu ngay và đồng bộ rule ngay; không có nút Save.
   - Tick một param `functional` khi `warnOnFunctionalParam` bật → xác nhận một dòng ngay trong popup: _"`id` thường là tham số trang đích cần. Vẫn xoá?"_ với hai nút `Keep it` / `Remove it`, checkbox tạm bỏ tick trong lúc chờ. Phải là inline chứ không phải `window.confirm`: dialog lấy focus khỏi popup của browser action, popup đóng lại và câu trả lời đi theo. Trang options là tab bình thường nên ở đó `confirm` vẫn dùng được.
   - Quá 8 param thì cuộn trong khung, kèm link `See all 12 →` sang options.
4. Nút `🔗 Select all tracking` — tick mọi param có nhãn `tracking` của site này.
5. Dòng cuối: lần xoá gần nhất (`example.com · removed fbclid · 2m ago`).

### 10.3. Trang không hỗ trợ

URL không phải http(s) → màn hình `This page is not supported.`, chỉ còn link sang options.

## 11. Options page

Bố cục hai cột: danh sách site bên trái, chi tiết bên phải.

### 11.1. Danh sách site

Mỗi dòng: domain · toggle enabled · `N params` · `M stripped` · số link đã dọn. Có ô search, nút `➕ Add site` (nhập domain tay), nút xoá site (có confirm).

### 11.2. Bảng param của site đang chọn

| Cột         | Nội dung                                         |
| ----------- | ------------------------------------------------ |
| ☑          | Checkbox — tick là `strip`                       |
| Param       | Tên + badge nhãn + dấu `manual` nếu user tự thêm |
| Seen        | Số lần quan sát                                  |
| Last seen   | Thời điểm tương đối                              |
| Last target | Host đích gần nhất                               |
| Actions     | `Ignore` / `Unignore` · `Delete`                 |

Thanh công cụ: search theo tên param · `Select all` · `Clear all` · `Select all tracking` · `Select all matching…` (nhập tiền tố, ví dụ `utm_` → tick mọi param có tiền tố đó, nhưng lưu từng tên đầy đủ — §6.3) · `➕ Add param`.

Site có `truncated: true` hiện banner: _"Đã chạm trần 100 param cho site này; param mới không còn được ghi nhận. Xoá bớt param không dùng."_

### 11.3. Tab Activity

Bảng log theo §9.2: thời điểm · source → target · param đã xoá · param giữ lại. Lọc theo site, nút `Clear log`.

### 11.4. Tab Settings

Các switch theo §9.3, mỗi cái kèm một dòng giải thích. `storeSampleValues` có cảnh báo riêng (§16).

### 11.5. Import / Export

- `⬇ Export JSON` → file `link-param-cleaner-<yyyy-mm-dd>.json`.
- `⬆ Import JSON` → dialog chọn `Merge` (giữ site sẵn có, hợp nhất param, `state` trong file thắng) hoặc `Replace` (xoá sạch rồi nạp). Sau import, rule được sinh lại và báo cáo số site/param đã thay đổi.

## 12. Message protocol

Popup/options → service worker qua `chrome.runtime.sendMessage`. Response chuẩn `{ success, data } | { success: false, error }`.

| `type`           | Payload                    | Trả về                                      |
| ---------------- | -------------------------- | ------------------------------------------- |
| `getPopupState`  | —                          | `{ tab, site, watched, record, lastClean }` |
| `watchSite`      | `{ site }`                 | site record                                 |
| `unwatchSite`    | `{ id }`                   | `{ ok }`                                    |
| `setSiteEnabled` | `{ id, enabled }`          | site record                                 |
| `listSites`      | —                          | `[site record]`                             |
| `setParamState`  | `{ id, names: [], state }` | site record                                 |
| `addParam`       | `{ id, name }`             | site record                                 |
| `deleteParams`   | `{ id, names: [] }`        | site record                                 |
| `listLog`        | `{ site?, limit? }`        | `[log]`                                     |
| `clearLog`       | —                          | `{ removed }`                               |
| `getSettings`    | —                          | settings                                    |
| `setSettings`    | `{ patch }`                | settings                                    |
| `exportConfig`   | —                          | export payload (§9.4)                       |
| `importConfig`   | `{ payload, mode }`        | `{ sites, params, skipped: [] }`            |
| `syncRules`      | —                          | `{ rules }` — debug, sinh lại toàn bộ rule  |

Mọi message làm đổi watched site hoặc trạng thái param đều gọi `rule-builder` đồng bộ lại dynamic rule **trước khi** trả về, để UI không bao giờ hiện một trạng thái mà rule chưa theo kịp. `setSettings` là ngoại lệ có chủ ý: không setting nào tham gia vào việc sinh rule, đồng bộ ở đó chỉ tạo ấn tượng ngược lại.

## 13. Luồng chính

### 13.1. Theo dõi site

```text
Popup: Watch this site
 → background lấy tab active, suy eTLD+1
 → trùng site đã có? bật enabled
 → chưa có? tạo record, params: []
 → không sinh rule (chưa param nào strip)
 → popup chuyển sang giao diện §10.2, bảng param rỗng kèm gợi ý
   "Bấm vài link ra ngoài, param sẽ xuất hiện ở đây."
```

### 13.2. Thu thập

```text
webNavigation.onCommitted (frameId 0)
 → cập nhật map tabId → { url, site }

webNavigation.onBeforeNavigate (frameId 0)
 → tra site nguồn (§7.2) → không có / không watched → bỏ
 → đích cùng site → bỏ
 → giữ pending { tabId, originalUrl } chờ onCommitted

webNavigation.onCommitted (frameId 0) cho chính navigation đó
 → transitionType không phải link/form_submit → bỏ pending
 → rút param từ originalUrl → cập nhật site record (§7.4)
 → so originalUrl với committed URL → phần thiếu = đã bị xoá
 → ghi log + badge nếu có param bị xoá
```

### 13.3. Tick một param

```text
Popup/options: tick fbclid
 → setParamState { id, names: ["fbclid"], state: "strip" }
 → param-store lưu
 → rule-builder sinh lại toàn bộ rule → updateDynamicRules
 → trả site record mới → UI render lại
```

Không reload tab nào. Rule có hiệu lực từ navigation kế tiếp.

### 13.4. Import

```text
Chọn file → validate version/extension
 → mode merge: hợp nhất theo `site`, param theo `name`, state trong file thắng
 → mode replace: xoá sites cũ, nạp mới
 → sinh lại rule
 → báo cáo: N site, M param, K bị bỏ qua (kèm lý do)
```

## 14. Badge & phản hồi

- Badge trên action icon hiện số param đã xoá ở **tab hiện tại**, đặt bằng `chrome.action.setBadgeText({ tabId })` nên nó đúng theo từng tab.
- Badge reset khi tab điều hướng sang trang khác.
- `showBadge: false` thì tắt hẳn.
- Không toast, không notification: xoá param là việc thầm lặng và thành công của nó là _không có gì xảy ra_. Muốn kiểm chứng thì có tab Activity (§11.3).

## 15. Xử lý lỗi & edge case

| Tình huống                                   | Hành vi                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Tab không phải http(s)                       | Popup hiện "not supported"                                               |
| URL không parse được                         | Bỏ qua navigation, không ghi log, không ném lỗi                          |
| Hostname là IP hoặc `localhost`              | Không suy eTLD+1 → dùng nguyên hostname làm site                         |
| Hostname là public suffix trần (`github.io`) | Từ chối thêm vào watch list, nêu rõ lý do                                |
| `updateDynamicRules` ném lỗi                 | Giữ nguyên trạng thái đã lưu, hiện lỗi trong UI, không để rule nửa vời   |
| Import file sai định dạng                    | Không đụng gì vào store, báo lỗi kèm trường hỏng                         |
| Param có mặt nhiều lần trong URL             | `removeParams` xoá mọi lần xuất hiện; collector đếm là một               |
| Xoá hết param → URL còn `?` trống            | Chrome bỏ luôn `?`                                                       |
| Navigation bị site đích redirect tiếp        | Chỉ xử lý hop đầu; hop sau có initiator là site đích, không phải watched |
| Service worker bị kill giữa pending          | Mất một lần ghi nhận; rule vẫn nguyên vì rule nằm ở Chrome, không ở RAM  |
| Site vừa unwatch nhưng tab cũ còn mở         | Rule đã gỡ, navigation kế tiếp không bị đụng                             |

## 16. Bảo mật & quyền riêng tư

- Extension chạy hoàn toàn cục bộ, không gửi gì ra ngoài.
- **Giá trị param mặc định không được lưu** (`storeSampleValues: false`). Query string là nơi hay lọt token, email, session id, từ khoá tìm kiếm. Extension chỉ cần _tên_ param để làm việc của nó, nên "không lưu giá trị" là mặc định chứ không phải một tuỳ chọn ẩn. Bật lên thì sample bị cắt còn 32 ký tự và UI nói rõ dữ liệu này sẽ nằm trong file export nếu user tự thêm vào.
- Activity log chứa URL nguồn (kèm path) và host đích — tức một mẩu lịch sử duyệt web. Vì thế: giới hạn `logLimit` mặc định 200 dòng, tắt được bằng một switch, xoá được bằng một nút, và **không bao giờ nằm trong file export**.
- Extension không đọc nội dung trang, không đụng cookie/storage của site, không inject script (§5.2).
- `host_permissions` rộng là điều kiện bắt buộc của DNR redirect (cần quyền trên cả initiator lẫn URL đích); options page nói rõ điều này thay vì để user tự đoán từ màn hình cài đặt của Chrome.

## 17. Permissions

| Permission                                  | Lý do                                             |
| ------------------------------------------- | ------------------------------------------------- |
| `declarativeNetRequest`                     | Rule redirect + `queryTransform` (§6.1)           |
| `webNavigation`                             | Thu thập param và xác nhận kết quả (§7.1)         |
| `storage`                                   | Site record, settings, log                        |
| `tabs`                                      | Suy site nguồn cho tab mới (`openerTabId`), badge |
| `host_permissions: http://*/*, https://*/*` | Điều kiện để DNR được phép redirect (§16)         |

Không xin: `activeTab`, `scripting`, `cookies`, `declarativeNetRequestFeedback` (§7.1).

Manifest dự kiến:

```json
{
  "manifest_version": 3,
  "name": "Link Param Cleaner",
  "version": "1.0.0",
  "description": "Remove tracking query params from links before they open another site.",
  "permissions": ["declarativeNetRequest", "webNavigation", "storage", "tabs"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "options_page": "options.html"
}
```

## 18. Hiệu năng

- Việc xoá param do Chrome làm trong tầng mạng — chi phí mỗi navigation gần như bằng 0 và không phụ thuộc số param.
- Listener `webNavigation` chỉ làm việc thật khi site nguồn nằm trong watch list; đường thoát sớm là một phép tra Map.
- Một navigation = **một** lượt ghi `chrome.storage.local`: thu thập param và ghi log đi chung một read-modify-write. Không debounce theo thời gian — worker có thể bị tắt giữa chừng và cái được gom lại sẽ mất, trong khi thứ nó tiết kiệm được chỉ là vài lượt ghi.
- Mọi lượt ghi xếp hàng qua một promise chain. Hai tab commit cùng lúc là hai read-modify-write trên cùng khoá `sites`; không xếp hàng thì một trong hai mất trắng — đúng lỗi Popup Redirect Guard đã đo trên state theo tab của nó.
- Watch list được cache trong RAM của service worker, nạp lại khi worker khởi động và khi có `storage.onChanged`.

## 19. Icon

Nguồn: `link-broken-svgrepo-com.svg` (SVG Repo) hiện nằm ở root repo → chuyển vào `extension/icons/link-broken-source.svg`.

Hình: hai nửa mắt xích đứt rời, kèm ba tia văng ra ở góc trên trái. SVG gốc một màu `#1C274C`, hai nửa xích để `opacity: 0.5` — ở 16px độ tương phản đó sẽ mờ tịt, nên bản PNG dùng màu đặc: xích tím `#5546CB`, tia cam `#FF8859` để chi tiết nhỏ nhất vẫn tách khỏi nền.

`generate-icons.js` theo đúng khuôn các extension khác: chỉ dùng built-in của Node, tự viết PNG encoder, mô tả hình học trong hệ toạ độ `viewBox` của SVG nguồn, sample 4×4 mỗi pixel. Ở 16px bỏ bớt tia, giữ hai nửa xích đứt — đó là thứ còn đọc được ở cỡ đó.

## 20. Acceptance criteria

### AC-01: Theo dõi không đồng nghĩa với xoá

Thêm `site-a.test` vào watch list, bấm một link ra `site-b.test?fbclid=x&id=1` → URL mở ra **còn nguyên** cả hai param; `chrome.declarativeNetRequest.getDynamicRules()` trả về mảng rỗng.

### AC-02: Thu thập

Sau AC-01, popup của `site-a.test` liệt kê `fbclid` và `id`, mỗi cái `seen: 1`, `fbclid` có badge `tracking`.

### AC-03: Tick là xoá

Tick `fbclid` → bấm lại cùng link → URL mở ra là `site-b.test/?id=1`, và `fbclid` không có trong request tới `site-b.test` — kiểm bằng log của server fixture, không chỉ nhìn address bar.

### AC-04: Param không tick được giữ

Cùng lần điều hướng ở AC-03, `id=1` còn nguyên.

### AC-05: Navigation nội bộ không bị đụng

Từ `site-a.test` sang `sub.site-a.test?fbclid=x` → `fbclid` còn nguyên.

### AC-06: Navigation do trình duyệt khởi tạo không bị đụng

Dán thẳng `site-b.test?fbclid=x` vào omnibox từ tab đang ở `site-a.test` → URL mở ra còn `fbclid`, và param này **không** được ghi nhận thêm lần thấy nào.

### AC-07: Param mới không tự bị xoá

Với `utm_source` đang tick, bấm link có `utm_source` + `utm_term` (chưa từng thấy) → `utm_source` bị xoá, `utm_term` còn nguyên và xuất hiện trong bảng ở trạng thái chưa tick.

### AC-08: Form POST không hỏng

Submit một form POST từ `site-a.test` sang `site-b.test` → body tới nơi nguyên vẹn, không bị chuyển thành GET.

### AC-09: Quản lý theo site

Hai watched site cùng có `ref`; tick `ref` ở site A không làm đổi trạng thái `ref` ở site B.

### AC-10: Export / import

Export → xoá hết site → import `Replace` → danh sách site và trạng thái tick khớp bản gốc, dynamic rule được sinh lại đúng số lượng. File export không chứa `sourceUrl`, `sample` hay log.

### AC-11: Tắt site

Tắt toggle của `site-a.test` → rule của site đó bị gỡ khỏi dynamic rules; param và trạng thái tick vẫn còn khi bật lại.

## 21. Không làm trong v1

- Wildcard tên param và wildcard TLD trong site pattern (§3.2, §6.3, §8).
- Bóc link redirect trung gian.
- Dọn link lúc copy / hover (cần content script — §5.2).
- Rule theo cặp nguồn–đích.
- Danh sách tracking param dựng sẵn được bật mặc định.
- Đồng bộ cấu hình giữa các máy (`chrome.storage.sync`).
- Thống kê kiểu "đã chặn N tracker tuần này".
- Xử lý sub-resource, POST body, fragment.
