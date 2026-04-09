// static/app.js
// Optional: set window.API_BASE (e.g., via inline script or ?api=) to point to your dedicated stock server.
// Fallback: same-origin.
const API_BASE = (function(){
    try {
        if (typeof window !== 'undefined') {
            if (window.API_BASE) return String(window.API_BASE).replace(/\/$/, '');
            const url = new URL(window.location.href);
            const qp = url.searchParams.get('api');
            if (qp) return String(qp).replace(/\/$/, '');
        }
    } catch {}
    return '';
})();
const HERO_DISMISSED_KEY = 'stock:heroDismissed';
const CHART_PREFS_KEY = 'stock:chartPrefs';
const DEFAULT_CHART_PREFS = {
    mode: 'candles',
    showVolume: true,
};

const DEFAULT_PRESETS = {
    fast: {
        label: 'Fast Pass',
        description: 'Quick directional read with lighter analyst coverage.',
        selected_analysts: ['market', 'news', 'fundamentals'],
        online_tools: true,
        max_debate_rounds: 1,
    },
    balanced: {
        label: 'Balanced',
        description: 'Default TradingAgents workflow for day-to-day review.',
        selected_analysts: ['market', 'social', 'news', 'fundamentals'],
        online_tools: true,
        max_debate_rounds: 1,
    },
    deep: {
        label: 'Deep Dive',
        description: 'Full analyst coverage with more debate depth.',
        selected_analysts: ['market', 'social', 'news', 'fundamentals'],
        online_tools: true,
        max_debate_rounds: 2,
    },
};
const DEFAULT_ANALYST_LABELS = {
    market: 'Market',
    social: 'Social',
    news: 'News',
    fundamentals: 'Fundamentals',
};
const STRUCTURED_OPTION_KEYS = new Set(['preset', 'date', 'selected_analysts', 'online_tools', 'max_debate_rounds', 'debug']);

const els = {
    feed: document.getElementById("feed"),
    searchBox: document.getElementById("searchBox"),
    refreshPricesBtn: document.getElementById("fabRefreshBtn"),
    runAllBtn: document.getElementById("fabQueueBtn"),
    heroSection: document.getElementById("heroSection"),
    heroToggleBtn: document.getElementById("heroToggleBtn"),
    heroDismissBtn: document.getElementById("heroDismissBtn"),
    heroAddBtn: document.getElementById("heroAddBtn"),
    heroRunBtn: document.getElementById("heroRunBtn"),
    serverNotice: document.getElementById("serverNotice"),
    overviewCards: document.getElementById("overviewCards"),
    feedMeta: document.getElementById("feedMeta"),
    resetOrderBtn: document.getElementById("resetOrderBtn"),
    fabDock: document.getElementById("fabDock"),
    fabPanel: document.getElementById("fabPanel"),
    fabAdd: document.getElementById("fabAdd"),
    fabNewBtn: document.getElementById("fabNewBtn"),
    // modal
    postDlg: document.getElementById("postDlg"),
    dlgTitle: document.getElementById("dlgTitle"),
    pTitle: document.getElementById("pTitle"),
    pTickers: document.getElementById("pTickers"),
    pDesc: document.getElementById("pDesc"),
    pPurchases: document.getElementById("pPurchases"),
    pDate: document.getElementById("pDate"),
    pRounds: document.getElementById("pRounds"),
    pOnlineTools: document.getElementById("pOnlineTools"),
    pDebug: document.getElementById("pDebug"),
    pOptions: document.getElementById("pOptions"),
    cancelDlg: document.getElementById("cancelDlg"),
    saveDlg: document.getElementById("saveDlg"),
    // detail
    detailDlg: document.getElementById("detailDlg"),
    dTitle: document.getElementById("dTitle"),
    dSubtitle: document.getElementById("dSubtitle"),
    dContent: document.getElementById("dContent"),
    dAnalyze: document.getElementById("dAnalyze"),
    dEdit: document.getElementById("dEdit"),
    dDelete: document.getElementById("dDelete"),
    dRefresh: document.getElementById("dRefresh"),
    dClose: document.getElementById("dClose"),
    serverState: document.getElementById("serverState"),
};

let APP_CONFIG = {
    defaultPreset: 'balanced',
    analysisPresets: DEFAULT_PRESETS,
    analystLabels: DEFAULT_ANALYST_LABELS,
    defaultOptions: {
        preset: 'balanced',
        selected_analysts: ['market', 'social', 'news', 'fundamentals'],
        online_tools: true,
        max_debate_rounds: 1,
        debug: false,
    },
    warnings: [],
    configSummary: {},
    tradingagentsAvailable: true,
    yfinanceAvailable: true,
};

let POSTS = [];
let HAS_CUSTOM_ORDER = (function(){
    try { return localStorage.getItem('feed:customOrder') === '1'; } catch { return false; }
})(); // once user reorders, respect the saved order
let editingId = null;
let currentDetailId = null;
let STREAMS = new Map(); // pid -> EventSource
let REFRESHING = new Set(); // dedupe snapshot refresh calls
let LAST_REFRESH = new Map(); // pid -> timestamp ms
let JOB_STATUS = { running: null, queue: [], states: {} }; // queue status snapshot
let DETAIL_REFRESH_TIMER = null;
let ACTIVE_CHART_CLEANUP = null;
let CHART_PREFS = loadChartPrefs();
let FAB_STATE = {
    open: false,
    pressTimer: null,
    pointerActive: false,
    pressOpened: false,
    suppressClick: false,
};
// Global touch DnD state (single listeners to avoid duplicates)
let TOUCH_DND = { active: false, row: null, tbody: null };

// --- utils
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const fmtMoney = (x) => (x == null || isNaN(x)) ? "" : `$${Number(x).toFixed(2)}`;
const fmtPct = (x) => (x == null || isNaN(x)) ? "" : `${(x).toFixed(2)}%`;
const toList = (s) => (s || "").split(",").map(t => t.trim()).filter(Boolean);
const getAnalystCheckboxes = () => Array.from(document.querySelectorAll('.pAnalyst'));

function heroDismissed() {
    try {
        return localStorage.getItem(HERO_DISMISSED_KEY) === '1';
    } catch {
        return document.documentElement.classList.contains('hero-dismissed');
    }
}

function applyHeroVisibility(dismissed = heroDismissed()) {
    document.documentElement.classList.toggle('hero-dismissed', dismissed);
    if (els.heroSection) {
        if (dismissed) els.heroSection.setAttribute('hidden', 'hidden');
        else els.heroSection.removeAttribute('hidden');
        els.heroSection.setAttribute('aria-hidden', dismissed ? 'true' : 'false');
    }
    if (els.heroToggleBtn) {
        els.heroToggleBtn.setAttribute('aria-expanded', dismissed ? 'false' : 'true');
    }
}

function setHeroDismissed(dismissed) {
    try {
        if (dismissed) localStorage.setItem(HERO_DISMISSED_KEY, '1');
        else localStorage.removeItem(HERO_DISMISSED_KEY);
    } catch {}
    applyHeroVisibility(dismissed);
}

function syncWatchlistPanelActions() {
    if (els.resetOrderBtn) {
        els.resetOrderBtn.disabled = !HAS_CUSTOM_ORDER;
        els.resetOrderBtn.title = HAS_CUSTOM_ORDER ? 'Switch back to timestamp sorting' : 'Already using timestamp sorting';
    }
}

function setFabMenuOpen(open) {
    FAB_STATE.open = !!open;
    if (els.fabDock) els.fabDock.classList.toggle('is-open', FAB_STATE.open);
    if (els.fabPanel) els.fabPanel.setAttribute('aria-hidden', FAB_STATE.open ? 'false' : 'true');
    if (els.fabAdd) els.fabAdd.setAttribute('aria-expanded', FAB_STATE.open ? 'true' : 'false');
    [els.refreshPricesBtn, els.runAllBtn, els.fabNewBtn].filter(Boolean).forEach((button) => {
        button.tabIndex = FAB_STATE.open ? 0 : -1;
    });
    if (!FAB_STATE.open && document.activeElement?.closest?.('#fabPanel')) {
        els.fabAdd?.focus();
    }
}

function clearFabPressTimer() {
    if (FAB_STATE.pressTimer) {
        clearTimeout(FAB_STATE.pressTimer);
        FAB_STATE.pressTimer = null;
    }
}

function closeFabMenu() {
    clearFabPressTimer();
    FAB_STATE.pointerActive = false;
    FAB_STATE.pressOpened = false;
    setFabMenuOpen(false);
}

function consumeSuppressedFabClick(event) {
    if (!FAB_STATE.suppressClick) return false;
    FAB_STATE.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
    return true;
}

function runFabAction(action) {
    if (action === 'refresh') refreshAllSnapshots();
    else if (action === 'queue') queueAllWatchlists();
    else if (action === 'new') openNew();
    closeFabMenu();
}

function fabActionFromPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    const actionButton = target?.closest?.('[data-fab-action]');
    if (actionButton?.dataset?.fabAction) return actionButton.dataset.fabAction;
    return null;
}

function handleFabPressStart(event) {
    if (event.pointerType === 'mouse') return;
    // Capture the pointer so the browser doesn't fire pointercancel when the
    // finger drifts off the button during the hold-to-expand gesture.
    if (event.pointerId != null && event.target?.setPointerCapture) {
        try { event.target.setPointerCapture(event.pointerId); } catch {}
    }
    FAB_STATE.pointerActive = true;
    FAB_STATE.pressOpened = false;
    clearFabPressTimer();
    FAB_STATE.pressTimer = setTimeout(() => {
        FAB_STATE.pressOpened = true;
        setFabMenuOpen(true);
    }, 220);
}

function handleFabPressEnd(event) {
    if (!FAB_STATE.pointerActive) return;
    // Release pointer capture before elementFromPoint so the hit-test isn't
    // redirected back to the captured element (the FAB button itself).
    if (event.pointerId != null && event.target?.releasePointerCapture) {
        try { event.target.releasePointerCapture(event.pointerId); } catch {}
    }
    const action = FAB_STATE.pressOpened ? fabActionFromPoint(event.clientX, event.clientY) : null;
    clearFabPressTimer();
    FAB_STATE.pointerActive = false;
    FAB_STATE.pressOpened = false;
    FAB_STATE.suppressClick = true;
    if (action) runFabAction(action);
    else closeFabMenu();
}

function handleFabPressCancel() {
    if (!FAB_STATE.pointerActive) return;
    FAB_STATE.pointerActive = false;
    FAB_STATE.pressOpened = false;
    FAB_STATE.suppressClick = true;
    closeFabMenu();
}

function bindFabDock() {
    if (!els.fabDock || !els.fabAdd) return;
    const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    setFabMenuOpen(false);

    els.fabAdd.addEventListener('mouseenter', () => {
        if (finePointer()) setFabMenuOpen(true);
    });
    els.fabDock.addEventListener('mouseleave', () => {
        if (finePointer()) closeFabMenu();
    });

    window.addEventListener('pointerdown', (event) => {
        if (!FAB_STATE.open || els.fabDock.contains(event.target)) return;
        closeFabMenu();
    });

    // Prevent OS long-press context menu on the FAB button (mobile).
    els.fabAdd.addEventListener('contextmenu', (e) => e.preventDefault());

    els.fabAdd.addEventListener('pointerdown', handleFabPressStart);
    window.addEventListener('pointerup', handleFabPressEnd);
    window.addEventListener('pointercancel', handleFabPressCancel);

    els.fabAdd.addEventListener('click', (event) => {
        if (consumeSuppressedFabClick(event)) return;
        event.preventDefault();
        setFabMenuOpen(!FAB_STATE.open);
    });

    [els.runAllBtn, els.refreshPricesBtn, els.fabNewBtn].filter(Boolean).forEach((button) => {
        button.addEventListener('click', (event) => {
            if (consumeSuppressedFabClick(event)) return;
            const action = button.dataset.fabAction;
            if (!action) return;
            runFabAction(action);
        });
    });
}

function normalizeTickers(value) {
    const unique = new Set();
    const tickers = [];
    toList(value).forEach((ticker) => {
        const normalized = String(ticker || '').trim().toUpperCase();
        if (!normalized || unique.has(normalized)) return;
        unique.add(normalized);
        tickers.push(normalized);
    });
    return tickers;
}

function todayLocalDate() {
    const now = new Date();
    const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
}

function parsePurchases(str) {
    const m = {};
    toList(str).forEach(pair => {
        const [k, v] = pair.split("=").map(z => z.trim());
        if (k && v && !isNaN(parseFloat(v))) m[k.toUpperCase()] = parseFloat(v);
    });
    return m;
}
function optionsFromJson(text) {
    if (!text || !text.trim()) return {};
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        throw new Error();
    } catch {
        throw new Error('Advanced overrides must be valid JSON objects.');
    }
}
function classBySuggestion(s) {
    const v = String(s || "").toLowerCase();
    if (v === "buy") return "buy";
    if (v === "sell") return "sell";
    return "hold";
}

function normalizedOptions(options = {}) {
    const incoming = (options && typeof options === 'object') ? options : {};
    const presetKey = String(incoming.preset || APP_CONFIG.defaultPreset || 'balanced').toLowerCase();
    const preset = APP_CONFIG.analysisPresets[presetKey] || DEFAULT_PRESETS[presetKey] || DEFAULT_PRESETS.balanced;
    const allowedAnalysts = new Set(Object.keys(APP_CONFIG.analystLabels || DEFAULT_ANALYST_LABELS));
    const selected = Array.isArray(incoming.selected_analysts)
        ? incoming.selected_analysts.map((item) => String(item || '').trim().toLowerCase()).filter((item, index, arr) => allowedAnalysts.has(item) && arr.indexOf(item) === index)
        : [];
    const rounds = clamp(parseInt(incoming.max_debate_rounds, 10) || preset.max_debate_rounds || 1, 1, 4);
    return {
        ...incoming,
        preset: presetKey in APP_CONFIG.analysisPresets ? presetKey : 'balanced',
        selected_analysts: selected.length ? selected : [...(preset.selected_analysts || DEFAULT_PRESETS.balanced.selected_analysts)],
        online_tools: typeof incoming.online_tools === 'boolean' ? incoming.online_tools : preset.online_tools !== false,
        max_debate_rounds: rounds,
        debug: Boolean(incoming.debug),
        date: incoming.date || todayLocalDate(),
    };
}

function getPresetInfo(options = {}) {
    const normalized = normalizedOptions(options);
    const preset = APP_CONFIG.analysisPresets[normalized.preset] || DEFAULT_PRESETS[normalized.preset] || DEFAULT_PRESETS.balanced;
    return { key: normalized.preset, ...preset };
}

function stripStructuredOptions(options = {}) {
    const advanced = { ...(options || {}) };
    STRUCTURED_OPTION_KEYS.forEach((key) => delete advanced[key]);
    if (advanced.config && typeof advanced.config === 'object' && !Array.isArray(advanced.config) && !Object.keys(advanced.config).length) {
        delete advanced.config;
    }
    return advanced;
}

function setSelectedAnalysts(analysts) {
    const selected = new Set(normalizedOptions({ selected_analysts: analysts }).selected_analysts);
    getAnalystCheckboxes().forEach((input) => {
        input.checked = selected.has(input.value);
    });
}

function selectedAnalystsFromForm() {
    return getAnalystCheckboxes().filter((input) => input.checked).map((input) => input.value);
}

function getSelectedPreset() {
    return document.querySelector('input[name="analysisPreset"]:checked')?.value || APP_CONFIG.defaultPreset || 'balanced';
}

function setPresetOnForm(presetKey, applyDefaults = true) {
    const key = String(presetKey || APP_CONFIG.defaultPreset || 'balanced').toLowerCase();
    const input = document.querySelector(`input[name="analysisPreset"][value="${key}"]`);
    if (input) input.checked = true;
    const preset = APP_CONFIG.analysisPresets[key] || DEFAULT_PRESETS[key] || DEFAULT_PRESETS.balanced;
    if (applyDefaults) {
        setSelectedAnalysts(preset.selected_analysts || DEFAULT_PRESETS.balanced.selected_analysts);
        els.pOnlineTools.checked = preset.online_tools !== false;
        els.pRounds.value = String(preset.max_debate_rounds || 1);
    }
}

function setFormFromOptions(options = {}) {
    const normalized = normalizedOptions(options);
    setPresetOnForm(normalized.preset, true);
    els.pDate.value = normalized.date || todayLocalDate();
    els.pRounds.value = String(normalized.max_debate_rounds || 1);
    els.pOnlineTools.checked = normalized.online_tools !== false;
    els.pDebug.checked = Boolean(normalized.debug);
    setSelectedAnalysts(normalized.selected_analysts);
    const advanced = stripStructuredOptions(options);
    els.pOptions.value = Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '';
}

function buildOptionsFromForm() {
    const advanced = optionsFromJson(els.pOptions.value);
    return {
        ...advanced,
        preset: getSelectedPreset(),
        date: els.pDate.value || todayLocalDate(),
        selected_analysts: selectedAnalystsFromForm(),
        online_tools: !!els.pOnlineTools.checked,
        max_debate_rounds: clamp(parseInt(els.pRounds.value, 10) || 1, 1, 4),
        debug: !!els.pDebug.checked,
    };
}

function defaultTitleForTickers(tickers) {
    if (!tickers.length) return 'Untitled';
    const head = tickers.slice(0, 3).join(' / ');
    return tickers.length > 3 ? `${head} +${tickers.length - 3} watchlist` : `${head} watchlist`;
}

function formatDateTime(value) {
    if (!value) return 'Not run yet';
    try {
        return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return String(value);
    }
}

function formatRelativeTime(value) {
    if (!value) return 'Not run yet';
    try {
        const diffMs = Date.now() - new Date(value).getTime();
        if (!isFinite(diffMs)) return formatDateTime(value);
        const mins = Math.round(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.round(hours / 24);
        return `${days}d ago`;
    } catch {
        return formatDateTime(value);
    }
}

function getPrimaryTicker(post) {
    return (post?.tickers || [])[0] || '';
}

function getPrimarySuggestion(post) {
    const primary = getPrimaryTicker(post);
    let suggestion = rowSuggestion(post, primary);
    const livePrim = JOB_STATUS.primary_suggestions?.[post.id];
    if (livePrim && livePrim.ticker === primary && livePrim.suggestion) {
        suggestion = livePrim.suggestion;
    }
    return suggestion || 'Hold';
}

function getStatusState(post) {
    return JOB_STATUS.states?.[post.id] || post?.analysis?.progress?.state || (post?.analysis?.completedAt ? 'done' : 'idle');
}

function getStatusBadgeHtml(post) {
    const state = getStatusState(post);
    if (state === 'running') return '<span class="pill status-running">running</span>';
    if (state === 'queued') return '<span class="pill status-queued">queued</span>';
    if (state === 'stopped') return '<span class="pill status-stopped">stopped</span>';
    if (state === 'error') return '<span class="pill status-error">error</span>';
    if (state === 'done') return `<span class="pill status-done">${escapeHtml(formatRelativeTime(post?.analysis?.completedAt))}</span>`;
    return '<span class="pill">not run</span>';
}

function getSuggestionBreakdown(post) {
    const perTicker = post?.analysis?.per_ticker || {};
    const counts = { Buy: 0, Hold: 0, Sell: 0 };
    Object.values(perTicker).forEach((entry) => {
        const label = String(entry?.suggestion || 'Hold');
        if (label === 'Buy' || label === 'Hold' || label === 'Sell') counts[label] += 1;
    });
    return counts;
}

function analystLabel(analyst) {
    return APP_CONFIG.analystLabels?.[analyst] || DEFAULT_ANALYST_LABELS[analyst] || analyst;
}

function upsertPost(post) {
    const idx = POSTS.findIndex((item) => item.id === post.id);
    if (idx >= 0) POSTS[idx] = post;
    else POSTS.push(post);
    return post;
}

function getPostById(id) {
    return POSTS.find((post) => post.id === id);
}

// Simple toast helper
function showToast(message, opts = {}) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = String(message || '');
    document.body.appendChild(div);
    // Force reflow to enable animation class
    void div.offsetWidth; 
    div.classList.add('show');
    const ttl = Math.max(1200, opts.duration || 1800);
    setTimeout(() => {
        div.classList.remove('show');
        setTimeout(() => { div.remove(); }, 250);
    }, ttl);
}

// --- API
async function api(path, opts) {
    const url = /^https?:/i.test(path) ? path : (API_BASE + path);
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
}

async function loadConfig() {
    try {
        const j = await api("/api/config");
        const mergedConfig = {
            ...APP_CONFIG,
            ...j,
            analysisPresets: j.analysisPresets || APP_CONFIG.analysisPresets,
            analystLabels: { ...DEFAULT_ANALYST_LABELS, ...(j.analystLabels || {}) },
            defaultPreset: j.defaultPreset || APP_CONFIG.defaultPreset,
            warnings: Array.isArray(j.warnings) ? j.warnings : [],
        };
        APP_CONFIG = mergedConfig;
        APP_CONFIG.defaultOptions = normalizedOptions(j.defaultOptions || APP_CONFIG.defaultOptions);
        const serverLabel = j.tradingagentsAvailable ? 'TradingAgents ready' : 'Server fallback';
        const priceLabel = j.yfinanceAvailable ? 'prices live' : 'prices offline';
        els.serverState.textContent = `${serverLabel} · ${priceLabel}`;
        if (els.serverNotice) {
            const summary = APP_CONFIG.configSummary || {};
            const modelNote = summary.deep_think_llm || summary.quick_think_llm
                ? `Default models: ${[summary.deep_think_llm, summary.quick_think_llm].filter(Boolean).join(' / ')}.`
                : 'Choose a preset and queue a watchlist to start.';
            const warning = APP_CONFIG.warnings[0];
            els.serverNotice.textContent = warning || `${modelNote} Structured presets now map directly into the server config.`;
        }
    } catch {
        els.serverState.textContent = "server unavailable";
        if (els.serverNotice) {
            els.serverNotice.textContent = 'Could not reach the stock server. Check that the Flask app is running before using the dashboard.';
        }
    }
}

async function loadQueueStatus() {
    try {
        JOB_STATUS = await api('/api/queue/status');
    } catch (e) {
        JOB_STATUS = { running: null, queue: [], states: {} };
    }
}

async function loadPosts() {
    POSTS = await api("/api/stocks");
    // Detect if server order differs from time-sorted order; if so, treat as custom order
    try {
        const byTime = POSTS.slice().sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
        const same = (POSTS.length === byTime.length) && POSTS.every((p, i) => p.id === byTime[i].id);
        if (!same) HAS_CUSTOM_ORDER = true;
    } catch {}
    // if server returned posts in a specific order, respect it; HAS_CUSTOM_ORDER persists during session
    await loadQueueStatus();
    renderFeed();
}

async function savePost() {
    const tickers = normalizeTickers(els.pTickers.value);
    if (!tickers.length) {
        showToast('Add at least one ticker before saving.');
        els.pTickers.focus();
        return;
    }
    const selectedAnalysts = selectedAnalystsFromForm();
    if (!selectedAnalysts.length) {
        showToast('Select at least one analyst for the run.');
        return;
    }

    let options;
    try {
        options = buildOptionsFromForm();
    } catch (error) {
        showToast(error.message || 'Could not parse advanced overrides.');
        els.pOptions.focus();
        return;
    }

    const body = {
        title: els.pTitle.value.trim() || defaultTitleForTickers(tickers),
        tickers,
        description: els.pDesc.value.trim(),
        purchases: parsePurchases(els.pPurchases.value),
        options: { ...options, selected_analysts: selectedAnalysts },
    };
    const wasEditingId = editingId;
    let saved;
    els.saveDlg.disabled = true;
    try {
        if (!editingId) {
            saved = await api("/api/stocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        } else {
            saved = await api(`/api/stocks/${encodeURIComponent(editingId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }
    } catch (error) {
        showToast(`Failed to save watchlist: ${error.message || error}`);
        els.saveDlg.disabled = false;
        return;
    }
    els.saveDlg.disabled = false;
    els.postDlg.close();
    editingId = null;
    upsertPost(saved);
    await loadPosts();
    // If the detail dialog is open for this post, re-open it to reflect new tickers immediately
    if (currentDetailId && wasEditingId && currentDetailId === wasEditingId) {
        openDetail(wasEditingId);
    }
}

async function runAnalysis(id) {
    const res = await api(`/api/analyze/${encodeURIComponent(id)}`, { method: "POST" });
    const idx = POSTS.findIndex(p => p.id === id);
    if (idx >= 0) POSTS[idx] = res;
    renderFeed();
    openDetail(id);
}

function runAnalysisStream(id) {
    // Close existing stream for this id
    stopAnalysisStream(id);
    const url = (API_BASE + `/api/analyze-stream/${encodeURIComponent(id)}`);
    const es = new EventSource(url);
    STREAMS.set(id, es);

    const logElm = () => document.getElementById('dReport');
    const snapshotHost = () => document.getElementById('dSnapshot');

    function appendLog(line) {
        const pre = logElm();
        if (!pre) return;
        pre.textContent += (pre.textContent ? "\n" : "") + line;
        pre.scrollTop = pre.scrollHeight;
    }

    es.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data || '{}');
            if (!data || currentDetailId !== id) return; // only update visible entry
            if (data.type === 'start') {
                // Ensure raw log area exists; if currently in Markdown mode, switch to raw for live logs
                (function ensureRawArea(){
                    const pre = logElm();
                    if (pre) return;
                    const host = document.getElementById('reportHost');
                    if (!host) return;
                    const text = host.textContent || '';
                    host.className = '';
                    host.innerHTML = `<pre id="dReport" class="log" style="white-space:pre-wrap"></pre>`;
                    const p = document.getElementById('dReport');
                    if (p) p.textContent = text;
                    try { host.__mode = 'raw'; } catch {}
                    const tgl = document.getElementById('toggleMdBtn');
                    if (tgl) tgl.textContent = 'View: Markdown';
                })();
                // Do not clear existing report; just note the new stream start
                appendLog('Streaming started…');
            } else if (data.type === 'log') {
                appendLog(String(data.message || ''));
            } else if (data.type === 'ticker-done') {
                // Update local POSTS cache
                const idx = POSTS.findIndex(p => p.id === id);
                if (idx >= 0) {
                    const p = POSTS[idx];
                    p.analysis = p.analysis || { per_ticker: {} };
                    p.analysis.per_ticker = p.analysis.per_ticker || {};
                    if (data.ticker) {
                        p.analysis.per_ticker[data.ticker] = { suggestion: data.suggestion || 'Hold', signals: p.analysis.per_ticker[data.ticker]?.signals || {} };
                        p.snapshot = p.snapshot || {};
                        p.snapshot[data.ticker] = { current: data.current, pct: data.pct };
                        p.updatedAt = new Date().toISOString();
                    }
                    // Update snapshot section live
                    if (snapshotHost()) { snapshotHost().innerHTML = renderSnapshotTable(p); }
                    // Update feed row highlighting and values
                    renderFeed();
                }
            } else if (data.type === 'ticker-error') {
                appendLog(`Error for ${data.ticker}: ${data.error}`);
            } else if (data.type === 'done') {
                appendLog('Streaming complete.');
                // Refresh posts to get final summary
                loadPosts().then(async () => {
                    // Ensure summary exists even if upstream didn't populate
                    try { await api(`/api/summarize/${encodeURIComponent(id)}`); } catch {}
                    if (currentDetailId === id) openDetail(id);
                });
                stopAnalysisStream(id);
            } else if (data.type === 'error') {
                appendLog(`Error: ${data.message || ''}`);
                stopAnalysisStream(id);
            }
        } catch (err) {
            console.error('SSE parse error', err);
        }
    };

    es.onerror = () => {
        appendLog('Stream error.');
        stopAnalysisStream(id);
    };
}

function stopAnalysisStream(id) {
    const es = STREAMS.get(id);
    if (es) { try { es.close(); } catch {} STREAMS.delete(id); }
}

// --- UI
function renderOverview() {
    if (!els.overviewCards) return;
    const totalPosts = POSTS.length;
    const totalTickers = POSTS.reduce((sum, post) => sum + (post.tickers || []).length, 0);
    const runningCount = JOB_STATUS.running ? 1 : 0;
    const queuedCount = (JOB_STATUS.queue || []).length;
    const primaryCounts = { Buy: 0, Hold: 0, Sell: 0 };
    POSTS.forEach((post) => {
        const suggestion = getPrimarySuggestion(post);
        if (primaryCounts[suggestion] == null) primaryCounts.Hold += 1;
        else primaryCounts[suggestion] += 1;
    });
    const freshToday = POSTS.filter((post) => {
        if (!post.analysis?.completedAt) return false;
        try { return new Date(post.analysis.completedAt).toDateString() === new Date().toDateString(); } catch { return false; }
    }).length;
    const readyCount = POSTS.filter((post) => (post.tickers || []).length && !['queued', 'running'].includes(getStatusState(post))).length;
    const cards = [
        {
            label: 'Watchlists',
            value: String(totalPosts),
            meta: `${totalTickers} tracked tickers`,
            sub: totalPosts ? `${Math.round(totalTickers / totalPosts)} avg tickers per list` : 'Create your first basket to begin.',
        },
        {
            label: 'Queue',
            value: `${runningCount + queuedCount}`,
            meta: runningCount ? `${runningCount} running now` : 'Nothing currently running',
            sub: queuedCount ? `${queuedCount} waiting in line` : `${readyCount} ready to queue`,
        },
        {
            label: 'Primary Calls',
            value: `${primaryCounts.Buy}/${primaryCounts.Hold}/${primaryCounts.Sell}`,
            meta: 'Buy / Hold / Sell',
            sub: totalPosts ? `${primaryCounts.Buy} bullish lists and ${primaryCounts.Sell} risk-off lists` : 'Run analysis to populate signals.',
        },
        {
            label: 'Fresh Today',
            value: String(freshToday),
            meta: freshToday ? `${freshToday} lists completed today` : 'No completed runs yet today',
            sub: APP_CONFIG.autoRegenerationEnabled ? 'Auto regeneration is enabled on the server.' : 'Runs update only when you queue them.',
        },
    ];

    els.overviewCards.innerHTML = cards.map((card) => `
        <article class="overviewCard">
            <span class="overviewLabel">${escapeHtml(card.label)}</span>
            <span class="overviewValue">${escapeHtml(card.value)}</span>
            <div class="overviewMeta">${escapeHtml(card.meta)}</div>
            <div class="overviewSub">${escapeHtml(card.sub)}</div>
        </article>
    `).join('');
}

function renderFeed() {
    const q = (els.searchBox.value || '').toLowerCase().trim();
    let filtered = POSTS.filter((post) => {
        if (!q) return true;
        const hay = [post.title || '', post.description || '', ...(post.tickers || [])].join(' ').toLowerCase();
        return hay.includes(q);
    });
    if (!HAS_CUSTOM_ORDER) {
        filtered = filtered.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    }

    renderOverview();
    if (els.feedMeta) {
        const totalTickers = filtered.reduce((sum, post) => sum + (post.tickers || []).length, 0);
        els.feedMeta.textContent = `${filtered.length} watchlists visible / ${POSTS.length} total · ${totalTickers} tickers in view`;
    }
    syncWatchlistPanelActions();

    if (!filtered.length) {
        els.feed.innerHTML = `<div class="empty-state">
          <div class="muted">No watchlists match the current view yet. Create a basket, choose a preset, and queue the run when you are ready.</div>
        </div>`;
        return;
    }

    const table = document.createElement('table');
    table.className = 'table';
    table.innerHTML = `
    <thead>
      <tr>
        <th style="width:24px"></th>
        <th style="width:32%">Watchlist</th>
        <th style="width:22%">Tickers</th>
        <th style="width:14%;text-align:right">Purchase</th>
        <th style="width:14%;text-align:right">Current</th>
        <th style="width:10%;text-align:right">Move</th>
        <th style="width:8%">Signal</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
    const tbody = table.querySelector('tbody');

    for (const post of filtered) {
        const primary = getPrimaryTicker(post);
        const snap = (post.snapshot || {})[primary] || {};
        const purchase = (post.purchases || {})[primary];
        const suggestion = getPrimarySuggestion(post);
        const preset = getPresetInfo(post.options || {});
        const options = normalizedOptions(post.options || {});
        const progress = post.analysis?.progress || {};
        const runningNote = ['queued', 'running'].includes(getStatusState(post))
            ? `<span class="miniTag">${escapeHtml(`${progress.completed || 0}/${progress.total || (post.tickers || []).length || 0} tickers`)}</span>`
            : `<span class="miniTag">${escapeHtml(post.analysis?.completedAt ? `last run ${formatRelativeTime(post.analysis.completedAt)}` : 'awaiting first run')}</span>`;
        const tr = document.createElement('tr');
        tr.className = `rowAccent ${classBySuggestion(suggestion)}`;
        tr.setAttribute('data-id', post.id);
        const tagRail = `
            ${getStatusBadgeHtml(post)}
            <span class="miniTag">${escapeHtml(preset.label || 'Preset')}</span>
            <span class="miniTag">${escapeHtml(`${options.selected_analysts.length} analysts`)}</span>
            ${options.online_tools ? '<span class="miniTag">live tools</span>' : '<span class="miniTag">offline only</span>'}
            ${runningNote}
        `;
        tr.innerHTML = `
      <td class="drag-cell"><span class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder" draggable="false">::</span></td>
      <td class="watchlistRowCell" colspan="6">
        <table class="watchlistRowTable" role="presentation">
            <tbody>
                <tr class="watchlistRowMain">
                    <td class="watchlistCol watchlistCol-name" data-label="Watchlist">
                        <div class="watchlistTitle">${escapeHtml(post.title || 'Untitled')}</div>
                        <div class="watchlistDesc muted">${post.description ? escapeHtml(post.description.slice(0, 140)) : 'No thesis added yet.'}</div>
                    </td>
                    <td class="watchlistCol watchlistCol-tickers" data-label="Tickers">
                        <div class="tickerRail">${(post.tickers || []).map((ticker) => `<span class="tickerpill">${escapeHtml(ticker)}</span>`).join('')}</div>
                    </td>
                    <td class="watchlistCol watchlistCol-number" data-label="Purchase">${fmtMoney(purchase)}</td>
                    <td class="watchlistCol watchlistCol-number" data-label="Current">${fmtMoney(snap.current)}</td>
                    <td class="watchlistCol watchlistCol-number" data-label="Move">${snap.pct == null ? '' : fmtPct(snap.pct)}</td>
                    <td class="watchlistCol watchlistCol-signal" data-label="Signal"><span class="badge suggestion ${classBySuggestion(suggestion)}">${escapeHtml(suggestion || '')}</span></td>
                </tr>
                <tr class="watchlistRowMeta">
                    <td colspan="6">
                        <div class="watchlistTagRail">${tagRail}</div>
                    </td>
                </tr>
            </tbody>
        </table>
      </td>
    `;
        // Avoid triggering click while dragging
        let dragStarted = false;
        const handle = tr.querySelector('.drag-handle');
        if (handle) {
            handle.setAttribute('draggable', 'true');
            handle.addEventListener('dragstart', (e) => {
                dragStarted = true;
                tr.classList.add('dragging');
                // data
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', post.id);
                // custom drag image (ghost)
                try {
                    const ghost = document.createElement('div');
                    ghost.className = 'drag-ghost';
                    ghost.textContent = post.title || 'Untitled';
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 10, 10);
                    window._dragGhost = ghost;
                } catch {}
            });
            handle.addEventListener('dragend', () => {
                dragStarted = false;
                tr.classList.remove('dragging');
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drop-before','drop-after'));
                if (window._dragGhost) { try { window._dragGhost.remove(); } catch {} window._dragGhost = null; }
            });
        }
        // Row-level delegates for visual indicator and live reflow while dragging (mouse)
        tr.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingRow = tbody.querySelector('tr.dragging');
            if (!draggingRow || draggingRow === tr) return;
            // Clear previous indicators
            tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drop-before','drop-after'));
            const rect = tr.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            if (before) {
                tr.classList.add('drop-before');
                tbody.insertBefore(draggingRow, tr);
            } else {
                tr.classList.add('drop-after');
                tbody.insertBefore(draggingRow, tr.nextSibling);
            }
        });
        tr.addEventListener('dragleave', () => tr.classList.remove('drop-before','drop-after'));
        tr.addEventListener('drop', async (e) => {
            e.preventDefault();
            tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drop-before','drop-after'));
            // Persist new order
            const newOrder = Array.from(tbody.querySelectorAll('tr')).map(r => r.getAttribute('data-id')).filter(Boolean);
            try {
                await api('/api/stocks/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: newOrder }) });
                HAS_CUSTOM_ORDER = true;
                try { localStorage.setItem('feed:customOrder', '1'); } catch {}
                syncWatchlistPanelActions();
                // Reflect local POSTS order immediately without reloading
                const byId = new Map(POSTS.map(x => [x.id, x]));
                POSTS = newOrder.map(id => byId.get(id)).filter(Boolean).concat(POSTS.filter(x => !newOrder.includes(x.id)));
                showToast('Order saved');
            } catch (err) {
                console.warn('Failed to save order', err);
            }
        });
        // Touch-based reordering fallback for phones (no native drag & drop)
        handle?.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            TOUCH_DND.active = true; dragStarted = true;
            TOUCH_DND.row = tr; TOUCH_DND.tbody = tbody;
            tr.classList.add('dragging');
            e.preventDefault();
        }, { passive: false });
        tr.addEventListener("click", (ev) => {
            // ignore click if it was a drag (mouse) or just ended touch DnD
            if (dragStarted) return;
            if (window.__touchDndJustEnded && (Date.now() - window.__touchDndJustEnded) < 600) return;
            // ignore clicks on handle that might be slight
            if (ev.target && ev.target.closest('.drag-handle')) return;
            openDetail(post.id);
        });
        tbody.appendChild(tr);
    }

    els.feed.innerHTML = '';
    els.feed.appendChild(table);

    // Background-refresh current prices for visible rows, throttled
    const now = Date.now();
    const toRefresh = filtered.slice(0, 10); // cap to avoid flooding
    toRefresh.forEach((p, i) => {
        const last = LAST_REFRESH.get(p.id) || 0;
        if (now - last < 60000) return; // skip if refreshed in last 60s
        setTimeout(() => refreshSnapshot(p.id), i * 200);
    });
}

function rowSuggestion(p, primary) {
    const a = p.analysis || {};
    const pt = (a.per_ticker || {})[primary] || {};
    return pt.suggestion || "Hold";
}

function openNew() {
    editingId = null;
    els.dlgTitle.textContent = 'New Watchlist';
    els.saveDlg.textContent = 'Save Watchlist';
    els.pTitle.value = "";
    els.pTickers.value = "";
    els.pDesc.value = "";
    els.pPurchases.value = "";
    setFormFromOptions(APP_CONFIG.defaultOptions || {});
    els.pDate.value = todayLocalDate();
    els.postDlg.showModal();
}

function openEdit(p) {
    editingId = p.id;
    els.dlgTitle.textContent = 'Edit Watchlist';
    els.saveDlg.textContent = 'Update Watchlist';
    els.pTitle.value = p.title || "";
    els.pTickers.value = (p.tickers || []).join(", ");
    els.pDesc.value = p.description || "";
    const kv = Object.entries(p.purchases || {}).map(([k, v]) => `${k}=${v}`).join(", ");
    els.pPurchases.value = kv;
    setFormFromOptions(p.options || {});
    els.postDlg.showModal();
}

async function removePost(id) {
    if (!confirm("Delete this post?")) return;
    await api(`/api/stocks/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadPosts();
    els.detailDlg.close();
}

function renderReportInto(host, content) {
    if (!host) return;
    host.__mode = host.__mode || 'md';
    const text = String(content || '');
    if (host.__mode === 'md' && window.marked && window.DOMPurify) {
        try {
            const html = window.marked.parse(text);
            const safe = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: false, svgFilters: false, mathMl: false } });
            host.className = 'md';
            host.innerHTML = safe || '<div class="muted">No report content yet.</div>';
            return;
        } catch {}
    }
    host.className = '';
    host.innerHTML = `<pre id="dReport" class="log">${escapeHtml(text || 'No report content yet.')}</pre>`;
}

function currentReportText(post) {
    if (!post) return '';
    if (post.analysis?.report) return String(post.analysis.report);
    if (post.analysis?.summary) return String(post.analysis.summary);
    const state = getStatusState(post);
    if (state === 'queued') return 'Queued for analysis. The report will appear once the worker starts writing output.';
    if (state === 'running') return 'Analysis is running. Output will appear here as the report file updates.';
    return 'No analysis has been run for this watchlist yet.';
}

function renderDetailMetaGrid(post) {
    const options = normalizedOptions(post.options || {});
    const preset = getPresetInfo(options);
    const breakdown = getSuggestionBreakdown(post);
    const primary = getPrimarySuggestion(post);
    const analysts = options.selected_analysts.map((item) => analystLabel(item)).join(', ');
    const completedAt = post.analysis?.completedAt ? formatDateTime(post.analysis.completedAt) : 'Not completed yet';
    return `
        <article class="detailMetric">
            <strong>Mode</strong>
            <div class="metricValue">${escapeHtml(preset.label || 'Balanced')}</div>
            <div class="muted">${escapeHtml(preset.description || '')}</div>
        </article>
        <article class="detailMetric">
            <strong>Analysts</strong>
            <div class="metricValue">${escapeHtml(String(options.selected_analysts.length))}</div>
            <div class="muted">${escapeHtml(analysts || 'None selected')}</div>
        </article>
        <article class="detailMetric">
            <strong>Primary call</strong>
            <div class="metricValue">${escapeHtml(primary)}</div>
            <div class="muted">${escapeHtml(`${breakdown.Buy} Buy / ${breakdown.Hold} Hold / ${breakdown.Sell} Sell`)}</div>
        </article>
        <article class="detailMetric">
            <strong>Last completion</strong>
            <div class="metricValue">${escapeHtml(getStatusState(post) === 'done' ? 'Ready' : getStatusState(post))}</div>
            <div class="muted">${escapeHtml(completedAt)}</div>
        </article>
    `;
}

function renderProgressBlock(post) {
    const progress = post.analysis?.progress || {};
    const state = getStatusState(post);
    const total = progress.total || (post.tickers || []).length || 0;
    const completed = clamp(progress.completed || 0, 0, Math.max(total, 0));
    const percent = total ? Math.round((completed / total) * 100) : (state === 'done' ? 100 : 0);
    let label = 'Awaiting first run';
    if (state === 'queued') label = 'Queued and waiting for the worker';
    else if (state === 'running') label = progress.currentTicker ? `Running ${progress.currentTicker}` : 'Running analysis';
    else if (state === 'done') label = 'Latest run complete';
    else if (state === 'error') label = 'The latest run ended with an error';
    else if (state === 'stopped') label = 'The queued run was stopped';
    return `
        <div class="progressWrap">
            <div class="progressMeta">
                <strong>${escapeHtml(label)}</strong>
                <span class="muted">${escapeHtml(total ? `${completed}/${total} tickers` : 'No tickers configured')}</span>
            </div>
            <div class="progressBar"><span class="progressFill" style="width:${percent}%"></span></div>
        </div>
    `;
}

function renderAnalyzeButton(id) {
    const post = getPostById(id);
    const state = post ? getStatusState(post) : 'idle';
    els.dAnalyze.disabled = !(post && (post.tickers || []).length);
    els.dAnalyze.classList.remove('state-queued', 'state-running', 'state-stopped', 'primary');
    if (!post || !(post.tickers || []).length) {
        els.dAnalyze.textContent = 'No tickers';
        return;
    }
    if (state === 'running') {
        els.dAnalyze.textContent = 'Stop analysis';
        els.dAnalyze.classList.add('state-running');
        return;
    }
    if (state === 'queued') {
        els.dAnalyze.textContent = 'Remove from queue';
        els.dAnalyze.classList.add('state-queued');
        return;
    }
    if (state === 'stopped') {
        els.dAnalyze.textContent = 'Queue again';
        els.dAnalyze.classList.add('state-stopped');
        return;
    }
    els.dAnalyze.textContent = post.analysis?.completedAt ? 'Re-run analysis' : 'Queue analysis';
    els.dAnalyze.classList.add('primary');
}

function stopDetailAutoRefresh() {
    if (DETAIL_REFRESH_TIMER) {
        clearInterval(DETAIL_REFRESH_TIMER);
        DETAIL_REFRESH_TIMER = null;
    }
}

function startDetailAutoRefresh(id) {
    stopDetailAutoRefresh();
    DETAIL_REFRESH_TIMER = setInterval(async () => {
        if (!els.detailDlg?.open || currentDetailId !== id) {
            stopDetailAutoRefresh();
            return;
        }
        const post = getPostById(id);
        const state = post ? getStatusState(post) : 'idle';
        if (!['queued', 'running'].includes(state)) {
            stopDetailAutoRefresh();
            return;
        }
        try {
            await loadQueueStatus();
            const fresh = await api(`/api/stocks/${encodeURIComponent(id)}`);
            upsertPost(fresh);
            syncDetailPanels(fresh);
            renderFeed();
        } catch (error) {
            console.warn('detail auto refresh failed', error);
        }
    }, 2500);
}

function syncDetailPanels(post) {
    if (!post || currentDetailId !== post.id) return;
    const options = normalizedOptions(post.options || {});
    const preset = getPresetInfo(options);
    const status = getStatusState(post);
    if (els.dTitle) els.dTitle.textContent = post.title || 'Watchlist';
    if (els.dSubtitle) {
        const subtitleParts = [
            (post.tickers || []).join(', '),
            preset.label || 'Balanced',
            status,
        ].filter(Boolean);
        els.dSubtitle.textContent = subtitleParts.join(' | ');
    }

    const metaGrid = document.getElementById('dMetaGrid');
    if (metaGrid) metaGrid.innerHTML = renderDetailMetaGrid(post);

    const progressHost = document.getElementById('dProgressHost');
    if (progressHost) progressHost.innerHTML = renderProgressBlock(post);

    const summaryHost = document.getElementById('dSummary');
    if (summaryHost) {
        summaryHost.textContent = post.analysis?.summary || (status === 'running' ? 'Summary will populate when the run completes.' : 'No summary yet.');
    }

    const snapshotHost = document.getElementById('dSnapshot');
    if (snapshotHost) snapshotHost.innerHTML = renderSnapshotTable(post);

    const reportHost = document.getElementById('reportHost');
    if (reportHost) renderReportInto(reportHost, currentReportText(post));

    renderAnalyzeButton(post.id);
    if (window._activeTicker) updateChartMeta(window._activeTicker);

    if (['queued', 'running'].includes(status)) startDetailAutoRefresh(post.id);
    else stopDetailAutoRefresh();
}

function openDetail(id) {
    currentDetailId = id;
    const p = getPostById(id);
    if (!p) return;

    const tickers = p.tickers || [];
    const primary = tickers[0] || '';
    els.dContent.innerHTML = `
        <section class="detailSection">
            <div id="dMetaGrid" class="detailMetaGrid"></div>
            <div id="dProgressHost"></div>
        </section>
        <section class="detailSection">
            <div id="dTickerTabs" class="inline"></div>
            <div class="chartWrap">
                <div class="chartHead">
                    <div class="chartTitleBlock">
                        <div class="chartEyebrow">Market structure</div>
                        <div class="chartTitleRow"><strong>Price &amp; volume</strong> <span class="muted" id="cMeta"></span></div>
                        <div id="cCursorMeta" class="chartCursorMeta">Touch, drag, or hover the chart to inspect the active area.</div>
                    </div>
                    <div class="chartSettingsAnchor">
                        <button id="cSettingsBtn" class="chartSettingsBtn" type="button" aria-expanded="false" aria-controls="cSettingsPopover">⚙ Settings</button>
                        <div id="cSettingsPopover" class="chartSettingsPopover" role="menu" aria-hidden="true">
                            <div class="chartSettingsBody">
                                <div class="chartSettingsGroup">
                                    <span class="chartSettingsLabel">View</span>
                                    <div class="chartModeToggle" role="group" aria-label="Chart view">
                                        <button id="cModeCandles" class="ghost" type="button" data-chart-mode="candles">Candles</button>
                                        <button id="cModeLine" class="ghost" type="button" data-chart-mode="line">Line</button>
                                    </div>
                                </div>
                                <label class="chartSwitch">
                                    <input id="cShowVolume" type="checkbox" checked />
                                    <span>Show trading volume</span>
                                </label>
                                <div class="chartSettingsHint">Pinch or scroll to zoom. Drag to pan. Scroll over X/Y axis to zoom that axis only. Double-tap to reset view.</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="chartViewport" class="chartCanvasWrap" tabindex="0" role="group" aria-label="Interactive price chart">
                    <canvas id="chartCanvas"></canvas>
                </div>
                <div class="chartFooter">
                    <div class="chartFooterGroup footerControls">
                        <label class="chartSelect">
                            <span>Range</span>
                            <select id="cPeriod">
                                <option value="1wk">1W</option>
                                <option value="1mo">1M</option><option value="3mo">3M</option>
                                <option value="6mo" selected>6M</option><option value="1y">1Y</option>
                                <option value="2y">2Y</option><option value="5y">5Y</option>
                            </select>
                        </label>
                        <label class="chartSelect">
                            <span>Resolution</span>
                            <select id="cInterval">
                                <option value="1h">1H</option><option value="4h">4H</option>
                                <option value="1d" selected>1D</option><option value="1wk">1W</option><option value="1mo">1M</option>
                            </select>
                        </label>
                    </div>
                    <div class="chartFooterGroup chartActionGroup">
                        <button id="cLeft" class="ghost" type="button" title="Pan left">Pan Left</button>
                        <button id="cRight" class="ghost" type="button" title="Pan right">Pan Right</button>
                        <button id="cZoomIn" class="ghost" type="button" title="Zoom in">Zoom In</button>
                        <button id="cZoomOut" class="ghost" type="button" title="Zoom out">Zoom Out</button>
                        <button id="cResetView" class="ghost" type="button" title="Reset viewport">Reset View</button>
                    </div>
                </div>
            </div>
        </section>
        <section class="detailSection">
            <div class="rowgrid">
                <div>
                    <h3>Snapshot</h3>
                    <div id="dSnapshot"></div>
                </div>
                <div>
                    <h3>Summary</h3>
                    <pre id="dSummary" class="pre-card"></pre>
                </div>
            </div>
        </section>
        <section class="detailSection">
            <div class="inline" style="justify-content:space-between; width:100%; margin-bottom:10px; gap:8px;">
                <h3 style="margin:0">Report</h3>
                <div class="inline" style="gap:6px">
                    <button id="toggleMdBtn" class="ghost" title="Toggle report rendering">Show raw</button>
                    <button id="copyReportBtn" class="ghost" title="Copy report to clipboard">Copy</button>
                </div>
            </div>
            <div id="reportHost"></div>
        </section>
    `;

    const tabs = document.getElementById('dTickerTabs');
    tickers.forEach((ticker) => {
        const button = document.createElement('button');
        button.textContent = ticker;
        button.addEventListener('click', () => loadChartInto(ticker));
        tabs.appendChild(button);
    });

    const reportHost = document.getElementById('reportHost');
    if (reportHost) reportHost.__mode = reportHost.__mode || 'md';
    const copyBtn = document.getElementById('copyReportBtn');
    const toggleBtn = document.getElementById('toggleMdBtn');
    els.detailDlg.showModal();
    bindChartControls(primary);

    if (toggleBtn && reportHost) {
        toggleBtn.onclick = () => {
            reportHost.__mode = reportHost.__mode === 'md' ? 'raw' : 'md';
            toggleBtn.textContent = reportHost.__mode === 'md' ? 'Show raw' : 'Show markdown';
            renderReportInto(reportHost, currentReportText(getPostById(id)));
        };
    }

    if (copyBtn) {
        copyBtn.onclick = async () => {
            const text = currentReportText(getPostById(id));
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                copyBtn.textContent = 'Copied';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
            } catch {
                copyBtn.textContent = 'Copy failed';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
            }
        };
    }

    syncDetailPanels(p);
    loadChartInto(primary);
    window.currentDetailRefreshAnalyzeButton = () => renderAnalyzeButton(id);
    els.dAnalyze.onclick = async () => {
        const st = getStatusState(getPostById(id) || {});
        if (st === 'running' || st === 'queued') {
            try { await api(`/api/queue/stop/${encodeURIComponent(id)}`, { method: 'POST' }); } catch {}
        } else {
            try {
                await api(`/api/queue/${encodeURIComponent(id)}`, { method: 'POST' });
            } catch {}
        }
        await loadQueueStatus();
        renderAnalyzeButton(id);
        renderFeed();
        const fresh = await api(`/api/stocks/${encodeURIComponent(id)}`).catch(() => null);
        if (fresh) {
            upsertPost(fresh);
            syncDetailPanels(fresh);
        }
    };
    els.dEdit.onclick = () => openEdit(p);
    els.dDelete.onclick = () => removePost(id);
    els.dRefresh.onclick = () => refreshSnapshot(id, { force: true });

    // Immediately refresh current prices for this post without waiting for analysis
    refreshSnapshot(id, { force: true });

    // Proactively compute summary based on existing analysis (handles partial runs or prior state)
    api(`/api/summarize/${encodeURIComponent(id)}`).then((res) => {
        upsertPost(res);
        syncDetailPanels(res);
    }).catch(() => {});
}

// Refresh only the snapshot (current prices) for a post without running analysis
async function refreshSnapshot(id, opts = {}) {
    const force = !!opts.force;
    if (!force && REFRESHING.has(id)) return;
    const last = LAST_REFRESH.get(id) || 0;
    const now = Date.now();
    if (!force && now - last < 10000) return; // hard throttle 10s per post
    REFRESHING.add(id);
    try {
        const res = await api(`/api/refresh-snapshot/${encodeURIComponent(id)}`);
        upsertPost(res);
        LAST_REFRESH.set(id, now);
        renderFeed();
        if (currentDetailId === id) {
            syncDetailPanels(res);
        }
    } catch (e) {
        // ignore errors; transient network/yfinance issues
        console.warn('refreshSnapshot failed', e);
    } finally {
        REFRESHING.delete(id);
    }
}

function renderSnapshotTable(p) {
        if (!(p.tickers || []).length) {
                return '<div class="muted">No tickers configured yet.</div>';
        }
    const rows = [];
    const sn = p.snapshot || {};
    const purchases = p.purchases || {};
    (p.tickers || []).forEach(t => {
        const s = sn[t] || {};
        rows.push(`
      <tr>
                <td>${escapeHtml(t)}</td>
        <td style="text-align:right">${fmtMoney(purchases[t])}</td>
        <td style="text-align:right">${fmtMoney(s.current)}</td>
        <td style="text-align:right">${s.pct == null ? "" : fmtPct(s.pct)}</td>
                <td style="text-align:center"><span class="badge suggestion ${classBySuggestion(rowSuggestion(p, t))}">${escapeHtml(rowSuggestion(p, t))}</span></td>
      </tr>
    `);
    });
    return `
    <table class="table" style="margin-top:6px">
      <thead><tr><th>Ticker</th><th style="text-align:right">Purchase</th><th style="text-align:right">Current</th><th style="text-align:right">% Change</th><th>Suggestion</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

const CHART_PADDING = { left: 58, right: 16, top: 22, bottom: 32 };
// Minimum pixels-per-bar so individual candles stay readable.
const CHART_MIN_PX_PER_BAR = 3;
// Default pixels-per-bar when loading a fresh view.
const CHART_DEFAULT_PX_PER_BAR = 10;

function emptyChartSeries() {
    return { timestamps: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
}

function loadChartPrefs() {
    try {
        const raw = localStorage.getItem(CHART_PREFS_KEY);
        if (!raw) return { ...DEFAULT_CHART_PREFS };
        const parsed = JSON.parse(raw);
        return {
            mode: parsed?.mode === 'line' ? 'line' : 'candles',
            showVolume: parsed?.showVolume !== false,
        };
    } catch {
        return { ...DEFAULT_CHART_PREFS };
    }
}

function saveChartPrefs() {
    try {
        localStorage.setItem(CHART_PREFS_KEY, JSON.stringify(CHART_PREFS));
    } catch {}
}

function currentChartContext() {
    const ticker = window._activeTicker || '';
    const period = document.getElementById('cPeriod')?.value || '6mo';
    const interval = document.getElementById('cInterval')?.value || '1d';
    return {
        ticker,
        period,
        interval,
        key: chartStateKey(ticker, period, interval),
        canvas: document.getElementById('chartCanvas'),
        viewport: document.getElementById('chartViewport'),
    };
}

function chartStateKey(ticker, period, interval) {
    return `chartState:v2:${ticker}:${period}:${interval}`;
}

function chartDefaultWindow(total, interval) {
    const maxBars = interval === '1h' ? 96 : interval === '4h' ? 88 : interval === '1wk' ? 78 : 120;
    const windowSize = Math.max(20, Math.min(total, maxBars));
    return { start: Math.max(0, total - windowSize), end: total };
}

// ─── Pixel-based viewport helpers ────────────────────────────────────────────
// The chart viewport is defined by:
//   pxPerBar   – pixels (CSS) per bar (X-scale / zoom level)
//   offsetPx   – how many CSS pixels from bar-0 to the left edge of the plot area
//                (positive = bar-0 is to the left of the viewport)
//   priceMin   – minimum price shown at the bottom of the price pane (Y-scale)
//   priceMax   – maximum price shown at the top of the price pane (Y-scale)
//   yLocked    – true when Y-axis is auto-fitted to the visible bars
//
// This matches the mental model of panning/zooming a photo.

function defaultChartViewport(full, canvasCssW) {
    const total = full.closes.length;
    if (!total) return { pxPerBar: CHART_DEFAULT_PX_PER_BAR, offsetPx: 0, priceMin: 0, priceMax: 1, yLocked: true };
    const plotW = Math.max(1, canvasCssW - CHART_PADDING.left - CHART_PADDING.right);
    // Fit the default window (last N bars) into the visible plot width.
    const interval = document.getElementById('cInterval')?.value || '1d';
    const maxBars = interval === '1h' ? 96 : interval === '4h' ? 88 : interval === '1wk' ? 78 : 120;
    const defaultBars = Math.max(20, Math.min(total, maxBars));
    const pxPerBar = Math.max(CHART_MIN_PX_PER_BAR, plotW / defaultBars);
    // Right-align: bar-0 is at left of the full-data region, last bar is at the right edge.
    const totalPx = total * pxPerBar;
    const offsetPx = Math.max(0, totalPx - plotW);
    return { pxPerBar, offsetPx, priceMin: 0, priceMax: 1, yLocked: true };
}

function fitYToVisible(full, viewport, canvasCssW) {
    const { indexes } = visibleBarRange(full, viewport, canvasCssW);
    if (!indexes.length) return viewport;
    const candleMode = CHART_PREFS.mode === 'candles';
    let minP = Infinity, maxP = -Infinity;
    for (const i of indexes) {
        const lo = candleMode ? Number(full.lows[i]) : Number(full.closes[i]);
        const hi = candleMode ? Number(full.highs[i]) : Number(full.closes[i]);
        if (isFinite(lo)) minP = Math.min(minP, lo);
        if (isFinite(hi)) maxP = Math.max(maxP, hi);
    }
    if (!isFinite(minP) || !isFinite(maxP)) return viewport;
    const pad = Math.max((maxP - minP) * 0.08, maxP * 0.012, 0.5);
    return { ...viewport, priceMin: minP - pad, priceMax: maxP + pad };
}

// Returns the indices of bars that are (at least partially) visible.
function visibleBarRange(full, viewport, canvasCssW) {
    const total = full.closes.length;
    const plotW = Math.max(1, canvasCssW - CHART_PADDING.left - CHART_PADDING.right);
    const { pxPerBar, offsetPx } = viewport;
    const barStart = Math.max(0, Math.floor(offsetPx / pxPerBar));
    const barEnd = Math.min(total, Math.ceil((offsetPx + plotW) / pxPerBar) + 1);
    const indexes = [];
    for (let i = barStart; i < barEnd; i++) indexes.push(i);
    return { indexes, barStart, barEnd };
}

function loadChartStateFromLS(ticker, period, interval, total) {
    if (!total) return null;
    try {
        const raw = localStorage.getItem(chartStateKey(ticker, period, interval));
        if (!raw) return null;
        const s = JSON.parse(raw);
        // New pixel-viewport format
        if (s && typeof s.pxPerBar === 'number') {
            return { pxPerBar: s.pxPerBar, offsetPx: s.offsetPx ?? 0, yLocked: s.yLocked !== false };
        }
        // Legacy index-based format — translate to pixel viewport
        if (s && typeof s.start === 'number' && typeof s.end === 'number') {
            const winBars = Math.max(1, s.end - s.start);
            const pxPerBar = CHART_DEFAULT_PX_PER_BAR;
            const offsetPx = s.start * pxPerBar;
            return { pxPerBar, offsetPx, yLocked: true };
        }
        return null;
    } catch {
        return null;
    }
}

function saveChartStateToLS(ticker, period, interval, state) {
    try {
        localStorage.setItem(chartStateKey(ticker, period, interval), JSON.stringify({
            pxPerBar: state.pxPerBar,
            offsetPx: state.offsetPx,
            yLocked: state.yLocked,
        }));
    } catch {}
}

function getCurrentChartState() {
    const ctx = currentChartContext();
    return window.__chartStates?.get(ctx.key) || null;
}

function setCurrentChartState(nextState, opts = {}) {
    const ctx = currentChartContext();
    if (!ctx.ticker || !window.__chartStates) return;
    window.__chartStates.set(ctx.key, nextState);
    if (!opts.skipSave) saveChartStateToLS(ctx.ticker, ctx.period, ctx.interval, nextState);
    if (ctx.canvas) drawViewport(ctx.canvas, nextState);
}

function teardownActiveChartInteractions() {
    if (typeof ACTIVE_CHART_CLEANUP === 'function') {
        try { ACTIVE_CHART_CLEANUP(); } catch {}
    }
    ACTIVE_CHART_CLEANUP = null;
}

function syncChartSettingsUI() {
    document.querySelectorAll('[data-chart-mode]').forEach((button) => {
        const active = button.dataset.chartMode === CHART_PREFS.mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const volumeToggle = document.getElementById('cShowVolume');
    if (volumeToggle) volumeToggle.checked = !!CHART_PREFS.showVolume;
}

function redrawActiveChart() {
    const ctx = currentChartContext();
    const state = getCurrentChartState();
    if (!ctx.canvas) return;
    if (!state) {
        drawFinancialChart(ctx.canvas, emptyChartSeries(), CHART_PREFS, { hoverIdx: null });
        syncChartCursorMeta(emptyChartSeries(), null);
        return;
    }
    drawViewport(ctx.canvas, state);
}

function updateChartPrefs(patch = {}) {
    CHART_PREFS = {
        mode: patch.mode === 'line' ? 'line' : (patch.mode === 'candles' ? 'candles' : CHART_PREFS.mode || DEFAULT_CHART_PREFS.mode),
        showVolume: typeof patch.showVolume === 'boolean' ? patch.showVolume : CHART_PREFS.showVolume,
    };
    saveChartPrefs();
    syncChartSettingsUI();
    redrawActiveChart();
}

function bindChartControls(primary) {
    const chart = document.querySelector('.chartWrap');
    if (!chart) return;
    const periodSel = document.getElementById('cPeriod');
    const intervalSel = document.getElementById('cInterval');
    const volumeToggle = document.getElementById('cShowVolume');
    const viewport = document.getElementById('chartViewport');

    syncChartSettingsUI();

    periodSel?.addEventListener('change', () => loadChartInto(window._activeTicker || primary));
    intervalSel?.addEventListener('change', () => {
        const v = intervalSel.value;
        const p = periodSel?.value || '6mo';
        if ((v === '1h' || v === '4h') && (p === '2y' || p === '5y')) {
            periodSel.value = '1y';
        }
        loadChartInto(window._activeTicker || primary);
    });

    chart.querySelectorAll('[data-chart-mode]').forEach((button) => {
        button.addEventListener('click', () => updateChartPrefs({ mode: button.dataset.chartMode }));
    });

    volumeToggle?.addEventListener('change', () => updateChartPrefs({ showVolume: volumeToggle.checked }));

    document.getElementById('cLeft')?.addEventListener('click', () => panActiveChart(-60));
    document.getElementById('cRight')?.addEventListener('click', () => panActiveChart(60));
    document.getElementById('cZoomIn')?.addEventListener('click', () => zoomActiveChart(0.82, 0.5));
    document.getElementById('cZoomOut')?.addEventListener('click', () => zoomActiveChart(1.22, 0.5));
    document.getElementById('cResetView')?.addEventListener('click', resetActiveChartView);

    // Settings popover toggle.
    const settingsBtn = document.getElementById('cSettingsBtn');
    const settingsPopover = document.getElementById('cSettingsPopover');
    if (settingsBtn && settingsPopover) {
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = settingsPopover.classList.toggle('is-open');
            settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            settingsPopover.setAttribute('aria-hidden', open ? 'false' : 'true');
        });
        document.addEventListener('click', (e) => {
            if (!settingsBtn.contains(e.target) && !settingsPopover.contains(e.target)) {
                settingsPopover.classList.remove('is-open');
                settingsBtn.setAttribute('aria-expanded', 'false');
                settingsPopover.setAttribute('aria-hidden', 'true');
            }
        });
        settingsPopover.addEventListener('click', (e) => e.stopPropagation());
    }

    if (viewport?.focus) {
        requestAnimationFrame(() => {
            try { viewport.focus({ preventScroll: true }); } catch {}
        });
    }
}

function toChartDate(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return isNaN(parsed) ? null : new Date(parsed);
    }
    if (typeof value === 'number') {
        return value > 1e12 ? new Date(value) : new Date(value * 1000);
    }
    return null;
}

function formatChartAxisLabel(date, spanDays) {
    if (!date) return '';
    if (spanDays > 365) return `${date.getFullYear()}`;
    if (spanDays > 90) return `${date.toLocaleString(undefined, { month: 'short' })} ${String(date.getFullYear()).slice(-2)}`;
    if (spanDays > 2) return `${date.getMonth() + 1}/${date.getDate()}`;
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatChartCursorDate(date) {
    if (!date) return 'Unknown date';
    return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCompactVolume(value) {
    if (!isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return String(Math.round(value));
}

function chartPoint(series, idx) {
    const close = Number(series.closes?.[idx]);
    const open = Number.isFinite(Number(series.opens?.[idx])) ? Number(series.opens[idx]) : close;
    const high = Number.isFinite(Number(series.highs?.[idx])) ? Number(series.highs[idx]) : close;
    const low = Number.isFinite(Number(series.lows?.[idx])) ? Number(series.lows[idx]) : close;
    const volume = Number.isFinite(Number(series.volumes?.[idx])) ? Number(series.volumes[idx]) : 0;
    return { open, high, low, close, volume };
}

function syncChartCursorMeta(series, hoverIdx = null) {
    const host = document.getElementById('cCursorMeta');
    if (!host) return;
    const total = series.timestamps?.length || 0;
    if (!total || !(series.closes || []).length) {
        host.textContent = 'No market data available for this selection.';
        return;
    }
    const idx = hoverIdx == null ? total - 1 : clamp(hoverIdx, 0, total - 1);
    const point = chartPoint(series, idx);
    const date = formatChartCursorDate(toChartDate(series.timestamps[idx]));
    const volumeText = CHART_PREFS.showVolume ? ` | Vol ${formatCompactVolume(point.volume)}` : '';
    if (CHART_PREFS.mode === 'candles') {
        host.textContent = `${date} | O ${fmtMoney(point.open)} | H ${fmtMoney(point.high)} | L ${fmtMoney(point.low)} | C ${fmtMoney(point.close)}${volumeText}`;
    } else {
        host.textContent = `${date} | Close ${fmtMoney(point.close)}${volumeText}`;
    }
}

function chartClientFraction(canvas, clientX) {
    const rect = canvas.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - CHART_PADDING.left - CHART_PADDING.right);
    return clamp((clientX - rect.left - CHART_PADDING.left) / plotW, 0, 1);
}

// ─── Pixel-viewport pan / zoom / reset ───────────────────────────────────────

// Pan the chart by (deltaX, deltaY) CSS pixels.
// deltaX > 0  → content moves left (scroll toward future bars)
// deltaY > 0  → content moves down (unlocks Y and shifts prices up visually)
function panActiveChart(deltaX, deltaY = 0) {
    const state = getCurrentChartState();
    if (!state || !state.full?.closes?.length) return;
    const ctx = currentChartContext();
    const cssW = ctx.canvas?.clientWidth || 600;
    let { pxPerBar, offsetPx, priceMin, priceMax } = state;

    if (deltaX !== 0) {
        const totalPx = state.full.closes.length * pxPerBar;
        const plotW = Math.max(1, cssW - CHART_PADDING.left - CHART_PADDING.right);
        const minOffset = -pxPerBar * 0.5;
        const maxOffset = Math.max(minOffset, totalPx - plotW + pxPerBar * 0.5);
        offsetPx = clamp(offsetPx + deltaX, minOffset, maxOffset);
    }

    let yLocked = state.yLocked;
    if (deltaY !== 0) {
        const priceRange = Math.max(1e-9, priceMax - priceMin);
        const shift = (deltaY / Math.max(1, ctx.canvas?.clientHeight - CHART_PADDING.top - CHART_PADDING.bottom)) * priceRange;
        priceMin += shift;
        priceMax += shift;
        yLocked = false;
    }

    const next = { ...state, pxPerBar, offsetPx, priceMin, priceMax, yLocked };
    const final = yLocked ? fitYToVisible(state.full, next, cssW) : next;
    setCurrentChartState({ ...final, hoverIdx: state.hoverIdx });
}

// Zoom the chart around an anchor point.
// xFactor < 1 → zoom in (more detail), xFactor > 1 → zoom out (fewer bars visible)
// anchorFrac  – fraction of the plot width where the zoom is anchored (0..1)
// yFactor     – analogous for price axis; if null, Y stays locked to fit
// anchorPriceFrac – fraction of price pane height (0..1, 0=top) for Y anchor
function zoomActiveChart(xFactor, anchorFrac = 0.5, yFactor = null, anchorPriceFrac = null) {
    const state = getCurrentChartState();
    if (!state || !state.full?.closes?.length) return;
    const ctx = currentChartContext();
    const cssW = ctx.canvas?.clientWidth || 600;
    const plotW = Math.max(1, cssW - CHART_PADDING.left - CHART_PADDING.right);

    let { pxPerBar, offsetPx, priceMin, priceMax } = state;

    if (xFactor != null && xFactor !== 1) {
        // Record which data-pixel is currently under the cursor (in the old coordinate system).
        const anchorDataPx = offsetPx + anchorFrac * plotW;

        // Apply the new scale.
        const newPxPerBar = clamp(pxPerBar * (1 / xFactor), CHART_MIN_PX_PER_BAR, CHART_MAX_PX_PER_BAR);
        const scale = newPxPerBar / pxPerBar;
        pxPerBar = newPxPerBar;

        // The same data-pixel is now at anchorDataPx * scale in the new coordinate system.
        // To keep it under the cursor at anchorFrac * plotW, set offsetPx accordingly.
        const idealOffsetPx = anchorDataPx * scale - anchorFrac * plotW;

        // Soft-clamp: allow a half-bar's worth of overshoot at each edge so the
        // anchor is never forcibly displaced by boundary clamping during zoom.
        const totalPx = state.full.closes.length * pxPerBar;
        const minOffset = -pxPerBar * 0.5;
        const maxOffset = Math.max(minOffset, totalPx - plotW + pxPerBar * 0.5);
        offsetPx = clamp(idealOffsetPx, minOffset, maxOffset);
    }

    let yLocked = state.yLocked;
    if (yFactor != null && yFactor !== 1 && anchorPriceFrac != null) {
        // When Y was auto-fitted, state.priceMin/priceMax are placeholder 0/1 values —
        // get the actual displayed range first by fitting against the new X viewport.
        if (yLocked) {
            const fitted = fitYToVisible(state.full, { ...state, pxPerBar, offsetPx }, cssW);
            priceMin = fitted.priceMin;
            priceMax = fitted.priceMax;
        }
        const priceRange = Math.max(1e-9, priceMax - priceMin);
        const anchorPrice = priceMax - anchorPriceFrac * priceRange; // price under the cursor
        const newRange = priceRange * yFactor;
        priceMin = anchorPrice - (1 - anchorPriceFrac) * newRange;
        priceMax = anchorPrice + anchorPriceFrac * newRange;
        yLocked = false;
    }

    const next = { ...state, pxPerBar, offsetPx, priceMin, priceMax, yLocked };
    const final = yLocked ? fitYToVisible(state.full, next, cssW) : next;
    setCurrentChartState({ ...final, hoverIdx: null });
}

function resetActiveChartView() {
    const state = getCurrentChartState();
    if (!state) return;
    const ctx = currentChartContext();
    const cssW = ctx.canvas?.clientWidth || 600;
    const fresh = defaultChartViewport(state.full, cssW);
    const fitted = fitYToVisible(state.full, fresh, cssW);
    setCurrentChartState({ ...state, ...fitted, yLocked: true, hoverIdx: null });
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

// Chart color palette — matches the page's warm cream theme.
const CHART_COLORS = {
    bg:           'rgba(243, 238, 225, 0.97)',   // --bg cream
    paneGrad0:    'rgba(22, 93, 255, 0.04)',       // very faint blue tint at top
    paneGrad1:    'rgba(22, 93, 255, 0)',
    grid:         'rgba(20, 32, 50, 0.09)',
    axisLabel:    '#7a8595',                       // --muted lighter
    noData:       '#a0a8b4',
    up:           '#177245',                       // --buy green
    down:         '#b54753',                       // --sell red
    upFill:       'rgba(23, 114, 69, 0.18)',
    downFill:     'rgba(181, 71, 83, 0.18)',
    line:         '#165dff',                       // --accent
    lineArea0:    'rgba(22, 93, 255, 0.15)',
    lineArea1:    'rgba(22, 93, 255, 0.0)',
    volUp:        'rgba(23, 114, 69, 0.32)',
    volDown:      'rgba(181, 71, 83, 0.32)',
    crosshair:    'rgba(22, 93, 255, 0.55)',
    crosshairDot: '#165dff',
    priceBubbleBg:'rgba(22, 93, 255, 0.12)',
    priceBubbleTx:'#165dff',
};

// Maximum pixels per bar to prevent extreme zoom-in.
const CHART_MAX_PX_PER_BAR = 120;

// drawFinancialChart renders the chart using the pixel-viewport state model.
// series must be { timestamps, opens, highs, lows, closes, volumes }.
// viewport: { pxPerBar, offsetPx, priceMin, priceMax } — describes what portion to draw.
// opts: { hoverIdx }
function drawFinancialChart(canvas, series, prefs, opts = {}) {
    const timestamps = series.timestamps || [];
    const closes = series.closes || [];
    const opens = series.opens || closes;
    const highs = series.highs || closes;
    const lows = series.lows || closes;
    const volumes = series.volumes || [];
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    const cssW = canvas.clientWidth || canvas.offsetWidth || 320;
    const cssH = canvas.clientHeight || 320;
    const w = canvas.width = Math.max(220, cssW) * dpr;
    const h = canvas.height = Math.max(220, cssH) * dpr;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = CHART_COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!timestamps.length || !closes.length) {
        ctx.fillStyle = CHART_COLORS.noData;
        ctx.font = `${12 * dpr}px system-ui,sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('No market data', 16 * dpr, 24 * dpr);
        return;
    }

    const padL = CHART_PADDING.left * dpr;
    const padR = CHART_PADDING.right * dpr;
    const padT = CHART_PADDING.top * dpr;
    const padB = CHART_PADDING.bottom * dpr;
    const plotW = Math.max(1, w - padL - padR);
    const plotH = Math.max(1, h - padT - padB);
    const showVolume = prefs.showVolume && volumes.some((value) => Number(value) > 0);
    const volumeGap = showVolume ? 12 * dpr : 0;
    const pricePaneH = showVolume ? Math.round(plotH * 0.72) : plotH;
    const volumePaneTop = padT + pricePaneH + volumeGap;
    const volumePaneH = showVolume ? Math.max(18 * dpr, plotH - pricePaneH - volumeGap) : 0;
    const candleMode = prefs.mode === 'candles' && opens.length === closes.length;

    // ── Viewport state: use opts.viewport if provided, otherwise fit all data.
    const vp = opts.viewport;
    let priceMin, priceMax, pxPerBar, offsetPx;
    if (vp) {
        priceMin  = vp.priceMin;
        priceMax  = vp.priceMax;
        pxPerBar  = Math.max(CHART_MIN_PX_PER_BAR, vp.pxPerBar || CHART_DEFAULT_PX_PER_BAR) * dpr;
        offsetPx  = (vp.offsetPx || 0) * dpr;
    } else {
        // Fallback: fit all visible bars.
        const L = candleMode ? lows : closes;
        const H = candleMode ? highs : closes;
        priceMin = Math.min(...L.map(Number));
        priceMax = Math.max(...H.map(Number));
        const pad = Math.max((priceMax - priceMin) * 0.08, priceMax * 0.012, 0.5);
        priceMin -= pad; priceMax += pad;
        pxPerBar = Math.max(CHART_MIN_PX_PER_BAR * dpr, plotW / Math.max(1, timestamps.length));
        offsetPx = 0;
    }

    const paddedRange = Math.max(1e-9, priceMax - priceMin);

    // Coordinate helpers using pixel viewport model.
    // Bar i has its center at: padL + (i * pxPerBar + pxPerBar/2) - offsetPx
    const barCenterX = (i) => padL + (i * pxPerBar + pxPerBar * 0.5) - offsetPx;
    const scalePriceY = (value) => padT + pricePaneH * (1 - (Number(value) - priceMin) / paddedRange);

    // Determine which bars are visible.
    const barCount = timestamps.length;
    const barStart = Math.max(0, Math.floor(offsetPx / pxPerBar) - 1);
    const barEnd = Math.min(barCount, Math.ceil((offsetPx + plotW) / pxPerBar) + 2);

    // ── Background pane + no-data gutter shading ─────────────────────────────
    const bg = ctx.createLinearGradient(0, padT, 0, padT + pricePaneH);
    bg.addColorStop(0, CHART_COLORS.paneGrad0);
    bg.addColorStop(1, CHART_COLORS.paneGrad1);
    ctx.fillStyle = bg;
    ctx.fillRect(padL, padT, plotW, pricePaneH);

    // Shade the empty gutter regions (before first bar / after last bar) when
    // the user has panned or zoomed past the data boundaries.
    const dataLeft  = padL - offsetPx;                     // x of bar-0 left edge
    const dataRight = padL + barCount * pxPerBar - offsetPx; // x of last bar right edge
    const gutterH   = pricePaneH + volumePaneH + volumeGap;
    ctx.fillStyle   = 'rgba(20, 32, 50, 0.055)';
    if (dataLeft > padL) {
        ctx.fillRect(padL, padT, Math.min(dataLeft - padL, plotW), gutterH);
    }
    if (dataRight < padL + plotW) {
        const gutterX = Math.max(padL, dataRight);
        ctx.fillRect(gutterX, padT, padL + plotW - gutterX, gutterH);
    }

    // ── Grid lines ────────────────────────────────────────────────────────────
    // Price grid: evenly spaced horizontal lines.
    const hLines = 4;
    // Time grid: spaced by natural time boundaries for readability.
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (let i = 0; i <= hLines; i++) {
        const y = padT + pricePaneH * i / hLines;
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
    }
    // Vertical grid based on visible bars.
    const vLineCount = cssW < 400 ? 3 : cssW < 700 ? 4 : 6;
    const vStep = Math.max(1, Math.round((barEnd - barStart) / vLineCount));
    for (let i = barStart; i <= barEnd; i += vStep) {
        const x = barCenterX(i);
        if (x < padL || x > padL + plotW) continue;
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + pricePaneH + volumePaneH + volumeGap);
    }
    ctx.stroke();

    // ── Price axis labels ─────────────────────────────────────────────────────
    ctx.fillStyle = CHART_COLORS.axisLabel;
    ctx.font = `${11 * dpr}px system-ui,sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= hLines; i++) {
        const price = priceMax - (paddedRange * i / hLines);
        const y = padT + pricePaneH * i / hLines;
        ctx.fillText(fmtMoney(price), padL - 6 * dpr, y);
    }

    // ── Volume pane separator label ───────────────────────────────────────────
    if (showVolume) {
        const maxVol = Math.max(...volumes.map(Number), 1);
        ctx.strokeStyle = CHART_COLORS.grid;
        ctx.beginPath();
        ctx.moveTo(padL, volumePaneTop - volumeGap / 2);
        ctx.lineTo(padL + plotW, volumePaneTop - volumeGap / 2);
        ctx.stroke();
        ctx.fillStyle = CHART_COLORS.axisLabel;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(`Vol ${formatCompactVolume(maxVol)}`, padL + 2 * dpr, volumePaneTop);
    }

    // ── Candle / line drawing ─────────────────────────────────────────────────
    const maxVolume = showVolume ? Math.max(...volumes.map(Number), 1) : 1;

    if (candleMode) {
        // Body width is proportional to pxPerBar but clamped.
        const bodyW = clamp(pxPerBar * 0.64, 2 * dpr, 20 * dpr);

        for (let i = barStart; i < barEnd; i++) {
            const x = barCenterX(i);
            if (x < padL - pxPerBar || x > padL + plotW + pxPerBar) continue;
            const o = Number(opens[i] ?? closes[i]);
            const h_ = Number(highs[i] ?? closes[i]);
            const l_ = Number(lows[i] ?? closes[i]);
            const c = Number(closes[i]);
            const rising = c >= o;
            const color = rising ? CHART_COLORS.up : CHART_COLORS.down;
            const fillColor = rising ? CHART_COLORS.upFill : CHART_COLORS.downFill;
            const wickTop = scalePriceY(h_);
            const wickBot = scalePriceY(l_);
            const bodyTop = scalePriceY(Math.max(o, c));
            const bodyBot = scalePriceY(Math.min(o, c));
            const bodyH = Math.max(1.5 * dpr, bodyBot - bodyTop);

            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, 1.5 * dpr);
            ctx.beginPath();
            ctx.moveTo(x, wickTop);
            ctx.lineTo(x, wickBot);
            ctx.stroke();

            ctx.fillStyle = fillColor;
            ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, 1.2 * dpr);
            ctx.strokeRect(x - bodyW / 2, bodyTop, bodyW, bodyH);
        }
    } else {
        // Line chart with area fill.
        const lineGrad = ctx.createLinearGradient(0, padT, 0, padT + pricePaneH);
        lineGrad.addColorStop(0, CHART_COLORS.lineArea0);
        lineGrad.addColorStop(1, CHART_COLORS.lineArea1);

        // Area fill.
        ctx.beginPath();
        let started = false;
        for (let i = barStart; i < barEnd; i++) {
            const x = barCenterX(i);
            const y = scalePriceY(closes[i]);
            if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        if (started) {
            const lastX = barCenterX(barEnd - 1);
            const firstX = barCenterX(barStart);
            ctx.lineTo(lastX, padT + pricePaneH);
            ctx.lineTo(firstX, padT + pricePaneH);
            ctx.closePath();
            ctx.fillStyle = lineGrad;
            ctx.fill();
        }

        // Line stroke.
        ctx.beginPath();
        started = false;
        for (let i = barStart; i < barEnd; i++) {
            const x = barCenterX(i);
            const y = scalePriceY(closes[i]);
            if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
        }
        ctx.strokeStyle = CHART_COLORS.line;
        ctx.lineWidth = 2 * dpr;
        ctx.lineJoin = 'round';
        ctx.stroke();
    }

    // ── Volume bars ───────────────────────────────────────────────────────────
    if (showVolume) {
        const barW = clamp(pxPerBar * 0.6, 2 * dpr, 14 * dpr);
        for (let i = barStart; i < barEnd; i++) {
            const x = barCenterX(i);
            if (x < padL - pxPerBar || x > padL + plotW + pxPerBar) continue;
            const vol = Number(volumes[i]);
            if (!isFinite(vol) || vol <= 0) continue;
            const barH = Math.max(1.5 * dpr, (vol / maxVolume) * volumePaneH);
            const y = volumePaneTop + volumePaneH - barH;
            const rising = Number(closes[i]) >= Number(opens[i] ?? closes[i]);
            ctx.fillStyle = rising ? CHART_COLORS.volUp : CHART_COLORS.volDown;
            ctx.fillRect(x - barW / 2, y, barW, barH);
        }
    }

    // ── Time axis labels ──────────────────────────────────────────────────────
    ctx.fillStyle = CHART_COLORS.axisLabel;
    ctx.font = `${11 * dpr}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const firstDate = toChartDate(timestamps[0]);
    const lastDate = toChartDate(timestamps[barCount - 1]);
    const spanDays = firstDate && lastDate ? Math.max(1, Math.round((lastDate - firstDate) / 86400000)) : 30;
    let lastLabelX = -9999;
    for (let i = barStart; i < barEnd; i += vStep) {
        const x = barCenterX(i);
        if (x < padL || x > padL + plotW) continue;
        if (x - lastLabelX < 48 * dpr) continue;
        const label = formatChartAxisLabel(toChartDate(timestamps[i]), spanDays);
        if (label) {
            ctx.fillText(label, x, padT + pricePaneH + volumePaneH + volumeGap + 4 * dpr);
            lastLabelX = x;
        }
    }

    // ── Hover crosshair ───────────────────────────────────────────────────────
    const hoverIdx = opts.hoverIdx;
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < barCount) {
        const x = barCenterX(hoverIdx);
        const price = Number(closes[hoverIdx]);
        const markerY = scalePriceY(price);

        ctx.strokeStyle = CHART_COLORS.crosshair;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + pricePaneH + volumePaneH + volumeGap);
        ctx.stroke();
        ctx.setLineDash([]);

        // Horizontal price line.
        ctx.strokeStyle = CHART_COLORS.crosshair;
        ctx.lineWidth = 1 * dpr;
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(padL, markerY);
        ctx.lineTo(padL + plotW, markerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label on Y axis.
        const priceLabelW = (padL - 4 * dpr);
        const priceLabelH = 18 * dpr;
        ctx.fillStyle = CHART_COLORS.priceBubbleBg;
        ctx.beginPath();
        ctx.roundRect(2 * dpr, markerY - priceLabelH / 2, priceLabelW - 2 * dpr, priceLabelH, 3 * dpr);
        ctx.fill();
        ctx.fillStyle = CHART_COLORS.priceBubbleTx;
        ctx.font = `bold ${11 * dpr}px system-ui,sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(fmtMoney(price), padL - 8 * dpr, markerY);

        // Dot on the line / close.
        ctx.fillStyle = CHART_COLORS.crosshairDot;
        ctx.beginPath();
        ctx.arc(x, markerY, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = CHART_COLORS.bg;
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
    }
}

async function loadChartInto(ticker) {
    window._activeTicker = ticker;
    const chartHost = document.querySelector('.chartWrap');
    if (!chartHost) return;
    const period = document.getElementById('cPeriod')?.value || '6mo';
    const interval = document.getElementById('cInterval')?.value || '1d';
    const canvas = document.getElementById('chartCanvas');
    const cursorMeta = document.getElementById('cCursorMeta');
    updateChartMeta(ticker);
    if (cursorMeta) cursorMeta.textContent = 'Loading market data...';
    try {
        // Fetch chart data. yfinance can emit NaN for partial/current bars which is not
        // valid JSON. Parse as text first and replace bare NaN tokens with null.
        const chartUrl = `${API_BASE}/api/chart?ticker=${encodeURIComponent(ticker)}&period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`;
        const resp = await fetch(chartUrl);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const text = await resp.text();
        const raw = JSON.parse(text.replace(/\bNaN\b/g, 'null'));

        // Build aligned, clean OHLCV arrays – drop any bar where Close is null/non-finite.
        const rawCloses = raw.closes || [];
        const validIdx = rawCloses.reduce((acc, c, i) => {
            if (c !== null && isFinite(c)) acc.push(i);
            return acc;
        }, []);
        const full = {
            timestamps: validIdx.map(i => raw.timestamps?.[i] ?? 0),
            opens: validIdx.map(i => { const v = raw.opens?.[i]; return (v !== null && isFinite(v)) ? v : rawCloses[i]; }),
            highs: validIdx.map(i => { const v = raw.highs?.[i]; return (v !== null && isFinite(v)) ? v : rawCloses[i]; }),
            lows: validIdx.map(i => { const v = raw.lows?.[i]; return (v !== null && isFinite(v)) ? v : rawCloses[i]; }),
            closes: validIdx.map(i => rawCloses[i]),
            volumes: validIdx.map(i => { const v = raw.volumes?.[i]; return (v !== null && isFinite(v)) ? v : 0; }),
        };

        if (!window.__chartStates) window.__chartStates = new Map();
        const total = full.closes.length;
        const cssW = canvas?.clientWidth || 600;
        // Build pixel-viewport state.
        const vp = defaultChartViewport(full, cssW);
        const persisted = loadChartStateFromLS(ticker, period, interval, total);
        const startVp = persisted
            ? { pxPerBar: persisted.pxPerBar, offsetPx: persisted.offsetPx, yLocked: persisted.yLocked !== false }
            : vp;
        const fitted = fitYToVisible(full, startVp, cssW);
        const state = { ...fitted, full, hoverIdx: null };
        window.__chartStates.set(chartStateKey(ticker, period, interval), state);
        drawViewport(canvas, state);
    } catch (err) {
        console.error('[chart] loadChartInto failed:', err);
        const empty = emptyChartSeries();
        if (canvas) try { drawFinancialChart(canvas, empty, CHART_PREFS, { hoverIdx: null }); } catch {}
        syncChartCursorMeta(empty, null);
    }
    // Always wire interactions so wheel/touch/keyboard work even if the first draw failed.
    initChartInteractions(canvas);
}

function updateChartMeta(ticker) {
    const meta = document.getElementById('cMeta');
    if (!meta) return;
    const period = document.getElementById('cPeriod')?.value || '6mo';
    const interval = document.getElementById('cInterval')?.value || '1d';
    const p = POSTS.find((item) => item.id === currentDetailId);
    const cur = p?.snapshot?.[ticker]?.current;
    const pricePart = typeof cur === 'number' && isFinite(cur) ? ` ${fmtMoney(cur)}` : '';
    meta.textContent = `${ticker}${pricePart} | ${period}/${interval}`;
}

function drawViewport(canvas, state) {
    // Pass the full series + the current viewport parameters to drawFinancialChart.
    const full = state.full || emptyChartSeries();
    const hoverIdx = full.closes.length
        ? (state.hoverIdx == null ? null : clamp(state.hoverIdx, 0, full.closes.length - 1))
        : null;
    const vp = { pxPerBar: state.pxPerBar, offsetPx: state.offsetPx, priceMin: state.priceMin, priceMax: state.priceMax };
    // Auto-fit Y if yLocked.
    const finalState = state.yLocked ? fitYToVisible(full, state, canvas?.clientWidth || 600) : state;
    const finalVp = { pxPerBar: finalState.pxPerBar, offsetPx: finalState.offsetPx, priceMin: finalState.priceMin, priceMax: finalState.priceMax };
    drawFinancialChart(canvas, full, CHART_PREFS, { hoverIdx, viewport: finalVp });
    // Sync cursor meta for the hovered bar.
    const { indexes } = visibleBarRange(full, finalState, canvas?.clientWidth || 600);
    const syncIdx = hoverIdx != null ? hoverIdx : (indexes.length ? indexes[indexes.length - 1] : null);
    const viewForMeta = full;
    syncChartCursorMeta(viewForMeta, syncIdx);
}

function initChartInteractions(canvas) {
    teardownActiveChartInteractions();
    const viewport = document.getElementById('chartViewport');
    if (!canvas || !viewport) return;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = controller?.signal;
    const on = (target, event, handler, options = undefined) => {
        target.addEventListener(event, handler, signal ? { ...(options || {}), signal } : options);
    };

    let dragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let touchMode = null;
    let touchLastX = 0;
    let touchLastY = 0;
    let pinchStartDistance = 0;
    let pinchStartState = null;
    let lastTap = null;
    let movedTouch = false;

    // ─── Hover: map client-X to bar index in the full series ─────────────────
    const setHoverFromClient = (clientX, clientY) => {
        const state = getCurrentChartState();
        if (!state || !state.full?.closes?.length) return;
        const rect = canvas.getBoundingClientRect();
        const plotStartX = rect.left + CHART_PADDING.left;
        const relX = clientX - plotStartX;               // CSS px from plot edge
        const barIdx = Math.round((relX + state.offsetPx) / state.pxPerBar - 0.5);
        const clamped = clamp(barIdx, 0, state.full.closes.length - 1);
        if (state.hoverIdx !== clamped) {
            setCurrentChartState({ ...state, hoverIdx: clamped }, { skipSave: true });
        }
    };

    const clearHover = () => {
        const state = getCurrentChartState();
        if (!state || state.hoverIdx == null) return;
        setCurrentChartState({ ...state, hoverIdx: null }, { skipSave: true });
    };

    const touchDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    // ─── Mouse drag pan ───────────────────────────────────────────────────────
    on(viewport, 'mousedown', (event) => {
        if (event.button !== 0) return;
        dragging = true;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        viewport.focus({ preventScroll: true });
        setHoverFromClient(event.clientX, event.clientY);
    });

    on(window, 'mousemove', (event) => {
        if (!dragging) {
            if (viewport.matches(':hover')) setHoverFromClient(event.clientX, event.clientY);
            return;
        }
        const dx = event.clientX - lastMouseX;
        const dy = event.clientY - lastMouseY;
        lastMouseX = event.clientX;
        lastMouseY = event.clientY;
        panActiveChart(-dx, dy);  // -dx: drag right = scroll older bars into view
        setHoverFromClient(event.clientX, event.clientY);
    });

    on(window, 'mouseup', () => { dragging = false; });
    on(viewport, 'mouseleave', () => { if (!dragging) clearHover(); });

    // ─── Wheel: zoom both axes anchored to cursor ─────────────────────────────
    // Pure horizontal trackpad swipe (|dx| >> |dy|) → pan X only.
    // Everything else → zoom both X and Y, keeping the data coordinate under
    // the cursor fixed. The gutter areas (Y-axis labels, X-axis labels) don't
    // trigger axis-only behaviour; they just look slightly darker to signal
    // the no-data region.
    on(viewport, 'wheel', (event) => {
        event.preventDefault();
        const state = getCurrentChartState();
        if (!state) return;

        const rect = canvas.getBoundingClientRect();
        const relX = event.clientX - rect.left;
        const relY = event.clientY - rect.top;
        const plotStartX = CHART_PADDING.left;
        const plotEndX = rect.width - CHART_PADDING.right;
        const plotStartY = CHART_PADDING.top;
        const plotEndY = rect.height - CHART_PADDING.bottom;
        const plotW = Math.max(1, plotEndX - plotStartX);
        const plotH = Math.max(1, plotEndY - plotStartY);

        let dy = event.deltaY;
        let dx = event.deltaX;
        if (event.deltaMode === 1) { dy *= 30; dx *= 30; }
        else if (event.deltaMode === 2) { dy *= 300; dx *= 300; }

        if (Math.abs(dx) > Math.abs(dy) * 3) {
            // Horizontal trackpad swipe → pan X.
            panActiveChart(dx);
        } else {
            // Zoom both axes, anchored to the exact cursor position.
            const anchorFrac = clamp((relX - plotStartX) / plotW, 0, 1);
            // anchorPriceFrac must be relative to the price pane height (72% of
            // plotH when volume is visible), not the full plot height, so the
            // price coordinate stays pinned under the cursor.
            const showVol = CHART_PREFS.showVolume && state.full?.volumes?.some(v => Number(v) > 0);
            const pricePaneRatio = showVol ? 0.72 : 1.0;
            const anchorPriceFrac = clamp((relY - plotStartY) / (plotH * pricePaneRatio), 0, 1);
            const factor = dy > 0 ? 1.15 : 0.87;
            zoomActiveChart(factor, anchorFrac, factor, anchorPriceFrac);
        }
        setHoverFromClient(event.clientX, event.clientY);
    }, { passive: false });

    on(viewport, 'dblclick', () => resetActiveChartView());

    // ─── Touch: pan (1 finger) and pinch-zoom (2 fingers) ────────────────────
    on(viewport, 'touchstart', (event) => {
        viewport.focus({ preventScroll: true });
        movedTouch = false;
        if (event.touches.length === 1) {
            touchMode = 'pan';
            touchLastX = event.touches[0].clientX;
            touchLastY = event.touches[0].clientY;
            pinchStartState = null;
            setHoverFromClient(touchLastX, touchLastY);
        } else if (event.touches.length === 2) {
            const state = getCurrentChartState();
            if (!state) return;
            touchMode = 'pinch';
            pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
            pinchStartState = { pxPerBar: state.pxPerBar, offsetPx: state.offsetPx };
        }
        event.preventDefault();
    }, { passive: false });

    on(viewport, 'touchmove', (event) => {
        const state = getCurrentChartState();
        if (!state) return;
        if (event.touches.length === 2 && touchMode === 'pinch') {
            movedTouch = true;
            const dist = Math.max(1, touchDistance(event.touches[0], event.touches[1]));
            const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
            const rect = canvas.getBoundingClientRect();
            const anchorFrac = clamp((midX - rect.left - CHART_PADDING.left) / Math.max(1, rect.width - CHART_PADDING.left - CHART_PADDING.right), 0, 1);
            // pinch-in = zoom in: dist > pinchStartDistance → xFactor < 1.
            const xFactor = pinchStartDistance / dist;
            const plotW = Math.max(1, rect.width - CHART_PADDING.left - CHART_PADDING.right);
            const base = pinchStartState || state;
            const anchorDataPx = base.offsetPx + anchorFrac * plotW;
            const newPxPerBar = clamp(base.pxPerBar / xFactor, CHART_MIN_PX_PER_BAR, CHART_MAX_PX_PER_BAR);
            const scale = newPxPerBar / base.pxPerBar;
            const totalPx = state.full.closes.length * newPxPerBar;
            const newOffsetPx = clamp(anchorDataPx * scale - anchorFrac * plotW, 0, Math.max(0, totalPx - plotW));
            const next = { ...state, pxPerBar: newPxPerBar, offsetPx: newOffsetPx, yLocked: state.yLocked };
            const final = state.yLocked ? fitYToVisible(state.full, next, rect.width) : next;
            setCurrentChartState({ ...final, hoverIdx: null }, { skipSave: true });
        } else if (event.touches.length === 1 && touchMode === 'pan') {
            const touch = event.touches[0];
            const dx = touch.clientX - touchLastX;
            const dy = touch.clientY - touchLastY;
            touchLastX = touch.clientX;
            touchLastY = touch.clientY;
            movedTouch = movedTouch || (Math.hypot(dx, dy) > 3);
            panActiveChart(-dx, dy);
            setHoverFromClient(touch.clientX, touch.clientY);
        }
        event.preventDefault();
    }, { passive: false });

    on(viewport, 'touchend', (event) => {
        if (event.touches.length > 0) return;
        if (!movedTouch && event.changedTouches.length === 1) {
            const touch = event.changedTouches[0];
            const now = Date.now();
            if (lastTap && (now - lastTap.time) < 320 && Math.abs(lastTap.x - touch.clientX) < 18) {
                lastTap = null;
                resetActiveChartView();
            } else {
                setHoverFromClient(touch.clientX, touch.clientY);
                lastTap = { time: now, x: touch.clientX };
            }
        }
        touchMode = null;
        pinchStartState = null;
        movedTouch = false;
    });

    // ─── Keyboard ─────────────────────────────────────────────────────────────
    on(viewport, 'keydown', (event) => {
        if (!getCurrentChartState()) return;
        switch (event.key) {
            case 'ArrowLeft':  event.preventDefault(); panActiveChart(-30); break;
            case 'ArrowRight': event.preventDefault(); panActiveChart(30);  break;
            case 'ArrowUp': case '+': case '=': event.preventDefault(); zoomActiveChart(0.84); break;
            case 'ArrowDown': case '-': case '_': event.preventDefault(); zoomActiveChart(1.18); break;
            case '0': case 'Home': event.preventDefault(); resetActiveChartView(); break;
        }
    });

    // ─── Resize ───────────────────────────────────────────────────────────────
    let resizeTimer = 0;
    on(window, 'resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => redrawActiveChart(), 90);
    });

    ACTIVE_CHART_CLEANUP = () => {
        clearTimeout(resizeTimer);
        if (controller) controller.abort();
        dragging = false;
        touchMode = null;
        pinchStartState = null;
    };
}

async function queueAllWatchlists() {
    const buttons = [els.runAllBtn, els.heroRunBtn].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    try {
        await api('/api/analyze-all', { method: 'POST' });
        await loadPosts();
        showToast('Queued all ready watchlists.');
    } finally {
        buttons.forEach((button) => { button.disabled = false; });
    }
}

async function refreshAllSnapshots() {
    if (els.refreshPricesBtn) els.refreshPricesBtn.disabled = true;
    try {
        await api('/api/refresh-snapshots', { method: 'POST' });
        await loadPosts();
        if (currentDetailId) {
            const fresh = await api(`/api/stocks/${encodeURIComponent(currentDetailId)}`).catch(() => null);
            if (fresh) {
                upsertPost(fresh);
                syncDetailPanels(fresh);
            }
        }
        showToast('Prices refreshed.');
    } finally {
        if (els.refreshPricesBtn) els.refreshPricesBtn.disabled = false;
    }
}

// --- events
document.getElementById("cancelDlg").addEventListener("click", () => els.postDlg.close());
document.getElementById("saveDlg").addEventListener("click", savePost);
document.getElementById("dClose").addEventListener("click", () => els.detailDlg.close());
els.postDlg.addEventListener('close', () => { els.saveDlg.disabled = false; });
// Stop any active stream when dialog closes
els.detailDlg.addEventListener('close', () => {
    if (currentDetailId) stopAnalysisStream(currentDetailId);
    stopDetailAutoRefresh();
    teardownActiveChartInteractions();
    currentDetailId = null;
    // Clean up global function reference
    window.currentDetailRefreshAnalyzeButton = null;
});
els.heroRunBtn?.addEventListener('click', queueAllWatchlists);
els.heroDismissBtn?.addEventListener('click', () => {
    setHeroDismissed(true);
    showToast('Intro hidden. Use "Show Intro" if you want it back.');
});
els.heroToggleBtn?.addEventListener('click', () => {
    setHeroDismissed(false);
    els.heroSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
els.resetOrderBtn?.addEventListener('click', () => {
    HAS_CUSTOM_ORDER = false;
    try { localStorage.removeItem('feed:customOrder'); } catch {}
    POSTS = POSTS.slice().sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    renderFeed();
    showToast('Order reset');
});
els.searchBox.addEventListener("input", renderFeed);
els.heroAddBtn?.addEventListener('click', openNew);
document.querySelectorAll('input[name="analysisPreset"]').forEach((input) => {
    input.addEventListener('change', () => setPresetOnForm(input.value, true));
});

// --- boot
(async function init() {
    applyHeroVisibility();
    syncWatchlistPanelActions();
    bindFabDock();
    try { await loadConfig(); } catch { /* non-fatal */ }
    setFormFromOptions(APP_CONFIG.defaultOptions || {});
    els.pDate.value = els.pDate.value || todayLocalDate();
    try {
        await loadPosts();
    } catch (e) {
        console.error("Failed to load posts:", e);
        els.feed.innerHTML = `<div class="empty-state">
          <div class="muted">Failed to load posts. Ensure the server is running and try again.</div>
        </div>`;
    }
    // Queue SSE stream (terminal events) + debounced refresh logic to replace frequent polling
    (function initQueueStream(){
        let es = null;
        let reconnectDelay = 2000; // backoff up to ~30s
        let refreshTimer = null;
        let queuedRefresh = false;

        async function applySnapshotRefresh(triggerSource){
            // One-shot fetch of full status + targeted detail refresh
            try {
                await loadQueueStatus();
                renderFeed();
                if (currentDetailId) {
                    try {
                        const p = await api(`/api/stocks/${encodeURIComponent(currentDetailId)}`);
                        upsertPost(p);
                        syncDetailPanels(p);
                    } catch {}
                }
            } catch (e) {
                console.warn('Queue snapshot refresh failed', e);
            }
        }

        function scheduleSnapshotRefresh(){
            if (queuedRefresh) return;
            queuedRefresh = true;
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                queuedRefresh = false;
                applySnapshotRefresh('debounce');
            }, 400); // debounce bursts of terminal events
        }

        function connect(){
            if (es) { try { es.close(); } catch {} }
            es = new EventSource(API_BASE + '/api/queue/stream');
            es.onopen = () => { reconnectDelay = 2000; /* initial or successful reconnect */ };
            es.onmessage = (e) => {
                if (!e.data) return;
                // Comments (keep-alive) start with ':' and are delivered via onmessage in some browsers with empty data
                try {
                    const data = JSON.parse(e.data);
                    if (data && data.type === 'state' && data.pid) {
                        // Update local states map optimistically
                        JOB_STATUS.states = JOB_STATUS.states || {};
                        JOB_STATUS.states[data.pid] = data.state;
                        // A terminal event means possible change in running/queue ordering; schedule full snapshot
                        scheduleSnapshotRefresh();
                    }
                } catch { /* ignore parse for keep-alives */ }
            };
            es.onerror = () => {
                try { es.close(); } catch {}
                es = null;
                // Attempt reconnect with backoff
                setTimeout(connect, reconnectDelay);
                reconnectDelay = Math.min(reconnectDelay * 1.7, 30000);
            };
        }

        // Initial snapshot (already loaded via loadPosts -> loadQueueStatus) but ensure recency
        applySnapshotRefresh('initial');
        connect();
        // Expose for debugging
        window.__queueStream = () => es;
    })();
    // One-time global touch DnD handlers
    if (!window.__touchDndWired) {
        window.__touchDndWired = true;
        window.addEventListener('touchmove', (e) => {
            if (!TOUCH_DND.active || !TOUCH_DND.row || !TOUCH_DND.tbody) return;
            e.preventDefault();
            const t = e.touches[0];
            const tbody = TOUCH_DND.tbody; const row = TOUCH_DND.row;
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const target = rows.find(r => {
                const rect = r.getBoundingClientRect();
                return t.clientY >= rect.top && t.clientY <= rect.bottom;
            });
            if (!target || target === row) return;
            const rect = target.getBoundingClientRect();
            const before = (t.clientY - rect.top) < rect.height / 2;
            if (before) tbody.insertBefore(row, target); else tbody.insertBefore(row, target.nextSibling);
        }, { passive: false });
        window.addEventListener('touchend', async () => {
            if (!TOUCH_DND.active || !TOUCH_DND.tbody) return;
            const tbody = TOUCH_DND.tbody; const row = TOUCH_DND.row;
            TOUCH_DND.active = false; TOUCH_DND.row = null; TOUCH_DND.tbody = null;
            window.__touchDndJustEnded = Date.now();
            if (row) row.classList.remove('dragging');
            tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drop-before','drop-after'));
            // Persist new order
            const newOrder = Array.from(tbody.querySelectorAll('tr')).map(r => r.getAttribute('data-id')).filter(Boolean);
            try {
                await api('/api/stocks/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: newOrder }) });
                HAS_CUSTOM_ORDER = true;
                try { localStorage.setItem('feed:customOrder', '1'); } catch {}
                syncWatchlistPanelActions();
                const byId = new Map(POSTS.map(x => [x.id, x]));
                POSTS = newOrder.map(id => byId.get(id)).filter(Boolean).concat(POSTS.filter(x => !newOrder.includes(x.id)));
                showToast('Order saved');
            } catch (err) {
                console.warn('Failed to save order', err);
            }
        });
    }
})();

// --- tiny HTML escape
function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
