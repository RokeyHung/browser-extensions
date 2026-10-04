# Spec: Extension chặn website tự ý mở tab / redirect sang trang khác

## 1. Mục tiêu

Xây dựng browser extension giúp ngăn website hiện tại tự ý mở tab mới, popup mới, redirect sang website khác hoặc điều hướng không mong muốn khi user click vào page.

Use case chính:

```text
User đang xem website:
https://animevietsub.*

Khi click vào bất kỳ vị trí nào trên page, website có script quảng cáo tự mở tab mới hoặc chuyển hướng sang website khác.

Extension cần chặn hành vi này.
```

Extension hoạt động theo từng website/domain pattern, ví dụ:

```text
animevietsub.*
*.animevietsub.*
```

Khi extension được bật cho website hiện tại, nó sẽ:

- Chặn `window.open`.
- Chặn link mở tab mới không mong muốn.
- Chặn form submit sang domain khác nếu không xác nhận.
- Chặn redirect do script nếu redirect sang external domain.
- Chặn popup/tab mới do click event đáng ngờ.
- Chặn quảng cáo click hijacking/open-under/pop-under.
- Cho phép user whitelist một số domain/link hợp lệ.

## 2. Phạm vi

## 2.1. Trong scope

Extension hỗ trợ:

- Bật/tắt protection theo từng website.
- Hỗ trợ domain pattern:

```text
animevietsub.com
animevietsub.vn
animevietsub.*
*.animevietsub.*
```

- Chặn tab mới/popup do script mở.
- Chặn redirect sang external domain.
- Chặn click hijacking phổ biến.
- Chặn link có target `_blank` sang domain khác nếu user không xác nhận.
- Hiển thị thông báo khi chặn.
- Cho phép user mở link bị chặn nếu muốn.
- Lưu log các blocked attempts.
- Whitelist domain/link đáng tin cậy.
- Temporary allow trong một phiên.
- Strict mode / normal mode.

## 2.2. Ngoài scope MVP

Không xử lý trong version đầu:

- Không phải adblocker đầy đủ.
- Không block toàn bộ network ads.
- Không parse toàn bộ ad filter list.
- Không bypass anti-adblock.
- Không xử lý malware/phishing detection nâng cao.
- Không phân tích nội dung trang bằng AI.
- Không scan bảo mật website.
- Không can thiệp vào website khác nếu user chưa bật extension cho site đó.

## 3. Định nghĩa

## 3.1. Current site

Website hiện tại là origin hoặc domain mà active tab đang mở.

Ví dụ:

```text
https://animevietsub.xyz/phim/abc
```

Current site:

```text
animevietsub.xyz
```

## 3.2. External navigation

External navigation là điều hướng từ website hiện tại sang domain khác.

Ví dụ current domain:

```text
animevietsub.xyz
```

External:

```text
https://ads-example.com
https://casino-example.com
https://short-link-example.net
```

Same-site:

```text
https://animevietsub.xyz/phim/abc
https://www.animevietsub.xyz/phim/abc
```

## 3.3. Popup / unwanted tab

Popup hoặc unwanted tab là tab/window mới được mở bởi script hoặc click event nhưng không phải hành vi user mong muốn.

Các nguồn phổ biến:

```js
window.open(...)
link.click()
form.submit()
location.href = ...
location.replace(...)
window.top.location = ...
```

## 4. User stories

### US-01: Bật chặn popup cho website hiện tại

Là user, tôi muốn bật extension cho website hiện tại để website không tự ý mở tab quảng cáo khi tôi click vào page.

### US-02: Chặn tab mới sang domain lạ

Là user, tôi muốn extension chặn tab mới nếu tab đó mở sang domain khác với website hiện tại.

### US-03: Vẫn cho phép link hợp lệ

Là user, tôi muốn vẫn có thể mở link hợp lệ nếu tôi chủ động cho phép.

### US-04: Whitelist domain

Là user, tôi muốn whitelist một số domain external để extension không chặn nhầm.

### US-05: Xem lịch sử bị chặn

Là user, tôi muốn biết extension đã chặn URL nào, vào lúc nào, từ website nào.

## 5. UI/UX

## 5.1. Popup chính

Khi user click icon extension:

```text
Popup Guard

Current site:
animevietsub.xyz

Protection:
[✓] Enabled for animevietsub.*

Mode:
( ) Normal
(✓) Strict

Blocked today:
12 attempts

Actions:
[View blocked attempts]
[Whitelist current destination]
[Settings]
```

Nếu chưa bật cho site hiện tại:

```text
Popup Guard

Current site:
example.com

Protection:
[ ] Enabled for this site

[Enable for example.com]
[Enable for example.*]
[Settings]
```

## 5.2. Khi chặn popup/tab mới

Hiển thị toast nhỏ trên page:

```text
Blocked unwanted popup

https://ads-example.com/landing

[Open once] [Always allow] [Dismiss]
```

Toast tự ẩn sau 5 giây nếu user không tương tác.

## 5.3. Blocked attempts dashboard

Trang quản lý log:

```text
Blocked Attempts

Site: animevietsub.*

| Time | Source Page | Blocked URL | Reason | Action |
|---|---|---|---|---|
| 10:21 | /phim/abc | https://ads.com | window.open external | Open / Allow |
| 10:22 | /phim/abc | https://casino.com | click hijack | Open / Allow |
```

## 5.4. Settings page

Các setting chính:

```text
General Settings

[✓] Block window.open
[✓] Block external target="_blank"
[✓] Block scripted redirects
[✓] Block pop-under behavior
[✓] Block external form submit
[✓] Show toast when blocked
[✓] Keep block log

Default mode:
(✓) Normal
( ) Strict
```

Đây là setting **global**, và phải thực sự có hiệu lực trên mọi site đang được bảo vệ. Một rule chỉ lưu **những toggle user cố ý đổi riêng cho site đó**; `getContext` merge `{ ...global, ...rule.settings }` nên phần rule không đặt sẽ theo global.

Trước 1.1.1 `createRule` chép nguyên `DEFAULT_RULE_SETTINGS` vào mọi rule, nên rule ghim cứng mọi toggle và trang Settings — UI setting duy nhất extension có — **không đổi được gì** trên site đã bật bảo vệ. Rule cũ vẫn còn bản chép đó, nên `getRules()` lọc bỏ những key vẫn bằng giá trị mặc định khi đọc ra: giá trị user thực sự đổi thì khác mặc định nên được giữ, còn giá trị trùng mặc định thì không phân biệt được với "chưa từng đụng tới" và tốt hơn là trả về cho global quyết định.

## 6. Protection modes

## 6.1. Normal mode

Normal mode cân bằng giữa usability và protection.

Ở **cả hai mode**, navigation do chính trình duyệt khởi tạo thay user — gõ URL / tìm kiếm / keyword trên omnibox, bookmark, Back/Forward, tab mở bằng Ctrl+T / Ctrl+N — **luôn được cho qua**: đó là user đi chỗ khác, không phải site đẩy user đi (§8.4).

Chặn:

- `window.open` sang external domain.
- Tab mới không do user gesture rõ ràng.
- Redirect external xảy ra ngay sau click vào vùng không phải link. "Vùng là link" nghĩa là `a[href]` / `area[href]`, hoặc nút submit của form (kể cả Enter trong ô của form) — content script gửi kèm `onLink` trong message `userGesture` (§8.4). Click vào player, overlay, nút thường… không tính: đó đúng là chiêu pop-under (mở phim ở tab mới, đẩy tab hiện tại sang quảng cáo).
- Link mở tab mới (mọi `target` không phải `_self`/`_parent`/`_top` hay tên một frame có sẵn — xem §8.3) sang external.
- Form submit external đáng ngờ.

Cho phép:

- Same-site navigation.
- Same-site tab mới.
- User click trực tiếp vào link external rõ ràng (cùng tab) — kể cả link same-site rồi server redirect ra ngoài.
- Whitelisted domains.

Hệ quả cần biết: nút không phải link mà chuyển trang ra ngoài bằng script (ví dụ "Đăng nhập bằng Google" dùng `location.href = …`) bị chặn trong normal mode; user dùng `Open once` hoặc `Always allow`.

## 6.2. Strict mode

Strict mode chặn mạnh hơn.

Chặn:

- Mọi `window.open` sang external domain.
- Mọi `_blank` external.
- Mọi redirect external nếu chưa confirm.
- Mọi form submit external.
- Mọi navigation external do script.

Cho phép:

- Same-site navigation.
- Whitelisted external domains.
- User bấm `Open once`.

Khuyến nghị với site nhiều quảng cáo:

```text
animevietsub.* nên dùng Strict mode.
```

## 7. Domain pattern support

Extension cần hỗ trợ bật rule theo pattern.

## 7.1. Exact domain

```text
animevietsub.com
```

Match:

```text
animevietsub.com
```

Không match:

```text
animevietsub.vn
sub.animevietsub.com
```

## 7.2. TLD wildcard

```text
animevietsub.*
```

Match:

```text
animevietsub.com
animevietsub.vn
animevietsub.xyz
animevietsub.to
```

Không match:

```text
fakeanimevietsub.com
animevietsub.example.com
```

## 7.3. Subdomain wildcard

```text
*.animevietsub.com
```

Match:

```text
www.animevietsub.com
m.animevietsub.com
video.animevietsub.com
```

Không match:

```text
animevietsub.com
animevietsub.vn
```

## 7.4. Subdomain + TLD wildcard

```text
*.animevietsub.*
```

Match:

```text
www.animevietsub.com
m.animevietsub.vn
video.animevietsub.xyz
```

Không match:

```text
animevietsub.com
anotheranimevietsub.com
```

Có thể có option:

```text
[✓] Include root domain
```

để `*.animevietsub.*` cũng match `animevietsub.com`, `animevietsub.vn`.

## 8. Blocking strategies

Extension nên dùng nhiều lớp chặn vì website có nhiều cách mở tab/redirect.

## 8.1. Override `window.open`

Inject script vào page context để override `window.open`.

Pseudo behavior:

```js
const originalWindowOpen = window.open;

window.open = function (url, target, features) {
  if (shouldBlockPopup(url)) {
    reportBlockedAttempt(url, 'window.open');
    return null;
  }

  return originalWindowOpen.call(window, url, target, features);
};
```

Yêu cầu:

- Chặn external URL nếu không whitelist.
- Cho phép same-site URL.
- Cho phép nếu user chọn `Open once`.
- Ghi log reason là `window.open`.

### Mỗi realm một bản vá

Mỗi frame cùng origin tạo động (`about:blank`, `srcdoc`) là một realm mới với `window.open`, `HTMLFormElement.prototype.submit`… nguyên bản. Content script tới frame đó muộn (hoặc không tới), và tới rồi cũng chưa có config, nên `iframe.contentWindow.open(ad)` ngay sau `appendChild` lọt qua. Vì vậy `injected-guard.js` vá theo realm (`guardRealm(win)`) và vá luôn getter `HTMLIFrameElement.prototype.contentWindow` / `contentDocument`: lần đầu trang chạm vào frame con cùng origin, frame đó được vá **đồng bộ** bằng chính config của frame cha. Frame khác origin thì không vá được (và không cần — xem §8.2).

Ngoài `window.open`, mỗi realm được vá:

- **Click vào link detached**: `a.click()` / `a.dispatchEvent(click)` trên `<a>` chưa gắn vào document không đi qua listener capture ở `document` của content script, nên vá `HTMLElement.prototype.click` và `EventTarget.prototype.dispatchEvent` (chỉ khi event là `click` và link `!isConnected`). Link đã gắn vào document vẫn do content script xử lý.
- **`form.submit()`**: không phát event `submit` (đúng spec HTML), xem §8.7.
- **Getter frame con** như trên, để realm lồng nhau cũng được vá.

Manifest khai báo `match_origin_as_fallback: true` cho cả hai content script, để frame `about:blank`/`srcdoc`/`data:` cũng có content script (bắt click, gửi gesture). Đó là lớp phụ; lớp chính cho trường hợp đồng bộ là bản vá từ frame cha.

## 8.2. Intercept click event

Content script listen click event ở capture phase:

```js
document.addEventListener('click', handleClick, true);
```

Mục tiêu:

- Detect user click vào `<a>`.
- Detect link có `target="_blank"`.
- Detect click vào overlay hoặc element không phải link nhưng sau đó script gọi popup.
- Lưu thông tin last user gesture để phân biệt hành vi hợp lệ và đáng ngờ.

Nếu click vào link external:

- Normal mode: có thể cho phép nếu link rõ ràng.
- Strict mode: chặn và hỏi user.

Tìm link bằng `event.composedPath()`, không phải `event.target.closest()`: khi tới `document`, target đã bị retarget về shadow host nên link nằm trong shadow root không bao giờ được thấy. Shadow root `closed` không lộ trong `composedPath()` — trường hợp đó để lớp background (§8.5).

### Subframe mang rule của tab

Frame con (player, iframe quảng cáo) được đánh giá theo **tab chứa nó**, giống hệt cách lớp background đánh giá tab mới (§8.5): `getSiteConfig` và `reportBlocked` từ frame có `frameId !== 0` dùng `sender.tab.url` (do trình duyệt cung cấp, frame không giả được) thay cho URL của frame. Config có thêm `siteOrigin` (origin của tab); so sánh same-origin dùng `siteOrigin` chứ không dùng origin của frame — trong iframe của ad network, "cùng origin với tôi" chính là ad network.

Nhưng navigation **nằm trong frame** (player tải trang tiếp theo từ CDN của nó) không phải tab rời site, nên trong subframe chỉ link/form **mở tab mới** hoặc nhắm vào trang trên cùng (`_top`, hoặc `_parent` khi parent là top) mới bị xét. Frame không tự vẽ toast; worker gửi toast tới top frame của tab (`chrome.tabs.sendMessage(..., { frameId: 0 })`), và `pendingToasts` chỉ giao cho top frame.

## 8.3. Intercept anchor target `_blank`

Với link:

```html
<a href="https://ads-site.com" target="_blank"></a>
```

Extension có thể:

- Remove `target="_blank"` nếu same-site.
- Chặn nếu external.
- Hoặc yêu cầu confirm.

Behavior đề xuất:

| Mode      | External `_blank`                                |
| --------- | ------------------------------------------------ |
| Normal    | Chặn nếu domain không whitelist và link đáng ngờ |
| Strict    | Chặn tất cả external `_blank`                    |
| Whitelist | Cho phép                                         |

"`_blank`" ở đây nghĩa là **mọi target mở tab mới**: bất kỳ tên nào không phải `_self`, `_parent`, `_top` và không trùng `name` của một `iframe`/`frame` có sẵn trên trang (ví dụ `target="_new"`), cùng Ctrl/⌘/Shift+click.

## 8.4. Block scripted redirect

Website có thể redirect bằng:

```js
location.href = 'https://ads.com';
location.assign('https://ads.com');
location.replace('https://ads.com');
window.top.location = 'https://ads.com';
```

Extension cần detect navigation external sau click hoặc script.

### Lớp content script: **không** override được `location`

Mọi thành viên của `Location` là `[LegacyUnforgeable]` — thuộc tính **own, không ghi được, không cấu hình lại được** của chính instance, đúng là để một trang không thể tự nói dối mình đang ở đâu. Đo trên Chrome 152:

```text
Object.getOwnPropertyDescriptor(location, 'assign')
  → { writable: false, configurable: false, enumerable: true }
Object.defineProperty(location, 'assign', …)   → TypeError
location.assign = fn                            → TypeError
vá Location.prototype                           → TypeError
```

Nên `injected-guard.js` chỉ override `window.open`, và **không** đụng tới `location`. Trước 1.1.1 nó có thử: đọc method từ `Object.getPrototypeOf(location)` — nơi method không hề nằm ở đó — nên `if (typeof original !== 'function') return` thoát ra trước cả cái `defineProperty` lẽ ra sẽ ném lỗi. Kết quả là không vá được gì, không có lỗi nào, và không dấu hiệu nào cho thấy lớp chặn redirect đang rỗng.

Chặn redirect vì vậy **hoàn toàn nằm ở lớp background**.

### Lớp background

Dùng `chrome.webNavigation.onCommitted` để phát hiện tab vừa chuyển sang external domain.

**Không dựa vào `transitionQualifiers`.** Chrome không gắn nhãn mọi scripted redirect. Đo trên trang tự redirect 600ms sau khi load, không có tương tác nào:

| Cách redirect      | `transitionQualifiers` |
| ------------------ | ---------------------- |
| `location.replace` | `["client_redirect"]`  |
| `location.assign`  | `[]`                   |
| `location.href =`  | `[]`                   |

Đòi `client_redirect` — như bản trước 1.1.1 — cho lọt thẳng 2 trong 3 cách. Thứ thực sự phân biệt "script redirect" với "user bấm link" là **user vừa tương tác hay chưa**: content script báo mỗi `pointerdown`/`keydown` (throttle 250ms) về worker, và navigation không có gesture trong `USER_GESTURE_WINDOW_MS` (1500ms) được coi là của script.

### Navigation do trình duyệt khởi tạo

Trước mọi nhánh, worker cho qua navigation có `transitionType` là `typed`, `generated`, `keyword`, `keyword_generated` hoặc `auto_bookmark` (omnibox và bookmark), và xoá bản ghi opener của tab đó — user đã cầm lái tab. Đo trên Chrome 154: **không** cách nào của trang commit ra các loại này — `window.open` (kể cả `popup`, `noopener`), link `_blank`, form, iframe, `about:blank` rồi đổi `location`, meta refresh, mọi dạng redirect cùng tab và `history.back()` đều là `link` — nên trang không mượn được.

Back/Forward giữ `transitionType` gốc của entry và thêm qualifier `forward_back`: Back về trang user gõ là `typed ["forward_back"]`, Back về trang tới bằng link là `link ["forward_back"]`. Loại sau không phân biệt được với `history.back()` của script, mà việc khôi phục ở trên để lại URL quảng cáo trong session history — đo: script redirect, bị khôi phục, rồi gọi `history.back()` → commit `link ["forward_back"]` sang quảng cáo. Vì vậy `forward_back` được coi là của user **trừ khi** URL đích nằm trong danh sách URL tab đó đã chặn (`blockedUrlsByTab` trong `storage.session`, 20 URL gần nhất mỗi tab). Qualifier `client_redirect` (trang tự redirect) không bao giờ được cho qua theo đường này.

Message là `{ type: 'userGesture', onLink }`; worker lưu `{ at, onLink }` theo tab. Chỉ gesture có `onLink: true` (link, hoặc nút submit/Enter trong form — §6.1) mới làm normal mode cho qua redirect external. Giá trị `onLink` đổi thì gửi ngay, không chờ throttle.

State theo tab (`prevUrl`, opener, thời điểm gesture) nằm trong **`chrome.storage.session`**, không phải `Map` trong bộ nhớ: MV3 tắt worker khi rảnh, mà chính navigation cần kiểm tra lại thường là thứ đánh thức worker — để trong `Map` thì sau mỗi lần worker ngủ, navigation đầu tiên của tab không có `prevUrl` để so và được cho qua.

Mọi lượt ghi vào `storage.session` đi qua **một hàng đợi promise**: đó là read-modify-write trên cùng một object, và các event gọi nó chồng nhau (đóng tab cũ xoá entry trong khi tab mới ghi URL đầu tiên, cùng key), nên không nối tiếp thì một lượt ghi bị mất và tab đó mất `prevUrl`.

`prevUrl` được ghi ở **mọi** top-frame commit, trước khi chọn nhánh xử lý. Ghi riêng trong nhánh same-tab khiến tab nào có commit đầu đi xuống nhánh popup thì không bao giờ có `prevUrl` — đúng vào tab mà ad script mở ra rồi redirect ngay sau đó.

#### Giới hạn: không huỷ được navigation đã commit

MV3 không có cách chặn một navigation đã commit (không dùng `declarativeNetRequest`). Cách duy nhất là **đưa tab quay lại** URL trước đó — mà việc đó chạy lại trang, và trang nào redirect ngay khi load thì sẽ redirect tiếp. Đo được là vòng lặp khôi phục/redirect vô hạn làm tab nhấp nháy liên tục.

Nên có **cầu dao**: tối đa `RESTORE_LIMIT` (3) lần khôi phục mỗi tab trong `RESTORE_WINDOW_MS` (10s). Quá ngưỡng thì thôi khôi phục, để tab đứng yên, và ghi log với `action: 'gave-up'` kèm lý do `… (kept redirecting; stopped restoring)`. Với trang redirect **mỗi lần load**, kết cục là redirect thắng — đây là giới hạn thật của MV3, không phải thứ che giấu được: người dùng vẫn thấy toast và log giải thích chuyện gì đã xảy ra. Trang chỉ redirect một lần thì được khôi phục và ở yên.

Nếu current protected site là:

```text
animevietsub.xyz
```

và tab bị navigate sang:

```text
ads-example.com
```

thì extension có thể:

1. Chặn nếu API hỗ trợ.
2. Hoặc nhanh chóng đưa tab quay lại URL trước đó.
3. Hoặc đóng tab mới nếu nó là tab popup.
4. Ghi log blocked attempt.

## 8.5. Close newly opened unwanted tabs

Nếu website vẫn mở được tab mới, extension cần phát hiện tab mới và đóng nếu URL external không được phép.

Flow:

1. User đang ở protected tab.
2. Site mở tab mới external.
3. Background detect `tabs.onCreated` hoặc `webNavigation.onBeforeNavigate`.
4. Nếu tab opener là protected tab và target URL external:
   - Close tab mới.
   - Focus lại tab gốc.
   - Show toast trên tab gốc.
   - Log blocked attempt.

Pseudo behavior:

```text
Protected opener tab:
animevietsub.xyz

New tab:
ads-example.com

Action:
close new tab
focus opener tab
log blocked attempt
```

Hai điểm vào, cùng một hàm quyết định:

1. `webNavigation.onCreatedNavigationTarget` — có URL đích và `sourceTabId` **trước khi** navigation commit. Đóng ở đây thì trang quảng cáo thường không kịp commit (đo: 2/10 lần, so với 10/10 khi chỉ đóng ở commit), nhưng request tới quảng cáo vẫn đã đi — MV3 không huỷ được nếu không dùng `declarativeNetRequest`. Tab vẫn chớp lên một thoáng vì worker không ngăn được việc tạo tab; đây là lý do lớp trong trang (§8.1–§8.3, §8.7) mới là lớp chính.
2. `webNavigation.onCommitted` với tab có bản ghi opener — cho tab mở bằng `about:blank` rồi mới đổi URL.

Bản ghi opener **chỉ** được ghi từ `onCreatedNavigationTarget` (`sourceTabId`), không từ `openerTabId` của `tabs.onCreated`: Chrome gán `openerTabId` cả cho tab mở bằng Ctrl+T (tab hiện tại thành opener), nên tab user tự mở rồi gõ địa chỉ bị coi là popup của site và bị đóng. `onCreatedNavigationTarget` chỉ bắn cho tab do trang mở — đo cho `window.open` (cả `popup`, `noopener`), link `_blank`, form, iframe, popup `about:blank`; không bắn cho Ctrl+T, Ctrl+N. Bản ghi được xếp hàng (không chờ) trước khi quyết định: chờ ghi storage xong mới quyết định làm trang quảng cáo kịp commit trước khi tab bị đóng.

URL không phải http/https (`about:blank`) **không được quyết định** và không xoá bản ghi opener: `window.open('')` commit `about:blank` trước, và nếu lần commit đó xoá opener ("không phải web, cho qua") thì navigation sang quảng cáo ngay sau đó bị coi như navigation cùng tab từ `about:blank` và lọt. Tập `closingTabs` trong bộ nhớ đảm bảo hai điểm vào không cùng log/toast một tab.

## 8.6. Block pop-under

Pop-under là hành vi:

1. Mở tab/window quảng cáo.
2. Đưa focus lại tab gốc hoặc chuyển focus để user không nhận ra.

Extension cần:

- Detect tab mới external từ protected opener.
- Close ngay nếu không whitelist.
- Ghi reason là `pop-under`.

## 8.7. External form submit guard

Chặn form submit sang external domain.

Ví dụ:

```html
<form action="https://external-ad-site.com" target="_blank"></form>
```

Behavior:

- Same-site form: allow.
- External form:
  - Normal: confirm hoặc block nếu target `_blank`.
  - Strict: block.
  - Whitelisted: allow.

Hai đường submit: event `submit` (submit thật, `requestSubmit()`) do content script bắt ở capture phase; `form.submit()` **không** phát event nên được vá ở `HTMLFormElement.prototype.submit` trong MAIN world (§8.1). Trong subframe chỉ xét form mở tab mới hoặc nhắm `_top` (§8.2).

## 9. Whitelist / allowlist

## 9.1. Domain whitelist

User có thể whitelist domain:

```text
youtube.com
google.com
payment.example.com
```

Nếu URL bị chặn thuộc whitelist thì cho phép.

## 9.2. Per-site whitelist

Whitelist chỉ áp dụng khi source site là site cụ thể.

Ví dụ:

```json
{
  "sourcePattern": "animevietsub.*",
  "allowedDomain": "youtube.com"
}
```

Ý nghĩa:

- Khi đang ở `animevietsub.*`, cho phép mở `youtube.com`.
- Không áp dụng global cho tất cả website.

## 9.3. Temporary allow

Khi toast hiện:

```text
[Open once]
```

Extension mở URL bị chặn một lần, không lưu whitelist.

## 10. Data model

## 10.1. Site protection rule

```json
{
  "id": "rule_001",
  "enabled": true,
  "sitePattern": "animevietsub.*",
  "mode": "strict",
  "settings": {
    "blockWindowOpen": true,
    "blockExternalBlank": true,
    "blockScriptedRedirect": true,
    "blockExternalFormSubmit": true,
    "closeUnwantedNewTabs": true,
    "showToast": true
  },
  "createdAt": "2026-07-12T10:00:00.000Z",
  "updatedAt": "2026-07-12T10:00:00.000Z"
}
```

## 10.2. Allowlist rule

```json
{
  "id": "allow_001",
  "enabled": true,
  "sourcePattern": "animevietsub.*",
  "allowedDomain": "youtube.com",
  "scope": "per-site",
  "createdAt": "2026-07-12T10:10:00.000Z"
}
```

## 10.3. Blocked attempt log

```json
{
  "id": "blocked_001",
  "sourceUrl": "https://animevietsub.xyz/phim/abc",
  "sourceHostname": "animevietsub.xyz",
  "targetUrl": "https://ads-example.com/landing",
  "targetHostname": "ads-example.com",
  "reason": "window.open external",
  "mode": "strict",
  "action": "blocked",
  "createdAt": "2026-07-12T10:20:00.000Z"
}
```

## 11. Storage

Extension dùng `chrome.storage.local`.

Lưu:

- Site protection rules.
- Allowlist rules.
- Blocked logs.
- User settings.

Không lưu:

- Cookie.
- Token.
- LocalStorage/sessionStorage của website.
- Nội dung HTML.
- Nội dung form.
- Dữ liệu cá nhân trên page.

## 12. Permissions

Manifest V3 đề xuất:

```json
{
  "manifest_version": 3,
  "name": "Popup Redirect Guard",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "storage", "tabs", "webNavigation"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content.js"],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  "options_page": "options.html"
}
```

Nếu cần chặn request/navigation ở mức mạnh hơn, có thể cân nhắc thêm:

```json
{
  "permissions": ["declarativeNetRequest"]
}
```

Tuy nhiên MVP có thể ưu tiên:

- Override script.
- Intercept click.
- Detect tab mới.
- Close tab external không mong muốn.

## 13. Technical architecture

## 13.1. File structure

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── injected-guard.js
├── popup.html
├── popup.js
├── options.html
├── options.js
├── modules/
│   ├── domain-matcher.js
│   ├── navigation-guard.js
│   ├── popup-guard.js
│   ├── allowlist.js
│   ├── block-log.js
│   └── storage-repository.js
└── styles/
    ├── popup.css
    ├── options.css
    └── toast.css
```

## 13.2. `background.js`

Phụ trách:

- Load site protection rules.
- Detect protected tabs.
- Listen tab creation.
- Listen navigation events.
- Close unwanted new tabs.
- Focus lại opener tab.
- Ghi blocked logs.
- Nhận message từ content script.
- Mở URL nếu user chọn `Open once`.

## 13.3. `content.js`

Phụ trách:

- Chạy sớm ở `document_start`.
- Kiểm tra site hiện tại có protected hay không.
- Inject `injected-guard.js` vào page context.
- Listen click event capture phase.
- Listen submit event capture phase.
- Hiển thị toast.
- Gửi blocked attempt về background.

## 13.4. `injected-guard.js`

Phụ trách can thiệp vào page context:

- Override `window.open`, `form.submit()` và click vào link detached, ở realm của mình và mọi frame con cùng origin (§8.1).
- **Không** guard `location.*` — không vá được (§8.4).
- `postMessage` về content script khi block.

## 13.5. `domain-matcher.js`

Phụ trách:

- Parse hostname.
- Match exact domain.
- Match `animevietsub.*`.
- Match `*.animevietsub.*`.
- Check same-site.
- Check whitelist.

## 14. Main flows

## 14.1. Enable protection for current site

1. User mở website.
2. User click extension icon.
3. Popup hiển thị current hostname.
4. User click:

```text
Enable for animevietsub.*
```

5. Extension tạo site rule:

```json
{
  "sitePattern": "animevietsub.*",
  "mode": "strict",
  "enabled": true
}
```

6. Extension reload page hoặc inject protection ngay.
7. Protection bắt đầu hoạt động.

## 14.2. Block `window.open`

1. Website gọi:

```js
window.open('https://ads-example.com');
```

2. `injected-guard.js` kiểm tra URL.
3. Target là external domain.
4. Source site đang protected.
5. Domain không có trong allowlist.
6. Extension block.
7. Gửi event blocked attempt.
8. Content script show toast.
9. Background lưu log.

## 14.3. Close unwanted new tab

1. User click trên protected site.
2. Website mở tab mới external.
3. Background detect tab mới có opener là protected tab.
4. Target URL là external và không whitelist.
5. Background close tab mới.
6. Focus lại tab gốc.
7. Content script show toast trên tab gốc.
8. Lưu log.

## 14.4. Block external redirect

1. User đang ở:

```text
https://animevietsub.xyz/phim/abc
```

2. Script redirect tab hiện tại sang:

```text
https://ads-example.com/landing
```

3. Extension detect external navigation.
4. Nếu strict mode:
   - Chặn nếu có thể.
   - Hoặc restore tab về URL trước.
   - Show toast.
   - Log attempt.

## 14.5. User open blocked URL once

1. Extension chặn URL.
2. Toast hiển thị:

```text
[Open once]
```

3. User click `Open once`.
4. Extension mở URL trong tab mới.
5. Không thêm vào allowlist.

## 14.6. User always allow domain

1. Extension chặn URL.
2. Toast hiển thị:

```text
[Always allow]
```

3. User click.
4. Extension thêm target hostname vào allowlist cho source site.
5. Lần sau target domain đó không bị chặn.

## 15. Logic quyết định block

## 15.1. Input

```json
{
  "sourceUrl": "https://animevietsub.xyz/phim/abc",
  "targetUrl": "https://ads-example.com/landing",
  "trigger": "window.open",
  "mode": "strict",
  "hasUserGesture": true
}
```

## 15.2. Decision order

1. Nếu source site không protected → allow.
2. Nếu target URL invalid → block.
3. Nếu target same-origin → allow.
4. Nếu target same-site và setting cho phép → allow.
5. Nếu target domain trong allowlist → allow.
6. Nếu mode strict → block external.
7. Nếu mode normal:

   - Block nếu trigger là `window.open`.
   - Block nếu target `_blank` external đáng ngờ.
   - Block nếu redirect external không phải từ link rõ ràng.
   - Confirm nếu user click link external rõ ràng.

8. Log decision nếu block.

## 16. Toast behavior

Toast nên nằm ở góc dưới bên phải.

Nội dung:

```text
Blocked unwanted popup

ads-example.com

Reason:
window.open external

[Open once] [Always allow] [Dismiss]
```

Nếu nhiều attempts liên tục trong vài giây, group lại:

```text
Blocked 5 unwanted popups

Latest:
ads-example.com

[View] [Dismiss]
```

## 17. Options page

## 17.1. Protected sites

Bảng:

```text
Protected Sites

| Enabled | Pattern | Mode | Blocked count | Actions |
|---|---|---|---|
| ✓ | animevietsub.* | Strict | 42 | Edit / Delete |
```

## 17.2. Allowlist

Bảng:

```text
Allowlist

| Source pattern | Allowed domain | Scope | Actions |
|---|---|---|---|
| animevietsub.* | youtube.com | Per-site | Delete |
```

## 17.3. Logs

Bảng:

```text
Blocked Logs

| Time | Source | Target | Reason | Action |
|---|---|---|---|
| 10:20 | animevietsub.xyz | ads.com | window.open external | Open / Allow |
```

Có action:

```text
[Clear logs]
[Export logs]
```

## 18. Error handling

## 18.1. Unsupported page

Nếu page là:

```text
chrome://
edge://
about:
file://
devtools://
```

Hiển thị:

```text
This page is not supported.
Please open a normal http/https website.
```

## 18.2. Cannot inject script

Nếu không inject được:

```text
Cannot enable protection on this page.
Please check extension permissions.
```

## 18.3. URL parse error

Nếu target URL không parse được:

- Block mặc định trong strict mode.
- Log reason:

```text
invalid target URL
```

## 18.4. Too many blocked attempts

Nếu website spam popup quá nhiều:

- Group log.
- Không show toast liên tục.
- Rate limit toast.

Ví dụ:

```text
Blocked 32 popup attempts in the last 10 seconds.
```

## 19. Security & privacy

Extension không được:

- Gửi URL ra server.
- Đọc hoặc lưu cookie/token.
- Đọc nội dung form input.
- Lưu HTML page.
- Gửi lịch sử duyệt web ra ngoài.
- Tự động bật trên mọi site nếu user chưa chọn.
- Tự động mở URL bị chặn nếu user chưa xác nhận.

Extension chỉ lưu:

- Site pattern được bảo vệ.
- Allowlist.
- Blocked target URL metadata.
- Setting của user.

## 20. Performance requirements

- Content script phải chạy sớm ở `document_start`.
- Guard logic phải nhẹ.
- Không scan toàn bộ DOM liên tục nếu không cần.
- Toast cần rate limit.
- Log cần giới hạn số lượng, ví dụ giữ tối đa 1000 records/site.
- Không làm chậm click/navigation hợp lệ.
- Không làm hỏng same-site navigation.

## 21. Acceptance criteria

### AC-01: Enable protection

Khi user bật protection cho:

```text
animevietsub.*
```

extension apply cho:

```text
animevietsub.com
animevietsub.vn
animevietsub.xyz
```

và không apply cho:

```text
another-site.com
fakeanimevietsub.com
```

### AC-02: Block window.open external

Nếu protected site gọi:

```js
window.open('https://ads-example.com');
```

extension phải chặn tab/window mới.

### AC-03: Allow same-site navigation

Nếu protected site mở:

```text
https://animevietsub.xyz/phim/abc
```

extension không được chặn.

### AC-04: Close unwanted new tab

Nếu protected site mở tab mới sang external domain, extension phải đóng tab mới và focus lại tab gốc.

### AC-05: Show toast

Khi chặn popup, extension hiển thị toast có:

- Target domain
- Reason
- Open once
- Always allow
- Dismiss

### AC-06: Open once

Khi user click `Open once`, extension mở URL bị chặn một lần và không lưu allowlist.

### AC-07: Always allow

Khi user click `Always allow`, extension thêm target domain vào allowlist cho source site.

### AC-08: Strict mode

Ở strict mode, mọi external popup/tab/redirect từ protected site đều bị chặn nếu không whitelist.

### AC-09: Normal mode

Ở normal mode, extension vẫn cho phép navigation hợp lệ nhưng chặn popup/scripted redirect đáng ngờ.

### AC-10: Logs

Mỗi blocked attempt được lưu vào log với:

- Source URL
- Target URL
- Reason
- Time
- Mode

### AC-11: Unsupported pages

Extension không crash trên `chrome://`, `about:blank`, `file://`.

### AC-12: No sensitive data

Extension không lưu cookie, token, form input, localStorage/sessionStorage hoặc HTML content.

## 22. MVP scope

Version đầu cần có:

- Popup.
- Enable protection cho current site.
- Support domain pattern `animevietsub.*`.
- Strict mode.
- Override `window.open`.
- Intercept external `_blank`.
- Close newly opened external tab từ protected opener.
- Toast khi block.
- Open once.
- Always allow domain.
- Blocked logs cơ bản.
- Options page để quản lý protected sites và allowlist.

## 23. Future improvements

Có thể mở rộng:

- Declarative Net Request rules.
- Import/export settings.
- Sync settings.
- Advanced normal mode heuristic.
- Detect clickjacking overlay.
- Detect invisible full-page anchor.
- Temporary protection session.
- Per-tab protection.
- Badge counter trên extension icon.
- Auto-suggest protection khi phát hiện nhiều popup.
- Support Firefox.
- Allow external link only after confirmation modal.
- Add keyboard shortcut để bật/tắt nhanh.
- Detect and remove malicious overlay elements.
- Combine với element blocker/content filter.
