const API = '';
const STORAGE_KEYS = {
    guestMode: 'flowmate_guest_mode',
    demoEvents: 'flowmate_demo_events_v2',
    guestRescues: 'flowmate_guest_rescues_v2',
    guestCheckins: 'flowmate_guest_checkins_v2',
    guestJournals: 'flowmate_guest_journals_v2',
    theme: 'flowmate_theme_v2',
    token: 'flowmate_token',
    user: 'flowmate_user',
};

let authToken = localStorage.getItem(STORAGE_KEYS.token);
let authUser = localStorage.getItem(STORAGE_KEYS.user);
let guestMode = localStorage.getItem(STORAGE_KEYS.guestMode) === 'true';
let currentPage = 'home';
let currentEvents = [];
let latestRescuePlan = null;
let energyChart = null;
let moodChart = null;
let usingDemoFallback = false;

const fallbackDemoEvents = () => {
    const date = todayString();
    return [
        { id: 'evt-1', title: 'Morning Run & Gym', start: '07:00', end: '08:00', is_immovable: false, priority: 'low', date },
        { id: 'evt-2', title: 'Belajar Deep Learning', start: '09:00', end: '11:00', is_immovable: false, priority: 'high', date },
        { id: 'evt-3', title: 'Kuliah Sistem Kontrol', start: '14:00', end: '16:00', is_immovable: true, priority: 'high', date },
        { id: 'evt-4', title: 'Tugas Robotika', start: '16:15', end: '18:15', is_immovable: false, priority: 'high', date },
        { id: 'evt-5', title: 'Meeting Kelompok', start: '17:30', end: '18:30', is_immovable: false, priority: 'medium', date },
        { id: 'evt-6', title: 'Olahraga Ringan / Jalan Sore', start: '19:00', end: '19:45', is_immovable: false, priority: 'low', date },
    ];
};

document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');
    setupNavigation();
    setupTopbar();
    setupAuth();
    setupRescue();
    setupCheckin();
    setupJournal();
    setupAddEvent();
    setupVoiceInput();
    setupPWAInstall();
    updateDateDisplay();
    syncAuthUI();
    await loadSchedule();
    await loadJournalHistory();
    await loadDashboard();
});

function todayString() {
    return new Date().toISOString().split('T')[0];
}

function readStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function isAuthed() {
    return Boolean(authToken);
}

async function apiFetch(endpoint, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }
    const response = await fetch(`${API}${endpoint}`, { ...options, headers });
    if (response.status === 401 && authToken) {
        clearAuth();
        syncAuthUI();
        openAuthOverlay();
        throw new Error('Sesi login tidak valid. Silakan masuk lagi.');
    }
    return response;
}

function clearAuth() {
    authToken = null;
    authUser = null;
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.user);
}

function setupNavigation() {
    document.querySelectorAll('.nav-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            document.querySelectorAll('.nav-btn').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            navigateTo(button.dataset.page);
        });
    });

    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    mobileBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', (event) => {
        if (window.innerWidth > 960) return;
        if (!sidebar.contains(event.target) && event.target !== mobileBtn) {
            sidebar.classList.remove('open');
        }
    });
}

async function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach((section) => section.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    if (window.innerWidth <= 960) {
        document.getElementById('sidebar').classList.remove('open');
    }
    if (page === 'dashboard') {
        await loadDashboard();
    }
    if (page === 'journal') {
        await loadJournalHistory();
    }
}

function setupTopbar() {
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const nextTheme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
        applyTheme(nextTheme);
    });

    document.getElementById('auth-action-btn').addEventListener('click', () => {
        if (isAuthed()) {
            clearAuth();
            guestMode = false;
            localStorage.removeItem(STORAGE_KEYS.guestMode);
            syncAuthUI();
            openAuthOverlay();
            showToast('Kamu sudah logout.', 'success');
            loadSchedule();
            loadDashboard();
            loadJournalHistory();
            return;
        }
        openAuthOverlay();
    });
}

function applyTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.theme, theme);
}

function updateDateDisplay() {
    const formatted = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date());
    document.getElementById('date-display').textContent = formatted;
}

function setupAuth() {
    const loginTab = document.getElementById('tab-login');
    const registerTab = document.getElementById('tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    loginTab.addEventListener('click', () => {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    });

    registerTab.addEventListener('click', () => {
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    });

    document.getElementById('btn-demo-mode').addEventListener('click', async () => {
        guestMode = true;
        localStorage.setItem(STORAGE_KEYS.guestMode, 'true');
        closeAuthOverlay();
        syncAuthUI();
        await loadSchedule();
        await loadDashboard();
    });

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = document.getElementById('login-btn');
        const error = document.getElementById('login-error');
        error.classList.add('hidden');
        setLoading(btn, true);
        try {
            const formData = new URLSearchParams();
            formData.append('username', document.getElementById('login-username').value.trim());
            formData.append('password', document.getElementById('login-password').value);
            const response = await fetch(`${API}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Login gagal');
            authToken = data.access_token;
            authUser = data.username;
            localStorage.setItem(STORAGE_KEYS.token, authToken);
            localStorage.setItem(STORAGE_KEYS.user, authUser);
            guestMode = false;
            localStorage.removeItem(STORAGE_KEYS.guestMode);
            syncAuthUI();
            closeAuthOverlay();
            await loadSchedule();
            await loadJournalHistory();
            await loadDashboard();
            showToast('Berhasil masuk.', 'success');
        } catch (errorObj) {
            error.textContent = errorObj.message;
            error.classList.remove('hidden');
        } finally {
            setLoading(btn, false);
        }
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = document.getElementById('reg-btn');
        const error = document.getElementById('reg-error');
        error.classList.add('hidden');
        setLoading(btn, true);
        try {
            const payload = {
                username: document.getElementById('reg-username').value.trim(),
                email: document.getElementById('reg-email').value.trim(),
                password: document.getElementById('reg-password').value,
            };
            const response = await fetch(`${API}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Registrasi gagal');
            authToken = data.access_token;
            authUser = data.username;
            localStorage.setItem(STORAGE_KEYS.token, authToken);
            localStorage.setItem(STORAGE_KEYS.user, authUser);
            guestMode = false;
            localStorage.removeItem(STORAGE_KEYS.guestMode);
            syncAuthUI();
            closeAuthOverlay();
            await loadSchedule();
            await loadJournalHistory();
            await loadDashboard();
            showToast('Akun berhasil dibuat.', 'success');
        } catch (errorObj) {
            error.textContent = errorObj.message;
            error.classList.remove('hidden');
        } finally {
            setLoading(btn, false);
        }
    });
}

function syncAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const modeBadge = document.getElementById('mode-badge');
    const authActionBtn = document.getElementById('auth-action-btn');
    const authState = document.getElementById('auth-state');
    const processingMode = document.getElementById('processing-mode');

    if (isAuthed() || guestMode) {
        overlay.classList.add('hidden');
    } else {
        overlay.classList.remove('hidden');
    }

    if (isAuthed()) {
        modeBadge.textContent = 'LOCAL SAVE MODE';
        authActionBtn.textContent = `Logout ${authUser}`;
        authState.textContent = authUser;
        processingMode.textContent = 'connected';
    } else if (guestMode) {
        modeBadge.textContent = 'DEMO MODE';
        authActionBtn.textContent = 'Masuk';
        authState.textContent = 'guest/demo';
        processingMode.textContent = 'demo';
    } else {
        modeBadge.textContent = 'LOCKED';
        authActionBtn.textContent = 'Masuk';
        authState.textContent = 'sign in or demo';
        processingMode.textContent = 'idle';
    }
}

function openAuthOverlay() {
    document.getElementById('auth-overlay').classList.remove('hidden');
}

function closeAuthOverlay() {
    document.getElementById('auth-overlay').classList.add('hidden');
}

async function loadSchedule() {
    let loadedEvents = [];

    if (isAuthed()) {
        try {
            const response = await apiFetch('/api/events');
            const data = await response.json();
            loadedEvents = data.today_events || [];
            if (!loadedEvents.length) {
                const demoResponse = await fetch(`${API}/api/demo-calendar`);
                const demoData = await demoResponse.json();
                loadedEvents = demoData.today_events || fallbackDemoEvents();
                usingDemoFallback = true;
            } else {
                usingDemoFallback = false;
            }
        } catch (error) {
            console.error(error);
            loadedEvents = fallbackDemoEvents();
            usingDemoFallback = true;
        }
    } else {
        const cached = readStorage(STORAGE_KEYS.demoEvents, []);
        if (cached.length) {
            loadedEvents = cached;
        } else {
            try {
                const response = await fetch(`${API}/api/demo-calendar`);
                const data = await response.json();
                loadedEvents = data.today_events || fallbackDemoEvents();
            } catch {
                loadedEvents = fallbackDemoEvents();
            }
            writeStorage(STORAGE_KEYS.demoEvents, loadedEvents);
        }
    }

    if (!isAuthed()) usingDemoFallback = false;
    currentEvents = normalizeEvents(loadedEvents);
    latestRescuePlan = null;
    renderBeforeTimeline();
    renderAfterTimeline([]);
    renderDecisionLog([]);
    renderActionSummary(null);
    updateMetricsFromCurrentState();
}

function normalizeEvents(events) {
    return [...events]
        .map((event) => ({
            id: event.id || `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            title: event.title || 'Untitled Event',
            start: event.start,
            end: event.end,
            is_immovable: Boolean(event.is_immovable),
            priority: event.priority || 'medium',
            date: event.date || todayString(),
            status: event.status,
            label: event.label,
            reason: event.reason,
        }))
        .sort((a, b) => (`${a.date}${a.start}`).localeCompare(`${b.date}${b.start}`));
}

function getMinutes(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

function labelDate(dateValue) {
    const today = todayString();
    if (!dateValue || dateValue === today) return 'hari ini';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowString = tomorrow.toISOString().split('T')[0];
    if (dateValue === tomorrowString) return 'besok';
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(dateValue));
}

function annotateBeforeEvents(events) {
    const nowMinutes = getMinutes(currentTimeString());
    const today = todayString();
    return events.map((event, index) => {
        const previous = index > 0 ? events[index - 1] : null;
        const next = index < events.length - 1 ? events[index + 1] : null;
        let status = 'preserved';
        if (event.date !== today) {
            status = 'deferred';
        } else if ((previous && previous.date === event.date && getMinutes(previous.end) > getMinutes(event.start)) || (next && next.date === event.date && getMinutes(event.end) > getMinutes(next.start))) {
            status = 'conflict';
        } else if (getMinutes(event.end) <= nowMinutes) {
            status = 'missed';
        } else if (!event.is_immovable && event.priority === 'low') {
            status = 'optional';
        } else if (getMinutes(event.start) <= nowMinutes + 60) {
            status = 'risky';
        } else if (event.is_immovable) {
            status = 'fixed';
        }
        return { ...event, status };
    });
}

function currentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function renderBeforeTimeline() {
    const annotated = annotateBeforeEvents(currentEvents.filter((event) => event.date === todayString() || event.date === nextLocalDateString()));
    renderTimeline('timeline-before', annotated, { removable: true, emptyText: '<span class="empty-icon">📋</span>Jadwalmu kosong hari ini. Tambah event atau langsung jalankan <strong>Debug My Day</strong> untuk recovery plan.' });
}

function nextLocalDateString() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
}

function renderAfterTimeline(events) {
    renderTimeline('timeline-after', normalizeEvents(events), { removable: false, emptyText: '<span class="empty-icon">✨</span>Recovery plan akan muncul di sini setelah kamu jalankan <strong>Debug My Day</strong>.' });
}

function renderTimeline(containerId, events, options = {}) {
    const container = document.getElementById(containerId);
    const emptyText = options.emptyText || 'Tidak ada data.';
    if (!events.length) {
        container.innerHTML = `<div class="empty-timeline">${emptyText}</div>`;
        return;
    }

    container.innerHTML = events.map((event) => {
        const status = event.status || (event.is_immovable ? 'fixed' : 'preserved');
        const badgeText = (event.label || status).replace('_', ' ');
        const subtitle = event.reason || `${event.priority.toUpperCase()} • ${labelDate(event.date)}`;
        const removeButton = options.removable
            ? `<button class="remove-btn" data-remove-id="${event.id}" aria-label="Hapus event">×</button>`
            : `<span class="timeline-badge ${status}">${badgeText}</span>`;
        return `
            <div class="timeline-item ${status}">
                <div class="timeline-time">${event.start} - ${event.end}</div>
                <div>
                    <div class="timeline-title">${event.title}</div>
                    <div class="timeline-subtitle">${subtitle}</div>
                </div>
                ${removeButton}
            </div>
        `;
    }).join('');

    if (options.removable) {
        container.querySelectorAll('[data-remove-id]').forEach((button) => {
            button.addEventListener('click', () => removeEvent(button.dataset.removeId));
        });
    }
}

function updateMetricsFromCurrentState() {
    const annotated = annotateBeforeEvents(currentEvents.filter((event) => event.date === todayString()));
    const conflicts = annotated.filter((event) => event.status === 'conflict').length;
    const missed = annotated.filter((event) => event.status === 'missed').length;
    const lowEnergy = parseInt(document.getElementById('rescue-energy').value, 10) <= 4 ? 12 : 0;
    const damage = Math.min(100, 22 + conflicts * 16 + missed * 12 + lowEnergy);
    document.getElementById('metric-damage').textContent = `${damage}%`;
    document.getElementById('metric-before').textContent = `${Math.max(100 - damage, 8)}%`;
    document.getElementById('metric-after').textContent = '--';
    document.getElementById('metric-recovered').textContent = annotated.filter((event) => event.is_immovable).length;
}

function setupRescue() {
    const rescueEnergy = document.getElementById('rescue-energy');
    const rescueEnergyValue = document.getElementById('rescue-energy-value');
    rescueEnergy.addEventListener('input', () => {
        rescueEnergyValue.textContent = rescueEnergy.value;
        if (!latestRescuePlan) updateMetricsFromCurrentState();
    });

    document.getElementById('rescue-submit').addEventListener('click', handleRescueSubmit);
    document.getElementById('approve-btn').addEventListener('click', handleApplyPatch);
    document.getElementById('reject-btn').addEventListener('click', () => {
        latestRescuePlan = null;
        renderAfterTimeline([]);
        renderDecisionLog([]);
        renderActionSummary(null);
        updateMetricsFromCurrentState();
    });
    document.getElementById('reset-demo-btn').addEventListener('click', async () => {
        if (isAuthed()) {
            showToast('Reset demo data hanya tersedia untuk guest mode.', 'warning');
            return;
        }
        const events = fallbackDemoEvents();
        writeStorage(STORAGE_KEYS.demoEvents, events);
        currentEvents = normalizeEvents(events);
        latestRescuePlan = null;
        renderBeforeTimeline();
        renderAfterTimeline([]);
        renderDecisionLog([]);
        renderActionSummary(null);
        updateMetricsFromCurrentState();
        showToast('Demo data direset.', 'success');
    });

    setupPanicFAB();
}

// Setup Panic FAB
function setupPanicFAB() {
    const fab = document.getElementById('panic-fab');
    if (!fab) return;
    fab.addEventListener('click', () => {
        // Haptic feedback on mobile
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        
        // Navigate to home (rescue console)
        document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
        const homeBtn = document.querySelector('[data-page="home"]');
        if (homeBtn) homeBtn.classList.add('active');
        navigateTo('home');
        
        // Focus the rescue input
        const rescueInput = document.getElementById('rescue-message');
        if (rescueInput) {
            rescueInput.focus();
            rescueInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        showToast('🚨 Rescue Console dibuka. Ceritakan situasimu.', 'success');
    });
}

async function handleRescueSubmit() {
    const message = document.getElementById('rescue-message').value.trim();
    if (!message) {
        showToast('Ceritakan situasimu dulu.', 'warning');
        return;
    }

    const energy = parseInt(document.getElementById('rescue-energy').value, 10);
    const mood = document.getElementById('rescue-mood').value;
    const button = document.getElementById('rescue-submit');
    setLoading(button, true);

    // Haptic feedback on rescue submit
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);

    renderTrace([
        'Detecting conflicts...',
        'Analyzing energy budget...',
        'Protecting fixed events...',
        'Generating recovery plan...',
    ], 'running');

    try {
        const response = await apiFetch('/api/rescue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                situation: message,
                energy_level: energy,
                mood,
                current_time: currentTimeString(),
                mode: isAuthed() ? 'live' : 'demo',
                today_events: currentEvents,
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Gagal membuat rescue plan');
        latestRescuePlan = result;
        renderRescueResult(result);
        if (!isAuthed()) recordGuestRescue(result, energy, mood);
        renderTrace([
            'Detecting conflicts... done',
            'Analyzing energy budget... done',
            'Protecting fixed events... done',
            'Schedule patched successfully.',
        ], result.mode || 'demo');
        showToast('Recovery plan siap ditinjau.', 'success');
    } catch (error) {
        console.error(error);
        renderTrace(['Rescue failed. Using fallback is recommended.'], 'error');
        showToast(error.message || 'Gagal membuat rescue plan.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderTrace(lines, status) {
    document.getElementById('processing-mode').textContent = status;
    document.getElementById('debug-trace').innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
}

function renderRescueResult(plan) {
    renderAfterTimeline(plan.new_schedule || []);
    renderDecisionLog(plan.decision_log || []);
    renderActionSummary(plan);
    document.getElementById('metric-damage').textContent = `${plan.damage_assessment?.score ?? '--'}%`;
    document.getElementById('metric-before').textContent = `${plan.recovery_score_before ?? '--'}%`;
    document.getElementById('metric-after').textContent = `${plan.recovery_score_after ?? '--'}%`;
    document.getElementById('metric-recovered').textContent = plan.stats?.fixed_events_preserved ?? 0;
}

function renderDecisionLog(items) {
    const list = document.getElementById('decision-log-list');
    if (!items.length) {
        list.innerHTML = '<li>Belum ada recovery plan. Jalankan <span class="mono">Debug My Day</span> untuk melihat patch notes.</li>';
        return;
    }
    list.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
}

function renderActionSummary(plan) {
    const section = document.getElementById('rescue-result');
    if (!plan) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    document.getElementById('summary-title').textContent = 'Schedule patched successfully';
    document.getElementById('session-mode').textContent = plan.mode || 'demo';
    document.getElementById('summary-text').textContent = plan.summary || '-';
    document.getElementById('energy-text').textContent = plan.energy_assessment?.message || '-';

    const actions = plan.schedule_actions || [];
    document.getElementById('schedule-actions-list').innerHTML = actions.length
        ? actions.map((item) => `<li><strong>${item.event_title}</strong> · ${item.action}${item.to ? ` → ${item.to}` : ''}<br>${item.reason}</li>`).join('')
        : '<li>Tidak ada action tambahan.</li>';

    const risks = plan.risk_flags || [];
    document.getElementById('risk-flags').innerHTML = risks.length
        ? risks.map((item) => `<li>${item}</li>`).join('')
        : '<li>Tidak ada red flag utama. Draft siap direview.</li>';
}

async function handleApplyPatch() {
    if (!latestRescuePlan) {
        showToast('Belum ada patch untuk diterapkan.', 'warning');
        return;
    }

    const validationResponse = await apiFetch('/api/validate-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            original_events: currentEvents,
            new_schedule: latestRescuePlan.new_schedule || [],
            energy_level: parseInt(document.getElementById('rescue-energy').value, 10),
        }),
    });
    const validation = await validationResponse.json();
    if (!validation.valid) {
        showToast('Patch gagal validasi. Cek risk flags dulu.', 'danger');
        return;
    }

    if (isAuthed()) {
        const response = await apiFetch('/api/apply-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: latestRescuePlan.session_id, new_schedule: latestRescuePlan.new_schedule || [] }),
        });
        const data = await response.json();
        if (!response.ok) {
            showToast(data.detail || 'Gagal apply patch.', 'danger');
            return;
        }
        await loadSchedule();
    } else {
        currentEvents = normalizeEvents((latestRescuePlan.new_schedule || []).filter((event) => event.status !== 'canceled'));
        writeStorage(STORAGE_KEYS.demoEvents, currentEvents);
        renderBeforeTimeline();
    }

    latestRescuePlan = null;
    renderAfterTimeline([]);
    renderDecisionLog([]);
    renderActionSummary(null);
    updateMetricsFromCurrentState();
    await loadDashboard();
    // Show undo button for logged-in users
    const undoBtn = document.getElementById('undo-btn');
    if (isAuthed()) undoBtn.classList.remove('hidden');
    showToast('Patch berhasil diterapkan.', 'success');
}

async function removeEvent(eventId) {
    if (isAuthed() && !usingDemoFallback) {
        try {
            const response = await apiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Gagal menghapus event');
            await loadSchedule();
            showToast('Event dihapus.', 'success');
        } catch (error) {
            showToast(error.message, 'danger');
        }
        return;
    }

    currentEvents = currentEvents.filter((event) => event.id !== eventId);
    writeStorage(STORAGE_KEYS.demoEvents, currentEvents);
    renderBeforeTimeline();
    updateMetricsFromCurrentState();
    showToast('Event demo dihapus.', 'success');
}

function setupCheckin() {
    const sleep = document.getElementById('ci-sleep');
    const sleepVal = document.getElementById('ci-sleep-val');
    const energy = document.getElementById('ci-energy');
    const energyVal = document.getElementById('ci-energy-val');

    sleep.addEventListener('input', () => { sleepVal.textContent = sleep.value; });
    energy.addEventListener('input', () => { energyVal.textContent = energy.value; });
    document.getElementById('checkin-submit').addEventListener('click', handleCheckin);
}

async function handleCheckin() {
    const button = document.getElementById('checkin-submit');
    setLoading(button, true);
    try {
        const payload = {
            sleep_hours: parseFloat(document.getElementById('ci-sleep').value),
            wake_up_time: document.getElementById('ci-wake').value,
            energy_level: parseInt(document.getElementById('ci-energy').value, 10),
            mood: document.getElementById('ci-mood').value,
            top_priority: document.getElementById('ci-priority').value.trim(),
            today_events: currentEvents,
        };
        const response = await apiFetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Check-in gagal');
        renderCheckinResult(result);
        if (!isAuthed()) recordGuestCheckin(payload);
        await loadDashboard();
        showToast('Morning check-in selesai.', 'success');
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Gagal check-in.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderCheckinResult(result) {
    const container = document.getElementById('checkin-result');
    const timelineItems = (result.new_schedule || []).slice(0, 4).map((event) => `
        <li><strong>${event.title}</strong> · ${event.start}-${event.end}</li>
    `).join('');
    container.innerHTML = `
        <div class="panel-header">
            <div>
                <p class="panel-kicker">Morning Output</p>
                <h3>Plan yang lebih realistis</h3>
            </div>
            <span class="panel-tag">${result.damage_assessment?.level || 'stable'}</span>
        </div>
        <div class="system-box">
            <p>${result.summary || '-'}</p>
        </div>
        <div class="system-box">
            <h4>Focus Window</h4>
            <p>${result.energy_assessment?.message || '-'}</p>
        </div>
        <div class="system-box">
            <h4>Suggested Sequence</h4>
            <ul class="decision-list">${timelineItems || '<li>Tidak ada rekomendasi khusus.</li>'}</ul>
        </div>
    `;
}

function setupJournal() {
    document.getElementById('journal-submit').addEventListener('click', handleJournalSubmit);
    const weeklyBtn = document.getElementById('load-weekly-insight-btn');
    if (weeklyBtn) weeklyBtn.addEventListener('click', loadWeeklyInsight);
}

async function handleJournalSubmit() {
    const text = document.getElementById('journal-text').value.trim();
    if (!text) {
        showToast('Tulis jurnal dulu.', 'warning');
        return;
    }
    const button = document.getElementById('journal-submit');
    setLoading(button, true);
    try {
        const response = await apiFetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Jurnal gagal disimpan');
        if (!isAuthed()) {
            const guestEntries = readStorage(STORAGE_KEYS.guestJournals, []);
            guestEntries.unshift(result.entry);
            writeStorage(STORAGE_KEYS.guestJournals, guestEntries.slice(0, 30));
        }
        renderJournalInsight(result.analysis || result.entry?.analysis);
        document.getElementById('journal-text').value = '';
        await loadJournalHistory();
        await loadDashboard();
        showToast('Jurnal tersimpan.', 'success');
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Gagal menyimpan jurnal.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderJournalInsight(analysis) {
    const section = document.getElementById('journal-insight');
    const content = document.getElementById('insight-content');
    section.classList.remove('hidden');
    content.innerHTML = `
        <div class="insight-item"><strong>Mood:</strong> ${analysis?.mood || '-'}</div>
        <div class="insight-item"><strong>Produktivitas:</strong> ${analysis?.productivity || '-'} / 10</div>
        <div class="insight-item"><strong>Blockers:</strong> ${(analysis?.blockers || []).join(', ') || 'Tidak ada blocker utama'}</div>
        <div class="insight-item"><strong>Insight:</strong> ${analysis?.insight || '-'}</div>
    `;
}

async function loadJournalHistory() {
    let entries = [];
    if (isAuthed()) {
        try {
            const response = await apiFetch('/api/journal');
            const data = await response.json();
            entries = data.entries || [];
        } catch (error) {
            console.error(error);
        }
    } else {
        entries = readStorage(STORAGE_KEYS.guestJournals, []);
    }
    renderJournalHistory(entries);
}

function renderJournalHistory(entries) {
    const container = document.getElementById('journal-history');
    if (!entries.length) {
        container.innerHTML = `
            <div class="empty-state-block">
                <h3>Belum ada jurnal</h3>
                <p>Entry yang kamu simpan akan muncul di sini.</p>
            </div>
        `;
        return;
    }
    container.innerHTML = entries.map((entry) => `
        <div class="journal-card">
            <div class="journal-card-date">${entry.date || todayString()}</div>
            <div>${entry.text}</div>
            <div class="journal-card-meta">Mood: ${entry.mood || entry.analysis?.mood || '-'}</div>
        </div>
    `).join('');
}

function setupAddEvent() {
    const modal = document.getElementById('add-event-modal');
    document.getElementById('btn-add-event').addEventListener('click', () => {
        modal.classList.remove('hidden');
        const now = new Date();
        const start = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        now.setHours(now.getHours() + 1);
        const end = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        document.getElementById('event-title').value = '';
        document.getElementById('event-start').value = start;
        document.getElementById('event-end').value = end;
        document.getElementById('event-priority').value = 'medium';
        document.getElementById('event-immovable').checked = false;
    });
    document.getElementById('add-event-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.classList.add('hidden');
    });
    document.getElementById('add-event-submit').addEventListener('click', handleAddEvent);
}

async function handleAddEvent() {
    const title = document.getElementById('event-title').value.trim();
    const start = document.getElementById('event-start').value;
    const end = document.getElementById('event-end').value;
    if (!title || !start || !end) {
        showToast('Lengkapi semua field event.', 'warning');
        return;
    }

    const newEvent = {
        id: `evt-${Date.now()}`,
        title,
        start,
        end,
        priority: document.getElementById('event-priority').value,
        is_immovable: document.getElementById('event-immovable').checked,
        date: todayString(),
    };
    const button = document.getElementById('add-event-submit');
    setLoading(button, true);

    try {
        if (isAuthed()) {
            const response = await apiFetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newEvent),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Gagal menyimpan event');
            await loadSchedule();
        } else {
            currentEvents.push(newEvent);
            currentEvents = normalizeEvents(currentEvents);
            writeStorage(STORAGE_KEYS.demoEvents, currentEvents);
            renderBeforeTimeline();
            updateMetricsFromCurrentState();
        }
        document.getElementById('add-event-modal').classList.add('hidden');
        showToast('Event berhasil ditambahkan.', 'success');
    } catch (error) {
        console.error(error);
        showToast(error.message || 'Gagal menambah event.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

async function loadDashboard() {
    const data = isAuthed() ? await loadDashboardFromApi() : buildGuestDashboard();
    document.getElementById('stat-rescues').textContent = data.total_rescues || 0;
    document.getElementById('stat-checkins').textContent = data.total_checkins || 0;
    document.getElementById('stat-energy').textContent = data.avg_energy || 0;
    document.getElementById('stat-preservation').textContent = `${data.fixed_event_preservation_rate || 0}%`;
    // Update AI insight callout
    const calloutText = document.getElementById('dashboard-ai-text');
    if (calloutText) {
        if (data.avg_recovery_improvement && data.avg_recovery_improvement > 0) {
            calloutText.textContent = `FlowMate sudah meningkatkan recovery rate-mu rata-rata ${data.avg_recovery_improvement}% per sesi. Energi rata-rata: ${data.avg_energy}/10.`;
        } else if (data.total_rescues > 0) {
            calloutText.textContent = `Kamu sudah menjalankan ${data.total_rescues} rescue session. Terus gunakan FlowMate untuk melihat tren pemulihanmu.`;
        } else {
            calloutText.textContent = 'Jalankan beberapa rescue session dan tulis jurnal untuk mendapatkan insight personal dari FlowMate AI.';
        }
    }
    renderEnergyChart(data.checkin_history || []);
    renderMoodChart(data.checkin_history || [], data.journal_entries || []);
}

async function loadDashboardFromApi() {
    try {
        const response = await apiFetch('/api/dashboard');
        return await response.json();
    } catch (error) {
        console.error(error);
        return buildGuestDashboard();
    }
}

function buildGuestDashboard() {
    const rescues = readStorage(STORAGE_KEYS.guestRescues, []);
    const checkins = readStorage(STORAGE_KEYS.guestCheckins, []);
    const journals = readStorage(STORAGE_KEYS.guestJournals, []);
    const energyValues = [...rescues.map((item) => item.energy_level), ...checkins.map((item) => item.energy_level)].filter(Boolean);
    const avgEnergy = energyValues.length ? (energyValues.reduce((sum, value) => sum + value, 0) / energyValues.length).toFixed(1) : 0;
    const preservationRates = rescues.map((item) => item.fixed_event_preservation_rate || 0).filter((value) => value >= 0);
    const history = [
        ...rescues.map((item) => ({ type: 'rescue', mood: item.mood, energy_level: item.energy_level, timestamp: item.timestamp })),
        ...checkins.map((item) => ({ type: 'checkin', mood: item.mood, energy_level: item.energy_level, timestamp: item.timestamp })),
    ].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return {
        total_rescues: rescues.length,
        total_checkins: checkins.length,
        avg_energy: avgEnergy,
        fixed_event_preservation_rate: preservationRates.length ? Math.round(preservationRates.reduce((sum, value) => sum + value, 0) / preservationRates.length) : 0,
        checkin_history: history,
        journal_entries: journals,
    };
}

function renderEnergyChart(history) {
    const ctx = document.getElementById('energy-chart');
    if (energyChart) energyChart.destroy();
    const labels = history.length ? history.map((item, index) => item.type ? `${item.type}-${index + 1}` : `#${index + 1}`) : ['no-data'];
    const values = history.length ? history.map((item) => item.energy_level || 0) : [0];

    energyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Energy',
                data: values,
                borderColor: '#56d4c8',
                backgroundColor: 'rgba(86, 212, 200, 0.14)',
                pointBackgroundColor: '#ffb454',
                tension: 0.34,
                fill: true,
            }],
        },
        options: chartOptions({ min: 0, max: 10 }),
    });
}

function renderMoodChart(history, journals) {
    const ctx = document.getElementById('mood-chart');
    if (moodChart) moodChart.destroy();
    const counts = {};
    [...history, ...journals].forEach((item) => {
        const mood = item.mood || item.analysis?.mood || 'unknown';
        counts[mood] = (counts[mood] || 0) + 1;
    });
    const labels = Object.keys(counts).length ? Object.keys(counts) : ['unknown'];
    const values = Object.values(counts).length ? Object.values(counts) : [1];
    moodChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: ['#56d4c8', '#ffb454', '#ff7a7a', '#6ce5a1', '#7fa6ff', '#9f8fff'],
                borderWidth: 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: getComputedStyle(document.body).getPropertyValue('--text-soft') },
                },
            },
        },
    });
}

function chartOptions(yScale = {}) {
    const styles = getComputedStyle(document.body);
    const lineColor = styles.getPropertyValue('--line').trim();
    const textColor = styles.getPropertyValue('--text-soft').trim();
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            x: { grid: { color: lineColor }, ticks: { color: textColor } },
            y: { grid: { color: lineColor }, ticks: { color: textColor }, ...yScale },
        },
    };
}

function recordGuestRescue(plan, energyLevel, mood) {
    const rescues = readStorage(STORAGE_KEYS.guestRescues, []);
    rescues.unshift({
        timestamp: new Date().toISOString(),
        energy_level: energyLevel,
        mood,
        fixed_event_preservation_rate: plan.stats?.fixed_events_preserved ? 100 : 0,
        recovery_score_after: plan.recovery_score_after,
    });
    writeStorage(STORAGE_KEYS.guestRescues, rescues.slice(0, 30));
}

function recordGuestCheckin(payload) {
    const entries = readStorage(STORAGE_KEYS.guestCheckins, []);
    entries.unshift({
        timestamp: new Date().toISOString(),
        energy_level: payload.energy_level,
        mood: payload.mood,
    });
    writeStorage(STORAGE_KEYS.guestCheckins, entries.slice(0, 30));
}

function setLoading(button, loading) {
    const text = button.querySelector('.btn-text');
    const loader = button.querySelector('.btn-loader');
    button.disabled = loading;
    if (text) text.classList.toggle('hidden', loading);
    if (loader) loader.classList.toggle('hidden', !loading);
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        toast.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
        setTimeout(() => toast.remove(), 240);
    }, 2800);
}

// ── Undo Schedule ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', async () => {
            if (!isAuthed()) {
                showToast('Login dulu untuk menggunakan undo.', 'warning');
                return;
            }
            try {
                const response = await apiFetch('/api/undo-schedule', { method: 'POST' });
                const data = await response.json();
                if (!response.ok) throw new Error(data.detail || 'Undo gagal.');
                undoBtn.classList.add('hidden');
                await loadSchedule();
                showToast(`Undo berhasil — ${data.restored_count} event dikembalikan.`, 'success');
            } catch (error) {
                showToast(error.message || 'Gagal undo.', 'danger');
            }
        });
    }
});

// ── Voice Input ────────────────────────────────────────────────
function setupVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return; // Browser tidak mendukung

    function attachMic(btnId, targetId) {
        const btn = document.getElementById(btnId);
        const target = document.getElementById(targetId);
        if (!btn || !target) return;

        let recognition = null;
        let isRecording = false;

        btn.addEventListener('click', () => {
            if (isRecording) {
                recognition.stop();
                return;
            }
            recognition = new SpeechRecognition();
            recognition.lang = 'id-ID';
            recognition.continuous = false;
            recognition.interimResults = true;

            recognition.onstart = () => {
                isRecording = true;
                btn.classList.add('recording');
                btn.title = 'Sedang merekam... klik untuk berhenti';
                showToast('🎤 Sedang mendengarkan...', 'success');
            };

            recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map((result) => result[0].transcript)
                    .join('');
                target.value = transcript;
            };

            recognition.onend = () => {
                isRecording = false;
                btn.classList.remove('recording');
                btn.title = 'Klik untuk bicara';
            };

            recognition.onerror = (event) => {
                isRecording = false;
                btn.classList.remove('recording');
                showToast(`Voice error: ${event.error}`, 'warning');
            };

            recognition.start();
        });
    }

    attachMic('voice-rescue-btn', 'rescue-message');
    attachMic('voice-journal-btn', 'journal-text');
}

// ── Weekly Insight ─────────────────────────────────────────────
async function loadWeeklyInsight() {
    const btn = document.getElementById('load-weekly-insight-btn');
    const container = document.getElementById('weekly-insight-content');
    setLoading(btn, true);
    try {
        const response = await apiFetch('/api/journal/weekly-insight');
        const data = await response.json();
        renderWeeklyInsight(data);
    } catch (error) {
        container.innerHTML = `<div class="empty-state-block"><h3>Gagal memuat insight</h3><p>${error.message}</p></div>`;
    } finally {
        setLoading(btn, false);
    }
}

function renderWeeklyInsight(data) {
    const container = document.getElementById('weekly-insight-content');
    if (!data || data.entries_count === 0) {
        container.innerHTML = `
            <div class="empty-state-block">
                <h3>Belum cukup data</h3>
                <p>${data?.message || 'Tulis jurnal dulu untuk melihat pola mingguan.'}</p>
            </div>
        `;
        return;
    }

    const blockerTags = (data.top_blockers || []).map((b) => `<span class="blocker-tag">${b}</span>`).join('');
    const patternItems = (data.patterns || []).map((p) => `<li>${p}</li>`).join('');
    const moodDist = Object.entries(data.mood_distribution || {})
        .map(([k, v]) => `${k}: ${v}×`)
        .join('  ·  ');

    container.innerHTML = `
        <div class="insight-grid">
            <div class="insight-stat">
                <span class="stat-label">Jurnal ditulis</span>
                <strong>${data.entries_count}</strong>
                <span style="color:var(--text-muted);font-size:0.8rem"> entri</span>
            </div>
            <div class="insight-stat">
                <span class="stat-label">Mood dominan</span>
                <strong>${data.dominant_mood || '-'}</strong>
            </div>
            <div class="insight-stat">
                <span class="stat-label">Avg produktivitas</span>
                <strong>${data.avg_productivity || '-'}</strong>
                <span style="color:var(--text-muted);font-size:0.8rem"> / 10</span>
            </div>
        </div>
        ${data.message ? `<div class="insight-message">💡 ${data.message}</div>` : ''}
        ${patternItems ? `<ul class="insight-patterns">${patternItems}</ul>` : ''}
        ${blockerTags ? `
            <div style="margin-top:16px">
                <p class="field-label">Top Blockers Minggu Ini</p>
                <div class="blockers-row">${blockerTags}</div>
            </div>
        ` : ''}
        ${moodDist ? `<p style="margin-top:14px;font-size:0.82rem;color:var(--text-muted);font-family:var(--mono)">${data.date_range} · ${moodDist}</p>` : ''}
    `;
}

// ── PWA Install Prompt ─────────────────────────────────────────
function setupPWAInstall() {
    // Register service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/static/sw.js').catch(() => {});
        });
    }

    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredPrompt = event;
        showInstallBanner();
    });

    window.addEventListener('appinstalled', () => {
        hidePWABanner();
        showToast('FlowMate berhasil diinstall! 🎉', 'success');
    });

    function showInstallBanner() {
        if (document.getElementById('pwa-install-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.innerHTML = `
            <p>📱 Install FlowMate sebagai app di perangkatmu!</p>
            <div class="pwa-install-actions">
                <button class="primary-btn" id="pwa-install-btn">Install</button>
                <button class="ghost-btn" id="pwa-dismiss-btn">✕</button>
            </div>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            hidePWABanner();
            if (outcome === 'accepted') showToast('Menginstall FlowMate...', 'success');
        });

        document.getElementById('pwa-dismiss-btn').addEventListener('click', hidePWABanner);
    }

    function hidePWABanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.remove();
    }
}
