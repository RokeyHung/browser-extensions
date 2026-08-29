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
| WebSQL          | Xoá nếu browser/API hỗ trợ                            |
| File System     | Xoá nếu browser/API hỗ trợ                            |

Sau khi clear xong, nếu user bật option `Go to homepage after cleaning`, extension điều hướng tab về trang chủ của site (origin root, ví dụ `https://animevsub.vn/`) thay vì reload URL hiện tại.

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
[✓] Session Storage
[✓] IndexedDB
[✓] Cache Storage
[✓] Service Worker

[✓] Go to homepage after cleaning

[Clean Site Data]
```

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

3. Dùng `chrome.browsingData` để xoá thêm dữ liệu theo origin nếu API hỗ trợ:

   - `indexedDB`
   - `localStorage`
   - `cacheStorage`
   - `serviceWorkers`
   - `fileSystems`
   - `webSQL`

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
