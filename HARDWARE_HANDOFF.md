# Panduan Integrasi Hardware SafeGuard

Dokumen ini untuk menghubungkan ESP32 dan sensor ke backend SafeGuard.

## Ringkasan untuk perancang hardware

Target prototipe adalah satu ESP32 per ruangan. ESP32 membaca sensor, membandingkan nilai dengan ambang lokal untuk mengendalikan LED/buzzer, lalu mengirim pembacaan ke server SafeGuard. Server dan dashboard tidak mengendalikan alarm lokal; alarm lokal tetap dapat bekerja jika Wi-Fi terputus.

Server memakai debounce tiga reading berturut-turut (env `SAFEGUARD_DEBOUNCE_READINGS`, default 3) dan hysteresis 90% saat pulih (env `SAFEGUARD_HYSTERESIS_RATIO`, default 0.9). Room menjadi `OFFLINE` jika tidak menerima data selama 30 detik (env `SAFEGUARD_OFFLINE_SECONDS`). ESP32 perlu mengirim periodik lebih cepat dari timeout tersebut, misalnya tiap 5 detik.

Urutan implementasi yang disarankan:

1. Pastikan setiap sensor terbaca di Serial Monitor.
2. Tambahkan LED dan buzzer, lalu uji respons ambang secara lokal.
3. Sambungkan ESP32 ke Wi-Fi dan uji pengiriman HTTP.
4. Cocokkan nilai hasil kalibrasi dengan threshold pada dashboard.
5. Uji seluruh alur dan dokumentasikan jenis board, sensor, pin, serta nilai ambangnya.

## Wiring referensi (ESP32 DevKit umum)

Berikut contoh pin awal, bukan wiring universal. Pastikan pinout board dan datasheet modul yang benar-benar digunakan sebelum menyambungkan kabel.

| Komponen | Pin modul | Pin ESP32 contoh | Catatan |
|---|---|---|---|
| MPU6050 | SDA | GPIO 21 | I2C SDA umum pada ESP32 DevKit |
| MPU6050 | SCL | GPIO 22 | I2C SCL umum pada ESP32 DevKit |
| DS18B20 | DATA | GPIO 4 | Pasang resistor pull-up 4.7 kΩ antara DATA dan 3.3 V |
| MQ-2 | AO | GPIO 34 melalui pembagi tegangan bila perlu | GPIO 34 adalah input analog ADC1; periksa tegangan AO maksimum modul |
| Sensor gas tambahan | AO | GPIO 35 melalui pembagi tegangan bila perlu | Pastikan model sensor dan karakteristik keluarannya dahulu |
| LED hijau | anoda lewat resistor | GPIO 25 | Gunakan resistor seri, misalnya 220-330 Ω |
| LED kuning | anoda lewat resistor | GPIO 26 | Gunakan resistor seri, misalnya 220-330 Ω |
| LED merah | anoda lewat resistor | GPIO 27 | Gunakan resistor seri, misalnya 220-330 Ω |
| Buzzer aktif | IN / + | GPIO 18 | Jika arus buzzer melebihi kemampuan GPIO, gunakan transistor/driver |

Sambungkan GND semua modul ke GND ESP32 (common ground). Periksa kebutuhan catu daya modul. MQ-2 umumnya membutuhkan suplai 5 V untuk heater; **jangan** mengambil daya heater dari pin 3.3 V ESP32. Jika modul diberi 5 V, output analog AO dapat melebihi batas aman input ESP32 (maksimum sekitar 3.3 V). Ukur AO dan gunakan pembagi tegangan/level shifting yang sesuai sebelum ke ADC. Jangan menyambungkan sinyal 5 V langsung ke GPIO ESP32.

Pin analog ADC1 (misalnya GPIO 32-39 pada banyak ESP32 klasik) lebih tepat untuk pembacaan analog saat Wi-Fi aktif daripada ADC2, yang pada sejumlah ESP32 berbagi sumber daya dengan Wi-Fi. Board ESP32 lain dapat memiliki pinout berbeda.

Diagram konseptual:

```text
MPU6050 SDA/SCL ─┐
DS18B20 DATA ────┤
MQ-2 AO ─────────┤       ┌─ LED hijau / kuning / merah
Gas sensor AO ───┼─ ESP32 ├─ Buzzer (driver bila diperlukan)
Semua GND ───────┤       └─ Wi-Fi → POST /api/readings
Catu daya sesuai ┘                         ↓
                                  SafeGuard di laptop/server
```

Gunakan spesifikasi modul yang tersedia di sekolah. Jika sensor gas tambahan tidak jadi digunakan, nilai `gas` pada API dapat berasal dari MQ-2 sesuai keputusan integrasi; jangan mengirim nilai sensor yang sama sebagai dua sensor independen tanpa menjelaskannya di laporan.

### Logika LED dan buzzer

Contoh berikut mengasumsikan buzzer aktif dan pin telah disesuaikan. Definisikan threshold memakai satuan/skala yang sama dengan pembacaan yang akan dikirim ke API.

```cpp
const int RED_LED_PIN = 27;
const int YELLOW_LED_PIN = 26;
const int GREEN_LED_PIN = 25;
const int BUZZER_PIN = 18;

void showAlarm(bool warning, bool danger) {
  digitalWrite(RED_LED_PIN, danger ? HIGH : LOW);
  digitalWrite(YELLOW_LED_PIN, warning && !danger ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, !warning && !danger ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, warning || danger ? HIGH : LOW);
}
```

Untuk buzzer pasif gunakan pola/tone sesuai board dan rangkaian. Jangan menghubungkan beban berarus besar langsung ke GPIO; gunakan transistor/driver dan catu daya yang sesuai.

## 1. Cara kerja sistem

```text
MPU6050 + MQ-2 + DS18B20 + sensor gas
                |
              ESP32
                | Wi-Fi / HTTP POST
                v
Laptop/server yang menjalankan SafeGuard
                |
       SQLite + Dashboard web
```

ESP32 tidak perlu mengakses database secara langsung. ESP32 cukup mengirim pembacaan sensor ke endpoint HTTP.

## 1A. Apa yang terjadi saat ada bahaya?

SafeGuard membaca **indikasi**, lalu memberi peringatan berdasarkan threshold:

| Kondisi di lapangan | Sensor yang bereaksi | Peringatan yang ditampilkan |
|---|---|---|
| Gas mudah terbakar bocor | Sensor gas, nilai `gas` naik | `WARNING` atau `DANGER`, alert "Indikasi gas melebihi ambang" |
| Asap mulai muncul | MQ-2, nilai `smoke` naik | `WARNING` atau `DANGER`, alert "Asap terdeteksi melebihi ambang" |
| Area menjadi sangat panas | DS18B20, nilai `temperature` naik | `WARNING` atau `DANGER`, alert "Suhu melebihi ambang" |
| Getaran tidak normal | MPU6050, nilai `vibration` naik | `WARNING` atau `DANGER`, alert "Getaran melebihi ambang" |

Contoh kejadian kebakaran: MQ-2 mendeteksi asap dan DS18B20 membaca suhu tinggi. Jika dua threshold terlampaui, dashboard berubah menjadi `DANGER` dan menampilkan alert pada ruangan tersebut.

Contoh kejadian kebocoran gas: nilai sensor gas melewati threshold. Dashboard berubah minimal menjadi `WARNING` dan mencatat waktu serta nama ruangan.

### Peringatan fisik di lokasi

Versi dashboard ini menampilkan alert di laptop. Agar orang di dekat alat juga langsung tahu, guru dapat menambahkan:

- buzzer pada ESP32 untuk bunyi alarm;
- LED merah untuk `DANGER`;
- LED kuning untuk `WARNING`;
- LED hijau untuk kondisi normal.

Gunakan pola suara yang berbeda agar tingkat peringatan mudah dibedakan, misalnya `WARNING` = dua beep pendek dan `DANGER` = tiga beep cepat dengan jeda. Dashboard memiliki toggle `Sound off / Sound on`: setelah diaktifkan, pola alarm berulang langsung setelah rangkaian beep selesai selama status `WARNING` atau `DANGER`, tanpa jeda panjang antar-rangkaian. Alarm berhenti ketika status kembali `NORMAL` atau sound dimatikan. Jika status turun dari `DANGER` ke `WARNING`, pola berubah ke warning tanpa beep tambahan saat perubahan. Suara browser hanya keluar jika dashboard terbuka dan pengguna mengaktifkannya; jangan menjadikannya satu-satunya alarm.

Logika sederhananya dijalankan **langsung di ESP32**, sehingga buzzer tetap dapat berbunyi walaupun Wi-Fi atau laptop sedang bermasalah:

```cpp
bool vibrationWasBreached = false;
bool smokeWasBreached = false;
bool temperatureWasBreached = false;
bool gasWasBreached = false;
int stableLevel = 0;       // 0=NORMAL, 1=WARNING, 2=DANGER
int pendingLevel = -1;
int pendingCount = 0;

bool isBreached(float value, float threshold, bool wasBreached) {
  const float effectiveThreshold = wasBreached ? threshold * 0.9f : threshold;
  return value >= effectiveThreshold;
}

void updateHazardStatus(float vibration, float smoke, float temperature, float gas) {
  vibrationWasBreached = isBreached(vibration, VIBRATION_THRESHOLD, vibrationWasBreached);
  smokeWasBreached = isBreached(smoke, SMOKE_THRESHOLD, smokeWasBreached);
  temperatureWasBreached = isBreached(temperature, TEMPERATURE_THRESHOLD, temperatureWasBreached);
  gasWasBreached = isBreached(gas, GAS_THRESHOLD, gasWasBreached);

  const int breachCount = vibrationWasBreached + smokeWasBreached + temperatureWasBreached + gasWasBreached;
  const int candidateLevel = breachCount >= 2 ? 2 : breachCount == 1 ? 1 : 0;
  if (candidateLevel == stableLevel) {
    pendingLevel = -1;
    pendingCount = 0;
  } else {
    if (candidateLevel != pendingLevel) {
      pendingLevel = candidateLevel;
      pendingCount = 1;
    } else {
      pendingCount++;
    }
    if (pendingCount >= 3) {
      stableLevel = pendingLevel;
      pendingLevel = -1;
      pendingCount = 0;
    }
  }

  const bool warning = stableLevel == 1;
  const bool danger = stableLevel == 2;
  digitalWrite(RED_LED_PIN, danger ? HIGH : LOW);
  digitalWrite(YELLOW_LED_PIN, warning ? HIGH : LOW);
  digitalWrite(GREEN_LED_PIN, stableLevel == 0 ? HIGH : LOW);
  if (danger) tone(BUZZER_PIN, 2200);
  else if (warning) tone(BUZZER_PIN, 1200);
  else noTone(BUZZER_PIN);
}
```

Panggil `updateHazardStatus(...)` sekali per reading baru, memakai empat nilai yang akan dikirim. Atur `VIBRATION_THRESHOLD`, `SMOKE_THRESHOLD`, `TEMPERATURE_THRESHOLD`, dan `GAS_THRESHOLD` sesuai dashboard/kalibrasi. Contoh ini mempertahankan breach sampai turun di bawah 90% threshold dan mengubah level setelah tiga reading berturut-turut.

Jika MQ-2 dipakai untuk mengisi field `smoke` sekaligus `gas`, keduanya bukan dua sensor independen. Jangan menghitung kedua field tersebut sebagai dua breach untuk menaikkan status menjadi `DANGER`; pilih satu kategori untuk MQ-2 atau tambahkan sensor gas kedua yang terpisah.

### Batas deteksi

MQ-2 dan DS18B20 **tidak memastikan adanya nyala api**. Keduanya mendeteksi asap dan panas sebagai indikasi kebakaran. Jika project harus mendeteksi cahaya api secara langsung, tambahkan flame sensor sebagai sensor hardware baru dan kirim field tambahan setelah API/frontend dikembangkan untuk mendukungnya. SafeGuard bukan pengganti alarm kebakaran tersertifikasi.

## 2. Menjalankan server

Di laptop yang akan menjadi server:

```bash
cd C:\SafeGuard
npm install
npm start
```

Jika ingin melindungi endpoint tulis, atur key sebelum server dijalankan (PowerShell):

```powershell
$env:SAFEGUARD_API_KEY = "buat-key-lokal-yang-rahasia"
npm start
```

Tanpa env tersebut server memberi peringatan di console tetapi tetap berjalan. Jika key diaktifkan, endpoint POST reading, demo seed, dan PUT settings mewajibkan header `x-api-key`; masukkan key yang sama di Settings dashboard untuk mengubah threshold. Jangan bagikan key asli atau commit ke repo.

ESP32 dan laptop harus berada di Wi-Fi yang sama. Cari `IPv4 Address` laptop dengan `ipconfig`, lalu gunakan alamat itu pada `API_URL`, bukan `localhost`. Room menjadi `OFFLINE` jika tidak menerima data dalam 30 detik; interval kirim contoh 5 detik.

Dashboard dapat dites dengan simulasi tanpa hardware:

```powershell
node scripts/simulate.js normal
node scripts/simulate.js one-breach
node scripts/simulate.js two-breach
node scripts/simulate.js offline
```

Tiga mode pertama mengirim berulang sampai dihentikan dengan `Ctrl+C`; mode offline mengirim sekali lalu berhenti. Gunakan endpoint demo simulator untuk lomba, bukan api sungguhan atau pelepasan gas. Skenario `two-breach` menghasilkan DANGER setelah debounce tiga reading.

Pastikan laptop dan ESP32 berada di jaringan Wi-Fi yang sama. Cari alamat IP laptop dengan:

```powershell
ipconfig
```

Cari `IPv4 Address`, misalnya `192.168.1.20`.

Buka dashboard dari laptop:

```text
http://localhost:3000
```

ESP32 harus mengirim ke alamat IP laptop, bukan `localhost`:

```text
http://192.168.1.20:3000/api/readings
```

Untuk deployment Vercel, gunakan `https://NAMA-PROJECT.vercel.app/api/readings` dan kirim `x-api-key` yang disetel sebagai `SAFEGUARD_API_KEY` di Vercel.

Jika Windows Firewall meminta izin Node.js, izinkan koneksi pada jaringan Private.

## 3. Format data dari ESP32

ESP32 mengirim `POST` dengan header `Content-Type: application/json`.

```json
{
  "room": "Ruang Server",
  "vibration": 0.04,
  "smoke": 115,
  "temperature": 29.4,
  "gas": 180
}
```

Kolom wajib:

| Kolom | Satuan | Sumber |
|---|---|---|
| `room` | teks | nama ruangan yang dipasang ESP32 |
| `vibration` | g dinamis (bukan magnitudo mentah) | MPU6050 |
| `smoke` | ppm atau skala kalibrasi | MQ-2 |
| `temperature` | Celsius | DS18B20 |
| `gas` | ppm atau skala kalibrasi | sensor gas |

`timestamp` opsional. Jika tidak dikirim, server memakai waktu penerimaan.

## 4. Contoh kode pengiriman ESP32

Contoh ini memakai Arduino IDE, library `WiFi.h`, dan `HTTPClient.h`. Bagian pembacaan sensor perlu diisi sesuai wiring dan library sensor yang digunakan.

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "NAMA_WIFI";
const char* WIFI_PASSWORD = "PASSWORD_WIFI";
const char* API_URL = "http://192.168.1.20:3000/api/readings";
const char* API_KEY = ""; // Isi hanya jika SAFEGUARD_API_KEY diaktifkan di server.

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
}

void loop() {
  // Ganti nilai berikut dengan hasil pembacaan sensor sebenarnya.
  float vibration = 0.04;
  int smoke = 115;
  float temperature = 29.4;
  int gas = 180;

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");
    if (API_KEY[0] != '\0') http.addHeader("x-api-key", API_KEY);

    String payload = "{";
    payload += "\"room\":\"Ruang Server\",";
    payload += "\"vibration\":" + String(vibration, 2) + ",";
    payload += "\"smoke\":" + String(smoke) + ",";
    payload += "\"temperature\":" + String(temperature, 1) + ",";
    payload += "\"gas\":" + String(gas);
    payload += "}";

    int responseCode = http.POST(payload);
    Serial.printf("HTTP response: %d\n", responseCode);
    Serial.println(http.getString());
    http.end();
  }

  delay(5000);
}
```

## 5. Tes sebelum sensor lengkap

Tes endpoint dari laptop terlebih dahulu:

```powershell
$body = @{ room = "Ruang Server"; vibration = 0.04; smoke = 115; temperature = 29.4; gas = 180 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/readings -ContentType "application/json" -Body $body
```

Tes dari ESP32 memakai IP laptop:

```text
http://192.168.1.20:3000/api/readings
```

Jika response berhasil, dashboard akan memperbarui data maksimal 10 detik kemudian. Bila API key diaktifkan, tambahkan header `x-api-key` yang sama. Request JSON dibatasi 10 KB, nama room maksimal 40 karakter, semua nilai sensor harus berupa angka finite, dan timestamp harus tanggal valid bila dikirim.

## 6. Threshold dan status

Threshold awal (wajib dikalibrasi untuk hardware yang dipakai):

- Getaran dinamis: `0.15 g` (nilai awal saja, perlu kalibrasi)
- Asap: `320` (ppm hanya jika sensor sudah dikalibrasi; selain itu gunakan skala sensor)
- Suhu: `45 C`
- Gas: `420` (ppm hanya jika sensor sudah dikalibrasi; selain itu gunakan skala sensor)

Aturan status:

- Tidak ada sensor melewati threshold: `NORMAL`
- Satu sensor melewati threshold: `WARNING`
- Dua atau lebih sensor melewati threshold: `DANGER`

Threshold dapat diubah melalui bagian `Settings` di dashboard. Nilai MQ-2 dan sensor gas bergantung pada kalibrasi, sehingga angka threshold perlu disesuaikan setelah pengujian hardware.

Server mengeluarkan alert setelah status terkonfirmasi tiga reading berturut-turut. Alert dengan room/type yang sama dibatasi cooldown default 60 detik (`SAFEGUARD_ALERT_COOLDOWN_SECONDS`); satu breach ber-severity `warning`, dua atau lebih `danger`. Reading dan alert lebih lama dari tujuh hari dibersihkan otomatis (`SAFEGUARD_RETENTION_DAYS`).

### Menghitung getaran MPU6050

MPU6050 yang diam tetap membaca gravitasi sekitar `1 g`. Jangan kirim magnitudo percepatan mentah sebagai nilai getaran. Jika pembacaan sumbu `ax`, `ay`, dan `az` sudah dalam satuan `g`, hitung magnitudo lalu kurangi gravitasi:

```cpp
float magnitudeG = sqrt(ax * ax + ay * ay + az * az);
float vibration = fabs(magnitudeG - 1.0f);
```

Jika library memberi satuan `m/s^2`, bagi magnitudo dengan `9.80665` sebelum mengurangi `1.0 g`. Alternatifnya, hitung peak-to-peak magnitudo dalam jendela pendek (misalnya 0.5-1 detik) dan kirim nilai puncak yang sudah dikalibrasi. Threshold awal dashboard `0.15 g` bukan ambang keselamatan tervalidasi: ukur noise saat gedung/perangkat diam dan sesuaikan threshold dari hasil uji terkendali. Sistem hanya memonitor indikasi getaran, bukan memprediksi gempa.

## 7. Kalibrasi dan pengujian

Kalibrasi perlu dilakukan pada sensor/modul yang benar-benar dipakai. Ambang default dashboard hanya nilai awal untuk demo, bukan angka keselamatan yang tervalidasi.

1. Catat merek/model board dan setiap sensor; cek tegangan kerja dan wiring berdasarkan datasheet.
2. Nyalakan sensor sesuai waktu pemanasan yang disarankan produsen. Catat nilai baseline di lingkungan normal melalui Serial Monitor.
3. Uji respons hanya dengan prosedur aman yang disetujui guru dan petunjuk produsen. Jangan sengaja menyalakan api atau melepas gas/bahan mudah terbakar untuk menguji sensor.
4. Tentukan satuan nilai yang akan dikirim. Jika belum dikonversi dan dikalibrasi sebagai ppm, perlakukan sebagai nilai/skala ADC, bukan ppm.
5. Atur threshold pada menu Settings agar sesuai satuan dan hasil uji. Samakan juga threshold pada firmware jika LED/buzzer menilai kondisi langsung di ESP32.
6. Uji satu sensor melewati threshold untuk memastikan `WARNING`, lalu uji dua nilai untuk memastikan `DANGER`. Gunakan pengiriman data simulasi di bawah bila belum ada prosedur uji sensor yang aman.
7. Pastikan buzzer/LED lokal bekerja tanpa koneksi Wi-Fi, lalu uji pengiriman dashboard secara terpisah.

### Checklist sebelum serah-terima

- [ ] Board ESP32 dan model sensor dicatat.
- [ ] Diagram wiring final dan nomor GPIO dicatat; suplai dan common ground diperiksa.
- [ ] Output analog yang masuk ke ESP32 tidak melebihi batas GPIO.
- [ ] Serial Monitor menunjukkan pembacaan sensor yang stabil dan satuannya dijelaskan.
- [ ] Threshold firmware dan dashboard sudah disamakan.
- [ ] LED/buzzer diuji lokal tanpa Wi-Fi.
- [ ] ESP32 dapat mengirim HTTP POST ke IP laptop dan menerima response sukses.
- [ ] Ruangan dan timestamp muncul di dashboard, grafik, dan riwayat.
- [ ] Perilaku saat Wi-Fi/server terputus sudah dipahami; alarm lokal tidak bergantung pada server.

Jika IP laptop sering berubah, buat DHCP reservation di router atau perbarui `API_URL` di firmware. Untuk pemakaian di luar jaringan lokal, perlu pengaturan jaringan dan keamanan tambahan; jangan membuka server ke internet tanpa autentikasi dan perlindungan yang sesuai.

## 8. Troubleshooting

- `ECONNREFUSED`: cek server masih berjalan dan port `3000` tidak diblokir firewall.
- ESP32 tidak menemukan server: jangan memakai `localhost`; gunakan IPv4 laptop.
- Response `400`: pastikan semua field `room`, `vibration`, `smoke`, `temperature`, dan `gas` dikirim.
- Data terlihat tidak masuk akal: cek satuan dan lakukan kalibrasi sensor.
- Dashboard tidak berubah: pastikan ESP32 dan laptop ada di Wi-Fi yang sama, lalu cek Serial Monitor.

Sistem ini digunakan untuk monitoring dan deteksi indikasi dari sensor. Sistem tidak memprediksi gempa dan bukan pengganti alarm keselamatan tersertifikasi.
