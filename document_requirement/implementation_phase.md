# Implementation Phases - FlowMate

Dokumen ini memecah eksekusi pembuatan FlowMate menjadi fase-fase terstruktur. Berdasarkan evaluasi kritis, kita beralih dari Streamlit ke Custom Frontend (HTML/JS + FastAPI) dan tetap mempertahankan komitmen ambisius untuk menyelesaikan 4 fitur utama.

---

## Phase 1: AI Prompting, FastAPI Backend & Database (Minggu 1)
**Tujuan:** Membangun fondasi mesin penalaran AI (The Brain) dan sistem penyimpanan data (The Memory).
**Lingkungan:** Python (FastAPI), Google AI Studio, Google Cloud Firestore.

* **Langkah 1.1:** Setup project FastAPI (`main.py`) dan environment-nya.
* **Langkah 1.2:** Eksperimen System Prompt di Gemini. Instruksikan untuk membaca jadwal `dummy_calendar.json` dan mengembalikan JSON jadwal baru beserta data **Reasoning Transcript** (alasan spesifik untuk tiap perubahan).
* **Langkah 1.3:** Hubungkan FastAPI ke Gemini API dan buat *endpoint* simulasi offline (`/api/reschedule/demo`).
* **Langkah 1.4:** Setup Google Cloud Firestore. Buat fungsi untuk menyimpan/membaca histori jurnal dan metrik energi.
* **Deliverable Fase 1:** Endpoint API lokal (FastAPI) yang siap menerima kondisi user dan mengembalikan JSON jadwal baru + alasan perubahan dengan cepat.

---

## Phase 2: Premium Custom Frontend & Panic Button (Minggu 2 - Awal)
**Tujuan:** Membangun antarmuka premium yang memberikan momen "WOW" secara visual.
**Lingkungan:** Custom Web UI (HTML/CSS/JS atau Vite).

* **Langkah 2.1:** Buat UI dasar yang estetik (Dark Mode, layout modern, minim distraksi).
* **Langkah 2.2:** Rancang tombol raksasa "Panic Button" dengan animasi transisi yang mulus (loading).
* **Langkah 2.3:** Bangun komponen **Visual Diff** (Perbandingan Kalender Berantakan vs Rapi) dan panel **Reasoning Transcript** yang dapat di-*collapse*.
* **Langkah 2.4:** Hubungkan UI dengan API `/api/reschedule/demo` dari Fase 1.
* **Deliverable Fase 2:** Prototipe aplikasi web yang sangat cantik dan fungsional secara offline (`DEMO_MODE`). Di titik ini, kamu **sudah siap merekam video demo sinematik!**

---

## Phase 3: The 3 Extra Features & Google Sync (Minggu 2 - Akhir)
**Tujuan:** Membuktikan ambisi kita dengan menyelesaikan 3 fitur lainnya (Check-in, Journal, Dashboard) dan mengintegrasikan akun Google Calendar asli.
**Lingkungan:** FastAPI, Frontend UI, Google Cloud Console.

* **Langkah 3.1 (GCal Sync):** Setup OAuth 2.0 di GCP. Tulis utilitas FastAPI untuk menarik jadwal GCal pengguna dan menyinkronkan (PATCH) jadwal baru setelah konfirmasi.
* **Langkah 3.2 (Morning Check-in):** Bangun UI form Check-in dan hubungkan dengan *endpoint* penjadwalan.
* **Langkah 3.3 (AI Journal):** Bangun UI Jurnal. Kirim teks jurnal ke FastAPI, proses *Sentiment Analysis* dengan Gemini, dan simpan hasilnya di Firestore.
* **Langkah 3.4 (Dashboard):** Tarik data riwayat energi vs produktivitas dari Firestore via FastAPI dan tampilkan menggunakan *library* grafik sederhana (misal: Chart.js).
* **Deliverable Fase 3:** Aplikasi FlowMate dengan 4 fitur utama yang berfungsi penuh secara *end-to-end* dengan akun Google sungguhan (`LIVE_MODE`).

---

## Phase 4: Cloud Deployment (Penyelesaian)
**Tujuan:** Merilis aplikasi ke internet agar bisa dinilai oleh juri (Syarat Wajib #JuaraVibeCoding).
**Lingkungan:** Docker & Google Cloud Run.

* **Langkah 4.1:** Buat `Dockerfile` yang memuat Frontend statis dan backend FastAPI.
* **Langkah 4.2:** Build dan test *container* Docker secara lokal.
* **Langkah 4.3:** Deploy ke Google Cloud Run dan atur *environment variables* (Gemini API Key, Google OAuth Secrets, Service Account Firestore).
* **Langkah 4.4:** Uji coba Live URL secara menyeluruh.
* **Deliverable Fase 4:** Aplikasi *Live* di Cloud Run yang siap untuk di-*submit*.
