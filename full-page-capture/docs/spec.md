# Spec: Full Page Capture Extension

## 1. Mục tiêu

Xây dựng browser extension chụp ảnh **toàn bộ trang web đang mở** — hết chiều dài, không chỉ phần đang nhìn thấy — và ảnh ra vẫn **sắc nét đúng bằng độ phân giải vật lý của màn hình**, không bị mờ, không bị vệt nối giữa các đoạn.

Extension làm **đúng một việc**: bấm một nút, chụp trang đang mở. Không crawl, không mở tab, không đi sang URL khác, không chế độ chụp, không lựa chọn engine.

Bản nháp trước của spec này là một extension chụp **cả site**: dò URL từ robots.txt/sitemap/link rồi lần lượt chụp từng trang vào một gallery. Đã bỏ hẳn, và lý do đến từ việc dùng thử thật:

- Đứng ở `/docs/a` bấm chụp thì nó đi chụp cả `/`, `/blog/x`, `/pricing`. Đúng chữ "entire site" trên nút, nhưng không phải thứ một người đang đọc một trang muốn.
- Nó mở một tab lạ rồi đi lang thang trong đó hàng phút.
- Nó phải đọc `robots.txt` + sitemap trước, nên có một quãng đứng im giữa cú bấm và tấm ảnh đầu tiên.
- Nó buộc phải xin `<all_urls>` — "đọc và thay đổi dữ liệu trên mọi trang web" — vì `captureVisibleTab` không nhận host permission thường (§18).

Bỏ tầng site thì cả bốn vấn đề biến mất cùng lúc, kể cả cái quyền đáng sợ nhất. Thứ còn lại — chụp một trang hết chiều dài, thật nét — vốn luôn là phần khó và là phần có giá trị.

Tham chiếu: **GoFullPage – Full Page Screen Capture**. Extension này giữ luồng dùng quen thuộc (bấm 1 nút → trang tự cuộn → mở tab kết quả) nhưng khác ở hai điểm:

1. **Không hạ chất lượng.** GoFullPage ghép ảnh rồi encode lại; ở trang dài, ảnh bị downscale nên chữ nhoè. Ở đây độ nét là ràng buộc cứng: canvas ghép ở đúng device pixel, không resample, mặc định PNG lossless. Vượt giới hạn kỹ thuật thì **cắt thành nhiều file**, không tự ý thu nhỏ.
2. **Không gửi ảnh đi đâu, và không xin quyền vào site nào.** Không tài khoản, không upload. Extension chỉ chạm được đúng cái tab bạn vừa bấm nút, trong đúng lúc đó (§18).

Use case duy nhất:

```text
User đang mở một trang (docs, landing, blog, dashboard nội bộ).
Bấm icon extension → "Capture this page" (hoặc Alt+Shift+S).
Trang tự cuộn từ trên xuống dưới, chụp từng màn, ghép lại.
Xong thì mở tab kết quả: xem ảnh full, che vùng nhạy cảm, cắt cúp, tải PNG/JPEG.

Hoặc chọn "Save": file rơi thẳng vào Downloads, không mở tab nào cả.
```

## 2. Định nghĩa

### 2.1. Viewport

Vùng nhìn thấy của tab, tính bằng **CSS pixel**:

- `viewportWidth = document.documentElement.clientWidth` (đã trừ scrollbar dọc)
- `viewportHeight = document.documentElement.clientHeight`

Phân biệt với `window.innerWidth/innerHeight` — hai giá trị này **bao gồm** cả scrollbar. Hiệu số `window.innerWidth - documentElement.clientWidth` chính là bề rộng scrollbar cần cắt bỏ (§7.6).

### 2.2. Scale factor

Số **device pixel** trên mỗi **CSS pixel** của ảnh chụp được:

```text
scale = capturedBitmap.width / window.innerWidth
```

Mẫu số là `innerWidth` chứ không phải `clientWidth`: ảnh của `captureVisibleTab` bao gồm cả scrollbar, nên bề rộng thật của nó tương ứng với `innerWidth` (§7.6).

Extension **luôn đo scale bằng công thức trên**, không tin `window.devicePixelRatio`. Lý do: `devicePixelRatio` đã gộp sẵn page zoom, mà page zoom lại ảnh hưởng tới `clientWidth` theo hướng ngược lại; trên màn hình lẻ (125%, 150%) và khi user zoom 110% thì hai đường tính ra kết quả lệch nhau vài phần nghìn — đủ để cộng dồn thành lệch 3–4 pixel ở cuối trang dài.

`scale` là **trần độ phân giải**, bằng đúng DPR thật của màn hình. Extension không có cách nào chụp cao hơn (§5, R5) và không giả vờ rằng có.

### 2.3. Tile

Một lần `captureVisibleTab` = một **tile**: ảnh của viewport tại một vị trí scroll cụ thể.

Tile được mô tả bằng:

```json
{
  "index": 3,
  "scrollY": 2160,
  "actualScrollY": 2160,
  "dy": 4320,
  "sw": 2880,
  "sh": 1600
}
```

`dy` là toạ độ đích trên canvas ghép, `sw/sh` là kích thước vùng được lấy từ ảnh chụp — tất cả tính bằng **device pixel**. `dy` luôn suy ra từ `actualScrollY` chứ không phải `scrollY` dự định (§7.5, quy tắc R4).

### 2.4. Full page size

```text
fullWidth  = max(scrollWidth, clientWidth) của scrolling element
fullHeight = max(scrollHeight, clientHeight) của scrolling element
```

Lấy trên `scrollTarget` (§2.5), không mặc định `document.body` — nhiều SPA đặt `body { overflow: hidden }` và cuộn ở một div con.

### 2.5. Scroll target

Phần tử thực sự cuộn được của trang. Thứ tự dò, **hoàn toàn tự động** — không có UI chọn tay (§23):

1. `document.scrollingElement` nếu `scrollHeight > clientHeight + 4`.
2. Nếu không: quét DOM tìm phần tử có `scrollHeight > clientHeight + 32`, `overflow-y ∈ {auto, scroll}`, và diện tích hiển thị ≥ 50% viewport. Chọn phần tử có `scrollHeight` lớn nhất.
3. Không tìm thấy → trang coi như chỉ có một tile.

Dò sai là chuyện có thể xảy ra trên SPA lạ; khi đó ảnh chỉ có phần nhìn thấy và meta ghi warning (§17). Đổi lại, không có nút nào để user phải hiểu.

### 2.6. Cơ chế chụp

Chỉ có **một** cơ chế: **Scroll & Stitch** — cuộn trang theo từng bước viewport, gọi `tabs.captureVisibleTab` mỗi bước, rồi ghép các tile lại trên `OffscreenCanvas` (§7). Chỉ cần `activeTab` + `scripting`, chạy được ở mọi nơi Chrome cho phép inject, và không hiện banner cảnh báo nào.

Bản nháp trước có thêm engine "High fidelity" chụp qua `chrome.debugger` (CDP) để lấy 2×/3×. **Đã bỏ hẳn.** Lý do: nó bắt user chấp nhận quyền `debugger`, làm Chrome treo banner _"… is debugging this browser"_ trên tab suốt lượt chụp, hỏng trên các trang dùng `100vh`, không attach được khi DevTools đang mở, và nếu service worker chết giữa chừng thì banner ở lại cho tới khi user đóng tab. Với một lượt chụp kéo dài hàng phút qua hàng chục trang, đó là rủi ro và độ phức tạp không xứng với vài trang được nét hơn. Cùng với nó, các thứ sau biến mất: quyền `debugger`, `modules/capture-cdp.js`, tham số `engine` và `scale`, hai setting `cdpScale` / `cdpKeepViewportHeight`, và toàn bộ dialog cảnh báo banner.

### 2.7. Pixel budget

Tổng số device pixel của ảnh kết quả. Trần cứng của Chrome:

- Cạnh tối đa: **65 535 px**
- Diện tích tối đa: **268 435 456 px** (2^28, tức 16384×16384)

Extension đặt `MAX_PIXELS = 200 000 000` (an toàn dưới trần, vẫn đủ cho trang ~1440px rộng × 34 000px cao ở 2×). Vượt ngưỡng → cắt file theo §8.

## 3. Phạm vi

### 3.1. Trong phạm vi

- Chụp **trang đang mở**, hết chiều dài, trên trang http(s) (§7).
- Tự dò vùng cuộn thật của trang (§2.5).
- Xử lý header/footer `position: fixed` và `position: sticky` để không bị lặp lại ở mỗi đoạn.
- Kích hoạt lazy-load trước khi chụp.
- Đóng băng animation/transition/video trong lúc chụp để các đoạn khớp nhau.
- Cắt nhiều file khi ảnh vượt giới hạn kỹ thuật, giữ nguyên độ nét (§8).
- Trang kết quả: xem, cắt cúp, che vùng nhạy cảm, tải PNG/JPEG, copy clipboard (§11).
- Chụp xong **tải thẳng ra đĩa**, không mở tab kết quả (`afterCapture: "download"`, §16).
- Một phím tắt duy nhất: `Alt+Shift+S`.

### 3.2. Ngoài phạm vi (v1)

- **Chụp cả site / crawl sang URL khác.** Đây không phải "chưa làm" mà là **đã bỏ** sau khi dùng thử (§1).
- **Chụp một vùng, một phần tử, hay chỉ phần nhìn thấy.** Extension làm đúng một việc.
- **Chụp ở độ phân giải cao hơn màn hình** (2×/3× qua `chrome.debugger`) — §2.6.
- **Đăng nhập**: extension không có bước login. Nó chạy trong browser của user nên cookie sẵn có vẫn được dùng như bình thường.
- Chạy nền / chụp khi cửa sổ bị che: `captureVisibleTab` chỉ chụp được thứ đang hiển thị.
- Chụp nội dung iframe **cross-origin** ở toạ độ riêng (ảnh vẫn có iframe vì đó là pixel đã render, nhưng không cuộn được bên trong iframe).
- Cuộn nhiều container lồng nhau cùng lúc.
- Chụp trang `chrome://`, `chrome-extension://` của extension khác, Chrome Web Store, `view-source:` — Chrome chặn ở tầng dưới.
- Chụp video đang phát thành ảnh động / GIF / quay màn hình.
- OCR, upload, chia sẻ link, đồng bộ đám mây, tài khoản.
- Firefox (`browser.tabs.captureTab` có `rect` + `scale` chụp thẳng ngoài viewport — kiến trúc sẽ khác, để bản sau).

## 4. Kiến trúc

```text
full-page-capture/
├── docs/spec.md
├── CHANGELOG.md
└── extension/
    ├── manifest.json
    ├── background.js              # service worker: điều phối một lượt chụp, message router
    ├── popup.html / popup.js
    ├── options.html / options.js
    ├── result.html / result.js    # trang kết quả: xem + crop/redact + tải về
    ├── offscreen.html / offscreen.js  # chỉ để đúc object URL khi tải file (§16)
    ├── content.js                 # overlay tiến trình
    ├── modules/
    │   ├── page-metrics.js        # chạy trong page: đo trang, dò scroll target
    │   ├── page-prepare.js        # chạy trong page: freeze/unfreeze, ẩn fixed, lazy-load
    │   ├── capture-page.js        # lập kế hoạch tile, vòng lặp chụp, ghép
    │   ├── stitcher.js            # ghép tile trên OffscreenCanvas, cắt scrollbar, split
    │   ├── image-store.js         # IndexedDB: bàn giao blob của đúng một lượt chụp
    │   ├── settings.js            # defaults + hằng số nội bộ + đọc/ghi chrome.storage.sync
    │   └── filename.js            # đặt tên file theo host + path
    ├── styles/
    │   ├── popup.css
    │   ├── options.css
    │   └── result.css
    ├── icons/
    │   ├── camera-source.svg      # nguồn: SVG Repo
    │   ├── icon16.png / icon48.png / icon128.png
    └── generate-icons.js
```

Không có content script thường trú. `content.js` chỉ được `chrome.scripting.executeScript` khi lượt chụp bắt đầu, và gỡ ngay sau khi xong.

`content.js` **tự mang CSS của mình** trong một shadow root `mode: 'closed'`, không có file `overlay.css` và không `insertCSS`. Lý do: shadow root không nhận CSS từ `insertCSS`, còn cách thay thế (`<link>` tới một web-accessible resource) sẽ để lộ URL của extension cho trang web dò. Đổi lại, extension không để lại dấu vết nào trong DOM ngoài đúng một element gắn `data-fpc-overlay`.

Luồng tổng quát:

```text
popup / phím tắt   ← cú bấm này cấp activeTab cho tab hiện tại (§18)
      │  startCapture{ tabId, afterCapture }
      ▼
background.js
      │ 1. ImageStore.clear()   workspace chỉ giữ một ảnh
      │ 2. inject content.js    overlay tiến trình
      │ 3. page-metrics         fullWidth/Height, scrollTarget
      │ 4. page-prepare         freeze, ẩn fixed, kích lazy-load
      │ 5. vòng lặp scroll → captureVisibleTab → stitcher (vẽ ngay từng tile)
      │ 6. page-prepare         restore nguyên trạng (luôn chạy, kể cả khi lỗi)
      │ 7. image-store          IndexedDB { id, blobs, thumb, meta }
      │ 8. preview → tabs.create result.html?page=<id>
      │    download → offscreen → chrome.downloads → xoá entry (§16)
      ▼
result.js  → đọc blob từ IndexedDB → hiển thị / sửa / tải về
```

## 5. Giữ độ nét — ràng buộc cứng

Đây là lý do tồn tại của extension, nên tách riêng thành quy tắc. Mọi thay đổi code sau này phải không vi phạm các mục dưới:

**R1. Canvas ghép có kích thước bằng đúng tổng device pixel.**

```js
canvas.width = Math.round(fullWidth * scale);
canvas.height = Math.round(fullHeight * scale);
```

Không bao giờ tạo canvas theo CSS pixel rồi để trình duyệt phóng lên.

**R2. `drawImage` luôn 1:1.** Vẽ tile vào canvas với đúng kích thước gốc của bitmap, không truyền `dw/dh` khác `sw/sh`. Bất kỳ lần scale nào trong lúc ghép đều là một lần nội suy làm nhoè chữ.

**R3. Chuỗi encode chỉ có một mắt xích.** `captureVisibleTab({ format: 'png' })` → `createImageBitmap` → canvas → `convertToBlob({ type: 'image/png' })`. Không đi qua JPEG trung gian ở bất kỳ bước nào, kể cả khi output cuối là JPEG (JPEG chỉ encode một lần, từ canvas cuối cùng).

**R4. Toạ độ tile làm tròn ở hệ device pixel, và tính từ vị trí scroll _thực tế_.** Sau mỗi lần scroll phải đọc lại `scrollTarget.scrollTop` — trình duyệt có thể làm tròn về subpixel hoặc dừng sớm ở cuối trang.

```js
const dy = Math.round((actualScrollY - startScrollY) * scale);
```

Nếu tính `dy` từ giá trị scroll _dự định_ thì mỗi tile lệch dưới 1px, cộng dồn 20 tile thành đường kẻ mờ giữa các đoạn.

**R5. Không dùng CSS `zoom` / `transform: scale` để "chụp nhiều hơn mỗi lần".** Cách đó rẻ nhưng làm trang re-layout theo breakpoint khác và giảm số device pixel trên mỗi CSS pixel — đúng thứ cần tránh. DPR thật của màn hình là trần; không có đường vòng nào để vượt nó (§2.6).

**R6. Vượt pixel budget thì cắt file, không thu nhỏ.** Không có nhánh "tự động thu nhỏ cho vừa" (§8).

**R7. Mặc định PNG.** JPEG dùng quality cố định **0.92**, và chỉ khi user chọn. Không có "chất lượng tự động".

**R8. Ảnh lưu trong IndexedDB là Blob PNG gốc.** Trang kết quả hiển thị bản đã fit-to-screen, nhưng khi tải về luôn xuất từ blob gốc — cái đang hiển thị chỉ là preview.

## 6. Một lượt chụp

### 6.1. Vào lệnh

Popup có đúng một nút: **`Capture this page`**, hoặc phím tắt `Alt+Shift+S`. Cả hai đều là một **user invocation** theo nghĩa của Chrome, và đó không phải chi tiết vụn: chính cú bấm đó cấp quyền `activeTab` cho tab hiện tại, thứ duy nhất cho phép `captureVisibleTab` chạy (§18).

### 6.2. Luồng

```text
startCapture{ tabId }
    ImageStore.clear()          workspace chỉ giữ một ảnh (§10)
    inject content.js           overlay tiến trình
    capturePage(...)            §7 — đo, freeze, cuộn, chụp, ghép
    ImageStore.putPage(...)
    afterCapture = 'preview'  → mở result.html?page=<id>
    afterCapture = 'download' → ghi file rồi xoá entry (§16)
```

**Không có tab nào được mở để chụp, và không có điều hướng nào.** Trang cần chụp là trang đang ở trước mặt; nó đã render xong từ lâu. Đây là lý do không còn `PAGE_DELAY` chờ SPA render, không còn `seed()` đọc `robots.txt`/sitemap, và không còn quãng đứng im giữa cú bấm và tấm ảnh đầu tiên — đo được: màn đầu tiên chụp xong ở **t+776ms**, so với ~7,6 giây của bản crawl.

### 6.3. Tiến trình và huỷ

- Overlay trong trang hiện `Capturing this page`, path của URL, thanh tiến trình và `Screen 4 / 10 · ~3s left`, kèm nút `Stop`.
- Badge của extension hiện `…` trong lúc chạy.
- `Stop` hoặc `Esc` dừng ngay ở màn kế tiếp; trang được hoàn nguyên đầy đủ (§7.4) và không có ảnh nào được lưu.
- Popup mở lại giữa chừng vào **màn hình tiến trình** thay cho nút chụp, và poll 800ms — vì popup đóng ngay khi lượt chụp bắt đầu.

## 7. Chụp — Scroll & Stitch

Phần khó về mặt kỹ thuật, và là lý do tồn tại của extension.

### 7.1. Đo trang

`page-metrics.js` chạy trong page context, trả về:

```json
{
  "viewportWidth": 1440,
  "viewportHeight": 900,
  "fullWidth": 1440,
  "fullHeight": 8630,
  "scrollbarWidth": 15,
  "devicePixelRatio": 2,
  "scrollTarget": { "kind": "document", "selector": null },
  "originalScrollY": 0,
  "horizontalOverflow": false
}
```

`horizontalOverflow: true` (trang rộng hơn viewport) → v1 chỉ chụp theo chiều dọc ở `scrollX = 0` và ghi warning vào meta: `Page is wider than the viewport; captured the left 1440px.` Ghép hai chiều nằm trong §23.

### 7.2. Chuẩn bị trang

`page-prepare.js` — bước `freeze`, lưu lại mọi thứ đã sửa để hoàn nguyên:

1. **Chặn scroll mượt**: chèn `<style id="__fpc_freeze">` với
   `html, body { scroll-behavior: auto !important; }`.
2. **Đóng băng chuyển động**:
   `*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }`
   và gọi `pause()` trên mọi `<video>` đang phát (ghi lại cái nào đang phát để `play()` lại sau).
3. **Mở khoá scroll**: nếu `scrollTarget` có `overflow: hidden` (modal đang khoá trang) → tạm đặt `overflow: auto`, ghi nhớ giá trị cũ.
4. **Kích lazy-load**:
   - Mọi `img[loading="lazy"]` → `loading = "eager"`; `img[decoding]` → `decoding = "sync"`.
   - Cuộn nhanh một lượt từ trên xuống dưới theo bước `viewportHeight`, mỗi bước chờ 1 frame — đủ để `IntersectionObserver` của trang bắn.
   - Chờ `Promise.all` các `img.decode()` chưa hoàn thành, timeout **3000ms**.
   - Cuộn về `0`, chờ 2 frame.
5. **Liệt kê phần tử fixed/sticky**: duyệt DOM bằng `TreeWalker`, dừng ở **20 000 phần tử** (bảo vệ trang khổng lồ), thu các phần tử có `getComputedStyle().position ∈ {fixed, sticky}` và có diện tích hiển thị > 0.

Bước 4 là bước tốn thời gian nhất và có thể tắt trong Options (`preloadLazyImages`, mặc định bật) cho ai chụp trang tĩnh.

### 7.3. Lập kế hoạch tile

```text
step   = captureRect.height
maxTop = fullHeight - contentOffsetY - captureRect.height
tiles  = ceil(maxTop / step) + 1
```

Không có tham số `overlap`: tile được vẽ theo `actualScrollY` thật (R4) nên không cần vùng đệm.

Tile cuối luôn ở `scrollTop = maxTop` — tức là **chồng lên** tile áp chót một đoạn. Xử lý ở §7.5.

Nếu `tiles > MAX_TILES` (**80**, tương ứng trang cao ~72 000px ở viewport 900px) → chụp `MAX_TILES` tile đầu và ghi warning `Page truncated at 80 screens.` vào meta. Không hỏi user: giữa một lượt 50 trang thì mọi câu hỏi đều là câu hỏi sai lúc.

### 7.4. Vòng lặp chụp

Với mỗi tile `i`:

1. `scrollTo({ top: y, left: 0, behavior: 'instant' })` trên `scrollTarget`.
2. **Quét lại** phần tử fixed/sticky rồi ẩn chúng nếu `i > 0`: thêm class `__fpc_hidden { visibility: hidden !important }`. Tile 0 giữ nguyên để header vẫn xuất hiện đúng một lần ở đầu ảnh.
   - **Quét lại ở mỗi tile chứ không quét một lần lúc đầu.** Một kiểu app bar rất phổ biến là header `static` ở đỉnh trang, chỉ trở thành `fixed` khi scroll handler gắn class vào — mà bản quét một lần thì chạy ở `scrollTop = 0`, đúng lúc chưa có gì để thấy. Hệ quả là bar đó lặp lại ở **mọi** màn chụp. Phần tử đã biết được bỏ qua nên lượt quét lại chỉ trả giá cho phần tử mới: đo trên DOM 12 000 phần tử là **5–9ms**, so với 549ms mỗi tile vốn đã phải chờ quota (§7.7).
   - Quét sau `requestAnimationFrame` đầu tiên kể từ lúc cuộn, để scroll handler của trang kịp chạy trước khi mình nhìn.
   - **Quét cả shadow root mở**: `TreeWalker` dừng ở ranh giới shadow, mà web component đúng là chỗ các thanh bar, cookie banner và widget chat ngày nay hay nằm — đo trên fixture thì một bar trong shadow root lặp đủ **5/5** màn. Shadow root **closed** thì chịu, không có đường nào nhìn vào từ bên ngoài.
   - Ẩn bằng **inline style** chứ không phải class: class phụ thuộc `<style>` trong document, mà style của document không lọt vào shadow root — quét thấy rồi vẫn không ẩn được.
   - **Nền `background-attachment: fixed` được đổi tạm sang `scroll`.** Nền kiểu đó neo vào viewport chứ không neo vào trang, nên để nguyên thì nó vẽ lại đúng một dải giống hệt vào **mọi** màn chụp — cùng loại lỗi với thanh bar, chỉ khác tầng. `html` và `body` phải kiểm riêng vì `TreeWalker` gốc `body` không bao giờ trả về chính `body`, mà đó lại đúng là chỗ nền cố định hay nằm.
   - Với `position: sticky`, thay vì ẩn thì đặt `position: static !important` — sticky thường là nội dung thật (tiêu đề cột trong bảng), ẩn đi sẽ mất chữ.
3. Chờ: `requestAnimationFrame` ×2, rồi `SETTLE_DELAY` (**120ms**).
4. Đọc `actualScrollY = scrollTarget.scrollTop`.
5. `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })`.
6. Cập nhật overlay tiến trình.
7. Chờ hết `captureInterval` trước tile kế (§7.7).

Sau tile cuối: gỡ class ẩn, gọi `unfreeze`, cuộn về `originalScrollY`, gỡ overlay. Bước hoàn nguyên chạy trong `finally` — **kể cả khi capture lỗi hoặc user bấm Stop**, không được để trang ở trạng thái mất header.

### 7.5. Tile cuối và trang ngắn

Mọi tile được vẽ **nguyên vẹn** tại đúng offset của nó:

```js
dy = Math.round(actualTop * scale);
sh = Math.round(Math.min(captureRect.height, outHeight - actualTop) * scale);
```

Tile cuối chồng lên tile áp chót một đoạn, và phần chồng **ghi đè lên đúng những pixel giống hệt** — cùng nội dung, cùng toạ độ. Không cần cắt `sourceTop` gì cả; đây là lý do §7.3 không có tham số overlap.

Trang ngắn hơn một màn → chỉ 1 tile, và ảnh cao **đúng một màn**, không phải chiều cao nội dung. Không phải vì lười: `document.scrollingElement.scrollHeight` của một trang ngắn **luôn trả về chiều cao viewport**, nên chiều cao nội dung thật không lấy được từ đó. Cắt theo hộp của `<body>` thì lấy được, nhưng sẽ cắt mất mọi thứ nằm ngoài hộp đó — phần tử `position: absolute`, footer dán đáy màn hình — đổi một khoảng trắng thừa lấy nguy cơ mất nội dung. Đây cũng là hành vi của mọi công cụ chụp màn hình khác.

### 7.6. Cắt scrollbar

`captureVisibleTab` chụp trọn viewport, **kể cả scrollbar** (Windows/Linux, và macOS khi bật "always show scrollbars"). Vì vậy:

- `scale` tính theo `bitmap.width / window.innerWidth` (§2.2) — `innerWidth` mới là bề rộng thật của ảnh chụp, `clientWidth` đã trừ scrollbar rồi.
- Mỗi tile chỉ lấy vùng `captureRect` (§2.1), vốn dựa trên `clientWidth/clientHeight`, nên scrollbar nằm ngoài vùng cắt và tự động biến mất.

Cách này xử lý luôn trường hợp scroll target là element con: `captureRect` khi đó là content box của element, và mọi thứ quanh nó bị loại khỏi ảnh.

### 7.7. Quota của `captureVisibleTab`

Chrome giới hạn `chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2`. Vượt quota thì API reject với message chứa `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`.

Xử lý:

- `captureInterval` khởi điểm **550ms**, đo **từ lần chụp trước** chứ không phải ngủ thêm sau mỗi tile. Cuộn, settle và hai lần round-trip vào page đã tiêu mất một phần khoảng cách đó rồi; ngủ đủ 550ms lên trên chúng làm mỗi trang chậm thêm ~40% không vì lý do gì.
- Gặp lỗi quota → chờ **1000ms**, chụp lại tile đó, và **nâng** `captureInterval` thêm 100ms cho các tile sau (tối đa 1200ms).
- Thử lại tối đa **3 lần**/tile; hết lần thì huỷ lượt chụp với thông báo rõ ràng.

Hệ quả: trang 10 tile mất ~6 giây. Đây là trần tốc độ của extension.

### 7.8. Ghép

`stitcher.js` chạy trong service worker (OffscreenCanvas + `createImageBitmap` đều có sẵn ở đó):

Tile **không** được gom lại rồi ghép ở cuối. Canvas được tạo ngay sau tile 0 (đó là lúc biết `scale` thật), rồi mỗi tile chụp xong là vẽ luôn và giải phóng:

```js
const bitmap = await createImageBitmap(Stitcher.blobFromBase64(dataUrl, 'image/png'));
canvasSet.drawTile(bitmap, { sx, sy, sw, sh, dx: 0, dy: Math.round(contentTop * scale) });
bitmap.close(); // bắt buộc — giữ cả mảng là cách nhanh nhất để SW bị kill
```

Một tile 2880×1800 chiếm ~20MB khi đã giải nén; đỉnh bộ nhớ vì vậy là **một canvas + một bitmap**, không phụ thuộc số tile hay số trang.

Base64 → Blob làm bằng `atob` chứ không qua `fetch(dataUrl)`: ít phụ thuộc hơn và tránh mọi tranh cãi về CSP trong service worker.

`Stitcher.create()` trả về một tập canvas (một cái nếu vừa, nhiều cái nếu phải cắt — §8). `drawTile` nhận toạ độ trong **không gian ảnh đầy đủ** rồi tự chiếu vào phần chứa nó; tile nằm vắt qua ranh giới được vẽ vào cả hai phần.

Làm tròn đặt ở **hai mép** chứ không ở kích thước:

```js
const y0 = Math.round(tile.dy) - Math.round(part.top);
const y1 = Math.round(tile.dy + tile.sh) - Math.round(part.top);
```

Nhờ vậy tile kề nhau khít tuyệt đối — đã kiểm bằng test đếm coverage từng hàng pixel: 0 hàng hở trên cả các kịch bản (trang dài, bội số chẵn, trang ngắn hơn viewport, cắt 4 file, inner scroller lệch).

### 7.9. Thumbnail

Ngay sau khi ghép xong, canvas được vẽ lại xuống JPEG rộng **320px**, cắt cao tối đa **420px**, quality 0.7 — lưu kèm entry trong IndexedDB. Chưa dùng tới trong v1 (trang kết quả hiển thị ảnh gốc), nhưng nó gần như miễn phí ở đây và là thứ đầu tiên cần nếu sau này có danh sách ảnh. Thumbnail không bao giờ là thứ được tải về (R8).

## 8. Vượt giới hạn kích thước

Trước khi ghép:

```text
W × H > MAX_PIXELS  hoặc  H > 65535  hoặc  W > 65535
```

Khi đó ảnh của trang đó được **cắt thành N phần theo chiều dọc**, mỗi phần ≤ budget, tên `…-1of3.png`. Không hỏi user, không thu nhỏ, không cắt cụt — đó là ba nhánh của bản nháp cũ và cả ba đều sai trong một lượt chụp 50 trang: một dialog giữa chừng sẽ chặn hàng đợi, còn thu nhỏ thì vi phạm R6.

Mỗi phần là một OffscreenCanvas riêng, tile được vẽ vào phần chứa nó (tile nằm vắt qua ranh giới thì vẽ vào cả hai).

Chiều cao tối đa một phần là `min(65535, floor(MAX_PIXELS / width))`; số phần là `ceil(height / maxPartHeight)`, rồi chia **đều** cho đẹp. Ranh giới không cố gắng né dòng chữ — mép tile không trùng mép dòng nên việc đó không đem lại gì.

Kết quả là một mảng blob trong cùng một entry. Gallery hiện trang đó thành **một thẻ** có nhãn `3 parts`; viewer có thanh chọn `Part 1..N`; tải về ra N file.

## 9. Overlay tiến trình

Inject cùng `content.js`, dựng trong **Shadow DOM** (`mode: 'closed'`) để CSS của trang không đụng tới, `z-index: 2147483647`.

Nội dung, đúng ba dòng:

```text
Capturing this page
/docs/getting-started
[████████░░░░░░░░]  Screen 4 / 10 · ~14s left      [ Stop ]
```

Vị trí: góc dưới-phải, `position: fixed`. **Overlay phải tự loại mình khỏi ảnh** — nó có thuộc tính `data-fpc-overlay` và luôn bị ẩn ở **mọi** tile, kể cả tile 0 (nơi các phần tử fixed khác được giữ lại).

Overlay chặn pointer bằng một lớp trong suốt để user không vô tình cuộn giữa lúc chụp. Phím `Esc` hoặc nút `Stop` dừng cả lượt (§6.3).

### 9.1. Trang không cho inject

`chrome://`, Chrome Web Store, PDF viewer, `view-source:` → không inject được, và Chrome cũng không cấp `activeTab` ở đó. Popup báo `This page is not supported.` và không bắt đầu chụp.

### 9.2. Thời gian dự kiến

| Chiều cao trang (viewport 900px) | Số tile | Thời gian chụp |
| -------------------------------- | ------- | -------------- |
| 2 700px                          | 3       | ~2s            |
| 9 000px                          | 10      | ~6s            |
| 27 000px                         | 30      | ~18s           |

Chưa tính bước kích lazy-load (§7.2 bước 4, thường thêm 1–3s). Đo thật trên Chrome for Testing: trang 3858px (10 màn) xong trong **5,9 giây**, màn đầu tiên ở t+776ms.

## 10. Lưu trữ ảnh — workspace, không phải lịch sử

Blob **không** truyền được qua `chrome.runtime.sendMessage` (kênh này serialize kiểu JSON). Data URL thì truyền được nhưng một ảnh 80MB base64 sẽ làm nghẽn message port.

Giải pháp: **IndexedDB của extension origin**, dùng chung giữa service worker, trang kết quả và offscreen document (§16).

**Extension không giữ lịch sử.** IndexedDB ở đây là vùng nháp của **đúng một lượt chụp**:

- `ImageStore.clear()` chạy ở đầu mỗi lượt.
- Chế độ `afterCapture: 'download'` xoá entry ngay khi file đã nằm trên đĩa.
- Không có UI lịch sử, không có `historyLimit`, không có nút `Clear history` — không có gì để dọn.

Lý do: ảnh chụp màn hình chứa nguyên nội dung user đang xem. Không giữ lại là mặc định đúng; muốn giữ thì đã có file trên đĩa.

Hệ quả đã biết: chụp lượt mới sẽ xoá ảnh của lượt trước, kể cả khi tab kết quả cũ còn đang mở. Tab đó vẫn hiển thị được vì blob đã nằm trong bộ nhớ trang, nhưng reload thì mất.

```text
DB "fpc" (version 1)
├── objectStore "pages"    (keyPath: "id")
│     { id, createdAt, thumb, meta }
└── objectStore "blobs"    (keyPath: "id")
      { id, blobs[] }                          — ảnh full-size, một phần tử/part
```

Pixel tách khỏi bản ghi vì đọc metadata không nên kéo theo một blob 20MB vào bộ nhớ.

`meta`:

```json
{
  "url": "https://example.com/docs/guide",
  "title": "Guide — Example",
  "hostname": "example.com",
  "scale": 2,
  "width": 2880,
  "height": 17260,
  "cssWidth": 1440,
  "cssHeight": 8630,
  "tiles": 10,
  "parts": 1,
  "bytes": 14238711,
  "durationMs": 6120,
  "format": "png",
  "warnings": ["Page is wider than the viewport; captured the left 1440px."]
}
```

## 11. Trang kết quả (`result.html`)

Mở bằng `result.html?page=<id>`. Một màn hình, không có gallery — chỉ có đúng một ảnh để xem.

### 11.1. Bố cục

```text
┌─ header: ▣ | tiêu đề trang + link URL gốc + 2880 × 17260 ──────────┐
├─ toolbar 1: [Crop] [Redact ▾] | [Pen] [Line] [Arrow] [Rect]        │
│             [Ellipse] [Highlight] [Text] | [Fill] [Eraser] [Pick]  │
│             ⟶ phải: Zoom [Fit|100%] | [Copy] [PNG] [JPEG]          │
├─ toolbar 2: ■■■■■■■■ [màu] | Line[4] Text[18] | ☐ Filled ⟶ [Undo] │
├─ stage: canvas, cuộn cả 2 chiều ───────────────────────────────────┤
└─ footer: cảnh báo (nếu có) ────────────────────────────────────────┘
```

Hai hàng là có lý do: hàng trên chọn **làm gì**, hàng dưới chọn **vẽ bằng gì**. Nhồi cả mười hai công cụ lẫn bảng màu vào một hàng thì trên laptop nó tự xuống dòng thành một khối lộn xộn.

Vùng xem hiển thị ảnh trên `<canvas>` với `image-rendering: auto` khi zoom < 100%, `pixelated` khi zoom > 100% (để soi pixel không bị nội suy).

**Trang không bao giờ tự cuộn — chỉ stage cuộn.** `html, body` cao đúng 100% và `overflow: hidden`; stage là `flex: 1` với `overflow: auto`. Nếu để body cuộn thì thanh cuộn ngang của ảnh nằm ở đáy một element cao 17 000px, tức muốn với tới nó phải cuộn xuống hết ảnh trước — với một ảnh rộng hơn màn hình thì đó là lỗi dùng được hay không, chứ không phải chuyện thẩm mỹ.

**Fit phải fit thật.** Bề rộng khả dụng lấy bằng `stage.clientWidth` trừ padding **đọc từ computed style**, không phải một con số gõ tay: lệch 8px là đủ để sinh thanh cuộn ngang dưới một tấm ảnh vừa hứa là đã fit. Stage đặt `scrollbar-gutter: stable` để chừa sẵn chỗ cho thanh cuộn dọc — nếu không, Fit đo được một bề rộng mà ngay sau đó thanh cuộn lấy mất.

### 11.2. Công cụ

| Công cụ       | Hành vi                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Crop**      | Kéo chọn vùng (hiện `W × H` device pixel), thả chuột là áp dụng luôn — `Ctrl+Z` để lùi lại.                      |
| **Redact**    | Hai kiểu: `Blur` và `Solid` (khối đặc). Kéo để chọn vùng. Huỷ pixel thật, không khôi phục được.                  |
| **Pen**       | Vẽ tay, nét liền theo đường chuột.                                                                               |
| **Line**      | Kéo từ A tới B.                                                                                                  |
| **Arrow**     | Như Line, thêm đầu mũi tên ở B. Thân dừng ở **đáy** tam giác chứ không chạy tới đỉnh (xem dưới).                 |
| **Rect**      | Khung chữ nhật, viền hoặc tô đặc tuỳ ô `Filled shapes`.                                                          |
| **Ellipse**   | Như Rect nhưng hình elip nội tiếp vùng kéo.                                                                      |
| **Highlight** | Vệt tô sáng, vẽ bằng `globalCompositeOperation: multiply` nên chữ bên dưới vẫn đọc được — như bút dạ quang thật. |
| **Text**      | Bấm một điểm → ô nhập hiện ngay tại đó, gõ, `Enter` chốt, `Esc` huỷ.                                             |
| **Fill**      | Đổ màu vùng liền màu, flood fill scanline với sai số ±32/kênh.                                                   |
| **Eraser**    | Tẩy nét đã vẽ, không tẩy ảnh (xem dưới).                                                                         |
| **Pick**      | Hút màu từ pixel dưới con trỏ vào bảng màu hiện tại.                                                             |

Thuộc tính chung nằm ở hàng thứ hai của toolbar: 8 ô màu dựng sẵn + ô màu tự chọn, hai **hộp size gõ được** (`Line` cho độ dày nét, `Text` cho cỡ chữ), và ô `Filled shapes` cho Rect/Ellipse.

Mỗi hộp là một **combobox tự dựng**: ô nhập chữ + nút `▾` mở danh sách preset, chọn một cái hoặc gõ số bất kỳ — đúng kiểu ô cỡ chữ của Word. Bốn nút `2 / 4 / 8 / 16` của bản trước bị bỏ: bốn lựa chọn cố định vừa chiếm chỗ vừa không bao giờ đủ.

Không dùng `<datalist>` vì **Chrome không vẽ dấu hiệu xổ xuống nào cho `<input list=…>`** — cả `type="number"` lẫn `type="text"` đều nhìn y hệt ô nhập thường (đã dựng thử ba kiểu cạnh nhau để so: chỉ `<select>` mới có mũi tên). Danh sách preset mà không ai biết là có thì coi như không tồn tại, nên mũi tên và danh sách ở đây là của mình.

Chevron là **SVG 18×18 trong vùng bấm 30×26** trải hết chiều cao ô, không phải ký tự `▾`: ký tự đó vẽ nhỏ và mỗi font một kiểu, lại không cho chỉnh vùng bấm. Mỗi dòng trong danh sách cao tối thiểu 34px và danh sách rộng tối thiểu 120px — kích thước bấm được bằng chuột mà không cần ngắm.

Giá trị kẹp trong `[1, 200]` cho nét và `[6, 400]` cho chữ. Hộp để trống thì trở về mặc định chứ **không** kẹp xuống min: `Number('')` là `0` — một số hữu hạn — nên nếu không chặn riêng, xoá trắng ô sẽ lặng lẽ cho ra nét mảnh 1px.

**Mũi tên: thân dừng trước đỉnh.** `lineCap: 'round'` làm nét lồi thêm nửa độ dày ra ngoài điểm kết thúc, nên thân chạy thẳng tới `(x2,y2)` sẽ chọc một cục màu xuyên qua tam giác — nhìn hệt như tam giác bị thụt vào trong. Thân vì thế dừng ở `length - head*0.9` và dùng `lineCap: 'butt'`, để đỉnh tam giác là điểm xa nhất của cả hình.

**Eraser trả pixel gốc về, không phải bôi trắng.** Lúc replay, nếu stack có lệnh eraser thì dựng thêm một canvas `clean` = ảnh gốc đã áp **crop và redact** nhưng chưa có nét vẽ nào; eraser stroke bằng `createPattern(clean)` nên nét tẩy tới đâu, pixel gốc hiện lại tới đó. Redact nằm trong `clean` là có chủ đích: tẩy lên vùng đã che **không** làm lộ lại nội dung — nếu không thì eraser trở thành đường vòng phá chính lời hứa của Redact (§19). Canvas thứ hai chỉ được tạo khi thật sự có eraser trong stack, vì với ảnh dài nó tốn thêm cả trăm MB.

Độ dày nét và cỡ chữ đều tính bằng **CSS pixel của trang gốc rồi nhân `meta.scale`**, nên nét 4px trông như nhau trên ảnh 1× và 2×.

Mọi thao tác ghi vào **stack lệnh** (không phá blob gốc). `Undo` (`Ctrl+Z`) pop stack và vẽ lại từ blob gốc. `Reset` xoá sạch stack. Crop đổi hệ toạ độ, nên các lệnh thêm sau đó nằm trong hệ đã crop — replay từ đầu giữ đúng thứ tự nên không lệch.

Redact **huỷ pixel thật** ngay trên canvas, không phải phủ layer CSS — file xuất ra không khôi phục được vùng bị che.

Ảnh bị cắt nhiều phần (§8): thanh dưới có nút chọn `Part 1..N`, mỗi phần có stack lệnh riêng.

### 11.3. Xuất

| Nút    | Hành vi                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `PNG`  | Blob PNG từ canvas cuối (đã áp lệnh chỉnh sửa)                          |
| `JPEG` | Quality cố định 0.92; nền trắng thay cho alpha                          |
| `Copy` | `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])` |

`Copy` cần document đang focus và có user gesture; nếu trình duyệt từ chối thì hiện toast `Click the page, then press Copy again.`

Tên file theo §16.3 — cùng quy tắc với chế độ tải thẳng, nên tải bằng đường nào cũng ra cùng tên.

Không có xuất PDF trong v1: nó kéo theo một PDF writer tự viết và một đường encode JPEG thứ hai vi phạm tinh thần R3. Xem §23.

## 12. Popup

Rộng 320px, dùng `popup.css` chung của repo, header gradient + logo là icon extension (không emoji — theo nếp đã thống nhất ở các extension trước).

Toàn bộ nội dung, không có gì hơn:

```text
┌────────────────────────────────┐
│  ▣  Full Page Capture          │   header
├────────────────────────────────┤
│  example.com                   │   trang đang mở
│                                │
│  ┌──────────────────────────┐  │
│  │    Capture this page     │  │   nút chính, cao 44px
│  └──────────────────────────┘  │
│                                │
│  When done  ( Preview | Save ) │   segmented, mặc định Preview
│                                │
│  Options                       │   link
└────────────────────────────────┘
```

**Một câu hỏi duy nhất**: kết quả đi đâu. Đó là thứ đổi theo từng lượt — lần này muốn xem, lần sau muốn file.

Mọi thứ khác đã bị bỏ khỏi popup qua ba vòng cắt: hàng `Engine`, hàng `Scale`, hàng `Format`, dòng metrics `Page: 1440 × 8630`, dòng `Scrolling: document`, nút `Pick scroll area`, dòng ước lượng, hàng chip `10 / 25 / 50 / all`, và dòng `Up to N pages`. Không cái nào trong số đó là câu hỏi mà người muốn một tấm ảnh cần trả lời trước.

- Lựa chọn `When done` được ghi thẳng vào settings, nên lần sau mở popup nó vẫn ở đó (§14).
- Trang không http(s) → thay toàn bộ thân popup bằng một dòng `This page is not supported.`
- Đang chụp → popup vào màn hình tiến trình (§6.3) thay cho màn hình trên.

Popup **tự đóng** ngay khi bắt đầu chụp, và tiến trình từ đó hiện ở overlay trong page.

Lý do **không** phải là "phải đóng popup thì `captureVisibleTab` mới chạy" — câu đó từng nằm ở đây và nó sai. Popup không phải một tab, mở nó không làm đổi tab active của cửa sổ, nên chụp vẫn chạy bình thường khi popup còn mở; GoFullPage chạy nguyên vòng lặp chụp bên trong popup của nó. Lý do thật là quyền sở hữu: lượt chụp thuộc về service worker, nên popup chỉ là cái nút bấm và đóng lại được ngay — user bấm xong đi làm việc khác, lượt chụp vẫn chạy tiếp.

## 13. Options

Một trang, một cột, **ba** control. Mỗi cái đều là thứ user có lý do thật để đổi; không có gì mang tên một khái niệm nội bộ.

| Control                         | Kiểu   | Mặc định  | Mô tả hiển thị cho user                             |
| ------------------------------- | ------ | --------- | --------------------------------------------------- |
| **Wait for lazy-loaded images** | toggle | bật       | `Slower, but images below the fold are in the shot` |
| **Image format**                | radio  | `PNG`     | `PNG (lossless)` / `JPEG (smaller files)`           |
| **When done**                   | radio  | `Preview` | `Open it` / `Save to disk`                          |

Cuối trang: nút `Reset to defaults`, và một dòng nhỏ `Screenshots never leave your computer.`

**Không** có trong Options (đều là hằng số trong `settings.js`, sửa bằng cách sửa code):

| Hằng số            | Giá trị     | Vì sao không cho chỉnh                                   |
| ------------------ | ----------- | -------------------------------------------------------- |
| `SETTLE_DELAY`     | 120ms       | Chỉnh sai là ảnh lỗi, và không ai biết nên đặt bao nhiêu |
| `CAPTURE_INTERVAL` | 550ms       | Đã tự thích nghi theo quota (§7.7)                       |
| `MAX_TILES`        | 80          | Chống trang vô hạn; không phải thứ để tinh chỉnh         |
| `MAX_PIXELS`       | 200 000 000 | Trần kỹ thuật của Chrome, không phải sở thích            |
| `JPEG_QUALITY`     | 0.92        | R7                                                       |
| `THUMB_WIDTH`      | 320px       | Chi tiết hiển thị                                        |

Các setting của những bản nháp trước bị xoá hẳn: `engine`, `cdpScale`, `cdpKeepViewportHeight` (§2.6), `oversizeAction` (§8 không hỏi nữa), `hideFixedElements` / `freezeAnimations` / `showOverlay` (tắt chúng chỉ làm ảnh sai), `maxPages` và `includeSubdomains` cùng toàn bộ nhóm `site*` (không còn crawl — §1), `settleDelay`, `captureInterval`, `maxTiles`, `maxPixels`, và template tên file.

## 14. Data model

Settings ở `chrome.storage.sync` (nhỏ, đồng bộ được), ảnh ở IndexedDB (§10), trạng thái lượt chụp đang chạy ở `chrome.storage.session` (§15.3).

```json
{
  "settings": {
    "preloadLazyImages": true,
    "format": "png",
    "afterCapture": "preview"
  }
}
```

Ba khoá, đúng bằng ba control ở §13. Popup ghi thẳng vào `afterCapture` khi user bấm segmented — cùng một khoá mà Options ghi, không có "lựa chọn tạm cho lượt này".

**`save()` và `reset()` nối tiếp nhau qua một hàng đợi promise.** Chúng là read-modify-write trên cả object settings, nên hai lời gọi chồng lấn sẽ cùng đọc một trạng thái gốc rồi ghi đè nhau — thay đổi của cái trước biến mất không dấu vết. Trang Options gọi đúng một lần cho **mỗi** control, nên bật hai switch sát nhau là đủ để mất một cái.

## 15. Message protocol

### 15.1. Extension page → service worker

`chrome.runtime.sendMessage`, response chuẩn `{ success, data } | { success: false, error }`.

| `type`                                           | Payload                   | Trả về                                          |
| ------------------------------------------------ | ------------------------- | ----------------------------------------------- |
| `getPopupState`                                  | —                         | `{ supported, tabId, hostname, settings, run }` |
| `startCapture`                                   | `{ tabId, afterCapture }` | `{ ok, id }`                                    |
| `stopCapture`                                    | —                         | `{ ok }`                                        |
| `getSettings` / `saveSettings` / `resetSettings` | — / `{ patch }` / —       | settings                                        |

`startCapture` **không** trả kết quả cuối về popup: popup tự đóng sau ~120ms để tab lấy lại focus, nên response rơi vào hư không. Tiến trình đi qua overlay trong page và qua `getPopupState` khi popup mở lại; kết quả đi qua tab `result.html`.

Không có `getCapture` — trang kết quả đọc thẳng IndexedDB (§10), tránh phải chuyển blob qua message. Không có `listCaptures` / `deleteCapture` / `clearHistory` — không có lịch sử để liệt kê.

### 15.2. Service worker → content script

`chrome.tabs.sendMessage`, luôn bọc `.catch(() => null)`: overlay là tiện ích, không phải phụ thuộc.

| `type`     | Payload                         | Trả về |
| ---------- | ------------------------------- | ------ |
| `fpcStart` | `{ url, pageIndex, pageTotal }` | —      |
| `fpcPhase` | `{ label }`                     | —      |
| `fpcError` | `{ message }`                   | —      |
| `fpcDone`  | —                               | —      |

Tiến trình từng tile **không** đi qua message: `PagePrepare.afterShot` chạy sẵn trong page context sau mỗi shot, nên nó gọi thẳng `host.__fpcProgress(done, total, etaMs)` trên element overlay — cùng isolated world, không tốn thêm round trip.

Huỷ cũng đi hai chiều mà không cần message riêng: overlay đặt `window.__fpcCancel = true` (isolated world), và `beforeShot`/`afterShot` trả cờ đó về cho orchestrator.

### 15.3. Service worker bị kill giữa chừng

Trạng thái lượt chụp nằm ở cả biến module **và** `chrome.storage.session` (`{ id, tabId, status }`). Khi SW thức dậy, `recoverInterrupted()` chạy ở top level: dọn `chrome.storage.session`, xoá badge, và gọi `PagePrepare.unfreeze` trên tab liên quan — không để trang kẹt ở trạng thái đã ẩn header, đã khoá cuộn.

Không có phục hồi "chụp tiếp": một lượt chụp chỉ dài vài giây, chụp lại rẻ hơn nhiều so với việc dựng lại trạng thái.

## 16. Tải thẳng ra đĩa

`afterCapture: "download"` — chụp xong ghi file rồi thôi, không mở tab kết quả. Chọn được ngay trên popup (`When done: Preview / Save`) nên đổi ý từng lượt không cần vào Options.

### 16.1. Vì sao cần offscreen document

Service worker MV3 **không có `URL.createObjectURL`**, mà `chrome.downloads.download` thì cần một URL. Ba đường đi có thể:

| Cách                          | Vấn đề                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `data:` URL sinh trong SW     | Ảnh 20MB → chuỗi base64 ~27MB. `chrome.downloads` không chịu nổi kích thước này |
| Mở tab result ẩn để nó tự tải | Chạy được nhưng loé một tab, và mâu thuẫn với chính yêu cầu "không mở preview"  |
| **Offscreen document**        | Cách chuẩn của MV3: một trang vô hình, có DOM đầy đủ, tạo được object URL       |

Chọn cách thứ ba. Cần quyền `offscreen` (Chrome không hiện cảnh báo gì cho quyền này).

### 16.2. Luồng

```text
SW: ImageStore.put(blobs)                  ghi vào workspace (§10)
SW: chrome.offscreen.createDocument()      nếu chưa có
SW → offscreen: fpcPrepareDownload{id}
offscreen: đọc blob từ IndexedDB → URL.createObjectURL → trả về mảng URL (chuỗi, đi qua message được)
SW: chrome.downloads.download({url, filename}) cho từng phần
SW: chờ downloads.onChanged → state 'complete'
SW → offscreen: fpcReleaseUrls{urls}       revoke
SW: ImageStore.remove(id)                  workspace sạch trở lại
```

Offscreen document **chỉ được dùng `chrome.runtime`**, không gọi được `chrome.downloads` — nên nó chỉ làm đúng một việc là đúc object URL, còn lệnh tải nằm ở service worker.

Phải chờ `state: 'complete'` rồi mới `revokeObjectURL`: revoke sớm thì Chrome đọc dở blob và file ra bị cụt.

`chrome.offscreen.closeDocument()` chạy khi hết lượt, để không giữ document sống vô ích.

### 16.3. Tên file

Một quy tắc, `Filename.forPage`: host cộng path, thêm `-NofM` khi ảnh bị cắt (§8).

```text
example.com-products-123.png
example.com-docs-guide-2of3.png
```

Không có số thứ tự và không có template: chụp lại cùng một trang thì Chrome tự thêm `(1)`, `(2)`, đúng thứ cần. Ký tự không hợp lệ (`/ \ : * ? " < > | # % & = +` và control char) bị thay bằng `-`; path được decode trước khi slug hoá để `%20` không thành `-20-`; độ dài cắt ở 120 ký tự.

## 17. Xử lý lỗi & edge case

Nguyên tắc chung: **không có dialog nào chặn giữa lượt chụp**. Mọi thứ bất thường thành một dòng warning trong `meta`, hiện ở footer trang kết quả.

| Tình huống                                              | Hành vi                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Tab không phải http(s)                                  | Popup báo `This page is not supported.`, không chụp                                          |
| `chrome://`, Web Store, PDF viewer, `view-source:`      | Không inject được → báo lỗi trong overlay/popup, không chụp                                  |
| Quota `captureVisibleTab`                               | Backoff + retry, nâng interval (§7.7); hết 3 lần thì huỷ lượt với thông báo rõ               |
| Tab bị đóng giữa chừng                                  | Huỷ lượt, không lưu gì                                                                       |
| Trang điều hướng đi giữa lúc chụp                       | Huỷ lượt (`Navigated away during capture.`)                                                  |
| Trang đổi chiều cao giữa chừng (infinite scroll)        | So `contentHeight` trước và sau; lệch > 5% → warning `Page grew while capturing.`            |
| Infinite scroll không bao giờ hết                       | Chặn bởi `MAX_TILES`, warning `Page truncated at 80 screens.` (§7.3)                         |
| Trang rộng hơn viewport                                 | Chụp phần trái, warning (§7.1)                                                               |
| Trang ngắn hơn viewport                                 | 1 tile, cắt phần thừa dưới đáy (§7.5)                                                        |
| `overflow: hidden` do modal                             | Tạm mở khoá, hoàn nguyên sau; nếu vẫn không cuộn được → chụp phần nhìn thấy + warning        |
| Không phát hiện được scroll target                      | Chụp phần nhìn thấy + warning `Could not detect a scrollable area.`                          |
| Ảnh vượt pixel budget                                   | Cắt file, không hỏi (§8)                                                                     |
| Out of memory khi ghép                                  | Ép chia thêm phần rồi thử lại một lần                                                        |
| Clipboard bị từ chối                                    | Toast `Click the page, then press Copy again.`                                               |
| IndexedDB đầy                                           | Báo lỗi rõ ràng; ảnh không được lưu                                                          |
| Trang có `<canvas>` WebGL không `preserveDrawingBuffer` | Có thể ra khung đen — ghi vào README phần known issues, không có cách khắc phục từ extension |

## 18. Permissions

| Permission                    | Lý do                                                 |
| ----------------------------- | ----------------------------------------------------- |
| `activeTab`                   | Chụp và inject vào đúng tab user vừa bấm nút          |
| `scripting`                   | Inject `page-metrics` / `page-prepare` / `content.js` |
| `storage`, `unlimitedStorage` | Settings + workspace ảnh trong IndexedDB (§10)        |
| `tabs`                        | Lấy `windowId`, title, URL của tab đang mở            |
| `downloads`                   | Ghi ảnh ra đĩa (§16)                                  |
| `offscreen`                   | Đúc object URL cho ảnh — SW không làm được (§16.1)    |

**Không có `host_permissions`.** Đây là điểm quan trọng nhất của mục này, và là thứ chỉ đạt được sau khi bỏ tầng site (§1).

`captureVisibleTab` **không nhận** host permission thường: Chrome đòi đúng `<all_urls>` **hoặc** `activeTab`, không có lựa chọn thứ ba. Bản crawl buộc phải lấy `<all_urls>` — dòng cảnh báo "Read and change all your data on all websites" khi cài — vì nó chụp các URL mà user chưa hề bấm nút lên. Bản này chỉ chụp đúng tab user vừa invoke, nên `activeTab` là đủ, và extension **không xin quyền vào bất kỳ site nào** lúc cài.

`activeTab` được cấp khi user bấm icon, mở popup, hoặc bấm phím tắt — cả ba đều là "user invocation" theo định nghĩa của Chrome; quyền mất khi tab điều hướng. Vì lượt chụp không điều hướng đi đâu, quyền còn nguyên suốt lượt.

Đã kiểm chứng bằng Chrome for Testing: với manifest không có `host_permissions`, một sự kiện phím `Alt+Shift+S` thật chạy trọn lượt chụp (`status: done, 7/7 màn`). Trước khi bỏ tầng site, cùng kịch bản đó fail với `Either the '<all_urls>' or 'activeTab' permission is required.`

**Không có `debugger`** — kể cả optional (§2.6). Đó là quyền đáng sợ nhất trong danh sách cài đặt của một extension chụp màn hình, và giờ không có gì cần tới nó.

Manifest khai đúng **một** `command`:

| Command        | Phím mặc định |
| -------------- | ------------- |
| `capture-page` | `Alt+Shift+S` |

## 19. Bảo mật & quyền riêng tư

- Ảnh chụp có thể chứa email, token hiển thị trên màn hình, nội dung nội bộ. Toàn bộ nằm trong IndexedDB của extension trên máy user; **extension không có một lệnh `fetch` nào**, và điều này phải giữ nguyên.
- **Không có quyền vào site nào** (§18). Extension không thể đọc bất cứ trang nào cho tới khi user chủ động bấm nút trên đúng trang đó.
- Công cụ `Redact` huỷ pixel thật khi export (§11.2), không phải phủ layer — người nhận file không khôi phục được.
- **Không có lịch sử**: workspace bị xoá ở đầu mỗi lượt chụp, và chế độ tải thẳng xoá ảnh ngay khi file đã lên đĩa (§10).
- Không dùng `chrome.debugger`, nên không có banner debug nào xuất hiện trên tab của user.
- Extension không đọc DOM để lấy dữ liệu; các hàm inject chỉ đo kích thước và sửa style tạm thời — đều hoàn nguyên.

## 20. Hiệu năng — mục tiêu

- Popup mở và vẽ xong trong **< 100ms**.
- **Không có độ trễ nào giữa cú bấm và màn chụp đầu tiên** ngoài thời gian đo + freeze trang. Đo được: màn đầu ở **t+776ms**, trang 10 màn xong ở **t+5,9s**.
- Overhead ngoài thời gian chờ quota (§9.2) **< 15%** tổng thời gian chụp.
- Bộ nhớ đỉnh của service worker: **< 1 canvas + 1 bitmap** cùng lúc (nhờ `bitmap.close()` ngay sau khi vẽ).
- Trang phải trở về đúng `scrollY` ban đầu, không còn style nào của extension sót lại (kiểm bằng `document.getElementById('__fpc_freeze') === null`).

## 21. Icon

Nguồn: `camera-svgrepo-com.svg` (SVG Repo) hiện đang nằm ở root repo → chuyển vào `extension/icons/camera-source.svg`.

Hình: máy ảnh compact, thân tím `#5546CB`, mặt vàng `#FDCD60`, ống kính trắng với tâm cam `#FF8859`.

`generate-icons.js` theo đúng khuôn của các extension khác trong repo: chỉ dùng built-in của Node (`zlib`, `fs`, `path`), tự viết PNG encoder, mô tả hình học trong hệ toạ độ của SVG nguồn và sample 4×4 mỗi pixel để cạnh cong không răng cưa ở cỡ 16px. Ở 16px, bỏ bớt các chi tiết nhỏ (chấm sáng, nút bấm nhỏ) — giữ lại thân máy + ống kính là đủ nhận ra.

## 22. So với GoFullPage

| Tiêu chí                | GoFullPage            | Extension này                                |
| ----------------------- | --------------------- | -------------------------------------------- |
| Ghép cuộn               | ✅                    | ✅                                           |
| Trang rất dài           | Thu nhỏ / giới hạn    | Cắt nhiều file, giữ nguyên độ nét (§8)       |
| Che thông tin nhạy cảm  | ❌                    | ✅ blur / khối đặc, huỷ pixel thật           |
| Quyền lúc cài           | Truy cập mọi website  | Không quyền site nào — chỉ `activeTab` (§18) |
| Tài khoản / upload      | Có phần cloud         | Không, hoàn toàn offline                     |
| Lưu lịch sử ảnh         | Có                    | Không giữ gì sau khi chạy xong (§10)         |
| Container cuộn tuỳ biến | Thường hỏng           | Tự dò `scrollTarget` (§2.5)                  |
| Chụp vùng / phần tử     | ✅                    | ❌ có chủ đích (§3.2)                        |
| PDF                     | ✅ (một phần trả phí) | ❌ trong v1 (§23)                            |

## 23. Không làm trong v1

- Chụp cả site / crawl sang URL khác — **đã bỏ hẳn** sau khi dùng thử, không phải hoãn (§1).
- Chụp một vùng, một phần tử, hay chỉ phần nhìn thấy (§3.2).
- Chụp 2×/3× qua `chrome.debugger` — **đã bỏ hẳn** (§2.6).
- Chọn tay vùng cuộn khi tự dò sai (§2.5).
- Xuất PDF (§11.3).
- Ghép theo cả chiều ngang (trang rộng hơn viewport).
- Lịch sử ảnh đã chụp.
- Xuất WebP / AVIF.
- Ảnh động (GIF/WebM) của thao tác cuộn.
- Tự động che vùng nhạy cảm bằng heuristic (nhận diện email/số thẻ).
- Firefox / Safari.
