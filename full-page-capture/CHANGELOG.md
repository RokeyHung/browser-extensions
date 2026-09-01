# Changelog

Tất cả thay đổi đáng chú ý của extension **Full Page Capture** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.0] - Initial release

### Added

- **Chụp toàn bộ trang đang mở, hết chiều dài** — cuộn từng màn, chụp, ghép trên `OffscreenCanvas` ở đúng device pixel vật lý của màn hình. Không resample, không downscale (§5, §7).
- **Không có vệt nối giữa các đoạn** — mỗi tile được đặt theo vị trí cuộn **thực tế** trình duyệt báo về chứ không phải vị trí dự định, và làm tròn đặt ở hai mép tile chứ không ở chiều cao. Làm theo cách hiển nhiên hơn thì mỗi tile lệch dưới 1px, cộng dồn 20 tile thành một đường kẻ mờ vắt ngang ảnh.
- **Không xin quyền truy cập site nào** — `activeTab`, cấp bởi chính cú bấm nút hoặc `Alt+Shift+S`, là đủ cho việc chụp tab hiện tại (§18). Lúc cài không hiện dòng cảnh báo "Read and change all your data on all websites".
- **Không mở tab, không điều hướng, không crawl** — trang cần chụp đã ở trước mặt, nên màn đầu tiên được chụp khoảng **0,8 giây** sau cú bấm.
- **Xử lý header/footer `fixed` và `sticky`** — ẩn từ màn thứ hai trở đi để không lặp lại thành từng dải; riêng `sticky` thì gỡ `position` thay vì ẩn, vì nó thường là nội dung thật (tiêu đề cột trong bảng). Animation, transition và video bị đóng băng; ảnh `loading="lazy"` bị ép load trước. Toàn bộ được hoàn nguyên trong `finally`, kể cả khi chụp lỗi hoặc user bấm Stop.
- **Ảnh vượt giới hạn canvas của Chrome thì cắt thành nhiều file**, không bao giờ thu nhỏ (§8).
- **Trang kết quả** — crop và redact (blur hoặc khối đặc, huỷ pixel thật nên file xuất ra không khôi phục được), undo, zoom fit/100%, xuất PNG/JPEG, copy vào clipboard (§11).
- **Chế độ Save** — ghi thẳng ra Downloads qua offscreen document, rồi xoá khỏi workspace ngay khi file đã nằm trên đĩa (§16).
- **Ba setting, một nút, một lựa chọn trong popup**: kết quả đi đâu (§12, §13). Mọi thứ còn lại là hằng số trong code.
- **Không lịch sử, không một request mạng nào, không quyền `debugger`** (§19).

### Notes

- **Bản nháp đầu tiên là extension chụp cả site** — dò URL từ `robots.txt`, sitemap và link, một hàng đợi, một tab riêng, một gallery thumbnail. Tầng đó đã bị bỏ hẳn sau khi dùng thử, vì nó hỏng ở bốn chỗ cùng lúc: đứng ở `/docs/a` bấm chụp thì nó đi chụp cả `/blog` và `/pricing`; nó mở một tab lạ rồi đi lang thang trong đó hàng phút; nó đọc `robots.txt` trước khi bấm máy nên có một quãng đứng im giữa cú bấm và tấm ảnh đầu tiên; và nó **buộc phải xin quyền `<all_urls>`**, vì `captureVisibleTab` không nhận host permission nào yếu hơn `<all_urls>` hoặc `activeTab`, mà một lượt crawl thì đi vào những trang user chưa hề bấm nút lên.
- **Bỏ tầng crawl sửa cả bốn cùng lúc, kể cả cái quyền.** Việc chụp giờ chỉ xảy ra trên đúng tab user vừa invoke, nên `activeTab` phủ hết và extension không xin quyền vào bất kỳ site nào. Với một công cụ chụp màn hình, đó là khác biệt giữa "đọc và thay đổi dữ liệu trên mọi trang web" và không cảnh báo gì.
- **Đã kiểm chứng end-to-end** trên Chrome for Testing qua CDP với một site giả lập cục bộ: một sự kiện phím `Alt+Shift+S` thật, manifest **không có `host_permissions`**, chụp trang cao 3858px thành 10 màn trong 5,9 giây, màn đầu ở t+0,8s; PNG rút ngược ra từ IndexedDB đủ chiều dài và header `fixed` xuất hiện đúng một lần. Cùng lệnh đó gọi qua CDP mà không có user invocation thì bị Chrome từ chối — đúng là điều `activeTab` cam kết.
- **Những thứ khác đã bỏ dọc đường**: engine chụp 2×/3× qua `chrome.debugger` (kéo theo banner "… is debugging this browser" và quyền mạnh nhất trong danh sách), các chế độ chụp vùng/phần tử, picker chọn tay vùng cuộn, công cụ chú thích mũi tên/khung/chữ, xuất PDF, và mọi ô nhập số trang.
