# Nội dung Chrome Web Store

## Tên

GoFood VietQR Helper

## Mô tả ngắn

Tự tạo VietQR theo hóa đơn MShopKeeper, điền nội dung chuyển khoản và đồng bộ mã hóa đơn để tra soát.

## Mô tả chi tiết

GoFood VietQR Helper hỗ trợ quy trình thu ngân trên các website `*.mshopkeeper.vn`.

Tính năng chính:

- Tự lấy số tiền chuyển khoản hoặc số tiền còn phải thu của hóa đơn hiện tại.
- Tạo ảnh VietQR theo chi nhánh nhận tiền đã chọn.
- Tự sinh và điền mã chuyển khoản duy nhất vào phần ghi chú.
- Giữ QR riêng cho từng tab hóa đơn.
- Đồng bộ RefNo, số tiền và phương thức thanh toán về hệ thống GoFood để kế toán tra soát.
- Không tự chọn tài khoản ngân hàng khi mới cài đặt.

Extension chỉ hoạt động trên MShopKeeper và chỉ kết nối tới API GoFood cùng dịch vụ ảnh VietQR cần thiết.

## Mục đích duy nhất

Tự động tạo thông tin thanh toán VietQR và đồng bộ dữ liệu đối soát cho hóa đơn MShopKeeper.

## Giải trình quyền

### storage

Lưu chi nhánh nhận tiền đã chọn, cấu hình chi nhánh đã tải và trạng thái đồng bộ gần nhất để extension hoạt động ổn định giữa các lần mở trình duyệt.

### Quyền truy cập `*.mshopkeeper.vn`

Đọc số tiền, phương thức thanh toán và phản hồi lưu hóa đơn; điền mã chuyển khoản; hiển thị QR trong giao diện bán hàng.

### Quyền truy cập `gofood.dewa.vn`

Tải cấu hình chi nhánh/ngân hàng và gửi dữ liệu hóa đơn phục vụ tra soát.

### Quyền truy cập `img.vietqr.io`

Tải ảnh VietQR chứa số tiền và nội dung chuyển khoản của hóa đơn.

## Khai báo dữ liệu

Extension xử lý và gửi về hệ thống GoFood các dữ liệu cần cho đối soát: RefNo hóa đơn, mã chuyển khoản, số tiền, phương thức thanh toán, chi nhánh/ngân hàng nhận tiền, URL nguồn và thời điểm thao tác.

Dữ liệu không được bán, không dùng cho quảng cáo và không chuyển cho bên thứ ba ngoài các dịch vụ cần thiết để tạo QR và vận hành đối soát.

## Privacy policy URL

Đăng file `privacy-policy.html` lên:

`https://gofood.dewa.vn/privacy-policy`
