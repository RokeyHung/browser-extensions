# Spec: Extension clear/clean data cho website hiện tại

## 1. Mục tiêu

Xây dựng một browser extension cho phép người dùng xoá nhanh dữ liệu cục bộ của **website hiện tại đang mở** trên active tab, phục vụ việc debug, test login/session, reset cache/index/local data mà không cần thao tác thủ công trong DevTools.

Extension sẽ detect domain/origin của tab hiện tại và cho phép xoá các loại dữ liệu liên quan đến website đó như:

- Cookies / session cookies
- Local Storage
- Session Storage
- IndexedDB
- Cache Storage
- Service Worker
- WebSQL / File System nếu browser hỗ trợ
- Dữ liệu session liên quan đến trang hiện tại

## 2. Phạm vi

### 2.1. Trong scope

Extension hỗ trợ clear dữ liệu theo **current origin** của tab đang active.

Ví dụ user đang đứng tại:

```text
https://example.com/path/a
```

Extension sẽ clear dữ liệu thuộc origin:

```text
https://example.com
```

Các dữ liệu cần hỗ trợ:

| Loại dữ liệu    | Mô tả                                                 |
| --------------- | ----------------------------------------------------- |
| Cookies         | Xoá cookies thuộc domain hiện tại                     |
| Local Storage   | Xoá `localStorage` của trang hiện tại                 |
| Session Storage | Xoá `sessionStorage` của tab hiện tại                 |
| IndexedDB       | Xoá toàn bộ IndexedDB databases thuộc origin hiện tại |
| Cache Storage   | Xoá toàn bộ caches tạo bởi Cache Storage API          |
| Service Worker  | Unregister service workers thuộc origin hiện tại      |
| WebSQL          | Đi kèm mọi lượt dọn origin storage, không có ô riêng  |
| File System     | Đi kèm mọi lượt dọn origin storage, không có ô riêng  |

WebSQL và File System không có checkbox riêng trong popup: chúng là origin storage đời cũ, user không có cách nào biết mình có chúng hay không. Chúng được đưa vào `chrome.browsingData.remove` mỗi khi có ít nhất một loại origin storage được chọn (Local Storage, IndexedDB, Cache Storage hoặc Service Worker). Lượt dọn chỉ tick mỗi Cookies thì vẫn chỉ đụng cookie.

Sau khi clear xong, nếu user bật option `Go to homepage after cleaning`, extension điều hướng tab về trang chủ của site (origin root, ví dụ `https://animevsub.vn/`) thay vì reload URL hiện tại.

#### Mở rộng phạm vi theo wildcard `*.website.*`

Mặc định phạm vi dọn là registrable domain (eTLD+1) của tab và mọi subdomain của nó. Khi user bật option `Also clean *.<site>.*`, phạm vi mở rộng sang **mọi domain dùng chung site label, ở mọi subdomain và mọi TLD**:

```text
tab: https://www.facebook.com/abc
pattern: *.facebook.*
=> facebook.com, m.facebook.com, facebook.com.vn, login.facebook.net, ...
```

Quy tắc áp dụng đồng nhất cho mọi website, **không dựa trên bất kỳ danh sách domain cấu hình sẵn nào**. Site label được suy ra từ hostname bằng cách tách eTLD+1 rồi lấy nhãn đầu tiên. Domain khác label không bị đụng tới, ví dụ `facebookcdn.com` không khớp `*.facebook.*`.

Việc tách eTLD+1 cần biết đâu là public suffix, và được xử lý theo hai tầng trong `domain-utils.js`:

- **Luật suy diễn** (`isCountrySecondLevel`) — nhãn kế cuối thuộc nhóm registry (`co`, `com`, `net`, `org`, `edu`, `gov`, `ac`, `or`, `ne`, `go`, `mil`, `gob`, `nom`) đứng dưới ccTLD 2 ký tự thì là public suffix. Phủ `com.vn`, `co.uk`, `co.id`, `com.my`, `ac.jp`… kể cả quốc gia chưa từng được liệt kê. `web` không nằm trong nhóm vì `web.de` là site thật.
- **`NAMED_SUFFIXES`** — chỉ những gì luật không suy ra được: nhóm hosting coi mỗi subdomain là một site riêng (`github.io`, `vercel.app`, `pages.dev`, `workers.dev`…) và `me.uk`. Nếu thiếu nhóm này, dọn `alice.github.io` sẽ lan sang mọi project site khác.

Tách sai ở đây là lỗi nghiêm trọng chứ không phải cosmetic: `chrome.cookies.getAll({ domain })` khớp cả subdomain, nên registrable domain ra nhầm `co.id` đồng nghĩa xoá cookie của mọi site `.co.id`.

Giới hạn: Chrome không cung cấp API liệt kê mọi origin đang giữ storage, nên tập host của phạm vi wildcard được dựng từ hai nguồn mà site thực sự xuất hiện — cookie jar và các tab đang mở. Với IP address hoặc host một nhãn (`localhost`) thì không có site label nên option bị disable.

### 2.2. Ngoài scope

Không xử lý trong version đầu:

- Clear toàn bộ browser cache global.
- Clear data của tất cả website.
- Clear password/autofill/history/download history.
- Clear data của website khác không phải active tab.
- Clear data trong iframe cross-origin nếu không có quyền truy cập.
- Clear cache server-side/CDN.
- Clear HTTP disk cache theo từng domain nếu browser không hỗ trợ an toàn theo origin.

Ghi chú: Một số loại browser cache cấp thấp không thể xoá chính xác theo từng website bằng extension API. MVP nên tập trung vào dữ liệu theo origin như cookies, storage, IndexedDB, Cache Storage và Service Worker.

## 3. User story

### US-01: Clear dữ liệu website hiện tại

Là developer/tester, tôi muốn click extension trên trang hiện tại để xoá cache/session/local data của website đó, để có thể test lại trạng thái sạch mà không cần mở DevTools.

### US-02: Chọn loại dữ liệu cần xoá

Là user, tôi muốn chọn loại dữ liệu cần clear, ví dụ chỉ clear cookies hoặc clear cả IndexedDB và Cache Storage.

### US-03: Về trang chủ sau khi clear

Là user, tôi muốn extension tự đưa tab về trang chủ của site sau khi clear xong, vì URL sâu (deep link) thường 404 hoặc bật login wall khi session đã bị xoá.

### US-04: Xem kết quả clear

Là user, tôi muốn biết extension đã xoá thành công những gì và có loại dữ liệu nào không xoá được.

## 4. UI/UX

### 4.1. Popup chính

Khi user click icon extension, hiển thị popup gồm:

```text
Clean Current Site

Current site:
https://example.com

[✓] Cookies
[✓] Local Storage
[✓] Session Storage        (khoá, mờ đi khi Local Storage đang tick)
    Chrome clears this together with Local Storage, so it cannot be kept.
[✓] IndexedDB
[✓] Cache Storage
[✓] Service Worker

[✓] Go to homepage after cleaning

[Clean Site Data]
```

Ô `Session Storage` bị khoá bật khi `Local Storage` đang tick — xem §8.3. Cùng cách xử lý với hàng wildcard: một control không thể giữ lời hứa thì bị disable kèm dòng giải thích, chứ không để nguyên trông như còn tác dụng. Bỏ tick `Local Storage` thì ô mở lại đúng lựa chọn cũ của user.

### 4.2. Trạng thái sau khi clean

Sau khi click `Clean Site Data`, hiển thị kết quả:

```text
Clean completed

✓ Cookies
✓ Local Storage
✓ Session Storage
✓ IndexedDB
✓ Cache Storage
✓ Service Worker

Redirected to animevsub.vn
```

Nếu có lỗi:

```text
Clean completed with warnings

✓ Cookies
✓ Local Storage
✕ IndexedDB: Browser API not available
✓ Cache Storage
✕ Service Worker: Permission denied
```

### 4.3. Trường hợp không hỗ trợ

Nếu tab hiện tại không phải website hợp lệ, ví dụ:

```text
chrome://extensions
about:blank
file://...
```

Hiển thị:

```text
This page is not supported.
Please open a normal http/https website.
```

## 5. Luồng xử lý

### 5.1. Detect current site

1. Lấy active tab hiện tại.
2. Kiểm tra URL.
3. Chỉ cho phép xử lý URL có protocol:

   - `http:`
   - `https:`

4. Parse origin từ URL.

Ví dụ:

```text
Tab URL: https://example.com/products?id=1
Origin: https://example.com
Hostname: example.com
```

### 5.2. User click Clean Site Data

Extension thực hiện lần lượt:

1. Clear cookies theo domain/origin.
2. Inject script vào active tab để clear:

   - `localStorage`
   - `sessionStorage`
   - `IndexedDB`
   - `Cache Storage`
   - `Service Worker`

3. Dùng `chrome.browsingData` để xoá thêm dữ liệu theo origin, chỉ những loại user đã chọn:

   - `cookies`
   - `indexedDB`
   - `localStorage`
   - `cacheStorage`
   - `serviceWorkers`

   Kèm theo, khi có ít nhất một loại origin storage được chọn:

   - `fileSystems`
   - `webSQL`

   Cả bảy key đều được Chrome 152 chấp nhận cùng bộ lọc `origins` — đã đo từng key một, không key nào bị từ chối.

4. Tổng hợp kết quả.
5. Nếu user bật option, điều hướng active tab về origin root; nếu tab đã ở trang chủ thì reload.
6. Hiển thị kết quả trong popup.

## 6. Permission

Chrome Manifest V3 cần các permission chính:

```json
{
  "permissions": ["activeTab", "scripting", "cookies", "browsingData", "tabs"],
  "host_permissions": ["<all_urls>"]
}
```

### Giải thích

| Permission         | Mục đích                                                     |
| ------------------ | ------------------------------------------------------------ |
| `activeTab`        | Lấy quyền tạm thời với tab hiện tại khi user click extension |
| `scripting`        | Inject script để clear storage phía page                     |
| `cookies`          | Xoá cookies của current domain                               |
| `browsingData`     | Xoá dữ liệu browser lưu theo origin                          |
| `tabs`             | Đọc URL của active tab và reload tab                         |
| `host_permissions` | Cho phép thao tác với website được chỉ định                  |

Nếu muốn giảm quyền, có thể dùng `activeTab` trước, sau đó chỉ request permission khi cần.

## 7. Technical design

### 7.1. Cấu trúc extension

```text
extension/
├── manifest.json
├── popup.html
├── popup.js
├── background.js
├── cleaner.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
```

### 7.2. Thành phần

#### `popup.html`

Hiển thị UI checkbox và button clean.

#### `popup.js`

Phụ trách:

- Lấy active tab.
- Hiển thị current origin.
- Nhận lựa chọn từ user.
- Gửi request clean sang background/service worker.
- Hiển thị kết quả.

#### `background.js`

Phụ trách:

- Nhận message từ popup.
- Xử lý clear cookies.
- Gọi `chrome.browsingData.remove`.
- Inject script vào tab thông qua `chrome.scripting.executeScript`.
- Reload tab nếu cần.

#### `cleaner.js`

Script chạy trong page context để clear:

```js
localStorage.clear();
sessionStorage.clear();

const dbs = await indexedDB.databases();
for (const db of dbs) {
  indexedDB.deleteDatabase(db.name);
}

const cacheNames = await caches.keys();
for (const name of cacheNames) {
  await caches.delete(name);
}

const registrations = await navigator.serviceWorker.getRegistrations();
for (const registration of registrations) {
  await registration.unregister();
}
```

## 8. Data types detail

### 8.1. Cookies

Xoá cookies theo domain hiện tại.

Yêu cầu:

- Xoá cookies của hostname hiện tại.
- Xoá cả cookies có domain dạng:

  - `example.com`
  - `.example.com`
  - `sub.example.com`

- Hỗ trợ cả secure và non-secure cookies.

Acceptance criteria:

- Sau khi clean, user không còn login session nếu session được lưu bằng cookies.
- Cookies của domain khác không bị xoá.

### 8.2. Local Storage

Clear bằng content script:

```js
localStorage.clear();
```

Acceptance criteria:

- Key trong localStorage của current origin bị xoá hết.
- Không ảnh hưởng localStorage của website khác.

### 8.3. Session Storage

Clear bằng content script:

```js
sessionStorage.clear();
```

Acceptance criteria:

- Session storage của tab hiện tại bị xoá.
- Không ảnh hưởng tab/domain khác ngoài scope.

#### Session Storage đi liền với Local Storage

`chrome.browsingData.remove({ origins }, { localStorage: true })` dọn sạch cả DOM storage partition của origin, tức `sessionStorage` mất theo. Đo trên Chrome 152 bằng cách gọi thẳng API, không qua một dòng code nào của extension:

```text
seeded           { ls: "ls-value", ss: "ss-value" }
after bD(local)  { ls: null,       ss: null       }
```

Bước inject script không gây ra chuyện này — `clearPageData()` chỉ đụng đúng thứ được yêu cầu. Ma trận 6×6 (mỗi lượt tick đúng một ô) chỉ có duy nhất một ô lem, là ô này.

Không đánh đổi bằng cách bỏ `localStorage` khỏi `browsingData`: bước đó chính là thứ với tới được storage mà script trong trang không chạm được, bỏ đi thì Local Storage dọn không sạch. Thay vào đó popup khoá bật ô `Session Storage` khi `Local Storage` đang tick, kèm dòng giải thích. Lựa chọn thật của user được giữ riêng và trả lại nguyên vẹn khi bỏ tick `Local Storage`, nên khoá không ăn mất setting.

### 8.4. IndexedDB

Clear bằng:

```js
indexedDB.databases();
indexedDB.deleteDatabase(name);
```

Fallback:

- Nếu `indexedDB.databases()` không available, dùng `chrome.browsingData.remove` với `indexedDB`.

Acceptance criteria:

- IndexedDB databases thuộc current origin bị xoá.
- Nếu browser không hỗ trợ list database, hiển thị warning thay vì crash.

### 8.5. Cache Storage

Clear bằng:

```js
caches.keys();
caches.delete(name);
```

Acceptance criteria:

- Cache Storage được tạo bởi service worker/app shell bị xoá.
- Sau khi reload, app fetch lại asset/data mới nếu có.

### 8.6. Service Worker

Clear bằng:

```js
navigator.serviceWorker.getRegistrations();
registration.unregister();
```

Acceptance criteria:

- Service workers thuộc current origin bị unregister.
- Sau khi reload, service worker có thể được register lại nếu website có logic register.

## 9. Error handling

### 9.1. Unsupported URL

Nếu URL là:

```text
chrome://
edge://
about:
file:
devtools:
```

Không thực hiện clean và hiển thị message không hỗ trợ.

### 9.2. Permission denied

Nếu extension không có quyền truy cập tab hiện tại:

- Hiển thị lỗi rõ ràng.
- Không retry vô hạn.
- Gợi ý user cấp quyền hoặc reload page.

### 9.3. API not available

Nếu một API không tồn tại, ví dụ:

```js
indexedDB.databases;
```

Thì:

- Skip phần đó.
- Ghi warning.
- Vẫn tiếp tục clear các loại dữ liệu khác.

### 9.4. Một phần thất bại

Không fail toàn bộ process nếu chỉ một data type thất bại.

Ví dụ:

```text
Cookies: success
Local Storage: success
IndexedDB: failed
Cache Storage: success
```

## 10. Security & Privacy

Extension không được:

- Gửi URL, cookies, storage data ra server.
- Log nội dung cookies/localStorage.
- Thu thập browsing history.
- Tự động clear data khi user chưa click.
- Clear website khác ngoài website hiện tại nếu user không xác nhận.

Extension chỉ nên lưu setting local như:

```json
{
  "defaultSelectedDataTypes": ["cookies", "localStorage", "sessionStorage", "indexedDB", "cacheStorage"],
  "reloadAfterCleaning": true
}
```

Không lưu dữ liệu nhạy cảm.

## 11. Acceptance criteria

### AC-01

Khi user mở `https://example.com` và click extension, popup hiển thị đúng current site là:

```text
https://example.com
```

### AC-02

Khi user chọn tất cả option và click clean, extension xoá được:

- Cookies
- Local Storage
- Session Storage
- IndexedDB
- Cache Storage
- Service Worker nếu có
- WebSQL và File System, đi kèm không cần tick riêng

### AC-03

Extension không xoá data của domain khác.

Ví dụ đang đứng ở:

```text
https://example.com
```

Thì data của:

```text
https://another-site.com
```

không bị ảnh hưởng.

### AC-04

Nếu user bật `Go to homepage after cleaning`, tab hiện tại chuyển về origin root sau khi clean xong (tab đang ở trang chủ thì reload).

### AC-05

Nếu user đang ở `chrome://extensions`, extension không chạy clean và hiển thị message không hỗ trợ.

### AC-06

Nếu một loại dữ liệu không thể xoá, extension vẫn xoá các loại còn lại và hiển thị warning.

### AC-07

Loại dữ liệu user bỏ tick thì không bị đụng tới. Kiểm bằng ma trận: tick đúng một ô, năm ô còn lại phải còn nguyên sau lượt dọn. Ngoại lệ duy nhất là `Session Storage` khi `Local Storage` được tick — trường hợp đó ô bị khoá bật nên user không thể bỏ tick nó ngay từ đầu (§8.3).

## 12. MVP

Version đầu chỉ cần hỗ trợ Chrome Manifest V3 với các chức năng:

- Detect active tab origin.
- Clear cookies.
- Clear localStorage.
- Clear sessionStorage.
- Clear IndexedDB.
- Clear Cache Storage.
- Unregister Service Worker.
- Về trang chủ (origin root) sau khi clear.
- Hiển thị kết quả success/warning.

## 13. Future improvements

Có thể mở rộng thêm:

- Preset:

  - Clean session only
  - Clean storage only
  - Clean all site data

- Keyboard shortcut.
- Context menu: right click → Clean this site.
- Auto clean khi mở domain được chỉ định.
- Whitelist/blacklist domain.
- Export/import setting.
- Support Firefox.
- Hiển thị dung lượng storage trước khi clear nếu browser hỗ trợ.
- Clear data cho toàn bộ subdomains sau khi user xác nhận.
