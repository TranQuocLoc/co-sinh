// port, reader, hardwareValue đã được khai báo ở game.js
let serialBuffer = "";
let calibStep = 0; // 0=Idle, 1=Zero, 2=Left, 3=Right
let calibMin = parseInt(localStorage.getItem('calibMin')) || -300;
let calibMax = parseInt(localStorage.getItem('calibMax')) || 300;
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
    const currentAngle = (hardwareValue * 0.18).toFixed(1);

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
        const leftDeg = (leftPulses * 0.18).toFixed(1);
        msg.textContent = `✅ Góc trái tối đa: ${leftDeg}°. Đang chuyển sang bước tiếp...`;
        setTimeout(() => { calibStep = 3; showCalibStep(); isCalibratingStep = false; }, 1000);

    } else if (calibStep === 3) {
        // Lưu góc phải (số dương)
        const rightPulses = hardwareValue;
        calibMax = rightPulses;
        localStorage.setItem('calibMax', calibMax);
        const rightDeg = (rightPulses * 0.18).toFixed(1);
        await sendCommand(`L${calibMin}\n`);
        await sendCommand(`U${calibMax}\n`);

        const leftDeg = (calibMin * 0.18).toFixed(1);
        msg.textContent = `✅ Hoàn tất! Trái: ${leftDeg}° | Phải: ${rightDeg}°`;

        setTimeout(() => {
            calibStep = 0;
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

function processSerialLine(line) {
    document.getElementById('rawData').textContent = line.trim();

    // Đọc Slave để điều khiển Game
    const slaveMatch = line.match(/(?:Slave|S):\s*(-?\d+)/);
    if (slaveMatch) {
        const newValue = parseInt(slaveMatch[1]);
        if (!isNaN(newValue)) {
            hardwareValue = newValue;

            const angle = (hardwareValue * 0.18).toFixed(1);
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
            let angle = (typeof hardwareValue === 'number' && !isNaN(hardwareValue)) ? (hardwareValue * 0.18) : 0;
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

    // --- TÍNH TOÁN ROM (Range of Motion) ---
    const patientROMDeg = maxRight - maxLeft;
    const radiusMm = 82; // Bán kính tay đòn (mm)
    const patientRomArcMm = patientROMDeg * (Math.PI / 180) * radiusMm;

    // ROM Tối đa của thiết bị theo thiết kế (Trái kịch 72°, Phải kịch 32°)
    const deviceMaxRomDeg = 72 + 32; // 104 độ
    const deviceMaxArcMm = deviceMaxRomDeg * (Math.PI / 180) * radiusMm;

    // Hiển thị ra màn hình Game Over
    const romTextEl = document.getElementById('romTextResult');
    if (romTextEl) {
        romTextEl.innerHTML =
            `Quãng đường BN đạt được: <b>${patientROMDeg.toFixed(1)}°</b> (~${patientRomArcMm.toFixed(1)} mm)<br>` +
            `<span style="color:#aaa; font-size:11px;">(Tối đa thiết bị: ${deviceMaxRomDeg}° ~${deviceMaxArcMm.toFixed(1)} mm)</span>`;
    }

    const payload = {
        patient_id: currentPatientId,  // null nếu chưa chọn
        duration_s: parseFloat(duration.toFixed(1)),
        max_left_deg: parseFloat(maxLeft.toFixed(1)),
        max_right_deg: parseFloat(maxRight.toFixed(1)),
        patient_rom_deg: parseFloat(patientROMDeg.toFixed(1)),
        patient_rom_arc_mm: parseFloat(patientRomArcMm.toFixed(1)),
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
