# Changelog

Tất cả thay đổi đáng chú ý của extension **Full Page Capture** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.2.2] - 2026-08-31

### Fixed

- **App bar tự ghim khi cuộn bị chụp lặp lại ở mọi màn** — danh sách phần tử `fixed`/`sticky` được lập **một lần duy nhất lúc trang còn ở `scrollTop = 0`**. Kiểu header rất phổ biến là `static` ở đỉnh trang rồi chỉ thành `fixed` khi scroll handler gắn class vào: lúc quét nó chưa `fixed` nên không bao giờ bị ẩn, và lặp lại ở từng màn chụp. Đo trên fixture đúng kiểu đó: bar hiện **7 lần** trên ảnh, trong khi badge luôn `fixed` từ đầu thì chỉ hiện 1 lần — chênh lệch đó chỉ thẳng vào nguyên nhân.
- Nay quét lại ở **mỗi** màn chụp, sau `requestAnimationFrame` đầu tiên kể từ lúc cuộn để scroll handler của trang kịp chạy. Phần tử đã biết được bỏ qua nên chỉ trả giá cho phần tử mới: **5–9ms** trên DOM 12 000 phần tử, so với 549ms mỗi màn vốn đã phải chờ quota của `captureVisibleTab` — tức không thêm thời gian thực tế nào.
- **Bar nằm trong shadow root cũng lặp lại** — `TreeWalker` dừng ở ranh giới shadow, mà web component đúng là chỗ thanh bar, cookie banner và widget chat ngày nay hay nằm; đo được lặp 5/5 màn. Nay quét cả shadow root **mở**. Root **closed** thì vẫn chịu, không có đường nhìn vào từ bên ngoài.
- **Ẩn bằng inline style thay cho class** — class phụ thuộc `<style>` đặt trong document, mà style của document không lọt vào shadow root, nên phần tử tìm thấy trong web component sẽ được thu thập rồi… vẫn hiện nguyên trong ảnh.
- Có test hồi quy: đếm số dải màu của bar dọc ảnh kết quả, phải đúng một dải ở đầu — cho cả bar thường lẫn bar trong shadow root.

## [1.2.0] - 2026-08-31

### Added

- **Bộ công cụ vẽ đầy đủ trên trang kết quả**: `Pen` (vẽ tay), `Line`, `Arrow`, `Rect`, `Ellipse`, `Highlight`, `Fill` (đổ màu vùng liền màu), `Eraser`, `Pick` (hút màu từ ảnh) — cùng `Crop`, `Redact` và `Text` đã có.
- **Hàng thuộc tính riêng**: 8 ô màu dựng sẵn + ô màu tự chọn, hai hộp size **gõ được** (`Line` cho độ dày nét, `Text` cho cỡ chữ) và ô `Filled shapes` cho Rect/Ellipse. Mỗi hộp là một combobox tự dựng — ô nhập + nút `▾` mở danh sách preset — đúng kiểu ô cỡ chữ của Word: chọn một preset hoặc gõ số bất kỳ như `7`, `23`. Không dùng `<datalist>` vì Chrome không vẽ dấu hiệu xổ xuống nào cho `<input list=…>`, cả `type="number"` lẫn `type="text"`; danh sách preset mà nhìn không ra là có thì coi như không tồn tại. Chevron là SVG 18×18 trong vùng bấm 30×26 trải hết chiều cao ô — ký tự `▾` vẽ nhỏ, mỗi font một kiểu và không chỉnh được vùng bấm. Dòng trong danh sách cao tối thiểu 34px, danh sách rộng tối thiểu 120px. Giá trị kẹp trong `[1,200]` và `[6,400]`; hộp để trống trở về mặc định chứ không kẹp xuống min, vì `Number('')` là `0` và nếu không chặn riêng thì xoá trắng ô sẽ lặng lẽ cho ra nét 1px. Tách thành hàng thứ hai vì nhồi mười hai công cụ lẫn bảng màu vào một hàng thì trên laptop nó tự xuống dòng thành một khối lộn xộn.
- **Mũi tên có thân dừng trước đỉnh**: `lineCap: 'round'` làm nét lồi thêm nửa độ dày ra ngoài điểm kết thúc, nên thân chạy tới `(x2,y2)` chọc một cục màu xuyên qua tam giác — nhìn hệt như tam giác bị thụt vào trong. Thân dừng ở `length - head*0.9` và dùng `lineCap: 'butt'`, để đỉnh tam giác là điểm xa nhất của hình.
- **Highlight vẽ bằng `globalCompositeOperation: multiply`**, nên chữ bên dưới vẫn đọc được thay vì bị phủ mất — đúng cách bút dạ quang thật hoạt động.
- **Eraser trả pixel gốc về chứ không bôi trắng.** Lúc replay, nếu stack có eraser thì dựng thêm một canvas `clean` = ảnh đã áp crop và redact nhưng chưa có nét vẽ nào, rồi stroke bằng `createPattern(clean)`.
- **Redact nằm trong `clean` là có chủ đích**: tẩy lên vùng đã che **không** làm lộ lại nội dung. Nếu không thì Eraser trở thành đường vòng phá chính lời hứa của Redact. Có test riêng cho tính chất này.
- Độ dày nét, như cỡ chữ, tính bằng CSS pixel của trang gốc nhân `meta.scale`, nên nét 4px trông như nhau trên ảnh 1× và 2×.
- Mọi nét vẽ đi chung stack lệnh: `Undo` gỡ từng cái một, `Reset` xoá sạch, blob gốc không bị đụng tới.

### Fixed

- **`padding-right` của ô size bị ghi đè** — nó được viết _trước_ `padding` shorthand trong cùng rule, nên chỗ chừa cho chevron bị shorthand xoá sạch và con số đè lên mũi tên. Shorthand nay đứng trước longhand.

### Notes

- Canvas `clean` chỉ được tạo khi stack thật sự có lệnh eraser — với ảnh dài nó tốn thêm cả trăm MB, không đáng trả khi không ai tẩy.
- Kiểm chứng bằng chuột và bàn phím thật qua CDP: 42 assertion phủ từng công cụ (lệnh ghi đúng loại, có hình học thật), màu và độ dày tới được lệnh, Fill đổi pixel, Pick đọc màu, Eraser trả đúng pixel gốc, tẩy lên vùng redact không làm lộ lại, và combobox size mở/chọn/đóng đúng bằng chuột thật.

## [1.1.0] - 2026-08-31

### Added

- **Công cụ Text** — bấm một điểm trên ảnh, ô nhập hiện ngay tại đó, gõ rồi `Enter` để chốt (`Esc` huỷ). Ô nhập nằm đè lên canvas với cùng font và cùng tỉ lệ hiển thị, nên chữ không nhảy chỗ lúc chốt. Màu chọn ở ô màu cạnh nút, mặc định đỏ.
- Cỡ chữ tính theo **CSS pixel của trang gốc nhân với `meta.scale`**, nên nhãn trên ảnh 1× và ảnh 2× trông to như nhau — viết thẳng bằng pixel ảnh thì trên máy retina chữ ra bé bằng nửa. Chữ vẽ kèm viền trắng mảnh để đọc được trên cả nền tối mà không cần hộp nền.
- Text đi cùng stack lệnh như crop và redact: `Undo` gỡ được, `Reset` xoá sạch, và blob gốc không bị đụng tới.

### Fixed

- **Thanh cuộn ngang nằm ngoài tầm với** — trang kết quả để `body` cuộn, còn stage thì cao bằng cả ảnh. Với ảnh rộng hơn màn hình, thanh cuộn ngang vì thế nằm ở đáy một element cao hàng chục nghìn pixel: muốn kéo ngang phải cuộn xuống hết ảnh trước. Nay `html, body` cao đúng 100% và `overflow: hidden`, stage là `flex: 1` với `overflow: auto` — cả hai thanh cuộn luôn nằm ở mép cửa sổ.
- **Fit không fit thật** — bề rộng khả dụng tính bằng `clientWidth - 32` trong khi padding thực tế là 20px mỗi bên, tức lạc quan 8px, đủ để sinh thanh cuộn ngang dưới tấm ảnh vừa hứa là đã vừa khít. Nay padding đọc từ computed style, và stage đặt `scrollbar-gutter: stable` để chừa sẵn chỗ cho thanh cuộn dọc — nếu không, Fit đo được một bề rộng mà ngay sau đó thanh cuộn lấy mất.

### Notes

- Kiểm chứng trên Chrome for Testing chạy `--force-device-scale-factor=2`, tức đúng tình huống màn retina nơi ảnh chụp rộng gấp đôi cửa sổ: ảnh 1970px trong stage 985px, Fit thu về 945px và `scrollWidth === clientWidth` (không còn tràn ngang); ở 100% thì tràn ngang nằm **trong** stage, còn trang vẫn không cuộn. Text ở 2× tự lên cỡ 36 đúng như thiết kế.

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
