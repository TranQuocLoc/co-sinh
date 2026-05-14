// Game Constants
const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 600;
const BOAT_WIDTH = 30;
const BOAT_HEIGHT = 50;
const ROCK_RADIUS = 17.5; // Giảm 30% (từ 25 -> 17.5)
const RIVER_WIDTH = 226; // Giảm 10% từ 252 -> 226

// Speeds for wrist rehabilitation
const BOAT_SPEED = 2.25;
let INITIAL_SCROLL_SPEED = 1.0;
const SPEED_INCREMENT = 0.0001;
let MAX_SCROLL_SPEED = 2.5;
const ENCODER_LIMIT = 300;

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
let currentLevel = 3;
let score = 0;
let lives = 3;
let highScore = localStorage.getItem('balloonHighScore') || 0;
let scrollSpeed = INITIAL_SCROLL_SPEED;
let worldY = 0; // Tracks total distance scrolled

// Biomes configuration
const BIOMES = [
    { name: 'Jungle', ground: '#2E4015', decors: ['tree', 'bush'] },
    { name: 'Savanna', ground: '#A0935B', decors: ['dead_tree', 'bush'] },
    { name: 'Temperate', ground: '#5C4033', decors: ['tree', 'dry_rock'] },
    { name: 'Taiga', ground: '#273746', decors: ['pine_tree', 'dry_rock'] },
    { name: 'Ice', ground: '#D6EAF8', decors: ['snow_tree', 'ice_rock'] }
];
const BIOME_LENGTH = 3000;
const BIOME_BLEND = 500; // Khoảng cách (pixel) để pha màu giữa 2 biome

// Game Objects
let boat = {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT - 120, // Fixed near bottom
    width: BOAT_WIDTH,
    height: BOAT_HEIGHT,
    velocityX: 0,
    tilt: 0,
    targetTilt: 0
};

let rocks = [];
let particles = [];
let decorations = [];

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

function showLevelScreen() {
    const startBtn = document.getElementById('menuStartBtn');
    if (startBtn && startBtn.classList.contains('disabled')) {
        const goBack = confirm("⚠️ Chưa kết nối thiết bị và cài đặt khóa an toàn!\n\nNhấn OK để quay lại cài đặt.\nNhấn Bỏ qua (Cancel) để chơi thử không có thiết bị.");
        if (goBack) return; // OK => Quày lại
        // Cancel => Bỏ qua, cho phép vào game test
    }

    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('levelScreen').classList.remove('hidden');
}

function backToMainMenu() {
    document.getElementById('levelScreen').classList.add('hidden');
    document.getElementById('startScreen').classList.remove('hidden');
}

function startGameWithLevel(level) {
    currentLevel = level;
    document.getElementById('levelScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');

    // Cấu hình theo Level
    if (level === 1 || level === 2) {
        INITIAL_SCROLL_SPEED = 0.9;
        MAX_SCROLL_SPEED = 2.25;
    } else {
        INITIAL_SCROLL_SPEED = 1.0;
        MAX_SCROLL_SPEED = 2.5;
    }

    resetGame();
    gameRunning = true;

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
    if (typeof startTelemetry === 'function') startTelemetry();
    gameLoop();
}

function resetGame() {
    score = 0;
    lives = 3;
    scrollSpeed = INITIAL_SCROLL_SPEED;
    worldY = -120; // Bắt đầu ở số âm để thuyền rơi đúng vào tâm khúc đầu tiên của dòng sông
    boat.x = CANVAS_WIDTH / 2;
    boat.velocityX = 0;
    boat.tilt = 0;
    boat.targetTilt = 0;
    keys.leftTicks = 0;
    keys.rightTicks = 0;
    rocks = [];
    particles = [];
    decorations = [];
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

    if (typeof stopAndSaveSession === 'function') stopAndSaveSession();
}

function quitToMenu() {
    gamePaused = false;
    document.getElementById('pauseScreen').classList.add('hidden');
    lives = 0;
    gameOver();
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetToMainMenu();
}

function goToMainMenu() {
    document.getElementById('gameOverScreen').classList.add('hidden');
    resetToMainMenu();
}

function resetToMainMenu() {
    document.getElementById('startScreen').classList.remove('hidden');
    const safeBtn = document.getElementById('menuSafeSetupBtn');
    const safeMenu = document.getElementById('safetyMenu');
    if (safeBtn) safeBtn.style.display = 'none';
    if (safeMenu) safeMenu.style.display = 'none';
}

// --- RIVER BOAT GAME LOGIC ---

function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

function blendColors(c1, c2, ratio) {
    const c1Rgb = hexToRgb(c1);
    const c2Rgb = hexToRgb(c2);
    const r = Math.round(c1Rgb.r * (1 - ratio) + c2Rgb.r * ratio);
    const g = Math.round(c1Rgb.g * (1 - ratio) + c2Rgb.g * ratio);
    const b = Math.round(c1Rgb.b * (1 - ratio) + c2Rgb.b * ratio);
    return `rgb(${r},${g},${b})`;
}

function getBiomeAt(worldY) {
    let currentIdx = Math.floor(worldY / BIOME_LENGTH) % BIOMES.length;
    if (currentIdx < 0) currentIdx += BIOMES.length;

    let nextIdx = (currentIdx + 1) % BIOMES.length;

    let localY = worldY % BIOME_LENGTH;
    if (localY < 0) localY += BIOME_LENGTH;

    // Nếu ở đoạn giao thoa, blend màu nền đất
    if (localY > BIOME_LENGTH - BIOME_BLEND) {
        const ratio = (localY - (BIOME_LENGTH - BIOME_BLEND)) / BIOME_BLEND;
        return {
            name: BIOMES[nextIdx].name, // Vật thể ưu tiên mọc theo biome sắp tới
            decors: BIOMES[nextIdx].decors,
            groundColor: blendColors(BIOMES[currentIdx].ground, BIOMES[nextIdx].ground, ratio)
        };
    }

    return {
        name: BIOMES[currentIdx].name,
        decors: BIOMES[currentIdx].decors,
        groundColor: BIOMES[currentIdx].ground
    };
}
function getRiverCenterX(worldY) {
    // Tăng biên độ và tần số thêm 20% để sông ngoằn ngoèo hơn
    const wave1 = Math.sin(worldY * 0.0066) * 105;
    const wave2 = Math.sin(worldY * 0.0026) * 60;
    return CANVAS_WIDTH / 2 + wave1 + wave2;
}

function getRiverWidth(wy) {
    const targetWidth = 226; // Độ rộng hiện tại của bạn
    const startWidth = targetWidth * 2; // 200% độ rộng
    const transitionDistance = CANVAS_HEIGHT / 2; // 300px (nửa màn hình)

    if (wy <= 0) return startWidth;
    if (wy >= transitionDistance) return targetWidth;

    // Tính toán thu hẹp dần (Linear interpolation)
    const ratio = wy / transitionDistance;
    return startWidth + (targetWidth - startWidth) * ratio;
}


function spawnRock() {
    if (currentLevel === 1) return; // Không có đá

    const spawnWorldY = worldY + CANVAS_HEIGHT + 100;

    // THÊM DÒNG NÀY: Không sinh đá trong khoảng nửa màn hình đầu tiên
    if (spawnWorldY < CANVAS_HEIGHT / 2) return;

    const biome = getBiomeAt(spawnWorldY);

    const spawnChance = currentLevel === 2 ? 0.04 : 0.045;

    if (Math.random() > spawnChance) return;

    const tooClose = rocks.some(r => Math.abs(r.worldY - spawnWorldY) < 150);
    if (!tooClose) {
        const centerX = getRiverCenterX(spawnWorldY);
        const currentRiverWidth = getRiverWidth(spawnWorldY);
        const maxOffset = currentRiverWidth / 2 - ROCK_RADIUS * 1.5;
        const xOffset = (Math.random() * 2 - 1) * maxOffset;

        const isIce = biome.name === 'Ice';

        const points = [];
        const numPoints = 6 + Math.floor(Math.random() * 4); // Từ 6 đến 9 điểm
        for (let i = 0; i < numPoints; i++) {
            const angle = (Math.PI * 2 / numPoints) * i;
            const r = ROCK_RADIUS * (0.6 + Math.random() * 0.5); // Bán kính lồi lõm
            points.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
        }

        rocks.push({
            x: centerX + xOffset,
            worldY: spawnWorldY,
            size: ROCK_RADIUS,
            points: points,
            isIce: isIce
        });
    }
}

function spawnDecoration() {
    const spawnWorldY = worldY + CANVAS_HEIGHT + 100;
    const biome = getBiomeAt(spawnWorldY);

    if (biome.name === 'Ice') return; // Bỏ hết cây ở màn tuyết

    const baseChance = 0.1;
    const chance = (biome.name === 'Savanna') ? baseChance * 0.3 : baseChance;

    if (Math.random() > chance) return;

    const centerX = getRiverCenterX(spawnWorldY);
    const isLeft = Math.random() > 0.5;

    // Nằm cách bờ sông một khoảng ngẫu nhiên
    const offsetFromCenter = RIVER_WIDTH / 2 + 30 + Math.random() * 80;
    const x = isLeft ? centerX - offsetFromCenter : centerX + offsetFromCenter;

    const type = biome.decors[Math.floor(Math.random() * biome.decors.length)];

    decorations.push({
        x: x,
        worldY: spawnWorldY,
        type: type,
        size: 20 + Math.random() * 20,
        biomeName: biome.name
    });
}

function triggerScreenShake(intensity = 8, duration = 15) {
    screenShake.active = true;
    screenShake.intensity = intensity;
    screenShake.duration = duration;
}

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
            screenShake.intensity *= 0.9;
        }
    }
}

function update() {
    // LƯU Ý: Phần lấy góc hardwareValue và gán tỷ lệ sang toạ độ X được giữ nguyên chuẩn xác!
    if (keys.left) {
        boat.velocityX = -BOAT_SPEED;
        boat.targetTilt = -0.3;
    } else if (keys.right) {
        boat.velocityX = BOAT_SPEED;
        boat.targetTilt = 0.3;
    } else if (typeof port !== 'undefined' && port) {
        let range = (typeof calibMax !== 'undefined' ? calibMax : 100) - (typeof calibMin !== 'undefined' ? calibMin : -100);
        if (range === 0) range = 1;

        let ratio = ((typeof masterValue !== 'undefined' ? masterValue : 0) - (typeof calibMin !== 'undefined' ? calibMin : -100)) / range;
        ratio = Math.max(0, Math.min(1, ratio));

        const targetX = ratio * CANVAS_WIDTH;
        const ease = 0.135;
        const lastX = boat.x;
        boat.x += (targetX - boat.x) * ease;

        boat.velocityX = boat.x - lastX;
        boat.targetTilt = Math.max(-0.4, Math.min(0.4, boat.velocityX * 0.135));
    } else {
        boat.velocityX = 0;
        boat.targetTilt = 0;
    }

    if (!(typeof port !== 'undefined' && port)) {
        boat.x += boat.velocityX;
    }

    boat.tilt += (boat.targetTilt - boat.tilt) * 0.135;

    // Bounds check
    if (boat.x < 0) boat.x = 0;
    if (boat.x > CANVAS_WIDTH) boat.x = CANVAS_WIDTH;

    // Scroll world
    worldY += scrollSpeed;
    scrollSpeed = Math.min(MAX_SCROLL_SPEED, scrollSpeed + SPEED_INCREMENT);

    if (Math.floor(worldY / 100) > score) {
        score = Math.floor(worldY / 100);
        updateUI();
    }

    spawnRock();
    spawnDecoration();

    const boatHitbox = {
        x: boat.x - boat.width / 2,
        y: boat.y - boat.height / 2,
        width: boat.width,
        height: boat.height
    };

    // Bank collision (Chạm mép sông)
    const boatWorldY = worldY + (CANVAS_HEIGHT - boat.y);
    const riverCenterAtBoat = getRiverCenterX(boatWorldY);

    // SỬA DÒNG NÀY: Dùng hàm getRiverWidth thay cho hằng số
    const currentRiverWidth = getRiverWidth(boatWorldY);

    if (Math.abs(boat.x - riverCenterAtBoat) > currentRiverWidth / 2 - boat.width / 2) {
        hitObstacle();
    }

    // Cập nhật và Xóa Trang trí
    decorations = decorations.filter(dec => {
        const screenY = CANVAS_HEIGHT - (dec.worldY - worldY);
        return screenY <= CANVAS_HEIGHT + dec.size * 2;
    });

    // Cập nhật và Va chạm Đá ngầm
    rocks = rocks.filter(rock => {
        const screenY = CANVAS_HEIGHT - (rock.worldY - worldY);

        const rockHitbox = {
            x: rock.x - rock.size * 0.8,
            y: screenY - rock.size * 0.8,
            width: rock.size * 1.6,
            height: rock.size * 1.6
        };

        if (checkCollision(boatHitbox, rockHitbox)) {
            hitObstacle();
            return false;
        }

        return screenY <= CANVAS_HEIGHT + rock.size * 2;
    });

    // Bọt nước thuyền
    if (Math.abs(boat.velocityX) > 0.5 || scrollSpeed > 0) {
        particles.push({
            x: boat.x + (Math.random() * 10 - 5),
            y: boat.y + boat.height / 2,
            life: 1.0,
            vx: -boat.velocityX * 0.2 + (Math.random() * 0.5 - 0.25),
            vy: scrollSpeed * 0.5 + Math.random() * 2
        });
    }

    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        return p.life > 0;
    });
}

function hitObstacle() {
    lives--;
    updateUI();
    triggerScreenShake(15, 20);

    // Đẩy thuyền ra xa rìa nếu chạm bờ
    const riverCenterAtBoat = getRiverCenterX(worldY + (CANVAS_HEIGHT - boat.y));
    boat.x += (riverCenterAtBoat - boat.x) * 0.5;
    boat.velocityX = 0;

    if (lives <= 0) {
        gameOver();
    }
}

function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y;
}

function draw() {
    updateScreenShake();

    ctx.save();
    ctx.translate(screenShake.offsetX, screenShake.offsetY);

    // 1. Vẽ Đất Nền (Ground) cuộn dần theo chiều dọc
    // Vẽ từng dải ngang cao 10px để cập nhật màu theo từng toạ độ worldY cụ thể
    for (let y = -10; y <= CANVAS_HEIGHT + 10; y += 10) {
        const wy = worldY + (CANVAS_HEIGHT - y);
        const biome = getBiomeAt(wy);
        ctx.fillStyle = biome.groundColor;
        ctx.fillRect(-10, y, CANVAS_WIDTH + 20, 10);
    }

    // 2. Vẽ Sông
    ctx.beginPath();
    for (let y = -10; y <= CANVAS_HEIGHT + 10; y += 10) {
        const wy = worldY + (CANVAS_HEIGHT - y);
        const cx = getRiverCenterX(wy);

        // SỬA DÒNG NÀY: Dùng hàm getRiverWidth(wy)
        const rWidth = getRiverWidth(wy);

        if (y === -10) ctx.moveTo(cx - rWidth / 2, y);
        else ctx.lineTo(cx - rWidth / 2, y);
    }
    for (let y = CANVAS_HEIGHT + 10; y >= -10; y -= 10) {
        const wy = worldY + (CANVAS_HEIGHT - y);
        const cx = getRiverCenterX(wy);

        // SỬA DÒNG NÀY: Dùng hàm getRiverWidth(wy)
        const rWidth = getRiverWidth(wy);

        ctx.lineTo(cx + rWidth / 2, y);
    }
    ctx.closePath();


    const riverGradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, 0);
    riverGradient.addColorStop(0, '#1E5A7A');
    riverGradient.addColorStop(0.3, '#2A82A5');
    riverGradient.addColorStop(0.5, '#40A4C7');
    riverGradient.addColorStop(0.7, '#2A82A5');
    riverGradient.addColorStop(1, '#1E5A7A');

    ctx.fillStyle = riverGradient;
    ctx.fill();

    ctx.strokeStyle = '#85C1D9'; // Viền nước cạn trắng xanh
    ctx.lineWidth = 4;
    ctx.stroke();

    // 3. Vẽ Đồ Trang trí (Cây, Xương rồng...)
    decorations.forEach(dec => {
        const screenY = CANVAS_HEIGHT - (dec.worldY - worldY);
        drawDecoration(dec.x, screenY, dec.size, dec.type, dec.biomeName);
    });

    // 4. Vẽ Đá Ngầm
    rocks.forEach(rock => {
        const screenY = CANVAS_HEIGHT - (rock.worldY - worldY);
        drawRock(rock.x, screenY, rock.points, rock.isIce);
    });

    // 5. Bọt nước
    particles.forEach(p => {
        ctx.fillStyle = `rgba(255, 255, 255, ${p.life * 0.6})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + p.life * 2, 0, Math.PI * 2);
        ctx.fill();
    });

    // 6. Thuyền
    drawBoat();

    ctx.restore();
}

function drawRock(cx, cy, points, isIce = false) {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();

    ctx.fillStyle = isIce ? '#AED6F1' : '#5D6D7E';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isIce ? '#5DADE2' : '#273746';
    ctx.stroke();

    // Khắc các đường nứt/highlight bên trong đá
    ctx.beginPath();
    ctx.moveTo(points[0].x * 0.5, points[0].y * 0.5);
    ctx.lineTo(points[2].x * 0.6, points[2].y * 0.6);
    ctx.strokeStyle = isIce ? '#EBF5FB' : '#85929E';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

function drawDecoration(cx, cy, size, type, biomeName) {
    ctx.save();
    ctx.translate(cx, cy);

    if (type === 'tree') {
        // Thân cây
        ctx.fillStyle = (biomeName === 'Savanna') ? '#8B5A2B' : '#6E2C00';
        ctx.fillRect(-size / 4, 0, size / 2, size);
        // Tán lá
        ctx.fillStyle = (biomeName === 'Savanna') ? '#6B8E23' : '#1E8449';
        ctx.beginPath();
        ctx.arc(0, -size / 2, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = (biomeName === 'Savanna') ? '#506419' : '#117A65';
        ctx.beginPath();
        ctx.arc(-size / 2, -size / 4, size * 0.8, 0, Math.PI * 2);
        ctx.arc(size / 2, -size / 4, size * 0.8, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === 'pine_tree') {
        // Thân cây
        ctx.fillStyle = '#4A2311';
        ctx.fillRect(-size / 4, 0, size / 2, size);
        // Tán lá nhọn
        ctx.fillStyle = '#145A32';
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.5);
        ctx.lineTo(size * 0.8, 0);
        ctx.lineTo(-size * 0.8, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -size * 2);
        ctx.lineTo(size * 0.6, -size * 0.5);
        ctx.lineTo(-size * 0.6, -size * 0.5);
        ctx.fill();
    } else if (type === 'snow_tree') {
        ctx.fillStyle = '#4A2311';
        ctx.fillRect(-size / 4, 0, size / 2, size);
        // Tán lá tuyết
        ctx.fillStyle = '#D6EAF8';
        ctx.beginPath();
        ctx.moveTo(0, -size * 1.5);
        ctx.lineTo(size * 0.8, 0);
        ctx.lineTo(-size * 0.8, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, -size * 2);
        ctx.lineTo(size * 0.6, -size * 0.5);
        ctx.lineTo(-size * 0.6, -size * 0.5);
        ctx.fill();
    } else if (type === 'cactus') {
        ctx.fillStyle = '#229954';
        ctx.fillRect(-size / 4, -size, size / 2, size * 2);
        ctx.fillRect(-size, -size / 4, size * 0.8, size / 3);
        ctx.fillRect(size / 4, -size * 0.6, size * 0.8, size / 3);
        ctx.fillRect(-size, -size / 2, size / 3, size / 2);
        ctx.fillRect(size, -size * 0.8, size / 3, size / 2);
    } else if (type === 'bush') {
        ctx.fillStyle = '#7D6608';
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
        ctx.arc(-size / 2, size / 4, size * 0.6, 0, Math.PI * 2);
        ctx.arc(size / 2, size / 4, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === 'dry_rock') {
        ctx.fillStyle = '#A04000';
        ctx.strokeStyle = '#6E2C00';
        ctx.lineWidth = 2;

        const r = size;
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(-r * 0.5, -r * 0.8);
        ctx.lineTo(r * 0.5, -r * 0.7);
        ctx.lineTo(r, 0);
        ctx.lineTo(r * 0.6, r * 0.6);
        ctx.lineTo(-r * 0.4, r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Add some geometric details inside
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.8);
        ctx.lineTo(0, 0);
        ctx.lineTo(r * 0.6, r * 0.6);
        ctx.stroke();
    } else if (type === 'ice_rock') {
        ctx.fillStyle = '#AED6F1';
        ctx.strokeStyle = '#2874A6';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.rect(-size, -size / 2, size * 2, size);
        ctx.fill();
        ctx.stroke();

        // Add a highlight
        ctx.beginPath();
        ctx.moveTo(-size + 5, -size / 2 + 5);
        ctx.lineTo(size - 5, -size / 2 + 5);
        ctx.strokeStyle = '#EBF5FB';
        ctx.lineWidth = 2;
        ctx.stroke();
    } else if (type === 'dead_tree') {
        ctx.strokeStyle = '#4A2311';
        ctx.lineWidth = size / 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0, size);
        ctx.lineTo(0, -size / 2);
        ctx.lineTo(-size / 2, -size);
        ctx.moveTo(0, -size / 4);
        ctx.lineTo(size / 2, -size * 0.8);
        ctx.stroke();
    }

    ctx.restore();
}

function drawBoat() {
    ctx.save();
    ctx.translate(boat.x, boat.y);
    ctx.rotate(boat.tilt);

    ctx.fillStyle = '#7B241C';
    ctx.strokeStyle = '#4A2311';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(-boat.width / 2, -boat.height / 2 + 10);
    ctx.lineTo(boat.width / 2, -boat.height / 2 + 10);
    ctx.lineTo(boat.width / 2 - 5, boat.height / 2);
    ctx.lineTo(-boat.width / 2 + 5, boat.height / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-boat.width / 2 + 2, 0);
    ctx.lineTo(boat.width / 2 - 2, 0);
    ctx.moveTo(-boat.width / 2 + 4, boat.height / 4);
    ctx.lineTo(boat.width / 2 - 4, boat.height / 4);
    ctx.strokeStyle = '#641E16';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-boat.width / 2, -boat.height / 2 + 10);
    ctx.lineTo(boat.width / 2, -boat.height / 2 + 10);
    ctx.lineTo(0, -boat.height / 2 - 10);
    ctx.closePath();
    ctx.fillStyle = '#922B21';
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#935116';
    ctx.fillRect(-2, -boat.height / 2, 4, boat.height - 10);
    ctx.strokeRect(-2, -boat.height / 2, 4, boat.height - 10);

    ctx.beginPath();
    ctx.moveTo(2, -boat.height / 2 + 5);
    ctx.lineTo(boat.width + 10, -5);
    ctx.lineTo(2, 5);
    ctx.closePath();
    ctx.fillStyle = '#FDFEFE';
    ctx.fill();
    ctx.strokeStyle = '#D0D3D4';
    ctx.stroke();

    ctx.restore();
}

function gameLoop() {
    if (!gameRunning || gamePaused) return;

    update();
    draw();
    requestAnimationFrame(gameLoop);
}
