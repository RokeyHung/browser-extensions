# Browser Extensions

Bộ bảy extension Chrome (Manifest V3) viết bằng JavaScript thuần — không build step, không framework, không dependency. Thư mục `extension/` của mỗi cái chính là thứ trình duyệt nạp vào.

Mỗi extension làm đúng một việc, chạy hoàn toàn cục bộ: không có backend, không gửi dữ liệu đi đâu. Rule, profile, snapshot đều nằm trong `chrome.storage` của chính trình duyệt.

## Danh sách

| Extension                          | Thư mục                                            | Làm gì                                                     |
| ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| **Element Filter** `1.1.0`         | [block-elements-webpage/](block-elements-webpage/) | Ẩn vĩnh viễn phần tử phiền phức trên một website           |
| **Clean Site Data** `1.3.0`        | [clean-site-data/](clean-site-data/)               | Xoá sạch dữ liệu cục bộ của site đang mở                   |
| **Form Fill Profiles** `1.0.1`     | [form-fill-profiles/](form-fill-profiles/)         | Lưu bộ câu trả lời cho form và điền lại bằng một cú bấm    |
| **Full Page Capture** `1.2.2`      | [full-page-capture/](full-page-capture/)           | Chụp trọn trang, hết chiều dài, đúng độ phân giải màn hình |
| **Popup Redirect Guard** `1.1.0`   | [popup-redirect-guard/](popup-redirect-guard/)     | Chặn site tự mở tab, popup, pop-under và redirect          |
| **Website Path Discovery** `1.0.1` | [site-path-discovery/](site-path-discovery/)       | Dò ra path, API endpoint và asset của website đang xem     |
| **Storage Explorer** `1.0.1`       | [storage-explorer/](storage-explorer/)             | Xem, sửa, snapshot toàn bộ client-side storage             |

## Cài đặt

Chưa cái nào lên Chrome Web Store; nạp thủ công:

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `<tên-extension>/extension`

## Tài liệu

Mỗi extension có `docs/spec.md` — spec đánh số mục, là nguồn sự thật cho hành vi và cũng là nơi ghi lại lý do của từng quyết định — cùng `CHANGELOG.md` theo [Keep a Changelog](https://keepachangelog.com/) và [SemVer](https://semver.org/).

## Phát triển

```bash
make help                 # liệt kê target
make format               # Prettier cho toàn repo (bản ghim 3.4.2, chạy qua npx)
make check                # kiểm tra format + kiểm tra bản sao domain-suffix
make sync-domain-suffix   # đồng bộ shared/domain-suffix.js vào các bản sao
```

Extension chỉ nạp được file nằm trong thư mục của chính nó, nên phần suy ra registrable domain (eTLD+1) trong [shared/domain-suffix.js](shared/domain-suffix.js) được **chép** sang từng extension. Sửa ở file gốc rồi chạy `make sync-domain-suffix`; đừng sửa bản sao — `make check` sẽ báo lỗi khi chúng lệch nhau.

Icon là ảnh sinh ra, không vẽ tay: `cd <extension>/extension && node generate-icons.js`.

Hướng dẫn chi tiết hơn cho người (và agent) mới vào repo nằm ở [CLAUDE.md](CLAUDE.md).
