# SafeGuard - Smart Building Hazard Monitoring System

Dashboard untuk memonitor indikasi sensor ESP32: getaran dinamis MPU6050, asap/suhu MQ-2 + DS18B20, dan sensor gas. Sistem membandingkan pembacaan dengan threshold; sistem tidak memprediksi gempa dan bukan pengganti alarm keselamatan tersertifikasi.

## Menjalankan

Prasyarat: Node.js `>=22.5`. Saat dijalankan lokal, database SQLite disimpan di `safeguard.db`. Chart.js dipasang lokal dan dashboard tidak memerlukan CDN.

```powershell
npm install
$env:SAFEGUARD_API_KEY = "ganti-dengan-key-lokal" # opsional, tetapi disarankan
npm start
```

Buka `http://localhost:3000`. Tanpa `SAFEGUARD_API_KEY`, server tetap berjalan dan mencetak peringatan bahwa endpoint tulis tidak terlindungi. API GET dashboard tetap terbuka di jaringan lokal.

## Deploy ke GitHub dan Vercel

Checklist langkah deploy, perintah pengujian API, dan troubleshooting ada di [DEPLOY.md](DEPLOY.md).

Produksi menggunakan Vercel untuk website/API dan Turso untuk database SQLite yang persisten. File database lokal tidak dikirim ke GitHub atau Turso; database produksi dimulai dengan threshold default dan belum memiliki riwayat sensor.

1. Buat repository kosong di GitHub, lalu jalankan dari folder project:

   ```powershell
   git remote add safeguard-github https://github.com/USERNAME/NAMA-REPOSITORY.git
   git add .
   git status --short
   git commit -m "Prepare SafeGuard for deployment"
   git push -u safeguard-github HEAD:main
   ```

   Workspace ini sudah mempunyai Git history dan remote `origin`; perintah di atas menambahkan remote baru tanpa mengganti remote tersebut. Ganti placeholder URL dengan repository baru. Periksa `git status --short` agar tidak ada database atau credential yang akan dikirim.

2. Buat database Turso dan ambil URL serta tokennya. Dengan Turso CLI yang sudah login:

   ```powershell
   turso db create safeguard-production
   turso db show --url safeguard-production
   turso db tokens create safeguard-production
   ```

   Dashboard Turso juga bisa digunakan. Jangan masukkan token ke file yang dikirim ke GitHub.

3. Di Vercel, pilih **Add New → Project**, import repository GitHub tersebut, dan deploy. Konfigurasi project sudah menggunakan build `npm run build` dan folder output `public`.

4. Sebelum deployment pertama, tambahkan `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, dan `SAFEGUARD_API_KEY` pada **Project → Settings → Environment Variables**. Terapkan ke Production dan Preview sesuai kebutuhan.

   Buat API key acak dengan:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Variabel tersebut hanya untuk server; jangan beri awalan `NEXT_PUBLIC_` atau `VITE_`. Redeploy setelah mengubahnya. API key yang sama harus dipasang pada ESP32/simulator sebagai header `x-api-key`; masukkan ke field API key di dashboard untuk menyimpan threshold.

5. Buka URL Vercel untuk mengecek dashboard. Endpoint ESP32 produksi adalah `https://NAMA-PROJECT.vercel.app/api/readings`. Data baru tersimpan di Turso, bukan di file lokal.

## Demo

Panduan demo mandiri di PowerShell: [DEMO_GUIDE.md](mdfiles/DEMO_GUIDE.md).

Seed empat ruangan sekali:

```powershell
$headers = @{}
if ($env:SAFEGUARD_API_KEY) { $headers['x-api-key'] = $env:SAFEGUARD_API_KEY }
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/demo/seed -Headers $headers
```

Untuk simulasi berulang tanpa hardware:

```powershell
node scripts/simulate.js normal
node scripts/simulate.js one-breach
node scripts/simulate.js two-breach
node scripts/simulate.js offline
```

`normal`, `one-breach`, dan `two-breach` mengirim terus setiap 5 detik; tekan `Ctrl+C` untuk berhenti. Tiga pembacaan berturut-turut dibutuhkan untuk mengubah status. `offline` mengirim satu pembacaan lalu keluar; ruangan menjadi OFFLINE setelah timeout. Simulator memakai threshold aktif server dan menandai data demo melalui header, tanpa membuat api atau melepas gas sungguhan. Badge Demo Mode tampil jika semua ruangan online memakai data demo.

Konfigurasi simulator: `SAFEGUARD_API_URL` (default `http://localhost:3000/api/readings`), `SAFEGUARD_API_KEY` (jika server memakai key), `SIMULATOR_ROOM` (default `Ruang Demo`), `SIMULATOR_INTERVAL_MS` (default `5000`), dan `SIMULATOR_MAX_READINGS` (default `0` = terus sampai Ctrl+C). Contoh demo terbatas: `$env:SIMULATOR_MAX_READINGS = "3"; node scripts/simulate.js two-breach`.

## API ESP32

```http
POST /api/readings
Content-Type: application/json
x-api-key: <SAFEGUARD_API_KEY>
```

```json
{
  "room": "Ruang Server",
  "vibration": 0.12,
  "smoke": 115,
  "temperature": 29.4,
  "gas": 180,
  "timestamp": "2026-09-24T09:30:00.000Z"
}
```

Field `timestamp` opsional; jika tidak dikirim, server memberi timestamp penerimaan. `room` 1-40 karakter; empat nilai sensor harus angka finite. `vibration` adalah percepatan dinamis dalam g setelah gravitasi dikurangi. `smoke` dan `gas` boleh berupa skala sensor; sebut ppm hanya setelah kalibrasi yang sesuai.

Endpoint penting:

- `GET /api/health` - health check database
- `GET /api/dashboard` - status terburuk per room, status OFFLINE, settings, alert terbaru dan total alert
- `GET /api/readings?limit=60&room=Ruang%20Server&from=2026-10-01&to=2026-10-15` - riwayat, filter room/tanggal opsional
- `GET /api/alerts?limit=100&offset=0` - log peringatan, pagination offset opsional
- `GET /api/settings` - threshold aktif
- `PUT /api/settings` - ubah threshold (API key jika disetel; nilai finite > 0)
- `POST /api/readings` - ingest ESP32 (API key jika disetel)
- `POST /api/demo/seed` - isi empat ruangan demo (API key jika disetel)

Jika `SAFEGUARD_API_KEY` diatur, masukkan key tersebut pada field API key di Settings dashboard untuk menyimpan threshold. Simpan key di environment/firmware secara privat; jangan masukkan key asli ke repo atau materi lomba.

## Status dan Operasional

- Status room `WARNING` jika satu sensor melewati threshold, `DANGER` jika dua atau lebih.
- Status baru berlaku setelah tiga reading berturut-turut (env `SAFEGUARD_DEBOUNCE_READINGS`). Status breach pulih setelah semua nilai turun di bawah 90% threshold; rasio dapat diubah melalui `SAFEGUARD_HYSTERESIS_RATIO` (default `0.9`).
- Room menjadi `OFFLINE` bila tidak ada reading baru selama 30 detik (env `SAFEGUARD_OFFLINE_SECONDS`). Gedung tidak ditampilkan NORMAL bila ada room offline; peringatan offline ditampilkan terpisah.
- Alert dideduplikasi per room/type dengan cooldown 60 detik (env `SAFEGUARD_ALERT_COOLDOWN_SECONDS`). Severity satu breach `warning`; dua atau lebih `danger`.
- Ambang awal: getaran dinamis `0.15 g` (wajib kalibrasi), smoke `320`, suhu `45 C`, gas `420`. Database lama yang masih memakai default getaran `1.2 g` dimigrasikan sekali ke `0.15 g`; nilai konfigurasi lain dipertahankan.
- Data readings dan alerts yang lebih lama dari 7 hari dibersihkan saat startup dan kira-kira setiap 6 jam (env `SAFEGUARD_RETENTION_DAYS`). Vercel menjalankan pembersihan saat startup dan pada request API pertama setelah interval tersebut.
- Dashboard refresh otomatis tiap 10 detik. Riwayat menampilkan status yang disimpan saat reading masuk, bukan menghitung ulang dengan threshold saat ini.
- SQLite lokal disimpan di `safeguard.db`. File `safeguard.db`, `safeguard.db-shm`, dan `safeguard.db-wal` dikecualikan `.gitignore`; jangan masukkan file database lokal ke ZIP/repo.

## Hardware

Laptop/server dan ESP32 harus satu jaringan Wi-Fi. ESP32 lokal mengirim ke `http://IP_LAPTOP:3000/api/readings`, bukan `localhost`. Wiring, pembagi tegangan, rumus MPU6050, kalibrasi, dan contoh firmware ada di [HARDWARE_HANDOFF.md](HARDWARE_HANDOFF.md).

## Halaman Dashboard

- `/` - overview, sensor summary, alert terbaru, dan ringkasan room
- `/live-monitoring` - grafik dan pembacaan terbaru dengan filter room
- `/rooms` - status semua room
- `/history` - riwayat dengan filter room/tanggal dan export CSV
- `/alerts` - semua alert (halaman memuat bertahap, 500 per request)
- `/settings` - threshold dan API key

## Struktur

```text
SafeGuard/
  public/                 # enam halaman HTML, CSS dan shared/page JS
  api/[...path].js        # Vercel serverless API entry
  scripts/build.js        # siapkan Chart.js untuk static deployment
  scripts/simulate.js     # skenario demo via POST
  firmware/               # Arduino ESP32 sample and setup guide
  server.js               # Express + libSQL/SQLite + REST API
  package.json
  package-lock.json
  README.md
  mdfiles/DEMO_GUIDE.md
  DEPLOY.md
  HARDWARE_HANDOFF.md
```
#   S a f e G u a r d  
 