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
Berdasarkan analisis kritis untuk meningkatkan "UX Delight" dan menjamin persistensi data, struktur teknis diperbarui:
* **Frontend:** Custom Web UI (HTML/CSS/JS, Vite, atau React) - Meninggalkan Streamlit agar desain visual (Dark Mode, Glassmorphism, Micro-animations) bisa terlihat *premium* dan meningkatkan nilai UX secara masif di mata juri.
* **Backend:** Python (FastAPI) - API modern, sangat cepat, dan cocok untuk memproses logika Python/AI dan meneruskannya ke Frontend.
* **Database:** Google Cloud Firestore - Database NoSQL ringan untuk persistensi data (Syarat mutlak agar fitur AI Journal & Dashboard bisa berfungsi memori jangka panjang).
* **AI Engine:** Google AI Studio (Gemini 1.5 Flash / Pro) menggunakan **Structured Outputs (JSON Mode)**.
* **Integrasi Utama:** Google Calendar API (OAuth 2.0 Flow).
* **Environment:** Mendukung `DEMO_MODE` (JSON statis) dan `LIVE_MODE` (API asli).
* **Deployment (Wajib):** Google Cloud Run (di-*containerize* dengan Docker).

---

## 5. Arsitektur & Alur Data (Data Flow)
1. **Trigger:** User menginput kondisi via Custom Frontend.
2. **Fetch:** FastAPI Backend menerima request, memanggil Google Calendar API untuk mengambil *events* JSON, dan mengambil riwayat user dari Firestore.
3. **Prompt Construction:** Backend merakit (User Input + GCal Events JSON + Riwayat Firestore + System Prompt).
4. **AI Processing:** Dikirim ke Gemini API (Google AI Studio).
5. **JSON Response:** Gemini mengembalikan *New Schedule* + *Reasoning Transcript*.
6. **Approval:** Frontend menganimasikan *Before vs After* kalender dan menampilkan penalaran AI. User meng-klik "Approve".
7. **Sync:** Backend melakukan `PATCH` ke GCal API dan menyimpan riwayat check-in ke Firestore.

---

## 6. Risiko & Strategi Mitigasi (Kompetisi)
* **Risiko UX Kaku (Streamlit Penalty):** *Mitigasi* -> Menggunakan Custom Frontend dengan animasi visual (*Visual Diff*) agar juri merasakan antarmuka yang benar-benar dipoles (*polished*).
* **Risiko Fitur Jurnal/Dashboard Tanpa Memori:** *Mitigasi* -> Penggunaan Google Cloud Firestore agar AI memiliki konteks masa lalu pengguna, bukan hanya sesi saat ini.
* **Risiko Presentasi Video Membosankan:** *Mitigasi* -> Fokus video pada momen "Jadwalku Berantakan -> Satu Klik -> Kalender Rapi + AI Menjelaskan Alasannya". Demo diarahkan layaknya film pahlawan penyelamat jadwal.
* **Risiko Demo API Gagal:** *Mitigasi* -> Menggunakan data JSON offline (`DEMO_MODE`) saat rekaman video agar 100% aman dari limit API atau masalah *auth*.

---

## 7. Fase Eksekusi & Ruang Lingkup MVP
Meskipun target implementasi 4 fitur sangat ambisius dalam sisa waktu (2 minggu), kita tetap berkomitmen penuh untuk menyelesaikannya.

### Fase 1: FastAPI Core Engine & Prompting
* [ ] Eksperimen *System Prompt* JSON di Google AI Studio (Mendapatkan JSON Kalender Baru + *Reasoning Transcript*).
* [ ] Setup FastAPI backend dan implementasi `DEMO_MODE` (pembacaan JSON lokal).
* [ ] Setup Google Cloud Firestore untuk database riwayat jurnal.

### Fase 2: Premium Custom Frontend & Panic Button
* [ ] Membangun antarmuka web modern (UI kustom).
* [ ] Membuat animasi *Before/After Visualizer* dan komponen Transkrip AI.
* [ ] Menyambungkan Frontend ke FastAPI Backend.

### Fase 3: Integrasi Eksternal & Fitur Pelengkap
* [ ] Implementasi Autentikasi OAuth2 untuk Google Calendar API (`LIVE_MODE`).
* [ ] Pengerjaan fitur Morning Check-in, AI Journal, dan Dashboard (menarik data dari Firestore).

### Fase 4: Polishing & Deployment
* [ ] Dockerisasi FastAPI backend dan Frontend.
* [ ] Deploy ke Google Cloud Run.
* [ ] Rekaman Video Demo sinematik (2 menit).
