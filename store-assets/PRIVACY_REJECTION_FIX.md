# Khắc phục từ chối Purple Nickel

## Nguyên nhân lần từ chối ngày 09/07/2026

Chrome Web Store báo URL trong trường Privacy Policy không dẫn trực tiếp tới một chính sách quyền riêng tư hợp lệ. Trang chủ hoặc trang giới thiệu chủ sở hữu không được chấp nhận thay cho policy.

## Việc cần làm trước khi gửi lại

1. Đưa file `privacy-policy.html` lên thư mục public của website.
2. Đảm bảo URL sau mở công khai, không cần đăng nhập và trả về HTTP 200:

   `https://gofood.dewa.vn/privacy-policy.html`

3. Dán đúng URL trên vào trường Privacy Policy trong tab Quyền riêng tư của Chrome Web Store.
4. Thay phần mô tả Store bằng nội dung trong `LISTING_VI.md`, đặc biệt giữ nguyên đoạn “Thông báo về dữ liệu”.
5. Upload gói extension phiên bản mới. Lần đầu mở popup, reviewer phải nhìn thấy thông báo dữ liệu và nút “Đồng ý và tiếp tục”.
6. Chỉ gửi xét duyệt sau khi kiểm tra URL policy bằng cửa sổ ẩn danh.

## Khai báo dữ liệu trên Dashboard

Chọn các nhóm dữ liệu:

- Thông tin tài chính và thanh toán.
- Nội dung trang web.

Không cần chọn lịch sử web cho phiên bản mới vì extension không còn gửi URL trang nguồn về API.

Chọn “Không, tôi hiện không sử dụng mã từ xa”. Toàn bộ JavaScript được đóng gói trong extension; API JSON và ảnh QR là dữ liệu, không phải mã thực thi.
