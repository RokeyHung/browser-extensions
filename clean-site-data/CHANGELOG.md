# Changelog

Tất cả thay đổi đáng chú ý của extension **Clean Site Data** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

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
