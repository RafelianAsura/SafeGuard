# SafeGuard ESP32 Firmware

The example assumes **DS18B20** for temperature because the existing project documentation specifies it. `config.h` supports DHT22 as an alternate using `TEMP_SENSOR_TYPE`; wiring and the matching Arduino library are included for both.

## Required libraries

Install in Arduino IDE Library Manager:

- Adafruit MPU6050
- Adafruit Unified Sensor
- OneWire
- DallasTemperature
- DHT sensor library (Adafruit)
- Adafruit Unified Sensor is also a DHT sensor library dependency

Use the ESP32 board support package in Arduino IDE. The firmware reads the MPU6050, analog MQ-2 output, analog gas-sensor output, and selected temperature sensor. MQ-2 and gas values are reported as ADC scale values, not calibrated ppm.

## Wiring reference

The example pin assignments assume a common ESP32 DevKit. Confirm your exact board, module voltage, and pinout before wiring.

| Sensor/signal | ESP32 pin | Notes |
|---|---:|---|
| MPU6050 SDA | GPIO 21 | I2C, configurable as `I2C_SDA_PIN` |
| MPU6050 SCL | GPIO 22 | I2C, configurable as `I2C_SCL_PIN` |
| MQ-2 analog output (AO) | GPIO 34 | `MQ2_ANALOG_PIN`; use a divider if AO can exceed 3.3 V |
| Gas sensor analog output (AO) | GPIO 35 | `GAS_ANALOG_PIN`; use a divider if AO can exceed 3.3 V |
| DS18B20 DATA (default) | GPIO 4 | `DS18B20_DATA_PIN`; add 4.7 kΩ pull-up to 3.3 V |
| DHT22 DATA (alternate) | GPIO 4 | `DHT22_DATA_PIN`; change `TEMP_SENSOR_TYPE` |
| Sensor power and ground | module-specific | Common ground; MQ-2 heater normally needs 5 V, not ESP32 3.3 V |

GPIO 34/35 are ADC1 pins on many classic ESP32 boards and can be used while Wi-Fi is active. Other ESP32 variants may use different pins.

## Configure and flash

1. Copy `safeguard_esp32/config.h.example` to `safeguard_esp32/config.h`. The real config is ignored by Git.
2. Set Wi-Fi name/password, `SERVER_URL`, `API_KEY`, and `ROOM_NAME`.
3. For local HTTP, use a URL such as `http://192.168.1.20:3000/api/readings`. For Vercel, use `https://YOUR-PROJECT.vercel.app/api/readings`.
4. For HTTPS, paste the trusted root CA certificate for the server into `SERVER_ROOT_CA` in `config.h`. The firmware validates the certificate and deliberately does not disable TLS verification.
5. Select DS18B20 (default) or DHT22 in `TEMP_SENSOR_TYPE`, and check the corresponding data pin.
6. Open `safeguard_esp32.ino` in Arduino IDE, select the matching ESP32 board and serial port, then compile and upload.
7. Open Serial Monitor at **115200 baud**. The firmware prints Wi-Fi status, sensor values, HTTP status, and response text. It attempts Wi-Fi reconnection and retries transient HTTP/network/server failures up to three times. HTTP 4xx responses are not retried.

Vibration is calculated as the magnitude of acceleration after subtracting a low-pass gravity estimate, in `g`. Smoke and gas are raw 12-bit ADC scale readings; calibrate sensors and thresholds before interpreting them as physical concentrations. The ESP32 skips uploads when the MPU6050 or selected temperature sensor returns an invalid reading.

## Test the API before connecting hardware

Replace the URL and key. Use `curl.exe` on Windows PowerShell so the command is not shadowed by the PowerShell `curl` alias.

```powershell
$url = "https://YOUR-PROJECT.vercel.app"
$key = "YOUR_SAFEGUARD_API_KEY"
$json = '{"room":"Ruang Server","vibration":0.04,"smoke":115,"temperature":29.4,"gas":180}'
curl.exe -i "$url/api/health"
curl.exe -i -X POST "$url/api/readings" -H "Content-Type: application/json" -H "x-api-key: $key" --data $json
curl.exe -i "$url/api/dashboard"
```

For a local server, use `http://localhost:3000`. A missing or incorrect key should receive HTTP `401` when `SAFEGUARD_API_KEY` is configured. Never commit the real `config.h`, Wi-Fi credentials, API key, or Turso token.
