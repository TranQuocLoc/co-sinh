# Hướng dẫn Build File EXE

## Yêu cầu
Bạn cần cài đặt **Node.js** trước khi build.

### Bước 1: Cài đặt Node.js
1. Tải Node.js từ: https://nodejs.org/
2. Chọn phiên bản **LTS** (khuyên dùng)
3. Cài đặt và khởi động lại terminal

### Bước 2: Build game
Mở **Command Prompt** hoặc **PowerShell** tại thư mục game và chạy:

```bash
cd "c:\Users\Hi\Downloads\game rehab\balloon-game"
npm install
npm run build
```

### Bước 3: Lấy file EXE
Sau khi build xong, file `BalloonAdventure.exe` sẽ nằm trong thư mục `dist/`

---

## Chạy game mà không cần build
Nếu không muốn build EXE, bạn có thể:
1. Mở file `index.html` trực tiếp bằng trình duyệt (Chrome, Edge, Firefox)
2. Game sẽ chạy ngay trong trình duyệt

---

## Điều khiển
- **← →** hoặc **A D**: Di chuyển trái/phải
- **P** hoặc **ESC**: Tạm dừng game
