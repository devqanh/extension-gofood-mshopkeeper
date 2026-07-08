# GoFood VietQR Helper

Extension Chrome này tự tạo ảnh VietQR trên các site `*.mshopkeeper.vn`, tự điền nội dung chuyển khoản vào ô `Ghi chú ...`, và append ảnh QR vào đúng khung thanh toán của tab mua hàng hiện tại.

## Cấu hình PHP

1. Sửa thông tin tài khoản trong `api/config.php`.
2. Upload thư mục `api` lên hosting có PHP.
3. Endpoint cần nhập vào extension là file `banks.php`, ví dụ:

```text
https://ten-mien-cua-ban.vn/gofood-vietqr/banks.php
```

Mẫu cấu hình một tài khoản:

```php
[
    'id' => 'vcb-main',
    'label' => 'Vietcombank - tài khoản chính',
    'bank_id' => '970436',
    'account_no' => '0123456789',
    'account_name' => 'TÊN CHỦ TÀI KHOẢN',
    'template' => 'compact2',
    'active' => true,
]
```

`bank_id` có thể là mã BIN, code ngân hàng, hoặc tên ngân hàng mà VietQR hỗ trợ. Nếu cần xem danh sách ngân hàng, dùng API công khai:

```text
https://api.vietqr.io/v2/banks
```

## Cài extension

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Bấm `Load unpacked`.
4. Chọn thư mục gốc của project này.
5. Bấm icon `GoFood VietQR` trên thanh công cụ, nhập `API URL PHP`, bấm `Tải API`, chọn ngân hàng mặc định, rồi bấm `Lưu`.

## Sử dụng

1. Mở một site bán hàng thuộc `*.mshopkeeper.vn`.
2. Khi khung thanh toán xuất hiện, extension tự sinh ghi chú chuyển khoản, tự điền vào ô `Ghi chú ...`, và tự hiện QR trong khung thanh toán của tab đang mở.
3. Extension sẽ ưu tiên lấy số tiền từ dòng `Còn phải thu`, ví dụ `545,000`.
4. Trong block QR chỉ có ảnh QR và nút `Đổi nội dung`.

Extension sẽ:

- Tạo nội dung chuyển khoản dạng `GOFOODYYMMDDHHMMSS`, ví dụ `GOFOOD260708133911`.
- Tự điền nội dung chuyển khoản và tự hiện QR khi load trang, khi đổi tab hóa đơn, hoặc khi thêm order mới.
- Lấy số tiền từ dòng `Còn phải thu` trong tab bán hàng hiện tại.
- Fill nội dung đó vào textarea có placeholder `Ghi chú ...`.
- Hiện ảnh QR từ Quick Link của VietQR ngay trong div thanh toán `.overflow-auto.flex-1`.

QR được append riêng vào div thanh toán của từng tab mua hàng, nên chuyển qua tab khác sẽ không bị lẫn QR/nội dung của tab trước. Block trên trang được rút gọn chỉ còn ảnh QR và nút đổi nội dung. Nếu cần đổi ngân hàng mặc định, bấm icon extension trên thanh công cụ Chrome.

Khi bấm nút thêm order có icon `.misa-add-order`, extension sẽ tự xoá block QR đang có để order mới không bị dính QR của order trước.

Khi click qua lại các tab hóa đơn `.q-tab`, extension sẽ tự dựng lại QR cho tab đang active nếu ghi chú của tab đó vẫn là nội dung chuyển khoản do extension tạo, ví dụ bắt đầu bằng `GOFOOD`.
Nếu người dùng nhập thêm nội dung sau mã chuẩn, ví dụ `GOFOOD260708133911 ghi chú thêm`, VietQR chỉ dùng `GOFOOD260708133911` và bỏ qua phần phía sau.
Để tránh trùng mã khi tạo nhiều hóa đơn quá nhanh, nếu mã `YYMMDDHHMMSS` hiện tại đã được dùng trong các ô ghi chú đang mở hoặc trong phiên hiện tại, extension tự nhích sang giây kế tiếp chưa dùng.
Block QR có thêm dòng lưu ý không xoá mã `GOFOOD...` trong mục ghi chú để kế toán tra soát dữ liệu.

## Bắt response lưu tạm

Extension inject `src/page-hook.js` vào page context để bắt response của endpoint:

```text
/SAInvoice/save-sync
```

Khi hệ thống gọi API này, ví dụ sau khi bấm `Lưu tạm (F10)`, extension đọc được JSON response như `Code`, `Success`, `Data.RefNo`. Response cuối cùng được lưu vào `chrome.storage.local.lastSaveSyncResponse`, đồng thời log ra Console với prefix `[GoFood VietQR]`.

Từ bản `1.0.2`, extension bắt đúng endpoint:

```text
/salecloud/uploadg2/SAInvoice/save-sync
```

Khi response có dạng:

```json
{
  "Code": 200,
  "Data": {
    "RefNo": "2607010019"
  },
  "Total": 0,
  "Success": true,
  "OtherData": []
}
```

extension sẽ lấy `Data.RefNo`, ghép với nội dung chuyển khoản đang có trong ghi chú, ví dụ `GOFOOD260708154412`, rồi gửi về API PHP:

```text
POST /invoice-refs.php
```

Endpoint này lưu mapping `RefNo` ↔ `transferNote` vào `api/data/invoice-refs.json`. Hosting cần cấp quyền ghi cho thư mục `api` hoặc thư mục `api/data`.

Xem danh sách có phân trang:

```text
GET /invoice-refs.php?page=1&perPage=20
GET /invoice-refs.php?page=1&perPage=20&q=GOFOOD260708154412
```

Popup extension cũng có khung `RefNo đã lưu` để tải nhanh danh sách này.

Tạm thời extension đang gửi JSON bắt được lên Webhook.site bằng background service worker để tránh lỗi CORS/preflight:

```text
POST https://webhook.site/c2a8e0a2-afb7-4423-83f0-27c5a7c2c97a
```

Payload gồm `refNo`, `transferNote`, `receivableAmount`, các dòng `paymentMethods`, tổng chuyển khoản, tổng tiền mặt và thời điểm post.

## Ghi chú VietQR

Quick Link đang được tạo theo mẫu:

```text
https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=<AMOUNT>&addInfo=<DESCRIPTION>&accountName=<ACCOUNT_NAME>
```

VietQR giới hạn `addInfo`, nên extension tự bỏ dấu tiếng Việt, bỏ ký tự đặc biệt và cắt nội dung chuyển khoản tối đa 50 ký tự.
