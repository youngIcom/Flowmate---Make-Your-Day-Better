/**
 * FlowMate — Frontend Application Logic
 */

const API = '';

// ============================================================
// STATE & AUTH
// ============================================================
let authToken = localStorage.getItem('flowmate_token');
let authUser = localStorage.getItem('flowmate_user');
let currentPage = 'home';
let demoCalendar = [];
let selectedEnergy = 6;
let selectedMood = 'neutral';
let energyChart = null;
let moodChart = null;
let fullCalendarInstance = null;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupAuthUI();
    setupUserMenu();
    setupNavigation();
    setupGreeting();
    setupPanicButton();
    setupCheckin();
    setupJournal();
    setupSliders();
    setupAddEvent();
    setupTheme();
    setupTodo();
    loadDemoCalendar();
});

// ============================================================
// AUTHENTICATION LOGIC
// ============================================================
async function apiFetch(endpoint, options = {}) {
    if (!options.headers) options.headers = {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(`${API}${endpoint}`, options);
    if (res.status === 401) {
        logout();
        throw new Error('Unauthorized');
    }
    return res;
}

function checkAuth() {
    const overlay = document.getElementById('auth-overlay');
    if (!authToken) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
        document.getElementById('greeting').innerHTML = `Selamat Pagi, ${authUser} 👋`;
        document.getElementById('user-avatar-initial').textContent = authUser.charAt(0).toUpperCase();
        document.getElementById('profile-avatar-initial').textContent = authUser.charAt(0).toUpperCase();
        document.getElementById('dropdown-username').textContent = authUser;
        // Fetch email
        apiFetch('/api/auth/me')
            .then(res => res.json())
            .then(data => {
                document.getElementById('dropdown-email').textContent = data.email;
            })
            .catch(e => console.error(e));
    }
}

function logout() {
    authToken = null;
    authUser = null;
    localStorage.removeItem('flowmate_token');
    localStorage.removeItem('flowmate_user');
    checkAuth();
}

function setupAuthUI() {
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    const formLogin = document.getElementById('login-form');
    const formReg = document.getElementById('register-form');

    tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('active'); tabReg.classList.remove('active');
        formLogin.classList.remove('hidden'); formReg.classList.add('hidden');
    });
    tabReg.addEventListener('click', () => {
        tabReg.classList.add('active'); tabLogin.classList.remove('active');
        formReg.classList.remove('hidden'); formLogin.classList.add('hidden');
    });

    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('login-username').value;
        const p = document.getElementById('login-password').value;
        const err = document.getElementById('login-error');
        const btn = document.getElementById('login-btn');
        err.classList.add('hidden'); setLoading(btn, true);
        
        try {
            const formData = new URLSearchParams();
            formData.append('username', u);
            formData.append('password', p);
            
            const res = await fetch(`${API}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Login gagal');
            
            authToken = data.access_token;
            authUser = data.username;
            localStorage.setItem('flowmate_token', authToken);
            localStorage.setItem('flowmate_user', authUser);
            checkAuth();
        loadDemoCalendar(); // Reload data
            showToast('Berhasil masuk!', 'success');
        } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
        } finally { setLoading(btn, false); }
    });

    formReg.addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('reg-username').value;
        const em = document.getElementById('reg-email').value;
        const p = document.getElementById('reg-password').value;
        const err = document.getElementById('reg-error');
        const btn = document.getElementById('reg-btn');
        err.classList.add('hidden'); setLoading(btn, true);

        try {
            const res = await fetch(`${API}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, email: em, password: p })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Pendaftaran gagal');
            
            authToken = data.access_token;
            authUser = data.username;
            localStorage.setItem('flowmate_token', authToken);
            localStorage.setItem('flowmate_user', authUser);
            checkAuth();
        loadDemoCalendar(); // Reload data
            showToast('Akun berhasil dibuat!', 'success');
        } catch (error) {
            err.textContent = error.message;
            err.classList.remove('hidden');
        } finally { setLoading(btn, false); }
    });
}

async function handleGoogleLogin(response) {
    try {
        const res = await fetch(`${API}/api/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Google Login gagal');
        
        authToken = data.access_token;
        authUser = data.username;
        localStorage.setItem('flowmate_token', authToken);
        localStorage.setItem('flowmate_user', authUser);
        checkAuth();
        loadDemoCalendar(); // Reload data
        showToast('Berhasil masuk dengan Google!', 'success');
    } catch (error) {
        showToast(error.message, 'danger');
    }
}

// ============================================================
// USER MENU & MODALS
// ============================================================
function setupUserMenu() {
    const btn = document.getElementById('user-menu-btn');
    const dropdown = document.getElementById('user-dropdown');
    
    // Toggle Dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        if (!dropdown.classList.contains('hidden')) {
            dropdown.classList.add('hidden');
        }
    });
    
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        dropdown.classList.add('hidden');
        logout();
        showToast('Kamu telah keluar.', 'info');
    });

    // Modals
    const profileModal = document.getElementById('profile-modal');
    const settingsModal = document.getElementById('settings-modal');

    document.getElementById('btn-profile').addEventListener('click', async () => {
        dropdown.classList.add('hidden');
        profileModal.classList.remove('hidden');
        // Fetch real user data
        try {
            const res = await apiFetch('/api/auth/me');
            const data = await res.json();
            document.getElementById('profile-username').value = data.username;
            document.getElementById('profile-name-display').textContent = data.username;
            document.getElementById('profile-email-display').textContent = data.email;
        } catch(e) { /* ignore */ }
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
        dropdown.classList.add('hidden');
        settingsModal.classList.remove('hidden');
    });

    document.getElementById('profile-close').addEventListener('click', () => profileModal.classList.add('hidden'));
    document.getElementById('settings-close').addEventListener('click', () => settingsModal.classList.add('hidden'));
    document.getElementById('settings-save').addEventListener('click', () => {
        showToast('Pengaturan disimpan.', 'success');
        settingsModal.classList.add('hidden');
    });

    // Google Calendar Sync
    let tokenClient;

    const triggerSync = () => {
        dropdown.classList.add('hidden');
        
        if (typeof google === 'undefined' || !google.accounts) {
            showToast("Google API sedang dimuat, coba lagi.", "danger");
            return;
        }

        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: '849432037168-mc7ntasd097umoko4dbt0t9f9qant7s1.apps.googleusercontent.com',
                scope: 'https://www.googleapis.com/auth/calendar.readonly',
                callback: async (tokenResponse) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        showToast('Mensinkronkan kalender...', 'info');
                        try {
                            const res = await apiFetch('/api/sync-gcal', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ access_token: tokenResponse.access_token })
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.detail || 'Gagal sinkron');
                            showToast(`Berhasil sinkron ${data.synced_count} acara!`, 'success');
                        loadDemoCalendar();
                        } catch (err) {
                            showToast(err.message, 'danger');
                        }
                    }
                },
            });
        }
        
        tokenClient.requestAccessToken();
    };

    document.getElementById('btn-sync-gcal-menu').addEventListener('click', triggerSync);
    document.getElementById('btn-sync-gcal-settings').addEventListener('click', triggerSync);
}

// ============================================================
// NAVIGATION
// ============================================================
function setupNavigation() {
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    
    // Toggle sidebar on mobile
    if (mobileBtn) {
        mobileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
        });
    }

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
            if (!sidebar.contains(e.target) && !mobileBtn.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            navigateTo(page);
            // Auto close sidebar on mobile after navigating
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });
}

function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
    if (page === 'dashboard') loadDashboard();
    if (page === 'journal') loadJournalHistory();
}

// ============================================================
// GREETING & DATE
// ============================================================
function setupGreeting() {
    const h = new Date().getHours();
    let greeting = 'Selamat Malam 🌙';
    if (h >= 5 && h < 12) greeting = 'Selamat Pagi ☀️';
    else if (h >= 12 && h < 17) greeting = 'Selamat Siang 🌤️';
    else if (h >= 17 && h < 21) greeting = 'Selamat Sore 🌅';
    document.getElementById('greeting').textContent = greeting;

    const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('date-display').textContent = new Date().toLocaleDateString('id-ID', opts);
}

// ============================================================
// TODO LIST
// ============================================================
function setupTodo() {
    let todos = JSON.parse(localStorage.getItem('flowmate-todos') || '[]');

    const addBtn = document.getElementById('todo-add-btn');
    const inputRow = document.getElementById('todo-input-row');
    const newInput = document.getElementById('todo-new-input');
    const saveBtn = document.getElementById('todo-save-btn');
    const container = document.getElementById('todo-items');

    if (!addBtn || !container) return;

    function renderTodos() {
        container.innerHTML = todos.map((t, i) => `
            <label class="todo-item" style="display:flex; align-items:center; gap:10px;">
                <input type="checkbox" data-index="${i}" ${t.done ? 'checked' : ''}>
                <span style="${t.done ? 'text-decoration:line-through;opacity:0.4;' : ''}">${t.text}</span>
            </label>`).join('');

        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const idx = parseInt(cb.dataset.index);
                // Animate out then remove
                const label = cb.closest('label');
                label.style.transition = 'opacity 0.4s, transform 0.4s';
                label.style.opacity = '0';
                label.style.transform = 'translateX(20px)';
                setTimeout(() => {
                    todos.splice(idx, 1);
                    localStorage.setItem('flowmate-todos', JSON.stringify(todos));
                    renderTodos();
                }, 400);
            });
        });
    }

    addBtn.addEventListener('click', () => {
        inputRow.classList.toggle('hidden');
        if (!inputRow.classList.contains('hidden')) newInput.focus();
    });

    function saveTodo() {
        const text = newInput.value.trim();
        if (!text) return;
        todos.unshift({ text, done: false });
        localStorage.setItem('flowmate-todos', JSON.stringify(todos));
        newInput.value = '';
        inputRow.classList.add('hidden');
        renderTodos();
    }

    saveBtn.addEventListener('click', saveTodo);
    newInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveTodo(); });

    renderTodos();
}

// ============================================================
// THEME
// ============================================================
function setupTheme() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;
    
    const lightIcon = toggleBtn.querySelector('.theme-icon-light');
    const darkIcon = toggleBtn.querySelector('.theme-icon-dark');
    
    // Check saved theme or default to dark
    const savedTheme = localStorage.getItem('flowmate-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);

    toggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('flowmate-theme', newTheme);
        updateThemeIcons(newTheme);
        
        if (currentPage === 'dashboard') loadDashboard();
    });

    function updateThemeIcons(theme) {
        if (theme === 'dark') {
            lightIcon.classList.remove('hidden');
            darkIcon.classList.add('hidden');
        } else {
            lightIcon.classList.add('hidden');
            darkIcon.classList.remove('hidden');
        }
    }
}

// ============================================================
// LOAD USER CALENDAR
// ============================================================
async function loadDemoCalendar() {
    try {
        const res = await apiFetch('/api/events');
        const data = await res.json();
        demoCalendar = data.today_events || [];
        const allEvents = data.all_events || data.today_events || [];
        setupFullCalendar(allEvents);
    } catch (e) {
        console.error('Failed to load calendar:', e);
        setupFullCalendar([]);
    }
}

function setupFullCalendar(events) {
    const calendarEl = document.getElementById('calendar-view');
    if (!calendarEl) return;

    const today = new Date().toISOString().split('T')[0];
    const fcEvents = events.map(e => {
        const colors = {
            high: { bg: '#ef4444', border: '#ef4444' },
            medium: { bg: '#7c3aed', border: '#7c3aed' },
            low: { bg: '#06b6d4', border: '#06b6d4' },
        };
        const c = colors[e.priority] || colors.medium;
        const eventDate = e.date || today;
        return {
            id: e.id,
            title: e.title,
            start: `${eventDate}T${e.start}:00`,
            end: `${eventDate}T${e.end}:00`,
            backgroundColor: e.is_immovable ? '#f59e0b' : c.bg,
            borderColor: e.is_immovable ? '#f59e0b' : c.border,
            textColor: '#ffffff'
        };
    });

    if (fullCalendarInstance) {
        fullCalendarInstance.destroy();
    }

    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth'
        },
        height: '100%',
        slotMinTime: '06:00:00',
        slotMaxTime: '23:00:00',
        allDaySlot: false,
        events: fcEvents,
        nowIndicator: true,
        expandRows: true,
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        buttonText: { today: 'Today', day: 'Day', week: 'Week', month: 'Month' },
        eventClick: function(info) {
            showEventPopup(info.event, info.el);
        },
    });
    fullCalendarInstance.render();
}

// ============================================================
// EVENT POPUP
// ============================================================
let currentPopupEventId = null;

function showEventPopup(event, anchorEl) {
    const popup = document.getElementById('event-popup');
    const card = popup.querySelector('.event-popup-card');

    // Populate content
    document.getElementById('popup-title').textContent = event.title;
    document.getElementById('popup-time').textContent =
        formatTime(event.start) + ' – ' + formatTime(event.end);

    const priorityMap = { '#ef4444': '🔴 Prioritas Tinggi', '#7c3aed': '🟣 Prioritas Sedang', '#06b6d4': '🔵 Prioritas Rendah', '#f59e0b': '🟡 Wajib (Immovable)' };
    const color = event.backgroundColor || '#7c3aed';
    document.getElementById('popup-priority').textContent = priorityMap[color] || 'Medium';
    document.getElementById('popup-dot').style.background = color;

    currentPopupEventId = event.id;

    // Position popup near the clicked event
    popup.classList.remove('hidden');
    const rect = anchorEl.getBoundingClientRect();
    const cardW = 320, cardH = 220;
    let top = rect.bottom + 8;
    let left = rect.left;
    if (left + cardW > window.innerWidth - 16) left = window.innerWidth - cardW - 16;
    if (top + cardH > window.innerHeight - 16) top = rect.top - cardH - 8;
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
}

function closeEventPopup() {
    document.getElementById('event-popup').classList.add('hidden');
    currentPopupEventId = null;
}

function formatTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Wire popup controls
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('popup-close')?.addEventListener('click', closeEventPopup);

    document.getElementById('popup-delete-btn')?.addEventListener('click', async () => {
        if (!currentPopupEventId) return;
        try {
            await apiFetch(`/api/events/${currentPopupEventId}`, { method: 'DELETE' });
        } catch(e) { /* ignore — event may be in-memory */ }
        // Remove from FullCalendar
        if (fullCalendarInstance) {
            const evt = fullCalendarInstance.getEventById(currentPopupEventId);
            if (evt) evt.remove();
        }
        demoCalendar = demoCalendar.filter(e => e.id !== currentPopupEventId);
        closeEventPopup();
        showToast('🗑️ Kegiatan dihapus', 'success');
    });

    document.getElementById('popup-edit-btn')?.addEventListener('click', () => {
        showToast('✏️ Fitur edit segera hadir!', 'info');
        closeEventPopup();
    });

    // Close on outside click
    document.getElementById('event-popup')?.addEventListener('click', (e) => {
        if (!e.target.closest('.event-popup-card')) closeEventPopup();
    });
});

// ============================================================
// RENDER TIMELINE
// ============================================================
function renderTimeline(containerId, events, showStatus = false) {
    const container = document.getElementById(containerId);
    if (!events || events.length === 0) {
        container.innerHTML = '<p class="empty-state">Tidak ada kegiatan.</p>';
        return;
    }

    container.innerHTML = events.map((evt, i) => {
        let cls = '';
        if (evt.is_immovable) cls = 'immovable';
        if (showStatus && evt.status) cls = `status-${evt.status}`;

        const badgeHtml = showStatus && evt.status
            ? `<span class="tl-badge ${evt.status}">${evt.status}</span>`
            : (evt.is_immovable ? '<span class="tl-badge kept">wajib</span>' : '');

        return `
            <div class="timeline-item ${cls}" style="animation-delay: ${i * 0.08}s">
                <span class="tl-time">${evt.start} – ${evt.end}</span>
                <span class="tl-title">${evt.title}</span>
                ${badgeHtml}
            </div>`;
    }).join('');
}

// ============================================================
// PANIC BUTTON
// ============================================================
function setupPanicButton() {
    const btn = document.getElementById('panic-btn');
    const modal = document.getElementById('panic-modal');
    const closeBtn = document.getElementById('panic-modal-close');
    const submitBtn = document.getElementById('panic-submit');

    btn.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    submitBtn.addEventListener('click', handlePanicSubmit);

    // Reasoning toggle
    document.getElementById('reasoning-toggle').addEventListener('click', () => {
        const body = document.getElementById('reasoning-body');
        const chevron = document.querySelector('.chevron');
        body.classList.toggle('open');
        chevron.classList.toggle('open');
    });

    // Approve / Reject
    document.getElementById('approve-btn').addEventListener('click', async () => {
        showToast('✅ Jadwal baru berhasil diterapkan!', 'success');
        document.getElementById('rescue-result').classList.add('hidden');
        await loadDemoCalendar(); // refresh calendar from backend DB
    });
    document.getElementById('reject-btn').addEventListener('click', () => {
        document.getElementById('rescue-result').classList.add('hidden');
    });
}

async function handlePanicSubmit() {
    const message = document.getElementById('panic-message').value.trim();
    const energy = parseInt(document.getElementById('panic-energy').value);
    const mood = document.getElementById('panic-mood').value;

    if (!message) { showToast('⚠️ Ceritakan kondisimu dulu!', 'warning'); return; }

    const btn = document.getElementById('panic-submit');
    setLoading(btn, true);

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const payload = {
        current_time: currentTime,
        user_condition: { sleep_hours: 4, energy_level: energy, mood: mood, message: message },
        today_events: demoCalendar,
    };

    try {
        const res = await apiFetch('/api/reschedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await res.json();
        displayRescueResult(result);
    } catch (e) {
        showToast('❌ Gagal menghubungi server!', 'danger');
        console.error(e);
    } finally {
        setLoading(btn, false);
        document.getElementById('panic-modal').classList.add('hidden');
    }
}

function displayRescueResult(result) {
    const section = document.getElementById('rescue-result');
    section.classList.remove('hidden');

    // Empathy message
    document.getElementById('empathy-message').textContent = result.empathy_message || '';

    // Before timeline
    renderTimeline('timeline-before', demoCalendar, false);

    // After timeline
    renderTimeline('timeline-after', result.new_schedule, true);

    // Reasoning
    const list = document.getElementById('reasoning-list');
    list.innerHTML = (result.reasoning_transcript || []).map(r => `
        <li>
            <span class="r-icon">${r.icon}</span>
            <div><strong>${r.event_title}</strong> — ${r.reason}</div>
        </li>`).join('');

    // Daily tip
    document.getElementById('daily-tip').textContent = result.daily_tip || '';

    // Scroll into view
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// MORNING CHECK-IN
// ============================================================
function setupCheckin() {
    // Energy bubbles
    document.querySelectorAll('#ci-energy-bubbles .energy-bubble').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#ci-energy-bubbles .energy-bubble').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            selectedEnergy = parseInt(b.dataset.value);
        });
    });

    // Mood selector
    document.querySelectorAll('#ci-mood-selector .mood-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#ci-mood-selector .mood-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            selectedMood = b.dataset.mood;
        });
    });

    document.getElementById('checkin-submit').addEventListener('click', handleCheckin);
}

async function handleCheckin() {
    const sleepHours = parseFloat(document.getElementById('ci-sleep').value);
    const wakeUp = document.getElementById('ci-wake').value;
    const btn = document.getElementById('checkin-submit');
    setLoading(btn, true);

    const payload = {
        sleep_hours: sleepHours,
        wake_up_time: wakeUp,
        energy_level: selectedEnergy,
        mood: selectedMood,
        today_events: demoCalendar,
    };

    try {
        const res = await apiFetch('/api/checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await res.json();
        displayCheckinResult(result);
    } catch (e) {
        showToast('❌ Gagal menghubungi server!', 'danger');
    } finally {
        setLoading(btn, false);
    }
}

function displayCheckinResult(result) {
    const container = document.getElementById('checkin-result');
    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="card empathy-card"><p class="empathy-text">${result.empathy_message || ''}</p></div>
        <div class="card"><h3>📅 Jadwal Hari Ini (Disesuaikan)</h3><div class="timeline" id="checkin-timeline"></div></div>
        <div class="card reasoning-card">
            <button class="reasoning-toggle" onclick="this.nextElementSibling.classList.toggle('open'); this.querySelector('.chevron').classList.toggle('open');">
                🧠 Alasan FlowMate <span class="chevron">▼</span>
            </button>
            <div class="reasoning-body">
                <ul>${(result.reasoning_transcript || []).map(r => `<li><span class="r-icon">${r.icon}</span><div><strong>${r.event_title}</strong> — ${r.reason}</div></li>`).join('')}</ul>
            </div>
        </div>
        <div class="card tip-card"><p>${result.daily_tip || ''}</p></div>`;

    // Render the adjusted timeline
    setTimeout(() => renderTimeline('checkin-timeline', result.new_schedule, true), 50);
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// JOURNAL
// ============================================================
function setupJournal() {
    document.getElementById('journal-submit').addEventListener('click', handleJournalSubmit);
}

async function handleJournalSubmit() {
    const text = document.getElementById('journal-text').value.trim();
    if (!text) { showToast('⚠️ Tulis sesuatu dulu!', 'warning'); return; }

    const btn = document.getElementById('journal-submit');
    setLoading(btn, true);

    try {
        const res = await apiFetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        const result = await res.json();
        displayJournalInsight(result.entry);
        document.getElementById('journal-text').value = '';
        loadJournalHistory();
        showToast('📝 Jurnal tersimpan!', 'success');
    } catch (e) {
        showToast('❌ Gagal menyimpan jurnal!', 'danger');
    } finally {
        setLoading(btn, false);
    }
}

function displayJournalInsight(entry) {
    const section = document.getElementById('journal-insight');
    const content = document.getElementById('insight-content');
    section.classList.remove('hidden');

    const a = entry.analysis || {};
    content.innerHTML = `
        <div class="insight-item"><strong>Mood:</strong> ${a.mood || '-'}</div>
        <div class="insight-item"><strong>Produktivitas:</strong> ${a.productivity || '-'}/10</div>
        <div class="insight-item"><strong>Blockers:</strong> ${(a.blockers || []).join(', ') || 'Tidak ada'}</div>
        <div class="insight-item"><strong>Insight:</strong> ${a.insight || '-'}</div>`;
}

async function loadJournalHistory() {
    try {
        const res = await apiFetch('/api/journal');
        const data = await res.json();
        const container = document.getElementById('journal-history');
        const entries = data.entries || [];

        if (entries.length === 0) {
            container.innerHTML = '<p class="empty-state">Belum ada jurnal yang ditulis.</p>';
            return;
        }

        container.innerHTML = entries.slice().reverse().map(e => `
            <div class="journal-entry-card">
                <div class="je-date">${e.date || ''}</div>
                <div class="je-text">${e.text}</div>
                <div class="je-mood">Mood: ${e.analysis?.mood || '-'} · Produktivitas: ${e.analysis?.productivity || '-'}/10</div>
            </div>`).join('');
    } catch (e) {
        console.error('Failed to load journal:', e);
    }
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
    try {
        const res = await apiFetch('/api/dashboard');
        const data = await res.json();

        document.getElementById('stat-reschedules').textContent = data.total_reschedules || 0;
        document.getElementById('stat-checkins').textContent = data.total_checkins || 0;
        document.getElementById('stat-avg-energy').textContent = data.avg_energy || 0;
        document.getElementById('stat-journals').textContent = (data.journal_entries || []).length;

        renderEnergyChart(data.checkin_history || []);
        renderMoodChart(data.checkin_history || [], data.journal_entries || []);
    } catch (e) {
        console.error('Dashboard load failed:', e);
    }
}

function renderEnergyChart(history) {
    const ctx = document.getElementById('energy-chart');
    if (energyChart) energyChart.destroy();

    const labels = history.map((_, i) => `#${i + 1}`);
    const values = history.map(h => h.energy_level);

    if (values.length === 0) { labels.push('No data'); values.push(0); }

    energyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Energi',
                data: values,
                borderColor: '#7c3aed',
                backgroundColor: 'rgba(124, 58, 237, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#7c3aed',
                pointRadius: 5,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { min: 0, max: 10, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
            },
        },
    });
}

function renderMoodChart(history, journals) {
    const ctx = document.getElementById('mood-chart');
    if (moodChart) moodChart.destroy();

    const moodCounts = {};
    [...history, ...journals].forEach(item => {
        const m = item.mood || item.analysis?.mood || 'unknown';
        moodCounts[m] = (moodCounts[m] || 0) + 1;
    });

    const labels = Object.keys(moodCounts);
    const values = Object.values(moodCounts);

    if (labels.length === 0) { labels.push('No data'); values.push(1); }

    const colors = ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

    moodChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, font: { size: 12 } } } },
        },
    });
}

// ============================================================
// SLIDERS
// ============================================================
function setupSliders() {
    const panicEnergy = document.getElementById('panic-energy');
    const panicEnergyVal = document.getElementById('panic-energy-val');
    panicEnergy.addEventListener('input', () => panicEnergyVal.textContent = panicEnergy.value);

    const ciSleep = document.getElementById('ci-sleep');
    const ciSleepVal = document.getElementById('ci-sleep-val');
    ciSleep.addEventListener('input', () => ciSleepVal.textContent = ciSleep.value);
}

// ============================================================
// ADD EVENT
// ============================================================
function setupAddEvent() {
    const btn = document.getElementById('btn-add-event');
    const modal = document.getElementById('add-event-modal');
    const closeBtn = document.getElementById('add-event-close');
    const submitBtn = document.getElementById('add-event-submit');

    if(!btn) return;

    btn.addEventListener('click', () => {
        const now = new Date();
        const start = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        now.setHours(now.getHours() + 1);
        const end = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        document.getElementById('event-title').value = '';
        document.getElementById('event-start').value = start;
        document.getElementById('event-end').value = end;
        document.getElementById('event-priority').value = 'medium';
        document.getElementById('event-immovable').checked = false;
        
        modal.classList.remove('hidden');
    });

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

    submitBtn.addEventListener('click', async () => {
        const title = document.getElementById('event-title').value.trim();
        const start = document.getElementById('event-start').value;
        const end = document.getElementById('event-end').value;
        const priority = document.getElementById('event-priority').value;
        const isImmovable = document.getElementById('event-immovable').checked;

        if(!title || !start || !end) {
            showToast('Isi semua form kegiatan!', 'warning');
            return;
        }

        const newEvent = {
            id: `evt_add_${Date.now()}`,
            title,
            start,
            end,
            priority,
            is_immovable: isImmovable
        };

        setLoading(submitBtn, true);

        try {
            const res = await apiFetch('/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newEvent)
            });
            
            if(res.ok) {
                await loadDemoCalendar();
                showToast('Jadwal ditambahkan!', 'success');
                modal.classList.add('hidden');
            } else {
                showToast('Gagal menambahkan jadwal', 'danger');
            }
        } catch(e) {
            console.error(e);
            showToast('Error server', 'danger');
        } finally {
            setLoading(submitBtn, false);
        }
    });
}

// ============================================================
// UTILITIES
// ============================================================
function setLoading(btn, isLoading) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (isLoading) {
        text?.classList.add('hidden');
        loader?.classList.remove('hidden');
        btn.disabled = true;
    } else {
        text?.classList.remove('hidden');
        loader?.classList.add('hidden');
        btn.disabled = false;
    }
}

function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 9999;
        padding: 14px 24px; border-radius: 10px;
        font-family: var(--font); font-size: 14px; font-weight: 500;
        color: white; animation: fadeIn 0.3s ease;
        background: ${type === 'success' ? '#10b981' : type === 'danger' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#7c3aed'};
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}
