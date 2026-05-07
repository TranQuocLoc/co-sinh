// port, reader, hardwareValue đã được khai báo ở game.js
let serialBuffer = "";
let calibStep = 0; // 0: Idle, 1: Left, 2: Right
let calibMin = parseInt(localStorage.getItem('calibMin')) || -300;
let calibMax = parseInt(localStorage.getItem('calibMax')) || 300;

async function initSerial() {
    if ('serial' in navigator) {
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });

            const menuConnectBtn = document.getElementById('menuConnectBtn');
            if(menuConnectBtn) {
                menuConnectBtn.textContent = '✅ ĐÃ KẾT NỐI MẠCH';
                menuConnectBtn.classList.add('connected');
                menuConnectBtn.style.opacity = '0.7';
                menuConnectBtn.disabled = true;
            }
            
            const setupBtn = document.getElementById('menuSafeSetupBtn');
            if(setupBtn) {
                setupBtn.style.display = 'inline-block';
            }

            document.getElementById('resetBtn').classList.remove('hidden');
            document.getElementById('connStatus').textContent = 'Đã kết nối';

            readSerial();
        } catch (err) {
            console.error('Error connecting to serial port:', err);
            alert('Lỗi kết nối: ' + err.message);
        }
    } else {
        alert('Trình duyệt không hỗ trợ Web Serial. Hãy dùng Chrome hoặc Edge.');
    }
}

async function sendCommand(cmd) {
    if (port && port.writable) {
        const writer = port.writable.getWriter();
        const data = new TextEncoder().encode(cmd);
        await writer.write(data);
        writer.releaseLock();
    }
}

function resetHardware() {
    sendCommand('R'); // Gửi lệnh Reset về 0 cho Arduino
}

function beginSafetySetup() {
    alert("Vui lòng YÊU CẦU BỆNH NHÂN để tay hoàn toàn thoải mái ở vị trí CHÍNH GIỮA (0 độ) rồi nhấn OK.");
    // Reset Hardware to set current position as 0
    resetHardware();
    
    // Hide this button, show the safety menu
    document.getElementById('menuSafeSetupBtn').style.display = 'none';
    document.getElementById('safetyMenu').style.display = 'block';
}

async function confirmSafetyAndTest() {
    let limitLeft = parseInt(document.getElementById('limitLeft').value) || -73;
    let limitRight = parseInt(document.getElementById('limitRight').value) || 30;
    
    // Ép cứng chống nhập bậy bạ vượt khung phần cứng
    if (limitLeft < -73) limitLeft = -73;
    if (limitLeft > 0) limitLeft = 0;
    if (limitRight > 30) limitRight = 30;
    if (limitRight < 0) limitRight = 0;
    
    // Đổi số độ ra số xung thực tế của Encoder để truyền xuống mạch 
    // Hệ số: 1 xung = 0.18 độ
    const leftPulses = Math.round(limitLeft / 0.18);
    const rightPulses = Math.round(limitRight / 0.18);
    
    // ĐỒNG BỘ GÓC Y TẾ VÀO QUỸ ĐẠO GAME
    calibMin = leftPulses;
    calibMax = rightPulses;
    localStorage.setItem('calibMin', calibMin);
    localStorage.setItem('calibMax', calibMax);
    
    // Truyền giới hạn tĩnh
    await sendCommand(`L${leftPulses}\n`);
    await sendCommand(`U${rightPulses}\n`);
    
    alert(`CÀI ĐẶT KHÓA AN TOÀN THÀNH CÔNG!\nGóc hoạt động vật lý của bệnh nhân đã được giới hạn:\nTrái: ${limitLeft}°\nPhải: ${limitRight}°\n\nBây giờ bệnh nhân có thể thoải mái tay để CHƠI GAME!`);
    
    // Ẩn menu cài đặt và bật nút Play
    document.getElementById('safetyMenu').style.display = "none";
    const startBtn = document.getElementById('menuStartBtn');
    if (startBtn) {
        startBtn.classList.remove('disabled');
    }
}

async function readSerial() {
    const decoder = new TextDecoder();
    while (port.readable) {
        reader = port.readable.getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const data = decoder.decode(value);
                serialBuffer += data;

                // Xử lý dữ liệu theo dòng (split by newline)
                if (serialBuffer.includes('\n')) {
                    const lines = serialBuffer.split('\n');
                    serialBuffer = lines.pop(); // Giữ lại phần chưa hoàn thành

                    for (const line of lines) {
                        processSerialLine(line);
                    }
                }
            }
        } catch (err) {
            console.error('Error reading from serial port:', err);
        } finally {
            reader.releaseLock();
        }
    }
}

let masterValue = 0; // Biến lưu số xung encoder bạc

function processSerialLine(line) {
    document.getElementById('rawData').textContent = line.trim();
    
    // Đọc Slave để điều khiển Game
    const slaveMatch = line.match(/(?:Slave|S):\s*(-?\d+)/);
    if (slaveMatch) {
        const newValue = parseInt(slaveMatch[1]);
        if (!isNaN(newValue)) {
            hardwareValue = newValue;
            if (calibStep > 0) {
                document.getElementById('calibHW').textContent = hardwareValue;
            }
        }
    }

    // Đọc Master (Encoder Bạc) để tính góc quay của thiết bị
    const masterMatch = line.match(/(?:Master|M):\s*(-?\d+)/);
    if (masterMatch) {
        masterValue = parseInt(masterMatch[1]);
        // Nhận diện theo số đo thực tế: Quay 90 độ ra ~493-500 xung => 1 vòng tròn = 2000 xung 
        // => Vậy 1 xung = 360 / 2000 = 0.18 độ
        const angle = (masterValue * 0.18).toFixed(1);
        
        // Cập nhật hiển thị góc lên giao diện
        const angleEl = document.getElementById('angleValue');
        if (angleEl) {
            angleEl.textContent = angle + '°';
        }
    }

    // Cập nhật thông tin debug ẩn
    const debugPanel = document.getElementById('connStatus');
    if (debugPanel) debugPanel.innerHTML = `Đã kết nối | S: <b>${hardwareValue}</b> | M: <b>${masterValue}</b>`;
}

// --- LƯ U DỮ LIỆU LÊN DATABASE (Flask/SQLite) ---
let telemetryData = [];
let telemetryInterval;
let currentPatientId = null; // Được đặt khi bác sĩ chọn bệnh nhân
let sessionStartTime = null;

function startTelemetry() {
    if (telemetryInterval) clearInterval(telemetryInterval);
    telemetryData = [];
    sessionStartTime = Date.now();

    
    telemetryInterval = setInterval(() => {
        if (typeof gameRunning !== 'undefined' && gameRunning) {
            let tSeconds = ((Date.now() - sessionStartTime) / 1000);
            let angle = (typeof masterValue === 'number' && !isNaN(masterValue)) ? (masterValue * 0.18) : 0;
            let currentScore = typeof score !== 'undefined' ? score : 0;
            let currentLives = typeof lives !== 'undefined' ? lives : 0;
            
            telemetryData.push({ t: parseFloat(tSeconds.toFixed(1)), angle: parseFloat(angle.toFixed(2)), score: currentScore, lives: currentLives });
        }
    }, 500);
}

async function stopAndSaveSession() {
    if (telemetryInterval) clearInterval(telemetryInterval);
    if (telemetryData.length === 0) return;
    
    // Lấy duration từ điểm dữ liệu cuối cùng cho chắc chắn khớp với biểu đồ
    const duration = telemetryData[telemetryData.length - 1].t;
    
    // Tính góc Max/Min thực tế trong phiên tập
    const angles = telemetryData.map(d => d.angle);
    const maxLeft = Math.min(...angles); // số âm nhất
    const maxRight = Math.max(...angles); // số dương nhất
    const finalScore = typeof score !== 'undefined' ? score : 0;
    
    const payload = {
        patient_id: currentPatientId,  // null nếu chưa chọn
        duration_s: parseFloat(duration.toFixed(1)),
        max_left_deg: parseFloat(maxLeft.toFixed(1)),
        max_right_deg: parseFloat(maxRight.toFixed(1)),
        final_score: finalScore,
        telemetry: telemetryData
    };
    
    try {
        const res = await fetch('http://localhost:5000/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        console.log('✅ Đã lưu phiên tập vào database! Session ID:', result.session_id);
    } catch (err) {
        console.warn('⚠️ Server chưa chạy, fallback xuất CSV...');
        // Fallback: xuất CSV nếu server không có
        stopAndExportTelemetry();
    }
}

function stopAndExportTelemetry() {
    if (telemetryData.length === 0) return;
    const csvRows = ['Thời Gian Tập(s),Góc Cổ Tay (°),Điểm,Mạng']
        .concat(telemetryData.map(d => `${d.t},${d.angle},${d.score},${d.lives}`));
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const d = new Date();
    link.download = `HoSo_Rehab_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${d.getHours()}h${String(d.getMinutes()).padStart(2,'0')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
