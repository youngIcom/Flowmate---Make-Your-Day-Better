# 🌊 FlowMate — Empathic AI Scheduler

![FlowMate Banner](https://via.placeholder.com/1200x300/121212/7c3aed?text=FlowMate+-+Empathic+AI+Scheduler)

[![Google Cloud Run](https://img.shields.io/badge/Deployed_on-Cloud_Run-4285F4?style=flat-square&logo=google-cloud)](https://cloud.google.com/run)
[![Gemini API](https://img.shields.io/badge/Powered_by-Gemini_1.5_Flash-8E75B2?style=flat-square)](https://ai.google.dev/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

**FlowMate** adalah asisten penjadwalan berempati yang bertindak sebagai "manajer operasional pribadi" Anda. Tidak seperti kalender konvensional yang kaku, FlowMate menggunakan **Google Gemini AI** untuk secara proaktif menyesuaikan jadwal harian Anda berdasarkan tingkat energi, kualitas tidur, dan kondisi mental.

Jangan biarkan jadwal mengontrol Anda. Biarkan jadwal yang beradaptasi dengan Anda.

Dibuat khusus untuk kompetisi **#JuaraVibeCoding** oleh Google for Developers Indonesia.

---

## ✨ Fitur Utama (Core Features)

### 🚨 1. One-Tap Rescue (The Panic Button)

Jadwal berantakan karena kesiangan atau mendadak kelelahan? Tekan _Panic Button_. Ceritakan kondisi Anda, dan FlowMate akan merombak sisa jadwal hari itu. Tugas berat ditunda, waktu istirahat diselipkan, namun jadwal wajib (seperti kelas atau _meeting_) tetap dipertahankan. Dilengkapi dengan **Reasoning Transcript** yang transparan.

### ☀️ 2. Smart Morning Check-in

Mulai hari dengan mencatat jam tidur dan _mood_. Jika Anda terdeteksi kurang tidur (energi rendah), FlowMate secara otomatis menggeser tugas-tugas _deep work_ ke sore hari saat energi Anda pulih.

### 📝 3. Empathic AI Journal

Curahkan keluh kesah atau pencapaian Anda. AI akan melakukan _Sentiment Analysis_ untuk memberikan _insight_ mingguan (contoh: "Kamu sangat produktif setiap Selasa pagi, mari jadikan itu waktu fokus permanen").

### 📊 4. Wellness Dashboard

Pantau korelasi antara tingkat energi, metrik _mood_, dan seberapa sering Anda melakukan _reschedule_ untuk menemukan ritme kerja terbaik Anda.

---

## 🛠️ Tech Stack & Arsitektur

FlowMate dibangun dengan pendekatan _Rapid Prototyping_ namun tetap mempertahankan standar performa dan UX kelas _Enterprise_.

- **Frontend:** Custom Vanilla Web UI (HTML5, CSS3, ES6) dengan implementasi _Glassmorphism_ dan _Fluid Typography_ (Responsive).
- **Backend:** Python 3.10+ & **FastAPI** (Asynchronous API yang sangat cepat).
- **Database:** **SQLite** dengan **SQLAlchemy** ORM (Self-contained, mempermudah deployment).
- **AI Engine:** **Google AI Studio (Gemini 1.5 Flash)** memanfaatkan mode _Structured Outputs (JSON)_.
- **Integrations:** **Google OAuth 2.0** (Identity Services) & **Google Calendar API**.
- **Deployment:** Docker & **Google Cloud Run**.

---

## 🚀 Panduan Instalasi (Local Development)

Ikuti langkah-seklangkah berikut untuk menjalankan FlowMate di mesin lokal Anda.

### Prasyarat (Prerequisites)

- Python 3.10 atau lebih baru
- Akun Google Cloud Platform (GCP) dengan Calendar API dan OAuth2 aktif.
- API Key dari [Google AI Studio](https://aistudio.google.com/).

### Langkah-langkah

1. **Clone repositori ini:**

   ```bash
   git clone https://github.com/username/FlowMate.git
   cd FlowMate
   ```

2. **Buat Virtual Environment & Install Dependensi:**

   ```bash
   python -m venv venv
   source venv/bin/activate  # Untuk Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Konfigurasi Environment Variables:**
   Salin file `.env.example` menjadi `.env` dan isi kredensial Anda.

   ```bash
   cp .env.example .env
   ```

   _Pastikan Anda mengisi `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, dan `GOOGLE_CLIENT_SECRET`._

4. **Jalankan Aplikasi:**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   Aplikasi akan berjalan di `http://localhost:8000`.

---

## 🐳 Deployment (Google Cloud Run)

Proyek ini telah dikonfigurasi untuk siap rilis menggunakan Docker dan Google Cloud Run.

1. **Build Docker Image:**

   ```bash
   docker build -t gcr.io/YOUR_PROJECT_ID/flowmate:latest .
   ```

2. **Push Image ke Google Container Registry (GCR):**

   ```bash
   docker push gcr.io/YOUR_PROJECT_ID/flowmate:latest
   ```

3. **Deploy ke Cloud Run:**
   ```bash
   gcloud run deploy flowmate \
     --image gcr.io/YOUR_PROJECT_ID/flowmate:latest \
     --platform managed \
     --region asia-southeast2 \
     --allow-unauthenticated \
     --set-env-vars="GEMINI_API_KEY=your_key,GOOGLE_CLIENT_ID=your_client_id"
   ```

---

## 📂 Struktur Direktori

```text
FlowMate/
├── main.py                 # FastAPI backend & routes
├── auth.py                 # Logika Autentikasi Google OAuth
├── database.py             # Setup SQLite & Model SQLAlchemy
├── requirements.txt        # Dependensi Python
├── Dockerfile              # Konfigurasi Docker image
├── docker-compose.yml      # Konfigurasi container service
├── static/                 # Folder Frontend
│   ├── index.html          # UI Utama (SPA)
│   ├── css/style.css       # Premium Design System (Responsive)
│   └── js/app.js           # Logika interaksi & pemanggilan API
└── document_requirement/   # PRD & Analisis Desain (Dokumentasi Internal)
```

---

## 🏆 Kriteria Penilaian #JuaraVibeCoding

- **Masalah (30%):** Memecahkan masalah _schedule fatigue_ dan siklus _burnout_ akibat kalender kaku yang sering dialami mahasiswa/Gen-Z.
- **Solusi (40%):** Antarmuka responsif, UX "delightful" dengan transisi kalender dinamis, dan backend yang tangguh.
- **Keunikan (30%):** _Panic Button_ yang berempati dengan _Reasoning Transcript_ transparan mengubah "AI Hitam" menjadi asisten manusiawi yang mendukung kesejahteraan (Wellness).

---

<p align="center">
  <i>Dibuat dengan 🌊 Vibes dan ☕ Kopi untuk masa depan yang lebih peduli kesehatan mental.</i>
</p>
