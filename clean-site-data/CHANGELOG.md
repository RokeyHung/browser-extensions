# Changelog

Tất cả thay đổi đáng chú ý của extension **Clean Site Data** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

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
