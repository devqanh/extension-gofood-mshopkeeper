# Chrome Web Store assets

- `promo-small-440x280.png`: ảnh quảng bá nhỏ bắt buộc.
- `promo-marquee-1400x560.png`: ảnh marquee tùy chọn.
- `screenshot-01-vietqr-1280x800.png`: screenshot tính năng bắt buộc.
- `LISTING_VI.md`: nội dung listing và giải trình quyền.
- `privacy-policy.html`: nội dung cần đăng công khai tại URL Privacy policy.

Icon nằm trong `assets/icons` và được khai báo trực tiếp trong `manifest.json`.

Tạo lại icon và promo:

```powershell
python tools/build_store_assets.py
```

Đóng gói extension:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-store-package.ps1
```
