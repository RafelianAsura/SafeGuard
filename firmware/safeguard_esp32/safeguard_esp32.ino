#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <math.h>
#include "config.h"

#if TEMP_SENSOR_TYPE != SG_TEMP_SENSOR_DS18B20 && TEMP_SENSOR_TYPE != SG_TEMP_SENSOR_DHT22
#error "Set TEMP_SENSOR_TYPE to SG_TEMP_SENSOR_DS18B20 or SG_TEMP_SENSOR_DHT22 in config.h"
#endif

Adafruit_MPU6050 mpu;
#if TEMP_SENSOR_TYPE == SG_TEMP_SENSOR_DS18B20
OneWire oneWire(DS18B20_DATA_PIN);
DallasTemperature temperatureSensor(&oneWire);
#else
DHT temperatureSensor(DHT22_DATA_PIN, DHT22);
#endif

float gravityX = 0;
float gravityY = 0;
float gravityZ = 0;
bool gravityInitialized = false;
uint32_t lastSendAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMotionSampleAt = 0;
float peakVibrationG = 0;
bool motionSampleReady = false;

bool readVibrationG(float &vibrationG) {
  sensors_event_t acceleration;
  sensors_event_t gyro;
  sensors_event_t temperature;
  mpu.getEvent(&acceleration, &gyro, &temperature);

  const float x = acceleration.acceleration.x / SENSORS_GRAVITY_STANDARD;
  const float y = acceleration.acceleration.y / SENSORS_GRAVITY_STANDARD;
  const float z = acceleration.acceleration.z / SENSORS_GRAVITY_STANDARD;
  const uint32_t now = millis();
  if (!isfinite(x) || !isfinite(y) || !isfinite(z)) return false;

  if (!gravityInitialized) {
    gravityX = x;
    gravityY = y;
    gravityZ = z;
    gravityInitialized = true;
    lastMotionSampleAt = now;
    vibrationG = 0;
    return true;
  }

  const float elapsedSeconds = max(0.001f, (now - lastMotionSampleAt) / 1000.0f);
  const float alpha = elapsedSeconds / (0.8f + elapsedSeconds);
  gravityX += alpha * (x - gravityX);
  gravityY += alpha * (y - gravityY);
  gravityZ += alpha * (z - gravityZ);
  lastMotionSampleAt = now;

  const float dynamicX = x - gravityX;
  const float dynamicY = y - gravityY;
  const float dynamicZ = z - gravityZ;
  vibrationG = sqrtf(dynamicX * dynamicX + dynamicY * dynamicY + dynamicZ * dynamicZ);
  return isfinite(vibrationG);
}

bool readTemperatureC(float &temperatureC) {
#if TEMP_SENSOR_TYPE == SG_TEMP_SENSOR_DS18B20
  temperatureSensor.requestTemperatures();
  temperatureC = temperatureSensor.getTempCByIndex(0);
  return temperatureC != DEVICE_DISCONNECTED_C && isfinite(temperatureC);
#else
  temperatureC = temperatureSensor.readTemperature();
  return isfinite(temperatureC);
#endif
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const uint32_t now = millis();
  if (now - lastWifiAttemptAt < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiAttemptAt = now;
  Serial.printf("[WiFi] Disconnected; reconnecting to %s\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

template <typename ClientType>
int postReading(ClientType &client, const String &payload) {
  HTTPClient http;
  http.setTimeout(REQUEST_TIMEOUT_MS);
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("[HTTP] Could not initialize request URL.");
    return -1;
  }
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) http.addHeader("x-api-key", API_KEY);
  const int statusCode = http.POST(payload);
  Serial.printf("[HTTP] Status %d\n", statusCode);
  if (statusCode > 0) Serial.printf("[HTTP] Response: %s\n", http.getString().c_str());
  http.end();
  return statusCode;
}

int postWithRetry(const String &payload) {
  const bool useHttps = String(SERVER_URL).startsWith("https://");
  for (int attempt = 1; attempt <= 3; attempt++) {
    int statusCode;
    if (useHttps) {
      if (strlen(SERVER_ROOT_CA) == 0) {
        Serial.println("[TLS] HTTPS needs SERVER_ROOT_CA in config.h; no request sent.");
        return -1;
      }
      WiFiClientSecure client;
      client.setCACert(SERVER_ROOT_CA);
      statusCode = postReading(client, payload);
    } else if (String(SERVER_URL).startsWith("http://")) {
      WiFiClient client;
      statusCode = postReading(client, payload);
    } else {
      Serial.println("[HTTP] SERVER_URL must start with http:// or https://.");
      return -1;
    }

    if (statusCode >= 200 && statusCode < 300) return statusCode;
    if (statusCode >= 400 && statusCode < 500) {
      Serial.println("[HTTP] Client error; check API key, payload, and endpoint.");
      return statusCode;
    }
    if (attempt < 3) {
      const uint32_t backoffMs = 500U * attempt;
      Serial.printf("[HTTP] Retry %d/2 in %lu ms\n", attempt, static_cast<unsigned long>(backoffMs));
      delay(backoffMs);
    }
  }
  return -1;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!mpu.begin()) {
    Serial.println("[Sensor] MPU6050 not found; check I2C wiring.");
    while (true) delay(1000);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

#if TEMP_SENSOR_TYPE == SG_TEMP_SENSOR_DS18B20
  temperatureSensor.begin();
#else
  temperatureSensor.begin();
#endif

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  Serial.printf("[WiFi] Connecting to %s\n", WIFI_SSID);
  Serial.printf("[Device] Room: %s\n[Device] POST: %s\n[Device] Interval: %lu ms\n",
                ROOM_NAME, SERVER_URL, static_cast<unsigned long>(SEND_INTERVAL_MS));
}

void loop() {
  maintainWifi();
  const uint32_t now = millis();
  if (now - lastMotionSampleAt >= MPU_SAMPLE_INTERVAL_MS) {
    float sampleVibrationG;
    if (readVibrationG(sampleVibrationG)) {
      peakVibrationG = max(peakVibrationG, sampleVibrationG);
      motionSampleReady = true;
    }
  }
  if (now - lastSendAt < SEND_INTERVAL_MS) {
    delay(20);
    return;
  }
  lastSendAt = now;
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Still disconnected; skipping this sensor upload.");
    return;
  }

  const float vibrationG = peakVibrationG;
  float temperatureC;
  if (!motionSampleReady) {
    Serial.println("[Sensor] No valid MPU6050 sample; upload skipped.");
    return;
  }
  if (!readTemperatureC(temperatureC)) {
    Serial.println("[Sensor] Temperature reading invalid; upload skipped.");
    return;
  }
  const int smoke = analogRead(MQ2_ANALOG_PIN);
  const int gas = analogRead(GAS_ANALOG_PIN);
  const String payload = String("{\"room\":\"") + ROOM_NAME +
    "\",\"vibration\":" + String(vibrationG, 4) +
    ",\"smoke\":" + String(smoke) +
    ",\"temperature\":" + String(temperatureC, 2) +
    ",\"gas\":" + String(gas) + "}";

  Serial.printf("[Sensor] room=%s vibration=%.4f g smoke=%d scale temperature=%.2f C gas=%d scale\n",
                ROOM_NAME, vibrationG, smoke, temperatureC, gas);
  const int statusCode = postWithRetry(payload);
  if (statusCode >= 200 && statusCode < 300) {
    peakVibrationG = 0;
    motionSampleReady = false;
  }
}
