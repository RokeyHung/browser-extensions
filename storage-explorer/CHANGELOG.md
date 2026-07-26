# Changelog

Tất cả thay đổi đáng chú ý của extension **Storage Explorer** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-07-26

### Added

- **Xem toàn bộ client-side storage của site trong một cửa sổ** — `localStorage`, `sessionStorage`, cookies và IndexedDB gom vào một dashboard có tab riêng, search chung, sort theo cột.
- **Sửa trực tiếp** entry của localStorage/sessionStorage (thêm, sửa, đổi tên key, xoá) và cookie (name, value, domain, path, expires, Secure, HttpOnly, SameSite) qua drawer bên phải.
- **Nhận diện kiểu giá trị**: JSON, JWT, number, boolean, null, text. Nút `Format JSON` / `Minify` ngay trong editor; JWT được decode header + payload kèm thời điểm `exp` đã quy đổi (chỉ để đọc, không verify chữ ký).
- **Snapshot**: chụp lại local + session + cookies của origin thành bản có tên, restore lại sau theo chế độ `Merge` (ghi đè key trùng) hoặc `Replace` (xoá sạch rồi ghi), kèm tuỳ chọn reload tab sau khi restore.
- Export/import snapshot ra file JSON (`version: "1"`) để chia sẻ giữa các máy; import luôn sinh `id` mới nên không đè snapshot sẵn có.
- **IndexedDB**: liệt kê database → object store → số record, xem tối đa 100 record mỗi store (read-only), xoá nguyên database.
- Popup hiển thị số lượng của 4 area, nút chụp snapshot nhanh và dropdown restore snapshot của site hiện tại.
- Dashboard gắn vào một **target tab** cụ thể, đổi tab qua dropdown ở header; tab bị đóng thì hiện banner và refresh lại danh sách.
- Logo trong header của popup và dashboard dùng chính icon của extension, không dùng emoji.
- Icon hình thùng carton, sinh bằng `generate-icons.js` (chỉ dùng built-in của Node, không cần dependency) từ hình học của `icons/box-source.svg` (nguồn: SVG Repo). Mỗi pixel lấy 4×4 sample rồi trung bình để cạnh xiên không bị răng cưa ở cỡ 16px.

### Notes

- Cookie được liệt kê theo **registrable domain (eTLD+1)** chứ không chỉ hostname của tab — giống cách Clean Site Data dọn cookie — nên cookie session nằm ở domain cha (`.example.com`) vẫn thấy và sửa được. Danh sách eTLD nhiều nhãn (`com.vn`, `co.uk`, `vercel.app`…) dùng chung với extension đó.
- Không có content script thường trú: mọi truy cập page storage đi qua `chrome.scripting.executeScript` với hàm tự chứa trong `modules/page-agent.js`, chỉ inject khi user thao tác.
- Snapshot lưu **plain text** trong `chrome.storage.local`, tức là chứa cả token/session của site. Cân nhắc trước khi export file gửi cho người khác. Manifest xin `unlimitedStorage` vì snapshot của site nặng có thể vượt quota 10MB.
- `Reload tab after restore` mặc định bật: hầu hết app chỉ đọc storage lúc khởi động nên không reload thì state mới chưa có tác dụng.
- Chỉ thao tác trên **main frame**; storage của iframe con chưa hỗ trợ.
- Sửa record IndexedDB, Cache Storage và diff hai snapshot chưa nằm trong bản này (xem `docs/spec.md` §14).
