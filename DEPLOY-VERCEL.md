# Deploy DITZZ FINANCE 1.7.5 ke Vercel

## Isi perubahan
- Menambahkan `vercel.json` dan catch-all serverless function `api/[...path].js`.
- Express app sekarang dapat dijalankan sebagai Vercel Function maupun secara lokal.
- Lokasi data dapat dikonfigurasi melalui `DATA_DIR`.
- Menambahkan endpoint aman `GET /api/cron/push` untuk dipanggil scheduler eksternal.
- Menambahkan `.env.example` sebagai daftar environment variables.

## Deploy
1. Ekstrak ZIP ini.
2. Upload folder `ditzz-finance` ke repository GitHub.
3. Import repository tersebut di https://vercel.com/new.
4. **PENTING untuk error `[NEXT_NO_VERSION]`:** di Vercel buka Project → Settings → Build & Development Settings → Framework Preset, lalu pilih **Other** (jangan Next.js). Pastikan Root Directory menunjuk ke folder yang berisi `package.json` (jika repository berisi langsung `package.json`, gunakan `./`; jika masih berada di subfolder `ditzz-finance`, pilih `ditzz-finance`). Simpan lalu lakukan Redeploy.

Konfigurasi ZIP ini menetapkan build command sederhana dan output folder `public`. Project ini bukan Next.js dan tidak perlu dependency `next`.
5. Tambahkan Environment Variables berikut di Vercel (Production dan Preview sesuai kebutuhan):
   - `SESSION_SECRET`: string acak panjang.
   - `DATA_DIR`: `/tmp/ditzz-finance-data`.
   - `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY`: pasangan VAPID yang tetap/stabil.
   - `VAPID_SUBJECT`: misalnya `mailto:email-anda@example.com`.
   - `CRON_SECRET`: string acak lain untuk melindungi endpoint cron.
6. Deploy. Buka domain yang diberikan Vercel.

Buat secret di komputer dengan Node.js:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Jalankan dua kali untuk `SESSION_SECRET` dan `CRON_SECRET`. Jangan bagikan nilainya.

## PENTING: batas penyimpanan pada paket ini
Versi ini **sudah memiliki adapter deployment Vercel**, tetapi database aplikasi aslinya masih berupa JSON. Vercel Functions tidak menyediakan disk permanen: folder `/tmp` dapat hilang saat instance diganti/dingin dan tidak dibagi antar-instance. Session Express bawaan juga tersimpan di memori instance. Artinya, deployment ini cocok untuk uji coba, **belum aman untuk data keuangan sungguhan atau penggunaan multi-user**. Jangan memasukkan data keuangan penting sebelum database dan session store dipindahkan ke layanan persisten (misalnya PostgreSQL/Neon atau MongoDB). Backup JSON yang diunduh dari aplikasi tetap disarankan.

## Push notification
Push browser tetap menggunakan Web Push. Atur VAPID key yang sama di Vercel agar subscription tidak rusak setelah redeploy. Scheduler `setInterval` tidak berjalan andal di serverless. Untuk pengingat otomatis, hubungkan scheduler eksternal (misalnya cron-job.org) untuk memanggil:
```
GET https://DOMAIN-ANDA/api/cron/push
Authorization: Bearer NILAI_CRON_SECRET
```
Atur frekuensi sesuai kebutuhan. Endpoint mengembalikan 401 jika secret salah/tidak diatur. Untuk notifikasi yang harus tepat waktu, gunakan scheduler eksternal dengan interval yang sesuai.

## Jalankan lokal
```bash
npm install
npm start
```
Buka `http://localhost:3000`. Pada lokal, data tetap tersimpan di folder `data/`.

## Akun awal
Aplikasi membuat akun awal `ditzz` dengan password `ditzz` jika belum ada. Segera login dan ubah password setelah pertama kali masuk.
