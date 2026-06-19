"""
🏥 REHAB DEVICE - LOCAL DATA SERVER
Flask + SQLite Backend
Chạy: python server.py
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, os, datetime

app = Flask(__name__)
CORS(app)  # Cho phép Game Web (file://) gọi API

DB_PATH = os.path.join(os.path.dirname(__file__), "rehab_data.db")

# ─────────────────────────────────────────────
#  KHỞI TẠO DATABASE & CÁC BẢNG
# ─────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Trả dict thay vì tuple
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    # Bảng danh sách bệnh nhân
    c.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            dob         TEXT,
            diagnosis   TEXT,
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
        )
    """)

    # Bảng mỗi phiên tập (patient_id có thể NULL nếu chưa chọn bệnh nhân)
    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id      INTEGER REFERENCES patients(id),
            date            TEXT    NOT NULL,
            duration_s      REAL,
            max_left_deg    REAL,
            max_right_deg   REAL,
            final_score     INTEGER,
            notes           TEXT    DEFAULT '',
            created_at      TEXT    DEFAULT (datetime('now','localtime'))
        )
    """)
    # Thêm cột notes nếu DB cũ chưa có (tương thích ngược)
    try:
        c.execute("ALTER TABLE sessions ADD COLUMN notes TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass  # Cột đã tồn tại rồi, bỏ qua


    # Bảng dữ liệu góc từng điểm thời gian
    c.execute("""
        CREATE TABLE IF NOT EXISTS telemetry (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  INTEGER NOT NULL REFERENCES sessions(id),
            t_seconds   REAL,
            angle_deg   REAL,
            score       INTEGER,
            lives       INTEGER
        )
    """)

    try:
        c.execute("ALTER TABLE telemetry ADD COLUMN force_n REAL DEFAULT 0")
        c.execute("ALTER TABLE telemetry ADD COLUMN current_ma REAL DEFAULT 0")
        conn.commit()
    except Exception:
        pass

    conn.commit()
    conn.close()
    print(f"✅ Database sẵn sàng tại: {DB_PATH}")


# ─────────────────────────────────────────────
#  API: QUẢN LÝ BỆNH NHÂN
# ─────────────────────────────────────────────
@app.route("/api/patients", methods=["GET"])
def get_patients():
    """Lấy danh sách tất cả bệnh nhân"""
    conn = get_db()
    rows = conn.execute("SELECT * FROM patients ORDER BY name").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/patients", methods=["POST"])
def create_patient():
    """Tạo bệnh nhân mới"""
    data = request.json
    if not data or not data.get("name"):
        return jsonify({"error": "Thiếu tên bệnh nhân"}), 400

    conn = get_db()
    cur = conn.execute(
        "INSERT INTO patients (name, dob, diagnosis) VALUES (?,?,?)",
        (data["name"], data.get("dob", ""), data.get("diagnosis", ""))
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"id": new_id, "message": "Tạo bệnh nhân thành công"}), 201


@app.route("/api/patients/find-or-create", methods=["POST"])
def find_or_create_patient():
    """Tìm bệnh nhân theo tên, nếu chưa có thì tạo mới"""
    data = request.json
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Thiếu tên"}), 400

    conn = get_db()
    row = conn.execute(
        "SELECT * FROM patients WHERE name = ? COLLATE NOCASE LIMIT 1", (name,)
    ).fetchone()

    if row:
        conn.close()
        return jsonify({"id": row["id"], "name": row["name"], "created": False})

    cur = conn.execute(
        "INSERT INTO patients (name) VALUES (?)", (name,)
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"id": new_id, "name": name, "created": True}), 201


@app.route("/api/patients/<int:pid>", methods=["GET"])
def get_patient(pid):
    """Lấy thông tin chi tiết 1 bệnh nhân"""
    conn = get_db()
    row = conn.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row: return jsonify({"error": "Không tìm thấy"}), 404
    return jsonify(dict(row))


@app.route("/api/patients/<int:pid>", methods=["PATCH"])
def update_patient(pid):
    """Cập nhật thông tin bệnh nhân"""
    data = request.json
    conn = get_db()
    conn.execute(
        "UPDATE patients SET name=?, dob=?, diagnosis=? WHERE id=?",
        (data.get("name", ""), data.get("dob", ""), data.get("diagnosis", ""), pid)
    )
    conn.commit()
    conn.close()
    return jsonify({"message": "Cập nhật thành công"})


@app.route("/api/patients/<int:pid>", methods=["DELETE"])
def delete_patient(pid):
    """Xóa bệnh nhân và toàn bộ dữ liệu liên quan"""
    conn = get_db()
    # Xóa telemetry → sessions → patient
    conn.execute("DELETE FROM telemetry WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=?)", (pid,))
    conn.execute("DELETE FROM sessions WHERE patient_id=?", (pid,))
    conn.execute("DELETE FROM patients WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Xóa thành công"})


@app.route("/api/sessions/<int:sid>", methods=["DELETE"])
def delete_session(sid):
    """Xóa 1 phiên tập và telemetry của nó"""
    conn = get_db()
    conn.execute("DELETE FROM telemetry WHERE session_id=?", (sid,))
    conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"message": "Xóa phiên tập thành công"})



# ─────────────────────────────────────────────
#  API: PHIÊN TẬP + TELEMETRY (GỬI MỘT LẦN)
# ─────────────────────────────────────────────
@app.route("/api/sessions", methods=["POST"])
def save_session():
    """
    Game gửi toàn bộ dữ liệu phiên tập sau khi Game Over.
    Body JSON:
    {
      "patient_id": 1,
      "duration_s": 125.4,
      "max_left_deg": -35.0,
      "max_right_deg": 28.0,
      "final_score": 480,
      "telemetry": [
          {"t": 0.5, "angle": -2.1, "score": 0, "lives": 3},
          ...
      ]
    }
    """
    data = request.json
    if not data:
        return jsonify({"error": "Không có dữ liệu"}), 400

    today = datetime.date.today().isoformat()
    conn = get_db()

    # Lưu phiên tập
    cur = conn.execute(
        """INSERT INTO sessions
           (patient_id, date, duration_s, max_left_deg, max_right_deg, final_score, rom_cm)
           VALUES (?,?,?,?,?,?,?)""",
        (data.get("patient_id"),
         today,
         data.get("duration_s", 0),
         data.get("max_left_deg", 0),
         data.get("max_right_deg", 0),
         data.get("final_score", 0),
         data.get("rom_cm", 0))
    )
    session_id = cur.lastrowid

    # Lưu từng điểm telemetry
    rows = [(session_id, t.get("t", 0), t.get("angle", 0),
             t.get("score", 0), t.get("lives", 0),
             t.get("force_n", 0), t.get("current_ma", 0))
            for t in data.get("telemetry", [])]
    conn.executemany(
        "INSERT INTO telemetry (session_id,t_seconds,angle_deg,score,lives,force_n,current_ma) VALUES (?,?,?,?,?,?,?)",
        rows
    )

    conn.commit()
    conn.close()
    return jsonify({"session_id": session_id, "message": "Lưu phiên tập thành công"}), 201


# ─────────────────────────────────────────────
#  API: TRA CỨU HỒ SƠ
# ─────────────────────────────────────────────
@app.route("/api/patients/<int:pid>/sessions", methods=["GET"])
def get_sessions(pid):
    """Lấy lịch sử các phiên tập của 1 bệnh nhân"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM sessions WHERE patient_id=? ORDER BY date DESC, id DESC",
        (pid,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/sessions/<int:sid>/telemetry", methods=["GET"])
def get_telemetry(sid):
    """Lấy dữ liệu góc chi tiết của 1 phiên tập"""
    conn = get_db()
    rows = conn.execute(
        "SELECT t_seconds, angle_deg, score, lives, force_n, current_ma FROM telemetry WHERE session_id=? ORDER BY t_seconds",
        (sid,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/sessions/<int:sid>/notes", methods=["PATCH"])
def save_notes(sid):
    """Bác sĩ lưu ghi chú vào 1 phiên tập"""
    data = request.json
    notes = data.get("notes", "")
    conn = get_db()
    conn.execute("UPDATE sessions SET notes=? WHERE id=?", (notes, sid))
    conn.commit()
    conn.close()
    return jsonify({"message": "Đã lưu ghi chú"})


# ─────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print("🚀 Server đang chạy tại: http://localhost:5000")
    print("   Nhấn Ctrl+C để tắt server.")
    app.run(host="localhost", port=5000, debug=False)
