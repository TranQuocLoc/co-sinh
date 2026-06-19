/*
 * Wrist Rehabilitation System - ARDUINO NANO (PRECISION MODE)
 * -----------------------------------------------------------
 * v2.1 - DECELERATION CLUTCH
 * Thêm: Phát hiện tay đang hãm → giảm lực motor tỉ lệ thuận với tốc độ
 * → Không cần đợi timeout mới nhả lực, bệnh nhân đổi chiều dễ dàng hơn
 */

#include <Adafruit_INA219.h>
#include <Wire.h>
#include <util/atomic.h>

Adafruit_INA219 ina219;

const int numReadings = 10;
float currentReadings[numReadings];
int readIndex = 0;
float totalCurrent = 0;
float averageCurrent = 0;

// --- CONFIGURATION ---
float SCALE_FACTOR = -2.5245f;
int DEADBAND = 3;
bool REVERSE_MOTOR = false;

// Giới hạn góc an toàn (theo xung slave)
long limitMin = -999999;
long limitMax = 999999;

float Kp = 0.8;
float Ki = 0.0;
float Kd = 1.0;
float integral = 0;
float lastError = 0;

int MIN_MOVING_PWM = 60; // ↓ Giảm từ 60 → 40

float alpha = 0.5; // ↓ Giảm từ 0.5 → 0.15 (bám nhanh hơn)
float targetSmoothed = 0;

// --- CLUTCH TIMEOUT ---
unsigned long lastMasterMoveTime = 0;
long lastMasterPosCheck = 0;
int STOP_TIMEOUT_MS = 30; // ↓ Giảm từ 100 → 30ms

long masterBase = 0;
long slaveBase = 0;

// ★ DECELERATION CLUTCH - Biến mới ★
float masterVel = 0;           // Vận tốc hiện tại (ticks/s)
float masterVelPrev = 0;       // Vận tốc chu kỳ trước
long masterPosPrev = 0;        // Vị trí master chu kỳ trước
unsigned long velCalcTime = 0; // Thời điểm tính vel lần cuối
float VEL_MAX = 80.0f;         // Ngưỡng "đang chạy nhanh" — chỉnh theo thực tế

// --- PINS ---
const int PIN_MASTER_A = 2;
const int PIN_MASTER_B = 4;
const int PIN_SLAVE_A = 3;
const int PIN_SLAVE_B = 5;
const int PIN_IN1 = 8;
const int PIN_IN2 = 9;
const int PIN_ENA = 10;

volatile long masterPos = 0;
volatile long slavePos = 0;

void readMaster() {
  if (digitalRead(PIN_MASTER_B) == LOW)
    masterPos++;
  else
    masterPos--;
}

void readSlave() {
  if (digitalRead(PIN_SLAVE_B) == LOW)
    slavePos++;
  else
    slavePos--;
}

// ============================================================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_ENA, OUTPUT);

  pinMode(PIN_MASTER_A, INPUT_PULLUP);
  pinMode(PIN_MASTER_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_MASTER_A), readMaster, RISING);

  pinMode(PIN_SLAVE_A, INPUT_PULLUP);
  pinMode(PIN_SLAVE_B, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_SLAVE_A), readSlave, RISING);

  Serial.println(F("\n--- MEDICAL REHAB v2.1: DECEL CLUTCH ---"));

  if (!ina219.begin()) {
    Serial.println(F("LOI: Khong tim thay INA219!"));
    while (1) {
      delay(10);
    }
  }
  ina219.setCalibration_32V_2A();
  Serial.println(F("INA219 OK - 32V_2A"));
  for (int i = 0; i < numReadings; i++)
    currentReadings[i] = 0;
}

// ============================================================
void loop() {
  handleSerial();

  long currentMaster, currentSlave;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    currentMaster = masterPos;
    currentSlave = slavePos;
  }

  unsigned long now = millis();

  // ★ 0. TÍNH VẬN TỐC MASTER (mỗi 20ms) ★
  if (now - velCalcTime >= 20) {
    float dt_s = (now - velCalcTime) / 1000.0f;
    masterVelPrev = masterVel;
    masterVel = (currentMaster - masterPosPrev) / dt_s; // ticks/s
    masterPosPrev = currentMaster;
    velCalcTime = now;
  }

  // ★ DECEL FACTOR: tỉ lệ lực theo tốc độ hiện tại ★
  // velScale = 0 khi đứng yên, = 1 khi đạt VEL_MAX
  // → Motor tự động nhả lực khi tay chậm lại, TRƯỚC khi timeout
  float velScale = constrain(abs(masterVel) / VEL_MAX, 0.0f, 1.0f);

  // 1. KIỂM TRA CHUYỂN ĐỘNG VÀ ĐẢO CHIỀU
  static int lastMasterDirection = 0;

  if (abs(currentMaster - lastMasterPosCheck) > 0) {
    int currentDirection = (currentMaster > lastMasterPosCheck) ? 1 : -1;

    if (currentDirection != lastMasterDirection) {
      masterBase = currentMaster;
      slaveBase = currentSlave;
      lastMasterDirection = currentDirection;
      targetSmoothed = (float)currentSlave;
      integral = 0;
      driveMotor(0); // ★ Ngắt lực NGAY khi phát hiện đảo chiều
    }

    lastMasterPosCheck = currentMaster;
    lastMasterMoveTime = now;
  }

  // 2. QUỸ ĐẠO MỤC TIÊU
  long rawTarget =
      slaveBase + (long)((currentMaster - masterBase) * SCALE_FACTOR);

  // ★ GIỚI HẠN TARGET THEO GÓC AN TOÀN ★
  long actMin = min(limitMin, limitMax);
  long actMax = max(limitMin, limitMax);
  rawTarget = constrain(rawTarget, actMin, actMax);

  targetSmoothed = (alpha * rawTarget) + ((1.0f - alpha) * targetSmoothed);

  // 3. CLUTCH TIMEOUT (backup nếu decel không đủ)
  if (now - lastMasterMoveTime > STOP_TIMEOUT_MS) {
    targetSmoothed = (float)currentSlave;
    masterBase = currentMaster;
    slaveBase = currentSlave;
    integral = 0;
    lastError = 0;

    // ★ KIỂM TRA VƯỢT GÓC AN TOÀN KHI THẢ LỎNG ★
    if (currentSlave < actMin) {
      targetSmoothed = (float)actMin;
    } else if (currentSlave > actMax) {
      targetSmoothed = (float)actMax;
    } else {
      driveMotor(0);
      return; // Thoát sớm, không chạy PID
    }
  }

  // 4. PID + DECEL SCALE
  float error = targetSmoothed - (float)currentSlave;

  if (abs(error) > DEADBAND) {
    float derivative = error - lastError;
    float output = (Kp * error) + (Ki * integral) + (Kd * derivative);

    output = constrain(output, -35.0f, 35.0f); // ↓ Giảm từ ±60 → ±35

    // ★ Nếu đang vượt ngoài góc an toàn, bỏ qua decel clutch để tạo lực cản
    bool outOfBounds = (currentSlave < actMin || currentSlave > actMax);
    if (!outOfBounds) {
      output = output * velScale;
    }

    if (REVERSE_MOTOR)
      output = -output;
    driveMotor(output);
  } else {
    driveMotor(0);
    integral = 0;
  }
  lastError = error;

  // 5. ĐỌC DÒNG INA219
  static unsigned long lastInaRead = 0;
  if (now - lastInaRead > 20) {
    totalCurrent -= currentReadings[readIndex];
    currentReadings[readIndex] = ina219.getCurrent_mA();
    totalCurrent += currentReadings[readIndex];
    readIndex = (readIndex + 1) % numReadings;
    averageCurrent = totalCurrent / numReadings;
    lastInaRead = now;
  }

  // 6. SERIAL LOG
  static unsigned long lastPrint = 0;
  if (now - lastPrint > 20) {
    Serial.print(F("M:"));
    Serial.print(currentMaster);
    Serial.print(F(" T:"));
    Serial.print(rawTarget);
    Serial.print(F(" S:"));
    Serial.print(currentSlave);
    Serial.print(F(" Vel:"));
    Serial.print(masterVel, 1);
    Serial.print(F(" vScale:"));
    Serial.print(velScale, 2);
    Serial.print(F(" F(mA):"));
    Serial.println(averageCurrent, 1);
    lastPrint = now;
  }
}


void driveMotor(float power) {
  float absPower = abs(power);
  if (absPower < 1.0f) {
    digitalWrite(PIN_IN1, LOW);
    digitalWrite(PIN_IN2, LOW);
    analogWrite(PIN_ENA, 0);
    return;
  }

  float normalized = constrain(absPower / 500.0f, 0, 1);
  int pwmValue = MIN_MOVING_PWM +
                 (int)((255 - MIN_MOVING_PWM) * (normalized * normalized));
  pwmValue = constrain(pwmValue, 0, 100);

  if (power > 0) {
    digitalWrite(PIN_IN1, HIGH);
    digitalWrite(PIN_IN2, LOW);
  } else {
    digitalWrite(PIN_IN1, LOW);
    digitalWrite(PIN_IN2, HIGH);
  }
  analogWrite(PIN_ENA, pwmValue);
}

void handleSerial() {
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'S')
      SCALE_FACTOR = Serial.parseFloat();
    if (cmd == 'P')
      Kp = Serial.parseFloat();
    if (cmd == 'I')
      Ki = Serial.parseFloat();
    if (cmd == 'M')
      MIN_MOVING_PWM = Serial.parseInt();
    if (cmd == 'V')
      VEL_MAX = Serial.parseFloat(); // ★ Chỉnh VEL_MAX qua Serial
    if (cmd == 'R') {
      ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
        masterPos = 0;
        slavePos = 0;
        targetSmoothed = 0;
        masterBase = 0;
        slaveBase = 0;
      }
      masterVel = 0;
      masterVelPrev = 0;
      limitMin = -999999;
      limitMax = 999999;
    }
    if (cmd == 'F') {
      SCALE_FACTOR = -SCALE_FACTOR;
      long sNow;
      ATOMIC_BLOCK(ATOMIC_RESTORESTATE) { sNow = slavePos; }
      targetSmoothed = (float)sNow;
      integral = 0;
      lastError = 0;
      driveMotor(0);
      Serial.print(F("DAO CHIEU -> Scale: "));
      Serial.println(SCALE_FACTOR, 4);
    }
    if (cmd == 'L') {
      limitMin = Serial.parseInt();
      Serial.print(F("Limit MIN: "));
      Serial.println(limitMin);
    }
    if (cmd == 'U') {
      limitMax = Serial.parseInt();
      Serial.print(F("Limit MAX: "));
      Serial.println(limitMax);
    }
  }
}
