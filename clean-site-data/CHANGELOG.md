# Changelog

Tất cả thay đổi đáng chú ý của extension **Clean Site Data** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-08-30

### Added

- **Option clean theo wildcard `*.website.*`** — checkbox mới trong popup cho phép mở rộng phạm vi dọn sang mọi subdomain và mọi TLD dùng chung site label, thay vì chỉ registrable domain hiện tại. Ví dụ đang ở `www.facebook.com` mà bật option: `m.facebook.com`, `facebook.com.vn`, `login.facebook.net` đều được dọn. Nhãn trên checkbox hiển thị đúng pattern của site đang mở (`*.facebook.*`).
- Pattern được suy ra hoàn toàn từ hostname của tab, **không dùng danh sách domain cứng nào** — mọi site đều áp dụng chung một luật. Phần public suffix trong `domain-utils.js` chỉ để tách eTLD+1 cho đúng, không phải list site.
- Ở chế độ wildcard, cookie được lấy toàn bộ jar rồi lọc theo site label (`chrome.cookies.getAll({ domain })` không diễn tả được "mọi TLD"), và các tab đang mở thuộc cùng site label cũng được inject script để dọn `sessionStorage` — thứ mà `browsingData` không chạm tới được.
- Khối Result hiển thị phạm vi thực tế đã dọn (`Scope *.facebook.*: facebook.com, m.facebook.com…`) để thấy rõ những host nào đã bị đụng tới.
- Trạng thái của option được lưu qua `chrome.storage` như các checkbox khác.

### Fixed

- **Dọn lan sang site khác ở các ccSLD không có trong danh sách** — `EFFECTIVE_TLDS` là list chép tay nên thiếu nhiều country second-level phổ biến (`co.id`, `com.my`, `co.th`, `edu.vn`…). Hệ quả: `shop.tokopedia.co.id` bị tách nhầm thành registrable domain `co.id`, mà `chrome.cookies.getAll({ domain })` khớp cả subdomain → xoá cookie của **mọi site .co.id**; ở chế độ wildcard thì pattern thành `*.co.*`, lan rộng hơn nữa. Lỗi này có từ 1.1.0 chứ không phải do option wildcard sinh ra.
- Thay list bằng luật suy diễn `isCountrySecondLevel()`: nhãn kế cuối thuộc nhóm registry (`co`, `com`, `net`, `org`, `edu`, `gov`, `ac`, `or`, `ne`, `go`, `mil`, `gob`, `nom`) đứng dưới ccTLD 2 ký tự thì là public suffix. Phủ được cả quốc gia chưa từng liệt kê. 23 suffix cũ trong list đã gỡ bỏ vì luật bao hết.
- `web` cố tình không nằm trong nhóm registry: `web.de` là site thật, không phải suffix.
- `NAMED_SUFFIXES` giữ lại đúng phần luật không suy ra được: nhóm hosting tách mỗi subdomain thành site riêng (`github.io`, `vercel.app`, `pages.dev`, `workers.dev`…) và `me.uk`.

### Notes

- Chrome không có API liệt kê mọi origin đang giữ storage, nên phạm vi wildcard chỉ trải được tới các host mà extension biết: cookie trong jar và tab đang mở. Một TLD khác chưa từng đặt cookie và không mở tab thì không có gì để dọn.
- Với IP address hoặc host một nhãn (`localhost`), option bị disable vì không có site label để mở rộng.

## [1.2.0] - 2026-07-26

### Changed

- **Sau khi clean thì về trang chủ của site** — option `Reload after cleaning` đổi thành `Go to homepage after cleaning`. Trước đây extension reload đúng URL đang mở; giờ tab được điều hướng về origin root, ví dụ đang ở `https://animevsub.vn/phim/abc-123` thì sau khi clean sẽ về `https://animevsub.vn/`. Lý do: khi session đã bị xoá, deep link thường 404 hoặc bị đẩy sang login wall, về trang chủ là chỗ đáp an toàn.
- Origin root giữ nguyên scheme và hostname đầy đủ (kể cả subdomain), chỉ bỏ path/query/hash.
- Nếu tab đã ở trang chủ, extension gọi `chrome.tabs.reload` thay vì điều hướng cùng URL (tránh Chrome trả về từ cache).
- Footer kết quả trong popup hiển thị `Redirected to <host>` thay cho `Tab reloaded.`.

## [1.1.0] - 2026-07-22

### Fixed

- **Xóa cookie xong reload vẫn đăng nhập (Facebook, v.v.)** — cookie session được xóa trên toàn bộ registrable domain (eTLD+1), gồm cả domain cha và mọi subdomain, thay vì chỉ đúng hostname của tab. Trước đây khi tab ở `www.facebook.com`, extension chỉ query cookie cho `www.facebook.com`, nên cookie đăng nhập nằm ở domain cha `.facebook.com` (`c_user`, `xs`, `datr`…) không bao giờ bị đụng tới → reload vẫn còn đăng nhập. Giờ query theo `facebook.com` nên khớp cả domain cha lẫn mọi subdomain.
- **`browsingData` không dọn cookie** — bước dọn bằng `chrome.browsingData.remove` trước đây cố tình bỏ qua cookie. Nay có thêm `cookies: true` và chạy theo phạm vi `origins` (registrable domain), giúp dọn cả HttpOnly cookie và partitioned cookie (CHIPS) mà `chrome.cookies` có thể bỏ lỡ.

### Added

- Hàm `getBaseDomain()` suy ra registrable domain từ hostname, có xử lý eTLD nhiều nhãn (`co.uk`, `com.au`, `github.io`, `vercel.app`…) qua danh sách `EFFECTIVE_TLDS` để không vô tình dọn nhầm cookie của site khác dùng chung public suffix.
- Khi xóa cookie giữ lại `storeId` và `partitionKey` để xử lý đúng cookie phân vùng.

### Notes

- Sau khi cập nhật, reload extension (`chrome://extensions` → Reload) rồi thử lại — bấm Clean trên Facebook sẽ văng ra màn hình đăng nhập.
- Một số site dùng auth liên kết qua domain riêng (ví dụ ChatGPT ↔ `openai.com`). Bản này dọn sạch phần session trên chính domain chỉ định; log out triệt để qua domain auth bên ngoài nằm ngoài phạm vi "website chỉ định" và chưa được xử lý.

## [1.0.0] - Initial release

### Added

- Xóa cookie, localStorage, sessionStorage, IndexedDB, Cache Storage và Service Worker cho website hiện tại.
- Chọn từng loại dữ liệu muốn xóa trong popup; lưu lại lựa chọn qua `chrome.storage`.
- Tùy chọn tự reload tab sau khi xóa.
- Kết hợp `chrome.cookies`, inject script vào page context và `chrome.browsingData` để dọn dữ liệu.
