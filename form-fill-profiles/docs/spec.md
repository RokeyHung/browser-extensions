# Spec: Form Fill Profiles Extension

## 1. Mục tiêu

Xây dựng browser extension giúp user **lưu lại câu trả lời cho form và điền lại form đó bất cứ lúc nào**.

Luồng chính gồm 3 bước:

1. **Capture** — đang đứng ở một path, user bấm scan để extension đọc ra toàn bộ form/field có trên page đó.
2. **Fill & save** — extension mở options page, render lại form vừa capture để user điền câu trả lời và lưu thành một _profile_ (bộ câu trả lời) có tên.
3. **Apply** — user quay lại path đó, mở popup, chọn profile đã điền và bấm apply; extension điền toàn bộ giá trị vào form thật trên page.

Mục tiêu là tiết kiệm thời gian cho dev/tester/QA phải nhập lại cùng một bộ dữ liệu (form đăng ký, form tạo đơn, form khai báo, form nhiều bước…) hàng chục lần mỗi ngày.

Extension hỗ trợ domain pattern dạng wildcard, bao gồm `*.domain.*`, để một profile dùng được cho nhiều môi trường (`dev.example.com`, `staging.example.vn`, `example.io`…).

Extension **không phải password manager**. Extension không quản lý credential, không auto-submit, không thay thế Chrome autofill.

## 2. Định nghĩa

### 2.1. Form snapshot

Kết quả capture form tại một path: danh sách field kèm metadata (label, type, selector, options…). Snapshot **chỉ mô tả cấu trúc form**, không phải câu trả lời.

### 2.2. Field

Một control nhận input của user, gồm:

- `<input>` (trừ các type bị loại trừ ở mục 6.5)
- `<textarea>`
- `<select>` (single/multiple)
- Element có `contenteditable="true"`
- Nhóm radio (nhiều `<input type="radio">` cùng `name` được gom thành 1 field)

### 2.3. Profile (bộ câu trả lời)

Tập giá trị user đã điền cho một form snapshot, có tên do user đặt.

Một form snapshot có thể có nhiều profile.

Ví dụ form `/register` có 3 profile:

```text
Account VN - Gmail
Account JP - Outlook
Account test - min data
```

### 2.4. Form key

Chuỗi định danh giúp nhận lại đúng form ở lần sau, sinh từ:

- `id` / `name` / `action` của `<form>` (nếu có)
- Danh sách `name` của field đã sort
- Index của form trong page (fallback khi form không có định danh nào)

Xem mục 6.6.

### 2.5. Apply

Hành động ghi giá trị của một profile vào form thật đang mở trên page, kèm dispatch event để framework (React/Vue/Angular/Svelte) nhận được thay đổi.

### 2.6. Match

Một profile được coi là dùng được cho URL hiện tại khi:

- `domainPattern` của form record match hostname (mục 7.1)
- `pathPattern` của form record match pathname (mục 7.2)

## 3. Phạm vi

## 3.1. Trong scope

Extension hỗ trợ:

- Capture toàn bộ form/field của page hiện tại.
- Capture cả field không nằm trong `<form>` (SPA thường không dùng thẻ `form`).
- Detect label của field theo nhiều chiến lược.
- Sinh selector ổn định cho từng field.
- Mở options page để user điền và lưu profile.
- Nhiều profile cho cùng một form.
- Chọn 1 profile làm default cho form.
- Apply profile vào page hiện tại từ popup.
- Auto-apply default profile khi page load (mặc định OFF).
- Domain pattern: exact, `*.domain.com`, `domain.*`, `*.domain.*`.
- Path pattern: exact và prefix wildcard (`/register/*`).
- Report kết quả apply: field đã điền / không tìm thấy / bị skip.
- Re-capture form và merge với snapshot cũ khi form đổi.
- Duplicate profile, rename, delete.
- Export/import JSON.
- Xoá dữ liệu theo form hoặc theo site.

## 3.2. Ngoài scope MVP

Không xử lý trong version đầu:

- Auto-submit form sau khi apply.
- Quản lý password/credential như password manager.
- Mã hoá dữ liệu profile.
- Sync profile qua account/server.
- Upload file cho `<input type="file">` (browser không cho set programmatically).
- Giải captcha, OTP, 2FA.
- Custom widget phức tạp không có element form thật (rich text editor dạng canvas, date picker vẽ bằng div hoàn toàn không có input ẩn, combobox virtualize…) — chỉ best-effort.
- Điền form nằm trong iframe cross-origin.
- Record/replay chuỗi thao tác nhiều bước tự động (multi-step wizard tự chuyển step).
- Generate dữ liệu random/fake.
- Điền form trên nhiều tab cùng lúc.

## 4. User stories

### US-01: Capture form ở path hiện tại

Là user, tôi đang đứng ở `https://example.com/register`, tôi muốn bấm 1 nút để extension đọc ra tất cả field của form trên page này.

### US-02: Điền và lưu câu trả lời

Là user, sau khi capture tôi muốn extension mở options page, render lại form đó để tôi điền câu trả lời một lần và lưu lại kèm tên profile.

### US-03: Apply profile đã lưu

Là user, khi quay lại `https://example.com/register`, tôi muốn mở popup, thấy các profile đã lưu cho path này và bấm apply để form được điền tự động.

### US-04: Nhiều profile cho một form

Là tester, tôi muốn lưu nhiều bộ dữ liệu cho cùng một form (happy case, min data, boundary case) và chọn bộ nào cần dùng.

### US-05: Dùng chung profile giữa các môi trường

Là dev, tôi muốn một profile dùng được cho `dev.example.com`, `staging.example.vn` và `example.io` bằng pattern `*.example.*`.

### US-06: Auto-apply

Là user, tôi muốn bật auto-apply để form được điền sẵn ngay khi page load, không cần mở popup.

### US-07: Form đổi cấu trúc

Là user, khi form của website thay đổi (thêm/bớt field), tôi muốn re-capture và giữ lại câu trả lời của các field cũ vẫn còn.

### US-08: Export/import

Là user, tôi muốn export profile ra JSON để backup hoặc chia sẻ cho đồng đội, và import lại trên máy khác.

## 5. UX chính

## 5.1. Popup — chưa có profile cho path hiện tại

```text
Form Fill Profiles

Current path:
https://example.com/register

No saved profile for this path.

Forms detected on page: 1 (12 fields)

[Capture form on this page]
[Manage profiles]
```

## 5.2. Popup — đã có profile match

```text
Form Fill Profiles

Current path:
https://example.com/register

Matched form:
Register form (12 fields)
Pattern: *.example.* /register

Profiles:
( ) Account VN - Gmail        default
( ) Account JP - Outlook
( ) Account test - min data

[Apply selected profile]

Auto-apply on load: OFF

[Re-capture form] [Manage profiles]
```

## 5.3. Popup — kết quả sau khi apply

```text
Apply completed

Filled: 10
Skipped: 1
Not found: 1

Not found:
- Referral code

Skipped:
- Password (excluded by settings)

[Undo] [Apply again]
```

## 5.4. Options page — danh sách form

```text
Form Fill Profiles

Sites:
example.com (2 forms, 4 profiles)
shop.internal (1 form, 1 profile)

Forms of example.com:

| Form            | Pattern              | Fields | Profiles | Last used  |
| Register form   | *.example.* /register| 12     | 3        | 2026-07-26 |
| Checkout form   | example.com /checkout| 18     | 1        | 2026-07-20 |

Actions per form:
[Edit patterns] [Add profile] [Re-capture] [Export] [Delete]
```

## 5.5. Options page — profile editor

Đây là màn hình chính của bước 2: extension render lại form snapshot thành một form thật để user điền.

```text
Profile editor

Form: Register form
Source: https://example.com/register
Pattern: [*.example.*] [/register]

Profile name: [ Account VN - Gmail        ]
Set as default: [x]

Fields:

Full name        (input/text, name="fullName")
[ Nguyen Van A                        ]

Email            (input/email, name="email")   required
[ test01@gmail.com                    ]

Phone            (input/tel, name="phone")
[ 0900000000                          ]

Country          (select, name="country")
[ Vietnam                          v ]

Gender           (radio, name="gender")
( ) Male  (x) Female  ( ) Other

Newsletter       (checkbox, name="newsletter")
[x] checked

Bio              (textarea, name="bio")
[ QA test account                     ]

Password         (input/password, name="password")
-- excluded by settings, enable in Settings to store --

[Save profile] [Save & apply to tab] [Cancel]
```

## 5.6. Options page — settings

```text
Settings

[x] Show apply result in popup
[ ] Auto-apply default profile on page load
[ ] Include password fields when capturing  (stored as plain text)
[ ] Include hidden fields
[x] Dispatch input/change events after filling
[x] Retry filling for dynamic forms
Retry window: [3000] ms
[ ] Submit form after apply
```

## 5.7. Unsupported page

```text
This page is not supported.
Please open a normal http/https website.
```

## 6. Form capture

## 6.1. Nguồn field

Content script scan theo thứ tự:

1. Mọi `<form>` trong document.
2. Field **không** thuộc `<form>` nào → gom vào một pseudo-form `__orphan__`.
3. Field trong iframe **same-origin** → capture kèm `frameIndex` (best-effort).

Query cơ bản:

```js
document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
```

## 6.2. Field types hỗ trợ

| Type                                                            | Cách lưu value            | Ghi chú                     |
| --------------------------------------------------------------- | ------------------------- | --------------------------- |
| `text`, `email`, `tel`, `url`, `search`, `number`, `password`\* | string                    | \* xem 6.5                  |
| `date`, `time`, `datetime-local`, `month`, `week`               | string theo format native | `yyyy-mm-dd`…               |
| `range`                                                         | string/number             |                             |
| `color`                                                         | string `#rrggbb`          |                             |
| `checkbox`                                                      | boolean                   |                             |
| `radio` (nhóm cùng `name`)                                      | string = value được chọn  | gom nhóm thành 1 field      |
| `select` single                                                 | string = option value     | lưu kèm label để fallback   |
| `select` multiple                                               | array of string           |                             |
| `textarea`                                                      | string                    |                             |
| `contenteditable`                                               | string (textContent)      | MVP không lưu HTML          |
| `file`                                                          | không lưu                 | browser không cho set value |
| `hidden`                                                        | không lưu (mặc định)      | bật được trong settings     |
| `submit`, `button`, `reset`, `image`                            | bỏ qua                    | không phải field nhập       |

## 6.3. Label detection

Tìm label cho field theo thứ tự ưu tiên, lấy cái đầu tiên có nội dung:

1. `<label for="{id}">`
2. `<label>` là ancestor của field
3. `aria-label`
4. Element được trỏ bởi `aria-labelledby`
5. `placeholder`
6. `title`
7. Text node liền trước field trong cùng container
8. `name` của field
9. `Field #{index}`

Label được trim, gộp whitespace và cắt tối đa 120 ký tự.

### Ranh giới của tầng 7

Chữ "trong cùng container" ở tầng 7 được thực thi bằng **hai** chặn, cả hai đều thêm sau khi đo hậu quả của việc thiếu chúng:

- **Không đi quá `<form>` của chính field** (hoặc `<body>` với field không nằm trong form nào). Thiếu chặn này, vòng lặp trèo khỏi form, qua `<body>`, sang `<head>` và trả về text của `<title>` làm label — đo được trên trang chỉ có `<button>` đứng trước field: label ra đúng bằng tiêu đề trang.
- **Gặp thứ thuộc về field khác thì dừng hẳn**, không bước qua rồi đi tiếp. Text nằm xa hơn nữa ở phía bên kia field đó, nên nó mô tả field đó chứ không phải field đang xét. "Thuộc về field khác" gồm: chính là control, chứa control bên trong, là `<label for>` trỏ sang field khác, hoặc là element được field khác trỏ tới bằng `aria-labelledby`.

Hai chặn này **không** thu hẹp tầng 7 ở chỗ nó vốn đúng: heading hay đoạn text đứng ngay trước field trong cùng container, không có control nào chen giữa, vẫn được lấy làm label.

Vì sao đáng quan tâm chứ không chỉ là cosmetic: `labelText` còn được dùng làm fallback tìm lại field lúc apply (§9.2) và làm khoá so khớp trong `findOld` khi re-capture (§13.5). Hai field không tên cùng nhận một label rác giống nhau thì re-capture có thể ghép nhầm cặp, và câu trả lời đã lưu rơi sang field khác.

## 6.4. Selector strategy

Mỗi field lưu **nhiều cách định danh** để lần apply sau vẫn tìm lại được, kể cả khi DOM đổi:

```json
{
  "name": "email",
  "id": "register-email",
  "selector": "form#register input[name='email']",
  "labelText": "Email",
  "domIndex": 1
}
```

Nguyên tắc sinh selector (giống mục "Selector generation rules" của block-elements-webpage):

- Ưu tiên: `[name]` → `#id` (nếu id không random) → `[data-testid]` / `[data-test]` / `[data-qa]` → attribute ổn định (`type`, `placeholder`, `aria-label`) → path ngắn nhất kèm `nth-of-type`.
- Tránh: class hash (`css-1x2y3z`, `sc-AbCdEf`), id có số ngẫu nhiên/UUID, index sâu quá 4 cấp, class trạng thái (`is-active`, `has-error`, `focused`, `ng-*`, `v-*`).
- Selector luôn được scope trong form container nếu form có định danh.

## 6.5. Field bị loại trừ

Mặc định **không** capture:

- `input[type=password]` — cần bật `includePasswordFields` trong settings, kèm cảnh báo dữ liệu lưu **plain text** trong `chrome.storage.local`.
- `input[type=hidden]` — cần bật `includeHiddenFields`.
- `input[type=file]`.
- Field `disabled` hoặc `readonly`.
- Field `[autocomplete="one-time-code"]`, field có label/name khớp `otp|captcha|cvv|cvc|card.?number|security.?code` (nhận biết theo regex, chỉ để cảnh báo và mặc định skip).
- Field không visible (`display:none`, `visibility:hidden`, size 0) — trừ khi `includeHiddenFields` bật.

Field bị loại trừ vẫn được liệt kê trong snapshot với `excluded: true` và `excludedReason`, để user thấy form có field đó nhưng extension chủ động không lưu.

## 6.6. Form signature & form key

```text
formSignature = [formId | formName | formAction-path | "orphan"] + ":" + sorted(fieldNames).join(",")
formKey       = hash(formSignature)          // djb2, hex
formId        = "form_" + timestamp + "_" + random
```

Khi capture lại cùng một page:

- Nếu `formKey` trùng form record đã có → coi là cùng form, đi vào flow re-capture (mục 13.5).
- Nếu chỉ `formId`/`action` trùng nhưng field set khác → vẫn coi là cùng form, đánh dấu `schemaChanged: true`.
- Nếu không match gì → tạo form record mới.

## 6.7. Output của capture

### `formLabel` — tên hiển thị của form

Lấy cái đầu tiên có nội dung:

1. `aria-label` của `<form>`
2. `<h1>`…`<h4>` đầu tiên bên trong form
3. `<legend>` đầu tiên bên trong form
4. `Form #{id}` nếu id không random
5. `Form {name}`
6. `{document.title} form`
7. `Form #{index}`

Heading đứng **trước** legend là có chủ đích. `querySelector('legend')` trả về legend đầu tiên ở bất kỳ đâu trong form, mà dạng markup rất phổ biến là form có `<h2>` làm tiêu đề cộng một `<fieldset><legend>` gom nhóm radio — khi đó legend là tên của **nhóm**, không phải của form, và form đăng ký bị đặt tên thành "Preferred contact". Legend vẫn là câu trả lời đúng khi nó là thứ duy nhất đặt tên cho form, nên nó ở ngay bậc dưới.

Form không nằm trong thẻ `<form>` nào (pseudo-form) luôn có label `Fields outside form`.

```json
{
  "formKey": "a3f19b",
  "formLabel": "Register form",
  "sourceUrl": "https://example.com/register",
  "hostname": "example.com",
  "pathname": "/register",
  "fieldCount": 12,
  "fields": [
    {
      "fieldId": "f_01",
      "kind": "input",
      "type": "email",
      "name": "email",
      "id": "register-email",
      "selector": "form#register input[name='email']",
      "labelText": "Email",
      "placeholder": "you@example.com",
      "required": true,
      "domIndex": 1,
      "options": null,
      "excluded": false
    },
    {
      "fieldId": "f_05",
      "kind": "select",
      "type": "select-one",
      "name": "country",
      "id": "register-country",
      "selector": "form#register select[name='country']",
      "labelText": "Country",
      "required": false,
      "domIndex": 5,
      "options": [
        { "value": "vn", "label": "Vietnam" },
        { "value": "jp", "label": "Japan" }
      ],
      "excluded": false
    },
    {
      "fieldId": "f_09",
      "kind": "input",
      "type": "password",
      "name": "password",
      "labelText": "Password",
      "excluded": true,
      "excludedReason": "password-excluded-by-settings"
    }
  ]
}
```

## 7. Domain & path matching

Dùng đúng semantics của `rule-matcher.js` trong extension block-elements-webpage để cả repo nhất quán.

## 7.1. Domain pattern

### Exact / bare domain

Pattern:

```text
example.com
```

Match:

```text
example.com
www.example.com
m.example.com
dev.example.com
```

Không match:

```text
example.vn
notexample.com
```

### Subdomain wildcard

Pattern:

```text
*.example.com
```

Match:

```text
dev.example.com
staging.example.com
```

Không match:

```text
example.com
```

### TLD wildcard

Pattern:

```text
example.*
```

Match:

```text
example.com
example.vn
example.io
```

Không match:

```text
dev.example.com
```

### Root + subdomain + TLD wildcard

Pattern:

```text
*.example.*
```

Match:

```text
example.com
www.example.com
dev.example.vn
staging.example.io
```

Không match:

```text
example
another.com
```

Pattern mặc định khi capture: **`*.{registrableName}.*`** suy ra từ hostname (ví dụ `example.com` → `*.example.*`), user sửa lại được trong options.

## 7.2. Path pattern

| Pattern       | Match                                  |
| ------------- | -------------------------------------- |
| `/register`   | đúng `/register`                       |
| `/register/*` | `/register/step-1`, `/register/step-2` |
| `*`           | mọi path của domain                    |
| `null`        | mọi path (tương đương `*`)             |

Query string và hash **không** tham gia matching. Path so sánh phân biệt chữ hoa/thường, có normalize trailing slash (`/register/` ≡ `/register`).

## 7.3. Thứ tự ưu tiên khi nhiều form match

1. Path pattern cụ thể hơn (exact > prefix > `*`).
2. Domain pattern cụ thể hơn (exact > `*.domain.com` > `domain.*` > `*.domain.*`).
3. Form có `fieldCount` khớp DOM hiện tại nhiều hơn.
4. `updatedAt` mới hơn.

## 8. Data model

## 8.1. Form record

```json
{
  "id": "form_1784979112658_6494",
  "formKey": "a3f19b",
  "label": "Register form",
  "domainPattern": "*.example.*",
  "pathPattern": "/register",
  "sourceUrl": "https://example.com/register",
  "hostname": "example.com",
  "frameIndex": 0,
  "enabled": true,
  "autoApply": false,
  "defaultProfileId": "profile_1784979200000_11",
  "schemaChanged": false,
  "fields": [],
  "createdAt": "2026-07-26T04:10:00.000Z",
  "updatedAt": "2026-07-26T04:12:00.000Z",
  "lastUsedAt": "2026-07-26T06:00:00.000Z"
}
```

## 8.2. Profile record

```json
{
  "id": "profile_1784979200000_11",
  "formId": "form_1784979112658_6494",
  "name": "Account VN - Gmail",
  "note": "Dùng cho smoke test môi trường dev",
  "values": {
    "f_01": "test01@gmail.com",
    "f_02": "Nguyen Van A",
    "f_05": { "value": "vn", "label": "Vietnam" },
    "f_06": "female",
    "f_07": true,
    "f_08": "QA test account"
  },
  "submitAfterApply": false,
  "createdAt": "2026-07-26T04:20:00.000Z",
  "updatedAt": "2026-07-26T04:20:00.000Z",
  "lastUsedAt": "2026-07-26T06:00:00.000Z",
  "useCount": 7
}
```

Key của `values` là `fieldId`, không phải selector — selector có thể được cập nhật khi re-capture mà profile vẫn giữ nguyên.

Với `select`, value lưu cả `value` và `label` để fallback khi option value đổi (mục 9.3).

## 8.3. Settings

```json
{
  "showApplyResult": true,
  "autoApplyOnLoad": false,
  "includePasswordFields": false,
  "includeHiddenFields": false,
  "dispatchEvents": true,
  "retryDynamicForms": true,
  "retryWindowMs": 3000,
  "submitAfterApply": false
}
```

## 8.4. Export file

Tên file: `form-fill-profiles.json` (đặt cạnh `element-filter-rules.json`, `popup-guard-sites.json` của các extension khác).

```json
{
  "version": "1",
  "exportedAt": "2026-07-26T06:00:00.000Z",
  "forms": [],
  "profiles": []
}
```

## 9. Apply engine

## 9.1. Flow

1. Popup gửi `applyProfile` kèm `formId`, `profileId`, `tabId`.
2. Background lấy form record + profile từ storage.
3. Inject apply script vào tab (`chrome.scripting.executeScript`).
4. Script resolve từng field theo mục 9.2.
5. Set value theo `kind`/`type` (mục 9.3).
6. Dispatch event (mục 9.4).
7. Nếu `retryDynamicForms` bật và còn field chưa tìm thấy → retry trong `retryWindowMs` (mục 9.5).
8. Trả report về popup: `filled`, `notFound`, `skipped`, `failed`.
9. Cập nhật `lastUsedAt`, `useCount`.

## 9.2. Field resolution priority

Với mỗi field, thử lần lượt, dừng ở cái đầu tiên tìm được **đúng 1** element:

1. `selector` đã lưu.
2. `[name="..."]` trong form container.
3. `#id` (nếu id không có dấu hiệu random).
4. `[data-testid]` / `[data-test]` / `[data-qa]` đã lưu.
5. Label text khớp (case-insensitive, trim) → lấy control gắn với label đó.
6. `placeholder` / `aria-label` khớp.
7. `domIndex` trong danh sách field cùng `kind` của form container.

Nếu selector trả về nhiều element → dùng `domIndex` để chọn. Nếu vẫn không xác định được → tính là `notFound`, không đoán bừa.

## 9.3. Set value theo loại field

- **Text-like** (`text`, `email`, `tel`, `url`, `search`, `number`, `password`, `date`, `time`, `color`, `range`, `textarea`):
  set qua **native setter** để React nhận được thay đổi:

  ```js
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  desc.set.call(el, value);
  ```

  (dùng `HTMLTextAreaElement.prototype` cho textarea, `HTMLSelectElement.prototype` cho select)

- **checkbox**: chỉ set `el.checked` khi khác giá trị hiện tại, rồi dispatch `click` hoặc `change` tuỳ setting.
- **radio**: tìm trong nhóm `name` input có `value` khớp → set `checked = true` + dispatch `click`.
- **select single**: match theo `value`; nếu không có option nào khớp → match theo `label` (trim, case-insensitive); nếu vẫn không có → `notFound` với reason `option-missing`.
- **select multiple**: set `selected` cho từng option khớp, các option còn lại `false`.
- **contenteditable**: set `textContent`, dispatch `input`.
- **file**: luôn `skipped`, reason `file-not-supported`.

## 9.4. Event dispatch

Sau khi set value, dispatch theo thứ tự (khi `dispatchEvents` bật):

```text
focus → input (bubbles) → change (bubbles) → blur
```

Với checkbox/radio dùng `click` thay cho `input` khi element không disabled, vì nhiều UI library chỉ nghe `click`.

Mọi event dùng `{ bubbles: true }`. Không dùng `dispatchEvent` với `isTrusted` fake — không cần thiết và không làm được.

## 9.5. Dynamic form / retry

Form render chậm hoặc field xuất hiện theo bước:

- Lần apply đầu chạy ngay khi được gọi.
- Nếu còn field `notFound` và `retryDynamicForms` bật: dùng `MutationObserver` + interval 300ms, retry trong tối đa `retryWindowMs`, mỗi field chỉ điền 1 lần.
- Hết thời gian → chốt report.

## 9.6. Undo

Trước khi ghi, apply script lưu giá trị cũ của các field sẽ bị đổi vào bộ nhớ tạm của tab. Popup hiện `[Undo]` để ghi lại giá trị cũ, dùng cùng cơ chế set value + dispatch event. Undo chỉ còn hiệu lực khi tab chưa reload/navigate.

## 9.7. Submit

Mặc định **không** submit. Chỉ khi `submitAfterApply` bật ở cấp profile hoặc settings, extension mới gọi `form.requestSubmit()` (fallback `form.submit()` nếu không có). Với pseudo-form `__orphan__` không có `<form>` → không submit được, hiện warning.

## 10. Storage

Dùng `chrome.storage.local`.

Lưu:

- Form records.
- Profile records.
- Settings.
- Thống kê `lastUsedAt` / `useCount`.

Không lưu:

- Cookie, token, session của website.
- localStorage/sessionStorage của website.
- HTML đầy đủ của page.
- Nội dung field bị loại trừ (mục 6.5).
- Giá trị `input[type=file]`.

## 11. Permissions

```json
{
  "manifest_version": 3,
  "name": "Form Fill Profiles",
  "version": "1.0.0",
  "description": "Capture forms on a page, save your answers as profiles, and refill them in one click",
  "permissions": ["activeTab", "scripting", "tabs", "storage"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["form-matcher.js", "content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ]
}
```

| Permission         | Lý do                                        |
| ------------------ | -------------------------------------------- |
| `activeTab`        | Đọc URL của tab hiện tại                     |
| `scripting`        | Inject script capture/apply                  |
| `tabs`             | Lấy active tab, gửi message, mở options page |
| `storage`          | Lưu form record, profile, settings           |
| `host_permissions` | Chạy trên mọi http/https site user chỉ định  |

Không xin: `cookies`, `webRequest`, `browsingData`, `downloads` (export dùng `Blob` + anchor click).

## 12. Technical components

## 12.1. File structure

```text
extension/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
├── options.html
├── options.js
├── modules/
│   ├── form-scanner.js        // capture form/field từ DOM
│   ├── field-selector.js      // sinh selector ổn định
│   ├── label-resolver.js      // detect label
│   ├── form-matcher.js        // domain/path pattern + form key matching
│   ├── apply-engine.js        // resolve field + set value + dispatch event
│   ├── storage-repository.js  // CRUD form/profile/settings
│   └── exporter.js            // export/import JSON
├── icons/
└── styles/
    ├── popup.css
    └── options.css
```

## 12.2. `background.js`

- Nhận message từ popup/options/content.
- Điều phối capture: inject scanner, nhận snapshot, lưu form record, mở options page kèm `?formId=`.
- Điều phối apply: đọc profile, inject apply engine, trả report.
- Auto-apply: listen `chrome.tabs.onUpdated` (status `complete`), tìm form match, apply default profile nếu `autoApplyOnLoad`.
- Không giữ state lâu trong memory (service worker có thể bị kill) — mọi state nằm ở storage.

## 12.3. `content.js`

- Đếm nhanh số form/field để popup hiển thị.
- Chạy scanner khi được yêu cầu.
- Không tự động đọc value user đang nhập.
- Không gửi dữ liệu đi đâu ngoài background của extension.

## 12.4. `popup.js`

- Lấy active tab, hostname, pathname.
- Hỏi background danh sách form/profile match URL hiện tại.
- Render radio list profile, nút apply, nút capture, nút undo.
- Hiển thị report sau apply.

## 12.5. `options.js`

- Danh sách site → form → profile.
- Profile editor: render form snapshot thành form thật để user điền.
- Edit `domainPattern` / `pathPattern` với validate + preview host mẫu.
- Re-capture, duplicate, rename, delete, set default.
- Export/import, settings.

## 13. Main flows

## 13.1. Capture flow

1. User đang ở `https://example.com/register`.
2. Click icon extension → popup.
3. Click `Capture form on this page`.
4. Background inject `form-scanner.js` vào tab (all frames same-origin).
5. Scanner trả snapshot mỗi form.
6. Nếu page có nhiều form → popup hiện danh sách để user chọn form nào cần lưu:

   ```text
   Forms detected:
   (x) Register form      12 fields   form#register
   ( ) Newsletter form     1 field    form.footer-subscribe
   ( ) Fields outside form 3 fields   __orphan__

   [Continue]
   ```

7. Tạo form record: `domainPattern = *.example.*`, `pathPattern = /register`.
8. Mở options page tại profile editor: `options.html?formId=...&new=1`.

Message:

```text
Form captured.
12 fields (1 excluded: password)
Opening profile editor...
```

## 13.2. Fill & save flow

1. Options page render từng field theo `kind`/`type` với label đã detect.
2. User điền câu trả lời.
3. User đặt `Profile name`, tick `Set as default` nếu muốn.
4. Click `Save profile` → tạo profile record.
5. Có thể click `Save & apply to tab` để lưu và apply ngay vào tab vừa capture.

## 13.3. Apply flow

1. User quay lại `https://example.com/register`.
2. Mở popup → popup thấy form match (mục 7.3) và list profile.
3. User chọn profile → click `Apply selected profile`.
4. Apply engine chạy (mục 9).
5. Popup hiện report.

## 13.4. Auto-apply flow

1. `autoApplyOnLoad` bật và form có `autoApply: true` + `defaultProfileId`.
2. Tab load xong (`status === 'complete'`).
3. Background tìm form match URL.
4. Apply default profile, hiển thị badge số field đã điền trên icon extension.
5. Không submit, không click gì khác.

Nếu nhiều form match cùng lúc → chỉ auto-apply form đứng đầu theo thứ tự ưu tiên 7.3.

## 13.5. Re-capture flow (form đổi cấu trúc)

1. User click `Re-capture` từ popup hoặc options.
2. Scanner chạy lại, sinh snapshot mới.
3. Merge field theo `name` → `id` → `labelText` → `domIndex`:
   - Field còn tồn tại: giữ `fieldId` cũ → profile không mất câu trả lời, chỉ update selector/options.
   - Field mới: thêm `fieldId` mới, value trống trong mọi profile.
   - Field không còn: giữ trong record với `removed: true`, value vẫn nằm trong profile nhưng bị skip khi apply.
4. Options page hiện diff:

   ```text
   Re-capture result

   Unchanged: 10
   Updated selector: 2
   New fields: 1
     - Referral code
   Removed fields: 1
     - Fax number

   [Apply changes] [Cancel]
   ```

## 14. Export / Import

## 14.1. Export

- Export toàn bộ hoặc theo site/form.
- File `form-fill-profiles.json` theo format mục 8.4.
- Password field: nếu profile có chứa (do user bật), export hiện confirm cảnh báo file sẽ chứa plain text.

## 14.2. Import

- Validate `version`, schema của `forms`/`profiles`.
- Sinh lại `id` để tránh trùng, giữ liên kết `formId` trong profile.
- Conflict theo `formKey` + `domainPattern` + `pathPattern`: hỏi user `Skip` / `Merge profiles` / `Replace`.
- Import lỗi thì rollback, không ghi một phần.

## 15. Error handling

### 15.1. Unsupported page

`chrome://`, `edge://`, `about:`, `devtools://`, Chrome Web Store → popup hiện message không hỗ trợ, disable nút capture/apply.

### 15.2. No form found

```text
No form field found on this page.
The form may render later — try again after the page finishes loading.
```

### 15.3. Field not found khi apply

Report liệt kê từng field, kèm reason:

```text
Not found (2)
- Referral code   (selector no longer matches)
- Country         (option "vn" missing)

[Re-capture form]
```

### 15.4. Injection bị chặn

Page có CSP chặn hoặc là restricted URL:

```text
Cannot access this page.
Please check extension permission for this site.
```

### 15.5. Invalid pattern

Validate khi user sửa pattern:

- Domain pattern rỗng → lỗi.
- Nhiều hơn 2 dấu `*` → lỗi.
- `*` nằm giữa label (`ex*ple.com`) → lỗi, chỉ hỗ trợ `*.` prefix và `.*` suffix.
- Path pattern không bắt đầu bằng `/` và không phải `*` → lỗi.

### 15.6. Storage quota

`chrome.storage.local` gần đầy → cảnh báo và gợi ý export + xoá profile cũ.

## 16. Security & privacy

Extension không được:

- Gửi form snapshot hoặc profile ra bất kỳ server nào.
- Lưu cookie/token/session của website.
- Capture password/OTP/CVV khi user chưa bật explicit.
- Auto-submit khi user chưa bật explicit.
- Click element ngoài mục đích set value field (trừ `click` trên checkbox/radio).
- Đọc field của page khi user chưa bấm capture.
- Apply profile của domain A sang domain B khi pattern không match.

Cảnh báo phải hiển thị rõ:

- Dữ liệu profile lưu **plain text** trong `chrome.storage.local`, không mã hoá.
- Ai có quyền truy cập profile Chrome đó đều đọc được.
- Không nên dùng cho dữ liệu thật của người dùng cuối (PII, thẻ, mật khẩu thật).

## 17. Performance requirements

- Capture 1 page phải xong nhanh, không block main thread quá lâu; scan giới hạn 500 field/form.
- Chỉ query DOM 1 lần cho toàn bộ field, không query lại từng field.
- `MutationObserver` khi retry phải debounce và tự disconnect khi hết `retryWindowMs`.
- Popup chỉ load form/profile match URL hiện tại, không load toàn bộ storage.
- Options page paginate/virtual list khi nhiều form.
- Auto-apply chỉ chạy 1 lần cho mỗi lần navigate, không chạy lại khi chỉ đổi hash.

## 18. Acceptance criteria

### AC-01: Capture form ở path hiện tại

Khi user ở `https://example.com/register` và bấm `Capture form on this page`, extension đọc được toàn bộ input/textarea/select/radio/checkbox của form và mở options page ở chế độ profile editor.

### AC-02: Capture field ngoài `<form>`

Page có input không nằm trong thẻ `<form>` → các field đó vẫn được capture dưới pseudo-form `__orphan__`.

### AC-03: Label detection

Field có `<label for>` hoặc `aria-label` hoặc `placeholder` → profile editor hiển thị đúng label đó thay vì `name` thô.

### AC-04: Lưu profile

User điền form trong options page, đặt tên và bấm `Save profile` → profile được lưu và xuất hiện trong popup khi mở lại path đó.

### AC-05: Apply profile

Khi user quay lại `https://example.com/register`, chọn profile và bấm apply → toàn bộ field text/select/radio/checkbox được điền đúng giá trị đã lưu.

### AC-06: React/Vue nhận được value

Sau apply, form dùng React controlled input vẫn giữ giá trị (không bị reset khi blur) và validation của form nhận được value.

### AC-07: Nhiều profile

Một form có 3 profile → popup hiển thị đủ 3, apply đúng profile được chọn.

### AC-08: Domain pattern `*.example.*`

Form lưu với `domainPattern = *.example.*` và `pathPattern = /register`:

- Match: `example.com/register`, `dev.example.vn/register`, `www.example.io/register`.
- Không match: `example.com/login`, `another.com/register`.

### AC-09: Path pattern prefix

`pathPattern = /register/*` match `/register/step-1` và `/register/step-2`, không match `/login`.

### AC-10: Không auto-submit

Sau apply, form không được submit khi `submitAfterApply` chưa bật.

### AC-11: Password bị loại trừ mặc định

Form có `input[type=password]` → field đó xuất hiện trong snapshot với `excluded: true`, không có value nào được lưu, và apply bỏ qua nó với reason rõ ràng.

### AC-12: Report apply

Sau apply, popup hiển thị số field đã điền, không tìm thấy và bị skip, kèm tên field cụ thể.

### AC-13: Re-capture giữ câu trả lời

Form thêm 1 field và bỏ 1 field, sau `Re-capture` → các field cũ vẫn giữ nguyên câu trả lời trong mọi profile.

### AC-14: Dynamic form

Form render sau 1 giây → với `retryDynamicForms` bật, extension vẫn điền được field xuất hiện muộn trong `retryWindowMs`.

### AC-15: Undo

Sau apply, bấm `Undo` (chưa reload tab) → field trở về giá trị trước khi apply.

### AC-16: Export/import

Export ra JSON rồi import lại trên profile Chrome khác → form và profile hoạt động như cũ.

### AC-17: Unsupported page

User đang ở `chrome://extensions` → extension không capture/apply và hiển thị message không hỗ trợ.

### AC-18: No data leaves the browser

Extension không tạo bất kỳ network request nào ra ngoài.

## 19. MVP

Version đầu cần có:

- Popup: hiện path hiện tại, form match, list profile, apply, capture.
- Capture form + field ngoài form, label detection, selector strategy.
- Options page: list form, profile editor, edit pattern, delete, set default.
- Apply engine: text/textarea/select/radio/checkbox + native setter + dispatch event.
- Domain pattern: exact, `*.domain.com`, `domain.*`, `*.domain.*`.
- Path pattern: exact + prefix `*`.
- Nhiều profile / form, default profile.
- Report kết quả apply.
- Loại trừ password/file/hidden mặc định.
- Export/import JSON.
- Settings cơ bản.

Chưa cần trong MVP:

- Auto-apply on load (làm ở 1.1).
- Undo (làm ở 1.1).
- Re-capture diff UI (MVP có thể chỉ overwrite + cảnh báo).
- Contenteditable.
- iframe.

## 20. Future improvements

- Keyboard shortcut apply default profile (`chrome.commands`).
- Context menu: `Fill this form with…`.
- Mã hoá profile bằng passphrase.
- Template value: `{{random_email}}`, `{{today}}`, `{{uuid}}`, `{{counter}}`.
- Sequence: apply nhiều form theo từng step của wizard.
- Ghi nhận giá trị user tự nhập để gợi ý tạo profile ("Save what I just typed").
- Nhận diện form giống nhau giữa các site (cùng field set) để tái dùng profile.
- Fill từ CSV row → chạy nhiều case liên tiếp.
- Diff giữa profile và giá trị đang có trên form.
- Support Firefox.
- Tag/tìm kiếm profile.
- Chia sẻ profile qua link/QR (không kèm dữ liệu nhạy cảm).
