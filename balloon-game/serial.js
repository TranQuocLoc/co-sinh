// port, reader, hardwareValue đã được khai báo ở game.js
let serialBuffer = "";
let calibStep = 0; // 0=Idle, 1=Zero, 2=Left, 3=Right
let calibMin = parseInt(localStorage.getItem('calibMin')) || -300;
let calibMax = parseInt(localStorage.getItem('calibMax')) || 300;

// Hệ số quy đổi xung (Motor) sang độ (Tinh chỉnh: 855 xung Motor = 72 độ tay cầm)
const ANGLE_COEF = 0.084;
let isCalibratingStep = false;

async function initSerial() {
    if ('serial' in navigator) {
        try {
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: 115200 });

            // Gửi limit đã lưu xuống Arduino
            setTimeout(() => {
                sendCommand(`L${calibMin}\n`);
                setTimeout(() => sendCommand(`U${calibMax}\n`), 100);
            }, 1000);

            const menuConnectBtn = document.getElementById('menuConnectBtn');
            if (menuConnectBtn) {
                menuConnectBtn.textContent = '✅ ĐÃ KẾT NỐI MẠCH';
                menuConnectBtn.classList.add('connected');
                menuConnectBtn.style.opacity = '0.7';
                menuConnectBtn.disabled = true;
            }

            const setupBtn = document.getElementById('menuSafeSetupBtn');
            if (setupBtn) {
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
    document.getElementById('menuSafeSetupBtn').style.display = 'none';
    calibStep = 1;
    showCalibStep();
}

function showCalibStep() {
    const screen = document.getElementById('calibrationScreen');
    const title = document.getElementById('calibTitle');
    const desc = document.getElementById('calibDesc');
    const msg = document.getElementById('calibResultMsg');
    const btn = document.getElementById('calibNextBtn');

    screen.classList.remove('hidden');
    document.getElementById('startScreen').classList.add('hidden');
    msg.textContent = '';

    if (calibStep === 1) {
        title.textContent = 'Yêu cầu bệnh nhân đặt thẳng tay và bấm enter';
        desc.textContent = '';
        btn.textContent = 'Xác nhận';
    } else if (calibStep === 2) {
        title.textContent = 'Bệnh nhân xoay hết cỡ sang trái';
        desc.textContent = '';
        btn.textContent = 'Xác nhận';
    } else if (calibStep === 3) {
        title.textContent = 'Bệnh nhân xoay hết cỡ sang phải';
        desc.textContent = '';
        btn.textContent = 'Xác nhận';
    }
}

async function nextCalibStep() {
    if (isCalibratingStep) return;
    isCalibratingStep = true;

    const msg = document.getElementById('calibResultMsg');
    const currentAngle = (hardwareValue * ANGLE_COEF).toFixed(1);

    if (calibStep === 1) {
        // Reset hardware: coi vị trí hiện tại là 0
        await sendCommand('R');
        msg.textContent = '✅ Đã đặt góc 0! Đang chuyển sang bước tiếp...';
        setTimeout(() => { calibStep = 2; showCalibStep(); isCalibratingStep = false; }, 800);

    } else if (calibStep === 2) {
        // Lưu góc trái (số âm)
        const leftPulses = hardwareValue;
        calibMin = leftPulses;
        localStorage.setItem('calibMin', calibMin);
        const leftDeg = (leftPulses * ANGLE_COEF).toFixed(1);
        msg.textContent = `✅ Góc trái tối đa: ${leftDeg}°. Đang chuyển sang bước tiếp...`;
        setTimeout(() => { calibStep = 3; showCalibStep(); isCalibratingStep = false; }, 1000);

    } else if (calibStep === 3) {
        // Lưu góc phải (số dương)
        const rightPulses = hardwareValue;
        calibMax = rightPulses;
        localStorage.setItem('calibMax', calibMax);
        const rightDeg = (rightPulses * ANGLE_COEF).toFixed(1);
        await sendCommand(`L${calibMin}\n`);
        await sendCommand(`U${rightPulses}\n`);

        const leftDeg = (calibMin * ANGLE_COEF).toFixed(1);
        msg.textContent = `✅ Hoàn tất! Trái: ${leftDeg}° | Phải: ${rightDeg}°`;

        setTimeout(() => {
            document.getElementById('calibrationScreen').classList.add('hidden');
            document.getElementById('startScreen').classList.remove('hidden');
            const startBtn = document.getElementById('menuStartBtn');
            if (startBtn) startBtn.classList.remove('disabled');
            isCalibratingStep = false;
        }, 1200);
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
let current_mA = 0; // Biến lưu dòng điện motor

function processSerialLine(line) {
    document.getElementById('rawData').textContent = line.trim();

    // Đọc Slave để điều khiển Game
    const slaveMatch = line.match(/(?:Slave|S):\s*(-?\d+)/);
    if (slaveMatch) {
        const newValue = parseInt(slaveMatch[1]);
        if (!isNaN(newValue)) {
            hardwareValue = newValue;

            const angle = (hardwareValue * ANGLE_COEF).toFixed(1);
            const angleEl = document.getElementById('angleValue');
            if (angleEl) angleEl.textContent = angle + '°';

            if (calibStep > 0) {
                const calibDisplay = document.getElementById('calibAngleDisplay');
                if (calibDisplay) calibDisplay.textContent = angle;
            }
        }
    }

    const masterMatch = line.match(/(?:Master|M):\s*(-?\d+)/);
    if (masterMatch) {
        masterValue = parseInt(masterMatch[1]);
    }

    // Đọc Current(mA) hoặc F(mA) một cách chính xác (không dùng chữ C viết tắt để tránh nhầm với vScale)
    const currentMatch = line.match(/(?:F\(mA\)|Current\(mA\)):\s*(-?\d+(\.\d+)?)/i);
    if (currentMatch) {
        current_mA = parseFloat(currentMatch[1]);
    }

    // Cập nhật thông tin debug ẩn
    const debugPanel = document.getElementById('connStatus');
    if (debugPanel) debugPanel.innerHTML = `Đã kết nối | S: <b>${hardwareValue}</b> | M: <b>${masterValue}</b> | C: <b>${current_mA}mA</b>`;
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
            let angle = (typeof hardwareValue === 'number' && !isNaN(hardwareValue)) ? (hardwareValue * ANGLE_COEF) : 0;
            let currentScore = typeof score !== 'undefined' ? score : 0;
            let currentLives = typeof lives !== 'undefined' ? lives : 0;

            // Tính toán lực hỗ trợ (N)
            let I = Math.abs(current_mA) / 1000.0;
            let force_N = 0;
            if (I > 0.008) { // Ngưỡng không tải thực tế 8mA (thay vì 60mA)
                let T_motor_kgcm = 6.3 * (I - 0.008);
                let T_output_kgcm = T_motor_kgcm * (10.0 / 3.0) * 0.85;
                let T_output_Nm = T_output_kgcm * 0.098;
                force_N = T_output_Nm / 0.08;
                
                // Đồng bộ dấu của lực với góc: quay trái (góc âm) thì lực âm, quay phải (góc dương) thì lực dương
                if (angle < 0) {
                    force_N = -force_N;
                }
            }

            telemetryData.push({ 
                t: parseFloat(tSeconds.toFixed(1)), 
                angle: parseFloat(angle.toFixed(2)), 
                score: currentScore, 
                lives: currentLives,
                force_n: parseFloat(force_N.toFixed(2)),
                current_ma: parseFloat(current_mA.toFixed(1))
            });
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

    // Tính ROM (Range of Motion)
    const rom_deg = maxRight - maxLeft;
    const rom_mm = rom_deg * (Math.PI / 180) * 75; // R = 75mm (7.5cm)
    const rom_cm = rom_mm / 10;

    // Cập nhật lên UI Game Over
    const finalRomEl = document.getElementById('finalRom');
    if (finalRomEl) finalRomEl.textContent = rom_cm.toFixed(1);

    const payload = {
        patient_id: currentPatientId,  // null nếu chưa chọn
        duration_s: parseFloat(duration.toFixed(1)),
        max_left_deg: parseFloat(maxLeft.toFixed(1)),
        max_right_deg: parseFloat(maxRight.toFixed(1)),
        rom_cm: parseFloat(rom_cm.toFixed(1)),
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
    const csvRows = ['Thời Gian Tập(s),Góc Cổ Tay (°),Lực Hỗ Trợ (N),Dòng Điện (mA),Điểm,Mạng']
        .concat(telemetryData.map(d => `${d.t},${d.angle},${d.force_n},${d.current_ma},${d.score},${d.lives}`));
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const d = new Date();
    link.download = `HoSo_Rehab_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Lắng nghe phím Enter để chuyển bước calibration
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const calibScreen = document.getElementById('calibrationScreen');
        if (calibScreen && !calibScreen.classList.contains('hidden')) {
            e.preventDefault();
            nextCalibStep();
        }
    }
});
