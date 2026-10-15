# SafeGuard Demo Guide

Panduan ini untuk mendemokan dashboard tanpa ESP32 atau sensor sungguhan. Simulator mengirim JSON lewat endpoint API yang sama dengan ESP32 dan menandai reading sebagai data demo. Jangan membuat api atau melepas gas untuk demo.

## 1. Jalankan server

Prasyarat: Node.js `>=22.5`. Dari terminal PowerShell pertama:

```powershell
cd C:\SafeGuard
npm install
npm start
```

Jika server SafeGuard sudah berjalan di port 3000, jangan jalankan instance kedua. Biarkan terminal server tetap hidup. Buka dashboard di browser: `http://localhost:3000`.

Secara default, room menjadi `OFFLINE` setelah 30 detik tanpa reading. Untuk mempercepat demo offline menjadi 8 detik, hentikan server dengan `Ctrl+C`, lalu jalankan:

```powershell
$env:SAFEGUARD_OFFLINE_SECONDS = "8"
npm start
```

Timeout tersebut berlaku pada proses server yang baru dijalankan. Pakai nilai default 30 detik untuk perilaku reguler.

Jika `SAFEGUARD_API_KEY` dikonfigurasi saat server dijalankan, atur key yang sama di terminal simulator:

```powershell
$env:SAFEGUARD_API_KEY = "KEY_YANG_SAMA_DENGAN_SERVER"
```

Tanpa API key, simulator tidak memerlukan konfigurasi key tambahan.

## 2. Siapkan simulator

Buka terminal PowerShell kedua di folder `C:\SafeGuard`, lalu atur:

```powershell
cd C:\SafeGuard
$env:SAFEGUARD_API_URL = "http://localhost:3000/api/readings"
$env:SIMULATOR_INTERVAL_MS = "250"
$env:SIMULATOR_MAX_READINGS = "3"
$env:SIMULATOR_ROOM = "Ruang Demo"
```

Tiga reading dibutuhkan untuk debounce status. Dengan `SIMULATOR_MAX_READINGS=3`, setiap skenario selesai otomatis. Ubah jadi `0` bila ingin simulator terus mengirim sampai dihentikan dengan `Ctrl+C`.

## 3. Mulai dari NORMAL

Agar seluruh room online dan status gedung NORMAL, segarkan enam room demo:

```powershell
$rooms = @("Kelas 1", "Lab Elektronika", "Lobi", "Ruang Demo", "Ruang Demo Audio", "Ruang Server")
foreach ($room in $rooms) {
  $env:SIMULATOR_ROOM = $room
  node scripts/simulate.js normal
}
```

Klik refresh `↻` di dashboard atau tunggu pembaruan otomatis (maksimal 10 detik). Pastikan status gedung `NORMAL` dan badge Demo Mode terlihat. Gedung baru berstatus NORMAL jika semua room yang terdaftar online dan tidak ada threshold aktif.

## 4. Tunjukkan WARNING dan DANGER

Gunakan room yang sama untuk ketiga perintah:

```powershell
$env:SIMULATOR_ROOM = "Ruang Demo"
node scripts/simulate.js one-breach
node scripts/simulate.js two-breach
node scripts/simulate.js normal
```

Hasilnya:

- `one-breach`: gas disimulasikan melewati threshold. Setelah tiga reading berturut-turut, room menjadi `WARNING`.
- `two-breach`: asap dan suhu disimulasikan melewati threshold. Setelah tiga reading, room menjadi `DANGER`.
- `normal`: kirim nilai normal tiga kali untuk memulihkan room ke `NORMAL`.

Sesudah tiap skenario, klik refresh `↻` di dashboard. Alert, grafik, dan history memakai data dari request simulasi yang sama.

## 5. Tunjukkan OFFLINE lalu online kembali

Untuk membuat semua room demo berhenti mengirim:

```powershell
$rooms = @("Kelas 1", "Lab Elektronika", "Lobi", "Ruang Demo", "Ruang Demo Audio", "Ruang Server")
foreach ($room in $rooms) {
  $env:SIMULATOR_ROOM = $room
  node scripts/simulate.js offline
}
```

Mode `offline` mengirim satu reading lalu berhenti. Tunggu lebih lama dari `SAFEGUARD_OFFLINE_SECONDS` (default 30 detik; 8 detik jika server dijalankan dengan timeout demo), lalu refresh dashboard. Room menjadi `OFFLINE` dan gedung tidak akan ditampilkan NORMAL.

Untuk membuat semua room online kembali dan mereset demo ke NORMAL, jalankan lagi loop pada bagian 3. Kalau hanya menjalankan `normal` untuk satu room, room itu pulih tetapi gedung bisa tetap WARNING karena room lain masih OFFLINE.

## 6. Urutan presentasi singkat

1. Tunjukkan dashboard NORMAL dan badge Demo Mode.
2. Jalankan `one-breach`, refresh dashboard, lalu tunjukkan room WARNING dan alert.
3. Jalankan `two-breach`, refresh dashboard, lalu tunjukkan DANGER.
4. Jalankan `normal` untuk mengembalikan room ke kondisi normal.
5. Jika ingin menunjukkan OFFLINE, gunakan skenario pada bagian 5 dan tunggu timeout.

Jelaskan kepada juri bahwa ini simulasi data melalui API, bukan pengujian gas/asap/api sungguhan. SafeGuard memonitor ambang sensor; sistem tidak memprediksi gempa dan bukan pengganti alarm keselamatan tersertifikasi.

## Troubleshooting

- `ECONNREFUSED`: pastikan server berjalan di port 3000 dan URL `SAFEGUARD_API_URL` benar.
- API key aktif: set `SAFEGUARD_API_KEY` dengan nilai yang sama di terminal simulator.
- Status masih WARNING setelah satu room normal: lihat daftar OFFLINE di dashboard, lalu segarkan semua room dengan loop bagian 3.
- Dashboard belum berubah: klik refresh `↻` atau tunggu maksimal 10 detik.
