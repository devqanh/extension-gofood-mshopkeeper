# GoFood VietQR Helper

Extension Chrome này tự tạo ảnh VietQR trên các site `*.mshopkeeper.vn`, tự điền nội dung chuyển khoản vào ô `Ghi chú ...`, append ảnh QR vào đúng khung thanh toán của tab mua hàng hiện tại, và đồng bộ RefNo hóa đơn về API GoFood Misa.

Endpoint API hiện được cấu hình cố định trong `src/api-config.js`:

```text
http://localhost:8222
```

Sau này đổi domain thật thì sửa `baseUrl` trong file này.

## Cấu hình API

Extension đang tích hợp API GoFood Misa theo `C:\laragon\www\gofood-misa\API.MD`:

```text
GET  /api/branches
POST /api/transactions/sync
```

`GET /api/branches` trả danh sách chi nhánh gồm `id`, `name`, `bank_bin`, `bank_name`, `account_name`, `account_number`, `transfer_prefix`. Extension dùng dữ liệu này để chọn chi nhánh, tạo QR VietQR và sinh prefix nội dung chuyển khoản.

`POST /api/transactions/sync` nhận payload sau khi MShopKeeper trả `Data.RefNo` từ endpoint `save-sync`.

## Cài extension

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Bấm `Load unpacked`.
4. Chọn thư mục gốc của project này.
5. Bấm icon `GoFood VietQR` trên thanh công cụ, bấm `Tải chi nhánh`, chọn chi nhánh mặc định, rồi bấm `Lưu`.

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
Block QR có thêm dòng lưu ý không xoá mã chuyển khoản trong mục ghi chú để kế toán tra soát dữ liệu.

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

extension sẽ lấy `Data.RefNo`, ghép với nội dung chuyển khoản đang có trong ghi chú, ví dụ `GOFOOD260708154412`, rồi gửi về API:

```text
POST http://localhost:8222/api/transactions/sync
```

Extension tự tải danh sách chi nhánh từ:

```text
GET http://localhost:8222/api/branches
```

Payload gồm `refNo`, `transferNote`, `receivableAmount`, các dòng `paymentMethods`, tổng chuyển khoản, tổng tiền mặt, thông tin chi nhánh/ngân hàng và thời điểm post.

## Ghi chú VietQR

Quick Link đang được tạo theo mẫu:

```text
https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=<AMOUNT>&addInfo=<DESCRIPTION>&accountName=<ACCOUNT_NAME>
```

VietQR giới hạn `addInfo`, nên extension tự bỏ dấu tiếng Việt, bỏ ký tự đặc biệt và cắt nội dung chuyển khoản tối đa 50 ký tự.
