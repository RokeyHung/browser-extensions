# Changelog

Tất cả thay đổi đáng chú ý của extension **Link Param Cleaner** được ghi lại ở file này.

Định dạng theo [Keep a Changelog](https://keepachangelog.com/), version theo [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-17

### Added

- **Xoá query param theo dõi khỏi link trước khi nó mở sang site khác.** Việc xoá do Chrome làm ở tầng mạng bằng một dynamic rule của `declarativeNetRequest` (`redirect` + `queryTransform.removeParams`), nên URL bẩn **không bao giờ rời khỏi máy**: đo bằng server fixture, sau khi tick `fbclid` thì request duy nhất tới `site-b.test` là `GET /landing?id=1`, không có `fbclid` trong log của server chứ không chỉ vắng mặt trên address bar.
- **Theo dõi theo site nguồn.** Popup thêm site đang mở vào watch list; rule dùng `initiatorDomains: [site]` + `excludedRequestDomains: [site]`, tức chỉ áp dụng cho navigation **rời khỏi** site đó. Đi trong cùng registrable domain không bị chạm: từ `site-a.test` sang `sub.site-a.test?fbclid=abc123` → URL còn nguyên.
- **Tự động thu thập param.** Mỗi navigation ra ngoài được ghi lại tên param kèm số lần thấy, host đích gần nhất và nhãn gợi ý (`tracking` / `may be needed`) từ `modules/param-catalog.js`.
- **Checkbox chọn param cần xoá, mặc định không xoá gì.** Thêm site vào watch list chỉ bật thu thập: đo ngay sau khi watch, `getDynamicRules()` trả về `[]` và link `?fbclid=abc123&id=1` mở ra nguyên vẹn. Chỉ khi tick mới có rule.
- **Quản lý theo từng website** ở trang options: danh sách site bên trái, bảng param bên phải với search, `Select all` / `Clear all` / `Select all tracking` / chọn theo tiền tố, thêm param thủ công, `Ignore` để im lặng một param mà không xoá record.
- **Export/import JSON** toàn bộ cấu hình, chế độ `Merge` hoặc `Replace`. Round-trip đo được: export → xoá sạch → import `Replace` → trạng thái tick và số rule khớp bản gốc.
- **Activity log** (mặc định 200 dòng, tắt/xoá được) và badge đếm số param đã xoá trên tab hiện tại.
- Icon mắt xích đứt sinh bằng `generate-icons.js` (chỉ dùng built-in của Node) từ hình học của `icons/link-broken-source.svg` (nguồn: SVG Repo), sample 4×4 mỗi pixel. Bản 16px bỏ ba tia văng và thu khung lại quanh riêng mắt xích — giữ nguyên khung thì tia chiếm chỗ mà không vẽ gì, mắt xích bị co nhỏ hơn mức cần.

### Notes

Bốn điều phải chạy thật mới biết, đo trên Chrome for Testing 153.0.8010.47 với hai domain giả qua `--host-resolver-rules`:

- **`removeParams` phân biệt hoa thường.** Với `fbclid` đang tick, `?FBCLID=upper&fbclid=lower&id=4` mở ra thành `?FBCLID=upper&id=4`. Vì vậy collector giữ nguyên dạng chữ đã quan sát và để hai biến thể là hai dòng riêng; chỉ phần gắn nhãn mới hạ chữ thường (spec §6.3).
- **Không có vòng lặp redirect khi rule khớp mà không có gì để xoá.** Link sang `?id=9` (không param nào bị tick) mở bình thường, server ghi nhận đúng một request. Chrome bỏ qua redirect trỏ về chính URL đang request, nên không cần tách rule theo từng param (spec §6.5).
- **`onBeforeNavigate` thấy URL gốc trước khi DNR redirect** — đó là điều kiện để thu thập được param mới trên URL mà rule đã động vào. Bằng chứng: log ghi `removed: ["fbclid"], kept: ["id"]`, thứ chỉ suy ra được khi extension nhìn thấy cả hai URL. Redirect sinh thêm một `onBeforeNavigate` thứ hai cho URL đã sạch, nên bản ghi pending không cho ghi đè khi URL mới cùng origin + path (spec §7.1).
- **Param trùng tên trong một URL bị xoá hết và đếm là một.** `?fbclid=one&fbclid=two&id=5` → `?id=5`, `seen` đi từ 5 lên 6.

Những lựa chọn hình dạng đáng nói:

- **Không có content script.** Cách hiển nhiên hơn — bắt `click` rồi sửa `href` — chỉ thấy thẻ `<a>` và thua khi trang tự viết lại link lúc `mousedown`. Cái giá phải trả, nói rõ để sau này không ai tưởng là bug: link lúc hover và _Copy link address_ vẫn là link bẩn, chỉ URL **thực sự được mở** mới sạch (spec §5.2).
- **POST không bị đụng tới** (`requestMethods: ["get"]`): redirect một POST sẽ biến nó thành GET và mất body. Đo: form POST sang `site-b.test` tới nơi với `payload=keep-me&fbclid=abc123` nguyên vẹn. Form **GET** thì vẫn được dọn — `?q=shoes&fbclid=abc123` mở ra thành `?q=shoes`.
- **Navigation do trình duyệt khởi tạo không bị đụng tới.** Gõ/dán URL vào omnibox không có initiator nên rule không khớp: `site-b.test/landing?fbclid=abc123` mở nguyên vẹn, và param cũng không được tính thêm lần thấy nào, vì `onCommitted` chỉ nhận `transitionType` `link` / `form_submit` và loại qualifier `from_address_bar` (spec §7.3).
- **Site nguồn đọc thẳng từ tab, không giữ map trong bộ nhớ.** Tại `onBeforeNavigate`, `tab.url` vẫn là trang đang rời đi; tab mới do `target="_blank"` thì tra `openerTabId`. MV3 hay tắt worker đúng vào lúc navigation xảy ra — map chết theo worker, tab thì không. Đo: link `target="_blank"` mở tab mới ở `?id=3`, `fbclid` đã bị xoá.
- **Chỉ nhận registrable domain làm site pattern**, khác với ba extension kia trong repo (vốn hỗ trợ `site.*`): `initiatorDomains` chỉ nhận danh sách domain cụ thể, nên `facebook.*` sẽ phải liệt kê từng TLD — một hình dạng hứa hơn thứ nó làm được (spec §8).
- **Giá trị param mặc định không lưu**, và file export không chứa log, `sourceUrl`, `sample` hay `lastTargetHost`. Query string là nơi hay lọt token, email, từ khoá tìm kiếm; thứ đáng chia sẻ là cấu hình, không phải lịch sử duyệt web. Đo: `JSON.stringify(exportConfig())` không khớp trường nào trong số đó (spec §16).
- Xác nhận khi tick một param `functional` ở popup là một dòng **inline**, không phải `window.confirm`: dialog lấy focus khỏi popup của browser action thì popup đóng lại, mang theo cả câu trả lời.

Kiểm chứng end-to-end trên Chrome for Testing 153 với hai harness: một chạy qua service worker để đo hành vi mạng (25 phép đo ở trên), một **bấm vào UI thật** — popup mở bằng `chrome.action.openPopup()` rồi bấm `Watch this site`, tick checkbox, bấm `Keep it` ở thanh xác nhận; trang options thêm site `https://www.example.co.uk/some/path` (được rút về `example.co.uk` kèm thông báo đã rút), thêm param tay, `Select all tracking`, đổi setting. Không có lỗi JS ở cả hai trang, và mỗi thao tác được đối chiếu với `getDynamicRules()` ngay sau đó.

Harness: Chrome for Testing 153 nạp extension bằng `--load-extension` **kèm** `--disable-features=DisableLoadExtensionCommandLineSwitch` — thiếu cờ sau thì Chrome 153 nhận thư mục nhưng không bật extension, và mọi trang `chrome-extension://` trả `ERR_BLOCKED_BY_CLIENT`. `Extensions.loadUnpacked` qua CDP trả về id nhưng extension không hề xuất hiện trong `chrome://extensions`.
