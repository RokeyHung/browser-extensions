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

## 6. Protection modes

## 6.1. Normal mode

Normal mode cân bằng giữa usability và protection.

Chặn:

- `window.open` sang external domain.
- Tab mới không do user gesture rõ ràng.
- Redirect external xảy ra ngay sau click vào vùng không phải link.
- Link `_blank` external đáng ngờ.
- Form submit external đáng ngờ.

Cho phép:

- Same-site navigation.
- Same-site tab mới.
- User click trực tiếp vào link external rõ ràng nếu option cho phép.
- Whitelisted domains.

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

## 8.4. Block scripted redirect

Website có thể redirect bằng:

```js
location.href = 'https://ads.com';
location.assign('https://ads.com');
location.replace('https://ads.com');
window.top.location = 'https://ads.com';
```

Extension cần detect navigation external sau click hoặc script.

Có 2 lớp:

### Lớp content script

Inject guard để override:

```js
location.assign;
location.replace;
```

Một số property như `location.href` khó override ổn định trên mọi browser, nên cần thêm lớp background.

### Lớp background

Dùng navigation event để detect tab hiện tại sắp chuyển sang external domain.

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

- Override `window.open`.
- Guard `location.assign`.
- Guard `location.replace`.
- Có thể guard một số pattern redirect phổ biến.
- Dispatch custom event về content script khi block.

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
