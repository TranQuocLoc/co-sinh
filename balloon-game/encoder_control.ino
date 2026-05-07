/*
  Arduino Sketch for Rotary Encoder Control
  Sends 'L' for Left (Counter-Clockwise) and 'R' for Right (Clockwise)
*/

const int pinA = 2; // Connect to Encoder Phase A
const int pinB = 3; // Connect to Encoder Phase B

volatile int lastStateA;

void setup() {
  pinMode(pinA, INPUT_PULLUP);
  pinMode(pinB, INPUT_PULLUP);
  
  Serial.begin(115200); // Higher baud rate for lower latency
  
  lastStateA = digitalRead(pinA);
  
  // Attach interrupt to pin A
  attachInterrupt(digitalPinToInterrupt(pinA), handleEncoder, CHANGE);
}

void loop() {
  // Nothing needed in loop
}

void handleEncoder() {
  int currentStateA = digitalRead(pinA);
  
  // If state changed, check direction
  if (currentStateA != lastStateA) {
    // If state A is different from state B, it's rotating clockwise
    if (digitalRead(pinB) != currentStateA) {
      Serial.print("R");
    } else {
      Serial.print("L");
    }
  }
  lastStateA = currentStateA;
}
