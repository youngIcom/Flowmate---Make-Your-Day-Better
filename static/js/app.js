const API = '';
const STORAGE_KEYS = {
    theme: 'flowmate_theme_v2',
    token: 'flowmate_token',
    user: 'flowmate_user',
};
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

let authToken = localStorage.getItem(STORAGE_KEYS.token);
let authUser = localStorage.getItem(STORAGE_KEYS.user);
let currentProfile = null;
let currentPage = 'home';
let currentEvents = [];
let latestRescuePlan = null;
let energyChart = null;
let moodChart = null;
let publicConfig = null;
let googleCalendarTokenClient = null;
let googleCalendarAccessToken = null;
let googleCalendarTokenExpiresAt = 0;

cleanupLegacyDemoState();

document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');
    setupNavigation();
    setupTopbar();
    setupAuth();
    setupProfileDrawer();
    setupRescue();
    setupCheckin();
    setupJournal();
    setupAddEvent();
    setupUndo();
    setupPanicFab();
    updateDateDisplay();
    scheduleCheckinGreeting();
    syncAuthUI();
    await refreshAll();
});

function cleanupLegacyDemoState() {
    [
        'flowmate_guest_mode',
        'flowmate_demo_events_v2',
        'flowmate_guest_rescues_v2',
        'flowmate_guest_checkins_v2',
        'flowmate_guest_journals_v2',
    ].forEach((key) => localStorage.removeItem(key));
}

function isAuthed() {
    return Boolean(authToken);
}

function todayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function currentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getMinutes(value) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
}

function getDisplayName() {
    return currentProfile?.display_name || authUser || 'FlowMate User';
}

function getInitial() {
    return getDisplayName().trim().charAt(0).toUpperCase() || 'F';
}

function normalizeJournalAnalysis(analysis = {}) {
    const blockersRaw = analysis.blockers;
    const blockers = Array.isArray(blockersRaw)
        ? blockersRaw
        : blockersRaw
            ? [String(blockersRaw)]
            : [];
    const productivityRaw = analysis.productivity;
    const productivityNumber = Number(productivityRaw);
    return {
        mood: analysis.mood || '-',
        productivity: Number.isFinite(productivityNumber) ? productivityNumber : '-',
        blockers,
        insight: analysis.insight || '-',
    };
}

async function apiFetch(endpoint, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(`${API}${endpoint}`, { ...options, headers });
    if (response.status === 401) {
        logout(false);
        openAuthOverlay();
        throw new Error('Sesi login tidak valid. Silakan masuk lagi.');
    }
    return response;
}

async function fetchPublicConfig() {
    if (publicConfig) return publicConfig;
    const response = await fetch(`${API}/api/public-config`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Gagal memuat konfigurasi publik');
    publicConfig = data;
    return publicConfig;
}

function clearAuthState() {
    authToken = null;
    authUser = null;
    currentProfile = null;
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.user);
}

function logout(showToastMessage = true) {
    clearAuthState();
    closeProfileDrawer();
    syncAuthUI();
    refreshAll();
    if (showToastMessage) showToast('Kamu sudah logout.', 'success');
}

function updateThemeToggle(theme) {
    const button = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-toggle-icon');
    if (!button || !icon) return;

    const isLight = theme === 'light';
    icon.textContent = isLight ? '☀️' : '🌙';
    const nextThemeLabel = isLight ? 'mode gelap' : 'mode terang';
    button.setAttribute('aria-label', `Ganti ke ${nextThemeLabel}`);
    button.setAttribute('title', `Ganti ke ${nextThemeLabel}`);
}

function applyTheme(theme) {
    document.body.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEYS.theme, theme);
    updateThemeToggle(theme);
}

function applyFocusMode(enabled) {
    document.body.classList.toggle('focus-mode', Boolean(enabled));
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

function updateGoogleCalendarSyncStatus(message) {
    const status = document.getElementById('gcal-sync-status');
    if (!status) return;
    status.textContent = message;
}

async function ensureGoogleCalendarTokenClient() {
    const config = await fetchPublicConfig();
    const clientId = config.google_client_id;
    if (!clientId) {
        throw new Error('Google Calendar belum dikonfigurasi di server.');
    }
    if (!window.google?.accounts?.oauth2) {
        throw new Error('Google Identity belum siap. Coba lagi beberapa detik.');
    }
    if (!googleCalendarTokenClient) {
        googleCalendarTokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: GOOGLE_CALENDAR_SCOPE,
            callback: () => {},
        });
    }
    return googleCalendarTokenClient;
}

async function requestGoogleCalendarAccessToken(promptValue) {
    const tokenClient = await ensureGoogleCalendarTokenClient();
    return new Promise((resolve, reject) => {
        tokenClient.callback = (response) => {
            if (!response || response.error) {
                reject(new Error('Izin Google Calendar dibatalkan atau gagal.'));
                return;
            }
            googleCalendarAccessToken = response.access_token;
            googleCalendarTokenExpiresAt = Date.now() + ((response.expires_in || 0) * 1000);
            resolve(response.access_token);
        };
        try {
            tokenClient.requestAccessToken({ prompt: promptValue });
        } catch (err) {
            reject(err);
        }
    });
}

async function getGoogleCalendarAccessToken() {
    const hasValidToken = googleCalendarAccessToken && Date.now() < googleCalendarTokenExpiresAt - 5000;
    if (hasValidToken) return googleCalendarAccessToken;
    return requestGoogleCalendarAccessToken(googleCalendarAccessToken ? '' : 'consent');
}

function setupNavigation() {
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');

    document.querySelectorAll('.nav-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            document.querySelectorAll('.nav-btn').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            await navigateTo(button.dataset.page);
        });
    });

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
    if (window.innerWidth <= 960) document.getElementById('sidebar').classList.remove('open');
    if (page === 'journal') await loadJournalHistory();
    if (page === 'dashboard') await loadDashboard();
}

function setupTopbar() {
    document.getElementById('theme-toggle').addEventListener('click', () => {
        applyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light');
    });

    document.getElementById('auth-action-btn').addEventListener('click', () => {
        openAuthOverlay();
    });

    document.getElementById('profile-avatar-btn').addEventListener('click', () => {
        if (!isAuthed()) {
            openAuthOverlay();
            return;
        }
        openProfileDrawer();
    });
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

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = document.getElementById('login-btn');
        const error = document.getElementById('login-error');
        error.classList.add('hidden');
        setLoading(button, true);

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
            closeAuthOverlay();
            await refreshAll();
            syncAuthUI();
            showToast('Berhasil masuk.', 'success');
        } catch (err) {
            error.textContent = err.message;
            error.classList.remove('hidden');
        } finally {
            setLoading(button, false);
        }
    });

    registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = document.getElementById('reg-btn');
        const error = document.getElementById('reg-error');
        error.classList.add('hidden');
        setLoading(button, true);

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
            closeAuthOverlay();
            await refreshAll();
            syncAuthUI();
            showToast('Akun berhasil dibuat.', 'success');
        } catch (err) {
            error.textContent = err.message;
            error.classList.remove('hidden');
        } finally {
            setLoading(button, false);
        }
    });
}

function setupProfileDrawer() {
    const overlay = document.getElementById('profile-drawer-overlay');
    const closeBtn = document.getElementById('profile-drawer-close');
    const saveBtn = document.getElementById('profile-save-btn');
    const logoutBtn = document.getElementById('profile-logout-btn');

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeProfileDrawer();
    });
    closeBtn.addEventListener('click', closeProfileDrawer);
    saveBtn.addEventListener('click', saveProfile);
    logoutBtn.addEventListener('click', () => logout(true));
}

function openAuthOverlay() {
    document.getElementById('auth-overlay').classList.remove('hidden');
}

function closeAuthOverlay() {
    document.getElementById('auth-overlay').classList.add('hidden');
}

function openProfileDrawer() {
    renderProfileDrawer();
    document.getElementById('profile-drawer-overlay').classList.remove('hidden');
}

function closeProfileDrawer() {
    document.getElementById('profile-drawer-overlay').classList.add('hidden');
}

function syncAuthUI() {
    const overlay = document.getElementById('auth-overlay');
    const modeBadge = document.getElementById('mode-badge');
    const authActionBtn = document.getElementById('auth-action-btn');
    const avatarBtn = document.getElementById('profile-avatar-btn');
    const authState = document.getElementById('auth-state');
    const processingMode = document.getElementById('processing-mode');

    if (isAuthed()) {
        overlay.classList.add('hidden');
        modeBadge.textContent = 'LIVE MODE';
        authActionBtn.classList.add('hidden');
        avatarBtn.classList.remove('hidden');
        authState.textContent = getDisplayName();
        processingMode.textContent = 'connected';
    } else {
        overlay.classList.remove('hidden');
        modeBadge.textContent = 'LOGIN REQUIRED';
        authActionBtn.classList.remove('hidden');
        avatarBtn.classList.add('hidden');
        authState.textContent = 'login required';
        processingMode.textContent = 'locked';
    }

    updateAvatarUI();
}

function updateAvatarUI() {
    const initial = getInitial();
    const avatar = document.getElementById('profile-avatar-initial');
    const drawerAvatar = document.getElementById('profile-avatar-large');
    const heading = document.getElementById('profile-name-heading');
    const emailText = document.getElementById('profile-email-text');

    avatar.textContent = initial;
    drawerAvatar.textContent = initial;
    heading.textContent = getDisplayName();
    emailText.textContent = currentProfile?.email || '';
}

function renderProfileDrawer() {
    if (!currentProfile) return;
    updateAvatarUI();
    document.getElementById('profile-display-name').value = currentProfile.display_name || '';
    document.getElementById('profile-email').value = currentProfile.email || '';
    document.getElementById('profile-wake-time').value = currentProfile.default_wake_time || '07:00';
    document.getElementById('profile-sleep-hours').value = currentProfile.default_sleep_hours ?? 7.5;
    document.getElementById('profile-timezone').value = currentProfile.timezone || 'Asia/Jakarta';
    document.getElementById('profile-focus-mode').checked = Boolean(currentProfile.focus_mode_enabled);
}

function applyProfileDefaults() {
    if (!currentProfile) return;
    document.getElementById('ci-wake').value = currentProfile.default_wake_time || '07:00';
    document.getElementById('ci-sleep').value = currentProfile.default_sleep_hours ?? 7.5;
    document.getElementById('ci-sleep-val').textContent = currentProfile.default_sleep_hours ?? 7.5;
    applyFocusMode(currentProfile.focus_mode_enabled);
}

async function loadProfile() {
    if (!isAuthed()) {
        currentProfile = null;
        applyFocusMode(false);
        return;
    }
    const response = await apiFetch('/api/profile');
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Gagal memuat profil');
    currentProfile = data.profile || data;
    authUser = currentProfile.username || authUser;
    localStorage.setItem(STORAGE_KEYS.user, authUser || '');
    applyProfileDefaults();
    renderProfileDrawer();
    updateAvatarUI();
}

async function saveProfile() {
    if (!isAuthed()) {
        openAuthOverlay();
        return;
    }

    const button = document.getElementById('profile-save-btn');
    setLoading(button, true);
    try {
        const sleepHoursInput = document.getElementById('profile-sleep-hours').value;
        const payload = {
            display_name: document.getElementById('profile-display-name').value.trim(),
            default_wake_time: document.getElementById('profile-wake-time').value || '07:00',
            default_sleep_hours: sleepHoursInput ? Number(sleepHoursInput) : 7.5,
            timezone: document.getElementById('profile-timezone').value.trim() || 'Asia/Jakarta',
            focus_mode_enabled: document.getElementById('profile-focus-mode').checked,
        };
        const response = await apiFetch('/api/profile', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Gagal menyimpan profil');
        currentProfile = data.profile;
        applyProfileDefaults();
        renderProfileDrawer();
        syncAuthUI();
        showToast('Profil berhasil diperbarui!', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal menyimpan profil.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

async function refreshAll() {
    if (isAuthed()) {
        try {
            await loadProfile();
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Gagal memuat profil.', 'danger');
        }
    } else {
        currentProfile = null;
        applyFocusMode(false);
    }
    await loadSchedule();
    await loadJournalHistory();
    await loadDashboard();
    syncAuthUI();
}

function normalizeEvents(events) {
    return [...events]
        .map((event) => ({
            id: event.id,
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

function labelDate(dateValue) {
    const today = todayString();
    if (!dateValue || dateValue === today) return 'hari ini';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateValue === tomorrow.toISOString().split('T')[0]) return 'besok';
    return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(dateValue));
}

function getRealtimeGreeting(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 5 && hour < 11) return 'Selamat pagi!';
    if (hour >= 11 && hour < 15) return 'Selamat siang!';
    if (hour >= 15 && hour < 18) return 'Selamat sore!';
    return 'Selamat malam!';
}

function updateCheckinGreeting() {
    const greeting = document.getElementById('dynamic-greeting');
    if (!greeting) return;
    greeting.textContent = getRealtimeGreeting();
}

function scheduleCheckinGreeting() {
    updateCheckinGreeting();
    window.setInterval(updateCheckinGreeting, 60000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateCheckinGreeting();
    });
}

function annotateBeforeEvents(events) {
    const nowMinutes = getMinutes(currentTimeString());
    return events.map((event, index) => {
        const previous = index > 0 ? events[index - 1] : null;
        const next = index < events.length - 1 ? events[index + 1] : null;
        let status = event.is_immovable ? 'fixed' : 'preserved';
        if ((previous && previous.date === event.date && getMinutes(previous.end) > getMinutes(event.start)) || (next && next.date === event.date && getMinutes(event.end) > getMinutes(next.start))) {
            status = 'conflict';
        } else if (getMinutes(event.end) <= nowMinutes) {
            status = 'missed';
        } else if (!event.is_immovable && event.priority === 'low') {
            status = 'optional';
        } else if (getMinutes(event.start) <= nowMinutes + 60) {
            status = 'risky';
        }
        return { ...event, status };
    });
}

async function loadSchedule() {
    latestRescuePlan = null;
    if (!isAuthed()) {
        currentEvents = [];
        renderBeforeTimeline();
        renderAfterTimeline([]);
        renderDecisionLog([]);
        renderActionSummary(null);
        updateMetricsFromCurrentState();
        return;
    }

    try {
        const response = await apiFetch('/api/events');
        const data = await response.json();
        currentEvents = normalizeEvents(data.today_events || []);
    } catch (err) {
        console.error(err);
        currentEvents = [];
        showToast('Gagal memuat event.', 'danger');
    }

    renderBeforeTimeline();
    renderAfterTimeline([]);
    renderDecisionLog([]);
    renderActionSummary(null);
    updateMetricsFromCurrentState();
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
        const actionHtml = options.removable
            ? `<button class="remove-btn" data-remove-id="${event.id}" aria-label="Hapus event">×</button>`
            : `<span class="timeline-badge ${status}">${badgeText}</span>`;
        return `
            <div class="timeline-item ${status}">
                <div class="timeline-time">${event.start} - ${event.end}</div>
                <div>
                    <div class="timeline-title">${event.title}</div>
                    <div class="timeline-subtitle">${subtitle}</div>
                </div>
                ${actionHtml}
            </div>
        `;
    }).join('');

    if (options.removable) {
        container.querySelectorAll('[data-remove-id]').forEach((button) => {
            button.addEventListener('click', () => removeEvent(button.dataset.removeId));
        });
    }
}

function renderBeforeTimeline() {
    const items = annotateBeforeEvents(currentEvents);
    renderTimeline('timeline-before', items, {
        removable: true,
        emptyText: '<span class="empty-icon">📋</span>Belum ada event hari ini. Tambah event nyata atau sinkronkan kalendermu dulu.',
    });
}

function renderAfterTimeline(events) {
    renderTimeline('timeline-after', normalizeEvents(events), {
        removable: false,
        emptyText: '<span class="empty-icon">✨</span>Recovery plan akan muncul di sini setelah kamu menjalankan <strong>Debug My Day</strong>.',
    });
}

function updateMetricsFromCurrentState() {
    const annotated = annotateBeforeEvents(currentEvents);
    const conflicts = annotated.filter((event) => event.status === 'conflict').length;
    const missed = annotated.filter((event) => event.status === 'missed').length;
    const lowEnergy = parseInt(document.getElementById('rescue-energy').value, 10) <= 4 ? 12 : 0;
    const damage = annotated.length ? Math.min(100, 12 + conflicts * 16 + missed * 12 + lowEnergy) : 0;
    document.getElementById('metric-damage').textContent = `${damage}%`;
    document.getElementById('metric-before').textContent = annotated.length ? `${Math.max(100 - damage, 8)}%` : '--';
    document.getElementById('metric-after').textContent = '--';
    document.getElementById('metric-recovered').textContent = annotated.filter((event) => event.is_immovable).length;
}

function setupRescue() {
    const energyInput = document.getElementById('rescue-energy');
    energyInput.addEventListener('input', () => {
        document.getElementById('rescue-energy-value').textContent = energyInput.value;
        if (!latestRescuePlan) updateMetricsFromCurrentState();
    });

    document.getElementById('rescue-submit').addEventListener('click', handleRescueSubmit);
    document.getElementById('sync-gcal-btn').addEventListener('click', handleGoogleCalendarSync);
    document.getElementById('approve-btn').addEventListener('click', handleApplyPatch);
    document.getElementById('reject-btn').addEventListener('click', () => {
        latestRescuePlan = null;
        renderAfterTimeline([]);
        renderDecisionLog([]);
        renderActionSummary(null);
        updateMetricsFromCurrentState();
    });
}

async function handleGoogleCalendarSync() {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk sinkronisasi Google Calendar.', 'warning');
        return;
    }

    const button = document.getElementById('sync-gcal-btn');
    setLoading(button, true);
    updateGoogleCalendarSyncStatus('Meminta izin Google Calendar dan menarik event hari ini...');

    try {
        const accessToken = await getGoogleCalendarAccessToken();
        const response = await apiFetch('/api/sync-gcal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_token: accessToken }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Gagal sinkron Google Calendar.');

        await loadSchedule();

        const syncedCount = data.synced_count || 0;
        const skippedAllDayCount = data.skipped_all_day_count || 0;
        let statusMessage = syncedCount
            ? `${syncedCount} event Google Calendar untuk ${data.target_date} berhasil dimasukkan.`
            : `Tidak ada event Google Calendar baru untuk ${data.target_date}.`;
        if (skippedAllDayCount) {
            statusMessage += ` ${skippedAllDayCount} event all-day belum diimpor karena tidak punya jam spesifik.`;
        }

        updateGoogleCalendarSyncStatus(statusMessage);
        showToast(statusMessage, syncedCount ? 'success' : 'warning');
    } catch (err) {
        console.error(err);
        updateGoogleCalendarSyncStatus('Sinkronisasi Google Calendar gagal. Coba lagi.');
        showToast(err.message || 'Gagal sinkron Google Calendar.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

async function handleRescueSubmit() {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menjalankan rescue plan.', 'warning');
        return;
    }

    const message = document.getElementById('rescue-message').value.trim();
    if (!message) {
        showToast('Ceritakan situasimu dulu.', 'warning');
        return;
    }

    const button = document.getElementById('rescue-submit');
    setLoading(button, true);
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
                energy_level: parseInt(document.getElementById('rescue-energy').value, 10),
                mood: document.getElementById('rescue-mood').value,
                current_time: currentTimeString(),
                mode: 'live',
                today_events: currentEvents,
            }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Gagal membuat recovery plan');
        latestRescuePlan = result;
        renderAfterTimeline(result.new_schedule || []);
        renderDecisionLog(result.decision_log || []);
        renderActionSummary(result);
        document.getElementById('metric-damage').textContent = `${result.damage_assessment?.score ?? '--'}%`;
        document.getElementById('metric-before').textContent = `${result.recovery_score_before ?? '--'}%`;
        document.getElementById('metric-after').textContent = `${result.recovery_score_after ?? '--'}%`;
        document.getElementById('metric-recovered').textContent = result.stats?.fixed_events_preserved ?? 0;
        renderTrace([
            'Detecting conflicts... done',
            'Analyzing energy budget... done',
            'Protecting fixed events... done',
            'Schedule patched successfully.',
        ], 'live');
        showToast('Recovery plan siap direview.', 'success');
    } catch (err) {
        console.error(err);
        renderTrace(['Rescue failed. Periksa koneksi dan data event-mu.'], 'error');
        showToast(err.message || 'Gagal membuat recovery plan.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderTrace(lines, status) {
    document.getElementById('processing-mode').textContent = status;
    document.getElementById('debug-trace').innerHTML = lines.map((line) => `<li>${line}</li>`).join('');
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
    document.getElementById('session-mode').textContent = 'live';
    document.getElementById('summary-text').textContent = plan.summary || '-';
    document.getElementById('energy-text').textContent = plan.energy_assessment?.message || '-';
    document.getElementById('schedule-actions-list').innerHTML = (plan.schedule_actions || []).length
        ? plan.schedule_actions.map((item) => `<li><strong>${item.event_title}</strong> · ${item.action}${item.to ? ` → ${item.to}` : ''}<br>${item.reason}</li>`).join('')
        : '<li>Tidak ada action tambahan.</li>';
    document.getElementById('risk-flags').innerHTML = (plan.risk_flags || []).length
        ? plan.risk_flags.map((item) => `<li>${item}</li>`).join('')
        : '<li>Tidak ada red flag utama. Draft siap direview.</li>';
}

async function handleApplyPatch() {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menerapkan patch.', 'warning');
        return;
    }
    if (!latestRescuePlan) {
        showToast('Belum ada patch untuk diterapkan.', 'warning');
        return;
    }

    try {
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
            showToast('Patch gagal validasi. Periksa risk flags dulu.', 'danger');
            return;
        }

        const response = await apiFetch('/api/apply-schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: latestRescuePlan.session_id, new_schedule: latestRescuePlan.new_schedule || [] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Gagal apply patch.');

        latestRescuePlan = null;
        document.getElementById('undo-btn').classList.remove('hidden');
        await loadSchedule();
        await loadDashboard();
        showToast('Patch berhasil diterapkan.', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal menerapkan patch.', 'danger');
    }
}

async function removeEvent(eventId) {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menghapus event.', 'warning');
        return;
    }
    try {
        const response = await apiFetch(`/api/events/${eventId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Gagal menghapus event');
        await loadSchedule();
        showToast('Event dihapus.', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal menghapus event.', 'danger');
    }
}

function setupCheckin() {
    const sleep = document.getElementById('ci-sleep');
    const energy = document.getElementById('ci-energy');
    sleep.addEventListener('input', () => { document.getElementById('ci-sleep-val').textContent = sleep.value; });
    energy.addEventListener('input', () => { document.getElementById('ci-energy-val').textContent = energy.value; });
    document.getElementById('checkin-submit').addEventListener('click', handleCheckin);
}

async function handleCheckin() {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menjalankan morning check-in.', 'warning');
        return;
    }

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
        await loadDashboard();
        showToast('Morning check-in selesai.', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal check-in.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderCheckinResult(result) {
    const container = document.getElementById('checkin-result');
    const timelineItems = (result.new_schedule || []).slice(0, 4).map((event) => `<li><strong>${event.title}</strong> · ${event.start}-${event.end}</li>`).join('');
    container.innerHTML = `
        <div class="panel-header">
            <div>
                <p class="panel-kicker">Morning Output</p>
                <h3>Plan yang lebih realistis</h3>
            </div>
            <span class="panel-tag">${result.damage_assessment?.level || 'stable'}</span>
        </div>
        <div class="system-box"><p>${result.summary || '-'}</p></div>
        <div class="system-box"><h4>Focus Window</h4><p>${result.energy_assessment?.message || '-'}</p></div>
        <div class="system-box"><h4>Suggested Sequence</h4><ul class="decision-list">${timelineItems || '<li>Tidak ada rekomendasi khusus.</li>'}</ul></div>
    `;
}

function setupJournal() {
    document.getElementById('journal-submit').addEventListener('click', handleJournalSubmit);
}

async function handleJournalSubmit() {
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menyimpan journal.', 'warning');
        return;
    }

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
        renderJournalInsight(result.analysis || result.entry?.analysis);
        document.getElementById('journal-text').value = '';
        await loadJournalHistory();
        await loadDashboard();
        showToast('Jurnal tersimpan.', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal menyimpan jurnal.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

function renderJournalInsight(analysis) {
    const normalized = normalizeJournalAnalysis(analysis);
    const section = document.getElementById('journal-insight');
    const content = document.getElementById('insight-content');
    section.classList.remove('hidden');
    content.innerHTML = `
        <div class="insight-item"><strong>Mood:</strong> ${normalized.mood}</div>
        <div class="insight-item"><strong>Produktivitas:</strong> ${normalized.productivity} / 10</div>
        <div class="insight-item"><strong>Blockers:</strong> ${normalized.blockers.join(', ') || 'Tidak ada blocker utama'}</div>
        <div class="insight-item"><strong>Insight:</strong> ${normalized.insight}</div>
    `;
}

async function loadJournalHistory() {
    const container = document.getElementById('journal-history');
    if (!isAuthed()) {
        container.innerHTML = `<div class="empty-state-block"><h3>Login diperlukan</h3><p>Journal dan insight personal tersedia setelah kamu masuk.</p></div>`;
        return;
    }

    try {
        const response = await apiFetch('/api/journal');
        const data = await response.json();
        const entries = data.entries || [];
        if (!entries.length) {
            container.innerHTML = `<div class="empty-state-block"><h3>Belum ada jurnal</h3><p>Entry yang kamu simpan akan muncul di sini.</p></div>`;
            return;
        }
        container.innerHTML = entries.map((entry) => `
            <div class="journal-card">
                <div class="journal-card-date">${entry.date || todayString()}</div>
                <div>${entry.text}</div>
                <div class="journal-card-meta">Mood: ${entry.mood || '-'}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="empty-state-block"><h3>Gagal memuat journal</h3><p>${err.message}</p></div>`;
    }
}

function setupAddEvent() {
    const modal = document.getElementById('add-event-modal');
    document.getElementById('btn-add-event').addEventListener('click', () => {
        if (!isAuthed()) {
            openAuthOverlay();
            showToast('Masuk dulu untuk menambah event.', 'warning');
            return;
        }
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
    if (!isAuthed()) {
        openAuthOverlay();
        showToast('Masuk dulu untuk menambah event.', 'warning');
        return;
    }

    const title = document.getElementById('event-title').value.trim();
    const start = document.getElementById('event-start').value;
    const end = document.getElementById('event-end').value;
    if (!title || !start || !end) {
        showToast('Lengkapi semua field event.', 'warning');
        return;
    }

    const button = document.getElementById('add-event-submit');
    setLoading(button, true);
    try {
        const response = await apiFetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: `evt-${Date.now()}`,
                title,
                start,
                end,
                priority: document.getElementById('event-priority').value,
                is_immovable: document.getElementById('event-immovable').checked,
                date: todayString(),
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Gagal menyimpan event');
        document.getElementById('add-event-modal').classList.add('hidden');
        await loadSchedule();
        showToast('Event berhasil ditambahkan.', 'success');
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Gagal menambah event.', 'danger');
    } finally {
        setLoading(button, false);
    }
}

async function loadDashboard() {
    const stats = {
        total_rescues: 0,
        total_checkins: 0,
        avg_energy: 0,
        fixed_event_preservation_rate: 0,
        checkin_history: [],
        journal_entries: [],
    };

    if (isAuthed()) {
        try {
            const response = await apiFetch('/api/dashboard');
            const data = await response.json();
            Object.assign(stats, data);
        } catch (err) {
            console.error(err);
        }
    }

    document.getElementById('stat-rescues').textContent = stats.total_rescues || 0;
    document.getElementById('stat-checkins').textContent = stats.total_checkins || 0;
    document.getElementById('stat-energy').textContent = stats.avg_energy || 0;
    document.getElementById('stat-preservation').textContent = `${stats.fixed_event_preservation_rate || 0}%`;
    renderEnergyChart(stats.checkin_history || []);
    renderMoodChart(stats.checkin_history || [], stats.journal_entries || []);
}

function renderEnergyChart(history) {
    const ctx = document.getElementById('energy-chart');
    if (energyChart) energyChart.destroy();
    const labels = history.length ? history.map((item, index) => `${item.type || 'session'}-${index + 1}`) : ['no-data'];
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
        const mood = item.mood || 'unknown';
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

function setupUndo() {
    const undoBtn = document.getElementById('undo-btn');
    if (!undoBtn) return;
    undoBtn.addEventListener('click', async () => {
        if (!isAuthed()) {
            openAuthOverlay();
            showToast('Masuk dulu untuk menggunakan undo.', 'warning');
            return;
        }
        try {
            const response = await apiFetch('/api/undo-schedule', { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Undo gagal.');
            undoBtn.classList.add('hidden');
            await loadSchedule();
            showToast(`Undo berhasil — ${data.restored_count} event dikembalikan.`, 'success');
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Gagal undo.', 'danger');
        }
    });
}

function setupPanicFab() {
    const fab = document.getElementById('panic-fab');
    if (!fab) return;
    fab.addEventListener('click', async () => {
        document.querySelectorAll('.nav-btn').forEach((item) => item.classList.remove('active'));
        const homeBtn = document.querySelector('[data-page="home"]');
        if (homeBtn) homeBtn.classList.add('active');
        await navigateTo('home');
        const rescueInput = document.getElementById('rescue-message');
        rescueInput.focus();
        rescueInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
