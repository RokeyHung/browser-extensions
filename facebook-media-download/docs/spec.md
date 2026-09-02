# Spec: Media Saver for Facebook

## 1. Mục tiêu

Tải **ảnh và video của một bài đăng Facebook đang hiển thị trước mặt** xuống máy, bằng đúng một cú bấm, ở chất lượng cao nhất mà trình duyệt đang có trong tay — không đi qua website trung gian, không copy link dán sang chỗ khác, không tài khoản, không upload.

Tham chiếu: **Media Harvest — X (Twitter) Media Downloader** ([chromewebstore](https://chromewebstore.google.com/detail/media-harvest-x-twitter-m/hpcgabhdlnapolkkjpejieegfpehfdok), [nguồn mở](https://github.com/EltonChou/TwitterMediaHarvest)). Extension này giữ nguyên bốn quyết định làm nên Media Harvest:

1. **Một nút gắn ngay trên bài đăng**, không phải một popup phải mở ra rồi dán link vào.
2. **Không có third-party service**: byte của file đi thẳng từ CDN của Facebook xuống đĩa.
3. **Không crawl, không batch theo tài khoản**. Media Harvest ghi rõ trên store là nó _không_ có "tweet crawling" và _không_ có "batch download"; đây cũng vậy (§3.2, §20). "Tải hết ảnh của một người" là một sản phẩm khác, có rủi ro khác.
4. **Tên file do user đặt bằng pattern**, vì cái tên mặc định của CDN không nói lên điều gì.

Khác biệt bắt buộc so với X, và là toàn bộ phần khó của spec này:

|                 | X (Media Harvest)                                  | Facebook (extension này)                                    |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Nguồn URL media | Một API công khai theo `tweetId`, response ổn định | GraphQL nội bộ, không có endpoint gọi lại được theo id (§6) |
| Ảnh gốc         | Thêm `?name=orig` là ra bản gốc                    | URL **có chữ ký**, sửa tham số là 403 (§7)                  |
| Video           | MP4 progressive trong response                     | Phần lớn là DASH + MSE, `<video src>` là `blob:` (§8)       |
| Neo UI          | Action bar của tweet, cấu trúc ổn định             | DOM class ngẫu nhiên, đổi liên tục (§9)                     |

Use case duy nhất:

```text
User đang cuộn Facebook (feed, permalink, Watch, Reels, album ảnh, post trong group).
Thấy một bài có ảnh/video muốn giữ lại.
Rê chuột lên ảnh → hiện nút ⤓ ở góc. Bấm.
File rơi vào Downloads với tên đọc được: "nguyen-van-a-2026-09-01-9876543210-1.jpg"
Nút đổi thành ✓ và giữ nguyên dấu đó ở những lần gặp lại sau (§17).
```

## 2. Định nghĩa

### 2.1. Surface

Một loại màn hình của Facebook có DOM và luồng dữ liệu riêng. v1 hỗ trợ **năm** surface:

| Surface     | URL đặc trưng                                                   | Ghi chú                       |
| ----------- | --------------------------------------------------------------- | ----------------------------- |
| `feed`      | `/`, `/groups/{id}`, `/{page}`                                  | Bài đăng trong dòng thời gian |
| `permalink` | `/{user}/posts/{id}`, `/permalink.php`, `/groups/{g}/posts/{p}` | Một bài, đầy đủ               |
| `photo`     | `/photo/?fbid=…`, `/photo.php`, lightbox mở đè lên feed         | Trình xem ảnh (theater)       |
| `watch`     | `/watch/?v=…`, video permalink                                  | Video dạng dài                |
| `reel`      | `/reel/{id}`                                                    | Video dọc                     |

Ngoài phạm vi v1: `stories`, Messenger, Marketplace, ảnh đại diện/ảnh bìa trong dialog chỉnh sửa, `mbasic.facebook.com` (§3.2).

### 2.2. Post

Đơn vị mà user nhìn thấy: một bài đăng, có tác giả, có thời gian, có 1..N media. Trong DOM là phần tử tổ tiên gần nhất của media thoả một trong các neo ở §9.2.

Một post được mô tả bằng:

```json
{
  "postId": "9876543210",
  "postUrl": "https://www.facebook.com/nguyenvana/posts/pfbid02Xy...",
  "author": "Nguyễn Văn A",
  "handle": "nguyenvana",
  "authorId": "100001234567890",
  "createdAt": "2026-08-31T14:22:00Z",
  "surface": "feed",
  "media": ["…MediaRecord…"]
}
```

`postId` **ưu tiên số**: `fbid` của ảnh, `v` của video, `story_fbid`. Chỉ khi không có số mới dùng chuỗi `pfbid…` — id kiểu đó là **opaque và khác nhau giữa các người xem**, nên nó không phải khoá định danh tốt, chỉ là thứ cuối cùng còn lại (§13.2, §17).

`createdAt` lấy từ `<abbr>`/link thời gian nếu đọc được; không đọc được thì để trống và token `{date}` rơi về ngày tải (§13.1).

### 2.3. Media record

Một file sẽ tải. Đây là đơn vị trung tâm của cả extension:

```json
{
  "mediaId": "1234567890123456",
  "kind": "video",
  "url": "https://video-hkg1-1.xx.fbcdn.net/v/t42.../n.mp4?_nc_cat=…&oh=…&oe=…",
  "ext": "mp4",
  "width": 1920,
  "height": 1080,
  "quality": "hd",
  "source": "graphql",
  "harvestedAt": 1756713720000,
  "expiresAt": 1756742520000,
  "poster": "https://scontent…/thumb.jpg"
}
```

- `kind ∈ { image, video }`.
- `source ∈ { dom, embedded, graphql }` — lớp nào tìm ra nó (§6). Dùng để chẩn đoán khi Facebook đổi cấu trúc, và để chọn bản tốt hơn khi hai lớp cùng thấy một media (§6.4).
- `expiresAt` suy từ tham số `oe` của URL (hex, epoch giây). URL CDN của Facebook **có hạn**; hết hạn thì phải harvest lại chứ không sửa được (§7.2, §16.4).

### 2.4. Media unit vs media element

Cần phân biệt vì nó quyết định nút bấm nằm ở đâu:

- **Media element**: một `<img>`/`<video>` trên màn hình. Có thể chỉ là **thumbnail** của thứ thật (ảnh thứ 5 trong album 12 ảnh hiện thành ô "+8", video hiện thành poster tĩnh).
- **Media unit**: file thật tương ứng.

Ánh xạ giữa hai thứ này **không phải 1–1**, và đó là lý do §6.4 tồn tại.

### 2.5. Progressive vs DASH

- **Progressive**: một file MP4 tải thẳng bằng một request. Trong dữ liệu của Facebook là các trường `playable_url` (SD), `playable_url_quality_hd` (HD), `browser_native_sd_url`, `browser_native_hd_url`, và ở bản cũ là `sd_src` / `hd_src`.
- **DASH**: manifest MPD tách audio và video thành các representation riêng, phát bằng Media Source Extensions. `<video>.src` khi đó là `blob:` — **không tải được bằng URL đó**, và đây là lý do không thể làm extension này bằng cách đọc DOM đơn thuần (§8).

Danh sách trường trên lấy theo cách yt-dlp trích video Facebook: extractor của nó lặp qua đúng bộ khoá `playable_url` / `playable_url_quality_hd` / `browser_native_hd_url` / `browser_native_sd_url` / `playable_url_dash`, và xử lý `dash_manifest` (nay là `videoDeliveryResponseFragment` → `dash_manifests[].manifest_xml`) riêng — xem [facebook.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/facebook.py). Đây là bộ khoá **đã được duy trì qua nhiều lần Facebook đổi schema**, nên nó là điểm khởi đầu đúng, không phải phỏng đoán.

### 2.6. Quality ladder

Thứ tự chọn khi một media có nhiều bản, **cao nhất thắng** — không có "tự động cân bằng dung lượng":

```text
video:  playable_url_quality_hd  >  browser_native_hd_url
        >  playable_url  >  browser_native_sd_url
        >  DASH representation có bitrate cao nhất (§8.3)
image:  candidate lớn nhất trong srcset  >  src của lightbox  >  src của thumbnail
```

## 3. Phạm vi

### 3.1. Trong phạm vi

- Tải **ảnh** của bài đăng, ở bản lớn nhất trình duyệt đang có (§7).
- Tải **video** progressive của bài đăng, Watch và Reels, ưu tiên HD (§8).
- Tải **toàn bộ media của một bài** bằng một nút (album/carousel), đánh số theo thứ tự hiển thị.
- Nút tải gắn trực tiếp trên ảnh/video và trên hàng hành động của bài (§10).
- Phím tắt `Alt+Shift+D` cho media đang mở/đang trỏ chuột.
- Tên file theo pattern do user đặt, có thư mục con (§13).
- Lịch sử đã tải + dấu ✓ trên media từng tải (§17).
- Trang chẩn đoán khi Facebook đổi DOM: chỉ ra lớp nào còn chạy, lớp nào gãy (§9.4).

### 3.2. Ngoài phạm vi

Không phải "chưa làm" mà là **cố ý không làm**, vì mỗi cái đổi bản chất của công cụ:

- **Crawl / batch theo tài khoản, album, group, hashtag.** Một cú bấm = một bài. Không có hàng đợi chạy nền, không có "tải hết ảnh của người này". Đây là ranh giới giữa một công cụ lưu lại thứ mình đang xem và một con scraper (§20).
- **Stories.** Kỹ thuật thì cùng một họ, nhưng story là nội dung hết hạn và người đăng chỉ được báo ai _xem_. Để ngoài v1 là một lựa chọn, không phải một thiếu sót.
- **Messenger / tin nhắn.** Khác origin, và là hội thoại riêng tư.
- **Ghép DASH audio + video thành một file.** v1 không mux (§8.3).
- **Nội dung có DRM** (Facebook Watch bản quyền, live stream đã mã hoá). Extension không đụng tới, không có đường vòng nào được thêm vào sau này.
- **Tải nội dung mà tài khoản đang đăng nhập không xem được.** Extension không gọi API riêng, không đổi cookie, không bypass tường riêng tư. Nó chỉ chạm được đúng thứ đã nằm trong trang.
- Chuyển mã, cắt video, nén file, đổi định dạng.
- Tải comment, caption, reaction, metadata dạng JSON.
- Firefox / Safari (v1 chỉ Chrome MV3).
- `mbasic.facebook.com` — bề mặt HTML tĩnh này dễ hơn nhiều, nhưng Facebook đã dừng nó và dựa vào đó là dựng nhà trên cát.

## 4. Kiến trúc

```text
facebook-media-download/
├── docs/spec.md
├── CHANGELOG.md
└── extension/
    ├── manifest.json
    ├── background.js              # service worker: router, hàng đợi tải, lịch sử
    ├── content.js                 # isolated world: neo UI, nút, trạng thái
    ├── injected-harvest.js        # MAIN world: hook fetch/XHR, đọc JSON nhúng (§6.3)
    ├── popup.html / popup.js
    ├── options.html / options.js
    ├── dashboard.html / dashboard.js   # lịch sử tải (§17)
    ├── offscreen.html / offscreen.js   # fetch bytes khi tải thẳng bị từ chối (§16.3)
    ├── modules/
    │   ├── media-index.js         # kho media record theo id, TTL (§6.4)
    │   ├── json-scan.js           # MAIN world: duyệt JSON sâu, nhặt node media (§6.2)
    │   ├── image-pick.js          # chọn candidate ảnh lớn nhất (§7)
    │   ├── video-pick.js          # MAIN world: quality ladder video, đọc DASH (§8)
    │   ├── fb-selectors.js        # TOÀN BỘ selector phụ thuộc DOM Facebook (§9.3)
    │   ├── post-context.js        # dò post/author/postId quanh một media (§9.2)
    │   ├── filename.js            # pattern → tên file, sanitize (§13)
    │   ├── history-store.js       # IndexedDB lịch sử + dấu đã tải (§17)
    │   └── settings.js            # defaults + đọc/ghi chrome.storage.sync
    ├── styles/
    │   ├── popup.css
    │   ├── options.css
    │   └── dashboard.css
    ├── icons/
    │   ├── download-source.svg
    │   └── icon16.png / icon48.png / icon128.png
    └── generate-icons.js
```

Luồng tổng quát:

```text
   Facebook page (MAIN world)                 content.js (isolated)        background.js
   ─────────────────────────                  ─────────────────────        ─────────────
   injected-harvest.js
     ├─ hook fetch / XHR  ──── media record ──►  MediaIndex.put()
     ├─ đọc <script data-sjs> ─────────────►     (window.postMessage,
     └─ (page tự chạy, không can thiệp)           origin-checked §6.3)
                                                      │
   user rê chuột lên ảnh  ─────────────────►  gắn nút ⤓ (§10)
   user bấm nút           ─────────────────►  resolve media (§6.4)
                                                      │  downloadMedia{ post, media[] }
                                                      ▼
                                              hàng đợi tải (§16)
                                              chrome.downloads.download
                                                 └─ 403/CORS → offscreen fetch (§16.3)
                                                      │
                                              HistoryStore.put()  ──► ✓ về lại content.js
```

**Service worker là router**, đúng nếp của repo: content script không gọi `chrome.downloads` và không tự quyết tên file; nó gửi một message có cấu trúc rồi nhận lại kết quả.

Extension **không** dùng `shared/domain-suffix.js`. Không có quyết định nào ở đây phụ thuộc eTLD+1: `host_permissions` đã ghim đúng origin của Facebook, và mọi so sánh còn lại là so hostname đúng chuỗi (§6.3). Thêm một bản copy nữa vào `scripts/sync-domain-suffix.mjs` chỉ để dùng một hàm không cần tới là nợ kỹ thuật thuần tuý.

## 5. Ràng buộc cứng

Đây là những thứ mọi thay đổi code sau này không được vi phạm:

**R1. Không transcode, không encode lại, không đụng vào byte.** File trên đĩa là **bản sao byte-for-byte** của thứ CDN trả về. Extension không mở ảnh ra canvas, không đổi JPEG sang PNG, không nén. Mọi tính năng đòi hỏi đọc-ghi pixel đều nằm ngoài phạm vi (§3.2).

**R2. Chất lượng cao nhất, không hỏi.** Quality ladder ở §2.6 là một chiều. Không có nhánh "file lớn quá, hỏi user" — một dialog giữa lúc cuộn feed luôn là câu hỏi sai lúc.

**R3. Không sửa URL đã ký.** Không xoá `stp`, không đổi `_nc_*`, không thay `p720x720` thành `p2048x2048`. URL của `scontent.*.fbcdn.net` được ký bằng `oh`/`oe`; sửa là 403 (§7.2). Bản lớn hơn phải **tìm thấy**, không được **chế ra**.

**R4. Không request nào ra ngoài `*.facebook.com` và `*.fbcdn.net`.** Extension không có endpoint riêng, không analytics, không kiểm tra phiên bản qua mạng. Đây là ràng buộc kiểm được bằng cách grep `fetch(` trong toàn bộ source.

**R5. Không tự động tải.** Mỗi file xuống đĩa đều bắt nguồn từ một cú bấm hoặc một phím tắt của user, trong lượt tương tác đó. Không có "tự tải khi thấy ảnh mới", không có hàng đợi chạy nền qua các lần cuộn (§20).

**R6. Lớp harvest chỉ _đọc_.** `injected-harvest.js` bọc `fetch`/`XHR` để **đọc bản sao của response**, và phải trả về đúng response gốc, không sửa, không nuốt lỗi, không chặn. Một trang Facebook hỏng vì extension là lỗi nặng hơn mọi tính năng nó đem lại (§6.3).

**R7. Mọi selector phụ thuộc DOM Facebook nằm trong một file duy nhất.** `fb-selectors.js`. Facebook đổi DOM là chuyện thường xuyên; sửa một file có tài liệu tốt hơn nhiều so với đi săn chuỗi CSS rải rác (§9.3).

**R8. Gãy thì im lặng và nói thật.** Không tìm thấy media → nút không hiện, hoặc hiện trạng thái "không lấy được", kèm lý do cụ thể ở trang chẩn đoán. Không bao giờ tải nhầm một thumbnail rồi báo thành công — đó là lỗi tệ nhất của loại extension này, vì user chỉ phát hiện ra sau khi bài gốc đã bị xoá.

## 6. Thu thập media URL

Phần khó nhất, và là lý do tồn tại của extension. Ba lớp chạy song song, bù cho nhau.

### 6.1. Lớp DOM (`source: "dom"`)

Đọc thẳng từ `<img>` và `<video>` đang render.

- **Được**: luôn có, không phụ thuộc schema, đúng thứ user đang nhìn.
- **Mất**: ảnh trong feed thường là bản đã downscale phía server (tham số `stp=dst-jpg_p600x600`); video thì `src` là `blob:` nên vô dụng hoàn toàn (§2.5).

Vì vậy lớp DOM là **fallback cho ảnh** và **không bao giờ đủ cho video**.

### 6.2. Lớp JSON nhúng (`source: "embedded"`)

Trang Facebook nhúng dữ liệu render đầu tiên trong các thẻ `<script type="application/json" data-sjs>` (RelayPrefetchedStreamCache / ScheduledServerJS). Đây là nơi có `playable_url*`, `dash_manifest`, và node ảnh với đủ `width`/`height`.

`json-scan.js` duyệt sâu toàn bộ object, thu mọi node thoả **một trong** các mẫu:

```text
node có khoá  playable_url | playable_url_quality_hd | browser_native_*_url
              | dash_manifest | dash_manifest_xml_string
              | videoDeliveryResponseFragment
→ media video, id lấy từ node.id / node.videoId / khoá cha

node có khoá  uri | url  cùng với  width  và  height  (số)
              và host khớp  scontent*.fbcdn.net
→ ứng viên ảnh, gom theo id ảnh gần nhất trên đường đi
```

Duyệt theo **hình dạng dữ liệu chứ không theo đường dẫn khoá cố định**: đường dẫn (`__bbox.result.data.…`) đổi mỗi vài tháng, còn "một object có `playable_url`" thì bền hơn nhiều. Đây cũng là hướng yt-dlp đã đi sau nhiều lần schema đổi (§2.5).

Giới hạn an toàn khi duyệt: sâu tối đa **32** mức, tối đa **200 000** node mỗi lần quét, bỏ qua chuỗi dài hơn 8KB không phải URL. Payload của một trang feed dễ dàng vài MB; không có trần thì lớp này tự biến thành lag khi cuộn.

### 6.3. Lớp network (`source: "graphql"`)

Cuộn feed thì nội dung mới đến qua `POST /api/graphql/`. Không có JSON nhúng cho những bài đó, và **không có cách nào gọi lại API đó theo `postId`** — nó cần `doc_id`, token phiên và biến nội bộ, tất cả đều đổi liên tục. Nghĩa là: **nếu không bắt lấy response lúc nó đi qua, thông tin đó mất.**

Đây chính là khác biệt kiến trúc lớn nhất so với Media Harvest, vốn chỉ cần gọi một endpoint theo `tweetId` khi user bấm nút.

`injected-harvest.js` chạy ở **MAIN world** (`world: "MAIN"`, `run_at: "document_start"`) và bọc hai thứ:

```js
// fetch: đọc bản sao, KHÔNG chạm vào response gốc (R6)
const origFetch = window.fetch;
window.fetch = async function (...args) {
  const res = await origFetch.apply(this, args);
  if (isGraphqlLike(args[0], res))
    res
      .clone()
      .text()
      .then(scanChunked)
      .catch(() => {});
  return res; // nguyên vẹn, kể cả khi scan ném lỗi
};
```

Bốn chi tiết bắt buộc:

1. **`res.clone()` chứ không đọc `res.body`.** Đọc thân response gốc là tiêu thụ nó — trang sẽ mất dữ liệu và hỏng. `clone()` phải gọi **trước** khi trang kịp đọc.
2. **Response GraphQL của Facebook là NDJSON nhiều dòng** (streamed `@defer`): một payload có thể gồm nhiều object JSON, mỗi dòng một cái. `scanChunked` tách theo `\n` và parse từng dòng, bỏ qua dòng hỏng thay vì bỏ cả response.
3. **Quét trong `requestIdleCallback`**, ngân sách **8ms** mỗi lượt, hàng đợi tối đa **20** payload. Quét đồng bộ ngay trong hook là cách chắc chắn nhất để làm cả trang giật khi cuộn.
4. **XHR cũng phải bọc** (`XMLHttpRequest.prototype.send` + `loadend` đọc `responseText`): một phần code cũ của Facebook vẫn dùng XHR.

Kết quả đi từ MAIN world về isolated world bằng `window.postMessage`, và **cả hai đầu đều kiểm**:

```js
// gửi
window.postMessage({ __fbms: 1, token: TOKEN, records }, location.origin);
// nhận
if (ev.source !== window || ev.origin !== location.origin) return;
if (ev.data?.__fbms !== 1 || ev.data.token !== TOKEN) return;
```

`TOKEN` là một chuỗi ngẫu nhiên do `content.js` sinh ra mỗi lần load và truyền vào script inject. Không có nó thì bất kỳ script nào của trang cũng bơm được media record giả vào extension — mà record đó chứa **một URL sẽ được đưa cho `chrome.downloads`**. Đây là điểm tấn công nghiêm trọng nhất của toàn bộ thiết kế, nên ngoài token còn có §16.1 (allowlist host trước khi tải).

### 6.4. Media index — nối media element với media record

`media-index.js` giữ một `Map` trong content script:

```text
key:   mediaId (fbid ảnh / video id)  |  hoặc  URL đã chuẩn hoá (bỏ query)
value: MediaRecord[]  — nhiều bản của cùng một media, xếp theo quality ladder
```

Khi user bấm nút trên một media element, thứ tự phân giải:

1. Lấy `mediaId` từ ngữ cảnh DOM (§9.2): `fbid` trong href của link ảnh, `v=` trong link video, `data-video-id`.
2. Có id → tra index. Có record `graphql`/`embedded` → dùng, đó là bản tốt nhất.
3. Không có id → chuẩn hoá `src` của `<img>` (bỏ toàn bộ query, giữ path) và tra index bằng khoá đó. Path của CDN chứa hash nội dung nên hai bản size khác nhau của cùng một ảnh **có chung một phần path** — đủ để nối.
4. Vẫn không thấy → dùng chính DOM (§7.1). Với `kind: video` thì bước này **không tồn tại**: không có record nghĩa là không tải được, nút báo lỗi rõ (§10.4, R8).

TTL của index: **30 phút**, tối đa **500 media**, LRU. Không giữ lâu hơn vì URL CDN có `oe` hết hạn (§16.4) và vì đây là dữ liệu về nội dung user đang xem — giữ lại không có lợi ích gì (§19).

### 6.5. Vì sao không dùng `chrome.webRequest`

`webRequest` trong MV3 **không đọc được response body**. `declarativeNetRequest` càng không. Đường duy nhất còn lại để đọc payload GraphQL là hook trong MAIN world. Đây không phải lựa chọn phong cách, mà là ràng buộc của nền tảng.

## 7. Ảnh — lấy bản lớn nhất

### 7.1. Nguồn ứng viên

Theo thứ tự chất lượng, `image-pick.js` gom hết rồi chọn cái to nhất:

| Nguồn                       | Cách lấy                                               |
| --------------------------- | ------------------------------------------------------ |
| Record `graphql`/`embedded` | Node ảnh có `width`/`height` — chọn diện tích lớn nhất |
| `srcset` của `<img>`        | Parse descriptor `w`, chọn số lớn nhất                 |
| Ảnh trong lightbox          | `img[data-visualcompletion="media-vc-image"]`          |
| `src` của thumbnail         | Cuối cùng, và luôn kèm cảnh báo trong lịch sử (§17)    |

`data-visualcompletion` là attribute nội bộ của Facebook, dùng cho đo hiệu năng render. Nó **không được tài liệu hoá** nhưng bền hơn hẳn class name (vốn là chuỗi ngẫu nhiên đổi theo mỗi lần build), và là neo mà các script cộng đồng vẫn dùng để bắt đúng ảnh lớn trong theater view. Nó nằm trong `fb-selectors.js` cùng với ghi chú này (R7).

### 7.2. Vì sao không sửa tham số URL

URL ảnh Facebook có dạng:

```text
https://scontent-hkg1-1.xx.fbcdn.net/v/t39.30808-6/<hash>_n.jpg
   ?stp=dst-jpg_p600x600         ← lệnh resize phía server
   &_nc_cat=…&_nc_ohc=…&_nc_ht=…
   &oh=00_AfB…                   ← chữ ký
   &oe=68B5…                     ← hạn dùng (hex epoch)
```

Mẹo cũ "xoá `stp` để lấy bản gốc" **không còn đúng**: `oh` ký trên tổ hợp tham số, đổi bất cứ thứ gì thì CDN trả 403 (kèm body "URL signature expired"). Cách duy nhất để có bản lớn là **tìm được một URL đã ký sẵn cho bản đó** — trong payload GraphQL hoặc trong `srcset`. Đây là R3, và cũng là lý do §6 phải phức tạp đến vậy.

Hệ quả thành thật, phải ghi trong README: **ảnh tải được lớn nhất bằng bản lớn nhất mà trang đã yêu cầu.** Mở ảnh trong lightbox trước khi tải thường cho bản lớn hơn tải thẳng từ feed. Extension **không nói dối về việc này** — nút trên lightbox và nút trên feed cho cùng một ảnh có thể ra hai file khác kích thước, và popup ghi rõ kích thước sẽ tải (§10.2).

### 7.3. Ảnh động và ảnh nhiều lớp

- GIF trong post thực chất là MP4 → xử lý như video, đuôi `.mp4`, không cố dựng lại GIF (R1).
- Ảnh có sticker/text overlay do Facebook render bằng CSS: file gốc **không có** overlay đó. Đúng như vậy, và không có gì để làm — extension tải file, không chụp màn hình (đã có `full-page-capture` cho việc kia).

## 8. Video

### 8.1. Vì sao `<video>` vô dụng

Facebook phát video bằng MSE: JS nạp segment vào `SourceBuffer`, `<video>.src` là một `blob:` trỏ vào bộ nhớ của trang. Blob URL đó thuộc origin của trang, `chrome.downloads` không nhận, và kể cả nhận được thì nội dung là buffer đang phát chứ không phải file hoàn chỉnh.

Nên **100% video phải đến từ §6.2/§6.3**. Không có fallback DOM. Đây là lý do §6.3 (hook network) không phải tính năng phụ mà là điều kiện cần.

### 8.2. Chọn bản

`video-pick.js` áp quality ladder §2.6. Với mỗi ứng viên progressive, ghi lại `width`/`height` nếu có trong record để hiện lên nút (`HD 1080p`) và để đặt tên file (`{quality}`).

Setting `videoQuality`: `highest` (mặc định) hoặc `ask`. `ask` chỉ có tác dụng khi có **từ hai bản progressive trở lên**: nút mở một menu nhỏ liệt kê các bản kèm độ phân giải. Không có chế độ "luôn SD" — nó là lựa chọn không ai thật sự muốn, chỉ là một dòng UI thừa.

### 8.3. DASH — v1 làm gì

Nếu chỉ tìm thấy DASH (`dash_manifest` / `dash_manifests[].manifest_xml` / `all_video_dash_prefetch_representations`) mà không có URL progressive nào:

1. Parse MPD, lấy các `Representation` cùng `BaseURL`.
2. Nếu có representation **muxed** (chứa cả audio và video, `mimeType="video/mp4"` với `codecs` gồm cả hai) → tải nó như progressive. Một số video Facebook vẫn có bản này.
3. Nếu chỉ có representation tách rời (video-only + audio-only) → **không tải**, nút chuyển sang trạng thái lỗi với thông điệp `This video is split into separate audio and video streams; not supported yet.`

Vì sao không mux ở v1: ghép hai stream MP4 thành một file cần một remuxer chạy trong service worker — hoặc tự viết writer cho box `moov`/`mdat` với đủ `stts`/`stsc`/`stco` đúng, hoặc kéo về một bản WASM của ffmpeg. Cái đầu là vài nghìn dòng code dễ sai âm thầm (file mở được nhưng lệch tiếng), cái sau là một binary hàng chục MB — và cả hai đều mâu thuẫn với "không có build step" của repo này (CLAUDE.md). Tải một file **video câm** rồi gọi đó là thành công thì vi phạm R8. Nên v1 nói thẳng là không làm được, và ghi số: mục §23 yêu cầu **đo tỉ lệ** video rơi vào nhánh này trước khi quyết định có làm mux ở v2 không.

### 8.4. Reels và Watch

Cùng đường dữ liệu, khác neo DOM (§9). Điểm riêng của Reel: trang chỉ hiện một video một lúc và thay nội dung khi vuốt, nên `media-index` phải khoá theo `reelId` trong URL chứ không theo vị trí DOM — nếu không, vuốt nhanh vài cái sẽ tải nhầm reel liền trước.

## 9. Neo vào DOM của Facebook

### 9.1. Vấn đề

Class name của Facebook là chuỗi sinh tự động (`x1i10hfl x1qjc9v5 …`), đổi mỗi lần deploy. Text và `aria-label` thì bản địa hoá — "Like" ở tài khoản tiếng Việt là "Thích". Bất cứ selector nào dựa vào hai thứ đó đều hỏng trong vòng vài tuần.

### 9.2. Neo theo cấu trúc, không theo lớp

Thứ tự dò post chứa một media element, dừng ở cái đầu tiên khớp:

1. `closest('[data-pagelet^="FeedUnit"]')` — Facebook đánh dấu từng đơn vị feed bằng `data-pagelet`, và attribute này tồn tại vì nó phục vụ đo hiệu năng nội bộ, không phải styling → ít bị đổi hơn class.
2. `closest('[role="article"]')` — vai trò ARIA, ổn định vì nó là ràng buộc trợ năng.
3. Tổ tiên gần nhất có chứa **một link permalink** khớp một trong các mẫu: `/posts/`, `/permalink.php`, `/photo/?fbid=`, `/videos/`, `/watch/?v=`, `/reel/`, `/groups/{g}/posts/`.
4. Không thấy → coi media là **đứng một mình** (lightbox, trang Watch): post context lấy từ chính URL của trang.

Tác giả lấy từ link profile **đầu tiên** trong nửa trên của khối post (`a[href^="/"]` có `role="link"` và không phải link permalink). `handle` là segment đầu của path, hoặc `id=` của `profile.php`.

Mọi bước đều có thể thất bại riêng lẻ. Thiếu `author` thì token `{author}` thành `unknown` và **file vẫn tải** — không bao giờ chặn việc tải chỉ vì thiếu metadata (R8 đọc ngược lại: gãy thì nói thật, nhưng đừng gãy nhiều hơn mức cần).

### 9.3. Selector registry

`fb-selectors.js` là file **duy nhất** được phép chứa kiến thức về DOM Facebook. Mỗi mục có: selector, mục đích, ngày kiểm gần nhất, và một hàm `probe(doc)` trả về số phần tử tìm thấy.

```js
// fb-selectors.js — mọi phụ thuộc vào DOM Facebook nằm ở đây (spec §9.3, R7)
const FbSelectors = {
  feedUnit: { sel: '[data-pagelet^="FeedUnit"]', why: 'đơn vị feed, attribute đo perf nội bộ', checked: '2026-09-01' },
  article: { sel: '[role="article"]', why: 'neo ARIA, bền vì phục vụ trợ năng', checked: '2026-09-01' },
  theaterImage: { sel: 'img[data-visualcompletion="media-vc-image"]', why: 'ảnh lớn trong lightbox', checked: '2026-09-01' },
  // …
};
```

### 9.4. Trang chẩn đoán

Khi extension không tìm được gì, user chỉ thấy "nút không hiện" — vô dụng cho cả user lẫn người sửa. Nên Options có mục **Diagnostics**, chạy `probe` trên tab Facebook đang mở và in ra:

```text
Anchors      feedUnit 14 · article 14 · theaterImage 0
Harvest      graphql 37 records · embedded 12 · dom 26
Last error   json-scan: depth limit hit on payload #4
Page         https://www.facebook.com/  ·  Chrome 141  ·  ext 1.0.0
```

Đây là thứ dán vào một issue là đủ để sửa, và là lý do §9.3 bắt mọi selector khai báo `probe`.

### 9.5. Chống đổi DOM giữa chừng

Facebook tái dựng DOM liên tục (virtualised feed). Nút gắn vào một node có thể biến mất bất cứ lúc nào.

- Dùng **một** `MutationObserver` trên `document.body` (`childList` + `subtree`), throttle **250ms**, thay vì observer cho từng post — hàng trăm observer là cách chắc chắn để feed giật.
- Nút **không gắn cố định vào DOM của post**. Chỉ có **một** overlay duy nhất, `position: absolute`, được định vị lại theo media đang hover (§10.1). Không có nút nào để Facebook dọn đi, và không có rác tích tụ khi cuộn.
- Container overlay dựng trong **Shadow DOM `mode: 'closed'`** gắn ở `document.body`, tự mang CSS — CSS của Facebook không lọt vào, và extension không để lộ URL resource của mình cho trang dò (cùng lập luận với `full-page-capture` §4).

## 10. UI trong trang

### 10.1. Nút trên media

Rê chuột lên một ảnh/video trong post → hiện nút ở **góc trên-phải** của media, cách mép 8px:

```text
┌───────────────────────────────┐
│                          ⤓ │  ← 32×32, nền #1c1e21cc, bo 8px
│                               │
│         (ảnh của post)        │
│                               │
└───────────────────────────────┘
```

- Nút chỉ hiện khi media **đủ lớn**: cạnh ngắn ≥ 120px. Nếu không, avatar, emoji reaction và icon sẽ mọc nút — đó là cách nhanh nhất biến feed thành bãi mìn.
- Nút không hiện trên media nằm trong khu vực soạn bài (`[role="textbox"]` tổ tiên) hay trong preview khi đăng.
- Video: nút đặt lệch xuống dưới control bar của Facebook 44px để không đè lên nút play.

### 10.2. Tooltip

Rê lên nút hiện đúng một dòng cho biết **sẽ tải cái gì**, vì §7.2 khiến điều đó không hiển nhiên:

```text
JPEG · 2048 × 1536        hoặc        MP4 · HD 1080p
```

### 10.3. Nút cấp bài đăng

Post có **từ 2 media trở lên** thì thêm một nút thứ hai ở góc trên-phải của post: `⤓ 5` — tải hết, đánh số `{index}` theo thứ tự hiển thị. Album 12 ảnh mà Facebook chỉ render 5 ô: nếu index có đủ 12 record thì tải cả 12 và tooltip nói rõ `12 items (7 not shown on screen)`; nếu chỉ có 5 thì tải 5 và ghi cảnh báo vào lịch sử. **Không** tự mở lightbox để ép Facebook nạp phần còn lại — đó là tự động hoá thao tác trên trang, tức là bước đầu tiên vào vùng crawl (§20).

### 10.4. Trạng thái nút

| Trạng thái | Hình      | Khi nào                                                                                 |
| ---------- | --------- | --------------------------------------------------------------------------------------- |
| Idle       | `⤓`       | Sẵn sàng                                                                                |
| Working    | vòng xoay | Đang tải                                                                                |
| Done       | `✓` xanh  | Xong, và mọi lần gặp lại media này sau đó (§17)                                         |
| Error      | `!` đỏ    | Bấm vào hiện lý do trong một dòng: hết hạn URL, DASH tách stream, không tìm thấy record |

Trạng thái Error **không tự biến mất** sau vài giây: user cần thấy nó để biết file _không_ nằm trên đĩa. Bấm lần nữa để thử lại (thử lại sẽ harvest lại, §16.4).

### 10.5. Phím tắt

`Alt+Shift+D`: tải media đang trỏ chuột; nếu không trỏ vào media nào thì tải media của lightbox/video đang mở. Không có gì phù hợp → không làm gì, và không có toast (một phím tắt bấm nhầm không nên nói chuyện).

## 11. Popup

Rộng 320px, dùng `popup.css` chung của repo, header gradient + icon extension.

```text
┌────────────────────────────────┐
│  ⤓  Media Saver for Facebook   │
├────────────────────────────────┤
│  Đang ở: facebook.com/watch    │
│  Đã bắt được: 37 media         │   ← MediaIndex hiện tại (§6.4)
│                                │
│  Hôm nay đã tải     12 file    │
│  Tổng cộng         489 file    │
│                                │
│  [ Lịch sử tải ]  [ Tuỳ chọn ] │
└────────────────────────────────┘
```

Popup **không phải nơi để tải**: không có ô dán link, không có danh sách media để chọn. Việc tải xảy ra ở đúng chỗ user đang nhìn (§10). Popup chỉ trả lời "extension có đang chạy không" — mà câu hỏi đó là câu hỏi thật, vì khi Facebook đổi DOM thì dòng `Đã bắt được: 0 media` là dấu hiệu đầu tiên.

Không phải tab Facebook → thân popup thay bằng một dòng: `Open a Facebook tab to use this extension.`

## 12. Options

Một trang, một cột.

| Control                      | Kiểu                | Mặc định                           | Mô tả cho user                                                     |
| ---------------------------- | ------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| **Filename pattern**         | text + preview sống | `{author}-{date}-{postId}-{index}` | Ô nhập, dưới là ví dụ tên file cập nhật theo từng ký tự gõ         |
| **Subfolder**                | text                | _(trống)_                          | `Facebook/{handle}` → tải vào thư mục con trong Downloads          |
| **Video quality**            | radio               | `Highest`                          | `Highest` / `Ask each time` (§8.2)                                 |
| **Tải kèm poster của video** | toggle              | tắt                                | Ảnh thumbnail lưu thành file `.jpg` riêng                          |
| **Đánh dấu media đã tải**    | toggle              | bật                                | Dấu ✓ trên media từng tải (§17)                                    |
| **Thông báo khi tải xong**   | toggle              | tắt                                | Dùng `chrome.notifications`; mặc định tắt vì thanh Downloads đã đủ |
| **Giữ lịch sử**              | select              | `1000 mục`                         | `200` / `1000` / `5000` / `Không lưu`                              |

Cuối trang: **Diagnostics** (§9.4), `Xoá lịch sử`, `Khôi phục mặc định`, và một dòng `Không có dữ liệu nào rời khỏi máy bạn.`

Không có trong Options (hằng số trong `settings.js`):

| Hằng số                    | Giá trị | Vì sao không cho chỉnh                             |
| -------------------------- | ------- | -------------------------------------------------- |
| `INDEX_TTL`                | 30 phút | Ràng buộc từ hạn `oe` của URL, không phải sở thích |
| `INDEX_MAX`                | 500     | Chống phình bộ nhớ khi cuộn lâu                    |
| `SCAN_BUDGET_MS`           | 8ms     | Chỉnh sai là feed giật                             |
| `MIN_MEDIA_EDGE`           | 120px   | §10.1                                              |
| `MAX_CONCURRENT_DOWNLOADS` | 3       | §16.2                                              |
| `OBSERVER_THROTTLE`        | 250ms   | §9.5                                               |

## 13. Tên file

### 13.1. Token

| Token        | Giá trị                         | Khi thiếu                |
| ------------ | ------------------------------- | ------------------------ |
| `{author}`   | Tên hiển thị của tác giả        | `unknown`                |
| `{handle}`   | Username hoặc id số             | `unknown`                |
| `{postId}`   | §2.2                            | `no-id`                  |
| `{mediaId}`  | fbid ảnh / id video             | 8 ký tự đầu của hash URL |
| `{index}`    | Thứ tự trong post, từ `1`       | `1`                      |
| `{date}`     | Ngày đăng `YYYY-MM-DD`          | Ngày tải                 |
| `{datetime}` | `YYYY-MM-DD_HH-mm-ss` ngày đăng | Thời điểm tải            |
| `{type}`     | `photo` / `video`               | —                        |
| `{quality}`  | `1080p`, `hd`, `sd`, hoặc rỗng  | rỗng                     |
| `{surface}`  | §2.1                            | `feed`                   |

Có **cả `{author}` lẫn `{handle}`** là cố ý: đây đúng là điều người dùng Media Harvest phàn nàn (không dùng được nickname trong tên file, chỉ có account name). Hai thứ này khác nhau về mục đích — một cái để đọc, một cái để sắp xếp — nên cung cấp cả hai và để user chọn.

Đuôi file **không** nằm trong pattern: nó suy từ path của URL, đối chiếu `Content-Type` khi phải fetch bytes (§16.3). Cho user gõ đuôi file là mời họ tạo ra một file `.jpg` chứa MP4.

### 13.2. Sanitize

Theo đúng thứ tự, và thứ tự này quan trọng:

1. Thay token.
2. Ký tự không hợp lệ cho tên file (`/ \ : * ? " < > |` và control char) → `-`. **Trừ** dấu `/` trong `subfolder`, vốn là dấu phân cấp thư mục hợp lệ của `chrome.downloads`.
3. Chuỗi `..` → `-`, và bỏ mọi segment rỗng: `chrome.downloads` từ chối path đi ngược lên trên, và nên bị chặn từ phía mình trước.
4. Gộp khoảng trắng liên tiếp, cắt khoảng trắng và dấu chấm ở hai đầu mỗi segment (Windows không chịu được tên kết thúc bằng dấu chấm).
5. Cắt **toàn bộ path** ở 180 ký tự, cắt từ **giữa** phần tên chứ không cắt đuôi — mất `{index}` ở cuối là mất khả năng phân biệt các ảnh trong cùng album.
6. Rỗng sau tất cả → `facebook-media`.

`conflictAction: 'uniquify'` — trùng tên thì Chrome tự thêm `(1)`. Không tự chống trùng bằng cách nhét timestamp vào tên: nó làm mọi tên file xấu đi để giải quyết một trường hợp hiếm mà trình duyệt đã lo.

## 14. Data model & storage

| Kho                      | Nội dung               | Vì sao ở đây                              |
| ------------------------ | ---------------------- | ----------------------------------------- |
| `chrome.storage.sync`    | `settings` (§12)       | Nhỏ, đồng bộ giữa máy thì có ích          |
| `chrome.storage.session` | Hàng đợi tải đang chạy | Mất khi đóng trình duyệt là đúng          |
| IndexedDB `fbms`         | Lịch sử tải (§17)      | Nhiều bản ghi, không nên chiếm quota sync |
| Bộ nhớ content script    | MediaIndex (§6.4)      | **Không persist** — xem §19               |

```json
{
  "settings": {
    "filenamePattern": "{author}-{date}-{postId}-{index}",
    "subfolder": "",
    "videoQuality": "highest",
    "downloadPoster": false,
    "markDownloaded": true,
    "notifyOnComplete": false,
    "historyLimit": 1000
  }
}
```

```text
DB "fbms" (version 1)
└── objectStore "downloads"  (keyPath: "key")
      { key, mediaId, postId, postUrl, filename, kind, quality,
        bytes, downloadedAt, warnings[] }
    index "byDownloadedAt"
    index "byPostId"
```

`key` = `mediaId` nếu có, ngược lại là hash của URL đã bỏ query. Đây là khoá của dấu ✓, và là lý do §2.2 tránh `pfbid`: id opaque đổi theo người xem thì dấu ✓ sẽ nhấp nháy vô lý giữa các phiên.

`save()`/`reset()` của settings nối tiếp qua **hàng đợi promise** — cùng lỗi read-modify-write mà `full-page-capture` §14 đã gặp: bật hai toggle sát nhau thì mất một cái.

## 15. Message protocol

### 15.1. Content script → service worker

`chrome.runtime.sendMessage`, response chuẩn `{ success, data } | { success: false, error }`.

| `type`            | Payload                                  | Trả về                                           |
| ----------------- | ---------------------------------------- | ------------------------------------------------ |
| `downloadMedia`   | `{ post, media[] }`                      | `{ queued, ids[] }`                              |
| `queryDownloaded` | `{ keys[] }`                             | `{ downloaded: { key: true } }` — vẽ dấu ✓ (§17) |
| `reportHarvest`   | `{ counts: { dom, embedded, graphql } }` | `{ ok }` — nuôi popup và Diagnostics             |
| `getSettings`     | —                                        | `settings`                                       |

### 15.2. Extension page → service worker

| `type`                           | Payload                    | Trả về                                                  |
| -------------------------------- | -------------------------- | ------------------------------------------------------- |
| `getPopupState`                  | —                          | `{ onFacebook, harvestCounts, todayCount, totalCount }` |
| `listHistory`                    | `{ offset, limit, query }` | `{ items[], total }`                                    |
| `redownload`                     | `{ key }`                  | `{ ok }` hoặc lỗi `url-expired` (§16.4)                 |
| `clearHistory`                   | —                          | `{ ok }`                                                |
| `runDiagnostics`                 | `{ tabId }`                | Báo cáo §9.4                                            |
| `saveSettings` / `resetSettings` | `{ patch }` / —            | `settings`                                              |

### 15.3. Service worker → content script

| `type`                | Payload                                                        |
| --------------------- | -------------------------------------------------------------- |
| `fbmsProgress`        | `{ mediaKey, state: 'working' \| 'done' \| 'error', reason? }` |
| `fbmsSettingsChanged` | `{ settings }`                                                 |

### 15.4. MAIN world → isolated world

Không phải `chrome.runtime` (MAIN world không có nó) mà `window.postMessage`, kiểm origin + token (§6.3):

| Trường      | Ý nghĩa                       |
| ----------- | ----------------------------- |
| `__fbms: 1` | Nhãn nhận dạng                |
| `token`     | Chuỗi ngẫu nhiên mỗi lần load |
| `records[]` | MediaRecord (§2.3)            |

## 16. Tải file

### 16.1. Kiểm URL trước khi tải

**Trước** mọi lệnh tải, service worker kiểm lại URL, không tin content script:

```text
protocol === 'https:'
hostname khớp  *.fbcdn.net  hoặc  *.facebook.com
```

Content script chạy trong một trang do bên khác kiểm soát, và §6.3 nhận dữ liệu từ MAIN world. Dù đã có token, lớp kiểm này ở service worker là thứ đảm bảo trường hợp xấu nhất (một script của trang lừa được cả hai lớp trên) cũng chỉ tải được một file từ chính CDN của Facebook, chứ không phải một `.exe` từ host lạ.

### 16.2. Đường mặc định

`chrome.downloads.download({ url, filename, conflictAction: 'uniquify' })`.

Byte đi thẳng từ CDN xuống đĩa, **không qua extension**: không tốn RAM, không có trần kích thước, video 500MB cũng như ảnh 200KB. Đây là lý do đường này là mặc định chứ không phải fetch-rồi-ghi.

Tối đa **3** lượt tải song song; phần còn lại xếp hàng. Bấm "tải cả bài" 12 ảnh mà bắn 12 request cùng lúc thì CDN bắt đầu trả 429.

Theo dõi `chrome.downloads.onChanged` tới `state: 'complete'` rồi mới ghi lịch sử và bắn `done`.

### 16.3. Đường dự phòng — offscreen fetch

Khi `downloads.download` trả lỗi ngay hoặc kết thúc ở `interrupted` với `SERVER_FORBIDDEN` / `SERVER_BAD_CONTENT`:

```text
SW → offscreen: fbmsFetch{ url }
offscreen: fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
           → blob → URL.createObjectURL → trả chuỗi URL về
SW: downloads.download({ url: blobUrl, filename })
SW: chờ 'complete' → offscreen revoke
```

Cần offscreen document vì **service worker MV3 không có `URL.createObjectURL`** — cùng ràng buộc và cùng cách giải như `full-page-capture` §16.1. Bước này cũng là nơi đọc được `Content-Type` để sửa đuôi file khi URL không nói rõ.

Đường này **có** trần bộ nhớ (cả file nằm trong RAM), nên chỉ dùng khi đường mặc định đã hỏng, và từ chối trước với file khai `Content-Length > 512MB`.

`credentials: 'omit'` là cố ý: URL CDN đã tự ký, không cần cookie, và không gửi cookie đi thì không có đường nào để rò session qua một URL bị chỉnh sửa.

### 16.4. URL hết hạn

`oe` là hạn dùng của URL. Media harvest từ 40 phút trước rồi mới bấm tải thì CDN trả 403.

Xử lý: bắt 403 → **harvest lại** bằng cách hỏi content script tìm lại record cho `mediaId` đó trong index hiện tại → thử lại **một** lần. Vẫn hỏng → nút chuyển Error với thông điệp `Link expired. Refresh the post and try again.` Không tự reload trang hộ user (§20, R5).

### 16.5. Xung đột với extension quản lý tải khác

Media Harvest ghi hẳn trên trang store là nó **race condition** với các extension quản lý download. Nguyên nhân chung cho cả họ: các extension đó cũng nghe `downloads.onDeterminingFilename` / `onCreated` và có thể chiếm quyền đặt tên hoặc huỷ lượt tải.

Extension này:

- **Không** dùng `onDeterminingFilename`. Tên file truyền thẳng trong `downloads.download`, không tranh chấp listener với ai.
- Nếu một lượt tải kết thúc `interrupted` với `USER_CANCELED` mà user không bấm huỷ → ghi warning vào lịch sử: `Download was cancelled by another extension.` Nói ra vẫn tốt hơn để user tưởng extension hỏng.

## 17. Lịch sử và dấu đã tải

Khác `full-page-capture` (§10 của spec kia: cố ý không giữ gì), ở đây lịch sử là **tính năng**, vì câu hỏi "mình tải cái này chưa" xuất hiện thật khi lướt lại cùng một feed.

Nhưng chỉ lưu **metadata, không lưu file**: `key`, tên file, post URL, thời điểm, dung lượng. Không lưu byte, không lưu thumbnail, không lưu caption. Nội dung đã ở trong Downloads rồi; giữ thêm một bản trong extension là nhân đôi dữ liệu nhạy cảm mà không đổi lại được gì.

- Dấu ✓: content script gom `key` của các media đang hiển thị (gộp lô, tối đa mỗi 400ms) và gửi `queryDownloaded`.
- Dashboard: danh sách, tìm theo tên/tác giả, mở lại post, `redownload`, xoá từng mục, `Xoá tất cả`.
- Vượt `historyLimit` → xoá mục cũ nhất theo `byDownloadedAt`.
- `historyLimit: 'none'` → không ghi gì, và dấu ✓ tự động tắt (nói rõ trong Options thay vì để user tự phát hiện).

## 18. Permissions

| Permission      | Lý do                                                         |
| --------------- | ------------------------------------------------------------- |
| `downloads`     | Ghi file ra đĩa (§16)                                         |
| `storage`       | Settings + lịch sử                                            |
| `offscreen`     | Đúc object URL cho đường dự phòng — SW không làm được (§16.3) |
| `notifications` | Chỉ khi user bật (§12) — khai `optional_permissions`          |

Ba quyền, cộng một quyền tuỳ chọn. **Không có `scripting`**: bản nháp của spec này có nó, nhưng cả hai content script (isolated và MAIN world) đều khai thẳng trong `manifest.json` với `"world": "MAIN"`, nên không có lần `executeScript` nào để cần quyền đó. Xin một quyền mà không dùng là cách rẻ nhất để làm dòng cảnh báo lúc cài dài ra vô cớ.

```json
"host_permissions": [
  "*://*.facebook.com/*",
  "*://*.fbcdn.net/*"
]
```

Không có `<all_urls>`, không có `tabs`, không có `webRequest`, không có `cookies`. Dòng cảnh báo lúc cài chỉ nhắc tới facebook.com và fbcdn.net — đúng phạm vi thật của extension, và người dùng đọc được nó là hiểu ngay.

`*.fbcdn.net` cần cho đường dự phòng §16.3 (fetch cross-origin cần host permission). Đường mặc định §16.2 thì không cần — `chrome.downloads.download` không đòi host permission — nên nếu sau này bỏ được §16.3 thì bỏ luôn được host permission này.

Content script khai trong manifest, **không** dùng `activeTab`: harvest phải chạy từ `document_start` của mọi trang Facebook, trước khi payload GraphQL đầu tiên đi qua. `activeTab` chỉ được cấp sau khi user bấm icon — lúc đó dữ liệu đã trôi mất (§6.3).

```json
"content_scripts": [
  { "matches": ["*://*.facebook.com/*"], "js": ["modules/…", "content.js"], "run_at": "document_start" },
  { "matches": ["*://*.facebook.com/*"], "js": ["injected-harvest.js"], "run_at": "document_start", "world": "MAIN" }
]
```

Một command:

| Command                  | Phím mặc định |
| ------------------------ | ------------- |
| `download-hovered-media` | `Alt+Shift+D` |

## 19. Bảo mật & quyền riêng tư

- **R4: không có request nào ra ngoài Facebook.** Không server riêng, không analytics, không telemetry, không kiểm tra phiên bản. Kiểm bằng cách grep `fetch(`/`XMLHttpRequest` trong source — mọi kết quả phải trỏ tới `fbcdn.net` hoặc là hook đọc-thụ-động ở §6.3.
- **MediaIndex không bao giờ được ghi xuống đĩa.** Nó là bản kê những gì user vừa xem trên Facebook — thứ nhạy cảm nhất extension chạm tới. Chỉ nằm trong bộ nhớ của content script, chết cùng tab (§14).
- **Hook `fetch` chỉ đọc, và chỉ đọc payload GraphQL.** Không log, không lưu, không gửi đi đâu; nội dung được quét lấy media URL rồi bỏ. Không đụng tới request đăng nhập, không đọc `document.cookie`, không chạm form nào.
- Lịch sử chỉ có metadata, và xoá được bằng một nút (§17).
- Đường dự phòng gửi `credentials: 'omit'` (§16.3) — không có cookie nào rời khỏi trình duyệt qua đường của extension.
- Kiểm host ở service worker trước mọi lệnh tải (§16.1): một trang bị chiếm quyền cũng không khiến extension tải file từ host lạ.
- Extension **không** có quyền trên site nào ngoài Facebook, nên nó không đọc được gì ở các tab khác.

## 20. Ranh giới sử dụng

Mục này là một phần của spec, không phải lời nói thêm — nó quyết định các §3.2, R5, §10.3 ở trên.

Extension chỉ lưu lại **nội dung mà tài khoản đang đăng nhập đã được phép xem, tại thời điểm đang xem, do user chủ động bấm nút**. Nó không mở rộng quyền truy cập của user thêm một chút nào.

Cụ thể, các thứ sau **không** có và sẽ không được thêm vào:

- Duyệt tự động qua profile/album/group để gom media hàng loạt.
- Tự động click, tự cuộn, tự mở lightbox để ép trang nạp thêm nội dung.
- Bypass tường riêng tư, bypass tuổi, bypass giới hạn khu vực, bypass DRM.
- Tải nội dung của tài khoản khác thông qua id đoán được.

Về pháp lý, README phải nói rõ và không vòng vo: tự động tải nội dung từ Facebook **có thể vi phạm Điều khoản dịch vụ của Meta**, và media trên Facebook **thuộc bản quyền của người đăng**. Công cụ này dành cho việc lưu lại nội dung của chính bạn hoặc nội dung bạn được phép lưu; đăng lại hay dùng cho mục đích thương mại là trách nhiệm của người dùng. Không có câu nào trong tài liệu được ám chỉ ngược lại.

## 21. Xử lý lỗi & edge case

Nguyên tắc: **không có dialog nào chặn giữa lúc user đang cuộn feed.** Mọi bất thường thành trạng thái trên nút (§10.4) hoặc một dòng warning trong lịch sử.

| Tình huống                          | Hành vi                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Không tìm thấy record cho video     | Nút Error: `Could not find a downloadable stream.`                                                                       |
| Chỉ có DASH tách stream             | Nút Error: `Split audio/video not supported yet.` (§8.3)                                                                 |
| URL hết hạn (403)                   | Harvest lại + thử lại 1 lần, rồi Error `Link expired.` (§16.4)                                                           |
| Chỉ có thumbnail cho ảnh            | Vẫn tải, ghi warning `Only a resized copy was available.` (R8: nói thật)                                                 |
| Ảnh bị che (sensitive/spoiler)      | Nếu record đã có → tải bình thường. Nếu chưa → Error `Reveal the photo first, then try again.`                           |
| Post bị xoá giữa chừng              | Nút biến mất cùng DOM; lượt tải đang chạy vẫn xong (URL độc lập với DOM)                                                 |
| Facebook đổi DOM, không neo được    | Nút không hiện; Diagnostics chỉ ra lớp nào về 0 (§9.4)                                                                   |
| Facebook đổi schema JSON            | Video hỏng trước ảnh (ảnh còn fallback DOM). Diagnostics: `graphql 0 records`                                            |
| Payload GraphQL không phải JSON     | Bỏ qua dòng đó, không log ồn ào                                                                                          |
| Tải bị extension khác huỷ           | Warning trong lịch sử (§16.5)                                                                                            |
| Đĩa đầy / user huỷ                  | Trạng thái từ `downloads.onChanged`, nút về Error                                                                        |
| IndexedDB đầy                       | Tắt ghi lịch sử, vẫn tải bình thường — lịch sử là tiện ích, không phải điều kiện                                         |
| Nhiều tab Facebook                  | Mỗi tab một MediaIndex riêng; hàng đợi tải chung ở service worker                                                        |
| Service worker bị kill giữa lúc tải | `downloads` chạy độc lập với SW; khi SW thức dậy, `onChanged` vẫn tới và lịch sử được ghi bù từ `chrome.storage.session` |
| Trang không phải Facebook           | Không inject gì                                                                                                          |

## 22. Hiệu năng — mục tiêu

Extension chạy thường trú trên mọi trang Facebook, nên đây là ràng buộc thật, không phải mục cho đẹp:

- Overhead của hook `fetch` trên một request: **< 1ms** (chỉ `clone()` + đẩy vào hàng đợi).
- Quét JSON: **≤ 8ms** mỗi lượt idle, không bao giờ chạy đồng bộ trong hook (§6.3).
- `MutationObserver`: throttle 250ms, và chỉ **một** observer cho cả trang (§9.5).
- Không thêm node nào vào DOM của Facebook ngoài **một** shadow host duy nhất (§9.5).
- Bộ nhớ MediaIndex: trần 500 record ≈ **< 1MB**.
- Không giữ blob nào trong bộ nhớ ở đường tải mặc định (§16.2).
- Đo bằng Performance panel trên một phiên cuộn feed 2 phút: chênh lệch scripting time so với khi tắt extension **< 5%**. Con số này phải đo thật và ghi vào CHANGELOG khi phát hành (theo nếp của repo).

## 23. Giả định cần kiểm chứng trước khi code

Spec này viết trước khi dựng extension, và các mục dưới đây là **giả định**, không phải sự thật đã đo. Mỗi mục ghi kèm cách kiểm. Không mục nào được coi là đúng cho tới khi có số — và số đó đi vào CHANGELOG lần phát hành đầu tiên.

| #   | Giả định                                                                     | Cách kiểm                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1  | Response GraphQL của feed chứa `playable_url*` cho video trong feed          | Bật hook, log số record theo `source` sau khi cuộn 20 bài                                                               |
| A2  | Tỉ lệ video **chỉ có** DASH tách stream (§8.3)                               | Đếm trên 50 video ngẫu nhiên: feed / Watch / Reel. Nếu > 30% thì §8.3 phải làm lại ở v1, không hoãn được                |
| A3  | `data-pagelet^="FeedUnit"` còn tồn tại                                       | `probe` trên feed thật, cả tài khoản mới lẫn cũ                                                                         |
| A4  | `img[data-visualcompletion="media-vc-image"]` là ảnh lớn nhất trong lightbox | So `naturalWidth` của nó với candidate lớn nhất trong `srcset`                                                          |
| A5  | Xoá `stp` khỏi URL ảnh trả về 403 (R3)                                       | Thử 10 URL. Nếu **không** 403 thì §7.2 và R3 phải viết lại                                                              |
| A6  | Ảnh bị đánh dấu nhạy cảm vẫn được load rồi phủ mờ                            | Nếu Facebook **không** load cho tới khi bấm hiện → hàng "Ảnh bị che" ở §21 thành đường chính, cần thêm UI               |
| A7  | `chrome.downloads.download` tải được URL fbcdn không cần offscreen           | Tải 20 file bằng đường mặc định, đếm số lần rơi vào §16.3. Nếu ~0 thì bỏ luôn `*.fbcdn.net` khỏi host_permissions (§18) |
| A8  | Hook `fetch` không làm hỏng trang                                            | Cuộn 5 phút, đăng thử một comment, mở Messenger overlay: không lỗi console nào từ trang                                 |

## 24. Acceptance criteria

**AC-01 — Ảnh trong feed.** Bấm nút trên một ảnh trong feed → file `.jpg` xuất hiện trong Downloads, tên đúng pattern, mở lên đúng ảnh đó.

**AC-02 — Ảnh trong lightbox lớn hơn hoặc bằng ảnh trong feed.** Với cùng một ảnh, kích thước tải từ lightbox ≥ kích thước tải từ feed, và tooltip (§10.2) báo đúng con số của file thật.

**AC-03 — Không sửa URL.** Không có đoạn code nào tạo URL fbcdn mới bằng cách nối chuỗi hoặc sửa tham số (R3, kiểm bằng đọc code).

**AC-04 — Video progressive.** Video trong feed có `playable_url_quality_hd` → tải ra MP4 phát được, có tiếng, đúng độ phân giải HD.

**AC-05 — Reel.** Vuốt qua 5 reel rồi bấm tải → file đúng là reel đang xem, không phải reel liền trước (§8.4).

**AC-06 — DASH tách stream.** Không tạo ra file video câm. Nút vào trạng thái Error với thông điệp ở §8.3.

**AC-07 — Album.** Post 5 ảnh → nút `⤓ 5` tải đủ 5 file, `{index}` chạy 1..5 theo thứ tự hiển thị.

**AC-08 — Không tự động.** Cuộn feed 5 phút mà không bấm gì → `chrome.downloads` không có mục mới nào (R5).

**AC-09 — Không request ngoài.** DevTools Network của service worker + trang: không request nào tới host ngoài `facebook.com`/`fbcdn.net` (R4).

**AC-10 — Dấu đã tải.** Tải một ảnh, reload trang, cuộn lại tới bài đó → nút hiện `✓`.

**AC-11 — URL hết hạn.** Ép `oe` về quá khứ → tải thất bại có thông điệp rõ ràng, không im lặng, không tạo file 0 byte.

**AC-12 — Trang không hỏng.** Với extension đang bật: đăng bài, comment, mở Messenger overlay, upload ảnh — tất cả hoạt động bình thường (A8).

**AC-13 — Không neo được.** Chạy trên một trang Facebook đã đổi DOM (giả lập bằng cách đổi selector trong `fb-selectors.js` thành chuỗi vô nghĩa) → không có exception nào, Diagnostics chỉ đúng mục hỏng.

**AC-14 — Sanitize.** Tác giả tên `../../etc/passwd` hoặc chứa emoji/`|`/`:` → tên file an toàn, nằm trong Downloads, không thoát ra ngoài (§13.2).

**AC-15 — Không rò dữ liệu.** MediaIndex không xuất hiện trong `chrome.storage` hay IndexedDB ở bất kỳ thời điểm nào (§19).

## 25. MVP

Đủ để dùng thật, theo thứ tự làm:

1. `fb-selectors.js` + `post-context.js` + probe (§9) — không có neo thì không có gì cả.
2. Lớp DOM cho ảnh + nút + tải (§7.1, §10, §16.2). Tới đây đã tải được ảnh.
3. `injected-harvest.js` + `json-scan.js` + `media-index.js` (§6). Tới đây ảnh có bản lớn và video bắt đầu chạy.
4. `video-pick.js` progressive (§8.1, §8.2).
5. `filename.js` + Options (§12, §13).
6. Lịch sử + dấu ✓ (§17).
7. Diagnostics (§9.4).
8. Offscreen fallback (§16.3) — **chỉ làm nếu A7 cho thấy cần**.

Bước 1–4 là một extension đã dùng được. Bước 5–7 là thứ khiến nó dùng được lâu dài.

## 26. Không làm trong v1

- Mux DASH audio + video (§8.3) — mở lại sau khi có số của A2.
- Stories, Messenger, Marketplace (§3.2).
- Batch theo tài khoản/album/group — **không phải hoãn, mà là không làm** (§20).
- Đổi định dạng, nén, cắt video (R1).
- Tải kèm caption / comment / metadata JSON.
- Đa ngôn ngữ giao diện (Media Harvest có 14 ngôn ngữ; v1 chỉ tiếng Anh trong UI, theo nếp các extension khác của repo).
- Firefox / Safari.
- Đồng bộ lịch sử giữa các máy.

## 27. Icon và tên hiển thị

Nguồn: `download-svgrepo-com.svg` (SVG Repo) → `extension/icons/download-source.svg`.

Hình: mũi tên rơi xuống một khay mở, thân và khay màu xanh Facebook `#0866FF`, thêm một vạch sáng `#9FC7FF` nằm trên sàn khay. **Không** có chữ "f" và không có phần nào của logo Meta.

`generate-icons.js` theo đúng khuôn các extension khác trong repo: chỉ dùng built-in của Node, tự viết PNG encoder, mô tả hình học trong hệ toạ độ 20×18 của SVG nguồn (phần artwork sau `translate(2 3)`) và sample 4×4 mỗi pixel để đầu bo tròn không răng cưa ở cỡ 16px. Đầu mũi tên trong SVG gốc là một nét dày 2 có bo tròn hai đầu, nên ở đây nó được dựng bằng hai "capsule" (khoảng cách tới đoạn thẳng ≤ 1) thay vì một tam giác — vẽ tam giác sẽ ra một hình khác hẳn ở cỡ nhỏ. Ở 16px, vạch sáng bị bỏ: nó cao chưa tới 2 pixel và chỉ làm khay bị đục.

Tên hiển thị là **`Media Saver for Facebook`**, không phải `Facebook Media Downloader`. Lý do thực dụng: chính sách Chrome Web Store không cho đặt tên thương hiệu của bên khác ở đầu tiêu đề hay gợi ý sự liên kết; dạng "X for Y" là dạng được chấp nhận. Tên folder trong repo giữ là `facebook-media-download` cho khớp nếp đặt tên mô tả của các extension khác.
