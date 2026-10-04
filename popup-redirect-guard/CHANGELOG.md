# Changelog

Tất cả thay đổi đáng chú ý của extension **Popup Redirect Guard** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.1.5] - 2026-10-04

### Fixed

- **Strict mode vẫn "mở tab rồi đóng ngay" trên web phim** — đó không phải guard chập chờn mà là lớp dự phòng ở worker (§8.5, đóng tab sau khi commit) đang gánh việc của lớp trong trang. Đo bằng fixture "web phim" với 11 cách mở quảng cáo, mỗi cách kích hoạt bằng một click chuột thật: ở 1.1.4, strict chặn trước được 3/11, normal 2/11; còn lại tab quảng cáo mở ra, trang quảng cáo commit ở ~25–39ms và tab bị đóng ở ~38–56ms. Các lỗ, từng cái một:
  - **Iframe khác domain (player, iframe quảng cáo)** — content script trong frame hỏi config bằng URL của chính frame, mà domain player không có rule, nên `active: false` và `window.open` của nó đi thẳng. Nhiều khả năng đây là nguyên nhân chính trên web phim thật, vì player gần như luôn nhúng từ domain khác. Nay frame được đánh giá theo tab chứa nó (`sender.tab.url`), giống hệt lớp worker vốn đã làm, và so same-origin theo `siteOrigin` của tab.
  - **`iframe.contentWindow.open()` từ iframe `about:blank`** — realm mới, `window.open` nguyên bản, không có content script. Nay frame cha vá frame con đồng bộ qua getter `contentWindow`/`contentDocument`, và manifest thêm `match_origin_as_fallback`.
  - **Link trong shadow DOM** — tới `document` thì target đã bị retarget về shadow host, `closest('a[href]')` không thấy gì. Nay dùng `composedPath()`.
  - **`a.click()` trên link chưa gắn vào trang** — event chạy trên cây detached, không tới listener ở `document`. Nay vá `HTMLElement.prototype.click` / `EventTarget.prototype.dispatchEvent` cho đúng trường hợp đó.
  - **`form.submit()`** — không phát event `submit`. Nay vá `HTMLFormElement.prototype.submit`.
  - **`target="_new"` trong normal mode** — chỉ chuỗi `_blank` được tính là mở tab mới. Nay mọi tên không phải keyword và không trùng frame có sẵn đều tính.
  - Sau khi sửa, cả 8 cách trên đều bị chặn **trước khi có tab** ở cả hai mode (`adHits=0`), có toast trên trang chính kể cả khi lệnh chặn xảy ra trong iframe.
- **`window.open('')` rồi `w.location = ad` lọt hẳn, tab quảng cáo ở lại, không log** — 3/10 lần ở 1.1.4 (normal). Probe trong worker cho thấy Chrome có báo commit `about:blank` của tab mới; nhánh popup coi đó là "không phải web, cho qua" và **xoá bản ghi opener**, đua với commit sang quảng cáo ngay sau đó — lượt xoá thắng thì commit quảng cáo bị coi là navigation cùng tab từ `about:blank`, không có rule, đi qua. Nay URL không phải http/https không được quyết định và giữ nguyên bản ghi opener: 0/10. (Đã thử thêm `onBeforeNavigate` — cũng ra 0/10 nhưng chỉ vì thắng cuộc đua, không đóng sớm hơn, nên bỏ.)
- **Normal mode cho pop-under kinh điển đi qua** — click vào player (không phải link) mở phim ở tab mới và đẩy tab hiện tại sang quảng cáo; redirect đó "có gesture" nên được cho qua, tab gốc nằm lại ở trang quảng cáo. Trái với §6.1 ("redirect external ngay sau click vào vùng không phải link" phải bị chặn). Nay `userGesture` gửi kèm `onLink`, và chỉ gesture vào link / nút submit mới cho qua redirect external. Đo: tab gốc được đưa về `site-a.test`, log `scripted redirect external`.

### Changed

- Lớp worker đóng tab mới ngay ở `webNavigation.onCreatedNavigationTarget` (trước commit) thay vì chỉ ở `onCommitted`. Đo 10 lần trên đường duy nhất vẫn phải nhờ worker (link `_blank` trong shadow root **closed**): trang quảng cáo commit trong tab 10/10 → 2/10, tab đóng ở 42–48ms → 32–41ms. Request tới quảng cáo **vẫn đi** 10/10 — huỷ nó cần `declarativeNetRequest`.
- Toast từ worker chỉ gửi tới top frame (`frameId: 0`), và `pendingToasts` chỉ giao cho top frame: subframe giờ cũng chạy content script và trước đây có thể nhận rồi bỏ toast.

### Notes

- **Đánh đổi có chủ đích ở normal mode:** nút không phải link mà chuyển trang ra ngoài bằng script (ví dụ "Đăng nhập bằng Google" dùng `location.href`) giờ bị chặn; dùng `Open once` / `Always allow`.
- **Hồi quy đo lại, không đổi so với 1.1.4:** `window.open` same-site vẫn mở; link external cùng tab và link same-site có server redirect ra ngoài vẫn đi được ở normal (strict chặn, như cũ); link trong iframe player điều hướng chính iframe sang domain CDN vẫn đi được ở cả hai mode.
- **Còn lại, biết trước:** `window.open('')` rồi đổi `location` vẫn chớp tab ~50ms (lớp trang không thấy được, `location` không vá được — §8.4); link trong shadow root closed vẫn nhờ worker; tab con same-site bị script đổi sang quảng cáo vẫn hiện quảng cáo ~30ms trước khi bị đưa về. Toast sau khi khôi phục redirect cùng tab vẫn không hiện — lỗi đã ghi ở 1.1.4 (revert 1.1.3), đo lại trên 1.1.4 cho cùng kết quả.
- Harness: Chrome 154 stable, profile trống, `--remote-debugging-pipe --enable-unsafe-extension-debugging` + CDP `Extensions.loadUnpacked`, `--disable-popup-blocking`, domain giả qua `--host-resolver-rules`. Mỗi cách mở chạy trong tab mới, click thật bằng `Input.dispatchMouseEvent`; server đếm request tới domain quảng cáo. Lưu ý khi đo lại: tạo rule qua `Runtime.evaluate` trong worker **ngay** khi target worker xuất hiện có thể chạy trước `importScripts` — rule không được ghi và cả lượt đo ra "không chặn gì". Phải đợi `StorageRepo` tồn tại rồi kiểm tra rule đã active.

## [1.1.4] - 2026-09-19

### Reverted

- **Gỡ 1.1.2 (`isBrowserInitiated`) và 1.1.3 (toast) — code quay về hành vi 1.1.1.** Trong quá trình dùng thật, tab mới do **chính website** mở vẫn lọt qua guard đôi khi, sau khi 1.1.2 cho phép mọi navigation mà `transitionType`/qualifier trông như do trình duyệt khởi tạo. Lối tắt đó chạy ở cả nhánh popup: một tab mới mà Chrome không gán `link` thì được thả luôn, không qua heuristic gesture hay kiểm tra opener. Lập luận "trang không giả được transition" ở 1.1.2 mới chỉ được đo cho redirect cùng tab (`location.*`), chưa từng đo cho tab mở từ trang. Lần revert này chưa có số đo tái hiện; nó dựa trên báo cáo từ người dùng.
- 1.1.3 được revert cùng vì nó xây trên 1.1.2 (phần hồi quy của nó giả định bookmark đã đi được).

### Notes

- **Các lỗi cũ quay lại, biết trước:** bấm bookmark hoặc gõ omnibox để rời site được bảo vệ lại bị kéo về (lỗi 1.1.2 đã sửa); `Always allow` lại chỉ lưu rule mà không mở trang; toast xếp hàng lại có thể hiện trên site đích sau `gave-up` (hai lỗi 1.1.3 đã sửa).
- Nếu sửa lại lỗi bookmark, lối tắt theo transition chỉ nên áp cho nhánh same-tab, không cho nhánh tab mới — và phải đo `transitionType` của tab do `window.open` / `target="_blank"` mở trước khi tin nó.
- Mục 1.1.2 và 1.1.3 bên dưới được giữ nguyên làm lịch sử; spec đã quay về nội dung của 1.1.1.

## [1.1.3] - 2026-09-11

### Fixed

- **`Always allow` không mở site, chỉ ẩn toast** — nó lưu allow rule rồi `dismissToast()` và dừng ở đó. Nhưng allowlist chưa bao giờ là thứ user muốn, trang mới là: user phải tự đi tìm lại link vừa bị chặn, mà với scripted redirect thì không còn link nào để tìm — cho phép xong vẫn đứng nguyên tại chỗ. Nay nút này mở URL bị chặn đúng cách `Open once` mở, **sau khi** rule đã lưu xong chứ không phải trước, để guard không chặn đúng cái navigation user vừa cho phép. Đo: chặn link `target="_blank"` sang `site-b.test`, bấm `Always allow` → allowlist có `site-a.test → site-b.test`, tab mới mở ở `site-b.test`, toast biến mất. Trước đó cùng thao tác chỉ có allow rule, không có tab nào.
- **Toast nổi lên trên site không liên quan và đứng đủ 5 giây** — toast xếp hàng trong `pendingToasts` chờ **lần load kế tiếp của tab**, mà lần đó không phải lúc nào cũng là lần khôi phục nó được xếp cho. Khi cầu dao redirect bỏ cuộc (`gave-up`), tab nằm lại ở chính site đích, nên toast báo việc rời `site-a.test` sẽ hiện trên `site-b.test`. Đo trên Chrome 152, bản chưa vá: sau `gave-up`, lần load kế tiếp của tab cho `{"page":"site-b.test","toast":true,"about":"site-b.test"}`; sau khi vá là `{"toast":false}`. Nay `getSiteConfig` chỉ giao toast cho đúng trang đã sinh ra nó (khớp `sourceHostname`), phần còn lại bỏ luôn — một lần chặn chỉ đáng giải thích trên trang nó xảy ra.
- Content script `dismissToast()` ở `pagehide`: rời trang là toast hết chuyện để nói, không đợi timer 5s quyết định.

### Notes

- Đường same-tab thường vốn đã không giữ toast lại: đo bằng trace trên DOM chung, `dismissToast` chạy **trước** `pagehide` (`|dismiss:` rồi mới `|PAGEHIDE`). Nên listener `pagehide` là để chuyện đó thành xác định thay vì phụ thuộc vào một cuộc đua timer — trang **có** vào bfcache thật (đo: `window.__mark` sống sót qua một lần Back), và timer bị đóng băng trong đó thì được tự do trả toast lại khi user quay về. Nó không sửa lỗi nào quan sát được ở đường này; lỗi thật là toast xếp hàng ở trên.
- Hồi quy đo lại sau khi sửa: bookmark vẫn đi được (1.1.2), cả ba dạng scripted redirect vẫn bị chặn 3 lần + `gave-up`, và toast vẫn hiện bình thường trên chính trang bị chặn.

## [1.1.2] - 2026-09-11

### Fixed

- **Không rời được site được bảo vệ bằng bookmark** — heuristic gesture thêm ở 1.1.1 chỉ nhìn thấy `pointerdown`/`keydown` **bên trong trang**, mà bấm bookmark không sinh event nào trong page. Navigation bị tính là của script và tab bị `chrome.tabs.update` kéo ngược về URL cũ. Đo end-to-end trên Chrome 152: đứng ở `site-a.test` (rule normal), bấm thật vào bookmark trong menu Bookmarks → commit `auto_bookmark` `[]` sang `site-b.test`, ngay sau đó là commit `link` `[]` ngược về `site-a.test`, tab đứng lại ở `site-a.test` và log ghi `blocked | scripted redirect external`. Cùng lỗi đó ăn luôn omnibox (`typed`) — đo bằng ba lượt `Page.navigate` cùng đích, khác `transitionType`: `typed`, `auto_bookmark` và `link` đều bị chặn y hệt nhau, tức guard không hề đọc `transitionType`.
- Nay `isBrowserInitiated(details)` chạy **trước** heuristic gesture, ở cả nhánh same-tab lẫn nhánh popup: `auto_bookmark`, `typed`, `generated`, `keyword`, `keyword_generated`, `reload`, `start_page`, cùng qualifier `forward_back` / `from_address_bar` được cho qua thẳng. Nhánh popup trước đó nhận `details` mà không dùng đến; giờ tab do trình duyệt mở ("mở bookmark ở tab mới") không bị đóng nữa.

### Notes

- **Đổi này không mất coverage**, đã đo chứ không suy đoán: mọi cách redirect trong page đều commit là `link`, kể cả khi trang vừa được vào bằng transition đáng tin. Vào `site-a/replace.html` bằng `typed` → redirect commit `link ["client_redirect"]`; vào cùng trang đó bằng `auto_bookmark` → vẫn `link ["client_redirect"]`; `location.assign` vào bằng `auto_bookmark` → `link []`. Transition của lượt vào **không** truyền sang redirect trang bắn ra sau đó, nên không có đường nào để trang mượn `auto_bookmark`/`typed` mà lọt.
- Qualifier `client_redirect` được cho quyền phủ quyết `transitionType` — Chrome 152 không cần, nhưng đó là chính trang khai redirect là của mình, không nên phụ thuộc vào hành vi hiện tại giữ nguyên mãi.
- Cả ba dạng scripted redirect được đo lại sau khi sửa và vẫn bị chặn đúng như 1.1.1, gồm cả cầu dao `gave-up` sau 3 lần khôi phục.
- Harness: Chrome 152 thật, hai domain giả qua `--host-resolver-rules`, một extension probe ghi lại `transitionType`/`transitionQualifiers`/`openerTabId`, và bookmark được bấm thật qua menu Bookmarks (AppleScript). `--load-extension` đã bị Chrome 152 gỡ; phải nạp qua CDP `Extensions.loadUnpacked` với `--enable-unsafe-extension-debugging`. Lưu ý khi đo lại: service worker cũ bị cache theo profile, nạp lại cùng đường dẫn **không** đủ để chạy code mới — lần đo đầu sau khi sửa vẫn ra kết quả cũ vì lý do này, phải dùng profile sạch hoặc bump version.

## [1.1.1] - 2026-09-02

### Fixed

- **Chặn scripted redirect chưa bao giờ hoạt động** — nặng nhất, vì đó là một nửa lý do tồn tại của extension. `injected-guard.js` đọc `assign`/`replace` từ `Object.getPrototypeOf(location)`, nơi chúng **không** nằm: mọi thành viên của `Location` là `[LegacyUnforgeable]`, tức thuộc tính own của chính instance. Nên `if (typeof original !== 'function') return` thoát ra trước cả `defineProperty` lẽ ra sẽ ném lỗi — không vá được gì, không lỗi nào, không dấu hiệu nào. Đo: trang tự redirect 600ms sau load bằng `location.assign` / `location.replace` / `location.href` đều sang được site ngoài, block log rỗng.
- Trang **không thể** vá `location`, đã kiểm chứng từng đường: descriptor là `{ writable: false, configurable: false }`, `defineProperty` / gán trực tiếp / vá `Location.prototype` đều ném `TypeError`. Nên phần vá đó bị gỡ hẳn và thay bằng ghi chú giải thích, thay vì để lại thứ trông như đang bảo vệ.
- **Lớp background đòi `client_redirect` nên bỏ lọt 2/3 cách redirect** — Chrome chỉ gắn nhãn đó cho `location.replace`; `location.assign` và `location.href` ra `[]`. Nay không dùng qualifier nữa: content script báo mỗi `pointerdown`/`keydown` (throttle 250ms), và navigation không có gesture trong 1500ms được coi là của script. Đây mới là thứ phân biệt được "script redirect" với "user bấm link", vì `transitionType` của cả hai đều là `link`.
- **State theo tab bốc hơi khi service worker ngủ** — `openerMap` và `lastTopUrl` là `Map` trong bộ nhớ, mà MV3 tắt worker khi rảnh và chính navigation cần kiểm tra lại thường là thứ đánh thức nó. Sau mỗi lần worker ngủ, navigation đầu tiên của tab không có `prevUrl` để so và được cho qua. Nay nằm trong `chrome.storage.session`.
- **Ghi state theo tab bị mất do đua** — `Session.patch` là read-modify-write trên một object trong `chrome.storage.session`, mà các event gọi nó chồng lên nhau liên tục: đóng tab cũ xoá entry của nó **cùng key** với lúc tab mới ghi URL đầu tiên. Không nối tiếp thì một trong hai lượt ghi biến mất — đo được là tab có `prevUrl` rỗng, nên redirect ngay sau đó lọt. Nay mọi lượt ghi đi qua một hàng đợi promise.
- **Tab do tab khác mở không bao giờ có `prevUrl`** — commit đầu đi xuống nhánh popup rồi `return`, nên phần ghi sổ trong nhánh same-tab không chạy. Đúng vào tab mà ad script mở ra rồi redirect ngay sau đó. Nay `prevUrl` được ghi ở **mọi** top-frame commit, trước khi chọn nhánh.
- **Toggle trong trang Settings không có tác dụng với site đã bật bảo vệ** — `createRule` chép nguyên `DEFAULT_RULE_SETTINGS` vào mọi rule, còn `getContext` cho `rule.settings` ghi đè global. Mà mọi site được bảo vệ đều có rule, và options page chỉ sửa được setting global — nên UI setting duy nhất của extension không đổi được gì. Đo bằng cặp assertion: tắt `blockWindowOpen` ở global thì vẫn bị chặn, tắt trên chính rule thì mới cho qua. Nay rule chỉ giữ **override user cố ý đặt**, và `getRules()` lọc bỏ những key vẫn bằng mặc định để rule cũ trả quyền lại cho global.

### Notes

- **Giới hạn thật, không che giấu**: MV3 không huỷ được navigation đã commit (không dùng `declarativeNetRequest`), nên cách duy nhất là đưa tab quay lại — mà việc đó chạy lại trang, và trang redirect ngay khi load sẽ redirect tiếp. Đo được là vòng lặp vô hạn làm tab nhấp nháy. Nay có cầu dao: tối đa 3 lần khôi phục mỗi tab trong 10s, quá ngưỡng thì thôi và ghi log `action: 'gave-up'`. Với trang redirect mỗi lần load thì redirect vẫn thắng; user vẫn thấy toast và log giải thích.
- Kiểm chứng end-to-end trên Chrome for Testing 152 qua CDP, chạm cả ba world: service worker, isolated world, và MAIN world. Bản vá bảo mật 1.1.0 được kiểm lại và đứng vững — `isSameSite` không coi `bbc.co.uk`↔`evil.co.uk` hay `alice.github.io`↔`bob.github.io` là cùng site, `*.facebook.*` không phủ `www.facebook.evil.com`, và `suggestPattern` trả pattern thực sự khớp chính host sinh ra nó.
- Hai bản copy eTLD+1 (worker và MAIN world) được assert là khớp nhau trên 7 hostname, vì lệch nhau sẽ khiến extension chặn nhầm navigation nội bộ của chính site.
- Chặn click `target="_blank"` và external form submit vốn đã đúng. Lần đo đầu tưởng hỏng là do harness đọc `e.defaultPrevented` ở listener bubble, trong khi content script gọi `stopPropagation()` ngay sau `preventDefault()` nên listener đó không bao giờ chạy.

## [1.1.0] - 2026-08-30

### Fixed

- **Bỏ lọt redirect/popup sang site lạ** — `isSameSite` dựa trên `getBaseDomain` chỉ lấy 2 nhãn cuối, comment trong code ghi thẳng là "approximate". Hệ quả: đứng ở `www.bbc.co.uk` thì `evil.co.uk` bị coi là **cùng site** nên được cho qua; tương tự `tokopedia.co.id` ↔ `attacker.co.id`, `alice.github.io` ↔ `bob.github.io`. Đây là lớp quyết định có chặn hay không, nên lỗi này vô hiệu hoá đúng chức năng chính của extension với mọi site nằm dưới public suffix nhiều nhãn — gồm cả `co.uk` rất phổ biến. Nay dùng luật eTLD+1 dùng chung.
- **Pattern `*.name.*` khớp cả host của kẻ tấn công** — trước đây khớp bằng `parts.indexOf(middle)`, tức nhãn nằm ở bất kỳ vị trí nào cũng tính. Ai sở hữu `evil.com` chỉ cần dựng `www.facebook.evil.com` là lọt vào rule `*.facebook.*`. Nay pattern neo vào registrable domain: nhãn phải **là** site đó.
- **Rule gợi ý không bảo vệ được chính trang đang mở** — `suggestPattern('www.bbc.co.uk')` trả về `co.*`, mà `co.*` không khớp cả `bbc.co.uk` lẫn `www.bbc.co.uk`. User bật bảo vệ nhưng thực tế rule không match gì. Nay trả `*.bbc.*`. Đổi từ dạng `name.*` sang `*.name.*` vì `name.*` chỉ khớp root domain, không khớp chính host `www.` đã sinh ra gợi ý đó — ví dụ trong comment cũ (`www.animevietsub.xyz` → `animevietsub.*`) cũng chưa từng chạy đúng.
- **`name.*` khớp nhầm subdomain** — `facebook.*` từng khớp `facebook.evil.com` vì chỉ kiểm tra `parts[0]`. Nay yêu cầu host đúng bằng registrable domain của chính nó, đồng thời khớp được root domain nhiều nhãn như `facebook.co.uk` (trước bị loại vì điều kiện `parts.length === 2`).

### Changed

- `injected-guard.js` chạy trong page world cũng có bản `baseDomain` 2-nhãn riêng và đã được sửa cùng lúc. Bắt buộc phải khớp nhau: `config.baseDomain` do service worker tính, nếu hai bên lệch nhau thì extension sẽ chặn nhầm chính navigation nội bộ của site.
- Phần tách eTLD+1 ở cả hai nơi chuyển sang block dùng chung từ `shared/domain-suffix.js`, đồng bộ bằng `make sync-domain-suffix`.

## [1.0.1] - 2026-07-26

### Fixed

- **Link ngoài chết câm sau khi reload extension** — content script vẫn chạy trên các tab đang mở nhưng `chrome.runtime` của nó đã bị gỡ. Vì extension này _chặn_ navigation, hậu quả nặng hơn một extension chỉ đọc: script mồ côi vẫn giữ config cũ và vẫn gọi `preventDefault()` trên mọi link ngoài, trong khi `sendMessage` ném lỗi — nên không có toast, không có nút `Open once`, và mọi link ngoài trên trang bấm không ăn mà không báo gì.

  Cách xử lý là **đứng xuống** thay vì nuốt lỗi: khi phát hiện context đã chết, extension xoá config, gỡ listener `click`/`submit`, và `postMessage` `active: false` sang guard ở MAIN world để nó thôi vá `window.open`. Việc kiểm tra đặt **trước** mọi `preventDefault()` theo nguyên tắc không chặn thứ mình không báo cáo được. Nút `Open once` trên toast, nếu extension đã chết, sẽ tự `window.open` tại chỗ để không thành nút vô tác dụng.

### Changed

- **Logo trong header dùng chính icon của extension** thay cho emoji 🛡, ở cả popup và trang options. Icon đặt trên nền trắng bo góc vì header là gradient xanh, mà artwork khiên cũng màu xanh `#2197f3` — để trực tiếp lên gradient thì gần như chìm.
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
