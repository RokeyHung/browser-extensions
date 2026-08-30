# Changelog

Tất cả thay đổi đáng chú ý của extension **Site Path Discovery** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-08-30

### Fixed

- **Crawl lan sang site của người khác ở scope `same-site`** — `TWO_LEVEL_TLDS` là list chép tay, thiếu `co.id`, `com.my`, `co.th`, `edu.vn` và toàn bộ nhóm hosting (`github.io`, `vercel.app`, `pages.dev`…). Hệ quả: crawl `shop.tokopedia.co.id` thì mọi URL `.co.id` bị coi là cùng site và được đưa vào hàng đợi; crawl `alice.github.io` thì kéo theo `bob.github.io`, `myapp.vercel.app` kéo theo `evil.vercel.app`. Đây là extension chủ động gửi request, nên lỗi phạm vi đồng nghĩa bắn request vào hạ tầng của bên thứ ba.
- Nay dùng luật suy diễn dùng chung nên phủ cả quốc gia chưa từng liệt kê, và nhóm hosting được tách đúng thành từng site riêng.

### Changed

- Phần tách eTLD+1 chuyển sang block dùng chung từ `shared/domain-suffix.js`, đồng bộ bằng `make sync-domain-suffix`.

## [1.0.0]

Bản đầu tiên, thêm nguyên khối ở commit `6b39481` trước khi file changelog này tồn tại. Phạm vi tính năng xem [docs/spec.md](docs/spec.md).
