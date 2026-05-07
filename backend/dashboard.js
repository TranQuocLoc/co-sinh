/* ═══════════════════════════════════════
   DASHBOARD REHAB CỔ TAY — JavaScript
   ═══════════════════════════════════════ */

const API = 'http://localhost:5000/api';
let selectedPatientId = null;
let editingPatientId  = null; // null = tạo mới, number = đang sửa
let angleChart        = null;
let currentSessionId  = null;

// ─────────────────────────────────────────────────────────
//  DANH SÁCH BỆNH NHÂN
// ─────────────────────────────────────────────────────────
async function loadPatients() {
    try {
        const res = await fetch(`${API}/patients`);
        const patients = await res.json();
        const list = document.getElementById('patient-list');
        list.innerHTML = '';
        patients.forEach(p => {
            const el = document.createElement('div');
            el.className = 'patient-card' + (p.id === selectedPatientId ? ' active' : '');
            el.innerHTML = `<div class="name">${p.name}</div>
                            <div class="meta">Hồ sơ: ${p.created_at.split(' ')[0]}</div>`;
            el.onclick = () => selectPatient(p.id, p.name);
            list.appendChild(el);
        });
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
    } catch {
        document.getElementById('last-update').textContent = '⚠️ Mất kết nối server';
    }
}

// ─────────────────────────────────────────────────────────
//  CHỌN BỆNH NHÂN
// ─────────────────────────────────────────────────────────
async function selectPatient(id, name) {
    selectedPatientId = id;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('patient-detail').style.display = 'block';
    document.querySelectorAll('.patient-card').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.patient-card').forEach(c => {
        if (c.querySelector('.name').textContent === name) c.classList.add('active');
    });

    // Reset biểu đồ và Notes
    resetChartAndNotes();

    // Thông tin bệnh nhân
    const pRes = await fetch(`${API}/patients/${id}`);
    const pData = await pRes.json();
    document.getElementById('patient-fullname').textContent = pData.name;
    const dob  = pData.dob       ? ` • SN: ${pData.dob}`              : '';
    const diag = pData.diagnosis ? ` • Chẩn đoán: ${pData.diagnosis}` : '';
    document.getElementById('patient-meta').textContent =
        `Hồ sơ tạo: ${pData.created_at.split(' ')[0]}${dob}${diag}`;

    // Phiên tập
    const res = await fetch(`${API}/patients/${id}/sessions`);
    const sessions = await res.json();
    renderSessions(sessions);
}

// ─────────────────────────────────────────────────────────
//  RENDER BẢNG PHIÊN TẬP (dùng chung)
// ─────────────────────────────────────────────────────────
function renderSessions(sessions) {
    // Cập nhật thống kê
    const totalTime = sessions.reduce((s, x) => s + (x.duration_s || 0), 0);
    const bestScore = sessions.reduce((s, x) => Math.max(s, x.final_score || 0), 0);
    const maxLeft   = sessions.reduce((s, x) => Math.min(s, x.max_left_deg || 0), 0);
    document.getElementById('stat-sessions').textContent   = sessions.length;
    document.getElementById('stat-total-time').textContent = (totalTime / 60).toFixed(1);
    document.getElementById('stat-best-score').textContent = bestScore;
    document.getElementById('stat-max-angle').textContent  = maxLeft.toFixed(1) + '°';

    // Render bảng
    const tbody = document.getElementById('session-table');
    tbody.innerHTML = '';
    sessions.forEach((s, i) => {
        const sessionNo = sessions.length - i; // mới nhất lên trên
        // Format "20/03 11:05" từ created_at "2026-03-20 11:05:23"
        const dt   = new Date(s.created_at.replace(' ', 'T'));
        const dtStr = `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge badge-blue">Lần ${sessionNo}</span></td>
            <td>${dtStr}</td>
            <td>${(s.duration_s || 0).toFixed(1)}s</td>
            <td style="color:#ef5350">${(s.max_left_deg  || 0).toFixed(1)}°</td>
            <td style="color:#4caf50">${(s.max_right_deg || 0).toFixed(1)}°</td>
            <td><span class="badge badge-green">${s.final_score || 0}</span></td>
            <td><button onclick="deleteSession(${s.id}, event)"
                style="background:transparent;border:none;color:#ef5350;cursor:pointer;font-size:1rem;"
                title="Xóa phiên này">🗑</button></td>`;
        tr.onclick = () => loadChart(s.id, dtStr, sessionNo);
        tbody.appendChild(tr);
    });
}

// ─────────────────────────────────────────────────────────
//  AUTO-REFRESH (chỉ cập nhật stats + bảng, không reset chart)
// ─────────────────────────────────────────────────────────
async function refreshStats() {
    if (!selectedPatientId) return;
    const res = await fetch(`${API}/patients/${selectedPatientId}/sessions`);
    const sessions = await res.json();
    renderSessions(sessions);
}

// ─────────────────────────────────────────────────────────
//  BIỂU ĐỒ GÓC CỔ TAY
// ─────────────────────────────────────────────────────────
async function loadChart(sessionId, date, sessionNo) {
    currentSessionId = sessionId;
    document.getElementById('chart-title').textContent =
        `Biểu Đồ Góc Cổ Tay — Lần ${sessionNo} (${date})`;

    const res  = await fetch(`${API}/sessions/${sessionId}/telemetry`);
    const data = await res.json();

    const labels = data.map(d => d.t_seconds + 's');
    const angles = data.map(d => d.angle_deg);

    if (angleChart) angleChart.destroy();
    const ctx = document.getElementById('angle-chart').getContext('2d');
    angleChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Góc cổ tay (°)',
                data: angles,
                borderColor: '#00bcd4',
                backgroundColor: 'rgba(0,188,212,0.08)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: '#e0e0e0' } } },
            scales: {
                x: { ticks: { color: '#607d8b', maxTicksLimit: 15 }, grid: { color: '#1e3040' } },
                y: {
                    ticks: { color: '#607d8b', callback: v => v + '°' },
                    grid:  { color: '#1e3040' },
                    title: { display: true, text: 'Góc (độ)', color: '#607d8b' }
                }
            }
        }
    });

    // Load ghi chú cũ
    const sRes     = await fetch(`${API}/patients/${selectedPatientId}/sessions`);
    const sessions = await sRes.json();
    const session  = sessions.find(s => s.id === sessionId);
    const notesEl  = document.getElementById('session-notes');
    const btnEl    = document.getElementById('save-notes-btn');
    notesEl.value    = session?.notes || '';
    notesEl.disabled = false;
    btnEl.disabled   = false;
    document.getElementById('notes-status').textContent = '';
}

function resetChartAndNotes() {
    currentSessionId = null;
    if (angleChart) { angleChart.destroy(); angleChart = null; }
    document.getElementById('chart-title').textContent   = 'Biểu Đồ Góc Cổ Tay — Chọn một phiên tập bên trên';
    const notesEl = document.getElementById('session-notes');
    notesEl.value    = '';
    notesEl.disabled = true;
    document.getElementById('save-notes-btn').disabled  = true;
    document.getElementById('notes-status').textContent = '';
}

// ─────────────────────────────────────────────────────────
//  GHI CHÚ BÁC SĨ
// ─────────────────────────────────────────────────────────
async function saveNotes() {
    if (!currentSessionId) return;
    const notes    = document.getElementById('session-notes').value;
    const statusEl = document.getElementById('notes-status');
    statusEl.textContent = 'Đang lưu...';
    try {
        await fetch(`${API}/sessions/${currentSessionId}/notes`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
        });
        statusEl.textContent = '✅ Đã lưu lúc ' + new Date().toLocaleTimeString();
        statusEl.style.color = '#4caf50';
    } catch {
        statusEl.textContent = '⚠️ Lưu thất bại';
        statusEl.style.color = '#ef5350';
    }
}

// ─────────────────────────────────────────────────────────
//  MODAL THÊM / SỬA BỆNH NHÂN
// ─────────────────────────────────────────────────────────
function openNewPatientModal() {
    editingPatientId = null;
    document.getElementById('modal-title').textContent = '👤 Thêm Bệnh Nhân Mới';
    document.getElementById('modal-name').value        = '';
    document.getElementById('modal-dob').value         = '';
    document.getElementById('modal-diagnosis').value   = '';
    document.getElementById('patient-modal').classList.add('open');
}

async function openEditPatientModal() {
    if (!selectedPatientId) return;
    editingPatientId = selectedPatientId;
    const res = await fetch(`${API}/patients/${selectedPatientId}`);
    const p   = await res.json();
    document.getElementById('modal-title').textContent   = `✏️ Sửa hồ sơ: ${p.name}`;
    document.getElementById('modal-name').value          = p.name      || '';
    document.getElementById('modal-dob').value           = p.dob       || '';
    document.getElementById('modal-diagnosis').value     = p.diagnosis || '';
    document.getElementById('patient-modal').classList.add('open');
}

function closeModal() {
    document.getElementById('patient-modal').classList.remove('open');
}

async function savePatientModal() {
    const name = document.getElementById('modal-name').value.trim();
    if (!name) { alert('Vui lòng nhập tên bệnh nhân!'); return; }
    const body = {
        name,
        dob:       document.getElementById('modal-dob').value,
        diagnosis: document.getElementById('modal-diagnosis').value
    };
    if (editingPatientId) {
        await fetch(`${API}/patients/${editingPatientId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        closeModal();
        selectPatient(editingPatientId, name);
    } else {
        const res  = await fetch(`${API}/patients`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
        const data = await res.json();
        closeModal();
        selectPatient(data.id, name);
    }
    loadPatients();
}

// ─────────────────────────────────────────────────────────
//  XÓA BỆNH NHÂN
// ─────────────────────────────────────────────────────────
async function deleteCurrentPatient() {
    if (!selectedPatientId) return;
    const name = document.getElementById('patient-fullname').textContent;
    if (!confirm(`⚠️ Xác nhận xóa toàn bộ hồ sơ của "${name}"?\n\nHành động này sẽ xóa tất cả phiên tập và dữ liệu góc của bệnh nhân này.`)) return;
    await fetch(`${API}/patients/${selectedPatientId}`, { method: 'DELETE' });
    selectedPatientId = null;
    document.getElementById('patient-detail').style.display = 'none';
    document.getElementById('empty-state').style.display    = 'block';
    loadPatients();
}

// ─────────────────────────────────────────────────────────
//  XÓA PHIÊN TẬP
// ─────────────────────────────────────────────────────────
async function deleteSession(sid, event) {
    event.stopPropagation();
    if (!confirm(`Xóa phiên tập này?`)) return;
    await fetch(`${API}/sessions/${sid}`, { method: 'DELETE' });
    if (currentSessionId === sid) resetChartAndNotes();
    refreshStats();
}

// ─────────────────────────────────────────────────────────
//  KHỞI ĐỘNG
// ─────────────────────────────────────────────────────────
loadPatients();
setInterval(() => {
    loadPatients();
    refreshStats();
}, 10000);
