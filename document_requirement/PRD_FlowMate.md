# Product Requirements Document (PRD) - FlowMate

## 1. Pendahuluan
### 1.1 Visi Produk
FlowMate adalah asisten penjadwalan berempati (Empathic Scheduling Assistant) bertenaga AI. Bertindak sebagai "manajer operasional pribadi", FlowMate memastikan jadwal harian pengguna beradaptasi dengan kondisi biologis, tingkat energi, dan realitas mental pengguna, bukan sebaliknya.

### 1.2 Target Audiens (Niche to Scale)
* **Target Awal (Niche):** Mahasiswa beban tinggi (STEM, Robotika, IT) di Indonesia yang sering mengalami jadwal rusak akibat jam tidur berantakan.
* **Potensi Skala (Scale):** Pekerja lepas (*freelancer*), pekerja kreatif, dan Gen-Z yang tidak memiliki jam kerja 9-to-5 teratur dan rentan terhadap *burnout*. 
*(Ini membedakan FlowMate dari kompetitor seperti Motion yang menargetkan manajer korporat).*

### 1.3 Masalah yang Diselesaikan (Problem - 30% Kriteria Juri)
* **Schedule Fatigue:** Aplikasi kalender saat ini sangat kaku. Satu blok waktu terlewat (misal: kesiangan) akan memicu efek domino yang menghancurkan jadwal seharian, berujung pada rasa bersalah (*guilt*) dan *prokrastinasi*.
* **Kurangnya Konteks Fisik & Mental:** Kalender tidak peduli apakah penggunanya baru tidur 3 jam, kelelahan, atau sedang stres.
* **Friction dalam Rescheduling:** Memindahkan 5-7 blok jadwal secara manual di Google Calendar saat sedang stres adalah beban kognitif yang terlalu menguras tenaga.

---

## 2. Solusi & Proposisi Nilai (Solution - 40% Kriteria Juri)
### 2.1 Proposisi Nilai
*"Jangan biarkan jadwal mengontrolmu. Biarkan jadwalmu yang beradaptasi denganmu."*
FlowMate menjadi jembatan antara ambisi (jadwal) dan realitas manusiawi penggunanya. Bukan sekadar alat efisiensi, tapi alat kesehatan mental untuk produktivitas berkelanjutan.

### 2.2 Keunikan (Uniqueness / WOW Factor - 30% Kriteria Juri)
* **Empathetic Reasoning:** Penggunaan Gemini bukan untuk rutinitas kaku, melainkan *AI Agent* yang secara proaktif akan menyelipkan blok "Tidur Siang" atau "Istirahat" jika sentimen pengguna menunjukkan kelelahan.
* **Reasoning Transcript (Transkrip Logika AI):** Aplikasi memberikan transparansi pemikiran AI, mengubah AI dari "kotak hitam" menjadi rekan diskusi (misal: AI menjelaskan *kenapa* dia membatalkan jadwal Gym hari ini).
* **Visual Diff (Before/After):** Memberikan momen "WOW" saat presentasi dengan menampilkan antarmuka kalender yang merah/bertumpuk secara instan berubah menjadi hijau dan rapi dalam 1 klik.

---

## 3. Fitur Utama (Core Features)

### 3.1 One-Tap Rescue (The Panic Button) 🚨 *[Fitur Prioritas Tertinggi]*
* **Deskripsi:** Tombol darurat saat pengguna gagal mengikuti jadwal.
* **Alur Pengguna:**
  1. Klik tombol besar "Jadwalku Berantakan".
  2. Input kondisi (Teks/Voice): *"Aku ketiduran, baru bangun jam 12 siang. Energiku sisa 40%. Jadwal kuliah jam 2 siang wajib ikut."*
  3. AI membaca acara di Google Calendar sisa hari itu.
  4. AI menghasilkan draf kalender baru: menunda tugas ringan ke besok, memampatkan durasi, dan mempertahankan jadwal wajib (kuliah jam 2).
  5. **Preview Visual (Before vs After)** ditampilkan.
  6. **Reasoning Transcript:** Panel penjelasan (misal: `➖ Menghapus 'Gym' karena energi 4/10`, `➕ Menambah 'Istirahat' karena utang tidur terdeteksi`).
  7. Konfirmasi (Yes/No). Jika Yes, sistem otomatis memperbarui Google Calendar.

### 3.2 Smart Morning Check-in ☀️
* **Deskripsi:** Penyesuaian jadwal awal hari berdasarkan kualitas istirahat.
* **Alur Pengguna:**
  1. Buka aplikasi, muncul *slider/form* UI simpel.
  2. Input: Jam tidur, jam bangun, *mood*, level energi (1-10).
  3. AI merombak: Jika energi (4/10), blok *deep work* otomatis digeser ke jam sore.

### 3.3 Empathic AI Journal 📝
* **Deskripsi:** Jurnal harian yang bertindak sebagai *feedback loop* kalender.
* **Alur Pengguna:**
  1. Ketik/Suara keluh kesah atau pencapaian hari itu. Data disimpan di **Firestore**.
  2. AI melakukan *Sentiment Analysis* dan *Entity Extraction* dari data historis.
  3. AI menghasilkan *Weekly Insight* berdasar pola (misal: "Kamu sangat produktif tiap Selasa pagi, mari blok permanen jam tersebut").

### 3.4 Dashboard Kesejahteraan & Produktivitas 📊
* **Deskripsi:** Visualisasi ringkas metrik interaksi.
* **Isi Dashboard:**
  * Grafik Level Energi vs Produktivitas (Diambil dari database Firestore).
  * Tingkat Reschedule: Persentase jadwal yang sukses dikerjakan tepat waktu vs di-reschedule.

---

## 4. Persyaratan Teknis (Tech Stack)
Berdasarkan analisis kritis untuk meningkatkan "UX Delight" dan menjaga kecepatan pengembangan (*rapid prototyping*), struktur teknis telah diimplementasikan sebagai berikut:
* **Frontend:** Custom Web UI (Vanilla HTML/CSS/JS) - Dirancang dari awal dengan desain visual *premium* (Dark Mode, Glassmorphism, Responsive Mobile UI) untuk pengalaman yang instan dan mulus tanpa framework berat.
* **Backend:** Python (FastAPI) - API modern dan sangat cepat, memproses logika AI dan menyajikan file statis (Frontend).
* **Database:** SQLite (Relational DB) menggunakan SQLAlchemy - Menggantikan rencana awal Firestore demi kemudahan *deployment* mandiri (*self-contained*), menjaga privasi data pengujian tetap lokal, dan meminimalkan kompleksitas konfigurasi *cloud storage* pada *container* Cloud Run.
* **AI Engine:** Google AI Studio (Gemini 1.5 Flash) menggunakan **Structured Outputs (JSON Mode)**.
* **Integrasi Utama:** Google OAuth 2.0 (Google Identity Services) dan Google Calendar API.
* **Environment:** Mendukung `DEMO_MODE` (JSON statis) dan `LIVE_MODE` (API asli & Database).
* **Deployment:** Google Cloud Run (Di-*containerize* dengan Docker).

---

## 5. Arsitektur & Alur Data (Data Flow)
1. **Trigger:** User menginput kondisi (Check-in, Panic Button, atau Jurnal) via antarmuka Frontend.
2. **Fetch & Auth:** Frontend melakukan *Login* via Google Identity (Popup) dan mengambil Token. Backend memverifikasi Token, mengambil *events* JSON dari GCal (7 hari ke depan), dan menarik riwayat user dari SQLite.
3. **Prompt Construction:** Backend merakit (User Input + GCal Events JSON + Riwayat Jurnal/Checkin + System Prompt).
4. **AI Processing:** Dikirim ke Gemini API (Google AI Studio) secara *asynchronous*.
5. **JSON Response:** Gemini mengembalikan *New Schedule* + *Reasoning Transcript*.
6. **Approval:** Frontend menganimasikan *Before vs After* kalender dan menampilkan penalaran AI.
7. **Sync:** (Rencana sinkronisasi 2-arah ditahan untuk keamanan demo, saat ini kalender baru disimulasikan secara visual). Riwayat Check-in, Jurnal, dan Event Metrik disimpan ke SQLite.

---

## 6. Risiko & Mitigasi (Evaluasi Aktual)
* **Risiko UX Kaku:** *Telah dimitigasi* -> Penggunaan antarmuka kustom (HTML/CSS) terbukti memberikan hasil yang jauh lebih *Wow* dan interaktif (Sidebar responsif, *Glassmorphism*, dukungan iOS/Android) dibandingkan Streamlit.
* **Risiko Persistensi Data:** *Telah dimitigasi* -> Implementasi SQLite + SQLAlchemy berhasil menyimpan *state* dari Jurnal dan Check-in, memungkinkan analisis historis untuk metrik *Dashboard*.
* **Risiko Limit API/Verifikasi Google:** *Telah dimitigasi* -> Aplikasi menggunakan mode Test Users di Google Cloud Console untuk mem-*bypass* proses verifikasi ketat (*unverified app warning*), ideal untuk skenario kompetisi.
* **Risiko Demo Gagal:** *Telah dimitigasi* -> Telah disediakan fallback `demoCalendar` dan variabel `.env` untuk demonstrasi offline yang mulus.

---

## 7. Fase Eksekusi (Status Penyelesaian)
Seluruh MVP telah selesai dikerjakan dalam waktu rekor.

### Fase 1: FastAPI Core Engine & Prompting (Selesai ✅)
* [x] Eksperimen *System Prompt* JSON di Google AI Studio (Mendapatkan JSON Kalender Baru + *Reasoning Transcript*).
* [x] Setup FastAPI backend dan implementasi *routing* API.
* [x] Setup Relational Database (SQLite + SQLAlchemy) untuk menyimpan *Users*, *Events*, *Journal*, dan *Check-in*.

### Fase 2: Premium Custom Frontend & Panic Button (Selesai ✅)
* [x] Membangun antarmuka web modern (UI kustom *Dark/Light mode*).
* [x] Membuat animasi *Before/After Visualizer* dan komponen Transkrip AI.
* [x] Menyambungkan Frontend ke FastAPI Backend secara dinamis (AJAX).
* [x] Optimasi tata letak perangkat seluler (*Mobile Responsiveness* & *Scroll Fix*).

### Fase 3: Integrasi Eksternal & Fitur Pelengkap (Selesai ✅)
* [x] Implementasi Autentikasi OAuth2 (Google Identity Services) di Frontend dan verifikasi *token* di Backend.
* [x] Sinkronisasi Google Calendar API (Menarik jadwal 7 hari ke depan).
* [x] Pengerjaan fitur Morning Check-in, AI Journal, dan Dashboard (visualisasi statistik).

### Fase 4: Polishing & Deployment (Sedang Berjalan ⏳)
* [x] Dockerisasi FastAPI backend dan Frontend (`Dockerfile` & `docker-compose.yml`).
* [x] Deploy ke Google Cloud Run (URL Publik telah *live*).
* [ ] Rekaman Video Demo sinematik (2 menit) berdasarkan skenario "Penyelamat Jadwal".
