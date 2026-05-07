// Game Constants - REDUCED SPEED FOR WRIST REHABILITATION
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const BALLOON_WIDTH = 40;
const BALLOON_HEIGHT = 55;
const COIN_SIZE = 20;
const GEM_SIZE = 25;
const SPIKE_WIDTH = 60;
const SPIKE_HEIGHT = 20;

// VERY SLOW SPEEDS for wrist rehabilitation
const BALLOON_SPEED = 2.5;        // Very slow for gentle wrist movement
const INITIAL_FALL_SPEED = 0.8;   // Slow falling objects
const SPEED_INCREMENT = 0.00005;  // Very slow difficulty increase
const MAX_FALL_SPEED = 2;         // Maximum speed cap
const ENCODER_LIMIT = 300;        // Giới hạn encoder (ví dụ xoay cổ tay +/- 300)

// Screen shake effect
let screenShake = {
    active: false,
    intensity: 0,
    duration: 0,
    offsetX: 0,
    offsetY: 0
};

// Game State
let canvas, ctx;
let gameRunning = false;
let gamePaused = false;
let score = 0;
let lives = 3;
let highScore = localStorage.getItem('balloonHighScore') || 0;
let fallSpeed = INITIAL_FALL_SPEED;

// Game Objects
let balloon = {
    x: CANVAS_WIDTH / 2 - BALLOON_WIDTH / 2,
    y: CANVAS_HEIGHT - 150,
    width: BALLOON_WIDTH,
    height: BALLOON_HEIGHT,
    velocityX: 0,
    tilt: 0,           // Tilt angle for visual effect
    targetTilt: 0      // Target tilt for smooth animation
};

let coins = [];
let gems = [];
let spikes = [];

// Input State
let keys = { left: false, right: false, leftTicks: 0, rightTicks: 0 };
let hardwareValue = 0; // Current value
let lastHardwareValue = null; // To calculate delta
let port, reader;      // Serial connection variables

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    document.getElementById('highScore').textContent = highScore;

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
});

function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') togglePause();
}

function handleKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
}

function togglePause() {
    if (!gameRunning) return;
    gamePaused = !gamePaused;
    document.getElementById('pauseScreen').classList.toggle('hidden', !gamePaused);
    if (!gamePaused) gameLoop();
}

function startGame() {
    const startBtn = document.getElementById('menuStartBtn');
    if (startBtn && startBtn.classList.contains('disabled')) {
        const goBack = confirm("⚠️ Chưa kết nối thiết bị và cài đặt khóa an toàn!\n\nNhấn OK để quay lại cài đặt.\nNhấn Bỏ qua (Cancel) để chơi thử không có thiết bị.");
        if (goBack) return; // OK => Quày lại
        // Cancel => Bỏ qua, cho phép vào game test
    }

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetGame();
    gameRunning = true;
    
    // Bắt đầu thu thập dữ liệu đo góc tay bệnh nhân
    // Cố gắng tìm/tạo bệnh nhân trong database trước
    const patientNameEl = document.getElementById('patientName');
    const patientName = patientNameEl ? patientNameEl.value.trim() : '';
    if (patientName && typeof fetch !== 'undefined') {
        fetch('http://localhost:5000/api/patients/find-or-create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: patientName })
        })
        .then(r => r.json())
        .then(data => {
            if (typeof currentPatientId !== 'undefined') currentPatientId = data.id;
            console.log(`👤 Bệnh nhân: ${data.name} (ID: ${data.id})${data.created ? ' - Mới tạo' : ' - Đã có'}`);
        })
        .catch(() => console.warn('⚠️ Không lưu được tên bệnh nhân - server chưa chạy'));
    }
    
    if (typeof startTelemetry === 'function') startTelemetry();
    
    gameLoop();
}

function restartGame() {
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetGame();
    gameRunning = true;
    if (typeof startTelemetry === 'function') startTelemetry(); // Thêm dòng này
    gameLoop();
}

function resetGame() {
    score = 0;
    lives = 3;
    fallSpeed = INITIAL_FALL_SPEED;
    balloon.x = CANVAS_WIDTH / 2 - BALLOON_WIDTH / 2;
    balloon.velocityX = 0;
    balloon.tilt = 0;
    balloon.targetTilt = 0;
    keys.leftTicks = 0;
    keys.rightTicks = 0;
    coins = [];
    gems = [];
    spikes = [];
    updateUI();
}

function updateUI() {
    document.getElementById('score').textContent = score;
    document.getElementById('lives').textContent = lives;
}

function gameOver() {
    gameRunning = false;

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('balloonHighScore', highScore);
        document.getElementById('highScore').textContent = highScore;
        document.getElementById('newHighScore').classList.remove('hidden');
    } else {
        document.getElementById('newHighScore').classList.add('hidden');
    }

    document.getElementById('finalScore').textContent = score;
    document.getElementById('gameOverScreen').classList.remove('hidden');
    
    // Lưu dữ liệu phiên tập lên Server (hoặc fallback ra CSV)
    if (typeof stopAndSaveSession === 'function') stopAndSaveSession();
}

// Ấn QUIT ở màn Pause → kết thúc ván, lưu dữ liệu, về menu chính
function quitToMenu() {
    gamePaused = false;
    document.getElementById('pauseScreen').classList.add('hidden'); // Ẩn màn Pause
    lives = 0;
    gameOver();
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetToMainMenu();
}

// Ấn MAIN MENU ở màn Game Over
function goToMainMenu() {
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetToMainMenu();
}

// Reset màn menu về trạng thái sạch ban đầu
function resetToMainMenu() {
    document.getElementById('startScreen').classList.remove('hidden');
    // Ẩn lại cửa sổ cài đặt an toàn & nút cài đặt
    const safeBtn = document.getElementById('menuSafeSetupBtn');
    const safeMenu = document.getElementById('safetyMenu');
    if (safeBtn)  safeBtn.style.display  = 'none';
    if (safeMenu) safeMenu.style.display = 'none';
}

// Color palettes for colorful elements
const COIN_COLORS = ['#FFD700', '#FFA500', '#FF6347', '#32CD32', '#00CED1', '#FF69B4'];
const GEM_COLORS = ['#3498db', '#9b59b6', '#1abc9c', '#e74c3c', '#f39c12'];
const BALLOON_COLOR = '#FF6B9D';  // Pink balloon

function spawnCoin() {
    const color = COIN_COLORS[Math.floor(Math.random() * COIN_COLORS.length)];
    coins.push({
        x: Math.random() * (CANVAS_WIDTH - COIN_SIZE * 2) + COIN_SIZE,
        y: -COIN_SIZE,
        size: COIN_SIZE,
        points: 10,
        wobble: Math.random() * Math.PI * 2,
        color: color
    });
}

function spawnGem() {
    const color = GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)];
    gems.push({
        x: Math.random() * (CANVAS_WIDTH - GEM_SIZE * 2) + GEM_SIZE,
        y: -GEM_SIZE,
        size: GEM_SIZE,
        points: 50,
        sparkle: 0,
        color: color
    });
}

function spawnSpike() {
    // Find a position that doesn't overlap with existing spikes
    let newX;
    let attempts = 0;
    const maxAttempts = 10;

    do {
        newX = Math.random() * (CANVAS_WIDTH - SPIKE_WIDTH);
        attempts++;

        // Check if this position overlaps with any existing spike near the top
        const overlapping = spikes.some(spike => {
            if (spike.y > 50) return false;  // Only check spikes near top
            const distance = Math.abs(spike.x - newX);
            return distance < SPIKE_WIDTH + 20;  // Minimum gap of 20px
        });

        if (!overlapping) break;
    } while (attempts < maxAttempts);

    // Only spawn if we found a good position
    if (attempts < maxAttempts) {
        spikes.push({
            x: newX,
            y: -SPIKE_HEIGHT,
            width: SPIKE_WIDTH,
            height: SPIKE_HEIGHT,
            type: 'bar'
        });
    }
}

// Trigger screen shake effect
function triggerScreenShake(intensity = 8, duration = 15) {
    screenShake.active = true;
    screenShake.intensity = intensity;
    screenShake.duration = duration;
}

// Update screen shake
function updateScreenShake() {
    if (screenShake.active) {
        screenShake.duration--;
        if (screenShake.duration <= 0) {
            screenShake.active = false;
            screenShake.offsetX = 0;
            screenShake.offsetY = 0;
        } else {
            screenShake.offsetX = (Math.random() - 0.5) * screenShake.intensity;
            screenShake.offsetY = (Math.random() - 0.5) * screenShake.intensity;
            // Reduce intensity over time
            screenShake.intensity *= 0.9;
        }
    }
}

function update() {
    // Update balloon position (Keyboard fallback + Hardware Absolute Position)
    if (keys.left) {
        balloon.velocityX = -BALLOON_SPEED;
        balloon.targetTilt = -0.25;
    } else if (keys.right) {
        balloon.velocityX = BALLOON_SPEED;
        balloon.targetTilt = 0.25;
    } else if (port) {
        // DIỀU KHIỂN THEO TỌA ĐỘ TUYỆT ĐỐI (ABSOLUTE POSITIONING)
        // Ánh xạ masterValue (góc tay thật) từ dải [calibMin, calibMax] sang [0, CANVAS_WIDTH]

        // calibMin và calibMax được lấy từ serial.js (localStorage) thông qua biến toàn cục
        let range = calibMax - calibMin;
        if (range === 0) range = 1; // Tránh chia cho 0

        // Tính tỷ lệ (clamped giữa 0 và 1)
        let ratio = (masterValue - calibMin) / range;
        ratio = Math.max(0, Math.min(1, ratio));

        // Tính vị trí đích
        const targetX = ratio * (CANVAS_WIDTH - balloon.width);

        // Di chuyển mượt tới vị trí đích (easing)
        const ease = 0.15;
        const lastX = balloon.x;
        balloon.x += (targetX - balloon.x) * ease;

        // Tính toán velocity và tilt dựa trên dịch chuyển thực tế
        balloon.velocityX = balloon.x - lastX;
        balloon.targetTilt = Math.max(-0.3, Math.min(0.3, balloon.velocityX * 0.2));
    } else {
        balloon.velocityX *= 0.9;
        balloon.targetTilt = 0;
    }

    // Cập nhật vị trí X cho cả Keyboard và Encoder
    balloon.x += balloon.velocityX;
    // Smooth tilt animation
    balloon.tilt += (balloon.targetTilt - balloon.tilt) * 0.15;

    // Keep balloon in bounds
    if (balloon.x < 0) balloon.x = 0;
    if (balloon.x > CANVAS_WIDTH - balloon.width) balloon.x = CANVAS_WIDTH - balloon.width;

    // Increase difficulty (slower)
    fallSpeed = Math.min(MAX_FALL_SPEED, fallSpeed + SPEED_INCREMENT);

    // Spawn objects (less frequently for easier gameplay)
    if (Math.random() < 0.010) spawnCoin();   // Reduced coin frequency
    if (Math.random() < 0.003) spawnGem();    // Reduced gem frequency
    if (Math.random() < 0.004) spawnSpike();  // Reduced spike frequency

    // Update coins with wobble effect
    coins = coins.filter((coin) => {
        coin.y += fallSpeed;
        coin.wobble += 0.05;

        if (checkCollision(balloon, { x: coin.x - coin.size / 2, y: coin.y - coin.size / 2, width: coin.size, height: coin.size })) {
            score += coin.points;
            updateUI();
            return false;
        }

        return coin.y <= CANVAS_HEIGHT + coin.size;
    });

    // Update gems with sparkle effect
    gems = gems.filter((gem) => {
        gem.y += fallSpeed * 0.7;
        gem.sparkle += 0.1;

        if (checkCollision(balloon, { x: gem.x - gem.size / 2, y: gem.y - gem.size / 2, width: gem.size, height: gem.size })) {
            score += gem.points;
            updateUI();
            return false;
        }

        return gem.y <= CANVAS_HEIGHT + gem.size;
    });

    // Update spikes
    spikes = spikes.filter((spike) => {
        spike.y += fallSpeed;

        const spikeHitbox = {
            x: spike.x + 8,
            y: spike.y + 5,
            width: spike.width - 16,
            height: spike.height - 8
        };

        if (checkCollision(balloon, spikeHitbox)) {
            lives--;
            updateUI();
            triggerScreenShake(10, 20);  // Trigger shake on hit!

            if (lives <= 0) {
                gameOver();
            }
            return false;
        }

        return spike.y <= CANVAS_HEIGHT + spike.height;
    });
}

function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y;
}

function draw() {
    // Update screen shake
    updateScreenShake();

    // Apply screen shake offset
    ctx.save();
    ctx.translate(screenShake.offsetX, screenShake.offsetY);

    // Clear canvas with light gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#E8F4F8');   // Light sky blue
    gradient.addColorStop(0.5, '#D4EBF2'); // Soft blue
    gradient.addColorStop(1, '#C5E3ED');   // Lighter blue
    ctx.fillStyle = gradient;
    ctx.fillRect(-10, -10, CANVAS_WIDTH + 20, CANVAS_HEIGHT + 20);

    // Draw some decorative clouds
    drawClouds();

    // Draw coins with wobble
    coins.forEach(coin => {
        const wobbleX = Math.sin(coin.wobble) * 2;
        drawPixelCoin(coin.x + wobbleX, coin.y, coin.size, coin.color);
    });

    // Draw gems with sparkle
    gems.forEach(gem => {
        drawPixelGem(gem.x, gem.y, gem.size, gem.sparkle, gem.color);
    });

    // Draw spikes
    spikes.forEach(spike => {
        drawPixelSpikes(spike.x, spike.y, spike.width, spike.height);
    });

    // Draw balloon with tilt effect
    drawPixelBalloon();

    // Restore context after shake
    ctx.restore();
}

function drawClouds() {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    // Simple cloud shapes
    const clouds = [
        { x: 50, y: 80 },
        { x: 200, y: 150 },
        { x: 320, y: 60 },
        { x: 100, y: 300 },
        { x: 280, y: 400 }
    ];

    clouds.forEach(cloud => {
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, 20, 0, Math.PI * 2);
        ctx.arc(cloud.x + 25, cloud.y - 5, 15, 0, Math.PI * 2);
        ctx.arc(cloud.x + 45, cloud.y, 18, 0, Math.PI * 2);
        ctx.fill();
    });
}

function drawPixelCoin(x, y, size, color) {
    const s = size / 2;

    // Filled colored circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(x - s * 0.25, y - s * 0.25, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
}

function drawPixelGem(x, y, size, sparkle, color) {
    ctx.fillStyle = color || '#3498db';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;

    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + size / 2, y);
    ctx.lineTo(x, y + size / 2);
    ctx.lineTo(x - size / 2, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Animated shine
    const shineAlpha = 0.4 + Math.sin(sparkle) * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${shineAlpha})`;
    ctx.beginPath();
    ctx.moveTo(x - size / 6, y - size / 4);
    ctx.lineTo(x, y - size / 6);
    ctx.lineTo(x - size / 6, y);
    ctx.closePath();
    ctx.fill();
}

function drawPixelSpikes(x, y, width, height) {
    ctx.fillStyle = '#333';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;

    const spikeCount = 6;
    const spikeWidth = width / spikeCount;

    // Top bar
    ctx.fillRect(x, y, width, 5);

    // Spikes pointing down
    for (let i = 0; i < spikeCount; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * spikeWidth, y + 5);
        ctx.lineTo(x + i * spikeWidth + spikeWidth / 2, y + height);
        ctx.lineTo(x + (i + 1) * spikeWidth, y + 5);
        ctx.closePath();
        ctx.fill();
    }
}

function drawPixelBalloon() {
    const centerX = balloon.x + balloon.width / 2;
    const centerY = balloon.y + balloon.height / 2;

    ctx.save();

    // Apply tilt transformation
    ctx.translate(centerX, centerY);
    ctx.rotate(balloon.tilt);
    ctx.translate(-centerX, -centerY);

    const x = balloon.x + balloon.width / 2;
    const y = balloon.y;

    // Rainbow color cycling balloon
    const time = Date.now() / 1000;
    const hue = (time * 30) % 360;  // Slowly cycling hue
    const color1 = `hsl(${hue}, 80%, 75%)`;
    const color2 = `hsl(${hue}, 70%, 55%)`;
    const color3 = `hsl(${hue}, 60%, 40%)`;

    const balloonGradient = ctx.createRadialGradient(x - 5, y + 10, 2, x, y + 20, 22);
    balloonGradient.addColorStop(0, color1);   // Light
    balloonGradient.addColorStop(0.5, color2); // Medium
    balloonGradient.addColorStop(1, color3);   // Dark

    ctx.fillStyle = balloonGradient;
    ctx.strokeStyle = `hsl(${hue}, 50%, 30%)`;
    ctx.lineWidth = 2;

    // Balloon body (oval) - FILLED
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Balloon stripes (curved lines)
    ctx.beginPath();
    ctx.moveTo(x - 12, y + 10);
    ctx.quadraticCurveTo(x - 15, y + 25, x - 8, y + 38);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 12, y + 10);
    ctx.quadraticCurveTo(x + 15, y + 25, x + 8, y + 38);
    ctx.stroke();

    // Center stripe
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 38);
    ctx.stroke();

    // Balloon knot
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 40);
    ctx.lineTo(x, y + 45);
    ctx.lineTo(x + 4, y + 40);
    ctx.stroke();

    // String with slight wave
    const stringWave = Math.sin(Date.now() / 300) * 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 45);
    ctx.quadraticCurveTo(x + stringWave, y + 47, x, y + 50);
    ctx.stroke();

    // Basket ropes
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 50);
    ctx.lineTo(x, y + 50);
    ctx.lineTo(x + 10, y + 50);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 10, y + 50);
    ctx.lineTo(x - 12, y + 55);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 10, y + 50);
    ctx.lineTo(x + 12, y + 55);
    ctx.stroke();

    // Basket
    ctx.fillStyle = '#333';
    ctx.fillRect(x - 12, y + 55, 24, 10);

    // Basket pattern
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 12, y + 58);
    ctx.lineTo(x + 12, y + 58);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 12, y + 62);
    ctx.lineTo(x + 12, y + 62);
    ctx.stroke();

    // Vertical lines
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 55);
    ctx.lineTo(x - 4, y + 65);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + 4, y + 55);
    ctx.lineTo(x + 4, y + 65);
    ctx.stroke();

    ctx.restore();
}

function gameLoop() {
    if (!gameRunning || gamePaused) return;

    update();
    draw();
    requestAnimationFrame(gameLoop);
}
