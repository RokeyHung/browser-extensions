# Changelog

Tất cả thay đổi đáng chú ý của extension **Media Saver for Facebook** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-02

### Added

- **Tải ảnh và video của bài đăng đang xem bằng một cú bấm.** Rê chuột lên một ảnh/video trong feed, permalink, trình xem ảnh, Watch hoặc Reels → hiện nút ở góc trên-phải; bấm là file rơi vào Downloads. Phím tắt `Alt+Shift+D` làm đúng việc đó với media đang trỏ chuột.

- **Ba lớp thu thập URL chạy song song** (`spec §6`) — vì trên Facebook không có lớp nào đủ một mình:

  - **DOM** cho ảnh: `srcset` + `naturalWidth` + ảnh lớn trong lightbox (`img[data-visualcompletion="media-vc-image"]`). Luôn có, nhưng thường chỉ là bản đã resize phía server.
  - **JSON nhúng**: các thẻ `<script type="application/json">` mà Facebook stream vào lúc render đầu tiên.
  - **Hook `fetch`/`XHR` ở MAIN world**: nội dung cuộn tới sau đều đi qua `POST /api/graphql/`, và **không gọi lại được** — endpoint đó cần `doc_id`, token phiên và biến nội bộ đổi liên tục. Không bắt lấy response lúc nó đi qua thì thông tin mất hẳn. Đây là khác biệt kiến trúc lớn nhất so với Media Harvest bên X, vốn chỉ cần gọi một API theo `tweetId` khi user bấm nút.
  - MV3 không còn đường nào khác: `webRequest` không đọc được response body và `declarativeNetRequest` cũng không.

- **Video lấy từ payload chứ không từ `<video>`.** Facebook phát bằng MSE nên `<video>.src` là `blob:` trỏ vào buffer trong trang — vô dụng cả với `chrome.downloads` lẫn với bất cứ cách nào khác. `video-pick.js` đọc `playable_url_quality_hd` / `browser_native_hd_url` / `hd_src` / `playable_url` / `browser_native_sd_url` / `sd_src`, nhánh mới `videoDeliveryResponseFragment` (`progressive_urls`, `dash_manifests`), và `all_video_dash_prefetch_representations`. Bộ khoá này lấy theo extractor Facebook của yt-dlp — thứ đã sống qua nhiều lần Facebook đổi schema, nên nó là điểm khởi đầu đúng thay vì tự đoán tên trường.

- **Chỉ tải DASH khi có representation muxed.** Nếu manifest chỉ có audio-only + video-only tách rời thì nút báo `Split audio/video not supported yet.` và **không** tải gì. Tải representation video rồi gọi đó là thành công sẽ cho ra một file câm mà user chỉ phát hiện sau khi bài gốc đã bị xoá — đúng loại lỗi tệ nhất của họ extension này (`spec` R8). Ghép hai stream cần một MP4 remuxer tự viết hoặc một bản ffmpeg WASM hàng chục MB; cả hai đều mâu thuẫn với "no build step" của repo, nên v1 nói thẳng là không làm được.

- **Không sửa URL đã ký** (`spec` R3, §7.2). URL của `scontent.*.fbcdn.net` được ký bằng `oh`/`oe`; mẹo cũ "xoá `stp` để lấy bản gốc" nay trả 403. Bản lớn hơn phải **tìm thấy** trong payload hoặc `srcset`, không được **chế ra**. Hệ quả được nói thẳng trong UI thay vì giấu: tooltip cho biết trước sẽ tải gì (`JPEG · 2048 × 1536`), và khi chỉ có bản resize thì lịch sử ghi cảnh báo `Only a resized copy was available.`

- **Mọi selector phụ thuộc DOM Facebook nằm trong một file** (`modules/fb-selectors.js`, `spec` R7), mỗi mục kèm lý do tin được và ngày kiểm. Neo theo `data-pagelet^="FeedUnit"`, `[role="article"]` và `data-visualcompletion` — thứ tồn tại vì đo hiệu năng và vì trợ năng, chứ không phải vì CSS. Class name của Facebook là chuỗi sinh tự động và `aria-label` thì bản địa hoá ("Like" → "Thích"), nên bất cứ selector nào dựa vào hai thứ đó đều hỏng trong vài tuần.

- **Trang Diagnostics** trong Options in ra số phần tử mỗi neo tìm thấy, số record theo từng lớp harvest, và lỗi gần nhất. Khi Facebook đổi markup, triệu chứng với user là "nút không hiện nữa" — vô dụng cho cả user lẫn người sửa; báo cáo này biến nó thành một con số dán được vào issue.

- **Đúng một element được thêm vào DOM của Facebook**: một shadow host `mode: 'closed'` chứa nút, menu chọn chất lượng và các dấu ✓. Feed của Facebook là virtualised — nút gắn vào post sẽ bị dọn cùng post, và hàng trăm node inject là một memory leak có giao diện. Một `MutationObserver` cho cả trang, throttle 250ms, thay cho observer mỗi post.

- **Tên file theo pattern**, mặc định `{author}-{date}-{postId}-{index}`, có `{handle}`, `{mediaId}`, `{datetime}`, `{type}`, `{quality}`, `{surface}`, và thư mục con. Có **cả `{author}` lẫn `{handle}`** là cố ý: người dùng Media Harvest phàn nàn đúng chuyện không dùng được nickname trong tên file. Options hiện preview sống cập nhật theo từng ký tự gõ. Đuôi file **không** nằm trong pattern — cho user gõ đuôi là mời họ tạo ra một file `.jpg` chứa MP4.

- **Lịch sử tải + dấu ✓** trên media từng tải, lưu **metadata thôi**: khoá, tên file, post URL, dung lượng, thời điểm. Không byte, không thumbnail, không caption — file đã nằm trong Downloads rồi, giữ thêm một bản chỉ nhân đôi dữ liệu nhạy cảm.

- **Hai đường tải** (`spec §16`): mặc định giao thẳng URL cho `chrome.downloads` nên byte đi từ CDN xuống đĩa không qua extension (không tốn RAM, video 500MB cũng như ảnh 200KB). Chỉ khi Chrome từ chối (403/`SERVER_*`) mới rơi xuống đường dự phòng: offscreen document `fetch` với `credentials: 'omit'` rồi đúc object URL — service worker MV3 không có `URL.createObjectURL`.

- **Ba quyền, cộng một tuỳ chọn**: `downloads`, `storage`, `offscreen`, và `notifications` chỉ khi user bật. `host_permissions` đúng hai dòng: `*.facebook.com` và `*.fbcdn.net`. Không `<all_urls>`, không `tabs`, không `webRequest`, không `cookies`, và **không `scripting`** — cả hai content script khai thẳng trong manifest với `"world": "MAIN"` nên không có lần `executeScript` nào.

### Security

- **Service worker kiểm lại host của mọi URL trước khi tải** (`spec §16.1). Content script chạy trong trang do bên khác kiểm soát và nhận record từ MAIN world, nên không lời nào của nó về một URL được tin. Dù một script của trang có vượt qua được cả token handshake lẫn kiểm ở content script, thứ tệ nhất nó đạt được vẫn chỉ là một file từ chính CDN của Facebook.
- **MediaIndex không bao giờ chạm đĩa.** Nó là bản kê những gì user vừa xem — thứ nhạy cảm nhất extension đụng tới. Chỉ nằm trong bộ nhớ content script, chết cùng tab.
- **Hook `fetch` chỉ đọc bản `clone()`**, trả về response gốc nguyên vẹn và không nuốt lỗi. Một Facebook hỏng vì extension tệ hơn mọi tính năng nó đem lại.
- Không có request nào ra ngoài `facebook.com`/`fbcdn.net`: không server riêng, không analytics, không kiểm tra phiên bản qua mạng.

### Notes

- **Chưa có số đo trên Facebook thật.** Bản này được viết trọn vẹn theo spec nhưng chưa chạy với tài khoản thật, nên `docs/spec.md §23` liệt kê 8 giả định (A1–A8) kèm cách kiểm từng cái. Hai cái quyết định nhiều nhất: **A2** — tỉ lệ video chỉ có DASH tách stream; nếu > 30% thì §8.3 phải làm lại ngay ở v1 chứ không hoãn được. **A7** — nếu `chrome.downloads` tải URL fbcdn trực tiếp không bao giờ hỏng thì bỏ được cả đường dự phòng offscreen lẫn host permission `*.fbcdn.net`. Số đo của các mục đó thuộc về bản phát hành tiếp theo.
- Không có crawl, không có batch theo tài khoản/album/group, không tự động click hay tự cuộn để ép trang nạp thêm. Mỗi file xuống đĩa đều bắt nguồn từ một cú bấm trong lượt tương tác đó (`spec` R5, §20). Nút "tải cả bài" chỉ lấy media của **một** bài đang hiển thị.
- Stories, Messenger và Marketplace nằm ngoài v1 — Stories vì lý do riêng tư chứ không phải kỹ thuật (`spec §3.2`).
- Xung đột với extension quản lý download khác: file này **không** dùng `onDeterminingFilename` nên không tranh listener với ai; nếu một lượt tải bị huỷ mà user không bấm huỷ thì lịch sử ghi `Download was cancelled — possibly by another download manager extension.` thay vì để user tưởng extension hỏng.
- Tự động tải nội dung từ Facebook có thể vi phạm Điều khoản dịch vụ của Meta, và media trên Facebook thuộc bản quyền của người đăng. Công cụ này dành cho việc lưu nội dung của chính bạn hoặc nội dung bạn được phép lưu.
