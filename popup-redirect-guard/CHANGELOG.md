# Changelog

Tất cả thay đổi đáng chú ý của extension **Popup Redirect Guard** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

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
