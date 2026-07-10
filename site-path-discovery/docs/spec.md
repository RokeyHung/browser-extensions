# Spec: Website Path Discovery Extension

## 1. Mục tiêu

Xây dựng browser extension giúp user điều tra các path/URL có thể phát hiện được từ website hiện tại đang mở.

Extension sẽ thu thập path từ nhiều nguồn:

- Link có trên page hiện tại
- Navigation khi user duyệt website
- Network requests phát sinh từ website
- `robots.txt`
- `sitemap.xml`
- Crawl nội bộ có giới hạn

Mục tiêu là giúp dev/tester/BA nhanh chóng nắm được cấu trúc URL của website, bao gồm:

- Page routes
- API endpoints
- Asset paths
- External links/domains
- Sitemap URLs
- Paths được nhắc trong `robots.txt`

Extension **không đảm bảo tìm được 100% path server-side**. Extension chỉ phát hiện các path public, observable hoặc có thể discover từ browser context.

## 2. Định nghĩa

### 2.1. Path

Path là phần URL sau domain.

Ví dụ:

```text
https://example.com/products/123?tab=reviews
```

Path chính:

```text
/products/123
```

Full URL:

```text
https://example.com/products/123?tab=reviews
```

### 2.2. Same-origin path

URL thuộc cùng origin với website hiện tại.

Ví dụ current origin:

```text
https://example.com
```

Same-origin:

```text
https://example.com/about
https://example.com/products
https://example.com/api/users
```

Không same-origin:

```text
https://cdn.example.com/assets/app.js
https://another-site.com/about
```

### 2.3. Same-site path

URL thuộc cùng root domain hoặc subdomain liên quan.

Ví dụ current site:

```text
https://www.example.com
```

Same-site:

```text
https://example.com
https://www.example.com
https://api.example.com
https://cdn.example.com
```

### 2.4. Observable path

Path mà browser có thể thấy được thông qua:

- DOM link
- Navigation
- Network request
- Sitemap
- Robots.txt
- Crawl public page

## 3. Phạm vi

## 3.1. Trong scope

Extension hỗ trợ:

- Detect current website từ active tab.
- Scan link trong DOM của page hiện tại.
- Ghi nhận path khi user navigate trong site.
- Ghi nhận network requests phát sinh từ site.
- Đọc `robots.txt`.
- Đọc `sitemap.xml`.
- Đọc sitemap được khai báo trong `robots.txt`.
- Crawl nội bộ có giới hạn.
- Phân loại path theo nhóm.
- Search/filter/sort path.
- Xem detail từng path.
- Export kết quả ra JSON/CSV.
- Lưu lịch sử scan theo website.
- Xoá dữ liệu scan của từng website.

## 3.2. Ngoài scope MVP

Không xử lý trong version đầu:

- Brute-force path bằng wordlist.
- Scan vulnerability/security.
- Bypass login/paywall/permission.
- Crawl path yêu cầu authentication nếu user chưa truy cập.
- Parse toàn bộ route từ JS bundle phức tạp.
- Gửi dữ liệu scan lên server.
- Distributed crawling.
- Scan website không phải current website nếu user chưa cấp quyền.
- Tự động crawl background khi user chưa bấm start.
- Crawl không giới hạn.

## 4. User stories

### US-01: Scan page hiện tại

Là user, tôi muốn bấm scan để extension lấy tất cả link có trong page hiện tại.

### US-02: Ghi nhận path khi duyệt web

Là user, tôi muốn bật recording để extension tự ghi lại các path tôi đã đi qua trong website.

### US-03: Ghi nhận API endpoint

Là developer/tester, tôi muốn extension ghi nhận các API endpoint mà website gọi khi tôi thao tác trên page.

### US-04: Đọc sitemap

Là user, tôi muốn extension đọc sitemap để lấy danh sách URL public của website.

### US-05: Đọc robots.txt

Là user, tôi muốn extension đọc robots.txt để biết website có khai báo sitemap hoặc nhắc đến path nào.

### US-06: Crawl nội bộ

Là user, tôi muốn extension crawl giới hạn các page cùng site để tìm thêm path.

### US-07: Phân loại path

Là user, tôi muốn xem path theo nhóm như Pages, APIs, Assets, External, Sitemap, Robots.

### US-08: Export report

Là user, tôi muốn export kết quả để chia sẻ cho team hoặc dùng làm tài liệu điều tra.

## 5. UI/UX

## 5.1. Popup chính

Khi user click icon extension, hiển thị:

```text
Website Path Discovery

Current site:
https://example.com

Status:
Recording: OFF

Quick actions:
[Scan current page]
[Start recording]
[Read sitemap]
[Read robots.txt]
[Open dashboard]
```

Nếu đang recording:

```text
Website Path Discovery

Current site:
https://example.com

Status:
Recording: ON

Discovered:
Pages: 24
APIs: 12
Assets: 80
External: 7

[Scan current page]
[Stop recording]
[Open dashboard]
```

## 5.2. Dashboard

Dashboard là trang quản lý kết quả scan.

Layout đề xuất:

```text
Website Path Discovery

Site:
https://example.com

Actions:
[Scan current page] [Read sitemap] [Read robots.txt] [Start crawl] [Export]

Summary:
Total paths: 156
Pages: 42
APIs: 18
Assets: 87
External: 9

Tabs:
[All] [Pages] [APIs] [Assets] [External] [Sitemap] [Robots] [Visited]

Search:
[ /api/users ]

Table:
| Type | Method | URL | Source | Status | First Seen | Last Seen |
```

## 5.3. Path detail

Khi user click vào một path, hiển thị detail:

```text
Path detail

URL:
https://example.com/api/users

Type:
API

Method:
GET

Source:
Network request

Status:
200

First seen:
2026-07-09 14:30:12

Last seen:
2026-07-09 14:35:18

Discovered from:
https://example.com/dashboard
```

## 6. Data sources

## 6.1. DOM Link Scanner

### Mục đích

Scan các link có trong page hiện tại.

### Cách hoạt động

Content script query các element:

```js
document.querySelectorAll('a[href]');
document.querySelectorAll('link[href]');
document.querySelectorAll('script[src]');
document.querySelectorAll('img[src]');
document.querySelectorAll('iframe[src]');
document.querySelectorAll('form[action]');
document.querySelectorAll('source[src]');
document.querySelectorAll('video[src]');
document.querySelectorAll('audio[src]');
```

### Output

Mỗi URL tìm được sẽ được normalize và phân loại.

Ví dụ:

```json
{
  "url": "https://example.com/products",
  "path": "/products",
  "type": "page",
  "source": "dom-link",
  "discoveredFrom": "https://example.com/home"
}
```

## 6.2. Navigation Recorder

### Mục đích

Ghi nhận path khi user duyệt website.

### Cách hoạt động

Extension listen các navigation event của tab:

- Page load navigation
- SPA route change
- History API navigation nếu detect được
- Hash change

### Output

Ví dụ:

```json
{
  "url": "https://example.com/settings/profile",
  "path": "/settings/profile",
  "type": "page",
  "source": "navigation",
  "tabId": 123,
  "timestamp": "2026-07-09T07:30:00.000Z"
}
```

## 6.3. Network Request Recorder

### Mục đích

Ghi nhận URL/API/assets mà website gọi.

### Cách hoạt động

Extension listen network requests của tab/current site.

Cần ghi nhận:

- URL
- Method
- Resource type
- Status code nếu có
- Initiator
- Tab ID
- Timestamp

### Phân loại sơ bộ

| Resource type    | Type trong extension |
| ---------------- | -------------------- |
| `xmlhttprequest` | API                  |
| `fetch`          | API                  |
| `script`         | Asset                |
| `stylesheet`     | Asset                |
| `image`          | Asset                |
| `font`           | Asset                |
| `document`       | Page                 |
| `sub_frame`      | Page / External      |
| `media`          | Asset                |
| `websocket`      | API / Realtime       |

### Ví dụ output

```json
{
  "url": "https://example.com/api/products?page=1",
  "path": "/api/products",
  "method": "GET",
  "type": "api",
  "resourceType": "xmlhttprequest",
  "source": "network",
  "statusCode": 200,
  "discoveredFrom": "https://example.com/products"
}
```

## 6.4. Robots.txt Reader

### Mục đích

Đọc `robots.txt` của website để phát hiện:

- Sitemap URLs
- Disallow paths
- Allow paths

### URL cần fetch

```text
https://example.com/robots.txt
```

### Output

Ví dụ:

```json
{
  "url": "https://example.com/admin/",
  "path": "/admin/",
  "type": "robots-path",
  "source": "robots",
  "robotsDirective": "Disallow"
}
```

### Lưu ý

Path trong `robots.txt` không có nghĩa là user được phép crawl. Extension chỉ hiển thị như thông tin tham khảo.

## 6.5. Sitemap Reader

### Mục đích

Đọc sitemap để lấy URL public.

### URL mặc định cần thử

```text
https://example.com/sitemap.xml
https://example.com/sitemap_index.xml
https://example.com/sitemap-index.xml
```

Ngoài ra, nếu `robots.txt` có dòng `Sitemap:`, extension cần fetch các sitemap đó.

### Hỗ trợ format

MVP cần hỗ trợ:

- XML sitemap
- Sitemap index
- Gzip sitemap nếu fetch/browser hỗ trợ
- Plain text sitemap nếu có

### Output

```json
{
  "url": "https://example.com/blog/post-1",
  "path": "/blog/post-1",
  "type": "page",
  "source": "sitemap",
  "lastmod": "2026-07-01"
}
```

## 6.6. Limited Crawler

### Mục đích

Crawl các link nội bộ trong giới hạn để phát hiện thêm path.

### Config mặc định

```json
{
  "enabled": false,
  "startUrl": "https://example.com/",
  "scope": "same-origin",
  "maxDepth": 2,
  "maxPages": 100,
  "requestDelayMs": 500,
  "respectRobotsTxt": true,
  "includeQueryParams": false
}
```

### Flow

1. User click `Start crawl`.
2. Extension xác nhận config.
3. Fetch start URL.
4. Parse HTML.
5. Extract links.
6. Normalize URLs.
7. Filter URL theo scope.
8. Add URL mới vào queue.
9. Tiếp tục đến khi đạt `maxDepth` hoặc `maxPages`.
10. Lưu kết quả.

### Safety

Crawler bắt buộc có:

- Max depth.
- Max pages.
- Delay giữa requests.
- Stop button.
- Respect robots option.
- Không crawl external domain mặc định.
- Không gửi form.
- Không click button.
- Không thực hiện action gây side effect.

## 7. Path classification

Extension cần phân loại path theo các nhóm sau.

## 7.1. Page

Là URL có khả năng là page route.

Ví dụ:

```text
/
/about
/products
/products/123
/login
/dashboard
```

Nguồn thường là:

- Navigation
- DOM `<a href>`
- Sitemap
- Document request

## 7.2. API

Là URL có khả năng là API endpoint.

Ví dụ:

```text
/api/users
/api/products
/graphql
/v1/search
/rest/orders
```

Detection rule:

- Resource type là `fetch` hoặc `xmlhttprequest`.
- Path chứa `/api/`, `/v1/`, `/v2/`, `/graphql`, `/rest/`.
- Response content-type là JSON nếu lấy được.

## 7.3. Asset

Là static resource.

Ví dụ:

```text
/assets/app.js
/static/style.css
/images/logo.png
/fonts/main.woff2
```

Detection rule:

- File extension:
  - `.js`
  - `.css`
  - `.png`
  - `.jpg`
  - `.svg`
  - `.woff`
  - `.woff2`
  - `.mp4`

- Resource type là script, stylesheet, image, font, media.

## 7.4. External

URL không thuộc current origin hoặc current site.

Ví dụ:

```text
https://cdn.example.com/app.js
https://analytics.vendor.com/collect
https://another-site.com/page
```

## 7.5. Robots

Path được lấy từ `robots.txt`.

Ví dụ:

```text
/admin/
/private/
/search
```

## 7.6. Sitemap

URL được lấy từ sitemap.

Ví dụ:

```text
/blog/post-1
/category/news
```

## 8. Scope options

Khi scan/crawl, user có thể chọn scope.

## 8.1. Same origin

Chỉ lấy URL cùng origin.

Current origin:

```text
https://www.example.com
```

Match:

```text
https://www.example.com/about
```

Không match:

```text
https://example.com/about
https://api.example.com/users
```

## 8.2. Same site

Lấy URL cùng root domain.

Current site:

```text
https://www.example.com
```

Match:

```text
https://example.com/about
https://www.example.com/about
https://api.example.com/users
https://cdn.example.com/app.js
```

## 8.3. Current page only

Chỉ scan DOM của page hiện tại, không crawl link tiếp theo.

## 8.4. Custom domain pattern

Cho phép user nhập pattern:

```text
*.example.com
example.*
*.example.*
```

MVP có thể chưa cần custom pattern, nhưng nên thiết kế data model để mở rộng.

## 9. URL normalization

Extension cần normalize URL để tránh duplicate.

## 9.1. Normalize rules

Các bước:

1. Resolve relative URL thành absolute URL.
2. Lowercase protocol và hostname.
3. Remove hash mặc định, trừ khi user bật `includeHash`.
4. Remove trailing slash nếu config bật.
5. Sort query params nếu config bật.
6. Có option giữ hoặc bỏ query params.
7. Decode URL an toàn nếu cần.
8. Remove default port:
   - `:80` cho HTTP
   - `:443` cho HTTPS

## 9.2. Query params handling

Có 3 mode:

### Mode 1: Ignore query params

```text
/products?id=1
/products?id=2
```

Được xem là:

```text
/products
```

### Mode 2: Keep query keys only

```text
/products?id=1&page=2
```

Được xem là:

```text
/products?id&page
```

### Mode 3: Keep full query

```text
/products?id=1
/products?id=2
```

Được xem là 2 URL khác nhau.

Khuyến nghị mặc định:

```text
Keep query keys only
```

Vì giúp phát hiện shape của URL mà không tạo quá nhiều duplicate.

## 10. Data model

## 10.1. Site record

```json
{
  "siteId": "site_example_com",
  "origin": "https://example.com",
  "hostname": "example.com",
  "createdAt": "2026-07-09T07:00:00.000Z",
  "updatedAt": "2026-07-09T07:30:00.000Z",
  "settings": {
    "scope": "same-origin",
    "queryMode": "query-keys-only",
    "includeHash": false
  }
}
```

## 10.2. Path record

```json
{
  "id": "path_001",
  "siteId": "site_example_com",
  "url": "https://example.com/api/products?page=1",
  "normalizedUrl": "https://example.com/api/products?page",
  "origin": "https://example.com",
  "hostname": "example.com",
  "path": "/api/products",
  "queryKeys": ["page"],
  "type": "api",
  "method": "GET",
  "resourceType": "fetch",
  "source": ["network"],
  "statusCode": 200,
  "firstSeenAt": "2026-07-09T07:10:00.000Z",
  "lastSeenAt": "2026-07-09T07:12:00.000Z",
  "seenCount": 3,
  "discoveredFrom": ["https://example.com/products"],
  "metadata": {
    "contentType": "application/json"
  }
}
```

## 10.3. Crawl session

```json
{
  "id": "crawl_001",
  "siteId": "site_example_com",
  "startUrl": "https://example.com/",
  "scope": "same-origin",
  "maxDepth": 2,
  "maxPages": 100,
  "requestDelayMs": 500,
  "respectRobotsTxt": true,
  "status": "completed",
  "startedAt": "2026-07-09T07:00:00.000Z",
  "endedAt": "2026-07-09T07:05:00.000Z",
  "scannedPages": 80,
  "discoveredPaths": 240,
  "errors": []
}
```

## 11. Storage

Extension dùng `chrome.storage.local`.

Dữ liệu lưu:

- Website đã scan.
- Path records.
- Crawl sessions.
- User settings.
- Recording state.

Không lưu:

- Cookie.
- Local storage của website.
- Response body API.
- Personal data.
- HTML content đầy đủ của page.

## 12. Permissions

Manifest V3 đề xuất:

```json
{
  "manifest_version": 3,
  "name": "Website Path Discovery",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "tabs", "storage", "webNavigation", "webRequest"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "dashboard.html",
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

## 13. Technical architecture

## 13.1. File structure

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── dashboard.html
├── dashboard.js
├── modules/
│   ├── url-normalizer.js
│   ├── path-classifier.js
│   ├── dom-scanner.js
│   ├── network-recorder.js
│   ├── navigation-recorder.js
│   ├── robots-reader.js
│   ├── sitemap-reader.js
│   ├── crawler.js
│   ├── storage-repository.js
│   └── exporter.js
└── styles/
    ├── popup.css
    └── dashboard.css
```

## 13.2. `background.js`

Phụ trách:

- Listen `webNavigation`.
- Listen `webRequest`.
- Nhận message từ popup/content script.
- Fetch robots/sitemap.
- Chạy limited crawler.
- Lưu path vào storage.
- Quản lý recording state.

## 13.3. `content.js`

Phụ trách:

- Scan DOM links của page hiện tại.
- Gửi kết quả về background.
- Detect SPA route changes nếu cần.
- Không đọc dữ liệu nhạy cảm của website.

## 13.4. `popup.js`

Phụ trách:

- Lấy active tab.
- Hiển thị current site.
- Trigger scan current page.
- Start/stop recording.
- Mở dashboard.

## 13.5. `dashboard.js`

Phụ trách:

- Hiển thị summary.
- Hiển thị bảng path.
- Search/filter/sort.
- Export JSON/CSV.
- Xoá dữ liệu scan.
- Config crawl.

## 14. Main flows

## 14.1. Scan current page flow

1. User click extension icon.
2. User click `Scan current page`.
3. Popup lấy active tab.
4. Background inject hoặc gọi content script.
5. Content script scan DOM.
6. Normalize URLs.
7. Classify URLs.
8. Save vào storage.
9. Popup hiển thị số lượng path mới tìm thấy.

Success message:

```text
Scan completed.
Found 42 URLs.
New paths: 18
Duplicates: 24
```

## 14.2. Start recording flow

1. User click `Start recording`.
2. Extension lưu recording state cho current site.
3. Background bắt đầu ghi nhận navigation/network request.
4. User thao tác trên website.
5. Extension lưu path mới theo thời gian thực.
6. User click `Stop recording`.

Status:

```text
Recording current site:
https://example.com

Pages: 12
APIs: 8
Assets: 30
External: 4
```

## 14.3. Read robots.txt flow

1. User click `Read robots.txt`.
2. Extension fetch:

```text
https://example.com/robots.txt
```

3. Parse các dòng:
   - `Allow`
   - `Disallow`
   - `Sitemap`

4. Lưu path/sitemap tìm được.
5. Nếu có sitemap, hỏi user có muốn fetch sitemap không.

Message:

```text
robots.txt found.
Disallow paths: 6
Allow paths: 2
Sitemaps: 1

[Read sitemap]
```

## 14.4. Read sitemap flow

1. User click `Read sitemap`.
2. Extension thử đọc sitemap từ:
   - `robots.txt`
   - `/sitemap.xml`
   - `/sitemap_index.xml`
   - `/sitemap-index.xml`

3. Parse sitemap index nếu có.
4. Parse URLs.
5. Lưu URLs vào storage.
6. Hiển thị kết quả.

Message:

```text
Sitemap scan completed.
Sitemaps read: 3
URLs found: 128
New URLs: 96
```

## 14.5. Limited crawl flow

1. User mở dashboard.
2. User click `Start crawl`.
3. Hiển thị crawl config:

```text
Start URL: https://example.com/
Scope: Same origin
Max depth: 2
Max pages: 100
Delay: 500ms
Respect robots.txt: ON
```

4. User click `Start`.
5. Extension crawl theo queue.
6. Dashboard hiển thị progress.
7. User có thể stop.
8. Sau khi xong, hiển thị report.

Progress:

```text
Crawling...

Scanned pages: 42 / 100
Queue: 18
Discovered paths: 137
Errors: 2

[Stop]
```

## 15. Export

Extension hỗ trợ export.

## 15.1. Export JSON

Format:

```json
{
  "site": "https://example.com",
  "exportedAt": "2026-07-09T07:30:00.000Z",
  "summary": {
    "total": 156,
    "pages": 42,
    "apis": 18,
    "assets": 87,
    "external": 9
  },
  "paths": []
}
```

## 15.2. Export CSV

Columns:

```text
type,method,url,path,source,statusCode,firstSeenAt,lastSeenAt,seenCount,discoveredFrom
```

## 16. Error handling

## 16.1. Unsupported page

Nếu active tab là:

```text
chrome://
edge://
about:
file://
devtools://
```

Hiển thị:

```text
This page is not supported.
Please open a normal http/https website.
```

## 16.2. Permission denied

Nếu không có quyền truy cập website:

```text
Cannot access this website.
Please allow extension permission for this site.
```

## 16.3. Robots not found

Nếu `robots.txt` trả về 404:

```text
robots.txt was not found for this site.
```

## 16.4. Sitemap not found

Nếu không tìm thấy sitemap:

```text
No sitemap found.
Tried:
- /sitemap.xml
- /sitemap_index.xml
- /sitemap-index.xml
```

## 16.5. Crawl blocked

Nếu request bị CORS, 403, 401 hoặc timeout:

```text
Some pages could not be crawled.
Check the Errors tab for details.
```

## 16.6. Duplicate URL

Nếu URL đã tồn tại:

- Không tạo record mới.
- Update:
  - `lastSeenAt`
  - `seenCount`
  - `source`
  - `discoveredFrom`

## 17. Security & privacy

Extension không được:

- Gửi dữ liệu URL/path ra server.
- Lưu response body API.
- Lưu cookie/token.
- Lưu localStorage/sessionStorage của website.
- Tự động crawl nếu user chưa click.
- Crawl external website mặc định.
- Bypass authentication.
- Submit form.
- Trigger destructive action.
- Click button trên website.
- Brute-force path trong MVP.

Extension chỉ lưu metadata phục vụ điều tra path.

## 18. Performance requirements

- DOM scan phải hoàn thành trong thời gian hợp lý.
- Không block main thread quá lâu.
- Network recording chỉ lưu metadata cần thiết.
- Crawl phải có delay.
- Crawl phải có max page.
- Dashboard phải paginate nếu nhiều URL.
- Storage cần deduplicate URL.
- Mutation/route observer nếu dùng phải debounce.

## 19. Acceptance criteria

### AC-01: Detect current site

Khi user mở:

```text
https://example.com/products
```

Popup hiển thị current site:

```text
https://example.com
```

### AC-02: Scan current page

Khi user click `Scan current page`, extension scan được các URL từ link, script, image, iframe, form trên page hiện tại.

### AC-03: Deduplicate URL

Nếu cùng một URL xuất hiện nhiều lần, extension chỉ lưu một record và tăng `seenCount`.

### AC-04: Navigation recording

Khi user bật recording và navigate từ:

```text
/products
```

sang:

```text
/products/123
```

extension lưu path:

```text
/products/123
```

### AC-05: API recording

Khi website gọi API:

```text
https://example.com/api/products
```

extension ghi nhận path này vào nhóm `APIs`.

### AC-06: Read robots.txt

Khi user click `Read robots.txt`, extension fetch và parse được:

- Allow
- Disallow
- Sitemap

nếu file tồn tại.

### AC-07: Read sitemap

Khi user click `Read sitemap`, extension parse được URL trong sitemap XML và lưu vào nhóm `Sitemap`.

### AC-08: Limited crawl

Khi user start crawl với config:

```text
maxDepth = 2
maxPages = 100
```

extension không crawl vượt quá depth hoặc số page đã cấu hình.

### AC-09: Stop crawl

Khi user click `Stop`, crawler dừng queue hiện tại và không gửi request mới.

### AC-10: Export

User có thể export kết quả ra JSON và CSV.

### AC-11: Unsupported page

Nếu user đang ở `chrome://extensions`, extension không scan và hiển thị message không hỗ trợ.

### AC-12: No sensitive data

Extension không lưu cookie, token, localStorage, sessionStorage hoặc response body.

## 20. MVP scope

Version đầu cần có:

- Popup.
- Dashboard.
- Detect current website.
- Scan DOM links của current page.
- Start/stop recording navigation.
- Record network requests cùng site.
- Read `robots.txt`.
- Read `sitemap.xml`.
- Basic limited crawler.
- Path classification:
  - Page
  - API
  - Asset
  - External
  - Robots
  - Sitemap

- Search/filter trong dashboard.
- Export JSON/CSV.
- Clear scan data theo website.

## 21. Future improvements

Có thể mở rộng thêm:

- Import/export project.
- Compare scan results giữa 2 lần.
- Detect new/removed paths.
- Scheduled scan.
- Generate site map graph.
- Parse route từ JS bundle.
- Detect OpenAPI/Swagger endpoint.
- Detect GraphQL schema nếu public.
- Group API theo method.
- Show status code distribution.
- Add notes/tags cho path.
- Share report dạng HTML.
- Support Firefox.
- Optional wordlist discovery với warning rõ ràng.
- Optional authenticated crawl dùng current browser session.
- Respect robots.txt nâng cao.
- Crawl SPA bằng headless browser bên ngoài extension.
