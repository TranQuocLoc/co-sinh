/*
 * Wrist Rehabilitation System - ARDUINO NANO (PRECISION MODE)
 * -----------------------------------------------------------
 * - Fix lỗi "Stiction": Bù lực ma sát để motor quay chậm mượt mà.
 * - Hỗ trợ lệnh 'T' để cân bằng góc độ chính xác.
 */

#include <util/atomic.h>
#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219;

// --- BỘ LỌC DÒNG ĐIỆN (MOVING AVERAGE) ---
const int numReadings = 10;       // Lấy trung bình 10 lần đọc liên tiếp
float currentReadings[numReadings]; 
int readIndex = 0;
float totalCurrent = 0;
float averageCurrent = 0;

// --- CONFIGURATION ---
float SCALE_FACTOR = 0.8415; // Tăng thêm 2% từ 0.8250 để bù sai số tích lũy
int DEADBAND = 4;            // Giảm deadband để chính xác hơn nhưng sẽ bù bằng S-Curve
bool REVERSE_MOTOR = true;   

// PID Medical-Grade Smooth Constants
float Kp = 1.0;  // Giảm Kp để tránh "giật" phản ứng
float Ki = 0.15; // Tăng Ki để motor "trôi" êm về đích
float Kd = 2.0;  // Tăng mạnh Kd để giảm rung động cơ khí
float integral = 0;
float lastError = 0;

int MIN_MOVING_PWM = 70; // Lực khở i động êm

// Bộ lọc Alpha lọc cực mạnh
float alpha = 0.10; 
float targetSmoothed = 0;

// --- PINS ---
const int PIN_MASTER_A = 2; 
const int PIN_MASTER_B = 4;
const int PIN_SLAVE_A = 3;  
const int PIN_SLAVE_B = 5;

const int PIN_IN1 = 8;
const int PIN_IN2 = 9;
const int PIN_ENA = 10; 

// --- VARIABLES & FUNCTIONS ---
volatile long masterPos = 0;
volatile long slavePos = 0;

void readMaster() {
  if (digitalRead(PIN_MASTER_B) == LOW) masterPos--;
  else masterPos++;
}

void readSlave() {
  if (digitalRead(PIN_SLAVE_B) == LOW) slavePos--;
  else slavePos++;
}

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

  Serial.println("\n--- MEDICAL REHAB SYSTEM: ULTRA-SMOOTH V2 ---");

  // --- KHỞI TẠO INA219 ---
  if (!ina219.begin()) {
    Serial.println("LỖI: Không tìm thấy module INA219!");
    // Dừng hệ thống nếu không thấy cảm biến
    while (1) { delay(10); }
  }
  
  // Set thang đo 32V, 2A để đủ sức chịu tải dòng cao của GA25
  ina219.setCalibration_32V_2A();
  Serial.println("INA219 OK - Thang do: 32V_2A");

  // Khởi tạo mảng lọc giá trị về 0
  for (int i = 0; i < numReadings; i++) {
    currentReadings[i] = 0;
  }
} // Đóng hàm setup() tại đây

void loop() {
  handleSerial();

  long currentMaster, currentSlave;
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    currentMaster = masterPos;
    currentSlave = slavePos;
  }

  // 1. Target Smoothing cực mạnh (Lọc nhiễu tay người)
  long rawTarget = (long)(currentMaster * SCALE_FACTOR);
  targetSmoothed = (alpha * rawTarget) + ((1.0 - alpha) * targetSmoothed);

  // 2. PID
  float error = targetSmoothed - (float)currentSlave;

  if (abs(error) > DEADBAND) {
    integral = constrain(integral + error, -80, 80);
    float derivative = error - lastError;
    float output = (Kp * error) + (Ki * integral) + (Kd * derivative);
    
    if (REVERSE_MOTOR) output = -output;
    driveMotor(output);
  } else {
    driveMotor(0);
    integral = 0; 
  }
  lastError = error;

  // --- ĐỌC VÀ LỌC DÒNG ĐIỆN TỪ INA219 ---
  // Phải dùng millis() để giới hạn tần suất đọc I2C, nếu không sẽ làm delay vòng lặp PID!
  static unsigned long lastInaRead = 0;
  if (millis() - lastInaRead > 20) { // Đọc mỗi 20ms (tương đương 50 lần/giây)
    totalCurrent = totalCurrent - currentReadings[readIndex];
    currentReadings[readIndex] = ina219.getCurrent_mA();
    totalCurrent = totalCurrent + currentReadings[readIndex];
    readIndex = (readIndex + 1) % numReadings;
    averageCurrent = totalCurrent / numReadings; // Ra được dòng điện đã lọc mượt
    lastInaRead = millis();
  }

  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 250) {
    Serial.print("Master:"); Serial.print(currentMaster);
    Serial.print(" | Target:"); Serial.print(rawTarget);
    Serial.print(" | Slave:"); Serial.print(currentSlave);
    Serial.print(" | Scale:"); Serial.print(SCALE_FACTOR, 4);
    // In thêm dòng điện ra Serial Monitor
    Serial.print(" | Force(mA):"); Serial.println(averageCurrent, 1);
    lastPrint = millis();
  }
}

void driveMotor(float power) {
  float absPower = abs(power);
  if (absPower < 1) { 
    digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, LOW); analogWrite(PIN_ENA, 0);
    return;
  }

  // Hàm S-Curve đơn giản: PWM tăng dần chậm ở mức thấp để tránh "kick" giật
  // Thay vì map tuyến tính, ta dùng bình phương để lực vào êm hơn ở ngưỡng bắt đầu
  float normalized = constrain(absPower / 150.0, 0, 1); // 150 là ngưỡng lực tối đa cho mượt
  int pwmValue = MIN_MOVING_PWM + (int)((255 - MIN_MOVING_PWM) * (normalized * normalized));
  pwmValue = constrain(pwmValue, 0, 255);

  if (power > 0) { 
    digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW); 
  } else {
    digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, HIGH); 
  }
  analogWrite(PIN_ENA, pwmValue);
}

void handleSerial() {
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'S') SCALE_FACTOR = Serial.parseFloat();
    if (cmd == 'P') Kp = Serial.parseFloat();
    if (cmd == 'I') Ki = Serial.parseFloat();
    if (cmd == 'M') MIN_MOVING_PWM = Serial.parseInt(); // Chỉnh lực khởi động
    if (cmd == 'R') { ATOMIC_BLOCK(ATOMIC_RESTORESTATE) { masterPos = 0; slavePos = 0; targetSmoothed = 0; } }
    if (cmd == 'F') REVERSE_MOTOR = !REVERSE_MOTOR;
  }
}
