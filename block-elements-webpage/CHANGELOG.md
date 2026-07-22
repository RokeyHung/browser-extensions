# Changelog

Tất cả thay đổi đáng chú ý của extension **Element Filter** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-07-22

### Fixed

- **Filter biến mất khi domain có `www.`** — rule tạo cho `website.com` giờ áp dụng cho cả `website.com`, `www.website.com` và mọi subdomain. Trước đây một exact rule chỉ khớp đúng hostname đã lưu, nên khi trang redirect sang `www.` (ví dụ trang chủ `animevietsub.wiki` → trang con `www.animevietsub.wiki`) thì filter không còn áp dụng. Việc so khớp giờ bỏ tiền tố `www.` theo cả hai chiều nên rule lưu là `www.website.com` cũng tương đương `website.com`.
- **Pattern `*.website.*` không áp dụng ở root domain** — nhánh so khớp trước đây bắt buộc phải có subdomain (`idx > 0`), nên `*.website.*` khớp `www.website.com` nhưng bỏ qua chính `website.com`. Giờ `*.website.*` khớp cả root domain lẫn subdomain, trên mọi TLD.

### Changed

- Khi tạo rule, tùy chọn scope mặc định lưu domain gốc (đã bỏ `www.`) thay vì hostname đầy đủ, giúp rule gọn và dùng lại được giữa `www.` và non-`www.`. Nhãn trong picker đổi thành `website.com (+ www & subdomains)` để phản ánh phạm vi mới.
- Cập nhật tài liệu so khớp domain trong `docs/spec.md` cho khớp hành vi mới.

### Notes

- Rule đã tạo từ trước **không cần tạo lại** — sau khi cập nhật, hãy reload extension (`chrome://extensions` → Reload) rồi refresh trang.
- Bảng so khớp domain sau bản vá:

  | Pattern         | Khớp                                      |
  | --------------- | ----------------------------------------- |
  | `website.com`   | root domain + `www.` + mọi subdomain      |
  | `*.website.com` | chỉ subdomain (không gồm root domain)     |
  | `website.*`     | root domain trên mọi TLD                  |
  | `*.website.*`   | root domain + mọi subdomain, trên mọi TLD |

## [1.0.0] - Initial release

### Added

- Chọn element trực tiếp trên page bằng picker UI (hover highlight + click để chọn).
- Tự generate CSS selector với slider điều chỉnh độ specificity.
- Preview element sẽ bị ẩn trước khi lưu rule.
- Lưu, quản lý, bật/tắt và xoá custom filter theo từng website.
- Wildcard domain: `website.*`, `*.website.com`, `*.website.*`.
- Tự động áp dụng rule khi page load, kèm MutationObserver cho nội dung động.
- Bật/tắt filter theo từng site trong popup.
- Context menu "Block element".
