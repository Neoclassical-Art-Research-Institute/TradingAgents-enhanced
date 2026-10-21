// static/app.js
// API calls are always same-origin: they carry the session cookie and CSRF token,
// so the base URL must not be settable from a link (the old ?api= override).
const API_BASE = '';
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
    searchBox: document.getElementById("searchBox"),
    guideBtn: document.getElementById("guideBtn"),
    autoAllOnBtn: document.getElementById("autoAllOnBtn"),
    autoAllOffBtn: document.getElementById("autoAllOffBtn"),
    autoAllStatus: document.getElementById("autoAllStatus"),
    menuBtn: document.getElementById("menuBtn"),
    sideDrawer: document.getElementById("sideDrawer"),
    drawerOverlay: document.getElementById("drawerOverlay"),
    drawerClose: document.getElementById("drawerClose"),
    accountTabs: document.getElementById("accountTabs"),
    networthPanel: document.getElementById("networthPanel"),
    sidePanel: document.getElementById("sidePanel"),
    sideBubbles: document.getElementById("sideBubbles"),
    holdingsList: document.getElementById("holdingsList"),
    holdingsTitle: document.getElementById("holdingsTitle"),
    holdingsMeta: document.getElementById("holdingsMeta"),
    addHoldingBtn: document.getElementById("addHoldingBtn"),
    refreshPricesBtn: document.getElementById("refreshPricesBtn"),
    watchingPanel: document.getElementById("watchingPanel"),
    watchingList: document.getElementById("watchingList"),
    watchingMeta: document.getElementById("watchingMeta"),
    watchingSearchBox: document.getElementById("watchingSearchBox"),
    watchingRefreshBtn: document.getElementById("watchingRefreshBtn"),
    watchingAddBtn: document.getElementById("watchingAddBtn"),
    serverState: document.getElementById("serverState"),
    // add / edit holding
    postDlg: document.getElementById("postDlg"),
    dlgTitle: document.getElementById("dlgTitle"),
    pTicker: document.getElementById("pTicker"),
    pAccount: document.getElementById("pAccount"),
    pTitle: document.getElementById("pTitle"),
    pNote: document.getElementById("pNote"),
    cancelDlg: document.getElementById("cancelDlg"),
    cancelDlgX: document.getElementById("cancelDlgX"),
    saveDlg: document.getElementById("saveDlg"),
    // detail
    detailDlg: document.getElementById("detailDlg"),
    dTitle: document.getElementById("dTitle"),
    dSubtitle: document.getElementById("dSubtitle"),
    dContent: document.getElementById("dContent"),
    dAnalyze: document.getElementById("dAnalyze"),
    dAutoAnalyze: document.getElementById("dAutoAnalyze"),
    dEdit: document.getElementById("dEdit"),
    dDelete: document.getElementById("dDelete"),
    dRefresh: document.getElementById("dRefresh"),
    dClose: document.getElementById("dClose"),
    // transaction dialog
    txnDlg: document.getElementById("txnDlg"),
    txnDlgTitle: document.getElementById("txnDlgTitle"),
    txnDlgSub: document.getElementById("txnDlgSub"),
    txnShares: document.getElementById("txnShares"),
    txnPrice: document.getElementById("txnPrice"),
    txnDate: document.getElementById("txnDate"),
    txnFee: document.getElementById("txnFee"),
    txnNote: document.getElementById("txnNote"),
    txnPreview: document.getElementById("txnPreview"),
    txnSave: document.getElementById("txnSave"),
    txnCancel: document.getElementById("txnCancel"),
    txnClose: document.getElementById("txnClose"),
    // account dialog
    accountDlg: document.getElementById("accountDlg"),
    accountDlgTitle: document.getElementById("accountDlgTitle"),
    accName: document.getElementById("accName"),
    accSave: document.getElementById("accSave"),
    accCancel: document.getElementById("accCancel"),
    accClose: document.getElementById("accountClose"),
    accDelete: document.getElementById("accDelete"),
    accKeyword: document.getElementById("accKeyword"),
    accKeywordHint: document.getElementById("accKeywordHint"),
    // cash dialog
    cashDlg: document.getElementById("cashDlg"),
    cashDlgTitle: document.getElementById("cashDlgTitle"),
    cashDlgSub: document.getElementById("cashDlgSub"),
    cashCoverMsg: document.getElementById("cashCoverMsg"),
    cashTypeToggle: document.getElementById("cashTypeToggle"),
    cashAmount: document.getElementById("cashAmount"),
    cashDate: document.getElementById("cashDate"),
    cashNote: document.getElementById("cashNote"),
    cashHint: document.getElementById("cashHint"),
    cashSave: document.getElementById("cashSave"),
    cashCancel: document.getElementById("cashCancel"),
    cashSkip: document.getElementById("cashSkip"),
    cashClose: document.getElementById("cashClose"),
    // metric guide
    guideDlg: document.getElementById("guideDlg"),
    guideContent: document.getElementById("guideContent"),
    guideClose: document.getElementById("guideClose"),
    mgTickerInput: document.getElementById("mgTickerInput"),
    mgLoadBtn: document.getElementById("mgLoadBtn"),
    mgTickerStatus: document.getElementById("mgTickerStatus"),
    serverNotice: null,
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

let POSTS = [];                 // holdings (one ticker each)
let ACCOUNTS = [];              // account/watchlist books
let ACTIVE_ACCOUNT_ID = null;   // currently selected account tab
let TXN_CTX = { holdingId: null, txId: null }; // transaction dialog state
let ACCOUNT_EDIT_ID = null;     // account dialog state (null = creating)
let UNLOCKED_ACCOUNTS = new Set(); // account ids unlocked into edit mode this session
const ACTIVE_ACCOUNT_KEY = 'stock:activeAccount';
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
const fmtFullMoney = (x) => {
    if (x == null || isNaN(x)) return '--';
    const n = Number(x);
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtPct = (x) => (x == null || isNaN(x)) ? "" : `${(x).toFixed(2)}%`;
const toList = (s) => (s || "").split(",").map(t => t.trim()).filter(Boolean);
const getAnalystCheckboxes = () => Array.from(document.querySelectorAll('.pAnalyst'));

// --- money / number formatting helpers
const fmtShares = (x) => {
    if (x == null || isNaN(x)) return '';
    const n = Number(x);
    return Number.isInteger(n) ? String(n) : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const fmtSignedMoney = (x) => {
    if (x == null || isNaN(x)) return '';
    const n = Number(x);
    const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    return `${sign}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtSignedPct = (x) => {
    if (x == null || isNaN(x)) return '';
    const n = Number(x);
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
};
function fmtCompactMoney(x) {
    if (x == null || isNaN(x)) return '--';
    const n = Number(x);
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(2)}`;
}
// Compact + signed (e.g. "+$3.6K"): used for the return-mode chart axis, where
// fmtSignedMoney's full-precision "+$3,641.98" form is too wide for the y-axis gutter.
function fmtSignedCompactMoney(x) {
    if (x == null || isNaN(x)) return '';
    const n = Number(x);
    const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    return `${sign}${fmtCompactMoney(Math.abs(n))}`;
}
const pnlClass = (x) => (x == null || isNaN(x) || x === 0) ? 'flat' : (x > 0 ? 'pos' : 'neg');
// Maps a P&L sign onto the buy/sell/hold accent vocabulary (same colors as classBySuggestion)
// so a held position's row accent can reuse the existing .rowAccent.buy/.sell/.hold CSS.
const accentByPnl = (x) => (x == null || isNaN(x) || x === 0) ? 'hold' : (x > 0 ? 'buy' : 'sell');

// --- account helpers
function accountById(id) {
    return ACCOUNTS.find((a) => a.id === id) || null;
}

function getActiveAccount() {
    return accountById(ACTIVE_ACCOUNT_ID) || ACCOUNTS[0] || null;
}

function setActiveAccount(id) {
    ACTIVE_ACCOUNT_ID = id;
    try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, id || ''); } catch {}
    renderAll();
}

// --- edit-mode (soft keyword lock) helpers
// An account with no keyword is always editable. One with a keyword starts
// locked (read mode) each session and must be unlocked with its keyword.
// Visitors who aren't signed in (public read) see every account locked; the
// lock button sends them to the login page instead.
const VIEWER = document.querySelector('meta[name="ta-viewer"]')?.content || 'admin';
const READ_ONLY_VIEWER = VIEWER !== 'admin' && VIEWER !== 'write';
function goToLogin() {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
}
function accountHasKeyword(acc) {
    return !!(acc && typeof acc.keyword === 'string' && acc.keyword.length);
}
function accountLocked(acc) {
    if (READ_ONLY_VIEWER) return true;
    return accountHasKeyword(acc) && !UNLOCKED_ACCOUNTS.has(String(acc.id));
}
function canEditAccount(acc) {
    return !!acc && !accountLocked(acc);
}
function canEditHolding(post) {
    return canEditAccount(accountById(post && post.accountId));
}
function lockAccount(acc) {
    if (!acc) return;
    UNLOCKED_ACCOUNTS.delete(String(acc.id));
    renderAll();
    if (currentDetailId) { const p = getPostById(currentDetailId); if (p) refreshDetailEditMode(p); }
    showToast('Locked · read mode');
}
function unlockAccount(acc) {
    if (READ_ONLY_VIEWER) { goToLogin(); return; }
    if (!acc) return;
    if (!accountHasKeyword(acc)) return;
    const entry = prompt(`Enter the keyword for "${acc.name}" to enable edit mode:`);
    if (entry == null) return; // cancelled
    if (String(entry) === String(acc.keyword)) {
        UNLOCKED_ACCOUNTS.add(String(acc.id));
        renderAll();
        if (currentDetailId) { const p = getPostById(currentDetailId); if (p) refreshDetailEditMode(p); }
        showToast('Unlocked · edit mode');
    } else {
        showToast('Wrong keyword.');
    }
}
function toggleAccountLock(acc) {
    if (READ_ONLY_VIEWER) { goToLogin(); return; }
    if (!acc) return;
    if (accountLocked(acc)) unlockAccount(acc);
    else lockAccount(acc);
}
// Lock toggle button markup for the net-worth/watchlist panel header.
function lockControlHtml(acc) {
    if (READ_ONLY_VIEWER) {
        return `<button class="ghost iconBtn lockBtn is-locked" id="lockToggleBtn" type="button" aria-label="Read-only. Sign in to edit" title="Read-only. Sign in to edit">🔒 <span class="btnTxt">Sign in to edit</span></button>`;
    }
    if (!accountHasKeyword(acc)) return '';
    const locked = accountLocked(acc);
    return `<button class="ghost iconBtn lockBtn ${locked ? 'is-locked' : 'is-unlocked'}" id="lockToggleBtn" type="button" aria-label="${locked ? 'Locked' : 'Editing'}" title="${locked ? 'Locked — click to enter keyword' : 'Editing — click to lock'}">${locked ? '🔒' : '🔓'} <span class="btnTxt">${locked ? 'Locked' : 'Editing'}</span></button>`;
}

// Which P&L window the holdings list's hSecondary line shows: 'day' or 'total' return.
let HOLD_SEC_MODE = (function () { try { return localStorage.getItem('stock:holdSecMode') || 'day'; } catch { return 'day'; } })();

function holdingsForAccount(accountId, query = '') {
    const q = (query || '').toLowerCase().trim();
    return POSTS.filter((p) => {
        if (String(p.accountId) !== String(accountId)) return false;
        if (!q) return true;
        const hay = [p.title || '', p.note || p.description || '', ...(p.tickers || [])].join(' ').toLowerCase();
        return hay.includes(q);
    }).sort((a, b) => holdingSortValue(b) - holdingSortValue(a));
}

// Current dollar value of a holding, used to sort the holdings list (highest first).
function holdingSortValue(p) {
    const pos = holdingPosition(p);
    if (pos.marketValue != null) return pos.marketValue;
    return pos.current ?? -Infinity;
}

function holdingTicker(p) {
    return (p.ticker || (p.tickers || [])[0] || '').toUpperCase();
}

// Number of un-handled (pending) comment cards on a holding.
function pendingCommentCount(p) {
    return ((p && p.comments) || []).filter((c) => (c.status || 'pending') === 'pending').length;
}

function holdingPosition(p) {
    // Server stores derived position inside snapshot[ticker]; fall back to client calc.
    const t = holdingTicker(p);
    const snap = (p.snapshot || {})[t] || {};
    if (snap.shares != null || snap.avgCost != null) {
        return {
            shares: snap.shares || 0,
            avgCost: snap.avgCost ?? null,
            current: snap.current ?? null,
            marketValue: snap.marketValue ?? (snap.current != null && snap.shares ? snap.current * snap.shares : null),
            unrealizedPnl: snap.unrealizedPnl ?? null,
            realizedPnl: snap.realizedPnl ?? 0,
            pct: snap.pct ?? null,
            dayChange: snap.dayChange ?? null,
            dayChangePct: snap.dayChangePct ?? null,
        };
    }
    return computePosition(p.transactions || [], snap.current ?? null);
}

async function loadAccounts() {
    try {
        ACCOUNTS = await api('/api/accounts');
    } catch {
        ACCOUNTS = [];
    }
    if (!ACCOUNTS.length) ACCOUNTS = [];
    // Restore the active account from storage, else first account.
    let stored = null;
    try { stored = localStorage.getItem(ACTIVE_ACCOUNT_KEY); } catch {}
    if (stored && accountById(stored)) ACTIVE_ACCOUNT_ID = stored;
    else if (!accountById(ACTIVE_ACCOUNT_ID)) ACTIVE_ACCOUNT_ID = ACCOUNTS[0]?.id || null;
    return ACCOUNTS;
}

// Orchestrates the whole portfolio surface (tabs + net-worth + side panel).
function renderAll() {
    renderAccountTabs();
    renderNetworthPanel();
    renderSideBubbles();
    renderHoldingsList();
    renderAutoAllStatus();
}

// Cash-flow ledger: derive current cash + contributions (net deposits) from an
// account's cashFlows plus all its holdings' buy/sell transactions. Cash may go
// negative (margin / instant buying power); a buy is never silently "funded" with
// an invented deposit. Keep in sync with _account_ledger() in serverStock.py.
function accountLedger(account, holdings) {
    const events = [];
    (account?.cashFlows || []).forEach((cf) => {
        const amt = Number(cf?.amount) || 0;
        if (amt <= 0) return;
        const kind = cf.type === 'withdrawal' ? 'withdraw'
            : (cf.type === 'dividend' || cf.type === 'outside-gain') ? 'dividend'
            : (cf.type === 'fee' || cf.type === 'outside-loss') ? 'fee' : 'deposit';
        events.push({ date: String(cf.date || ''), kind, amount: amt });
    });
    holdings.forEach((p) => {
        (p.transactions || []).forEach((t) => {
            if (!t || (t.type !== 'buy' && t.type !== 'sell') || !(Number(t.shares) > 0)) return;
            const gross = Number(t.shares) * Number(t.price), fee = Number(t.fee) || 0;
            events.push({ date: String(t.date || ''), kind: t.type, amount: t.type === 'buy' ? gross + fee : gross - fee });
        });
    });
    events.sort((a, b) => a.date.localeCompare(b.date));
    let cash = 0, contributions = 0;
    for (const e of events) {
        if (e.kind === 'deposit') { cash += e.amount; contributions += e.amount; }
        else if (e.kind === 'withdraw') { cash -= e.amount; contributions -= e.amount; }
        else if (e.kind === 'buy') { cash -= e.amount; }
        else if (e.kind === 'sell') { cash += e.amount; }
        else if (e.kind === 'dividend') { cash += e.amount; /* not a contribution — it's a return */ }
        else if (e.kind === 'fee') { cash -= e.amount; /* loss/fee reduces cash but not contributions */ }
    }
    const r2 = (x) => Math.round(x * 100) / 100;
    return { cash: r2(cash), contributions: r2(contributions) };
}

function accountNetWorth(account, holdings) {
    const totals = computeAccountTotals(holdings);
    const ledger = accountLedger(account, holdings);
    const invested = totals.marketValue || 0;
    const netWorth = ledger.cash + invested;
    const returnAbs = netWorth - ledger.contributions;
    const returnPct = ledger.contributions > 0 ? (returnAbs / ledger.contributions) * 100 : null;
    return {
        cash: ledger.cash,
        contributions: ledger.contributions,
        invested,
        netWorth,
        returnAbs,
        returnPct,
        totals,
    };
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
        const ot = document.getElementById('pOnlineTools'); if (ot) ot.checked = preset.online_tools !== false;
        const rd = document.getElementById('pRounds'); if (rd) rd.value = String(preset.max_debate_rounds || 1);
    }
}

// The TradingAgents config fields live in a holding's Report tab (rendered on demand), so
// resolve them live each call and no-op when the tab isn't mounted.
function setFormFromOptions(options = {}) {
    if (!document.getElementById('pDate')) return;
    const normalized = normalizedOptions(options);
    setPresetOnForm(normalized.preset, true);
    const pd = document.getElementById('pDate'); if (pd) pd.value = normalized.date || todayLocalDate();
    const rd = document.getElementById('pRounds'); if (rd) rd.value = String(normalized.max_debate_rounds || 1);
    const ot = document.getElementById('pOnlineTools'); if (ot) ot.checked = normalized.online_tools !== false;
    const dbg = document.getElementById('pDebug'); if (dbg) dbg.checked = Boolean(normalized.debug);
    setSelectedAnalysts(normalized.selected_analysts);
    const advanced = stripStructuredOptions(options);
    const po = document.getElementById('pOptions'); if (po) po.value = Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '';
}

function buildOptionsFromForm() {
    const po = document.getElementById('pOptions');
    const pd = document.getElementById('pDate');
    const rd = document.getElementById('pRounds');
    const ot = document.getElementById('pOnlineTools');
    const dbg = document.getElementById('pDebug');
    const advanced = optionsFromJson(po ? po.value : '');
    return {
        ...advanced,
        preset: getSelectedPreset(),
        date: (pd && pd.value) || todayLocalDate(),
        selected_analysts: selectedAnalystsFromForm(),
        online_tools: !!(ot && ot.checked),
        max_debate_rounds: clamp(parseInt(rd ? rd.value : '1', 10) || 1, 1, 4),
        debug: !!(dbg && dbg.checked),
    };
}

// HTML for the TradingAgents setup block, generated from APP_CONFIG so presets/analysts stay
// in sync. Rendered into a holding's Report tab.
function analysisConfigMarkup() {
    const presets = APP_CONFIG.analysisPresets || DEFAULT_PRESETS;
    const presetCards = Object.entries(presets).map(([key, p]) => `
        <label class="presetCard">
            <input type="radio" name="analysisPreset" value="${escapeHtml(key)}"${key === (APP_CONFIG.defaultPreset || 'balanced') ? ' checked' : ''} />
            <span class="presetName">${escapeHtml(p.label || key)}</span>
            <span class="presetDesc">${escapeHtml(p.description || '')}</span>
        </label>`).join('');
    const labels = APP_CONFIG.analystLabels || DEFAULT_ANALYST_LABELS;
    const analystTiles = Object.entries(labels).map(([key, label]) =>
        `<label class="checkTile"><input class="pAnalyst" type="checkbox" value="${escapeHtml(key)}" checked />${escapeHtml(label)}</label>`).join('');
    return `
        <section class="formSection analysisConfigSection">
            <div class="formSectionHead">TradingAgents setup</div>
            <div class="presetGrid">${presetCards}</div>
            <div class="rowgrid rowgrid-three">
                <div class="row">
                    <label>Analysis date</label>
                    <input id="pDate" type="date" />
                </div>
                <div class="row">
                    <label>Debate rounds</label>
                    <input id="pRounds" type="number" min="1" max="4" step="1" value="1" />
                </div>
                <div class="toggleStack">
                    <label class="toggleTile">
                        <input id="pOnlineTools" type="checkbox" checked />
                        <span><strong>Use online tools</strong><small>Prefer live data sources when available.</small></span>
                    </label>
                    <label class="toggleTile">
                        <input id="pDebug" type="checkbox" />
                        <span><strong>Verbose logs</strong><small>Keep more reasoning detail in the report.</small></span>
                    </label>
                </div>
            </div>
            <div class="row">
                <label>Analyst coverage</label>
                <div class="analystGrid">${analystTiles}</div>
            </div>
            <details class="advancedBlock">
                <summary>Advanced overrides</summary>
                <div class="muted">Optional JSON merged into the request. Structured fields above win if the same key appears twice.</div>
                <textarea id="pOptions" placeholder='{"config":{"quick_think_llm":"gpt-4.1-mini"}}'></textarea>
            </details>
            <div class="inline analysisConfigActions">
                <span class="muted" id="analysisCfgHint">Saved settings are used when you press Analyze.</span>
                <button id="saveAnalysisCfg" class="ghost" type="button">Save settings</button>
            </div>
        </section>`;
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
const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]')?.content || '';

async function api(path, opts = {}) {
    const url = /^https?:/i.test(path) ? path : (API_BASE + path);
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = CSRF_TOKEN;
    const r = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
    if (r.status === 401) {
        // Session expired or signed out elsewhere: go back through the login page.
        location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        throw new Error('Signed out');
    }
    if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message || `${r.status} ${r.statusText}`);
    }
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
    const fresh = await api("/api/stocks");
    // The list omits each analysis report (it's large). Keep any report already
    // loaded for a holding (from /api/stocks/<id>) if its analysis hasn't changed.
    const previous = new Map(POSTS.map((p) => [p.id, p]));
    fresh.forEach((p) => {
        const old = previous.get(p.id);
        if (p.analysis?.reportOmitted && old?.analysis?.report && !old.analysis.reportOmitted
            && old.analysis.updatedAt === p.analysis.updatedAt) {
            p.analysis = { ...p.analysis, report: old.analysis.report, reportOmitted: false };
        }
    });
    POSTS = fresh;
    await loadQueueStatus();
    renderAll();
}

async function savePost() {
    const ticker = (els.pTicker.value || '').trim().toUpperCase();
    if (!ticker) {
        showToast('Enter a ticker symbol.');
        els.pTicker.focus();
        return;
    }
    // TradingAgents config is edited in the holding's Report tab, not here. New holdings get
    // the default options; edits preserve whatever was previously configured.
    const options = editingId
        ? ((getPostById(editingId) || {}).options || normalizedOptions(APP_CONFIG.defaultOptions || {}))
        : normalizedOptions(APP_CONFIG.defaultOptions || {});

    const body = {
        ticker,
        accountId: els.pAccount.value || (getActiveAccount() || {}).id,
        title: els.pTitle.value.trim() || ticker,
        note: els.pNote.value.trim(),
        options,
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
        showToast(`Failed to save holding: ${error.message || error}`);
        els.saveDlg.disabled = false;
        return;
    }
    els.saveDlg.disabled = false;
    els.postDlg.close();
    editingId = null;
    if (saved.accountId) setActiveAccountSilently(saved.accountId);
    upsertPost(saved);
    invalidateNetworth();
    await loadPosts();
    // If the detail dialog is open for this holding, re-open it to reflect changes immediately
    if (currentDetailId && wasEditingId && currentDetailId === wasEditingId) {
        openDetail(wasEditingId);
    }
}

function setActiveAccountSilently(id) {
    ACTIVE_ACCOUNT_ID = id;
    try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, id || ''); } catch {}
}

async function runAnalysis(id) {
    const res = await api(`/api/analyze/${encodeURIComponent(id)}`, { method: "POST" });
    const idx = POSTS.findIndex(p => p.id === id);
    if (idx >= 0) POSTS[idx] = res;
    renderAll();
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
                    renderAll();
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
function renderAccountTabs() {
    const host = els.accountTabs;
    if (!host) return;
    host.innerHTML = '';
    const active = getActiveAccount();
    ACCOUNTS.forEach((acc) => {
        const holdings = POSTS.filter((p) => String(p.accountId) === String(acc.id));
        const totals = computeAccountTotals(holdings);
        const isActive = active && acc.id === active.id;
        const isWatch = acc.type === 'watchlist';
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'accountTab' + (isActive ? ' is-active' : '');
        tab.setAttribute('data-id', acc.id);
        const badge = isWatch
            ? `<span class="accountTabSub muted">${holdings.length} watched</span>`
            : `<span class="accountTabSub ${pnlClass(totals.totalPnl)}">${totals.marketValue ? fmtFullMoney(totals.marketValue) : '—'}</span>`;
        tab.innerHTML = `<span class="accountTabName">${escapeHtml(acc.name || 'Account')}</span>${badge}`;
        tab.addEventListener('click', () => {
            if (isActive) { if (!READ_ONLY_VIEWER) openAccountDlg(acc); }
            else setActiveAccount(acc.id);
        });
        host.appendChild(tab);
    });
    if (READ_ONLY_VIEWER) return;
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'accountTab accountTabAdd';
    add.setAttribute('aria-label', 'Add account');
    add.textContent = '+ Account';
    add.addEventListener('click', () => openAccountDlg(null));
    host.appendChild(add);
}

// Left pane: the "major" net-worth view (one large graph), like a stock page.
function renderNetworthPanel() {
    const host = els.networthPanel;
    if (!host) return;
    const acc = getActiveAccount();
    if (!acc) {
        host.innerHTML = `<div class="panelCard emptyPanel">
            <div class="muted">No accounts yet.</div>
            ${READ_ONLY_VIEWER ? '' : '<button class="primary" id="firstAccountBtn" type="button">+ New Account</button>'}
        </div>`;
        document.getElementById('firstAccountBtn')?.addEventListener('click', () => openAccountDlg(null));
        return;
    }
    const holdings = POSTS.filter((p) => String(p.accountId) === String(acc.id));
    const isWatch = acc.type === 'watchlist';

    if (isWatch) {
        const counts = { Buy: 0, Hold: 0, Sell: 0 };
        holdings.forEach((p) => { const s = getPrimarySuggestion(p); if (counts[s] == null) counts.Hold += 1; else counts[s] += 1; });
        host.innerHTML = `
          <div class="nwHead">
            <div>
              <div class="portfolioEyebrow">${escapeHtml(acc.name)} · Watchlist</div>
              <div class="nwValue">${holdings.length}</div>
              <div class="nwSub muted">tickers tracked</div>
            </div>
            <div class="nwHeadActions">
              ${lockControlHtml(acc)}
              ${canEditAccount(acc) ? '<button class="ghost iconBtn" id="editAccountBtn" type="button" aria-label="Edit account">📝 <span class="btnTxt">Edit</span></button>' : ''}
            </div>
          </div>
          <div class="watchBig">
            <div class="watchBigTile pos"><span>${counts.Buy}</span><small>Buy</small></div>
            <div class="watchBigTile"><span>${counts.Hold}</span><small>Hold</small></div>
            <div class="watchBigTile neg"><span>${counts.Sell}</span><small>Sell</small></div>
          </div>
          <div class="nwChartNote muted">Watchlists track TradingAgents signals, not positions. Switch the type in Edit to track net worth &amp; P&amp;L.</div>
        `;
        document.getElementById('editAccountBtn')?.addEventListener('click', () => openAccountDlg(acc));
        document.getElementById('lockToggleBtn')?.addEventListener('click', () => toggleAccountLock(acc));
        return;
    }

    const nw = accountNetWorth(acc, holdings);
    const headline = NW_MODE === 'return'
        ? `<div class="nwValue ${pnlClass(nw.returnAbs)}">${fmtSignedMoney(nw.returnAbs)}</div>
           <div class="nwSub"><span class="${pnlClass(nw.returnAbs)}">${nw.returnPct != null ? fmtSignedPct(nw.returnPct) : '—'}</span><span class="muted">total return on ${fmtFullMoney(nw.contributions)} invested</span></div>`
        : `<div class="nwValue">${fmtFullMoney(nw.netWorth)}</div>
           <div class="nwSub"><span class="${pnlClass(nw.returnAbs)}">${fmtSignedMoney(nw.returnAbs)}${nw.returnPct != null ? ` (${fmtSignedPct(nw.returnPct)})` : ''}</span><span class="muted">total return</span></div>`;
    const ranges = Object.entries(NW_RANGE_LABELS);
    // Disable a fixed range when more than ~90% of it would be empty "no data" filler, i.e.
    // when the account has less than 10% of that range in actual history. 'all' is always
    // available once there's any activity. With no activity at all, leave every range usable.
    const firstAct = accountFirstActivityDate(acc, holdings);
    const spanDays = firstAct ? daysSinceDate(firstAct) + 1 : 0;
    const rangeEnabled = (key) => {
        if (!firstAct) return true;
        if (key === 'all') return true;
        return spanDays >= (NW_RANGE_DAYS[key] || 30) * 0.1;
    };
    if (!rangeEnabled(NW_PERIOD)) {
        // Saved range no longer has enough history: fall back to the widest enabled fixed range.
        NW_PERIOD = ['2y', '1y', '6mo', '3mo', '1mo', '5d', '1d'].find(rangeEnabled) || 'all';
    }
    host.innerHTML = `
      <div class="nwHead">
        <div>
          <div class="portfolioEyebrow">${escapeHtml(acc.name)} · ${NW_MODE === 'return' ? 'Return' : 'Net worth'}</div>
          ${headline}
        </div>
        <div class="nwHeadActions">
          ${lockControlHtml(acc)}
          ${canEditAccount(acc) ? '<button class="ghost iconBtn" id="editAccountBtn" type="button" aria-label="Edit account">📝 <span class="btnTxt">Edit</span></button>' : ''}
        </div>
      </div>
      <div class="nwBreak">
        <span class="nwChip"><span class="nwChipLabel">Invested</span> ${fmtFullMoney(nw.invested)}</span>
        ${canEditAccount(acc)
          ? `<button class="nwChip nwChipBtn" id="adjustCashBtn" type="button"><span class="nwChipLabel">Cash</span> ${fmtFullMoney(nw.cash)} <span class="nwChipEdit">+ adjust</span></button>`
          : `<span class="nwChip"><span class="nwChipLabel">Cash</span> ${fmtFullMoney(nw.cash)}</span>`}
      </div>
      <div class="nwControls">
        <div class="nwRanges" id="nwRanges">
          ${ranges.map(([r, lbl]) => { const en = rangeEnabled(r); return `<button type="button" class="nwRange${r === NW_PERIOD ? ' is-active' : ''}" data-r="${r}"${en ? '' : ' disabled title="Not enough history for this range"'}>${lbl}</button>`; }).join('')}
        </div>
        <div class="segmentToggle nwModeToggle" id="nwModeToggle" role="group" aria-label="Chart mode">
          <label class="segmentOption"><input type="radio" name="nwMode" value="value" ${NW_MODE !== 'return' ? 'checked' : ''} /><span>Value</span></label>
          <label class="segmentOption"><input type="radio" name="nwMode" value="return" ${NW_MODE === 'return' ? 'checked' : ''} /><span>Return</span></label>
        </div>
      </div>
      <div class="nwPeriodReturn muted" id="nwPeriodReturn"></div>
      <div class="nwChartWrap"><canvas id="networthCanvas"></canvas></div>
      <div class="nwChartNote muted">${NW_MODE === 'return'
        ? 'Return = net worth − net deposits, so adding cash never shows as a gain.'
        : 'Net worth = positions at daily close + cash. Dashed line = net deposits (your contributions).'}</div>
    `;
    document.getElementById('editAccountBtn')?.addEventListener('click', () => openAccountDlg(acc));
    document.getElementById('lockToggleBtn')?.addEventListener('click', () => toggleAccountLock(acc));
    document.getElementById('adjustCashBtn')?.addEventListener('click', () => openCashDlg(acc));
    document.getElementById('nwRanges')?.addEventListener('click', (e) => {
        const b = e.target.closest('.nwRange'); if (!b || b.disabled) return;
        NW_PERIOD = b.dataset.r;
        try { localStorage.setItem('stock:nwPeriod', NW_PERIOD); } catch {}
        renderNetworthPanel();
    });
    document.getElementById('nwModeToggle')?.addEventListener('change', (e) => {
        NW_MODE = e.target.value === 'return' ? 'return' : 'value';
        try { localStorage.setItem('stock:nwMode', NW_MODE); } catch {}
        renderNetworthPanel();
    });
    wireNwChartHover(host);
    loadNetworthChart(acc, holdings, NW_PERIOD);
}

// Crosshair interactions on the net worth chart: hovering (mouse) or holding a finger
// (touch) tracks a vertical/horizontal guide and swaps the headline `.nwValue`/`.nwSub`
// to the value at that point in time; releasing restores the live headline.
function wireNwChartHover(host) {
    const canvas = host.querySelector('#networthCanvas');
    const valueEl = host.querySelector('.nwValue');
    const subEl = host.querySelector('.nwSub');
    if (!canvas) return;
    const baseValue = valueEl ? { cls: valueEl.className, html: valueEl.innerHTML } : null;
    const baseSub = subEl ? { cls: subEl.className, html: subEl.innerHTML } : null;

    const restoreHeadline = () => {
        if (valueEl && baseValue) { valueEl.className = baseValue.cls; valueEl.innerHTML = baseValue.html; }
        if (subEl && baseSub) { subEl.className = baseSub.cls; subEl.innerHTML = baseSub.html; }
    };
    const showHeadlineAt = (idx) => {
        const pts = LAST_NW_SERIES?.points || [];
        if (!pts.length) return;
        const p = pts[clamp(idx, 0, pts.length - 1)];
        const v = NW_MODE === 'return' ? (p.value - p.contributions) : p.value;
        if (valueEl) {
            valueEl.className = NW_MODE === 'return' ? `nwValue ${pnlClass(v)}` : 'nwValue';
            valueEl.textContent = NW_MODE === 'return' ? fmtSignedMoney(v) : fmtFullMoney(v);
        }
        if (subEl) {
            subEl.className = 'nwSub muted';
            subEl.textContent = p.noData
                ? `${fmtNwPointDate(p.date)} · no recorded activity`
                : `${fmtNwPointDate(p.date)} · ${NW_MODE === 'return' ? 'return' : 'net worth'} at this point`;
        }
    };
    const indexFromClientX = (clientX) => {
        const pts = LAST_NW_SERIES?.points || [];
        if (pts.length < 2) return null;
        const rect = canvas.getBoundingClientRect();
        const plotW = Math.max(10, rect.width - NW_CHART_PAD.l - NW_CHART_PAD.r);
        const ratio = clamp((clientX - rect.left - NW_CHART_PAD.l) / plotW, 0, 1);
        return Math.round(ratio * (pts.length - 1));
    };
    const setHover = (idx) => {
        if (NW_HOVER_IDX === idx) return;
        NW_HOVER_IDX = idx;
        if (idx == null) restoreHeadline(); else showHeadlineAt(idx);
        if (LAST_NW_SERIES) drawNetworthChart(canvas, LAST_NW_SERIES);
    };
    const moveTo = (clientX) => {
        if (!LAST_NW_SERIES?.hasData) return;
        setHover(indexFromClientX(clientX));
    };

    canvas.addEventListener('mousemove', (e) => moveTo(e.clientX));
    canvas.addEventListener('mouseleave', () => setHover(null));
    canvas.addEventListener('touchstart', (e) => { if (e.touches[0]) { moveTo(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { if (e.touches[0]) { moveTo(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
    canvas.addEventListener('touchend', () => setHover(null));
    canvas.addEventListener('touchcancel', () => setHover(null));
}

const statTile = (label, value, cls = '') =>
    `<div class="statTile"><span class="statLabel">${escapeHtml(label)}</span><span class="statValue ${cls}">${value}</span></div>`;

let ALLOC_VIEW = (function () { try { return localStorage.getItem('stock:allocView') || 'list'; } catch { return 'list'; } })();

// Right pane bubbles: compact stats + allocation + realized-P&L sparkline.
function renderSideBubbles() {
    const host = els.sideBubbles;
    if (!host) return;
    const acc = getActiveAccount();
    if (!acc) { host.innerHTML = ''; return; }
    const holdings = POSTS.filter((p) => String(p.accountId) === String(acc.id));
    const isWatch = acc.type === 'watchlist';
    const totals = computeAccountTotals(holdings);
    const cash = accountLedger(acc, holdings).cash;
    host.innerHTML = `
      ${isWatch ? '' : `<div class="statGrid">
        ${statTile('Invested', totals.marketValue != null ? fmtFullMoney(totals.marketValue) : '—')}
        ${statTile('Cash', fmtFullMoney(cash))}
        ${statTile('Realized', fmtSignedMoney(totals.realizedPnl), pnlClass(totals.realizedPnl))}
      </div>`}
      <div class="panelCard">
        <div class="panelCardHead">
          <strong>Allocation</strong>
          ${isWatch ? `<span class="muted">${holdings.length} tickers</span>` : `
            <div class="segmentToggle allocViewToggle" id="allocViewToggle" role="group" aria-label="Allocation view">
              <label class="segmentOption"><input type="radio" name="allocView" value="list" ${ALLOC_VIEW !== 'map' ? 'checked' : ''} /><span>List</span></label>
              <label class="segmentOption"><input type="radio" name="allocView" value="map" ${ALLOC_VIEW === 'map' ? 'checked' : ''} /><span>Map</span></label>
            </div>`}
        </div>
        <div id="allocationHost" class="allocationHost"></div>
      </div>
      ${isWatch ? '' : `<div class="panelCard">
        <div class="panelCardHead"><strong>Realized P&amp;L</strong><span class="muted">over trades</span></div>
        <div class="accountChartWrap"><canvas id="accountChartCanvas"></canvas></div>
      </div>`}
    `;
    renderAllocation(document.getElementById('allocationHost'), holdings, totals, isWatch, cash);
    document.getElementById('allocViewToggle')?.addEventListener('change', (e) => {
        ALLOC_VIEW = e.target.value === 'map' ? 'map' : 'list';
        try { localStorage.setItem('stock:allocView', ALLOC_VIEW); } catch {}
        renderSideBubbles();
    });
    if (!isWatch) {
        const cv = document.getElementById('accountChartCanvas');
        if (cv) drawAccountPnlChart(cv, holdings);
    }
}

function renderAllocation(host, holdings, totals, isWatch, cash = 0) {
    if (!host) return;
    if (isWatch) { host.classList.remove('isMap'); host.innerHTML = `<div class="muted allocEmpty">Watchlists track signals, not positions.</div>`; return; }
    const rows = holdings.map((p) => {
        const pos = holdingPosition(p);
        return { id: p.id, ticker: holdingTicker(p), value: pos.marketValue || 0, pct: pos.pct };
    }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    if (cash > 0) rows.push({ ticker: 'Cash', value: cash, isCash: true, pct: null });
    if (!rows.length) { host.classList.remove('isMap'); host.innerHTML = `<div class="muted allocEmpty">Add buy transactions or cash to see allocation.</div>`; return; }
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    const shown = rows.slice(0, 9);
    if (ALLOC_VIEW === 'map') { host.classList.add('isMap'); renderAllocationTreemap(host, shown, total); }
    else { host.classList.remove('isMap'); renderAllocationBars(host, shown, total); }
}

function renderAllocationBars(host, rows, total) {
    const palette = ['#165dff', '#177245', '#b7791f', '#9333ea', '#0891b2', '#b54753', '#0d9488', '#7c3aed'];
    host.innerHTML = rows.map((r, i) => {
        const pct = (r.value / total) * 100;
        const color = r.isCash ? 'var(--muted)' : palette[i % palette.length];
        return `
          <div class="allocRow">
            <div class="allocMeta"><span class="allocDot" style="background:${color}"></span><span class="allocTk">${escapeHtml(r.ticker)}</span><span class="allocPct muted">${pct.toFixed(1)}%</span></div>
            <div class="allocBarTrack"><div class="allocBarFill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
            <div class="allocVal">${fmtFullMoney(r.value)}</div>
          </div>`;
    }).join('');
}

// Heat color for a treemap cell from its unrealized P&L %: green/red tinted by
// magnitude (capped at ±25% for full saturation), neutral gray when there's no
// cost basis to compare against (e.g. the Cash cell).
function pnlTintColor(pct, border = false) {
    const n = Number(pct);
    if (pct == null || isNaN(n) || n === 0) return border ? 'rgba(93, 103, 120, 0.32)' : 'rgba(93, 103, 120, 0.14)';
    const mag = Math.min(Math.abs(n), 25) / 25;
    const rgb = n > 0 ? '23, 114, 69' : '181, 71, 83';
    const alpha = border ? (0.28 + mag * 0.42) : (0.16 + mag * 0.46);
    return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

// Squarified treemap (Bruls/Huizing/van Wijk): lays positive-`value` items into a
// [0,w]x[0,h] rectangle so areas stay proportional to value while keeping cells as
// close to square as possible. Returns each item extended with pixel {x,y,w,h}.
function squarifyTreemap(items, w, h) {
    if (!items.length || w <= 0 || h <= 0) return [];
    const total = items.reduce((s, it) => s + it.value, 0) || 1;
    const scale = (w * h) / total;
    const queue = items.map((it) => ({ ...it, area: it.value * scale }));
    const rects = [];
    let rx = 0, ry = 0, rw = w, rh = h, i = 0;
    while (i < queue.length && rw > 0 && rh > 0) {
        const side = Math.min(rw, rh);
        let row = [queue[i]];
        let worst = treemapWorstRatio(row, side);
        let j = i + 1;
        while (j < queue.length) {
            const trial = row.concat([queue[j]]);
            const trialWorst = treemapWorstRatio(trial, side);
            if (trialWorst > worst) break;
            row = trial; worst = trialWorst; j++;
        }
        i = j;
        const rowArea = row.reduce((s, d) => s + d.area, 0);
        const thickness = rowArea / side;
        if (rw >= rh) {
            let oy = ry;
            row.forEach((d) => {
                const len = (d.area / rowArea) * rh;
                rects.push({ ...d, x: rx, y: oy, w: thickness, h: len });
                oy += len;
            });
            rx += thickness; rw -= thickness;
        } else {
            let ox = rx;
            row.forEach((d) => {
                const len = (d.area / rowArea) * rw;
                rects.push({ ...d, x: ox, y: ry, w: len, h: thickness });
                ox += len;
            });
            ry += thickness; rh -= thickness;
        }
    }
    return rects;
}

// Worst (largest) width:height aspect ratio that laying `row` out along a strip
// of the given `side` length would produce — lower is squarer / more readable.
function treemapWorstRatio(row, side) {
    const sum = row.reduce((s, d) => s + d.area, 0);
    if (sum <= 0 || side <= 0) return Infinity;
    let amax = -Infinity, amin = Infinity;
    row.forEach((d) => { if (d.area > amax) amax = d.area; if (d.area < amin) amin = d.area; });
    const s2 = side * side, sum2 = sum * sum;
    return Math.max((s2 * amax) / sum2, sum2 / (s2 * amin));
}

function renderAllocationTreemap(host, rows, total) {
    const W = host.clientWidth || 280;
    const H = host.clientHeight || 230;
    const cells = squarifyTreemap(rows, W, H);
    host.innerHTML = '';
    cells.forEach((c) => {
        const weightPct = (c.value / total) * 100;
        const el = document.createElement('div');
        el.className = 'treemapCell' + (c.isCash ? ' isCash' : '');
        el.style.left = `${(c.x / W * 100).toFixed(3)}%`;
        el.style.top = `${(c.y / H * 100).toFixed(3)}%`;
        el.style.width = `${(c.w / W * 100).toFixed(3)}%`;
        el.style.height = `${(c.h / H * 100).toFixed(3)}%`;
        el.style.background = pnlTintColor(c.pct);
        el.style.borderColor = pnlTintColor(c.pct, true);
        el.title = `${c.ticker} · ${fmtFullMoney(c.value)} · ${weightPct.toFixed(1)}% of account` +
            (c.pct != null ? ` · ${fmtSignedPct(c.pct)} P&L` : '');
        const tk = document.createElement('span');
        tk.className = 'tmTk';
        tk.textContent = c.ticker;
        el.appendChild(tk);
        if (c.w >= 56 && c.h >= 40) {
            const wt = document.createElement('span');
            wt.className = 'tmWeight';
            wt.textContent = `${weightPct.toFixed(1)}%`;
            el.appendChild(wt);
        }
        if (c.w >= 80 && c.h >= 56 && c.pct != null) {
            const pl = document.createElement('span');
            pl.className = `tmPnl ${pnlClass(c.pct)}`;
            pl.textContent = fmtSignedPct(c.pct);
            el.appendChild(pl);
        }
        if (c.id) el.addEventListener('click', () => openDetail(c.id));
        host.appendChild(el);
    });
}

// --- Net-worth-over-time chart ---------------------------------------
let NW_PERIOD = (function () { try { return localStorage.getItem('stock:nwPeriod') || '6mo'; } catch { return '6mo'; } })();
let NW_MODE = (function () { try { return localStorage.getItem('stock:nwMode') || 'value'; } catch { return 'value'; } })();
let NETWORTH_CACHE = {};   // `${accountId}|${period}|${interval}` -> series
let LAST_NW_SERIES = null; // for resize redraw
let NW_HOVER_IDX = null;   // index into LAST_NW_SERIES.points while hovering/touching the chart

const NW_CHART_PAD = { l: 60, r: 16, t: 16, b: 28 };

// Calendar-day span of each fixed range. '5d' is labelled "1W"; 'all' is dynamic.
const NW_RANGE_DAYS = { '1d': 1, '5d': 5, '1mo': 30, '3mo': 91, '6mo': 182, '1y': 365, '2y': 730 };
const NW_RANGE_LABELS = { '1d': '1D', '5d': '1W', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', '2y': '2Y', all: 'ALL' };

// Explicit interval per fixed range, calibrated to ~8 trading hours/day (not 24h) so the tick
// granularity matches how much data actually exists in a session. yfinance has no 10m bar, so
// 1W uses the nearest valid interval (15m). 3M uses 1h (90m bars are only served for the last
// ~60 days by yfinance, which wouldn't cover the full 91-day window).
const NW_RANGE_INTERVAL = {
    '1d': '2m', '5d': '15m', '1mo': '1h', '3mo': '1h', '6mo': '1d', '1y': '1d', '2y': '1wk',
};

// yfinance's selectable intervals, with bar duration (minutes) and the max lookback yfinance
// will serve for each. Intraday bars are only available for short spans: 1m ≤ 7d; the
// 2m–90m group ≤ 60d; 1h ≤ 730d. Daily+ bars have effectively unlimited history.
const NW_INTERVALS = [
    { key: '1m',  min: 1,     maxDays: 7 },
    { key: '2m',  min: 2,     maxDays: 60 },
    { key: '5m',  min: 5,     maxDays: 60 },
    { key: '15m', min: 15,    maxDays: 60 },
    { key: '30m', min: 30,    maxDays: 60 },
    { key: '1h',  min: 60,    maxDays: 730 },
    { key: '90m', min: 90,    maxDays: 60 },
    { key: '1d',  min: 1440,  maxDays: Infinity },
    { key: '1wk', min: 10080, maxDays: Infinity },
    { key: '1mo', min: 43200, maxDays: Infinity },
];

function nwIsIntraday(interval) { return interval === '1h' || /^\d+m$/.test(interval); }
function nwIntervalMinutes(interval) {
    const it = NW_INTERVALS.find((x) => x.key === interval);
    return it ? it.min : 1440;
}

// Choose the yfinance interval whose bar duration is closest to span/100, so every range
// renders ~100 samples. e.g. 1D → 1day/100 ≈ 14.4min → 15m; 3M → ~1day → 1d; 2Y → ~1wk.
// Intervals whose max lookback can't cover the span are excluded.
function nwIntervalForDays(days) {
    const targetMin = (days * 1440) / 100;
    let best = '1d', bestDiff = Infinity;
    for (const it of NW_INTERVALS) {
        if (days > it.maxDays) continue;
        const diff = Math.abs(it.min - targetMin);
        if (diff < bestDiff) { bestDiff = diff; best = it.key; }
    }
    return best;
}

// Smallest yfinance `period` string that fully covers `days` of history.
function nwPeriodForDays(days) {
    if (days <= 5) return '5d';
    if (days <= 30) return '1mo';
    if (days <= 91) return '3mo';
    if (days <= 182) return '6mo';
    if (days <= 365) return '1y';
    if (days <= 730) return '2y';
    if (days <= 1825) return '5y';
    if (days <= 3650) return '10y';
    return 'max';
}

// Earliest deposit/withdrawal/trade date for the account, as 'YYYY-MM-DD' (or null).
function accountFirstActivityDate(acc, holdings) {
    let min = null;
    const consider = (d) => { const s = String(d || '').slice(0, 10); if (s && (min === null || s < min)) min = s; };
    (acc?.cashFlows || []).forEach((cf) => consider(cf?.date));
    (holdings || []).forEach((p) => (p.transactions || []).forEach((t) => {
        if (t && (t.type === 'buy' || t.type === 'sell') && Number(t.shares) > 0) consider(t.date);
    }));
    return min;
}

function daysSinceDate(dateStr) {
    if (!dateStr) return 0;
    const a = new Date(`${dateStr}T00:00:00`);
    if (isNaN(a.getTime())) return 0;
    return Math.max(0, Math.round((Date.now() - a.getTime()) / 86400000));
}

// Resolve fetch/interval/clip-window for a range key. 'all' is dynamic: it spans from the
// first account activity to today, with a sample interval (and therefore x-axis tick size)
// of roughly span/100 — e.g. ~100 months of history yields ~monthly ticks.
function nwRangeConfig(rangeKey, acc, holdings) {
    if (rangeKey === 'all') {
        const fa = accountFirstActivityDate(acc, holdings);
        const days = fa ? daysSinceDate(fa) + 1 : 30;
        return { key: 'all', days, interval: nwIntervalForDays(days), fetch: nwPeriodForDays(days) };
    }
    const days = NW_RANGE_DAYS[rangeKey] || 30;
    const interval = NW_RANGE_INTERVAL[rangeKey] || nwIntervalForDays(days);
    // Intraday spans need a couple of prior sessions seeded for carry-forward, so over-fetch
    // the very short windows to 5d; otherwise fetch the window itself.
    const fetch = nwIsIntraday(interval) && days <= 5 ? '5d' : rangeKey;
    return { key: rangeKey, days, interval, fetch };
}

// Bucket key for a price-history timestamp: minute resolution (snapped to the interval grid)
// for intraday intervals, calendar-day resolution otherwise (matches how transactions/cash
// flows are dated). Intraday keys are 'YYYY-MM-DDTHH:MM'; daily keys are 'YYYY-MM-DD'.
function nwBucketKey(ts, interval) {
    if (!nwIsIntraday(interval)) return new Date(ts).toISOString().slice(0, 10);
    const stepMs = nwIntervalMinutes(interval) * 60000;
    const snapped = Math.floor(ts / stepMs) * stepMs;
    return new Date(snapped).toISOString().slice(0, 16);
}

function fmtNwPointDate(ds) {
    if (!ds) return '';
    if (ds.length > 10) { // intraday bucket key: YYYY-MM-DDTHH or YYYY-MM-DDTHH:MM
        const iso = ds.length >= 16 ? `${ds}:00Z` : `${ds}:00:00Z`;
        const d = new Date(iso);
        return isNaN(d.getTime()) ? ds : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    return ds;
}

function invalidateNetworth(accountId) {
    if (!accountId) { NETWORTH_CACHE = {}; return; }
    Object.keys(NETWORTH_CACHE).forEach((k) => { if (k.startsWith(accountId + '|')) delete NETWORTH_CACHE[k]; });
}

async function loadNetworthChart(acc, holdings, period) {
    const canvas = document.getElementById('networthCanvas');
    if (!canvas) return;
    const withTx = holdings.filter((p) => (p.transactions || []).length);
    const ledger = accountLedger(acc, holdings);
    const cfg = nwRangeConfig(period, acc, holdings);
    const interval = cfg.interval;
    const fetchPeriod = cfg.fetch;
    const key = `${acc.id}|${period}|${interval}|${cfg.days}`;
    NW_HOVER_IDX = null;
    if (NETWORTH_CACHE[key]) { LAST_NW_SERIES = NETWORTH_CACHE[key]; drawNetworthChart(canvas, LAST_NW_SERIES); updatePeriodReturnLabel(period, LAST_NW_SERIES); }
    else { drawNetworthChart(canvas, null); updatePeriodReturnLabel(period, null); }
    if (!withTx.length) {
        const flat = { points: [], contributions: ledger.contributions, netNow: ledger.cash, hasData: false };
        NETWORTH_CACHE[key] = flat; LAST_NW_SERIES = flat; drawNetworthChart(canvas, flat); updatePeriodReturnLabel(period, flat);
        return;
    }
    try {
        const entries = await Promise.all(withTx.map(async (p) => {
            const tk = holdingTicker(p);
            try { return { p, tk, hist: await api(`/api/chart?ticker=${encodeURIComponent(tk)}&period=${encodeURIComponent(fetchPeriod)}&interval=${encodeURIComponent(interval)}`) }; }
            catch { return { p, tk, hist: null }; }
        }));
        let series = computeNetworthSeries(entries, acc.cashFlows || [], interval);
        // Clip to the visible window [today - span, today]. computeNetworthSeries keeps the
        // pre-activity prefix flat and flags it as `noData`, so clipping just frames the
        // selected range while preserving the gray "no data" lead-in within it.
        if (series.hasData) {
            const cutoff = Date.now() - cfg.days * 86400000;
            const clipFrom = nwIsIntraday(interval)
                ? new Date(cutoff).toISOString().slice(0, 16)
                : new Date(cutoff).toISOString().slice(0, 10);
            const clipped = series.points.filter((p) => p.date >= clipFrom);
            if (clipped.length > 1) series = { ...series, points: clipped };
        }
        // Cache under `key` unconditionally (useful for other future range switches), but only
        // promote to LAST_NW_SERIES / redraw if this response still matches what's on screen.
        // Without this guard, a slower request for a range the user has since clicked away from
        // can resolve later and silently clobber LAST_NW_SERIES — its own draw call is skipped,
        // but the next hover reads the stale series and redraws the wrong range over the chart.
        NETWORTH_CACHE[key] = series;
        const cv = document.getElementById('networthCanvas');
        if (cv && getActiveAccount()?.id === acc.id && NW_PERIOD === period) {
            LAST_NW_SERIES = series;
            drawNetworthChart(cv, series);
            updatePeriodReturnLabel(period, series);
        }
    } catch (e) { console.warn('net worth build failed', e); }
}

// Pure: per-day net worth (cash + holdings@close) AND contributions (net deposits)
// from price history, transactions, and the account's cash flows. Same cash rules
// as accountLedger(): cash may go negative, nothing is auto-deposited.
function computeNetworthSeries(entries, cashFlows, interval = '1d') {
    const dateSet = new Set();
    const closeMaps = {};
    entries.forEach(({ tk, hist }) => {
        const m = new Map();
        if (hist && Array.isArray(hist.timestamps)) {
            hist.timestamps.forEach((ts, i) => { const ds = nwBucketKey(ts, interval); m.set(ds, hist.closes[i]); dateSet.add(ds); });
        }
        closeMaps[tk] = m;
    });
    const txByTk = {};
    entries.forEach(({ p, tk }) => {
        txByTk[tk] = (p.transactions || [])
            .filter((t) => t && (t.type === 'buy' || t.type === 'sell') && Number(t.shares) > 0)
            .slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    });

    // Ordered cash-event stream: deposits/withdrawals + buys/sells.
    const events = [];
    (cashFlows || []).forEach((cf) => { const amt = Number(cf?.amount) || 0; if (amt > 0) { const kind = cf.type === 'withdrawal' ? 'withdraw' : (cf.type === 'dividend' || cf.type === 'outside-gain') ? 'dividend' : (cf.type === 'fee' || cf.type === 'outside-loss') ? 'fee' : 'deposit'; events.push({ date: String(cf.date || ''), kind, amount: amt }); } });
    entries.forEach(({ p }) => (p.transactions || []).forEach((t) => {
        if (!t || (t.type !== 'buy' && t.type !== 'sell') || !(Number(t.shares) > 0)) return;
        const gross = Number(t.shares) * Number(t.price), fee = Number(t.fee) || 0;
        events.push({ date: String(t.date || ''), kind: t.type, amount: t.type === 'buy' ? gross + fee : gross - fee });
    }));
    events.sort((a, b) => a.date.localeCompare(b.date));

    // Daily close history can lag "today" by a session or more (e.g. a deposit/buy made
    // today has no close yet). Without this, an event dated past the last available close
    // is never walked — the series stays all-zero and the "trim empty prefix" step finds
    // nothing to trim to. Stretch the date axis to cover every event plus today; the
    // carry-forward `lastClose` below prices those extra days at the latest known close.
    // For daily+ modes, adding the event date ensures transactions that fall after the last
    // available close are still walked and their cash-flow effect is reflected. Intraday modes
    // intentionally use only the real market-hours bars yfinance returns (see below).
    const intraday = nwIsIntraday(interval);
    events.forEach((e) => { if (e.date && !intraday) dateSet.add(e.date); });
    if (!intraday) dateSet.add(todayLocalDate());

    let dates = Array.from(dateSet).sort();

    // Intraday: do NOT synthesize buckets for off-market spans. yfinance only returns bars
    // during market hours, so plotting those bars directly (concatenated by sample index)
    // gives a continuous Robinhood-style line — overnight/weekend gaps collapse to a single
    // segment between sessions instead of a long flat carry-forward stretch. We also skip the
    // "now" bucket so the line ends at the last real trade rather than dragging flat to the
    // current off-market time.
    if (!dates.length) return { points: [], contributions: 0, netNow: 0, hasData: false };

    let cash = 0, contributions = 0, evi = 0;
    const lastClose = {}; entries.forEach(({ tk }) => { lastClose[tk] = null; });
    let points = dates.map((ds) => {
        while (evi < events.length && events[evi].date <= ds) {
            const e = events[evi++];
            if (e.kind === 'deposit') { cash += e.amount; contributions += e.amount; }
            else if (e.kind === 'withdraw') { cash -= e.amount; contributions -= e.amount; }
            else if (e.kind === 'buy') { cash -= e.amount; }
            else if (e.kind === 'sell') { cash += e.amount; }
            else if (e.kind === 'dividend') { cash += e.amount; }
            else if (e.kind === 'fee') { cash -= e.amount; }
        }
        let holdings = 0;
        entries.forEach(({ tk }) => {
            const c = closeMaps[tk].get(ds); if (c != null) lastClose[tk] = c;
            const close = lastClose[tk]; if (close == null) return;
            let sh = 0;
            for (const t of txByTk[tk]) { if (String(t.date || '') <= ds) sh += (t.type === 'buy' ? 1 : -1) * Number(t.shares); else break; }
            if (sh > 0) holdings += sh * close;
        });
        return { date: ds, value: cash + holdings, contributions };
    });
    // Instead of trimming the empty prefix before first activity, keep those points and flag
    // them `noData`, flattening them to the first real value. The chart renders that span as a
    // flat gray line back to the start of the selected range (rather than a misleading drop to
    // zero), so a 1-day-old account still fills out a 1M/3M window with a clear "no data" lead-in.
    const firstEvent = events.length ? events[0].date.slice(0, 10) : null;
    if (firstEvent) {
        let firstRealIdx = points.findIndex((p) => p.date.slice(0, 10) >= firstEvent);
        if (firstRealIdx < 0) firstRealIdx = points.length - 1;
        const seed = points[firstRealIdx] || points[points.length - 1];
        const seedVal = seed ? seed.value : 0;
        const seedContrib = seed ? seed.contributions : 0;
        points = points.map((p, i) => i < firstRealIdx
            ? { ...p, value: seedVal, contributions: seedContrib, noData: true }
            : p);
    }
    return { points, contributions, netNow: points.length ? points[points.length - 1].value : 0, hasData: true };
}

// Return over just the selected window, as opposed to the account's whole-life total
// return: last point's (value − contributions) minus the window's starting value. A window
// that starts before the account existed naturally collapses to the total return, since
// computeNetworthSeries seeds the noData prefix to the first real point's value/contributions.
function periodReturnFromSeries(series) {
    const pts = series?.points || [];
    if (!series?.hasData || pts.length < 2) return null;
    const first = pts[0], last = pts[pts.length - 1];
    const abs = (last.value - last.contributions) - (first.value - first.contributions);
    const pct = first.contributions > 0 ? (abs / first.contributions) * 100 : null;
    return { abs, pct };
}

// 'all' already IS the whole-life window, so its period return would just repeat the
// headline's total return — skip the label there to avoid showing the same number twice.
function updatePeriodReturnLabel(period, series) {
    const el = document.getElementById('nwPeriodReturn');
    if (!el) return;
    if (period === 'all') { el.textContent = ''; return; }
    const r = periodReturnFromSeries(series);
    if (!r) { el.textContent = series === null ? 'Loading…' : ''; el.className = 'nwPeriodReturn muted'; return; }
    const label = NW_RANGE_LABELS[period] || period;
    el.innerHTML = `${label} return: <span class="${pnlClass(r.abs)}">${fmtSignedMoney(r.abs)}${r.pct != null ? ` (${fmtSignedPct(r.pct)})` : ''}</span>`;
    el.className = 'nwPeriodReturn';
}

function hexA(hex, a) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Draws Value (net worth + dashed contributions baseline) or Return (value − contributions).
function drawNetworthChart(canvas, series) {
    const { ctx, w, h } = prepCanvas(canvas, Math.max(240, canvas.clientHeight || 320));
    ctx.clearRect(0, 0, w, h);
    const muted = cssVar('--muted', '#5d6778');
    const buy = cssVar('--buy', '#177245'), sell = cssVar('--sell', '#b54753'), border = cssVar('--border', 'rgba(0,0,0,.1)');
    const returnMode = NW_MODE === 'return';
    ctx.font = '12px "IBM Plex Sans", sans-serif'; ctx.textBaseline = 'middle';
    if (!series || !series.hasData || !(series.points || []).length) {
        ctx.fillStyle = muted; ctx.textAlign = 'center';
        const msg = series && series.netNow != null
            ? `${returnMode ? 'Return' : 'Net worth'} ${fmtFullMoney(returnMode ? (series.netNow - (series.contributions || 0)) : series.netNow)} — record transactions to chart history.`
            : 'Loading…';
        ctx.fillText(msg, w / 2, h / 2);
        return;
    }
    const pts = series.points;
    const pv = (p) => returnMode ? (p.value - p.contributions) : p.value;
    const { l: padL, r: padR, t: padT, b: padB } = NW_CHART_PAD;
    const plotW = Math.max(10, w - padL - padR), plotH = Math.max(10, h - padT - padB);
    if (pts.length === 1) {
        const v = pv(pts[0]), y = padT + plotH / 2;
        ctx.strokeStyle = border; ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = cssVar('--text', '#142032'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.font = '15px "Space Grotesk", sans-serif';
        ctx.fillText(returnMode ? fmtSignedMoney(v) : fmtFullMoney(v), padL + plotW / 2, y - 6);
        ctx.fillStyle = muted; ctx.textBaseline = 'top'; ctx.font = '12px "IBM Plex Sans", sans-serif';
        ctx.fillText(`${fmtNwPointDate(pts[0].date)} · add more history to see a trend`, padL + plotW / 2, y + 6);
        return;
    }
    const baseVals = returnMode ? [] : pts.map((p) => p.contributions);
    const lineVals = pts.map(pv);
    const allVals = lineVals.concat(baseVals).concat(returnMode ? [0] : []);
    let mn = Math.min(...allVals), mx = Math.max(...allVals);
    if (mn === mx) { mn = mn - Math.abs(mn || 1) * 0.05; mx = mx + Math.abs(mx || 1) * 0.05; }
    const padV = (mx - mn) * 0.08; mn -= padV; mx += padV;
    if (!returnMode) mn = Math.max(0, mn);
    const X = (i) => padL + plotW * (i / Math.max(1, pts.length - 1));
    const Y = (v) => padT + plotH * (1 - (v - mn) / (mx - mn || 1));
    // In return mode, color reflects whether the total return is currently positive or
    // negative (matches the headline's pnlClass), not the in-window trend — otherwise a
    // positive return that dipped within the selected window paints red while the headline
    // above it still reads "+3.21%", which looks contradictory.
    const col = returnMode
        ? (lineVals[lineVals.length - 1] >= 0 ? buy : sell)
        : (lineVals[lineVals.length - 1] >= lineVals[0] ? buy : sell);
    // gridlines + y labels
    ctx.fillStyle = muted; ctx.strokeStyle = border;
    [mx, (mx + mn) / 2, mn].forEach((v) => {
        ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(padL + plotW, Y(v)); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.textAlign = 'right'; ctx.fillText(returnMode ? fmtSignedCompactMoney(v) : fmtCompactMoney(v), padL - 8, Y(v));
    });
    if (returnMode && mn < 0 && mx > 0) { // emphasize the zero line
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + plotW, Y(0)); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // The leading `noData` points (before the account's first activity) are drawn as a flat
    // gray line; the real series after them keeps the buy/sell color, area fill and baseline.
    const firstRealIdx = Math.max(0, pts.findIndex((p) => !p.noData));
    const baseY = Y(returnMode ? Math.max(mn, 0) : mn);
    // area under the real (colored) segment only
    if (firstRealIdx < pts.length - 1) {
        ctx.beginPath();
        for (let i = firstRealIdx; i < pts.length; i++) { const x = X(i), y = Y(pv(pts[i])); i === firstRealIdx ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.lineTo(X(pts.length - 1), baseY); ctx.lineTo(X(firstRealIdx), baseY); ctx.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, hexA(col, 0.22)); grad.addColorStop(1, hexA(col, 0.02));
        ctx.fillStyle = grad; ctx.fill();
    }
    // contributions baseline (value mode only)
    if (!returnMode) {
        ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath();
        pts.forEach((p, i) => { const x = X(i), y = Y(p.contributions); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
    }
    // gray "no data" lead-in: flat line from the range start up to the first real point
    if (firstRealIdx > 0) {
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.7; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i <= firstRealIdx; i++) { const x = X(i), y = Y(pv(pts[i])); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke(); ctx.globalAlpha = 1;
    }
    // main (colored) line over the real segment
    ctx.beginPath();
    for (let i = firstRealIdx; i < pts.length; i++) { const x = X(i), y = Y(pv(pts[i])); i === firstRealIdx ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    // mark the first real point when there is a gray lead-in
    if (firstRealIdx > 0) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(firstRealIdx), Y(pv(pts[firstRealIdx])), 3, 0, Math.PI * 2); ctx.fill();
    }
    // x labels (start / middle / end)
    ctx.fillStyle = muted; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(fmtNwPointDate(pts[0].date), padL, padT + plotH + 8);
    if (pts.length > 2) { ctx.textAlign = 'center'; ctx.fillText(fmtNwPointDate(pts[Math.floor((pts.length - 1) / 2)].date), padL + plotW / 2, padT + plotH + 8); }
    ctx.textAlign = 'right'; ctx.fillText(fmtNwPointDate(pts[pts.length - 1].date), padL + plotW, padT + plotH + 8);

    // Hover/touch crosshair: vertical + horizontal guide lines and a dot on the series.
    if (NW_HOVER_IDX != null && NW_HOVER_IDX >= 0 && NW_HOVER_IDX < pts.length) {
        const x = X(NW_HOVER_IDX), y = Y(pv(pts[NW_HOVER_IDX]));
        ctx.save();
        ctx.strokeStyle = muted; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

function renderHoldingsList() {
    const host = els.holdingsList;
    if (!host) return;
    const acc = getActiveAccount();
    const q = (els.searchBox?.value || '').toLowerCase().trim();
    const wq = (els.watchingSearchBox?.value || '').toLowerCase().trim();
    if (!acc) {
        host.innerHTML = `<div class="empty-state"><div class="muted">Create an account to start tracking holdings.</div></div>`;
        if (els.holdingsTitle) els.holdingsTitle.textContent = 'Holdings';
        if (els.holdingsMeta) els.holdingsMeta.textContent = '';
        if (els.watchingPanel) els.watchingPanel.hidden = true;
        return;
    }
    const isWatch = acc.type === 'watchlist';
    const all = POSTS.filter((p) => String(p.accountId) === String(acc.id));
    const holdings = holdingsForAccount(acc.id, q);
    // The Watching panel has its own search box, so it re-queries independently
    // rather than reusing the Holdings list's filtered set.
    const watchSrc = isWatch ? [] : holdingsForAccount(acc.id, wq);
    if (els.holdingsTitle) els.holdingsTitle.textContent = isWatch ? 'Watching' : 'Holdings';

    // A regular account's holdings with no shares left (fully sold) auto-move out of
    // Holdings into the Watching panel below — watchlist-type accounts are unaffected
    // since every ticker there is already "watching" by definition.
    const held = isWatch ? holdings : holdings.filter((p) => holdingPosition(p).shares > 0);
    const watching = isWatch ? [] : watchSrc.filter((p) => holdingPosition(p).shares <= 0);
    const allHeld = isWatch ? all : all.filter((p) => holdingPosition(p).shares > 0);
    const allWatching = isWatch ? [] : all.filter((p) => holdingPosition(p).shares <= 0);

    if (els.holdingsMeta) {
        els.holdingsMeta.textContent = q
            ? `${held.length} of ${allHeld.length} shown`
            : `${allHeld.length} ${isWatch ? 'tickers' : 'positions'}`;
    }
    renderHoldingsInto(host, held, acc, isWatch, {
        showAdd: true,
        emptyText: q ? 'No holdings match your search.' : `No ${isWatch ? 'tickers' : 'holdings'} in this ${isWatch ? 'watchlist' : 'account'} yet.`,
        addLabel: `+ Add ${isWatch ? 'Ticker' : 'Holding'}`,
        hasQuery: !!q,
    });

    if (els.watchingPanel) {
        els.watchingPanel.hidden = isWatch;
        if (!isWatch) {
            if (els.watchingMeta) {
                els.watchingMeta.textContent = wq
                    ? `${watching.length} of ${allWatching.length} shown`
                    : `${allWatching.length} ticker${allWatching.length === 1 ? '' : 's'}`;
            }
            renderHoldingsInto(els.watchingList, watching, acc, false, {
                showAdd: true,
                emptyText: wq ? 'No tickers match your search.' : 'No tickers being watched right now — sold-out positions land here automatically.',
                addLabel: '+ Add Ticker',
                hasQuery: !!wq,
            });
        }
    }

    // Background-refresh current prices, throttled (across both lists)
    const now = Date.now();
    [...held, ...watching].slice(0, 12).forEach((p, i) => {
        const last = LAST_REFRESH.get(p.id) || 0;
        if (now - last < 60000) return;
        setTimeout(() => refreshSnapshot(p.id), i * 200);
    });
}

// Shared renderer for the Holdings and Watching panels: empty-state vs. a row per holding,
// optionally with an "+ Add" trailer row.
function renderHoldingsInto(host, list, acc, isWatch, { showAdd, emptyText, addLabel, hasQuery } = {}) {
    if (!host) return;
    if (!list.length) {
        const canAdd = showAdd && addLabel && !hasQuery && canEditAccount(acc);
        host.innerHTML = `<div class="empty-state">
          <div class="muted">${emptyText}</div>
          ${canAdd ? `<button class="primary addHoldingTrigger" type="button">${addLabel}</button>` : ''}
        </div>`;
        host.querySelectorAll('.addHoldingTrigger').forEach((b) => b.addEventListener('click', () => openNew()));
        return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'holdingTable' + (isWatch ? ' isWatch' : '');
    list.forEach((post) => wrap.appendChild(buildHoldingRow(post, isWatch)));
    if (showAdd && addLabel && canEditAccount(acc)) wrap.appendChild(buildAddHoldingRow(addLabel));
    host.innerHTML = '';
    host.appendChild(wrap);
}

// Compact two-column row that fits the narrow side panel without overflow:
// left = ticker + sub-line, right = value/last + P&L% + signal.
function buildHoldingRow(post, isWatch) {
    const ticker = holdingTicker(post);
    const pos = holdingPosition(post);
    const suggestion = getPrimarySuggestion(post);
    const row = document.createElement('div');
    row.setAttribute('data-id', post.id);
    const running = ['queued', 'running'].includes(getStatusState(post));
    const statusBadge = running ? getStatusBadgeHtml(post) : '';
    const sigBadge = `<span class="badge suggestion ${classBySuggestion(suggestion)}">${escapeHtml(suggestion || '')}</span>`;
    const pendingComments = pendingCommentCount(post);
    const commentDot = pendingComments ? `<span class="commentDot" title="${pendingComments} un-handled comment${pendingComments === 1 ? '' : 's'}"></span>` : '';

    // The AI suggestion (buy/sell/hold) only colors the row when there's no actual position
    // to judge — once shares are held, the row accent + value text instead track real P&L
    // (day or total, per the toggle), so a "Hold"-rated stock that's up doesn't read as grey/dead.
    let sub, primary, secondary, accentCls, tkCls = '';
    if (isWatch) {
        sub = post.title && post.title !== ticker ? post.title : (post.note || 'watching');
        primary = pos.current != null ? fmtMoney(pos.current) : '—';
        secondary = '';
        accentCls = classBySuggestion(suggestion);
    } else if (pos.shares > 0) {
        sub = `${fmtShares(pos.shares)} sh · avg ${pos.avgCost != null ? fmtMoney(pos.avgCost) : '—'}`;
        const pnlAbs = HOLD_SEC_MODE === 'day' ? pos.dayChange : pos.unrealizedPnl;
        const pnlPct = HOLD_SEC_MODE === 'day' ? pos.dayChangePct : pos.pct;
        accentCls = accentByPnl(pnlAbs);
        tkCls = pnlClass(pnlAbs);
        primary = pos.marketValue != null ? `<span class="${tkCls}">${fmtFullMoney(pos.marketValue)}</span>` : '—';
        secondary = pnlAbs != null
            ? `<span class="${tkCls}">${fmtSignedMoney(pnlAbs)}${pnlPct != null ? ` · ${fmtSignedPct(pnlPct)}` : ''}</span>`
            : '';
    } else {
        sub = post.title && post.title !== ticker ? post.title : 'no position';
        primary = pos.current != null ? fmtMoney(pos.current) : '—';
        secondary = '<span class="muted">not held</span>';
        accentCls = classBySuggestion(suggestion);
    }
    row.className = `holdingRow rowAccent ${accentCls}`;

    row.innerHTML = `
      <div class="hMain">
        <div class="hTopline"><span class="htk ${tkCls}">${escapeHtml(ticker)}</span> ${sigBadge}${statusBadge}${commentDot}</div>
        <div class="hSub muted">${escapeHtml(sub)}</div>
      </div>
      <div class="hStats">
        <div class="hPrimary">${primary}</div>
        <div class="hSecondary">${secondary}</div>
      </div>`;
    row.addEventListener('click', () => openDetail(post.id));
    return row;
}

// Add-holding action styled as a row at the bottom of the holdings list.
function buildAddHoldingRow(label) {
    const row = document.createElement('div');
    row.className = 'holdingRow holdingAddRow';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.innerHTML = `
      <div class="hMain">
        <div class="hTopline"><span class="htk">${escapeHtml(label)}</span></div>
      </div>`;
    const trigger = () => openNew();
    row.addEventListener('click', trigger);
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
    });
    return row;
}

function rowSuggestion(p, primary) {
    const a = p.analysis || {};
    const pt = (a.per_ticker || {})[primary] || {};
    return pt.suggestion || "Hold";
}

function fillAccountSelect(selectedId) {
    if (!els.pAccount) return;
    els.pAccount.innerHTML = ACCOUNTS.map((a) =>
        `<option value="${a.id}" ${String(a.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(a.name)}${a.type === 'watchlist' ? ' (watchlist)' : ''}</option>`
    ).join('');
}

function openNew() {
    const acc = getActiveAccount();
    if (!canEditAccount(acc)) { unlockAccount(acc); return; }
    editingId = null;
    els.dlgTitle.textContent = 'Add Holding';
    els.saveDlg.textContent = 'Save Holding';
    els.pTicker.value = "";
    els.pTitle.value = "";
    els.pNote.value = "";
    fillAccountSelect((getActiveAccount() || {}).id);
    els.postDlg.showModal();
    setTimeout(() => { try { els.pTicker.focus(); } catch {} }, 40);
}

function openEdit(p) {
    editingId = p.id;
    els.dlgTitle.textContent = 'Edit Holding';
    els.saveDlg.textContent = 'Update Holding';
    els.pTicker.value = holdingTicker(p);
    els.pTitle.value = p.title || "";
    els.pNote.value = p.note || p.description || "";
    fillAccountSelect(p.accountId);
    els.postDlg.showModal();
}

async function removePost(id) {
    if (!confirm("Delete this holding and its transaction history?")) return;
    await api(`/api/stocks/${encodeURIComponent(id)}`, { method: "DELETE" });
    invalidateNetworth();
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
    if (post.analysis?.reportOmitted) return 'Loading report…';
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
        els.dAnalyze.textContent = 'Stop';
        els.dAnalyze.classList.add('state-running');
        return;
    }
    if (state === 'queued') {
        els.dAnalyze.textContent = 'Dequeue';
        els.dAnalyze.classList.add('state-queued');
        return;
    }
    if (state === 'stopped') {
        els.dAnalyze.textContent = 'Requeue';
        els.dAnalyze.classList.add('state-stopped');
        return;
    }
    els.dAnalyze.textContent = post.analysis?.completedAt ? 'Re-run' : 'Analyze';
    els.dAnalyze.classList.add('primary');
}

// Reflect a holding's market-close auto-analyze opt-in on its toggle button.
function renderAutoAnalyzeButton(id) {
    const btn = els.dAutoAnalyze;
    if (!btn) return;
    const post = getPostById(id);
    const on = !!(post && post.autoAnalyze);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
    const label = btn.querySelector('.btnTxt');
    if (label) label.textContent = on ? 'Auto: On' : 'Auto: Off';
    btn.title = on
        ? 'Auto-analyzing at market close — click to turn off'
        : 'Auto-analyze at market close is off — click to turn on';
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
            renderAll();
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
    const account = accountById(post.accountId);
    const pos = holdingPosition(post);
    if (els.dTitle) els.dTitle.textContent = `${holdingTicker(post)}${post.title && post.title !== holdingTicker(post) ? ' · ' + post.title : ''}`;
    if (els.dSubtitle) {
        const subtitleParts = [
            account ? account.name : null,
            pos.shares > 0 ? `${fmtShares(pos.shares)} sh @ ${fmtMoney(pos.avgCost)}` : 'no position',
            preset.label || 'Balanced',
            status,
        ].filter(Boolean);
        els.dSubtitle.textContent = subtitleParts.join(' · ');
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
    if (snapshotHost) snapshotHost.innerHTML = renderPositionCard(post);

    const txnList = document.getElementById('txnList');
    if (txnList) txnList.innerHTML = renderTxnList(post);
    bindTxnListActions(post.id);

    const commentsHost = document.getElementById('dComments');
    if (commentsHost) {
        commentsHost.innerHTML = renderComments(post);
        bindCommentActions(post.id);
    }
    const commentsMeta = document.getElementById('dCommentsMeta');
    if (commentsMeta) {
        const total = (post.comments || []).length;
        const pending = pendingCommentCount(post);
        commentsMeta.textContent = total ? `${total} total${pending ? ` · ${pending} un-handled` : ''}` : '';
    }
    const tradeMeta = document.getElementById('tradeMeta');
    if (tradeMeta) {
        const n = (post.transactions || []).length;
        tradeMeta.textContent = n ? `${n} transaction${n === 1 ? '' : 's'} · realized ${fmtSignedMoney(pos.realizedPnl)}` : 'No transactions yet — add a buy to start tracking.';
    }
    // Redraw the trade chart if its panel is currently visible.
    const tradePanel = els.dContent?.querySelector('.detailPanel[data-tab="trades"]');
    if (tradePanel && !tradePanel.hidden) redrawTradeChart(post.id);

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

    const primary = holdingTicker(p);
    els.dContent.innerHTML = `
        <div class="detailTabs" id="detailTabs" role="tablist">
            <button type="button" class="detailTab is-active" data-tab="overview">Overview</button>
            <button type="button" class="detailTab" data-tab="trades">Trades &amp; P&amp;L</button>
            <button type="button" class="detailTab" data-tab="fundamentals">Fundamentals</button>
            <button type="button" class="detailTab" data-tab="report">Report</button>
        </div>

        <section class="detailPanel" data-tab="overview">
            <div id="dMetaGrid" class="detailMetaGrid"></div>
            <div id="dProgressHost"></div>
            <div class="chartWrap">
                <div class="chartHead">
                    <div class="chartTitleBlock">
                        <div class="chartEyebrow">Market structure</div>
                        <div class="chartTitleRow"><strong>Price &amp; volume</strong> <span class="muted" id="cMeta"></span></div>
                        <div id="cCursorMeta" class="chartCursorMeta">Touch, drag, or hover the chart to inspect the active area.</div>
                    </div>
                    <div class="chartSettingsAnchor">
                        <button id="cSettingsBtn" class="chartSettingsBtn" type="button" aria-expanded="false" aria-controls="cSettingsPopover" aria-label="Chart settings">⚙ <span class="btnTxt">Settings</span></button>
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
            <div class="overviewSplit">
                <div class="panelCard">
                    <div class="panelCardHead"><strong>Position</strong></div>
                    <div id="dSnapshot"></div>
                </div>
                <div class="panelCard">
                    <div class="panelCardHead"><strong>Summary</strong></div>
                    <pre id="dSummary" class="pre-card"></pre>
                </div>
            </div>
            <div class="panelCard commentsCard">
                <div class="panelCardHead"><strong>Comments</strong> <span class="muted" id="dCommentsMeta"></span></div>
                <div class="commentComposer">
                    <textarea id="commentInput" rows="2" placeholder="Add a comment…"></textarea>
                    <button class="primary" id="addCommentBtn" type="button">Add</button>
                </div>
                <div id="dComments" class="commentList"></div>
            </div>
        </section>

        <section class="detailPanel" data-tab="trades" hidden>
            <div class="txnHead">
                <div>
                    <h3>Trade history &amp; P&amp;L</h3>
                    <p class="sectionNote" id="tradeMeta"></p>
                </div>
                <div class="inline" style="gap:6px">
                    <button class="ghost buyBtn" id="addBuyBtn" type="button">+ Buy</button>
                    <button class="ghost sellBtn" id="addSellBtn" type="button">+ Sell</button>
                </div>
            </div>
            <div class="tradeChartWrap"><canvas id="tradeChartCanvas"></canvas></div>
            <div class="tradeChartLegend" id="tradeChartLegend"></div>
            <div id="txnList" class="txnList"></div>
        </section>

        <section class="detailPanel" data-tab="fundamentals" hidden>
            <div class="fundHead">
                <div>
                    <h3>Fundamentals</h3>
                    <p class="sectionNote" id="fundMeta">Key metrics from yfinance, scored against the cheat-sheet benchmarks.</p>
                </div>
                <button class="ghost" id="fundGuideBtn" type="button">Open Metric Guide</button>
            </div>
            <div id="fundamentalsHost"></div>
        </section>

        <section class="detailPanel" data-tab="report" hidden>
            ${analysisConfigMarkup()}
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

    // Detail sub-tab switching
    const detailTabs = els.dContent.querySelector('#detailTabs');
    const detailPanels = Array.from(els.dContent.querySelectorAll('.detailPanel'));
    function showDetailTab(name) {
        detailTabs.querySelectorAll('.detailTab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
        detailPanels.forEach((panel) => { panel.hidden = panel.dataset.tab !== name; });
        if (name === 'overview') { setTimeout(() => redrawActiveChart(), 0); }
        else if (name === 'trades') { setTimeout(() => redrawTradeChart(id), 0); }
        else if (name === 'fundamentals') { loadFundamentalsInto(primary); }
    }
    detailTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.detailTab');
        if (btn) showDetailTab(btn.dataset.tab);
    });

    // TradingAgents config (Report tab): populate from the holding's saved options, keep preset
    // cards interactive, and persist edits back to the holding.
    setFormFromOptions(p.options || {});
    els.dContent.querySelectorAll('input[name="analysisPreset"]').forEach((input) => {
        input.addEventListener('change', () => setPresetOnForm(input.value, true));
    });
    const persistAnalysisConfig = async () => {
        const fresh = getPostById(id) || p;
        const options = buildOptionsFromForm();
        const body = {
            ticker: holdingTicker(fresh),
            accountId: fresh.accountId,
            title: fresh.title || holdingTicker(fresh),
            note: fresh.note || fresh.description || '',
            options,
        };
        const saved = await api(`/api/stocks/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        upsertPost(saved);
        return saved;
    };
    const saveCfgBtn = document.getElementById('saveAnalysisCfg');
    if (saveCfgBtn) {
        saveCfgBtn.onclick = async () => {
            saveCfgBtn.disabled = true;
            try {
                await persistAnalysisConfig();
                saveCfgBtn.textContent = 'Saved';
                setTimeout(() => { saveCfgBtn.textContent = 'Save settings'; }, 1200);
            } catch (e) {
                showToast(`Could not save settings: ${e.message || e}`);
            } finally {
                saveCfgBtn.disabled = false;
            }
        };
    }

    const reportHost = document.getElementById('reportHost');
    if (reportHost) reportHost.__mode = reportHost.__mode || 'md';
    const copyBtn = document.getElementById('copyReportBtn');
    const toggleBtn = document.getElementById('toggleMdBtn');
    els.detailDlg.showModal();
    bindChartControls(primary);
    document.getElementById('addBuyBtn')?.addEventListener('click', () => openTxnDlg(id, 'buy'));
    document.getElementById('addSellBtn')?.addEventListener('click', () => openTxnDlg(id, 'sell'));
    document.getElementById('fundGuideBtn')?.addEventListener('click', () => openGuide(primary));
    const addCommentBtn = document.getElementById('addCommentBtn');
    const commentInput = document.getElementById('commentInput');
    if (addCommentBtn && commentInput) {
        const submit = () => {
            const text = commentInput.value.trim();
            if (!text) { commentInput.focus(); return; }
            addCommentBtn.disabled = true;
            addComment(id, text).then(() => { commentInput.value = ''; }).finally(() => { addCommentBtn.disabled = false; });
        };
        addCommentBtn.addEventListener('click', submit);
        commentInput.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
        });
    }
    refreshDetailEditMode(p);

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
            // Persist the latest Report-tab config so the run uses the on-screen settings.
            try { await persistAnalysisConfig(); } catch {}
            try {
                await api(`/api/queue/${encodeURIComponent(id)}`, { method: 'POST' });
            } catch {}
        }
        await loadQueueStatus();
        renderAnalyzeButton(id);
        renderAll();
        const fresh = await api(`/api/stocks/${encodeURIComponent(id)}`).catch(() => null);
        if (fresh) {
            upsertPost(fresh);
            syncDetailPanels(fresh);
        }
    };
    renderAutoAnalyzeButton(id);
    els.dAutoAnalyze.onclick = async () => {
        const cur = getPostById(id);
        const next = !(cur && cur.autoAnalyze);
        els.dAutoAnalyze.disabled = true;
        try {
            await api(`/api/stocks/${encodeURIComponent(id)}/auto-analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: next }),
            });
            if (cur) { cur.autoAnalyze = next; upsertPost(cur); }
            renderAutoAnalyzeButton(id);
            renderAll();
            showToast(next ? 'Auto-analyze on for this holding' : 'Auto-analyze off');
        } catch (e) {
            showToast(`Failed: ${e.message || e}`);
        } finally {
            els.dAutoAnalyze.disabled = false;
        }
    };
    els.dEdit.onclick = () => openEdit(p);
    els.dDelete.onclick = () => removePost(id);
    els.dRefresh.onclick = () => refreshSnapshot(id, { force: true });

    // The holdings list omits the report; load the full holding right away
    // (cheap, unlike the price refresh below, which waits on Yahoo).
    api(`/api/stocks/${encodeURIComponent(id)}`).then((full) => {
        upsertPost(full);
        if (currentDetailId === id) syncDetailPanels(full);
    }).catch(() => {});

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
        renderAll();
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

function renderPositionCard(p) {
    const ticker = holdingTicker(p);
    const pos = holdingPosition(p);
    const row = (label, value, cls = '') => `
        <div class="posRow"><span class="posLabel">${escapeHtml(label)}</span><span class="posValue ${cls}">${value}</span></div>`;
    if (pos.shares > 0) {
        return `
          ${row('Shares', fmtShares(pos.shares))}
          ${row('Avg cost', pos.avgCost != null ? fmtMoney(pos.avgCost) : '—')}
          ${row('Last price', pos.current != null ? fmtMoney(pos.current) : '—')}
          ${row('Market value', pos.marketValue != null ? fmtFullMoney(pos.marketValue) : '—')}
          ${row('Unrealized P&L', pos.unrealizedPnl != null ? `${fmtSignedMoney(pos.unrealizedPnl)} (${fmtSignedPct(pos.pct)})` : '—', pnlClass(pos.unrealizedPnl))}
          ${row('Realized P&L', fmtSignedMoney(pos.realizedPnl), pnlClass(pos.realizedPnl))}
        `;
    }
    return `
      ${row('Last price', pos.current != null ? fmtMoney(pos.current) : '—')}
      ${row('Position', 'Not held (watch only)', 'muted')}
      ${row('Realized P&L', fmtSignedMoney(pos.realizedPnl), pnlClass(pos.realizedPnl))}
      <div class="posHint muted">Add a buy transaction in the “Trades &amp; P&amp;L” tab to track ${escapeHtml(ticker)} as a position.</div>
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

async function refreshAllSnapshots() {
    if (els.refreshPricesBtn) els.refreshPricesBtn.disabled = true;
    if (els.watchingRefreshBtn) els.watchingRefreshBtn.disabled = true;
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
        if (els.watchingRefreshBtn) els.watchingRefreshBtn.disabled = false;
    }
}

// =====================================================================
// Position math (client mirror of the server's average-cost accounting)
// =====================================================================
function computePosition(txns, current) {
    const list = (Array.isArray(txns) ? txns.slice() : [])
        .filter((t) => t && (t.type === 'buy' || t.type === 'sell') && Number(t.shares) > 0)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    let shares = 0, avg = 0, realized = 0, invested = 0;
    for (const t of list) {
        const qty = Number(t.shares) || 0, price = Number(t.price) || 0, fee = Number(t.fee) || 0;
        if (t.type === 'buy') {
            const ns = shares + qty;
            if (ns > 0) avg = (avg * shares + price * qty) / ns;
            shares = ns; invested += price * qty + fee;
        } else {
            const sq = shares > 0 ? Math.min(qty, shares) : 0;
            realized += (price - avg) * sq - fee;
            shares = Math.max(0, shares - qty); invested -= price * qty - fee;
            if (shares <= 1e-9) shares = 0;
        }
    }
    const avgCost = (shares > 0 && avg > 0) ? avg : null;
    const marketValue = (current != null && shares) ? current * shares : null;
    const unrealizedPnl = (current != null && avgCost != null && shares) ? (current - avgCost) * shares : null;
    const pct = (avgCost != null && current != null) ? ((current - avgCost) / avgCost) * 100 : null;
    return { shares, avgCost, current: current ?? null, marketValue, unrealizedPnl, realizedPnl: realized, invested };
}

function computeAccountTotals(holdings) {
    let marketValue = 0, costBasis = 0, unrealized = 0, realized = 0, hasPos = false;
    holdings.forEach((p) => {
        const pos = holdingPosition(p);
        realized += pos.realizedPnl || 0;
        if (pos.shares > 0) {
            hasPos = true;
            if (pos.marketValue != null) marketValue += pos.marketValue;
            if (pos.avgCost != null) costBasis += pos.avgCost * pos.shares;
            if (pos.unrealizedPnl != null) unrealized += pos.unrealizedPnl;
        }
    });
    return {
        marketValue: hasPos ? marketValue : null,
        costBasis: hasPos ? costBasis : null,
        unrealizedPnl: hasPos ? unrealized : null,
        realizedPnl: realized,
        totalPnl: (hasPos || realized) ? (unrealized + realized) : null,
        totalPnlPct: costBasis > 0 ? (unrealized / costBasis) * 100 : null,
    };
}

// =====================================================================
// Canvas helpers + the new charts
// =====================================================================
function prepCanvas(canvas, cssHeight) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 320;
    const cssH = cssHeight || canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
}
function cssVar(name, fallback) {
    try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; }
    catch { return fallback; }
}

function redrawTradeChart(id) {
    const post = getPostById(id);
    const canvas = document.getElementById('tradeChartCanvas');
    if (!post || !canvas) return;
    const pos = holdingPosition(post);
    drawTradeHistoryChart(canvas, post.transactions || [], pos.current);
    const legend = document.getElementById('tradeChartLegend');
    if (legend) {
        legend.innerHTML = `
            <span class="tlg"><span class="tlgSwatch line"></span> Shares held</span>
            <span class="tlg"><span class="tlgSwatch buy"></span> Buy</span>
            <span class="tlg"><span class="tlgSwatch sell"></span> Sell (green=gain / red=loss)</span>
            <span class="tlg"><span class="tlgSwatch profit"></span> Cumulative profit</span>`;
    }
}

// X = trades in order; left axis = shares (cumulative-holdings line + signed
// per-trade bars, colored by realized P/L); right axis = $ cumulative profit.
function drawTradeHistoryChart(canvas, txns, currentPrice) {
    const list = (Array.isArray(txns) ? txns.slice() : [])
        .filter((t) => t && (t.type === 'buy' || t.type === 'sell') && Number(t.shares) > 0)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const { ctx, w, h } = prepCanvas(canvas, 270);
    ctx.clearRect(0, 0, w, h);
    const muted = cssVar('--muted', '#5d6778');
    const border = cssVar('--border', 'rgba(20,32,50,0.12)');
    const buyColor = cssVar('--buy', '#177245');
    const sellColor = cssVar('--sell', '#b54753');
    const accent = cssVar('--accent', '#165dff');
    const text = cssVar('--text', '#142032');
    ctx.font = '11px "IBM Plex Sans", sans-serif';
    ctx.textBaseline = 'middle';
    if (!list.length) {
        ctx.fillStyle = muted; ctx.textAlign = 'center';
        ctx.fillText('No transactions yet — add a buy to start your trade history.', w / 2, h / 2);
        return;
    }

    let shares = 0, avg = 0, realized = 0;
    const pts = [];
    for (const t of list) {
        const qty = Number(t.shares) || 0, price = Number(t.price) || 0, fee = Number(t.fee) || 0;
        let signed = 0, sellProfit = null;
        if (t.type === 'buy') {
            const ns = shares + qty; if (ns > 0) avg = (avg * shares + price * qty) / ns; shares = ns; signed = qty;
        } else {
            const sq = shares > 0 ? Math.min(qty, shares) : 0;
            sellProfit = (price - avg) * sq - fee; realized += sellProfit;
            shares = Math.max(0, shares - qty); if (shares <= 1e-9) shares = 0; signed = -qty;
        }
        pts.push({ type: t.type, signed, shares, realized, sellProfit, price, date: t.date });
    }
    const unreal = (currentPrice != null && shares > 0 && avg > 0) ? (currentPrice - avg) * shares : 0;
    const cumFinal = realized + unreal;

    const padL = 44, padR = 58, padT = 16, padB = 46;
    const plotW = Math.max(10, w - padL - padR), plotH = Math.max(10, h - padT - padB);
    const n = pts.length;
    const slot = plotW / n;
    const barW = Math.min(26, Math.max(6, slot * 0.42));
    const cx = (i) => padL + slot * (i + 0.5);

    const upMax = Math.max(1, ...pts.map((p) => p.shares), ...pts.map((p) => Math.max(0, p.signed)));
    const downMax = Math.max(0, ...pts.map((p) => Math.max(0, -p.signed)));
    const sTop = upMax * 1.12, sBot = -(downMax * 1.12 || upMax * 0.04);
    const ys = (v) => padT + plotH * (1 - (v - sBot) / (sTop - sBot));

    const cums = pts.map((p) => p.realized).concat([cumFinal, 0]);
    let pMin = Math.min(...cums), pMax = Math.max(...cums);
    if (pMin === pMax) { pMax = pMin + 1; pMin = pMin - 1; }
    const pPad = (pMax - pMin) * 0.14; pMin -= pPad; pMax += pPad;
    const yp = (v) => padT + plotH * (1 - (v - pMin) / (pMax - pMin));

    // shares zero baseline
    ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, ys(0)); ctx.lineTo(padL + plotW, ys(0)); ctx.stroke();

    // signed per-trade bars
    pts.forEach((p, i) => {
        const x = cx(i) - barW / 2;
        const y0 = ys(0), y1 = ys(p.signed);
        const color = p.type === 'buy' ? accent : ((p.sellProfit ?? 0) >= 0 ? buyColor : sellColor);
        const top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
        ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = color; ctx.fillRect(x, top, barW, hgt); ctx.restore();
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.strokeRect(x, top, barW, hgt);
    });

    // holdings line (cumulative shares)
    ctx.strokeStyle = text; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => { const X = cx(i), Y = ys(p.shares); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
    ctx.stroke();
    ctx.fillStyle = text;
    pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(cx(i), ys(p.shares), 2.6, 0, Math.PI * 2); ctx.fill(); });

    // cumulative profit line (right axis), dashed
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
    pts.forEach((p, i) => { const X = cx(i), Y = yp(p.realized); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
    if (unreal !== 0) ctx.lineTo(padL + plotW, yp(cumFinal));
    ctx.stroke(); ctx.setLineDash([]);

    // left axis labels (shares)
    ctx.fillStyle = muted; ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(upMax)), padL - 6, ys(upMax));
    ctx.fillText('0', padL - 6, ys(0));
    if (downMax > 0) ctx.fillText('−' + Math.round(downMax), padL - 6, ys(-downMax));
    // right axis labels ($)
    ctx.textAlign = 'left';
    ctx.fillText(fmtCompactMoney(pMax), padL + plotW + 6, yp(pMax));
    ctx.fillText(fmtCompactMoney(pMin), padL + plotW + 6, yp(pMin));
    ctx.fillStyle = cumFinal >= 0 ? buyColor : sellColor;
    ctx.fillText(fmtCompactMoney(cumFinal), padL + plotW + 6, yp(cumFinal));

    // x labels
    ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(n / 6));
    pts.forEach((p, i) => {
        if (i % step !== 0 && i !== n - 1) return;
        ctx.fillText((p.date || '').slice(5), cx(i), padT + plotH + 8);
    });
    // axis titles
    ctx.save(); ctx.translate(11, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = muted; ctx.fillText('shares', 0, 0); ctx.restore();
}

// Account-level cumulative realized P&L across all holdings, over time.
function drawAccountPnlChart(canvas, holdings) {
    const events = [];
    holdings.forEach((p) => {
        const list = (p.transactions || [])
            .filter((t) => t && (t.type === 'buy' || t.type === 'sell') && Number(t.shares) > 0)
            .slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
        let shares = 0, avg = 0;
        for (const t of list) {
            const qty = Number(t.shares) || 0, price = Number(t.price) || 0, fee = Number(t.fee) || 0;
            if (t.type === 'buy') { const ns = shares + qty; if (ns > 0) avg = (avg * shares + price * qty) / ns; shares = ns; }
            else { const sq = shares > 0 ? Math.min(qty, shares) : 0; events.push({ date: t.date, delta: (price - avg) * sq - fee }); shares = Math.max(0, shares - qty); if (shares <= 1e-9) shares = 0; }
        }
    });
    events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const { ctx, w, h } = prepCanvas(canvas, 150);
    ctx.clearRect(0, 0, w, h);
    const muted = cssVar('--muted', '#5d6778'), buy = cssVar('--buy', '#177245'), sell = cssVar('--sell', '#b54753');
    ctx.font = '11px "IBM Plex Sans", sans-serif'; ctx.textBaseline = 'middle';
    if (!events.length) {
        ctx.fillStyle = muted; ctx.textAlign = 'center';
        ctx.fillText('Realized P&L appears here once you record sells.', w / 2, h / 2);
        return;
    }
    let cum = 0; const pts = [{ cum: 0 }].concat(events.map((e) => { cum += e.delta; return { cum }; }));
    const padL = 46, padR = 14, padT = 12, padB = 22;
    const plotW = Math.max(10, w - padL - padR), plotH = Math.max(10, h - padT - padB);
    let mn = Math.min(0, ...pts.map((p) => p.cum)), mx = Math.max(0, ...pts.map((p) => p.cum));
    if (mn === mx) mx = mn + 1;
    const pad = (mx - mn) * 0.14; mn -= pad; mx += pad;
    const X = (i) => padL + plotW * (i / Math.max(1, pts.length - 1));
    const Y = (v) => padT + plotH * (1 - (v - mn) / (mx - mn));
    ctx.strokeStyle = cssVar('--border', 'rgba(0,0,0,.1)'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + plotW, Y(0)); ctx.stroke();
    const last = pts[pts.length - 1].cum; const col = last >= 0 ? buy : sell;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p.cum); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = muted; ctx.textAlign = 'right';
    ctx.fillText(fmtCompactMoney(mx), padL - 6, Y(mx));
    ctx.fillText(fmtCompactMoney(mn), padL - 6, Y(mn));
}

// =====================================================================
// Transactions UI
// =====================================================================
function txnTypeValue() {
    return els.txnDlg.querySelector('input[name="txnType"]:checked')?.value || 'buy';
}
function openTxnDlg(holdingId, type = 'buy', txId = null) {
    TXN_CTX = { holdingId, txId };
    const post = getPostById(holdingId);
    const tx = txId ? (post?.transactions || []).find((t) => t.id === txId) : null;
    els.txnDlgTitle.textContent = (txId ? 'Edit ' : 'Add ') + 'Transaction';
    els.txnDlgSub.textContent = post ? `${holdingTicker(post)}${post.title && post.title !== holdingTicker(post) ? ' · ' + post.title : ''}` : '';
    const t = tx?.type || type;
    els.txnDlg.querySelectorAll('input[name="txnType"]').forEach((r) => { r.checked = r.value === t; });
    els.txnShares.value = tx?.shares ?? '';
    els.txnPrice.value = tx?.price ?? '';
    els.txnDate.value = tx?.date || todayLocalDate();
    els.txnFee.value = tx?.fee ?? 0;
    els.txnNote.value = tx?.note || '';
    // For a new transaction, prefill the price with the latest known price to save typing.
    if (!txId && post) {
        const pos = holdingPosition(post);
        if (pos.current != null) els.txnPrice.value = Number(pos.current).toFixed(2);
        else prefillLatestPrice(holdingTicker(post));
    }
    updateTxnPreview();
    els.txnDlg.showModal();
    setTimeout(() => { try { els.txnShares.focus(); } catch {} }, 40);
}
async function prefillLatestPrice(ticker) {
    if (!ticker) return;
    try {
        const d = await api(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=5d&interval=1d`);
        const closes = d && d.closes;
        const last = Array.isArray(closes) && closes.length ? closes[closes.length - 1] : null;
        // Only fill if the user hasn't already typed a price and the dialog is still open.
        if (last != null && els.txnDlg.open && !els.txnPrice.value) {
            els.txnPrice.value = Number(last).toFixed(2);
            updateTxnPreview();
        }
    } catch { /* ignore */ }
}
function updateTxnPreview() {
    if (!els.txnPreview) return;
    const shares = parseFloat(els.txnShares.value), price = parseFloat(els.txnPrice.value), fee = parseFloat(els.txnFee.value) || 0;
    const type = txnTypeValue();
    if (isNaN(shares) || isNaN(price) || shares <= 0) { els.txnPreview.textContent = ''; return; }
    const gross = shares * price; const net = type === 'buy' ? gross + fee : gross - fee;
    els.txnPreview.innerHTML = `${type === 'buy' ? 'Total cost' : 'Net proceeds'}: <strong>${fmtMoney(net)}</strong> <span class="muted">(${fmtShares(shares)} × ${fmtMoney(price)}${fee ? ` ${type === 'buy' ? '+' : '−'} ${fmtMoney(fee)} fee` : ''})</span>`;
}
async function saveTxn() {
    const { holdingId, txId } = TXN_CTX;
    if (!holdingId) return;
    const shares = parseFloat(els.txnShares.value), price = parseFloat(els.txnPrice.value);
    if (isNaN(shares) || shares <= 0) { showToast('Enter a share quantity.'); els.txnShares.focus(); return; }
    if (isNaN(price) || price < 0) { showToast('Enter a price.'); els.txnPrice.focus(); return; }
    const body = { type: txnTypeValue(), shares, price, fee: parseFloat(els.txnFee.value) || 0, date: els.txnDate.value || todayLocalDate(), note: els.txnNote.value.trim() };
    // Over-budget prompt: a new buy that exceeds available cash offers a deposit, but
    // "Buy anyway" is allowed too (cash goes negative, e.g. margin).
    if (!txId && body.type === 'buy') {
        const post = getPostById(holdingId);
        const acc = post ? accountById(post.accountId) : null;
        if (acc && acc.type !== 'watchlist') {
            const cash = accountLedger(acc, POSTS.filter((p) => String(p.accountId) === String(acc.id))).cash;
            const cost = body.shares * body.price + (body.fee || 0);
            if (cost > cash + 1e-9) {
                els.txnDlg.close();
                openCashDlg(acc, { mode: 'cover', cost, cash, shortfall: cost - cash, pending: { holdingId, body } });
                return;
            }
        }
    }
    els.txnSave.disabled = true;
    try { await commitTxn(holdingId, body, txId); els.txnDlg.close(); }
    catch (e) { showToast(`Failed to save transaction: ${e.message || e}`); }
    els.txnSave.disabled = false;
}
async function commitTxn(holdingId, body, txId) {
    let saved;
    if (txId) saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/transactions/${encodeURIComponent(txId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    else saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    upsertPost(saved); invalidateNetworth(saved.accountId); renderAll();
    if (currentDetailId === holdingId) syncDetailPanels(saved);
    showToast('Transaction saved');
    return saved;
}
async function deleteTxn(holdingId, txId) {
    if (!confirm('Delete this transaction?')) return;
    let saved;
    try { saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/transactions/${encodeURIComponent(txId)}`, { method: 'DELETE' }); }
    catch (e) { showToast(`Failed: ${e.message || e}`); return; }
    upsertPost(saved); invalidateNetworth(saved.accountId); renderAll();
    if (currentDetailId === holdingId) syncDetailPanels(saved);
    showToast('Transaction deleted');
}
function renderTxnList(post) {
    const list = (post.transactions || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (!list.length) return '<div class="muted txnEmpty">No transactions recorded yet.</div>';
    const editable = canEditHolding(post);
    return list.map((t) => {
        const isBuy = t.type === 'buy';
        const total = (Number(t.shares) || 0) * (Number(t.price) || 0);
        return `<div class="txnItem">
            <span class="txnBadge ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
            <span class="txnQty">${fmtShares(t.shares)} <span class="muted">@</span> ${fmtMoney(t.price)}</span>
            <span class="txnDate muted">${escapeHtml(t.date || '')}</span>
            <span class="txnTotal">${fmtMoney(total)}</span>
            ${editable ? `<span class="txnRowActions">
                <button class="iconBtn txnEdit" data-tx="${t.id}" title="Edit">Edit</button>
                <button class="iconBtn txnDel" data-tx="${t.id}" title="Delete" aria-label="Delete">✕</button>
            </span>` : ''}
        </div>`;
    }).join('');
}
function bindTxnListActions(holdingId) {
    const host = document.getElementById('txnList');
    if (!host) return;
    host.querySelectorAll('.txnEdit').forEach((b) => b.addEventListener('click', () => openTxnDlg(holdingId, 'buy', b.dataset.tx)));
    host.querySelectorAll('.txnDel').forEach((b) => b.addEventListener('click', () => deleteTxn(holdingId, b.dataset.tx)));
}

// =====================================================================
// Comments (freeform notes per holding; don't affect the position)
// Add/delete are allowed in any mode; accept/discard require edit mode.
// =====================================================================
function renderComments(post) {
    const list = (post.comments || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!list.length) return '<div class="muted commentEmpty">No comments yet.</div>';
    const editable = canEditHolding(post);
    return list.map((c) => {
        const status = c.status || 'pending';
        const statusLabel = status === 'accepted' ? 'Accepted' : status === 'discarded' ? 'Discarded' : 'Pending';
        let actions = '';
        if (editable && status === 'pending') {
            actions = `
                <button class="iconBtn commentAccept" data-c="${c.id}" title="Mark accepted">✓ Accept</button>
                <button class="iconBtn commentDiscard" data-c="${c.id}" title="Mark discarded">Discard</button>`;
        } else if (editable && status !== 'pending') {
            actions = `<button class="iconBtn commentReopen" data-c="${c.id}" title="Mark un-handled again">Reopen</button>`;
        }
        return `<div class="commentItem status-${escapeHtml(status)}">
            <div class="commentBody">
                <div class="commentText">${escapeHtml(c.text || '')}</div>
                <div class="commentMeta muted">${escapeHtml(formatRelativeTime(c.createdAt) || '')} · <span class="commentStatus">${statusLabel}</span></div>
            </div>
            <div class="commentActions">
                ${actions}
                <button class="iconBtn commentDel" data-c="${c.id}" title="Delete" aria-label="Delete">✕</button>
            </div>
        </div>`;
    }).join('');
}
function bindCommentActions(holdingId) {
    const host = document.getElementById('dComments');
    if (!host) return;
    host.querySelectorAll('.commentAccept').forEach((b) => b.addEventListener('click', () => setCommentStatus(holdingId, b.dataset.c, 'accepted')));
    host.querySelectorAll('.commentDiscard').forEach((b) => b.addEventListener('click', () => setCommentStatus(holdingId, b.dataset.c, 'discarded')));
    host.querySelectorAll('.commentReopen').forEach((b) => b.addEventListener('click', () => setCommentStatus(holdingId, b.dataset.c, 'pending')));
    host.querySelectorAll('.commentDel').forEach((b) => b.addEventListener('click', () => deleteComment(holdingId, b.dataset.c)));
}
async function addComment(holdingId, text) {
    let saved;
    try { saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); }
    catch (e) { showToast(`Failed to add comment: ${e.message || e}`); throw e; }
    upsertPost(saved); renderHoldingsList();
    if (currentDetailId === holdingId) syncDetailPanels(saved);
    return saved;
}
async function setCommentStatus(holdingId, cid, status) {
    let saved;
    try { saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/comments/${encodeURIComponent(cid)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); }
    catch (e) { showToast(`Failed: ${e.message || e}`); return; }
    upsertPost(saved); renderHoldingsList();
    if (currentDetailId === holdingId) syncDetailPanels(saved);
}
async function deleteComment(holdingId, cid) {
    if (!confirm('Delete this comment?')) return;
    let saved;
    try { saved = await api(`/api/stocks/${encodeURIComponent(holdingId)}/comments/${encodeURIComponent(cid)}`, { method: 'DELETE' }); }
    catch (e) { showToast(`Failed: ${e.message || e}`); return; }
    upsertPost(saved); renderHoldingsList();
    if (currentDetailId === holdingId) syncDetailPanels(saved);
}
// Show/hide the detail's edit-only controls based on the holding's lock state.
function refreshDetailEditMode(post) {
    if (!post || !els.detailDlg?.open) return;
    const editable = canEditHolding(post);
    const setShown = (el, shown) => { if (el) el.style.display = shown ? '' : 'none'; };
    setShown(els.dEdit, editable);
    setShown(els.dDelete, editable);
    setShown(els.dAnalyze, editable);
    setShown(els.dAutoAnalyze, editable);
    setShown(document.getElementById('addBuyBtn'), editable);
    setShown(document.getElementById('addSellBtn'), editable);
    const saveCfg = document.getElementById('saveAnalysisCfg');
    setShown(saveCfg, editable);
    // Re-render comment/txn lists so their per-row edit actions match the mode.
    syncDetailPanels(post);
}

// =====================================================================
// Account dialog
// =====================================================================
function openAccountDlg(acc) {
    ACCOUNT_EDIT_ID = acc?.id || null;
    els.accountDlgTitle.textContent = acc ? 'Edit Account' : 'New Account';
    els.accName.value = acc?.name || '';
    const type = acc?.type || 'account';
    els.accountDlg.querySelectorAll('input[name="accType"]').forEach((r) => { r.checked = r.value === type; });
    if (els.accKeyword) els.accKeyword.value = acc?.keyword || '';
    if (els.accKeywordHint) {
        els.accKeywordHint.textContent = acc?.keyword
            ? 'This account is locked with the keyword above. Clear it to remove the lock, or change it to set a new one.'
            : "Set a keyword to make this account read-only until unlocked. It's not a secret — just guards against accidental edits.";
    }
    if (els.accDelete) els.accDelete.style.display = acc ? '' : 'none';
    els.accSave.textContent = acc ? 'Save' : 'Create';
    els.accountDlg.showModal();
    setTimeout(() => { try { els.accName.focus(); } catch {} }, 40);
}
async function saveAccount() {
    const name = els.accName.value.trim();
    if (!name) { showToast('Name the account.'); els.accName.focus(); return; }
    const type = els.accountDlg.querySelector('input[name="accType"]:checked')?.value || 'account';
    const keyword = (els.accKeyword?.value || '').trim();
    els.accSave.disabled = true;
    let saved;
    try {
        if (ACCOUNT_EDIT_ID) saved = await api(`/api/accounts/${encodeURIComponent(ACCOUNT_EDIT_ID)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, keyword }) });
        else saved = await api('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, keyword }) });
    } catch (e) { showToast(`Failed: ${e.message || e}`); els.accSave.disabled = false; return; }
    // Keep the just-edited account unlocked this session so setting a keyword
    // doesn't immediately lock the user out mid-edit.
    if (saved?.id && keyword) UNLOCKED_ACCOUNTS.add(String(saved.id));
    els.accSave.disabled = false; els.accountDlg.close();
    const wasCreating = !ACCOUNT_EDIT_ID;
    await loadAccounts();
    if (wasCreating && saved?.id) setActiveAccountSilently(saved.id);
    renderAll();
    showToast('Account saved');
}
async function deleteAccount() {
    if (!ACCOUNT_EDIT_ID) return;
    const acc = accountById(ACCOUNT_EDIT_ID);
    const owned = POSTS.filter((p) => String(p.accountId) === String(ACCOUNT_EDIT_ID));
    const msg = owned.length
        ? `Delete "${acc?.name}"? Its ${owned.length} holding(s) will move to another account.`
        : `Delete "${acc?.name}"?`;
    if (!confirm(msg)) return;
    try { await api(`/api/accounts/${encodeURIComponent(ACCOUNT_EDIT_ID)}`, { method: 'DELETE' }); }
    catch (e) { showToast(`Failed: ${e.message || e}`); return; }
    els.accountDlg.close();
    if (String(ACTIVE_ACCOUNT_ID) === String(ACCOUNT_EDIT_ID)) ACTIVE_ACCOUNT_ID = null;
    await loadAccounts();
    await loadPosts();
    showToast('Account deleted');
}

// =====================================================================
// Cash dialog: adjust cash (deposit/withdraw) + "deposit to cover a buy"
// =====================================================================
let CASH_CTX = { accountId: null, mode: 'adjust', pending: null, shortfall: 0, cost: 0, cash: 0 };
function cashTypeValue() { return els.cashDlg.querySelector('input[name="cashType"]:checked')?.value || 'deposit'; }
function openCashDlg(account, opts = {}) {
    if (!account) return;
    const mode = opts.mode || 'adjust';
    CASH_CTX = { accountId: account.id, mode, pending: opts.pending || null, shortfall: opts.shortfall || 0, cost: opts.cost || 0, cash: opts.cash || 0 };
    const cover = mode === 'cover';
    els.cashDlgTitle.textContent = cover ? 'Deposit to Buy' : 'Adjust Cash';
    els.cashDlgSub.textContent = account.name || '';
    els.cashTypeToggle.style.display = cover ? 'none' : '';
    els.cashDlg.querySelectorAll('input[name="cashType"]').forEach((r) => { r.checked = r.value === 'deposit'; });
    if (els.cashCoverMsg) {
        els.cashCoverMsg.hidden = !cover;
        if (cover) els.cashCoverMsg.innerHTML = `This buy costs <strong>${fmtMoney(opts.cost)}</strong> but you have <strong>${fmtMoney(opts.cash)}</strong> cash. Record a deposit with it, or buy anyway and let cash go to <strong>${fmtMoney(opts.cash - opts.cost)}</strong> (margin).`;
    }
    els.cashAmount.value = cover ? (Math.round(opts.shortfall * 100) / 100) : '';
    els.cashDate.value = (cover && opts.pending?.body?.date) ? opts.pending.body.date : todayLocalDate();
    els.cashNote.value = cover ? 'Deposit to cover purchase' : '';
    els.cashCancel.textContent = cover ? 'Cancel purchase' : 'Cancel';
    els.cashSave.textContent = cover ? 'Deposit & Buy' : 'Save';
    if (els.cashSkip) els.cashSkip.hidden = !cover;
    updateCashHint();
    els.cashDlg.showModal();
    setTimeout(() => { try { els.cashAmount.focus(); } catch {} }, 40);
}
function updateCashHint() {
    if (!els.cashHint) return;
    const amt = parseFloat(els.cashAmount.value);
    if (CASH_CTX.mode === 'cover') {
        const valid = !isNaN(amt) && amt > 0;
        els.cashSave.disabled = !valid;
        const after = CASH_CTX.cash + (valid ? amt : 0) - CASH_CTX.cost;
        els.cashHint.innerHTML = after >= -1e-9
            ? `<span class="pos">Covers it. Cash after the buy: ${fmtMoney(after)}</span>`
            : `<span class="neg">Cash after the buy: ${fmtMoney(after)} (negative).</span>`;
    } else {
        els.cashSave.disabled = isNaN(amt) || amt <= 0;
        els.cashHint.textContent = '';
    }
}
async function addCashFlow(account, flow) {
    const updated = await api(`/api/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashFlows: [...(account.cashFlows || []), flow] }),
    });
    const idx = ACCOUNTS.findIndex((a) => a.id === updated.id);
    if (idx >= 0) ACCOUNTS[idx] = updated;
    return updated;
}
async function saveCash() {
    const acc = accountById(CASH_CTX.accountId);
    if (!acc) return;
    const amount = parseFloat(els.cashAmount.value);
    if (isNaN(amount) || amount <= 0) { showToast('Enter an amount.'); els.cashAmount.focus(); return; }
    const cover = CASH_CTX.mode === 'cover';
    const type = cover ? 'deposit' : cashTypeValue();
    const flow = { type, amount: Math.round(amount * 100) / 100, date: els.cashDate.value || todayLocalDate(), note: els.cashNote.value.trim() };
    els.cashSave.disabled = true;
    try {
        await addCashFlow(acc, flow);
        if (cover && CASH_CTX.pending) await commitTxn(CASH_CTX.pending.holdingId, CASH_CTX.pending.body, null);
    } catch (e) { showToast(`Failed: ${e.message || e}`); els.cashSave.disabled = false; return; }
    els.cashSave.disabled = false; els.cashDlg.close();
    invalidateNetworth(acc.id); renderAll();
    if (currentDetailId && CASH_CTX.pending && currentDetailId === CASH_CTX.pending.holdingId) {
        const fresh = getPostById(currentDetailId); if (fresh) syncDetailPanels(fresh);
    }
    showToast(cover ? 'Deposit recorded · purchase added' : 'Cash updated');
}

// =====================================================================
// Fundamentals (live numbers scored against cheat-sheet benchmarks)
// =====================================================================
function gradeBands(v, bands) {
    for (const b of bands) { if (v <= b.max) return { tone: b.tone, text: b.text }; }
    return null;
}
const G = {
    pe: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 15, tone: 'green', text: 'cheap' }, { max: 25, tone: 'amber', text: 'fair' }, { max: 40, tone: 'amber', text: 'premium' }, { max: Infinity, tone: 'red', text: 'expensive' }]),
    peg: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'n/a' }, { max: 1, tone: 'green', text: 'undervalued' }, { max: 2, tone: 'amber', text: 'fair' }, { max: Infinity, tone: 'red', text: 'expensive' }]),
    ps: (v) => gradeBands(v, [{ max: 2, tone: 'green', text: 'cheap' }, { max: 10, tone: 'amber', text: 'normal' }, { max: 20, tone: 'amber', text: 'rich' }, { max: Infinity, tone: 'red', text: 'speculative' }]),
    pb: (v) => gradeBands(v, [{ max: 1, tone: 'green', text: 'below book' }, { max: 10, tone: 'amber', text: 'typical' }, { max: 30, tone: 'blue', text: 'tech-normal' }, { max: Infinity, tone: 'red', text: 'rich' }]),
    ev: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 10, tone: 'green', text: 'cheap' }, { max: 20, tone: 'amber', text: 'typical' }, { max: 30, tone: 'amber', text: 'premium' }, { max: Infinity, tone: 'red', text: 'rich' }]),
    gm: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 30, tone: 'red', text: 'thin' }, { max: 45, tone: 'amber', text: 'mixed' }, { max: 65, tone: 'amber', text: 'solid' }, { max: Infinity, tone: 'green', text: 'excellent' }]),
    om: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 10, tone: 'amber', text: 'thin' }, { max: 25, tone: 'amber', text: 'healthy' }, { max: Infinity, tone: 'green', text: 'efficient' }]),
    nm: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 5, tone: 'amber', text: 'thin' }, { max: 20, tone: 'amber', text: 'normal' }, { max: Infinity, tone: 'green', text: 'excellent' }]),
    roe: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 10, tone: 'red', text: 'poor' }, { max: 20, tone: 'amber', text: 'healthy' }, { max: Infinity, tone: 'green', text: 'excellent' }]),
    roa: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 5, tone: 'red', text: 'low' }, { max: 10, tone: 'amber', text: 'ok' }, { max: Infinity, tone: 'green', text: 'efficient' }]),
    em: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 15, tone: 'red', text: 'thin' }, { max: 30, tone: 'amber', text: 'solid' }, { max: Infinity, tone: 'green', text: 'strong' }]),
    rg: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'shrinking' }, { max: 10, tone: 'amber', text: 'slow' }, { max: 30, tone: 'amber', text: 'solid' }, { max: Infinity, tone: 'green', text: 'hypergrowth' }]),
    eg: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'falling' }, { max: 20, tone: 'amber', text: 'solid' }, { max: Infinity, tone: 'green', text: 'strong' }]),
    de: (v) => gradeBands(v, [{ max: 0.5, tone: 'green', text: 'fortress' }, { max: 2, tone: 'amber', text: 'manageable' }, { max: 3, tone: 'amber', text: 'elevated' }, { max: Infinity, tone: 'red', text: 'leveraged' }]),
    cr: (v) => gradeBands(v, [{ max: 1, tone: 'red', text: 'liquidity risk' }, { max: 1.5, tone: 'amber', text: 'adequate' }, { max: Infinity, tone: 'green', text: 'comfortable' }]),
    fm: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'burning' }, { max: 10, tone: 'red', text: 'low' }, { max: 25, tone: 'amber', text: 'good' }, { max: Infinity, tone: 'green', text: 'elite' }]),
    fy: (v) => gradeBands(v, [{ max: 0, tone: 'red', text: 'negative' }, { max: 2, tone: 'red', text: 'low' }, { max: 5, tone: 'amber', text: 'fair' }, { max: Infinity, tone: 'green', text: 'attractive' }]),
    nc: (v) => (v >= 0 ? { tone: 'green', text: 'net cash' } : { tone: 'red', text: 'net debt' }),
};
const U = { X: 'x', PCT: 'pct', MONEY: 'money', NUM: 'num' };
const FUND_GROUPS = [
    { title: 'Valuation', metrics: [
        { key: 'peTrailing', label: 'P/E (trailing)', unit: U.X, grade: G.pe },
        { key: 'peForward', label: 'P/E (forward)', unit: U.X, grade: G.pe },
        { key: 'peg', label: 'PEG ratio', unit: U.NUM, grade: G.peg },
        { key: 'ps', label: 'Price / Sales', unit: U.X, grade: G.ps },
        { key: 'pb', label: 'Price / Book', unit: U.X, grade: G.pb },
        { key: 'evEbitda', label: 'EV / EBITDA', unit: U.X, grade: G.ev },
    ]},
    { title: 'Profitability', metrics: [
        { key: 'grossMargin', label: 'Gross margin', unit: U.PCT, grade: G.gm },
        { key: 'operatingMargin', label: 'Operating margin', unit: U.PCT, grade: G.om },
        { key: 'netMargin', label: 'Net margin', unit: U.PCT, grade: G.nm },
        { key: 'ebitdaMargin', label: 'EBITDA margin', unit: U.PCT, grade: G.em },
        { key: 'roe', label: 'Return on equity', unit: U.PCT, grade: G.roe },
        { key: 'roa', label: 'Return on assets', unit: U.PCT, grade: G.roa },
    ]},
    { title: 'Growth', metrics: [
        { key: 'revenueGrowth', label: 'Revenue growth (YoY)', unit: U.PCT, grade: G.rg },
        { key: 'earningsGrowth', label: 'Earnings growth (YoY)', unit: U.PCT, grade: G.eg },
    ]},
    { title: 'Financial health', metrics: [
        { key: 'debtToEquity', label: 'Debt / Equity', unit: U.NUM, grade: G.de },
        { key: 'currentRatio', label: 'Current ratio', unit: U.NUM, grade: G.cr },
        { key: 'netCash', label: 'Net cash', unit: U.MONEY, grade: G.nc },
    ]},
    { title: 'Cash flow', metrics: [
        { key: 'freeCashflow', label: 'Free cash flow', unit: U.MONEY, grade: null },
        { key: 'fcfMargin', label: 'FCF margin', unit: U.PCT, grade: G.fm },
        { key: 'fcfYield', label: 'FCF yield', unit: U.PCT, grade: G.fy },
    ]},
];
function fmtMetric(unit, v) {
    if (v == null || isNaN(v)) return '—';
    if (unit === U.PCT) return `${Number(v).toFixed(1)}%`;
    if (unit === U.MONEY) return fmtCompactMoney(v);
    if (unit === U.X) return `${Number(v).toFixed(1)}x`;
    return Number(v).toFixed(2);
}
async function loadFundamentalsInto(ticker) {
    const host = document.getElementById('fundamentalsHost');
    if (!host) return;
    if (host.__loaded && host.__loadedTicker === ticker) return;
    host.innerHTML = '<div class="muted fundLoading">Loading fundamentals…</div>';
    try {
        const data = await api(`/api/fundamentals/${encodeURIComponent(ticker)}`);
        host.__loaded = true; host.__loadedTicker = ticker;
        renderFundamentals(host, data);
    } catch (e) {
        host.innerHTML = `<div class="muted">Could not load fundamentals: ${escapeHtml(e.message || String(e))}</div>`;
    }
}
function renderFundamentals(host, data) {
    const m = data.metrics || {};
    if (!data.available || !Object.keys(m).length) {
        host.innerHTML = `<div class="muted fundEmpty">No fundamental data for ${escapeHtml(data.ticker || '')}${data.error ? ` (${escapeHtml(data.error)})` : ''}. This is common for ETFs and indices.</div>`;
        return;
    }
    const groupsHtml = FUND_GROUPS.map((g) => {
        const rows = g.metrics.filter((def) => m[def.key] != null).map((def) => {
            const v = m[def.key];
            const grade = def.grade ? def.grade(v) : null;
            return `<tr>
                <td class="fmName">${escapeHtml(def.label)}</td>
                <td class="fmVal">${fmtMetric(def.unit, v)}</td>
                <td class="fmBench">${grade ? `<span class="pill pill-${grade.tone}">${escapeHtml(grade.text)}</span>` : ''}</td>
            </tr>`;
        }).join('');
        if (!rows) return '';
        return `<div class="fundGroup"><div class="fundGroupHead">${escapeHtml(g.title)}</div><table class="fundTable"><tbody>${rows}</tbody></table></div>`;
    }).join('');
    const sub = [data.sector, data.industry].filter(Boolean).join(' · ');
    const head = `<div class="fundTopline">
        <div><strong>${escapeHtml(data.name || data.ticker)}</strong>${sub ? ` <span class="muted">${escapeHtml(sub)}</span>` : ''}</div>
        ${m.marketCap ? `<div class="muted">Mkt cap ${fmtCompactMoney(m.marketCap)}</div>` : ''}
    </div>`;
    host.innerHTML = head + `<div class="fundGroups">${groupsHtml}</div>` +
        `<div class="fundFoot muted">Color bands are general tech-stock guidelines from the Metric Guide — context, not advice.</div>`;
}

// =====================================================================
// Metric Guide (standalone cheat sheet, interactive)
// =====================================================================
let GUIDE_BUILT = false;
function openGuide(ticker) {
    if (!GUIDE_BUILT) { buildGuideContent(); GUIDE_BUILT = true; }
    els.guideDlg.showModal();
    if (ticker && els.mgTickerInput) {
        els.mgTickerInput.value = ticker;
        loadGuideTicker();
    }
}
const GUIDE_TABS = [
    { id: 'valuation', label: 'Valuation', cards: [
        { name: 'Price-to-Earnings', abbr: 'P/E', key: 'peTrailing', unit: U.X, grade: G.pe, formula: 'Price ÷ EPS', desc: 'What you pay for $1 of annual earnings. High P/E = the market expects strong growth.', pills: [['green', '<15 cheap'], ['amber', '15–25 fair'], ['red', '>40 priced for growth']] },
        { name: 'PEG ratio', abbr: 'PEG', key: 'peg', unit: U.NUM, grade: G.peg, formula: 'P/E ÷ EPS growth %', desc: "Fixes P/E's blind spot for growth. PEG ≈ 1 is considered fairly valued (Peter Lynch).", pills: [['green', '<1 undervalued'], ['amber', '1–2 fair'], ['red', '>2 expensive']] },
        { name: 'Price-to-Sales', abbr: 'P/S', key: 'ps', unit: U.X, grade: G.ps, formula: 'Market cap ÷ Revenue', desc: 'Used when there are no profits yet. Says nothing about profitability.', pills: [['green', '<2 cheap'], ['amber', '2–10 normal'], ['red', '>20 speculative']] },
        { name: 'Price-to-Book', abbr: 'P/B', key: 'pb', unit: U.X, grade: G.pb, formula: 'Price ÷ Book value/share', desc: 'Price vs. net assets. Tech often runs 10–30x because value is intangible.', pills: [['green', '<1 below book'], ['amber', '1–5 typical'], ['blue', '10–30 software']] },
        { name: 'EV / EBITDA', abbr: 'EV/EBITDA', key: 'evEbitda', unit: U.X, grade: G.ev, formula: '(Mkt cap + Debt − Cash) ÷ EBITDA', desc: "P/E's smarter sibling — strips out capital structure so you can compare across debt levels.", pills: [['green', '<10 cheap'], ['amber', '10–20 typical'], ['red', '>30 premium']] },
    ]},
    { id: 'profitability', label: 'Profitability', cards: [
        { name: 'Gross margin', abbr: 'GM%', key: 'grossMargin', unit: U.PCT, grade: G.gm, formula: '(Revenue − COGS) ÷ Revenue', desc: 'Left after the direct cost of the product. Software 70–80%; hardware 30–50%.', pills: [['green', '70–85% software'], ['amber', '40–60% mixed'], ['red', '<30% commodity']] },
        { name: 'Operating margin', abbr: 'EBIT%', key: 'operatingMargin', unit: U.PCT, grade: G.om, formula: 'Operating income ÷ Revenue', desc: 'The “real” margin after running the business (R&D, sales, admin).', pills: [['green', '>25% efficient'], ['amber', '10–25% healthy'], ['red', 'negative']] },
        { name: 'Net profit margin', abbr: 'NM%', key: 'netMargin', unit: U.PCT, grade: G.nm, formula: 'Net income ÷ Revenue', desc: 'Bottom-line profit after taxes & interest. A big gap vs. operating margin = lots of debt.', pills: [['green', '>20% excellent'], ['amber', '5–20% normal'], ['red', 'negative']] },
        { name: 'Return on Equity', abbr: 'ROE', key: 'roe', unit: U.PCT, grade: G.roe, formula: 'Net income ÷ Equity', desc: 'Profit per $ of shareholder capital. Buffett likes >15% consistently.', pills: [['green', '>20% excellent'], ['amber', '10–20% healthy'], ['red', '<10% poor']] },
        { name: 'Return on Assets', abbr: 'ROA', key: 'roa', unit: U.PCT, grade: G.roa, formula: 'Net income ÷ Total assets', desc: 'Profit per $ of assets. Asset-light software scores very high.', pills: [['green', '>10% efficient'], ['amber', '5–10% ok'], ['red', '<5% heavy']] },
    ]},
    { id: 'growth', label: 'Growth', cards: [
        { name: 'Revenue growth (YoY)', abbr: 'Rev YoY', key: 'revenueGrowth', unit: U.PCT, grade: G.rg, formula: '(Rev₂ − Rev₁) ÷ Rev₁', desc: 'The single most-watched number. High-P/E names need 20%+ to justify the premium.', pills: [['green', '>30% hyper'], ['amber', '10–30% solid'], ['red', '<10% slowing']] },
        { name: 'EPS growth (YoY)', abbr: 'EPS YoY', key: 'earningsGrowth', unit: U.PCT, grade: G.eg, formula: '(EPS₂ − EPS₁) ÷ |EPS₁|', desc: 'Earnings growth. EPS slower than revenue means margins are compressing.', pills: [['green', '>20% strong'], ['amber', '10–20% solid'], ['red', '< revenue growth']] },
        { name: 'Net Revenue Retention', abbr: 'NRR', formula: '(Start + Expansion − Churn) ÷ Start', desc: 'SaaS gold standard. >100% means existing customers grow spend even with zero new logos.', pills: [['green', '>120% exceptional'], ['amber', '100–120% healthy'], ['red', '<100% churning']] },
        { name: 'LTV : CAC', abbr: 'LTV:CAC', formula: 'Lifetime value ÷ Acquisition cost', desc: 'Return on each $1 of sales & marketing. 3:1 is healthy; >5:1 may be under-investing.', pills: [['red', '<3:1 unprofitable'], ['green', '3–5:1 healthy'], ['blue', '>5:1 under-investing']] },
    ]},
    { id: 'health', label: 'Financial health', cards: [
        { name: 'Debt-to-Equity', abbr: 'D/E', key: 'debtToEquity', unit: U.NUM, grade: G.de, formula: 'Total debt ÷ Equity', desc: 'Leverage. High debt magnifies both returns and losses — risky when rates are high.', pills: [['green', '<0.5 fortress'], ['amber', '0.5–2 manageable'], ['red', '>3 leveraged']] },
        { name: 'Current ratio', abbr: 'CR', key: 'currentRatio', unit: U.NUM, grade: G.cr, formula: 'Current assets ÷ Current liabilities', desc: 'Can it pay the next 12 months of bills? Below 1 is a liquidity warning.', pills: [['red', '<1 stress'], ['amber', '1–1.5 adequate'], ['green', '>2 comfortable']] },
        { name: 'Interest coverage', abbr: 'ICR', formula: 'EBIT ÷ Interest expense', desc: 'How many times profit covers the interest bill. Low ICR gets squeezed as rates rise.', pills: [['red', '<1.5 distress'], ['amber', '1.5–5 watch'], ['green', '>10 safe']] },
        { name: 'Net cash position', abbr: 'Net $', key: 'netCash', unit: U.MONEY, grade: G.nc, formula: 'Total cash − Total debt', desc: 'Positive = fortress balance sheet (buybacks, dividends, M&A). Negative = net debt.', pills: [['green', 'positive = net cash'], ['red', 'negative = net debt']] },
    ]},
    { id: 'cashflow', label: 'Cash flow', cards: [
        { name: 'Free Cash Flow', abbr: 'FCF', key: 'freeCashflow', unit: U.MONEY, formula: 'Operating cash flow − Capex', desc: 'Cash left after maintaining/growing assets. Hard to fake — many call it the most honest profit.', pills: [['green', 'positive & growing'], ['amber', 'positive but flat'], ['red', 'negative']] },
        { name: 'FCF yield', abbr: 'FCF%', key: 'fcfYield', unit: U.PCT, grade: G.fy, formula: 'FCF per share ÷ Price', desc: 'Like a dividend yield of what the company could return. Compare to the ~4.5% 10-yr Treasury.', pills: [['green', '>5% attractive'], ['amber', '2–5% fair'], ['red', '<2% low']] },
        { name: 'FCF margin', abbr: 'FCF%rev', key: 'fcfMargin', unit: U.PCT, grade: G.fm, formula: 'FCF ÷ Revenue', desc: 'Share of revenue that becomes free cash. The best software runs 30–40%.', pills: [['green', '>25% elite'], ['amber', '10–25% good'], ['red', '<10% heavy']] },
        { name: 'Operating cash flow', abbr: 'OCF', key: 'operatingCashflow', unit: U.MONEY, formula: 'Net income + non-cash + ΔWC', desc: 'Cash from the core business. OCF consistently above net income = quality earnings.', pills: [['green', 'OCF > net income'], ['red', 'OCF < net income']] },
    ]},
];
const GUIDE_GRADE_BY_KEY = {};
GUIDE_TABS.forEach((t) => t.cards.forEach((c) => { if (c.key && c.grade) GUIDE_GRADE_BY_KEY[c.key] = c.grade; }));
const GUIDE_CHEATSHEET = [
    ['P/E', '15–25x', '>40x', 'Are you overpaying per $ of profit?'],
    ['PEG', '0.8–2.0', '>2.5', 'Is the P/E justified by growth?'],
    ['P/S', '2–10x', '>20x', 'Price per $ of revenue'],
    ['P/B', '1–5x (tech 5–20x)', '>30x', 'Price vs. liquidation value'],
    ['EV/EBITDA', '8–20x', '>35x', 'Debt-adjusted valuation'],
    ['Gross margin', '70–85% sw', '<30%', 'Pricing power & unit economics'],
    ['Op. margin', '>20%', 'negative', 'Efficiency after running costs'],
    ['Net margin', '>15%', 'negative', 'Bottom-line profitability'],
    ['ROE', '>20%', '<10%', 'Return on shareholder capital'],
    ['ROA', '>10%', '<5%', 'Asset efficiency'],
    ['Rev growth', '>20%', '<10%', 'Top-line momentum'],
    ['EPS growth', '>20%', '< rev growth', 'Earnings leverage'],
    ['NRR', '>110%', '<100%', 'Customer expansion vs. churn'],
    ['D/E', '<1.0', '>3.0', 'Balance-sheet leverage'],
    ['Current ratio', '>1.5', '<1.0', 'Can it pay near-term bills?'],
    ['ICR', '>5x', '<2x', 'Can it service its debt?'],
    ['FCF', 'positive & growing', 'persistently negative', 'Real cash generated'],
    ['FCF yield', '>4%', '<2%', 'Cash return vs. price'],
    ['FCF margin', '>20%', '<10%', 'Business-model quality'],
];
function buildGuideContent() {
    const host = els.guideContent;
    if (!host) return;
    const tabsBtns = GUIDE_TABS.map((t, i) => `<button type="button" class="mgTab${i === 0 ? ' is-active' : ''}" data-mg="${t.id}">${escapeHtml(t.label)}</button>`).join('')
        + `<button type="button" class="mgTab" data-mg="cheatsheet">Cheat sheet</button>`;
    const panels = GUIDE_TABS.map((t, i) => {
        const cards = t.cards.map((c) => `
            <div class="mgCard">
                <div class="mgCardHead"><span class="mgName">${escapeHtml(c.name)}</span><span class="mgAbbr">${escapeHtml(c.abbr)}${c.key ? `<span class="mgVal" data-mgkey="${c.key}" data-mgunit="${c.unit}"></span>` : ''}</span></div>
                <div class="mgFormula">${escapeHtml(c.formula)}</div>
                <div class="mgDesc">${escapeHtml(c.desc)}</div>
                <div class="mgPills">${c.pills.map(([tone, txt]) => `<span class="pill pill-${tone}">${escapeHtml(txt)}</span>`).join('')}</div>
            </div>`).join('');
        const calc = GUIDE_CALCS[t.id] || '';
        return `<div class="mgPanel${i === 0 ? ' is-active' : ''}" data-mg="${t.id}">${calc}${cards}</div>`;
    }).join('');
    const cheatRows = GUIDE_CHEATSHEET.map((r) => `<tr><td class="mgcMetric">${escapeHtml(r[0])}</td><td class="mgcGood">${escapeHtml(r[1])}</td><td class="mgcWarn">${escapeHtml(r[2])}</td><td>${escapeHtml(r[3])}</td></tr>`).join('');
    const cheatPanel = `<div class="mgPanel" data-mg="cheatsheet">
        <div class="mgCheatScroll"><table class="mgCheatTable"><thead><tr><th>Metric</th><th>Good range</th><th>Warning</th><th>What it measures</th></tr></thead><tbody>${cheatRows}</tbody></table></div>
        <div class="mgNote">No single metric tells the whole story — read at least one from each category together.</div>
    </div>`;
    host.innerHTML = `<div class="mgTabs">${tabsBtns}</div><div class="mgPanels">${panels}${cheatPanel}</div>`;
    host.querySelector('.mgTabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.mgTab'); if (!btn) return;
        const id = btn.dataset.mg;
        host.querySelectorAll('.mgTab').forEach((b) => b.classList.toggle('is-active', b === btn));
        host.querySelectorAll('.mgPanel').forEach((p) => p.classList.toggle('is-active', p.dataset.mg === id));
    });
    wireGuideCalculators(host);
}
const GUIDE_CALCS = {
    valuation: `<div class="mgCalc" data-calc="pe">
        <div class="mgCalcHead">P/E calculator</div>
        <label>Stock price <output data-out="p">$150</output></label><input type="range" data-in="p" min="10" max="600" value="150" step="1">
        <label>Annual EPS <output data-out="e">$5.00</output></label><input type="range" data-in="e" min="0.5" max="40" value="5" step="0.5">
        <div class="mgCalcResult" data-out="r">P/E = 30.0x — above average, needs a growth story</div>
    </div>`,
    growth: `<div class="mgCalc" data-calc="peg">
        <div class="mgCalcHead">PEG calculator</div>
        <label>P/E ratio <output data-out="pe">50x</output></label><input type="range" data-in="pe" min="5" max="100" value="50" step="1">
        <label>EPS growth %/yr <output data-out="g">50%</output></label><input type="range" data-in="g" min="5" max="100" value="50" step="1">
        <div class="mgCalcResult" data-out="r">PEG = 1.00 — fairly valued</div>
    </div>`,
    cashflow: `<div class="mgCalc" data-calc="fcf">
        <div class="mgCalcHead">FCF yield calculator</div>
        <label>FCF / share <output data-out="f">$8.00</output></label><input type="range" data-in="f" min="0.5" max="40" value="8" step="0.5">
        <label>Stock price <output data-out="p">$200</output></label><input type="range" data-in="p" min="20" max="600" value="200" step="5">
        <div class="mgCalcResult" data-out="r">FCF Yield = 4.0% — close to the 10-yr Treasury</div>
    </div>`,
};
function wireGuideCalculators(host) {
    const pe = host.querySelector('[data-calc="pe"]');
    if (pe) {
        const p = pe.querySelector('[data-in="p"]'), e = pe.querySelector('[data-in="e"]');
        const upd = () => {
            const P = +p.value, E = +e.value; const r = P / E;
            pe.querySelector('[data-out="p"]').textContent = `$${P}`;
            pe.querySelector('[data-out="e"]').textContent = `$${E.toFixed(2)}`;
            const v = r < 15 ? 'cheap vs. history' : r < 25 ? 'fair / average' : r < 40 ? 'above average — needs a growth story' : 'priced for big growth — risky on a miss';
            pe.querySelector('[data-out="r"]').textContent = `P/E = ${r.toFixed(1)}x — ${v}`;
        };
        p.oninput = upd; e.oninput = upd; upd();
    }
    const peg = host.querySelector('[data-calc="peg"]');
    if (peg) {
        const pe2 = peg.querySelector('[data-in="pe"]'), g = peg.querySelector('[data-in="g"]');
        const upd = () => {
            const PE = +pe2.value, GG = +g.value; const r = PE / GG;
            peg.querySelector('[data-out="pe"]').textContent = `${PE}x`;
            peg.querySelector('[data-out="g"]').textContent = `${GG}%`;
            const v = r < 1 ? 'potentially undervalued' : r < 2 ? 'fairly valued' : 'expensive even for the growth';
            peg.querySelector('[data-out="r"]').textContent = `PEG = ${r.toFixed(2)} — ${v}`;
        };
        pe2.oninput = upd; g.oninput = upd; upd();
    }
    const fcf = host.querySelector('[data-calc="fcf"]');
    if (fcf) {
        const f = fcf.querySelector('[data-in="f"]'), p = fcf.querySelector('[data-in="p"]');
        const upd = () => {
            const F = +f.value, P = +p.value; const y = F / P * 100;
            fcf.querySelector('[data-out="f"]').textContent = `$${F.toFixed(2)}`;
            fcf.querySelector('[data-out="p"]').textContent = `$${P}`;
            const v = y > 5 ? 'attractive vs. bonds' : y > 2 ? 'fair — needs growth to justify' : 'low — heavy growth expectations';
            fcf.querySelector('[data-out="r"]').textContent = `FCF Yield = ${y.toFixed(1)}% — ${v}`;
        };
        f.oninput = upd; p.oninput = upd; upd();
    }
}
// Push a real value into a range slider, widening min/max if the value falls outside.
function setGuideSlider(input, value) {
    if (!input || value == null || !isFinite(value) || value <= 0) return false;
    if (value > +input.max) input.max = String(Math.ceil(value));
    if (value < +input.min) input.min = String(Math.floor(value));
    input.value = String(value);
    return true;
}
function applyGuideTickerData(data) {
    const host = els.guideContent;
    const m = data.metrics || {};
    if (!host) return;
    const pe = host.querySelector('[data-calc="pe"]');
    if (pe) {
        const p = pe.querySelector('[data-in="p"]'), e = pe.querySelector('[data-in="e"]');
        const okP = setGuideSlider(p, m.price), okE = setGuideSlider(e, m.eps);
        if (okP || okE) p.oninput();
    }
    const peg = host.querySelector('[data-calc="peg"]');
    if (peg) {
        const pe2 = peg.querySelector('[data-in="pe"]'), g = peg.querySelector('[data-in="g"]');
        const okPe = setGuideSlider(pe2, m.peTrailing ?? m.peForward);
        const okG = setGuideSlider(g, m.earningsGrowth ?? m.revenueGrowth);
        if (okPe || okG) pe2.oninput();
    }
    const fcf = host.querySelector('[data-calc="fcf"]');
    if (fcf) {
        const f = fcf.querySelector('[data-in="f"]'), p = fcf.querySelector('[data-in="p"]');
        const okP = setGuideSlider(p, m.price);
        const fcfPerShare = (m.price > 0 && m.fcfYield != null) ? m.price * m.fcfYield / 100 : null;
        const okF = setGuideSlider(f, fcfPerShare);
        if (okP || okF) f.oninput();
    }
    host.querySelectorAll('.mgVal[data-mgkey]').forEach((el) => {
        const key = el.dataset.mgkey;
        const v = m[key];
        el.className = 'mgVal';
        if (v == null) { el.textContent = ''; return; }
        el.textContent = ` (= ${fmtMetric(el.dataset.mgunit, v)})`;
        const grade = GUIDE_GRADE_BY_KEY[key];
        if (grade) el.classList.add(`tone-${grade(v).tone}`);
    });
}
async function loadGuideTicker() {
    const input = els.mgTickerInput, status = els.mgTickerStatus;
    const ticker = (input?.value || '').trim().toUpperCase();
    if (!ticker || !status) return;
    status.textContent = 'Loading…';
    status.classList.remove('is-ok', 'is-error');
    try {
        const data = await api(`/api/fundamentals/${encodeURIComponent(ticker)}`);
        if (!data.available || !Object.keys(data.metrics || {}).length) {
            status.textContent = `No data for ${ticker}${data.error ? ` (${data.error})` : ''}`;
            status.classList.add('is-error');
            return;
        }
        if (!GUIDE_BUILT) { buildGuideContent(); GUIDE_BUILT = true; }
        applyGuideTickerData(data);
        status.textContent = `Loaded ${data.name || ticker} (${ticker}) into the calculators & cards below`;
        status.classList.add('is-ok');
    } catch (e) {
        status.textContent = `Error: ${e.message || e}`;
        status.classList.add('is-error');
    }
}

// --- events
els.cancelDlg?.addEventListener("click", () => els.postDlg.close());
els.cancelDlgX?.addEventListener("click", () => els.postDlg.close());
els.saveDlg?.addEventListener("click", savePost);
els.dClose?.addEventListener("click", () => els.detailDlg.close());
els.postDlg.addEventListener('close', () => { els.saveDlg.disabled = false; });
// Stop any active stream when the detail dialog closes
els.detailDlg.addEventListener('close', () => {
    if (currentDetailId) stopAnalysisStream(currentDetailId);
    stopDetailAutoRefresh();
    teardownActiveChartInteractions();
    currentDetailId = null;
    window.currentDetailRefreshAnalyzeButton = null;
});

// Hamburger side drawer
function openDrawer() {
    els.sideDrawer?.classList.add('is-open');
    els.drawerOverlay?.classList.add('is-open');
    els.sideDrawer?.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
    els.sideDrawer?.classList.remove('is-open');
    els.drawerOverlay?.classList.remove('is-open');
    els.sideDrawer?.setAttribute('aria-hidden', 'true');
}
els.menuBtn?.addEventListener('click', openDrawer);
els.drawerClose?.addEventListener('click', closeDrawer);
els.drawerOverlay?.addEventListener('click', closeDrawer);
// Close drawer when any action inside it is triggered
els.sideDrawer?.querySelectorAll('button:not(#drawerClose)').forEach((b) => b.addEventListener('click', closeDrawer));

// Add-holding triggers (header + holdings panel + empty states)
document.querySelectorAll('.addHoldingTrigger').forEach((b) => b.addEventListener('click', () => openNew()));
els.refreshPricesBtn?.addEventListener('click', refreshAllSnapshots);
// Refresh-all and add buttons are edit actions (POST); hide them for read-only visitors.
if (READ_ONLY_VIEWER) {
    [els.refreshPricesBtn, els.watchingRefreshBtn, els.addHoldingBtn, els.watchingAddBtn].forEach((b) => { if (b) b.style.display = 'none'; });
}
els.addHoldingBtn?.addEventListener('click', () => openNew());

// Holdings list hSecondary mode toggle (Day vs Total return)
const holdSecToggle = document.getElementById('holdingsSecToggle');
holdSecToggle?.querySelectorAll('input[name="holdSecMode"]').forEach((input) => {
    input.checked = input.value === HOLD_SEC_MODE;
    input.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        HOLD_SEC_MODE = e.target.value === 'total' ? 'total' : 'day';
        try { localStorage.setItem('stock:holdSecMode', HOLD_SEC_MODE); } catch {}
        renderHoldingsList();
    });
});
// Global market-close auto-analyze controls (drawer)
function renderAutoAllStatus() {
    if (!els.autoAllStatus) return;
    const total = POSTS.length;
    const on = POSTS.filter((p) => p && p.autoAnalyze).length;
    els.autoAllStatus.textContent = on === 0
        ? `Off for all ${total} holding${total === 1 ? '' : 's'} — analyze manually, or enable per holding.`
        : `Auto-analyzing ${on} of ${total} holding${total === 1 ? '' : 's'} at market close.`;
}
async function bulkAutoAnalyze(enabled) {
    if (!POSTS.length) { showToast('No holdings yet.'); return; }
    if (!enabled && !confirm('Turn OFF auto-analyze for every holding?')) return;
    els.autoAllOnBtn && (els.autoAllOnBtn.disabled = true);
    els.autoAllOffBtn && (els.autoAllOffBtn.disabled = true);
    try {
        const res = await api('/api/auto-analyze/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
        });
        POSTS.forEach((p) => { if (p) p.autoAnalyze = enabled; });
        if (currentDetailId) renderAutoAnalyzeButton(currentDetailId);
        renderAutoAllStatus();
        renderAll();
        showToast(`Auto-analyze ${enabled ? 'enabled' : 'disabled'} for ${res.changed} holding${res.changed === 1 ? '' : 's'}.`);
    } catch (e) {
        showToast(`Failed: ${e.message || e}`);
    } finally {
        els.autoAllOnBtn && (els.autoAllOnBtn.disabled = false);
        els.autoAllOffBtn && (els.autoAllOffBtn.disabled = false);
    }
}
els.autoAllOnBtn?.addEventListener('click', () => bulkAutoAnalyze(true));
els.autoAllOffBtn?.addEventListener('click', () => bulkAutoAnalyze(false));
els.guideBtn?.addEventListener('click', () => openGuide());
els.guideClose?.addEventListener('click', () => els.guideDlg.close());
els.mgLoadBtn?.addEventListener('click', loadGuideTicker);
els.mgTickerInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadGuideTicker(); });
els.searchBox?.addEventListener("input", renderHoldingsList);
els.watchingSearchBox?.addEventListener("input", renderHoldingsList);
els.watchingRefreshBtn?.addEventListener('click', refreshAllSnapshots);
els.watchingAddBtn?.addEventListener('click', () => openNew());

// Transaction dialog
els.txnSave?.addEventListener('click', saveTxn);
els.txnCancel?.addEventListener('click', () => els.txnDlg.close());
els.txnClose?.addEventListener('click', () => els.txnDlg.close());
els.txnDlg?.addEventListener('close', () => { els.txnSave.disabled = false; });
[els.txnShares, els.txnPrice, els.txnFee].forEach((inp) => inp?.addEventListener('input', updateTxnPreview));
els.txnDlg?.querySelectorAll('input[name="txnType"]').forEach((r) => r.addEventListener('change', updateTxnPreview));

// Account dialog
els.accSave?.addEventListener('click', saveAccount);
els.accCancel?.addEventListener('click', () => els.accountDlg.close());
els.accClose?.addEventListener('click', () => els.accountDlg.close());
els.accDelete?.addEventListener('click', deleteAccount);
els.accountDlg?.addEventListener('close', () => { els.accSave.disabled = false; });

// Cash dialog (adjust cash / deposit to cover a buy)
els.cashSave?.addEventListener('click', saveCash);
els.cashCancel?.addEventListener('click', () => els.cashDlg.close());
els.cashSkip?.addEventListener('click', async () => {
    // Record the pending buy without a deposit; the account's cash goes negative.
    const pending = CASH_CTX.pending;
    if (CASH_CTX.mode !== 'cover' || !pending) return;
    els.cashSkip.disabled = true;
    try {
        await commitTxn(pending.holdingId, pending.body, null);
        els.cashDlg.close();
    } catch (e) { showToast(`Failed to save transaction: ${e.message || e}`); }
    els.cashSkip.disabled = false;
});
els.cashClose?.addEventListener('click', () => els.cashDlg.close());
els.cashAmount?.addEventListener('input', updateCashHint);
els.cashDlg?.querySelectorAll('input[name="cashType"]').forEach((r) => r.addEventListener('change', updateCashHint));
els.cashDlg?.addEventListener('close', () => { els.cashSave.disabled = false; });

// Redraw canvases on resize so their bitmaps re-fit instead of stretching.
let __resizeRAF = 0;
function redrawVisibleCharts() {
    const nw = document.getElementById('networthCanvas');
    if (nw && LAST_NW_SERIES) drawNetworthChart(nw, LAST_NW_SERIES);
    const acc = getActiveAccount();
    const ac = document.getElementById('accountChartCanvas');
    if (ac && acc) drawAccountPnlChart(ac, POSTS.filter((p) => String(p.accountId) === String(acc.id)));
    if (currentDetailId) {
        const tradePanel = els.dContent?.querySelector('.detailPanel[data-tab="trades"]');
        if (tradePanel && !tradePanel.hidden) redrawTradeChart(currentDetailId);
    }
}
window.addEventListener('resize', () => {
    if (__resizeRAF) cancelAnimationFrame(__resizeRAF);
    __resizeRAF = requestAnimationFrame(redrawVisibleCharts);
});

// --- boot
(async function init() {
    try { await loadConfig(); } catch { /* non-fatal */ }
    try {
        await loadAccounts();
        await loadPosts();
    } catch (e) {
        console.error("Failed to load portfolio:", e);
        if (els.holdingsList) els.holdingsList.innerHTML = `<div class="empty-state">
          <div class="muted">Failed to load. Ensure the server is running and try again.</div>
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
                renderAll();
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
})();

// --- tiny HTML escape
function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Models & search settings dialog
const MODELS = { catalog: [], search: [], llm: [], searchModels: {}, liveModels: {} };
const modelsEl = (id) => document.getElementById(id);

function providerById(pid) { return MODELS.catalog.find((p) => p.id === pid) || null; }

function modelDatalistId(pid) { return `dl-models-${pid}`; }

function syncModelDatalists() {
    let host = modelsEl('modelDatalists');
    if (!host) {
        host = document.createElement('div');
        host.id = 'modelDatalists';
        host.hidden = true;
        document.body.appendChild(host);
    }
    host.innerHTML = MODELS.catalog.map((p) => {
        const names = Array.from(new Set([...(p.models || []), ...(MODELS.liveModels[p.id] || [])]));
        return `<datalist id="${escapeHtml(modelDatalistId(p.id))}">${names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>`;
    }).join('');
}

function searchStatusText(sp) {
    if (!sp.available) return `No API key — set ${sp.apiKeyEnv} in .env`;
    const st = sp.status || {};
    if (st.coolingDown) {
        const until = new Date(st.cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `Paused until ${until} (${st.lastErrorKind || 'error'}): ${st.lastError || ''}`;
    }
    if (st.lastErrorAt && (!st.lastSuccessAt || st.lastErrorAt > st.lastSuccessAt)) return `Last error ${formatRelativeTime(st.lastErrorAt)}: ${st.lastError || ''}`;
    if (st.lastSuccessAt) return `Working · last used ${formatRelativeTime(st.lastSuccessAt)} · ${st.successes || 0} ok / ${st.failures || 0} failed since restart`;
    return 'Not used since restart';
}

function renderLlmChain() {
    const host = modelsEl('llmChainList');
    if (!host) return;
    host.innerHTML = MODELS.llm.map((e, i) => {
        const opts = MODELS.catalog.map((p) =>
            `<option value="${escapeHtml(p.id)}"${p.id === e.provider ? ' selected' : ''}>${escapeHtml(p.label)}${p.available ? '' : ' (no key)'}</option>`).join('');
        const prov = providerById(e.provider);
        const warn = prov && !prov.available ? `<div class="chainWarn">No API key — set ${escapeHtml(prov.apiKeyEnv || '')} in .env, or this entry is skipped.</div>` : '';
        const dl = escapeHtml(modelDatalistId(e.provider));
        return `<div class="chainRow" data-idx="${i}">
            <span class="chainRank">${i === 0 ? 'Primary' : `Fallback ${i}`}</span>
            <select class="chainProvider" aria-label="Provider">${opts}</select>
            <input class="chainDeep" list="${dl}" value="${escapeHtml(e.deep)}" placeholder="deep model" aria-label="Deep model" autocomplete="off" spellcheck="false" />
            <input class="chainQuick" list="${dl}" value="${escapeHtml(e.quick)}" placeholder="quick model" aria-label="Quick model" autocomplete="off" spellcheck="false" />
            <span class="chainBtns">
                <button class="ghost iconBtn chainFetch" type="button" title="Load the provider's current model list" aria-label="Load models"${prov?.available ? '' : ' disabled'}>↻</button>
                <button class="ghost iconBtn chainUp" type="button" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
                <button class="ghost iconBtn chainDown" type="button" title="Move down" aria-label="Move down"${i === MODELS.llm.length - 1 ? ' disabled' : ''}>↓</button>
                <button class="ghost iconBtn chainRemove" type="button" title="Remove" aria-label="Remove"${MODELS.llm.length === 1 ? ' disabled' : ''}>✕</button>
            </span>
            ${warn}
        </div>`;
    }).join('');
}

function renderSearchChain() {
    const host = modelsEl('searchChainList');
    if (!host) return;
    host.innerHTML = MODELS.search.map((row, i) => {
        const sp = row.meta;
        const st = sp.status || {};
        const cls = !sp.available ? 'is-off' : st.coolingDown ? 'is-paused' : '';
        const model = sp.usesModel
            ? `<input class="searchModel" value="${escapeHtml(MODELS.searchModels[sp.id] || sp.defaultModel)}" aria-label="${escapeHtml(sp.label)} model" placeholder="${escapeHtml(sp.defaultModel)}" autocomplete="off" spellcheck="false" />`
            : '';
        return `<div class="chainRow searchRow ${cls}" data-idx="${i}">
            <label class="searchToggle"><input type="checkbox" class="searchEnabled"${row.enabled ? ' checked' : ''} /> <strong>${escapeHtml(sp.label)}</strong></label>
            ${model}
            <span class="chainBtns">
                <button class="ghost iconBtn searchUp" type="button" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
                <button class="ghost iconBtn searchDown" type="button" aria-label="Move down"${i === MODELS.search.length - 1 ? ' disabled' : ''}>↓</button>
            </span>
            <div class="chainStatus muted">${escapeHtml(searchStatusText(sp))}</div>
        </div>`;
    }).join('');
}

function readModelsForm() {
    document.querySelectorAll('#llmChainList .chainRow').forEach((row) => {
        const e = MODELS.llm[Number(row.dataset.idx)];
        if (!e) return;
        e.provider = row.querySelector('.chainProvider').value;
        e.deep = row.querySelector('.chainDeep').value.trim();
        e.quick = row.querySelector('.chainQuick').value.trim();
    });
    document.querySelectorAll('#searchChainList .searchRow').forEach((row) => {
        const r = MODELS.search[Number(row.dataset.idx)];
        if (!r) return;
        r.enabled = row.querySelector('.searchEnabled').checked;
        const m = row.querySelector('.searchModel');
        if (m) MODELS.searchModels[r.meta.id] = m.value.trim();
    });
}

function applyModelsPayload(j) {
    MODELS.catalog = j.llmProviders || [];
    MODELS.llm = (j.settings?.llm_chain || []).map((e) => ({ ...e }));
    MODELS.searchModels = { ...(j.settings?.search_models || {}) };
    const enabled = j.settings?.search_chain || [];
    const metas = j.searchProviders || [];
    MODELS.search = [
        ...enabled.map((id) => metas.find((m) => m.id === id)).filter(Boolean).map((meta) => ({ meta, enabled: true })),
        ...metas.filter((m) => !enabled.includes(m.id)).map((meta) => ({ meta, enabled: false })),
    ];
    syncModelDatalists();
    renderLlmChain();
    renderSearchChain();
}

function showModelsError(msg) {
    const el = modelsEl('modelsError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
}

async function openModelsDlg() {
    closeDrawer();
    showModelsError('');
    try {
        applyModelsPayload(await api('/api/settings'));
    } catch (e) { showToast(`Failed to load settings: ${e.message || e}`); return; }
    modelsEl('modelsDlg').showModal();
}

async function saveModels() {
    readModelsForm();
    showModelsError('');
    const btn = modelsEl('modelsSave');
    btn.disabled = true;
    try {
        const j = await api('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                llm_chain: MODELS.llm,
                search_chain: MODELS.search.filter((r) => r.enabled).map((r) => r.meta.id),
                search_models: MODELS.searchModels,
            }),
        });
        applyModelsPayload(j);
        await loadConfig();
        modelsEl('modelsDlg').close();
        showToast('Settings saved. New analyses will use them.');
    } catch (e) {
        showModelsError(e.message || String(e));
    } finally {
        btn.disabled = false;
    }
}

modelsEl('llmChainList')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    const row = ev.target.closest('.chainRow');
    if (!btn || !row) return;
    readModelsForm();
    const i = Number(row.dataset.idx);
    const list = MODELS.llm;
    if (btn.classList.contains('chainUp') && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (btn.classList.contains('chainDown') && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    else if (btn.classList.contains('chainRemove') && list.length > 1) list.splice(i, 1);
    else if (btn.classList.contains('chainFetch')) {
        const pid = list[i].provider;
        btn.disabled = true;
        try {
            const j = await api(`/api/settings/models/${encodeURIComponent(pid)}`);
            MODELS.liveModels[pid] = j.models || [];
            syncModelDatalists();
            showToast(`${(j.models || []).length} models available from ${providerById(pid)?.label || pid}.`);
        } catch (e) { showToast(`Could not list models: ${e.message || e}`); }
        btn.disabled = false;
        return;
    }
    renderLlmChain();
});
modelsEl('llmChainList')?.addEventListener('change', (ev) => {
    if (!ev.target.classList.contains('chainProvider')) return;
    // Switching provider: reset models to that provider's defaults.
    const row = ev.target.closest('.chainRow');
    readModelsForm();
    const e = MODELS.llm[Number(row.dataset.idx)];
    const p = providerById(e.provider);
    e.deep = p?.defaultDeep || '';
    e.quick = p?.defaultQuick || '';
    renderLlmChain();
});
modelsEl('llmChainAdd')?.addEventListener('click', () => {
    readModelsForm();
    if (MODELS.llm.length >= 6) { showToast('At most 6 entries.'); return; }
    const used = new Set(MODELS.llm.map((e) => e.provider));
    const next = MODELS.catalog.find((p) => p.available && !used.has(p.id)) || MODELS.catalog[0];
    MODELS.llm.push({ provider: next.id, deep: next.defaultDeep, quick: next.defaultQuick });
    renderLlmChain();
});
modelsEl('searchChainList')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    const row = ev.target.closest('.searchRow');
    if (!btn || !row) return;
    readModelsForm();
    const i = Number(row.dataset.idx);
    const list = MODELS.search;
    if (btn.classList.contains('searchUp') && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    else if (btn.classList.contains('searchDown') && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    renderSearchChain();
});
modelsEl('searchResetBtn')?.addEventListener('click', async () => {
    readModelsForm();
    try {
        const j = await api('/api/settings/search/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        // Keep unsaved edits; only refresh provider status.
        MODELS.search.forEach((r) => { r.meta = (j.searchProviders || []).find((m) => m.id === r.meta.id) || r.meta; });
        renderSearchChain();
        showToast('Search cooldowns cleared.');
    } catch (e) { showToast(`Failed: ${e.message || e}`); }
});
modelsEl('modelsBtn')?.addEventListener('click', openModelsDlg);
modelsEl('modelsSave')?.addEventListener('click', saveModels);
modelsEl('modelsCancel')?.addEventListener('click', () => modelsEl('modelsDlg').close());
modelsEl('modelsClose')?.addEventListener('click', () => modelsEl('modelsDlg').close());

// --- API access (tokens) dialog
function renderTokens(tokens) {
    const host = modelsEl('tokList');
    if (!host) return;
    if (!tokens.length) { host.innerHTML = '<div class="muted">No tokens yet.</div>'; return; }
    host.innerHTML = tokens.map((t) => {
        const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
        const expiry = t.expiresAt ? `${expired ? 'expired' : 'expires'} ${formatDateTime(t.expiresAt)}` : 'never expires';
        return `<div class="tokRow">
            <div class="tokMain">
                <strong>${escapeHtml(t.name)}</strong>
                <span class="pill">${t.scope === 'write' ? 'read & write' : 'read only'}</span>
                <code class="muted">${escapeHtml(t.hint)}…</code>
            </div>
            <div class="muted tokMeta">Created ${escapeHtml(formatDateTime(t.createdAt))} · last used ${escapeHtml(t.lastUsedAt ? formatRelativeTime(t.lastUsedAt) : 'never')} · ${escapeHtml(expiry)}</div>
            <button class="ghost ghostDanger tokRevoke" type="button" data-id="${escapeHtml(t.id)}">Revoke</button>
        </div>`;
    }).join('');
}

function renderAudit(entries) {
    const host = modelsEl('auditList');
    if (!host) return;
    if (!entries.length) { host.innerHTML = '<div class="muted">Nothing yet.</div>'; return; }
    host.innerHTML = entries.slice(0, 25).map((e) => {
        const what = e.event === 'request' ? `${e.method} ${e.path} → ${e.status}`
            : e.event === 'token_created' ? `created token “${e.token}” (${e.scope})`
            : e.event.replace(/_/g, ' ');
        return `<div class="auditRow"><span class="muted">${escapeHtml(formatRelativeTime(e.ts))}</span><span>${escapeHtml(e.actor || e.ip || '')}</span><span class="auditWhat">${escapeHtml(what)}</span></div>`;
    }).join('');
}

async function refreshApiDlg() {
    const [tokens, audit] = await Promise.all([api('/api/auth/tokens'), api('/api/audit?limit=50')]);
    renderTokens(tokens);
    renderAudit(audit);
}

async function openApiDlg() {
    closeDrawer();
    const reveal = modelsEl('tokReveal');
    if (reveal) { reveal.hidden = true; reveal.innerHTML = ''; }
    try { await refreshApiDlg(); } catch (e) { showToast(`Failed: ${e.message || e}`); return; }
    modelsEl('apiDlg').showModal();
}

async function createToken() {
    const name = modelsEl('tokName').value.trim();
    if (!name) { showToast('Give the token a name.'); return; }
    const btn = modelsEl('tokCreate');
    btn.disabled = true;
    try {
        const t = await api('/api/auth/tokens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, scope: modelsEl('tokScope').value, expiresInDays: modelsEl('tokExpiry').value || null }),
        });
        const origin = location.origin;
        const example = `curl -H "Authorization: Bearer ${t.token}" ${origin}/api/v1/portfolio`;
        const canWrite = t.scope === 'write';
        const agentText = [
            `You can ${canWrite ? 'read and update' : 'read'} my stock portfolio tracker at ${origin}.`,
            `Send this HTTP header on every request: Authorization: Bearer ${t.token}`,
            `Start with GET ${origin}/api/v1, which lists the endpoints and confirms your access, and ${origin}/api/v1/openapi.json for the full spec.`,
            canWrite ? 'Record trades with POST /api/v1/trades (JSON body) and cash with POST /api/v1/cashflows. Always include a unique "id" for each real-world trade so retries are not double-counted. Check the portfolio before and after changes.' : 'This token is read-only.',
        ].join('\n');
        const reveal = modelsEl('tokReveal');
        reveal.innerHTML = `<div><strong>Copy this token now.</strong> It won't be shown again.</div>
            <div class="tokSecret"><code id="tokSecret">${escapeHtml(t.token)}</code><button class="ghost" type="button" id="tokCopy">Copy</button></div>
            <div class="muted">Instructions to paste into your agent:</div>
            <div class="tokSecret"><pre class="log" id="tokAgentText">${escapeHtml(agentText)}</pre><button class="ghost" type="button" id="tokCopyAgent">Copy</button></div>
            <div class="muted">Or try it yourself:</div><pre class="log">${escapeHtml(example)}</pre>`;
        reveal.hidden = false;
        const copy = async (text) => {
            try { await navigator.clipboard.writeText(text); showToast('Copied.'); } catch { showToast('Copy failed — select the text instead.'); }
        };
        modelsEl('tokCopy')?.addEventListener('click', () => copy(t.token));
        modelsEl('tokCopyAgent')?.addEventListener('click', () => copy(agentText));
        modelsEl('tokName').value = '';
        await refreshApiDlg();
    } catch (e) { showToast(`Failed: ${e.message || e}`); }
    btn.disabled = false;
}

modelsEl('apiAccessBtn')?.addEventListener('click', openApiDlg);
modelsEl('tokCreate')?.addEventListener('click', createToken);
modelsEl('tokList')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.tokRevoke');
    if (!btn) return;
    if (!confirm('Revoke this token? Anything using it will stop working immediately.')) return;
    try {
        await api(`/api/auth/tokens/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
        await refreshApiDlg();
        showToast('Token revoked.');
    } catch (e) { showToast(`Failed: ${e.message || e}`); }
});
modelsEl('logoutAllBtn')?.addEventListener('click', async () => {
    if (!confirm('Sign out every browser, including this one? API tokens keep working.')) return;
    try { await api('/api/auth/logout-all', { method: 'POST' }); } catch {}
    location.href = '/login';
});
modelsEl('apiDone')?.addEventListener('click', () => modelsEl('apiDlg').close());
modelsEl('apiClose')?.addEventListener('click', () => modelsEl('apiDlg').close());
