# Changelog

Tất cả thay đổi đáng chú ý của extension **Popup Redirect Guard** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-07-26

### Fixed

- **Link ngoài chết câm sau khi reload extension** — content script vẫn chạy trên các tab đang mở nhưng `chrome.runtime` của nó đã bị gỡ. Vì extension này _chặn_ navigation, hậu quả nặng hơn một extension chỉ đọc: script mồ côi vẫn giữ config cũ và vẫn gọi `preventDefault()` trên mọi link ngoài, trong khi `sendMessage` ném lỗi — nên không có toast, không có nút `Open once`, và mọi link ngoài trên trang bấm không ăn mà không báo gì.

  Cách xử lý là **đứng xuống** thay vì nuốt lỗi: khi phát hiện context đã chết, extension xoá config, gỡ listener `click`/`submit`, và `postMessage` `active: false` sang guard ở MAIN world để nó thôi vá `window.open`. Việc kiểm tra đặt **trước** mọi `preventDefault()` theo nguyên tắc không chặn thứ mình không báo cáo được. Nút `Open once` trên toast, nếu extension đã chết, sẽ tự `window.open` tại chỗ để không thành nút vô tác dụng.

### Changed

- Icon đổi sang hình khiên xanh `#2197f3` có dấu X trắng (nguồn: SVG Repo, lưu ở `extension/icons/shield-source.svg`), thay cho biển cấm vẽ tay trước đó. Icon được sinh từ hình học của SVG bằng `generate-icons.js` với 4×4 sample mỗi pixel nên cạnh cong không răng cưa ở cỡ 16px.

### Notes

- Bản vá `chrome.runtime` chỉ áp dụng cho content script **được nạp mới**. Tab đang mở sẵn vẫn cần F5 sau khi cập nhật extension.

## [1.0.0] - 2026-07-21

### Added

- **Chặn popup và redirect không mong muốn** theo từng website, bật/tắt riêng cho mỗi site.
- Guard chạy ở **MAIN world** từ `document_start`, vá `window.open`, `location.assign` và `location.replace` trước khi script của trang kịp chạy.
- Content script ở isolated world chặn thêm click vào link `target="_blank"` ra ngoài domain và form submit có `action` trỏ ra ngoài.
- Hai chế độ bảo vệ: **normal** (chỉ chặn thứ mở tab/cửa sổ mới) và **strict** (chặn mọi navigation ra domain ngoài).
- Tuỳ chọn bật/tắt từng loại chặn: `blockWindowOpen`, `blockExternalBlank`, `blockScriptedRedirect`, `blockPopUnder`, `blockExternalFormSubmit`, `closeUnwantedNewTabs`.
- Tự đóng tab mới không mong muốn qua `chrome.webNavigation`.
- **Toast** khi có thứ bị chặn, kèm 3 hành động: `Open once`, `Always allow` (thêm domain vào whitelist) và `Dismiss`. Có rate-limit để không spam khi trang bắn liên tục.
- Whitelist domain theo site, hỗ trợ pattern exact domain và wildcard TLD.
- **Nhật ký các lần bị chặn** với dashboard xem lại, xoá được; tắt được qua `keepLog`.
- Options page quản lý rule, whitelist, log và settings; import/export rule.
- Domain matching qua `modules/domain-matcher.js` với xử lý registrable domain (eTLD+1).
