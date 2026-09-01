# Spec: Storage Explorer Extension

## 1. Mục tiêu

Xây dựng browser extension cho phép **xem, sửa, xoá và snapshot** toàn bộ client-side storage của website đang mở, trong một cửa sổ duy nhất — không cần mở DevTools.

Phạm vi storage:

- `localStorage`
- `sessionStorage`
- Cookies (bao gồm HttpOnly, Secure, partitioned)
- IndexedDB (xem records, xoá database)

Điểm khác biệt so với DevTools Application tab:

- Gom cả 4 loại vào một bảng có search chung.
- Nhận diện kiểu giá trị (JSON / JWT / number / boolean) và pretty-print, decode JWT ngay trong editor.
- **Snapshot**: lưu nguyên trạng thái storage của site thành bản chụp có tên, restore lại sau. Dùng để tái tạo state khi test (đăng nhập user A, feature flag bật, giỏ hàng có 3 món…).
- Export/import snapshot ra file JSON để chia sẻ cho đồng đội.

Extension này bổ sung cho **Clean Site Data** (vốn chỉ xoá sạch): Storage Explorer là bản đọc–ghi chi tiết.

## 2. Định nghĩa

### 2.1. Target tab

Tab http(s) mà extension đang thao tác lên. Popup luôn lấy tab đang active. Dashboard mở ở tab riêng nên phải **gắn** (attach) vào một target tab cụ thể, chọn được qua dropdown ở header.

Nếu target tab bị đóng hoặc điều hướng sang origin khác, mọi thao tác trả lỗi và dashboard yêu cầu chọn lại tab.

### 2.2. Storage area

| Area           | Ký hiệu   | Phạm vi                       | Ghi được                  |
| -------------- | --------- | ----------------------------- | ------------------------- |
| localStorage   | `local`   | origin (scheme + host + port) | ✅                        |
| sessionStorage | `session` | origin + tab                  | ✅                        |
| Cookies        | `cookies` | registrable domain (eTLD+1)   | ✅                        |
| IndexedDB      | `idb`     | origin                        | ⚠️ chỉ đọc + xoá database |

### 2.3. Registrable domain

Giống Clean Site Data: eTLD+1 suy ra từ hostname, có xử lý public suffix nhiều nhãn (`co.uk`, `com.vn`, `vercel.app`…).

Cookie được liệt kê theo registrable domain chứ không chỉ hostname của tab, vì cookie session thường nằm ở domain cha (`.facebook.com` trong khi tab ở `www.facebook.com`).

### 2.4. Snapshot

Bản chụp storage của một origin tại một thời điểm:

```json
{
  "id": "snap_1753500000000_12345",
  "name": "Logged in as admin",
  "origin": "https://app.example.com",
  "hostname": "app.example.com",
  "createdAt": "2026-07-26T10:00:00.000Z",
  "note": "sau khi bật feature flag beta_checkout",
  "includes": { "local": true, "session": true, "cookies": true },
  "data": {
    "local": [{ "key": "token", "value": "eyJ..." }],
    "session": [{ "key": "step", "value": "3" }],
    "cookies": [
      {
        "name": "sid",
        "value": "abc",
        "domain": ".example.com",
        "path": "/",
        "secure": true,
        "httpOnly": true,
        "sameSite": "lax",
        "hostOnly": false,
        "expirationDate": 1790000000
      }
    ]
  },
  "stats": { "local": 12, "session": 2, "cookies": 8, "bytes": 45210 }
}
```

Snapshot **không** chứa IndexedDB (xem §12).

## 3. Phạm vi

### 3.1. Trong phạm vi

- Liệt kê / sửa / thêm / xoá entry của localStorage, sessionStorage.
- Liệt kê / sửa / thêm / xoá cookie của registrable domain.
- Duyệt IndexedDB: danh sách database → object store → records (read-only).
- Xoá một IndexedDB database.
- Tạo, đặt tên, restore, xoá snapshot.
- Export / import snapshot dạng JSON.
- Search toàn bộ key/value đang hiển thị.
- Nhận diện & format giá trị: JSON, JWT, number, boolean, chuỗi thường.

### 3.2. Ngoài phạm vi (v1)

- Sửa record trong IndexedDB.
- Cache Storage, Service Worker registrations (Clean Site Data đã xử lý phần xoá).
- Storage của iframe con / cross-origin frame (chỉ thao tác main frame).
- Đồng bộ snapshot lên server.
- Theo dõi realtime khi trang tự ghi storage (phải bấm Refresh).

## 4. Kiến trúc

```text
storage-explorer/
├── docs/spec.md
├── CHANGELOG.md
└── extension/
    ├── manifest.json
    ├── background.js            # service worker: điều phối, message router
    ├── popup.html / popup.js
    ├── dashboard.html / dashboard.js
    ├── modules/
    │   ├── page-agent.js        # hàm chạy trong page context (executeScript)
    │   ├── cookie-manager.js    # wrapper chrome.cookies + eTLD+1
    │   ├── snapshot-store.js    # CRUD snapshot/settings trên chrome.storage.local
    │   └── value-inspect.js     # nhận diện kiểu, format size, preview, decode JWT
    ├── styles/popup.css
    ├── styles/dashboard.css
    └── generate-icons.js
```

Không dùng content script thường trú. Mọi truy cập page storage đi qua `chrome.scripting.executeScript` với hàm tự chứa (self-contained) trong `page-agent.js` — inject theo yêu cầu, không chạy code trên mọi trang.

`page-agent.js` được `importScripts` vào service worker chỉ để lấy tham chiếu hàm; Chrome sẽ `toString()` hàm đó rồi chạy trong page. Vì vậy **mỗi hàm export phải tự chứa**, không gọi helper bên ngoài scope của nó.

## 5. Popup

Kích thước 320px, layout theo `popup.css` chung của repo.

Nội dung:

1. Header gradient + logo 📦.
2. Ô "Current site" hiển thị origin.
3. Lưới 4 ô đếm: Local / Session / Cookies / IndexedDB (số database).
4. Nút chính `📦 Open explorer` → mở `dashboard.html?tabId=<id>` ở tab mới.
5. Nút `📸 Save snapshot` → chụp local + session + cookies của origin hiện tại, đặt tên mặc định `<hostname> HH:mm`.
6. Nếu origin đã có snapshot: dropdown chọn snapshot + nút `♻️ Restore`.
7. Trang không phải http(s) → màn hình "This page is not supported."

Toast báo kết quả ở đáy popup.

## 6. Dashboard

Trang full-width (max 1200px), mở ở tab riêng.

### 6.1. Header

- Logo + tiêu đề + origin của target tab.
- Dropdown `Target tab` liệt kê mọi tab http(s) đang mở (`title — hostname`), đổi tab là reload dữ liệu.

### 6.2. Toolbar

| Nút                | Hành vi                                                         |
| ------------------ | --------------------------------------------------------------- |
| `🔄 Refresh`       | Đọc lại toàn bộ storage của target tab                          |
| `➕ Add entry`     | Mở drawer tạo entry mới cho tab đang xem (local/session/cookie) |
| `📸 Save snapshot` | Chụp local + session + cookies                                  |
| `⬇ Export JSON`   | Xuất dữ liệu tab đang xem, hoặc snapshot đang chọn              |
| `⬆ Import JSON`   | Nạp file snapshot                                               |
| `🗑 Clear area`    | Xoá sạch area đang xem (có confirm)                             |

### 6.3. Summary cards

4 thẻ: `Local`, `Session`, `Cookies`, `IndexedDB` — mỗi thẻ hiện số entry và tổng dung lượng ước tính (UTF-8 bytes của key + value).

### 6.4. Tabs

`Local Storage` · `Session Storage` · `Cookies` · `IndexedDB` · `Snapshots`, mỗi tab kèm badge số lượng.

### 6.5. Bảng

Cột theo từng tab:

- **Local / Session**: Key · Type · Size · Value (preview 1 dòng).
- **Cookies**: Name · Value · Domain · Path · Expires · Flags (`S` secure, `H` httpOnly, `P` partitioned) .
- **IndexedDB**: Database · Version · Object store · Records — bấm dòng để xem records.
- **Snapshots**: Name · Origin · Created · Contents · Actions (Restore / Export / Delete).

Bảng sort được theo cột, search lọc theo key + value + domain. Rỗng thì hiện empty state.

### 6.6. Drawer chi tiết

Bấm một dòng → drawer bên phải (theo `dashboard.css` của repo).

Với local/session:

- Input `Key` (khoá lại khi sửa entry cũ; đổi key = xoá + tạo mới).
- Textarea `Value` (monospace, cao 260px).
- Badge kiểu giá trị + kích thước.
- Nút `Format JSON` (pretty-print, báo lỗi nếu JSON không hợp lệ) và `Minify`.
- Nếu là JWT: panel phụ hiện header/payload đã decode + thời điểm `exp` dạng người đọc được. Panel này **chỉ để đọc**, không ký lại token.
- Nút `Save`, `Delete`, `Copy value`.

Với cookie: form Name · Value · Domain · Path · Expires (`datetime-local`, để trống = session cookie) · Secure · HttpOnly · SameSite.

Với IndexedDB: danh sách records (tối đa `idbRecordLimit`, mặc định 100), mỗi record hiện key + JSON preview; nút `Delete database`.

### 6.7. Snapshots tab

- Bảng snapshot của **mọi origin**, mặc định lọc theo origin của target tab, có checkbox `Show all origins`.
- `Restore`: mở dialog chọn phần cần restore (local / session / cookies), chế độ `Merge` (ghi đè key trùng, giữ key khác) hoặc `Replace` (xoá sạch area rồi ghi), và tuỳ chọn `Reload tab after restore`.
- Cảnh báo khi restore snapshot của origin khác với target tab (vẫn cho phép, vì đôi khi cần copy state từ staging sang local).

## 7. Đọc/ghi từng loại storage

### 7.1. localStorage / sessionStorage

Chạy trong page context qua `executeScript`, target `{ tabId, frameIds: [0] }`.

Đọc: duyệt `store.key(i)` → `{ key, value, size }` với `size = TextEncoder().encode(key).length + encode(value).length`.

Ghi: `setItem`. Bắt `QuotaExceededError` và trả lỗi rõ ràng lên UI.

Truy cập storage có thể ném lỗi khi site chặn cookie/third-party context → trả `{ ok: false, error }` cho từng area, không làm hỏng cả lần đọc.

### 7.2. Cookies

Dùng `chrome.cookies`:

- List: `getAll({ domain: <eTLD+1> })` — bao trọn domain cha và mọi subdomain.
- Set: `chrome.cookies.set({ url, name, value, path, secure, httpOnly, sameSite, expirationDate, storeId, partitionKey })`. Bỏ trường `domain` khi cookie là `hostOnly`.
- Remove: `chrome.cookies.remove({ url, name, storeId, partitionKey })`.

`url` suy ra từ cookie: `${secure ? 'https' : 'http'}://${domain.replace(/^\./,'')}${path}`.

#### Khi Chrome từ chối cookie

`chrome.cookies.set` báo hỏng theo **hai** đường khác nhau, và phải xử lý riêng — đo trên Chrome 152:

| Tình huống                                     | Kết quả            |
| ---------------------------------------------- | ------------------ |
| `sameSite: "no_restriction"` + `secure: false` | **reject**         |
| Tên `__Secure-…` + `secure: false`             | **reject**         |
| Tên `__Host-…` có `domain`                     | **reject**         |
| Tên `__Host-…` với `path` khác `/`             | **reject**         |
| `url` sai scheme (không http/https)            | **reject**         |
| `expirationDate` nằm trong quá khứ             | **resolve `null`** |
| Cookie hợp lệ                                  | resolve cookie     |

Thông báo của Chrome ở nhánh reject chỉ là `Failed to parse or set cookie named "X"` — nêu đúng tên cookie rồi dừng, không nói vì sao. UI **phải bổ sung lý do** cho những trường hợp đã biết ở bảng trên; trường hợp ngoài danh sách thì giữ nguyên văn thông báo của Chrome chứ không đoán bừa.

Nhánh `resolve null` **không phải** là từ chối: Chrome nhận cookie rồi xoá ngay vì nó đã hết hạn — đúng ngữ nghĩa cookie. Báo "Chrome rejected" ở đây sẽ đẩy user đi tìm một lỗi định dạng không tồn tại, nên thông báo phải nói đúng chuyện đã xảy ra.

Trước 1.0.2 phần giải thích được gắn vào nhánh `if (!saved)`, tức chỉ chạy khi `set` resolve falsy — mà không tình huống hỏng nào trong bảng trên đi vào đó, trừ cookie hết hạn. Kết quả: dòng `SameSite=None requires Secure` là code chết, còn cookie hết hạn thì bị báo nhầm là bị từ chối.

### 7.3. IndexedDB

- Liệt kê: `indexedDB.databases()` (không có ở Firefox → trả `ok:false` và UI hiện thông báo không hỗ trợ).
- Mỗi database: mở bằng `indexedDB.open(name)` không truyền version (tránh trigger upgrade), đọc `objectStoreNames`, `count()` từng store, rồi `db.close()`.
- Records: `openCursor()` lấy tối đa N record, serialize an toàn (Blob/File/ArrayBuffer/Date/Map/Set → chuỗi mô tả) vì kết quả `executeScript` phải JSON-serializable.
- Xoá: `indexedDB.deleteDatabase(name)`, resolve cả khi `onblocked` (tab khác đang giữ kết nối) và báo cho user biết là bị block.

## 8. Snapshot

### 8.1. Tạo

Đọc local + session (page context) + cookies (`chrome.cookies`) của origin hiện tại → lưu vào `chrome.storage.local`.

Tên mặc định: `<hostname> HH:mm` — sửa được ngay sau khi tạo.

### 8.2. Restore

Với mỗi phần được chọn:

- `replace`: xoá sạch area trước rồi ghi lại toàn bộ entry của snapshot.
- `merge`: chỉ ghi đè key trùng, giữ nguyên key khác.

Cookie restore theo từng cookie, đếm số thành công / thất bại và liệt kê cookie lỗi (thường do `sameSite`/`secure` không hợp lệ trên origin hiện tại).

Sau khi restore, nếu bật `Reload tab after restore` thì `chrome.tabs.reload(tabId)` — cần thiết vì app thường chỉ đọc storage lúc khởi động.

### 8.3. Export / import

File JSON:

```json
{ "version": "1", "exportedAt": "…", "snapshots": [ … ] }
```

Import validate `version`, cấu trúc `snapshots`, và sinh lại `id` để không đè snapshot sẵn có.

## 9. Data model (`chrome.storage.local`)

```json
{
  "snapshots": [
    /* §2.4 */
  ],
  "settings": {
    "confirmDestructive": true,
    "reloadAfterRestore": true,
    "includeCookiesInSnapshot": true,
    "previewLength": 120,
    "idbRecordLimit": 100
  }
}
```

Snapshot có thể lớn (site nhiều localStorage) nên manifest xin `unlimitedStorage`.

## 10. Message protocol

Popup/dashboard → service worker qua `chrome.runtime.sendMessage`, response chuẩn `{ success, data } | { success: false, error }`.

| `type`                              | Payload                                      | Trả về                                    |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `getContext`                        | `{ tabId? }`                                 | `{ tabId, origin, hostname, url, title }` |
| `listTabs`                          | —                                            | `[{ id, title, hostname, url, active }]`  |
| `readAll`                           | `{ tabId }`                                  | `{ context, local, session, cookies }`    |
| `readIndexedDB`                     | `{ tabId }`                                  | `{ ok, databases }`                       |
| `readIdbStore`                      | `{ tabId, dbName, storeName, limit }`        | `{ ok, records, truncated }`              |
| `deleteIdbDatabase`                 | `{ tabId, name }`                            | `{ ok, blocked }`                         |
| `setEntry`                          | `{ tabId, area, key, value, previousKey? }`  | `{ ok }`                                  |
| `deleteEntry`                       | `{ tabId, area, key }`                       | `{ ok }`                                  |
| `clearArea`                         | `{ tabId, area }`                            | `{ ok, removed }`                         |
| `setCookie`                         | `{ tabId, cookie, previous? }`               | `{ ok }`                                  |
| `deleteCookie`                      | `{ tabId, cookie }`                          | `{ ok }`                                  |
| `clearCookies`                      | `{ tabId }`                                  | `{ removed, failed }`                     |
| `createSnapshot`                    | `{ tabId, name?, parts? }`                   | snapshot                                  |
| `listSnapshots`                     | `{ origin? }`                                | `[snapshot]`                              |
| `restoreSnapshot`                   | `{ tabId, snapshotId, mode, parts, reload }` | report                                    |
| `renameSnapshot` / `deleteSnapshot` | `{ snapshotId, name? }`                      | `{ ok }`                                  |
| `importSnapshots`                   | `{ payload }`                                | `{ added }`                               |
| `openDashboard`                     | `{ tabId }`                                  | —                                         |

## 11. Xử lý lỗi & edge case

| Tình huống                                              | Hành vi                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tab không phải http(s)                                  | Popup hiện "not supported"; dashboard yêu cầu chọn tab khác                                                                |
| Target tab bị đóng                                      | Lỗi `Target tab is gone. Pick another tab.` + tự refresh danh sách tab                                                     |
| Target tab đổi origin                                   | Vẫn thao tác được (dữ liệu là của origin mới) nhưng header cập nhật origin và cảnh báo nếu đang xem snapshot của origin cũ |
| `executeScript` bị chặn (Chrome Web Store, `chrome://`) | Trả lỗi "Cannot read this page (…)"                                                                                        |
| localStorage bị disable                                 | Area đó hiện lỗi riêng, các area khác vẫn chạy                                                                             |
| Quota vượt khi ghi                                      | Hiện nguyên message `QuotaExceededError`                                                                                   |
| `indexedDB.databases()` không hỗ trợ                    | Tab IndexedDB hiện thông báo trình duyệt không hỗ trợ liệt kê                                                              |
| Xoá IndexedDB bị block                                  | Báo "blocked by another tab — close other tabs and retry"                                                                  |
| Giá trị rất lớn (> 1MB)                                 | Bảng chỉ hiện preview; drawer cảnh báo trước khi render full                                                               |

## 12. Bảo mật

- Storage của site chứa token, session — extension đọc được toàn bộ. Snapshot vì thế **lưu cả credential** ở dạng plain text trong `chrome.storage.local`. UI phải nói rõ điều này ở tab Snapshots và trước khi export file.
- Extension không gửi bất kỳ dữ liệu nào ra ngoài; mọi thứ nằm trong máy.
- Không bao giờ tự động restore; restore luôn là hành động do user bấm.
- IndexedDB chỉ đọc trong v1 để tránh phá vỡ schema/index của app.

## 13. Permissions

| Permission                                  | Lý do                                      |
| ------------------------------------------- | ------------------------------------------ |
| `tabs`                                      | Lấy URL/title tab để chọn target           |
| `scripting`                                 | Inject hàm đọc/ghi web storage & IndexedDB |
| `cookies`                                   | CRUD cookie                                |
| `storage`                                   | Lưu snapshot + settings                    |
| `unlimitedStorage`                          | Snapshot có thể vượt quota 10MB mặc định   |
| `host_permissions: http://*/*, https://*/*` | Thao tác trên mọi site người dùng mở       |

## 14. Không làm trong v1

- Sửa/thêm record IndexedDB.
- Cache Storage, WebSQL.
- Diff hai snapshot.
- Auto-snapshot theo lịch.
- Sửa storage của iframe con.
