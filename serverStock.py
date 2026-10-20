# server.py
import os, json, re, uuid, threading, time, traceback
from datetime import datetime, timedelta
from typing import Dict, Any, List
from flask import Flask, g, jsonify, request, send_from_directory, render_template, Response, stream_with_context, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from zoneinfo import ZoneInfo

from server_auth import init_auth, require_admin
from server_settings import SettingsError, SettingsStore
from tradingagents.llm_providers import list_remote_models, normalize_chain_entry
from tradingagents.dataflows.search_provider import reset_cooldown

# Optional deps:
# - tradingagents: provides analyze() or similar. We'll adapt via a safe wrapper.
# - yfinance: fetches price history for chart.
try:
    import tradingagents  # placeholder import; your env should provide this
except Exception:
    tradingagents = None

try:
    import yfinance as yf
except Exception:
    yf = None

# -------------------
# Config
# -------------------
APP_TZ = ZoneInfo("America/Los_Angeles")  # market-close scheduler
DATA_DIR = os.environ.get("TA_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, mode=0o700, exist_ok=True)
REPORTS_DIR = os.path.join(DATA_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)
DATA_FILE = os.path.join(DATA_DIR, "stocks.json")
ACCOUNTS_FILE = os.path.join(DATA_DIR, "accounts.json")
DATA_LOCK = threading.RLock()

AUTO_REGEN_ENABLED = True
# Approx daily close time: 1:00 PM PT (can drift for DST). We'll run 2:10 PM PT.
DAILY_REGEN_HOUR = 14
DAILY_REGEN_MIN = 10

SUPPORTED_ANALYSTS = ["market", "social", "news", "fundamentals"]
ANALYST_LABELS = {
    "market": "Market",
    "social": "Social",
    "news": "News",
    "fundamentals": "Fundamentals",
}
DEFAULT_ANALYSIS_PRESET = "balanced"
ANALYSIS_PRESETS: Dict[str, Dict[str, Any]] = {
    "fast": {
        "label": "Fast Pass",
        "description": "Quick directional read with lighter analyst coverage.",
        "selected_analysts": ["market", "news", "fundamentals"],
        "online_tools": True,
        "max_debate_rounds": 1,
    },
    "balanced": {
        "label": "Balanced",
        "description": "Default full TradingAgents workflow for daily monitoring.",
        "selected_analysts": ["market", "social", "news", "fundamentals"],
        "online_tools": True,
        "max_debate_rounds": 1,
    },
    "deep": {
        "label": "Deep Dive",
        "description": "Full analyst coverage with extra debate depth.",
        "selected_analysts": ["market", "social", "news", "fundamentals"],
        "online_tools": True,
        "max_debate_rounds": 2,
    },
}
UNSET = object()

# -------------------
# App
# -------------------
app = Flask(__name__, static_folder="static", template_folder="templates")
# nginx terminates TLS and forwards X-Forwarded-For/-Proto (see proxy_params); trust exactly one hop.
if os.environ.get("TA_TRUST_PROXY", "1") != "0":
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
AUTH = init_auth(app, DATA_DIR)
SETTINGS = SettingsStore(DATA_DIR, lambda: _get_personal_config_copy())

# -------------------
# Job queue (in-memory)
# -------------------
JOB_LOCK = threading.RLock()
JOB_QUEUE: List[str] = []  # list of post ids
JOB_STATE: Dict[str, str] = {}  # pid -> 'idle'|'queued'|'running'|'done'|'error'|'stopped'
CURRENT_JOB: Dict[str, Any] = {"pid": None}  # mutable holder
STOP_FLAGS: Dict[str, threading.Event] = {}  # pid -> Event
QUEUE_EVENTS: List[Dict[str, Any]] = []  # pending SSE events
QUEUE_CV = threading.Condition(JOB_LOCK)
TERMINAL_STATES = {"done", "error", "stopped"}

# -------------------
# Chroma memory collection collision patch
# -------------------
_MEMORY_PATCHED = False

def _patch_financial_memory():
    """Monkey-patch FinancialSituationMemory.__init__ so repeated instantiation
    does not raise 'Collection [name] already exists'. We do NOT edit the original
    tradingagents package on disk per user request.

    Strategy:
      1. Try create_collection (original behavior).
      2. On failure, fall back to get_collection.
      3. If get_collection also fails (e.g., dangling metadata), attempt delete + recreate.
    """
    global _MEMORY_PATCHED
    if _MEMORY_PATCHED:
        return
    try:  # Import inside to avoid hard dependency if tradingagents not installed
        from tradingagents.agents.utils.memory import FinancialSituationMemory
        from tradingagents.agents.utils.embedding_provider_factory import EmbeddingProviderFactory
        import chromadb
        from chromadb.config import Settings
    except Exception:
        return  # tradingagents or chromadb missing; nothing to patch

    if getattr(FinancialSituationMemory.__init__, '_patched', False):
        _MEMORY_PATCHED = True
        return

    orig_init = FinancialSituationMemory.__init__

    def patched_init(self, name, config):  # type: ignore
        self.config = config
        try:
            self.backend_url = config["backend_url"]
        except Exception:
            self.backend_url = ''
        # Reuse embedding provider factory
        try:
            self.embedding_provider = EmbeddingProviderFactory.create_provider(config)
        except Exception:
            # Fallback: defer to original init if embedding provider fails
            return orig_init(self, name, config)  # type: ignore
        try:
            self.chroma_client = chromadb.Client(Settings(allow_reset=True))
        except Exception as e:
            print(f"[memory-patch] Failed to init Chroma client: {e}")
            return orig_init(self, name, config)  # type: ignore
        # Attempt create -> get -> delete+create
        try:
            self.situation_collection = self.chroma_client.create_collection(name=name)
        except Exception as ce:
            try:
                self.situation_collection = self.chroma_client.get_collection(name=name)
                print(f"[memory-patch] Reused existing Chroma collection '{name}'.")
            except Exception:
                # Last resort: delete then recreate (may fail silently if delete invalid)
                try:
                    self.chroma_client.delete_collection(name)
                except Exception:
                    pass
                try:
                    self.situation_collection = self.chroma_client.create_collection(name=name)
                    print(f"[memory-patch] Deleted & recreated Chroma collection '{name}'.")
                except Exception as ce2:
                    print(f"[memory-patch] Failed to create/recreate collection '{name}': {ce2}")
                    # Surface original behavior by delegating to original init (may raise)
                    return orig_init(self, name, config)  # type: ignore

    patched_init._patched = True  # type: ignore
    FinancialSituationMemory.__init__ = patched_init  # type: ignore
    _MEMORY_PATCHED = True
    print("[memory-patch] FinancialSituationMemory patched to tolerate existing collections.")

# Apply patch ASAP so any later imports/instantiations use the tolerant behavior
_patch_financial_memory()

# -------------------
# Data helpers
# -------------------
def _read() -> List[Dict[str, Any]]:
    with DATA_LOCK:
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

def _write(obj: List[Dict[str, Any]]):
    with DATA_LOCK:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)

def _utcnow_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"

# -------------------
# Accounts (grouping layer for holdings)
# -------------------
def _read_accounts() -> List[Dict[str, Any]]:
    with DATA_LOCK:
        try:
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception:
            pass
        return []

def _write_accounts(obj: List[Dict[str, Any]]):
    with DATA_LOCK:
        tmp = ACCOUNTS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, ACCOUNTS_FILE)

def _default_account(order: int = 0) -> Dict[str, Any]:
    now = _utcnow_iso()
    return {
        "id": str(uuid.uuid4()),
        "name": "My Portfolio",
        "type": "account",
        "order": order,
        "collapsed": False,
        "keyword": "",
        "cashFlows": [],
        "createdAt": now,
        "updatedAt": now,
    }

def _normalize_cashflows(raw: Any) -> List[Dict[str, Any]]:
    """Validate/clean a list of account cash flows (deposits / withdrawals)."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type") or "").strip().lower()
        # outside-gain/outside-loss: P&L realized outside tracked holdings
        # (prediction markets, event contracts, crypto). Cash-wise they behave
        # like dividend/fee but are labeled separately from equity income.
        if kind not in ("deposit", "withdrawal", "dividend", "fee", "outside-gain", "outside-loss"):
            continue
        try:
            amount = round(float(item.get("amount")), 2)
        except Exception:
            continue
        if amount <= 0:
            continue
        date = _sanitize_date(item.get("date")) or datetime.now(APP_TZ).date().isoformat()
        note = str(item.get("note") or "").strip()[:280]
        out.append({
            "id": str(item.get("id") or uuid.uuid4()),
            "type": kind,
            "amount": amount,
            "date": date,
            "note": note,
        })
    return out

def _ensure_accounts() -> List[Dict[str, Any]]:
    """Return accounts (sorted by order), seeding a default account if none exist."""
    with DATA_LOCK:
        accounts = _read_accounts()
        if not accounts:
            accounts = [_default_account()]
            _write_accounts(accounts)
        accounts.sort(key=lambda a: (a.get("order", 0), a.get("createdAt", "")))
        return accounts

def _normalize_account(payload: Dict[str, Any], existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
    existing = existing or {}
    name = str((payload.get("name") if "name" in payload else existing.get("name")) or "").strip()
    atype = str((payload.get("type") if "type" in payload else existing.get("type")) or "account").strip().lower()
    if atype not in ("account", "watchlist"):
        atype = "account"
    collapsed = _coerce_bool(
        payload.get("collapsed") if "collapsed" in payload else existing.get("collapsed"),
        False,
    )
    if "cashFlows" in payload:
        cash_flows = _normalize_cashflows(payload.get("cashFlows"))
    else:
        cash_flows = _normalize_cashflows(existing.get("cashFlows") or [])
    # Per-account "keyword" (a soft lock, not a secret): empty string means no lock.
    # Stored in plaintext so it can be recovered from the backend if forgotten.
    keyword = str((payload.get("keyword") if "keyword" in payload else existing.get("keyword")) or "").strip()[:64]
    return {"name": (name or "Untitled")[:80], "type": atype, "collapsed": collapsed, "keyword": keyword, "cashFlows": cash_flows}

def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y", "on"}:
            return True
        if lowered in {"0", "false", "no", "n", "off"}:
            return False
    return default if value is None else bool(value)

def _coerce_int(value: Any, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        result = int(value)
    except Exception:
        result = default
    if minimum is not None:
        result = max(minimum, result)
    if maximum is not None:
        result = min(maximum, result)
    return result

def _normalize_tickers(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        items = raw.replace("\n", ",").split(",")
    else:
        try:
            items = list(raw)
        except TypeError:
            items = [raw]
    tickers: List[str] = []
    seen = set()
    for item in items:
        ticker = str(item or "").strip().upper()
        if not ticker or ticker in seen:
            continue
        tickers.append(ticker)
        seen.add(ticker)
    return tickers

def _normalize_purchases(raw: Any, tickers: List[str]) -> Dict[str, float]:
    if not isinstance(raw, dict):
        return {}
    allowed = set(tickers)
    purchases: Dict[str, float] = {}
    for key, value in raw.items():
        ticker = str(key or "").strip().upper()
        if not ticker or (allowed and ticker not in allowed):
            continue
        try:
            price = round(float(value), 4)
        except Exception:
            continue
        if price <= 0:
            continue
        purchases[ticker] = price
    return purchases

def _normalize_transactions(raw: Any) -> List[Dict[str, Any]]:
    """Validate/clean a list of buy/sell transactions for a holding."""
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        ttype = str(item.get("type") or "").strip().lower()
        if ttype not in ("buy", "sell"):
            continue
        try:
            shares = round(float(item.get("shares")), 6)
        except Exception:
            continue
        try:
            price = round(float(item.get("price")), 4)
        except Exception:
            continue
        if shares <= 0 or price < 0:
            continue
        try:
            fee = max(0.0, round(float(item.get("fee") or 0), 4))
        except Exception:
            fee = 0.0
        date = _sanitize_date(item.get("date")) or datetime.now(APP_TZ).date().isoformat()
        note = str(item.get("note") or "").strip()[:280]
        tid = str(item.get("id") or uuid.uuid4())
        out.append({
            "id": tid,
            "type": ttype,
            "shares": shares,
            "price": price,
            "fee": fee,
            "date": date,
            "note": note,
        })
    return out

COMMENT_STATUSES = ("pending", "accepted", "discarded")

def _normalize_comments(raw: Any) -> List[Dict[str, Any]]:
    """Validate/clean a holding's comment cards.

    Comments are freeform notes that don't affect the position. Each has a
    status: pending (un-handled), accepted, or discarded.
    """
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:2000]
        if not text:
            continue
        status = str(item.get("status") or "pending").strip().lower()
        if status not in COMMENT_STATUSES:
            status = "pending"
        now = _utcnow_iso()
        out.append({
            "id": str(item.get("id") or uuid.uuid4()),
            "text": text,
            "status": status,
            "author": str(item.get("author") or "").strip()[:80],
            "createdAt": str(item.get("createdAt") or now),
            "updatedAt": str(item.get("updatedAt") or now),
        })
    return out

def _position_from_transactions(txns: Any) -> Dict[str, Any]:
    """Average-cost accounting over a holding's transactions.

    Returns shares (net), avgCost (weighted average cost basis of remaining
    shares), realizedPnl (cumulative gains booked on sells, net of fees), and
    invested (net cash deployed). Transactions are processed in date order.
    """
    empty = {"shares": 0.0, "avgCost": None, "realizedPnl": 0.0, "invested": 0.0, "fees": 0.0}
    if not isinstance(txns, list) or not txns:
        return empty
    ordered = sorted(
        [t for t in txns if isinstance(t, dict)],
        key=lambda t: str(t.get("date") or ""),
    )
    shares = 0.0
    avg_cost = 0.0
    realized = 0.0
    invested = 0.0
    fees = 0.0
    for t in ordered:
        ttype = str(t.get("type") or "").lower()
        try:
            qty = float(t.get("shares") or 0)
            price = float(t.get("price") or 0)
        except Exception:
            continue
        try:
            fee = float(t.get("fee") or 0)
        except Exception:
            fee = 0.0
        if qty <= 0 or price < 0:
            continue
        fees += fee
        if ttype == "buy":
            new_shares = shares + qty
            if new_shares > 0:
                avg_cost = (avg_cost * shares + price * qty) / new_shares
            shares = new_shares
            invested += price * qty + fee
        elif ttype == "sell":
            sell_qty = min(qty, shares) if shares > 0 else 0.0
            realized += (price - avg_cost) * sell_qty - fee
            shares = max(0.0, shares - qty)
            invested -= price * qty - fee
            if shares <= 1e-9:
                shares = 0.0
    return {
        "shares": round(shares, 6),
        "avgCost": round(avg_cost, 4) if (shares > 0 and avg_cost > 0) else None,
        "realizedPnl": round(realized, 4),
        "invested": round(invested, 4),
        "fees": round(fees, 4),
    }

def _snapshot_entry(position: Dict[str, Any], current: float | None, prev_close: float | None = None) -> Dict[str, Any]:
    """Build a per-ticker snapshot entry from a derived position + latest price."""
    shares = (position or {}).get("shares") or 0.0
    avg = (position or {}).get("avgCost")
    pct = percent_change(avg, current) if (avg and current is not None) else None
    market_value = (shares * current) if (current is not None and shares) else None
    unrealized = ((current - avg) * shares) if (current is not None and avg and shares) else None
    day_pct = percent_change(prev_close, current) if (prev_close and current is not None) else None
    day_change = ((current - prev_close) * shares) if (current is not None and prev_close is not None and shares) else None
    return {
        "current": current,
        "pct": pct,
        "shares": round(shares, 6),
        "avgCost": avg,
        "marketValue": round(market_value, 4) if market_value is not None else None,
        "unrealizedPnl": round(unrealized, 4) if unrealized is not None else None,
        "realizedPnl": (position or {}).get("realizedPnl") or 0.0,
        "dayChange": round(day_change, 4) if day_change is not None else None,
        "dayChangePct": round(day_pct, 4) if day_pct is not None else None,
    }

def _build_holding_snapshot(holding: Dict[str, Any]) -> Dict[str, Any]:
    """Recompute the full snapshot dict for a (single-ticker) holding."""
    tickers = holding.get("tickers") or ([holding.get("ticker")] if holding.get("ticker") else [])
    pos = _position_from_transactions(holding.get("transactions") or [])
    snapshot: Dict[str, Any] = {}
    for t in tickers:
        if not t:
            continue
        cur, prev_close = get_price_and_prev_close(t)
        snapshot[t] = _snapshot_entry(pos, cur, prev_close)
    return snapshot

def _sanitize_date(raw: Any) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text[:10]).date().isoformat()
    except Exception:
        return None

def _normalize_selected_analysts(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        items = raw.replace("\n", ",").split(",")
    else:
        try:
            items = list(raw)
        except TypeError:
            items = [raw]
    analysts: List[str] = []
    seen = set()
    for item in items:
        analyst = str(item or "").strip().lower()
        if analyst not in SUPPORTED_ANALYSTS or analyst in seen:
            continue
        analysts.append(analyst)
        seen.add(analyst)
    return analysts

def _default_title_for_tickers(tickers: List[str]) -> str:
    if not tickers:
        return "Untitled"
    head = " / ".join(tickers[:3])
    if len(tickers) > 3:
        head += f" +{len(tickers) - 3}"
    return f"{head} watchlist"

def _normalize_options(raw: Any) -> Dict[str, Any]:
    options = dict(raw) if isinstance(raw, dict) else {}
    preset = str(options.get("preset") or DEFAULT_ANALYSIS_PRESET).strip().lower()
    if preset not in ANALYSIS_PRESETS:
        preset = DEFAULT_ANALYSIS_PRESET
    preset_defaults = ANALYSIS_PRESETS[preset]

    selected_analysts = _normalize_selected_analysts(options.get("selected_analysts"))
    if not selected_analysts:
        selected_analysts = list(preset_defaults["selected_analysts"])

    normalized: Dict[str, Any] = {
        "preset": preset,
        "selected_analysts": selected_analysts,
        "debug": _coerce_bool(options.get("debug"), False),
        "online_tools": _coerce_bool(options.get("online_tools"), preset_defaults["online_tools"]),
        "max_debate_rounds": _coerce_int(
            options.get("max_debate_rounds"),
            preset_defaults["max_debate_rounds"],
            minimum=1,
            maximum=4,
        ),
    }

    date_str = _sanitize_date(options.get("date"))
    if date_str:
        normalized["date"] = date_str

    # Optional per-holding model override. Only a registered provider id and a
    # model name are accepted: endpoints (backend_url) and arbitrary config keys
    # are server-side only, so a request can never redirect an API key elsewhere.
    if options.get("llm_provider"):
        override = normalize_chain_entry({
            "provider": options.get("llm_provider"),
            "deep": options.get("deep_think_llm"),
            "quick": options.get("quick_think_llm"),
        }, _get_personal_config_copy())
        if override:
            normalized["llm_provider"] = override["provider"]
            normalized["deep_think_llm"] = override["deep"]
            normalized["quick_think_llm"] = override["quick"]
    return normalized

def _llm_override(opts: Dict[str, Any]) -> Dict[str, str] | None:
    if not opts.get("llm_provider"):
        return None
    return {"provider": opts["llm_provider"], "deep": opts["deep_think_llm"], "quick": opts["quick_think_llm"]}

def _resolve_analysis_settings(raw_options: Any) -> Dict[str, Any]:
    opts = _normalize_options(raw_options)
    preset = ANALYSIS_PRESETS.get(opts["preset"], ANALYSIS_PRESETS[DEFAULT_ANALYSIS_PRESET])
    cfg = SETTINGS.apply(_get_personal_config_copy(), _llm_override(opts))

    cfg["online_tools"] = opts["online_tools"]
    cfg["max_debate_rounds"] = opts["max_debate_rounds"]
    if "max_risk_discuss_rounds" not in cfg:
        cfg["max_risk_discuss_rounds"] = max(1, min(opts["max_debate_rounds"], 4))

    return {
        "options": opts,
        "config": cfg,
        "selected_analysts": opts.get("selected_analysts") or list(preset["selected_analysts"]),
        "debug": bool(opts.get("debug", False)),
        "date": opts.get("date") or datetime.now(APP_TZ).date().isoformat(),
    }

def _normalize_post_for_storage(payload: Dict[str, Any], existing: Dict[str, Any] | None = None) -> Dict[str, Any]:
    existing = existing or {}
    # A holding tracks a single ticker. Accept either `ticker` or `tickers`.
    if "ticker" in payload:
        tickers = _normalize_tickers([payload.get("ticker")])
    elif "tickers" in payload:
        tickers = _normalize_tickers(payload.get("tickers"))
    else:
        tickers = _normalize_tickers(existing.get("tickers") or existing.get("ticker"))
    tickers = tickers[:1]  # enforce single-ticker holdings
    title = str((payload.get("title") if "title" in payload else existing.get("title")) or "").strip()
    description = str((payload.get("description") if "description" in payload else existing.get("description")) or "").strip()
    note = str((payload.get("note") if "note" in payload else existing.get("note")) or "").strip()[:600]
    account_id = str((payload.get("accountId") if "accountId" in payload else existing.get("accountId")) or "").strip()
    options = _normalize_options(payload.get("options") if "options" in payload else existing.get("options") or {})
    # Opt-in flag for the daily market-close auto-analysis (default OFF so no
    # holding costs LLM tokens automatically; the user enables it per holding).
    auto_analyze = _coerce_bool(
        payload.get("autoAnalyze") if "autoAnalyze" in payload else existing.get("autoAnalyze"),
        False,
    )

    if "transactions" in payload:
        transactions = _normalize_transactions(payload.get("transactions"))
    else:
        transactions = _normalize_transactions(existing.get("transactions") or [])

    # Keep a back-compat purchases map (avg cost) so legacy snapshot code paths work.
    position = _position_from_transactions(transactions)
    purchases: Dict[str, float] = {}
    if tickers and position.get("avgCost"):
        purchases[tickers[0]] = position["avgCost"]

    return {
        "title": title or (tickers[0] if tickers else "Untitled"),
        "description": description,
        "note": note,
        "accountId": account_id,
        "tickers": tickers,
        "options": options,
        "transactions": transactions,
        "purchases": purchases,
        "autoAnalyze": auto_analyze,
    }

def _get_personal_config_copy() -> Dict[str, Any]:
    try:
        from personal_config import PERSONAL_CONFIG
        if isinstance(PERSONAL_CONFIG, dict):
            return PERSONAL_CONFIG.copy()
    except Exception:
        pass
    return {}

def _get_personal_config_summary() -> Dict[str, Any]:
    cfg = _get_personal_config_copy()
    return {**SETTINGS.summary(), "online_tools": cfg.get("online_tools")}

def _normalize_post_for_client(post: Dict[str, Any]) -> Dict[str, Any]:
    post["options"] = _normalize_options(post.get("options") or {})
    ana = post.get("analysis")
    if ana and isinstance(ana, dict):
        report_files = ana.get("report", [])
        if isinstance(report_files, list) and report_files:
            ana["report"] = _get_compiled_report(report_files)
        elif not isinstance(report_files, str):
            ana["report"] = ""
    return post

def _report_filename(pid: str, ticker: str | None = None) -> str:
    safe_pid = "".join(c for c in str(pid) if c.isalnum()).lower()[:12] or "post"
    safe_ticker = "".join(c for c in str(ticker or "report") if c.isalnum() or c in ("-", "_")).upper() or "REPORT"
    return f"{safe_ticker}-{safe_pid}.md"

def _write_report_file(pid: str, ticker: str, content: str) -> str:
    """Write report content to a markdown file and return the filename."""
    filename = _report_filename(pid, ticker)
    filepath = os.path.join(REPORTS_DIR, filename)
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return filename
    except Exception as e:
        print(f"[report-file] Failed to write {filepath}: {e}")
        return filename  # return filename anyway so JSON doesn't break

def _read_report_file(filename: str) -> str:
    """Read report content from a markdown file."""
    filepath = os.path.join(REPORTS_DIR, filename)
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        print(f"[report-file] Failed to read {filepath}: {e}")
        return f"[Error reading report file: {filename}]"

def _append_to_report_file(pid: str, ticker: str, content: str) -> str:
    """Append content to an existing report file or create it. Returns filename."""
    filename = _report_filename(pid, ticker)
    filepath = os.path.join(REPORTS_DIR, filename)
    try:
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(content)
        return filename
    except Exception as e:
        print(f"[report-file] Failed to append to {filepath}: {e}")
        return filename

def _get_compiled_report(report_files: List[str]) -> str:
    """Compile multiple report files into a single string."""
    if not report_files:
        return ""
    if isinstance(report_files, str):
        # Handle old format where report was a string
        return report_files
    
    compiled = []
    for filename in report_files:
        content = _read_report_file(filename)
        compiled.append(content)
    return "\n\n".join(compiled)

def _find(posts, pid):
    for p in posts:
        if str(p.get("id")) == str(pid):
            return p
    return None

def _update_post(pid: str, mutator):
    """Thread-safe read-modify-write for a single post."""
    with DATA_LOCK:
        posts = _read()
        p = _find(posts, pid)
        if not p:
            return False
        mutator(p)
        _write(posts)
        return True

def _set_analysis_progress(
    pid: str,
    *,
    state: Any = UNSET,
    current_ticker: Any = UNSET,
    completed: Any = UNSET,
    total: Any = UNSET,
):
    def mutator(post: Dict[str, Any]):
        ana = post.get("analysis") or {}
        if not isinstance(ana, dict):
            ana = {}
        progress = ana.get("progress") or {}
        if state is not UNSET:
            progress["state"] = state
        if current_ticker is not UNSET:
            progress["currentTicker"] = current_ticker
        if completed is not UNSET:
            progress["completed"] = int(completed)
        if total is not UNSET:
            progress["total"] = int(total)
        progress["updatedAt"] = _utcnow_iso()
        ana["progress"] = progress
        ana["updatedAt"] = _utcnow_iso()
        post["analysis"] = ana
        post["updatedAt"] = _utcnow_iso()
    _update_post(pid, mutator)

def _get_job_states() -> Dict[str, Any]:
    with JOB_LOCK:
        running = CURRENT_JOB.get("pid")
        queue = list(JOB_QUEUE)
        states = dict(JOB_STATE)
        # Ensure all queued/running have at least a state value
        if running and states.get(running) != 'running':
            states[running] = 'running'
        for q in queue:
            if states.get(q) not in ('queued','running'):
                states[q] = 'queued'
        return {"running": running, "queue": queue, "states": states}

def _set_state(pid: str, state: str):
    with JOB_LOCK:
        JOB_STATE[pid] = state
        if state in ('done', 'error', 'stopped'):
            # clear stop flag once finished
            ev = STOP_FLAGS.get(pid)
            if ev: ev.clear()
            # Update post with completion timestamp when done
            if state == 'done':
                def _set_completion_time(pp):
                    ana = pp.get("analysis") or {}
                    if not isinstance(ana, dict):
                        ana = {}
                    ana["completedAt"] = _utcnow_iso()
                    ana["updatedAt"] = _utcnow_iso()
                    pp["analysis"] = ana
                    pp["updatedAt"] = _utcnow_iso()
                try:
                    _update_post(pid, _set_completion_time)
                except Exception:
                    pass  # Don't fail state update if post update fails
        evt = {"type": "state", "pid": pid, "state": state}
        QUEUE_EVENTS.append(evt)
        QUEUE_CV.notify_all()
    if state in TERMINAL_STATES:
        try:
            _set_analysis_progress(pid, state=state, current_ticker=None)
        except Exception:
            pass

def _build_queue_status_payload() -> Dict[str, Any]:
    data = _get_job_states()
    try:
        posts = _read()
        prim = {}
        for p in posts:
            pid = str(p.get("id"))
            tickers = p.get("tickers") or []
            if not tickers:
                continue
            primary = tickers[0]
            ana = p.get("analysis") or {}
            per = (ana.get("per_ticker") or {})
            rec = per.get(primary) or {}
            sug = rec.get("suggestion")
            if sug:
                prim[pid] = {"ticker": primary, "suggestion": sug}
        if prim:
            data["primary_suggestions"] = prim
    except Exception:
        pass
    return data

# -------------------
# TradingAgents adapter
# -------------------
def run_tradingagents_analysis(tickers: List[str], options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Drive TradingAgents via TradingAgentsGraph to produce a Buy/Hold/Sell per ticker.

    options (all optional):
      - date: 'YYYY-MM-DD' (default: today in APP_TZ)
      - debug: bool (default False)
      - selected_analysts: list[str] e.g. ["market","social","news","fundamentals"]
      - config: dict of overrides merged into DEFAULT_CONFIG (e.g., llm_provider, models, flags)
      - top-level overrides also accepted: llm_provider, deep_think_llm, quick_think_llm, backend_url, online_tools, max_debate_rounds, project_dir
    """
    def _norm(s: str) -> str:
        v = (s or "").strip().lower()
        if "buy" in v:
            return "Buy"
        if "sell" in v:
            return "Sell"
        return "Hold"

    if tradingagents is None:
        # Graceful fallback when package isn't available
        pseudo = {"summary": "TradingAgents not installed; using Hold placeholder.", "per_ticker": {}}
        for t in tickers:
            pseudo["per_ticker"][t] = {"suggestion": "Hold", "signals": {"note": "stub"}}
        return pseudo

    # Import concrete API as per README
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
    except Exception as e:
        return {"summary": f"TradingAgents import error: {e}", "per_ticker": {t: {"suggestion": "Hold", "signals": {"error": str(e)}} for t in tickers}}

    resolved = _resolve_analysis_settings(options)
    cfg = resolved["config"]
    selected_analysts = resolved["selected_analysts"]
    debug = resolved["debug"]
    date_str = resolved["date"]

    result: Dict[str, Any] = {"summary": "", "per_ticker": {}}
    lines: List[str] = []
    for t in tickers:
        try:
            ta = TradingAgentsGraph(selected_analysts=selected_analysts, debug=debug, config=cfg)
            final_state, decision = ta.propagate(t, date_str)
            sug = _norm(decision)
            signals = {
                "final_trade_decision": final_state.get("final_trade_decision"),
                "investment_plan": final_state.get("investment_plan"),
                "judge_decision_invest": (final_state.get("investment_debate_state") or {}).get("judge_decision"),
                "judge_decision_risk": (final_state.get("risk_debate_state") or {}).get("judge_decision"),
            }
            result["per_ticker"][t] = {"suggestion": sug, "signals": signals}
            lines.append(f"{t}: {sug} ({date_str})")
        except Exception as e:
            result["per_ticker"][t] = {"suggestion": "Hold", "signals": {"error": str(e)}}
            lines.append(f"{t}: Hold (error)")

    result["summary"] = "\n".join(lines)
    return result

# -------------------
# yfinance helpers
# -------------------
def get_latest_price(ticker: str) -> float | None:
    return get_price_and_prev_close(ticker)[0]

def get_price_and_prev_close(ticker: str) -> tuple[float | None, float | None]:
    """Latest price plus the prior trading day's close (for day-change deltas).

    Uses yfinance's `.info` regularMarketPrice/regularMarketPreviousClose — Yahoo's
    own paired quote fields, matching the day-change % shown on Yahoo/Google Finance.
    Two prior approaches were tried and both turned out wrong:
      - `history(period="5d")[-2]`: intraday, Yahoo's daily bars don't include a live
        "today" row, so closes[-1] was actually yesterday's close and closes[-2] the
        day before — an off-by-one that silently inverted the day-change sign.
      - `fast_info.previous_close`: disagreed with `.info.regularMarketPreviousClose`
        by a few percent on every ticker tested (TQQQ, LMT, AAPL, TSLA) — it appears
        to source from a different/stale bar than the `last_price` it's paired with.
    """
    if yf is None:
        return None, None
    try:
        info = yf.Ticker(ticker).info or {}
        current = info.get("regularMarketPrice")
        prev_close = info.get("regularMarketPreviousClose") or info.get("previousClose")
        if current is not None:
            return float(current), (float(prev_close) if prev_close is not None else None)
    except Exception:
        pass
    # Fallback: daily/intraday history, for tickers `.info` can't resolve.
    try:
        info = yf.Ticker(ticker)
        daily = info.history(period="5d", interval="1d")
        prev_close = None
        daily_last = None
        if daily is not None and not daily.empty:
            closes = daily["Close"].dropna()
            if len(closes) >= 2:
                prev_close = float(closes.iloc[-2])
            if len(closes):
                daily_last = float(closes.iloc[-1])
        px = info.history(period="1d", interval="1m")
        if px is not None and not px.empty:
            return float(px["Close"].iloc[-1]), prev_close
        if daily_last is not None:
            return daily_last, prev_close
    except Exception:
        pass
    return None, None

def get_chart_data(ticker: str, period="6mo", interval="1d") -> Dict[str, Any]:
    empty = {"timestamps": [], "opens": [], "highs": [], "lows": [], "closes": [], "volumes": []}
    if yf is None:
        return empty
    try:
        # For 4h, yfinance does not have a direct 4h interval; aggregate 1h into 4h
        agg4h = False
        req_interval = interval
        if interval == "4h":
            agg4h = True
            req_interval = "1h"
        df = yf.Ticker(ticker).history(period=period, interval=req_interval)
        if df is None or df.empty:
            return empty
        if agg4h:
            # Resample to 4-hour buckets with OHLCV semantics.
            try:
                df = df.resample("4H").agg({
                    "Open": "first",
                    "High": "max",
                    "Low": "min",
                    "Close": "last",
                    "Volume": "sum",
                })
            except Exception:
                pass
        # Drop rows where Close is NaN (yfinance can return a partial/current bar at the end)
        if "Close" in df.columns:
            df = df.dropna(subset=["Close"])
        if df.empty:
            return empty
        if "Close" not in df:
            return empty
        if "Open" not in df:
            df["Open"] = df["Close"]
        if "High" not in df:
            df["High"] = df["Close"]
        if "Low" not in df:
            df["Low"] = df["Close"]
        if "Volume" not in df:
            df["Volume"] = 0
        ts = [int(pdts.timestamp() * 1000) for pdts in df.index.to_pydatetime()]
        opens = [float(x) for x in df["Open"].fillna(df["Close"]).tolist()]
        highs = [float(x) for x in df["High"].fillna(df["Close"]).tolist()]
        lows = [float(x) for x in df["Low"].fillna(df["Close"]).tolist()]
        closes = [float(x) for x in df["Close"].tolist()]
        volumes = [max(0.0, float(x)) for x in df["Volume"].fillna(0).tolist()]
        return {"timestamps": ts, "opens": opens, "highs": highs, "lows": lows, "closes": closes, "volumes": volumes}
    except Exception:
        return empty

# -------------------
# Fundamentals (yfinance .info), normalized to the cheatsheet metrics
# -------------------
_FUND_CACHE: Dict[str, Any] = {}  # ticker -> (timestamp, payload)
_FUND_TTL = 3600.0  # seconds

def get_fundamentals(ticker: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "ticker": ticker,
        "name": None,
        "currency": None,
        "sector": None,
        "industry": None,
        "metrics": {},
        "available": False,
        "error": None,
    }
    if yf is None:
        out["error"] = "yfinance unavailable"
        return out
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as e:
        out["error"] = str(e)
        return out
    if not info or not isinstance(info, dict):
        out["error"] = "No fundamental data returned"
        return out

    def num(x):
        return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None

    def pct(x):
        v = num(x)
        return v * 100.0 if v is not None else None

    out["name"] = info.get("longName") or info.get("shortName")
    out["currency"] = info.get("financialCurrency") or info.get("currency")
    out["sector"] = info.get("sector")
    out["industry"] = info.get("industry")

    d2e_raw = num(info.get("debtToEquity"))
    metrics = {
        # Valuation
        "peTrailing": num(info.get("trailingPE")),
        "peForward": num(info.get("forwardPE")),
        "peg": num(info.get("trailingPegRatio")) or num(info.get("pegRatio")),
        "ps": num(info.get("priceToSalesTrailing12Months")),
        "pb": num(info.get("priceToBook")),
        "evEbitda": num(info.get("enterpriseToEbitda")),
        # Profitability (yfinance reports as fractions)
        "grossMargin": pct(info.get("grossMargins")),
        "operatingMargin": pct(info.get("operatingMargins")),
        "netMargin": pct(info.get("profitMargins")),
        "ebitdaMargin": pct(info.get("ebitdaMargins")),
        "roe": pct(info.get("returnOnEquity")),
        "roa": pct(info.get("returnOnAssets")),
        # Growth
        "revenueGrowth": pct(info.get("revenueGrowth")),
        "earningsGrowth": pct(info.get("earningsGrowth")),
        # Financial health
        "debtToEquity": (d2e_raw / 100.0) if d2e_raw is not None else None,  # yfinance gives % form
        "currentRatio": num(info.get("currentRatio")),
        "quickRatio": num(info.get("quickRatio")),
        # Cash flow
        "freeCashflow": num(info.get("freeCashflow")),
        "operatingCashflow": num(info.get("operatingCashflow")),
        # Context
        "marketCap": num(info.get("marketCap")),
        "totalCash": num(info.get("totalCash")),
        "totalDebt": num(info.get("totalDebt")),
        "revenue": num(info.get("totalRevenue")),
        "price": num(info.get("currentPrice")) or num(info.get("regularMarketPrice")),
        "eps": num(info.get("trailingEps")),
        "beta": num(info.get("beta")),
    }
    # Derived metrics
    fcf, rev, mc = metrics.get("freeCashflow"), metrics.get("revenue"), metrics.get("marketCap")
    if fcf is not None and rev:
        metrics["fcfMargin"] = fcf / rev * 100.0
    if fcf is not None and mc:
        metrics["fcfYield"] = fcf / mc * 100.0
    tc, td = metrics.get("totalCash"), metrics.get("totalDebt")
    if tc is not None and td is not None:
        metrics["netCash"] = tc - td
    dy = num(info.get("dividendYield"))
    if dy is not None:
        metrics["dividendYield"] = dy * 100.0 if dy < 1 else dy

    out["metrics"] = {k: round(v, 4) for k, v in metrics.items() if v is not None}
    out["available"] = bool(out["metrics"])
    return out

def _sse(data: Dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"

def _wrap_text(s: str, width: int = 120) -> str:
    try:
        out_lines = []
        for line in str(s).splitlines():
            if len(line) <= width:
                out_lines.append(line)
                continue
            # simple whitespace wrap
            start = 0
            n = len(line)
            while start < n:
                end = min(start + width, n)
                # try to break at last space before end
                space_idx = line.rfind(" ", start, end)
                if space_idx == -1 or space_idx <= start:
                    out_lines.append(line[start:end])
                    start = end
                else:
                    out_lines.append(line[start:space_idx])
                    start = space_idx + 1
        return "\n".join(out_lines)
    except Exception:
        return str(s)

# -------------------
# Calculations
# -------------------
def percent_change(purchase: float | None, current: float | None) -> float | None:
    if purchase is None or current is None or purchase == 0:
        return None
    return (current - purchase) / purchase * 100.0

def row_suggestion(analysis: Dict[str, Any], primary: str) -> str:
    per = analysis.get("per_ticker", {})
    rec = per.get(primary) or {}
    return rec.get("suggestion", "Hold")

# -------------------
# Analysis execution (non-streaming) honoring STOP flags
# -------------------
def perform_analysis(pid: str) -> None:
    posts = _read()
    p = _find(posts, pid)
    if not p:
        _set_state(pid, 'error')
        return
    tickers = p.get("tickers") or []
    opts = _normalize_options(p.get("options") or {})

    def init_analysis(pp):
        ana = pp.get("analysis") or {}
        if not isinstance(ana, dict):
            ana = {}
        if "report" not in ana:
            ana["report"] = []  # Initialize as array for report filenames
        elif isinstance(ana["report"], str):
            # Migration: if old string format exists, keep it for now but mark for conversion
            pass
        if "per_ticker" not in ana:
            ana["per_ticker"] = {}
        ana["updatedAt"] = _utcnow_iso()
        pp["analysis"] = ana

    def log_line(msg):
        wrapped = _wrap_text(msg)
        def m(pp):
            init_analysis(pp)
            # Get primary ticker for this analysis (use first ticker as default)
            primary_ticker = tickers[0] if tickers else "REPORT"
            # Append to report file
            filename = _append_to_report_file(pid, primary_ticker, wrapped + "\n")
            # Update report files array if needed
            report_files = pp["analysis"].get("report", [])
            if isinstance(report_files, str):
                # Old format - convert to array
                report_files = []
            if filename not in report_files:
                report_files.append(filename)
            pp["analysis"]["report"] = report_files
            pp["analysis"]["updatedAt"] = _utcnow_iso()
        _update_post(pid, m)

    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
    except Exception as e:
        log_line(f"ERROR: {e}")
        _set_state(pid, 'error')
        return

    resolved = _resolve_analysis_settings(opts)
    cfg = resolved["config"]
    selected_analysts = resolved["selected_analysts"]
    debug = resolved["debug"]
    date_str = resolved["date"]
    total_tickers = len(tickers)

    # Prepare isolated base dir
    try:
        base_run_dir = os.path.join(DATA_DIR, ".ta_runs", str(pid))
        os.makedirs(base_run_dir, exist_ok=True)
    except Exception:
        base_run_dir = None
    if "project_dir" not in cfg and base_run_dir:
        cfg["project_dir"] = os.path.join(base_run_dir, "base")

    stop_ev = STOP_FLAGS.setdefault(pid, threading.Event())

    def derive_decision(text: str) -> str | None:
        try:
            txt = (text or "").lower()
            if not txt: return None
            if "final" in txt or "proposal" in txt or "decision" in txt:
                if "buy" in txt: return "Buy"
                if "sell" in txt: return "Sell"
                if "hold" in txt: return "Hold"
            if "buy" in txt: return "Buy"
            if "sell" in txt: return "Sell"
            if "hold" in txt: return "Hold"
            return None
        except Exception:
            return None

    for index, t in enumerate(tickers):
        if stop_ev.is_set():
            _set_analysis_progress(pid, state='stopped', current_ticker=None, total=total_tickers)
            _set_state(pid, 'stopped')
            return
        _set_analysis_progress(pid, state='running', current_ticker=t, completed=index, total=total_tickers)
        attempt = 1
        local_cfg = dict(cfg)
        while attempt <= 2:
            try:
                if attempt > 1 and base_run_dir:
                    run_ns = os.path.join(base_run_dir, t)
                    try:
                        os.makedirs(run_ns, exist_ok=True)
                        local_cfg = dict(local_cfg)
                        local_cfg["project_dir"] = os.path.join(run_ns, f"run-{int(time.time())}")
                        os.makedirs(local_cfg["project_dir"], exist_ok=True)
                    except Exception:
                        pass
                ta = TradingAgentsGraph(selected_analysts=selected_analysts, debug=debug, config=local_cfg)
                init_state = ta.propagator.create_initial_state(t, date_str)
                args = ta.propagator.get_graph_args()
                final_state = None
                last_decision_seen = None
                for chunk in ta.graph.stream(init_state, **args):
                    if stop_ev.is_set():
                        _set_state(pid, 'stopped')
                        return
                    if not chunk.get("messages"): continue
                    message = chunk["messages"][-1]
                    content = getattr(message, "content", None)
                    if content and str(content).strip():
                        text = str(content).strip()
                        log_line(f"{t}: {text}")
                        d = derive_decision(text)
                        if d: last_decision_seen = d
                    final_state = chunk
                if not final_state:
                    raise RuntimeError("No final state produced by graph.stream")
                decision = None
                if final_state and final_state.get("final_trade_decision"):
                    try:
                        decision = ta.process_signal(final_state["final_trade_decision"]) or ""
                    except Exception:
                        decision = str(final_state.get("final_trade_decision") or "")
                if not decision:
                    decision = last_decision_seen or "Hold"
                norm = ("Buy" if "buy" in str(decision).lower() else "Sell" if "sell" in str(decision).lower() else "Hold")
                signals = {
                    "final_trade_decision": final_state.get("final_trade_decision"),
                    "investment_plan": final_state.get("investment_plan"),
                    "judge_decision_invest": (final_state.get("investment_debate_state") or {}).get("judge_decision"),
                    "judge_decision_risk": (final_state.get("risk_debate_state") or {}).get("judge_decision"),
                }
                def upd(pp):
                    init_analysis(pp)
                    per = pp["analysis"].setdefault("per_ticker", {})
                    per[t] = {"suggestion": norm, "signals": signals}
                    pp["analysis"]["updatedAt"] = _utcnow_iso()
                _update_post(pid, upd)
                # Snapshot (position/P&L derived from this holding's transactions)
                cur, prev_close = get_price_and_prev_close(t)
                def upd_snap(pp):
                    pos = _position_from_transactions(pp.get("transactions") or [])
                    pp.setdefault("snapshot", {})[t] = _snapshot_entry(pos, cur, prev_close)
                    pp["updatedAt"] = _utcnow_iso()
                _update_post(pid, upd_snap)
                _set_analysis_progress(pid, state='running', current_ticker=t, completed=index + 1, total=total_tickers)
                break
            except Exception as e:
                msg = str(e)
                if ("already exists" in msg and "memory" in msg.lower()) and attempt == 1:
                    log_line(f"{t}: warning Memory collection already exists; retrying with a fresh memory namespace.")
                    attempt += 1
                    continue
                log_line(f"{t}: error {e}")
                def upd_err(pp):
                    init_analysis(pp)
                    per = pp["analysis"].setdefault("per_ticker", {})
                    per[t] = {"suggestion": per.get(t, {}).get("suggestion", "Hold"), "signals": {"error": str(e)}}
                    pp["analysis"]["updatedAt"] = _utcnow_iso()
                _update_post(pid, upd_err)
                _set_analysis_progress(pid, state='running', current_ticker=t, completed=index + 1, total=total_tickers)
                break

    # Final summary
    posts_now = _read()
    p_now = _find(posts_now, pid)
    per = (p_now.get("analysis") or {}).get("per_ticker") or {}
    lines = []
    for tk in tickers:
        v = per.get(tk) or {}
        lines.append(f"{tk}: {v.get('suggestion','')} ({opts.get('date') or datetime.now(APP_TZ).date().isoformat()})")
    def set_summary(pp):
        init_analysis(pp)
        pp["analysis"]["summary"] = "\n".join(lines)
        pp["analysis"]["updatedAt"] = _utcnow_iso()
        pp["updatedAt"] = _utcnow_iso()
    _update_post(pid, set_summary)
    _set_analysis_progress(pid, state='done', current_ticker=None, completed=total_tickers, total=total_tickers)

# -------------------
# API
# -------------------
@app.get("/api/accounts")
def list_accounts():
    return jsonify(_ensure_accounts())

@app.post("/api/accounts")
def create_account():
    payload = request.get_json(force=True, silent=True) or {}
    with DATA_LOCK:
        accounts = _ensure_accounts()
        fields = _normalize_account(payload)
        now = _utcnow_iso()
        acc = {
            "id": str(uuid.uuid4()),
            "name": fields["name"],
            "type": fields["type"],
            "order": (max([a.get("order", 0) for a in accounts]) + 1) if accounts else 0,
            "collapsed": fields["collapsed"],
            "keyword": fields["keyword"],
            "cashFlows": fields["cashFlows"],
            "createdAt": now,
            "updatedAt": now,
        }
        accounts.append(acc)
        _write_accounts(accounts)
    return jsonify(acc), 201

@app.put("/api/accounts/<aid>")
def update_account(aid):
    payload = request.get_json(force=True, silent=True) or {}
    with DATA_LOCK:
        accounts = _read_accounts()
        acc = next((a for a in accounts if str(a.get("id")) == str(aid)), None)
        if not acc:
            return jsonify({"message": "Not found"}), 404
        fields = _normalize_account(payload, acc)
        acc["name"] = fields["name"]
        acc["type"] = fields["type"]
        acc["collapsed"] = fields["collapsed"]
        acc["keyword"] = fields["keyword"]
        acc["cashFlows"] = fields["cashFlows"]
        acc["updatedAt"] = _utcnow_iso()
        _write_accounts(accounts)
    return jsonify(acc)

@app.post("/api/accounts/<aid>/collapse")
def collapse_account(aid):
    payload = request.get_json(force=True, silent=True) or {}
    with DATA_LOCK:
        accounts = _read_accounts()
        acc = next((a for a in accounts if str(a.get("id")) == str(aid)), None)
        if not acc:
            return jsonify({"message": "Not found"}), 404
        if "collapsed" in payload:
            acc["collapsed"] = _coerce_bool(payload.get("collapsed"), False)
        else:
            acc["collapsed"] = not _coerce_bool(acc.get("collapsed"), False)
        acc["updatedAt"] = _utcnow_iso()
        _write_accounts(accounts)
    return jsonify(acc)

@app.post("/api/accounts/reorder")
def reorder_accounts():
    payload = request.get_json(force=True, silent=True) or {}
    order = payload.get("order") or []
    if not isinstance(order, list):
        return jsonify({"message": "order must be a list of ids"}), 400
    with DATA_LOCK:
        accounts = _read_accounts()
        by_id = {str(a.get("id")): a for a in accounts}
        rank = {str(pid): i for i, pid in enumerate(order)}
        for a in accounts:
            aid_s = str(a.get("id"))
            if aid_s in rank:
                a["order"] = rank[aid_s]
        accounts.sort(key=lambda a: (a.get("order", 0), a.get("createdAt", "")))
        _write_accounts(accounts)
    return jsonify({"message": "ok", "order": [a.get("id") for a in accounts]})

@app.delete("/api/accounts/<aid>")
def delete_account(aid):
    with DATA_LOCK:
        accounts = _read_accounts()
        acc = next((a for a in accounts if str(a.get("id")) == str(aid)), None)
        if not acc:
            return jsonify({"message": "Not found"}), 404
        remaining = [a for a in accounts if str(a.get("id")) != str(aid)]
        if not remaining:
            remaining = [_default_account()]
        target_id = remaining[0]["id"]
        # Reassign this account's holdings to the first remaining account.
        posts = _read()
        moved = 0
        for p in posts:
            if str(p.get("accountId")) == str(aid):
                p["accountId"] = target_id
                p["updatedAt"] = _utcnow_iso()
                moved += 1
        if moved:
            _write(posts)
        _write_accounts(remaining)
    return jsonify({"message": "deleted", "movedHoldings": moved, "reassignedTo": target_id})

@app.get("/api/config")
def api_config():
    warnings = []
    if tradingagents is None:
        warnings.append("TradingAgents could not be imported. Analyses will fall back to placeholders until dependencies are fixed.")
    if yf is None:
        warnings.append("yfinance is unavailable. Price snapshots and charts may be empty.")
    return jsonify({
        "server": True,
        "tradingagentsAvailable": tradingagents is not None,
        "yfinanceAvailable": yf is not None,
        "autoRegenerationEnabled": AUTO_REGEN_ENABLED,
        "defaultPreset": DEFAULT_ANALYSIS_PRESET,
        "analysisPresets": ANALYSIS_PRESETS,
        "supportedAnalysts": SUPPORTED_ANALYSTS,
        "analystLabels": ANALYST_LABELS,
        "defaultOptions": _normalize_options({}),
        "warnings": warnings,
        "configSummary": _get_personal_config_summary(),
    })

@app.get("/api/stocks")
def list_posts():
    posts = _read()
    for p in posts:
        _normalize_post_for_client(p)
    return jsonify(posts)

@app.get("/api/stocks/<pid>")
def get_post(pid):
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    return jsonify(_normalize_post_for_client(p))

@app.post("/api/stocks/reorder")
def reorder_posts():
    """
    Persist a new custom order of posts.
    Body: {"order": [id1, id2, ...]}
    Any ids not present will retain their relative order and be appended.
    """
    payload = request.get_json(force=True, silent=True) or {}
    order = payload.get("order") or []
    if not isinstance(order, list):
        return jsonify({"message": "order must be a list of ids"}), 400

    posts = _read()
    # Build mapping and preserve original order for unspecified ids
    by_id = {str(p.get("id")): p for p in posts}
    used = set()
    new_posts = []
    for pid in order:
        pid_s = str(pid)
        if pid_s in by_id and pid_s not in used:
            new_posts.append(by_id[pid_s])
            used.add(pid_s)
    # Append any remaining posts in their original order
    for p in posts:
        pid_s = str(p.get("id"))
        if pid_s not in used:
            new_posts.append(p)
            used.add(pid_s)

    _write(new_posts)
    return jsonify({"message": "ok", "order": [p.get("id") for p in new_posts]})

@app.post("/api/stocks")
def create_post():
    payload = request.get_json(force=True, silent=True) or {}
    # A holding tracks a single ticker inside an account. shape:
    # {
    #   "ticker": str,              # the symbol to track
    #   "accountId": str,           # owning account (defaults to first account)
    #   "title": str, "note": str,
    #   "options": {...},           # TradingAgents options
    #   "transactions": [ {type, shares, price, date, fee, note}, ... ]
    # }
    now = _utcnow_iso()
    normalized = _normalize_post_for_storage(payload)
    account_id = normalized["accountId"]
    if not account_id:
        accounts = _ensure_accounts()
        account_id = accounts[0]["id"] if accounts else ""
    p = {
        "id": str(uuid.uuid4()),
        "createdAt": now,
        "updatedAt": now,
        "accountId": account_id,
        "title": normalized["title"],
        "description": normalized["description"],
        "note": normalized["note"],
        "ticker": normalized["tickers"][0] if normalized["tickers"] else "",
        "tickers": normalized["tickers"],
        "transactions": normalized["transactions"],
        "options": normalized["options"],
        "purchases": normalized["purchases"],  # {ticker: avgCost} (back-compat)
        "autoAnalyze": normalized["autoAnalyze"],  # opt-in to daily market-close analysis
        "analysis": None,  # last TradingAgents run
        "snapshot": {}     # {ticker: {current, pct, shares, avgCost, marketValue, ...}}
    }
    # Compute an initial snapshot so the new holding shows price/P&L immediately.
    try:
        p["snapshot"] = _build_holding_snapshot(p)
    except Exception:
        p["snapshot"] = {}
    posts = _read()
    posts.append(p)
    _write(posts)
    return jsonify(p), 201

@app.get("/api/summarize/<pid>")
def summarize_post(pid):
    """
    Compute and persist a summary for the post immediately based on current analysis.
    For each ticker, prefer per_ticker suggestion; if missing, attempt to parse from report text.
    """
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    analysis = p.get("analysis") or {}
    per = analysis.get("per_ticker") or {}
    # Compile report files into text for parsing
    report_files = analysis.get("report", [])
    report_text = _get_compiled_report(report_files) if isinstance(report_files, list) else (report_files if isinstance(report_files, str) else "")
    opts = _normalize_options(p.get("options") or {})
    date_str = (opts.get("date") or datetime.now(APP_TZ).date().isoformat())

    def parse_from_report(tk: str) -> str | None:
        try:
            if not report_text:
                return None
            # Scan lines mentioning this ticker for last clear decision
            decision = None
            for line in report_text.splitlines():
                if tk.upper() not in line.upper():
                    continue
                low = line.lower()
                if ("final" in low) or ("proposal" in low) or ("decision" in low) or (":" in low):
                    if "buy" in low:
                        decision = "Buy"
                    elif "sell" in low:
                        decision = "Sell"
                    elif "hold" in low:
                        decision = "Hold"
            return decision
        except Exception:
            return None

    lines = []
    for tk in (p.get("tickers") or []):
        sug = (per.get(tk) or {}).get("suggestion")
        if not sug:
            sug = parse_from_report(tk) or "Hold"
        lines.append(f"{tk}: {sug} ({date_str})")

    if lines:
        if not p.get("analysis"):
            p["analysis"] = {}
        p["analysis"]["summary"] = "\n".join(lines)
        p["analysis"]["updatedAt"] = _utcnow_iso()
        p["updatedAt"] = _utcnow_iso()
        _write(posts)
    

    return jsonify(_normalize_post_for_client(p))

@app.put("/api/stocks/<pid>")
def update_post(pid):
    payload = request.get_json(force=True, silent=True) or {}
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    previous_tickers = list(p.get("tickers") or [])
    previous_options = _normalize_options(p.get("options") or {})
    normalized = _normalize_post_for_storage(payload, p)

    p["title"] = normalized["title"]
    p["description"] = normalized["description"]
    p["note"] = normalized["note"]
    if "accountId" in payload and normalized["accountId"]:
        p["accountId"] = normalized["accountId"]
    p["tickers"] = normalized["tickers"]
    p["ticker"] = normalized["tickers"][0] if normalized["tickers"] else ""
    p["transactions"] = normalized["transactions"]
    p["options"] = normalized["options"]
    p["purchases"] = normalized["purchases"]
    p["autoAnalyze"] = normalized["autoAnalyze"]

    analysis_inputs_changed = previous_tickers != normalized["tickers"] or previous_options != normalized["options"]
    if analysis_inputs_changed:
        p["analysis"] = None
    # Recompute snapshot (positions/P&L derived from transactions + latest price).
    try:
        p["snapshot"] = _build_holding_snapshot(p)
    except Exception:
        pos = _position_from_transactions(p.get("transactions") or [])
        if isinstance(p.get("snapshot"), dict):
            for ticker, snap in p["snapshot"].items():
                p["snapshot"][ticker] = _snapshot_entry(pos, (snap or {}).get("current"))
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p))

@app.delete("/api/stocks/<pid>")
def delete_post(pid):
    posts = _read()
    new_posts = [x for x in posts if str(x.get("id")) != str(pid)]
    if len(new_posts) == len(posts):
        return jsonify({"message": "Not found"}), 404
    _write(new_posts)
    return jsonify({"message": "deleted"})

# -------------------
# Transactions (buy/sell history per holding)
# -------------------
def _save_holding_after_txn_change(pid: str, holding: Dict[str, Any], posts: List[Dict[str, Any]]):
    """Recompute back-compat purchases + snapshot for a holding and persist."""
    pos = _position_from_transactions(holding.get("transactions") or [])
    ticker = (holding.get("tickers") or [holding.get("ticker")] or [None])[0]
    holding["purchases"] = {ticker: pos["avgCost"]} if (ticker and pos.get("avgCost")) else {}
    try:
        holding["snapshot"] = _build_holding_snapshot(holding)
    except Exception:
        pass
    holding["updatedAt"] = _utcnow_iso()
    _write(posts)

@app.post("/api/stocks/<pid>/transactions")
def add_transaction(pid):
    payload = request.get_json(force=True, silent=True) or {}
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    cleaned = _normalize_transactions([payload])
    if not cleaned:
        return jsonify({"message": "Invalid transaction. Need type (buy/sell), shares > 0, price >= 0."}), 400
    p.setdefault("transactions", []).append(cleaned[0])
    _save_holding_after_txn_change(pid, p, posts)
    return jsonify(_normalize_post_for_client(p)), 201

@app.put("/api/stocks/<pid>/transactions/<txid>")
def update_transaction(pid, txid):
    payload = request.get_json(force=True, silent=True) or {}
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    txns = p.get("transactions") or []
    idx = next((i for i, t in enumerate(txns) if str(t.get("id")) == str(txid)), None)
    if idx is None:
        return jsonify({"message": "Transaction not found"}), 404
    merged = dict(txns[idx])
    merged.update(payload)
    merged["id"] = str(txid)
    cleaned = _normalize_transactions([merged])
    if not cleaned:
        return jsonify({"message": "Invalid transaction."}), 400
    txns[idx] = cleaned[0]
    p["transactions"] = txns
    _save_holding_after_txn_change(pid, p, posts)
    return jsonify(_normalize_post_for_client(p))

@app.delete("/api/stocks/<pid>/transactions/<txid>")
def delete_transaction(pid, txid):
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    txns = p.get("transactions") or []
    new_txns = [t for t in txns if str(t.get("id")) != str(txid)]
    if len(new_txns) == len(txns):
        return jsonify({"message": "Transaction not found"}), 404
    p["transactions"] = new_txns
    _save_holding_after_txn_change(pid, p, posts)
    return jsonify(_normalize_post_for_client(p))

# -------------------
# Comments (freeform notes per holding; do not affect the position)
# -------------------
@app.post("/api/stocks/<pid>/comments")
def add_comment(pid):
    payload = request.get_json(force=True, silent=True) or {}
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    cleaned = _normalize_comments([{**payload, "status": "pending"}])
    if not cleaned:
        return jsonify({"message": "Comment text is required."}), 400
    p.setdefault("comments", []).append(cleaned[0])
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p)), 201

@app.put("/api/stocks/<pid>/comments/<cid>")
def update_comment(pid, cid):
    payload = request.get_json(force=True, silent=True) or {}
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    comments = p.get("comments") or []
    idx = next((i for i, c in enumerate(comments) if str(c.get("id")) == str(cid)), None)
    if idx is None:
        return jsonify({"message": "Comment not found"}), 404
    merged = dict(comments[idx])
    if "text" in payload:
        merged["text"] = payload.get("text")
    if "status" in payload:
        merged["status"] = payload.get("status")
    merged["id"] = str(cid)
    merged["updatedAt"] = _utcnow_iso()
    cleaned = _normalize_comments([merged])
    if not cleaned:
        return jsonify({"message": "Invalid comment."}), 400
    comments[idx] = cleaned[0]
    p["comments"] = comments
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p))

@app.delete("/api/stocks/<pid>/comments/<cid>")
def delete_comment(pid, cid):
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    comments = p.get("comments") or []
    new_comments = [c for c in comments if str(c.get("id")) != str(cid)]
    if len(new_comments) == len(comments):
        return jsonify({"message": "Comment not found"}), 404
    p["comments"] = new_comments
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p))

@app.post("/api/analyze/<pid>")
def analyze_post(pid):
    """
    Triggers TradingAgents analysis and yfinance snapshot for all tickers in this post.
    Stores the analysis + snapshot back into the post.
    """
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    tickers = p.get("tickers") or []
    opts = _normalize_options(p.get("options") or {})
    try:
        analysis = run_tradingagents_analysis(tickers, opts)
    except Exception as e:
        analysis = {"summary": f"Analysis failed: {e}", "per_ticker": {}}

    snapshot = _build_holding_snapshot(p)

    p["analysis"] = {
        "updatedAt": _utcnow_iso(),
        "progress": {
            "state": "done",
            "completed": len(tickers),
            "total": len(tickers),
            "currentTicker": None,
            "updatedAt": _utcnow_iso(),
        },
        **analysis,
    }
    p["snapshot"] = snapshot
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p))

@app.post("/api/queue/<pid>")
def enqueue_post(pid):
    # Enqueue a post for analysis; if running or already queued, return current status
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    with JOB_LOCK:
        newly_added = False
        if pid == CURRENT_JOB.get("pid"):
            JOB_STATE[pid] = 'running'
        elif pid in JOB_QUEUE:
            JOB_STATE[pid] = 'queued'
        else:
            JOB_QUEUE.append(pid)
            # If previously terminal state (done/error/stopped), reset to queued
            JOB_STATE[pid] = 'queued'
            newly_added = True
    _set_state(pid, JOB_STATE.get(pid, 'queued'))
    # Clear "done" marker if re-queued: remove final state so UI won't show stale done
    st = JOB_STATE.get(pid)
    if st == 'queued':
        try:
            def _prep(pp):
                ana = pp.get("analysis") or {}
                if isinstance(ana, dict):
                    # Keep existing per_ticker suggestions (so user sees last known) but remove summary marker if desired.
                    # Do not wipe per_ticker; UI will update progressively.
                    ana.setdefault("per_ticker", {})
                    # If this is a fresh enqueue (was not previously queued/running), clear the report immediately
                    if newly_added:
                        # Clear old report files
                        old_report_files = ana.get("report", [])
                        if isinstance(old_report_files, list):
                            for filename in old_report_files:
                                try:
                                    filepath = os.path.join(REPORTS_DIR, filename)
                                    if os.path.exists(filepath):
                                        os.remove(filepath)
                                except Exception:
                                    pass
                        ana["report"] = []
                        # Optional: could also clear summary; leaving summary intact until new one generated
                    ana["progress"] = {
                        "state": "queued",
                        "completed": 0,
                        "total": len(pp.get("tickers") or []),
                        "currentTicker": None,
                        "updatedAt": _utcnow_iso(),
                    }
                    pp["analysis"] = ana
            _update_post(pid, _prep)
        except Exception:
            pass
    return jsonify(_get_job_states())

@app.post("/api/queue/stop/<pid>")
def stop_post(pid):
    # If queued: remove from queue; If running: signal stop
    with JOB_LOCK:
        if pid in JOB_QUEUE:
            JOB_QUEUE[:] = [x for x in JOB_QUEUE if x != pid]
            JOB_STATE[pid] = 'stopped'
            _set_state(pid, 'stopped')
            return jsonify(_get_job_states())
        if pid == CURRENT_JOB.get("pid"):
            ev = STOP_FLAGS.setdefault(pid, threading.Event())
            ev.set()
            JOB_STATE[pid] = 'stopped'
            _set_state(pid, 'stopped')
            return jsonify(_get_job_states())
    # Not in the live queue/worker (e.g. orphaned by a server restart). If the
    # holding is still persisted as running/queued, force it to stopped so the
    # UI can recover.
    posts = _read()
    p = _find(posts, pid)
    state = (((p or {}).get("analysis") or {}).get("progress") or {}).get("state")
    if state in ("running", "queued"):
        _set_state(pid, 'stopped')
    return jsonify(_get_job_states())

@app.get("/api/queue/status")
def queue_status():
    # Retained for manual fetch / legacy; full payload build
    return jsonify(_build_queue_status_payload())

@app.get("/api/queue/stream")
def queue_stream():
    """SSE stream for queue terminal state changes only.
    Emits: {type: 'state', pid, state} for done/error/stopped
    Client should do a one-time GET /api/queue/status when dialog/feed opens, then listen here.
    """
    def gen():
        # Initial comment to open stream
        yield ":ok\n\n"
        while True:
            with QUEUE_CV:
                if not QUEUE_EVENTS:
                    QUEUE_CV.wait(timeout=25)
                events = list(QUEUE_EVENTS)
                QUEUE_EVENTS.clear()
            for evt in events:
                try:
                    yield _sse(evt)
                except Exception:
                    continue
            # Send a keep-alive comment every ~25s to keep connection open
            if not events:
                yield ":keep-alive\n\n"
    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream",
    }
    return Response(stream_with_context(gen()), headers=headers)

@app.get("/api/suggestions")
def suggestions():
    """Lightweight suggestions fetch: {post_id: {ticker: suggestion, ...}}"""
    out: Dict[str, Dict[str,str]] = {}
    try:
        posts = _read()
        for p in posts:
            pid = str(p.get("id"))
            per = (p.get("analysis") or {}).get("per_ticker") or {}
            if per:
                out[pid] = {tk: (per.get(tk) or {}).get("suggestion") for tk in per.keys()}
    except Exception:
        pass
    return jsonify(out)

@app.get("/api/refresh-snapshot/<pid>")
def refresh_snapshot(pid):
    """
    Refreshes current price snapshot for all tickers in the post without running analysis.
    Updates the post's snapshot and updatedAt, and returns the full post.
    """
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    p["snapshot"] = _build_holding_snapshot(p)
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify(_normalize_post_for_client(p))

@app.post("/api/refresh-snapshots")
def refresh_all_snapshots():
    posts = _read()
    refreshed = 0
    for post in posts:
        post["snapshot"] = _build_holding_snapshot(post)
        post["updatedAt"] = _utcnow_iso()
        refreshed += 1
    _write(posts)
    return jsonify({"refreshed": refreshed})

@app.get("/api/analyze-stream/<pid>")
def analyze_post_stream(pid):
    """
    Server-Sent Events (SSE) endpoint that runs analysis and streams progress logs.
    It also appends logs and incremental results to stocks.json as they occur.
    """
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404

    tickers = p.get("tickers") or []
    opts = _normalize_options(p.get("options") or {})

    def gen():
        # Initialize analysis log structure
        def init_analysis(pp):
            ana = pp.get("analysis") or {}
            if not isinstance(ana, dict):
                ana = {}
            if "report" not in ana:
                ana["report"] = []  # Initialize as array for report filenames
            elif isinstance(ana["report"], str):
                # Migration: if old string format exists, keep it for now
                pass
            if "per_ticker" not in ana:
                ana["per_ticker"] = {}
            progress = ana.get("progress") or {}
            progress.setdefault("state", "running")
            progress.setdefault("completed", 0)
            progress.setdefault("total", len(tickers))
            progress.setdefault("currentTicker", None)
            progress["updatedAt"] = _utcnow_iso()
            ana["progress"] = progress
            ana["updatedAt"] = _utcnow_iso()
            pp["analysis"] = ana

        _update_post(pid, init_analysis)
        yield _sse({"type": "start", "id": pid, "tickers": tickers})

        # Import TA and prepare config
        try:
            from tradingagents.graph.trading_graph import TradingAgentsGraph
        except Exception as e:
            # Log error and finish
            def log_err(pp):
                init_analysis(pp)
                primary_ticker = tickers[0] if tickers else "ERROR"
                filename = _write_report_file(pid, primary_ticker, _wrap_text(f"ERROR: {e}"))
                report_files = pp["analysis"].get("report", [])
                if isinstance(report_files, str):
                    report_files = []
                if filename not in report_files:
                    report_files.append(filename)
                pp["analysis"]["report"] = report_files
                pp["analysis"]["updatedAt"] = _utcnow_iso()
            _update_post(pid, log_err)
            yield _sse({"type": "error", "message": f"TradingAgents import error: {e}"})
            return

        resolved = _resolve_analysis_settings(opts)
        cfg = resolved["config"]
        selected_analysts = resolved["selected_analysts"]
        debug = resolved["debug"]
        date_str = resolved["date"]

        def log_line(msg, level="info"):
            wrapped = _wrap_text(msg)
            def m(pp):
                init_analysis(pp)
                # Use first ticker as primary for the report file
                primary_ticker = tickers[0] if tickers else "REPORT"
                filename = _append_to_report_file(pid, primary_ticker, wrapped + "\n")
                report_files = pp["analysis"].get("report", [])
                if isinstance(report_files, str):
                    report_files = []
                if filename not in report_files:
                    report_files.append(filename)
                pp["analysis"]["report"] = report_files
                pp["analysis"]["updatedAt"] = _utcnow_iso()
            _update_post(pid, m)

        # Ensure a base project directory to isolate runs per post
        try:
            base_run_dir = os.path.join(DATA_DIR, ".ta_runs", str(pid))
            os.makedirs(base_run_dir, exist_ok=True)
        except Exception:
            base_run_dir = None

        # If caller didn't specify a project_dir, set a stable base to avoid global collisions
        if "project_dir" not in cfg and base_run_dir:
            cfg["project_dir"] = os.path.join(base_run_dir, "base")

        for index, t in enumerate(tickers):
            _set_analysis_progress(pid, state='running', current_ticker=t, completed=index, total=len(tickers))
            yield _sse({"type": "ticker-start", "ticker": t})
            attempt = 1
            local_cfg = dict(cfg)
            while attempt <= 2:
                try:
                    # On retry, use a unique project_dir to avoid vector DB collection collisions
                    if attempt > 1 and base_run_dir:
                        try:
                            run_ns = os.path.join(base_run_dir, t)
                            os.makedirs(run_ns, exist_ok=True)
                            local_cfg = dict(local_cfg)
                            local_cfg["project_dir"] = os.path.join(run_ns, f"run-{int(time.time())}")
                            os.makedirs(local_cfg["project_dir"], exist_ok=True)
                        except Exception:
                            pass

                    ta = TradingAgentsGraph(selected_analysts=selected_analysts, debug=debug, config=local_cfg)
                    init_state = ta.propagator.create_initial_state(t, date_str)
                    args = ta.propagator.get_graph_args()
                    final_state = None
                    last_decision_seen = None  # fallback if final_state lacks decision

                    def _derive_decision_from_text(text: str) -> str | None:
                        try:
                            txt = (text or "").lower()
                            if not txt:
                                return None
                            # Prefer lines that look like a final decision
                            if "final" in txt or "proposal" in txt or "decision" in txt:
                                if "buy" in txt:
                                    return "Buy"
                                if "sell" in txt:
                                    return "Sell"
                                if "hold" in txt:
                                    return "Hold"
                            # Fallback: any clear buy/sell/hold mention
                            if "buy" in txt:
                                return "Buy"
                            if "sell" in txt:
                                return "Sell"
                            if "hold" in txt:
                                return "Hold"
                            return None
                        except Exception:
                            return None
                    for chunk in ta.graph.stream(init_state, **args):
                        if not chunk.get("messages"):
                            continue
                        message = chunk["messages"][-1]
                        content = getattr(message, "content", None)
                        if content and str(content).strip():
                            text = str(content).strip()
                            log_line(f"{t}: {text}")
                            # Remember the last seen explicit decision cue
                            d = _derive_decision_from_text(text)
                            if d:
                                last_decision_seen = d
                            yield _sse({"type": "log", "ticker": t, "message": text})
                        final_state = chunk

                    if not final_state:
                        raise RuntimeError("No final state produced by graph.stream")

                    # Decide
                    decision = None
                    if final_state and final_state.get("final_trade_decision"):
                        try:
                            decision = ta.process_signal(final_state["final_trade_decision"]) or ""
                        except Exception:
                            decision = str(final_state.get("final_trade_decision") or "")
                    # Fallback to parsed streamed text if no final state decision
                    if not decision:
                        decision = last_decision_seen or "Hold"
                    norm = ("Buy" if "buy" in str(decision).lower() else "Sell" if "sell" in str(decision).lower() else "Hold")
                    signals = {
                        "final_trade_decision": final_state.get("final_trade_decision"),
                        "investment_plan": final_state.get("investment_plan"),
                        "judge_decision_invest": (final_state.get("investment_debate_state") or {}).get("judge_decision"),
                        "judge_decision_risk": (final_state.get("risk_debate_state") or {}).get("judge_decision"),
                    }

                    def upd(pp):
                        init_analysis(pp)
                        per = pp["analysis"].setdefault("per_ticker", {})
                        per[t] = {"suggestion": norm, "signals": signals}
                        pp["analysis"]["updatedAt"] = _utcnow_iso()
                    _update_post(pid, upd)

                    # Update snapshot for this ticker (position/P&L from transactions)
                    cur, prev_close = get_price_and_prev_close(t)

                    def upd_snap(pp):
                        pos = _position_from_transactions(pp.get("transactions") or [])
                        pp.setdefault("snapshot", {})[t] = _snapshot_entry(pos, cur, prev_close)
                        pp["updatedAt"] = _utcnow_iso()
                    _update_post(pid, upd_snap)
                    _set_analysis_progress(pid, state='running', current_ticker=t, completed=index + 1, total=len(tickers))

                    yield _sse({"type": "ticker-done", "ticker": t, "suggestion": norm, "current": cur, "pct": pct})
                    break  # success, stop retry loop
                except Exception as e:
                    msg = str(e)
                    # If memory collection exists error, retry once with a fresh namespace
                    if ("already exists" in msg and "memory" in msg.lower()) and attempt == 1:
                        log_line(f"{t}: warning Memory collection already exists; retrying with a fresh memory namespace.")
                        try:
                            yield _sse({"type": "log", "ticker": t, "message": "Memory exists; retrying with fresh namespace."})
                        except Exception:
                            pass
                        attempt += 1
                        continue
                    # Non-retryable or second failure: record error and emit ticker-error
                    log_line(f"{t}: error {e}", level="error")
                    def upd_err(pp):
                        init_analysis(pp)
                        per = pp["analysis"].setdefault("per_ticker", {})
                        per[t] = {"suggestion": per.get(t, {}).get("suggestion", "Hold"), "signals": {"error": str(e)}}
                        pp["analysis"]["updatedAt"] = _utcnow_iso()
                    _update_post(pid, upd_err)
                    _set_analysis_progress(pid, state='running', current_ticker=t, completed=index + 1, total=len(tickers))
                    try:
                        yield _sse({"type": "ticker-error", "ticker": t, "error": str(e)})
                    except Exception:
                        pass
                    break

        # Build final summary
        posts_now = _read()
        p_now = _find(posts_now, pid)
        per = (p_now.get("analysis") or {}).get("per_ticker") or {}
        # Preserve original ticker order in summary
        lines = []
        for tk in tickers:
            v = per.get(tk) or {}
            lines.append(f"{tk}: {v.get('suggestion','')} ({opts.get('date') or datetime.now(APP_TZ).date().isoformat()})")
        def set_summary(pp):
            init_analysis(pp)
            pp["analysis"]["summary"] = "\n".join(lines)
            pp["analysis"]["updatedAt"] = _utcnow_iso()
        _update_post(pid, set_summary)
        _set_analysis_progress(pid, state='done', current_ticker=None, completed=len(tickers), total=len(tickers))
        yield _sse({"type": "done", "id": pid})

    headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream",
    }
    return Response(stream_with_context(gen()), headers=headers)

def _enqueue_auto_analyze() -> int:
    """Enqueue holdings that opted in to daily market-close analysis; return count.

    Auto-analysis is opt-in per holding (holding.autoAnalyze). Holdings default
    to OFF, so a fresh install / untouched holdings cost no LLM tokens at market
    close — the user manually clicks Analyze, or flips a holding's toggle on.
    """
    posts = _read()
    queued = 0
    with JOB_LOCK:
        for p in posts:
            pid = str(p.get("id"))
            if not (p.get("tickers") or []):
                continue
            if not _coerce_bool(p.get("autoAnalyze"), False):
                continue  # not opted in — skip
            # Skip if already running or queued
            if pid == CURRENT_JOB.get("pid") or pid in JOB_QUEUE:
                continue
            JOB_QUEUE.append(pid)
            JOB_STATE[pid] = 'queued'
            _set_state(pid, 'queued')
            queued += 1
    return queued

@app.post("/api/analyze-all")
def analyze_all():
    queued = _enqueue_auto_analyze()
    return jsonify({"queued": queued, "states": _get_job_states()})

@app.post("/api/stocks/<pid>/auto-analyze")
def set_auto_analyze(pid):
    """Flip a single holding's market-close auto-analysis opt-in.

    Lightweight vs. the full PUT: it only touches the flag, so it never clears
    an existing analysis report or recomputes the snapshot.
    """
    payload = request.get_json(force=True, silent=True) or {}
    enabled = _coerce_bool(payload.get("enabled"), False)
    posts = _read()
    p = _find(posts, pid)
    if not p:
        return jsonify({"message": "Not found"}), 404
    p["autoAnalyze"] = enabled
    p["updatedAt"] = _utcnow_iso()
    _write(posts)
    return jsonify({"id": pid, "autoAnalyze": enabled})

@app.post("/api/auto-analyze/bulk")
def bulk_auto_analyze():
    """Enable or disable market-close auto-analysis across many holdings at once.

    Body: {"enabled": bool, "accountId": optional str}. When accountId is given,
    only that account's holdings are changed; otherwise all holdings are.
    """
    payload = request.get_json(force=True, silent=True) or {}
    enabled = _coerce_bool(payload.get("enabled"), False)
    account_id = str(payload.get("accountId") or "").strip()
    posts = _read()
    changed = 0
    for p in posts:
        if account_id and str(p.get("accountId")) != account_id:
            continue
        if _coerce_bool(p.get("autoAnalyze"), False) != enabled:
            p["autoAnalyze"] = enabled
            p["updatedAt"] = _utcnow_iso()
            changed += 1
    if changed:
        _write(posts)
    return jsonify({"enabled": enabled, "changed": changed, "accountId": account_id or None})

TICKER_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-=^]{0,14}$")
CHART_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}
CHART_INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "4h", "1d", "5d", "1wk", "1mo", "3mo"}
_CHART_CACHE: Dict[Any, Any] = {}  # (ticker, period, interval) -> (timestamp, payload)
_CHART_TTL = 60.0  # seconds; the net-worth chart re-fetches every holding on each range click

@app.get("/api/chart")
def chart():
    """
    Returns OHLCV series suitable for line or candlestick charts.
    Params: ticker, period=6mo, interval=1d
    Cached briefly (see _CHART_TTL) since the net-worth chart fans out one request per
    holding on every range switch — without a cache that's N live yfinance round-trips
    on every click, which is the main source of the visible "freeze" when changing ranges.
    """
    ticker = (request.args.get("ticker") or "").upper().strip()
    if not TICKER_RE.match(ticker):
        return jsonify({"timestamps": [], "opens": [], "highs": [], "lows": [], "closes": [], "volumes": []})
    period = request.args.get("period") or "6mo"
    interval = request.args.get("interval") or "1d"
    if period not in CHART_PERIODS or interval not in CHART_INTERVALS:
        return jsonify({"message": "Unsupported period or interval"}), 400
    key = (ticker, period, interval)
    now = time.time()
    cached = _CHART_CACHE.get(key)
    if cached and (now - cached[0] < _CHART_TTL):
        return jsonify(cached[1])
    data = get_chart_data(ticker, period, interval)
    if data.get("timestamps"):
        _CHART_CACHE[key] = (now, data)
    return jsonify(data)

@app.get("/api/fundamentals/<ticker>")
def fundamentals(ticker):
    """Normalized fundamental metrics (yfinance) for a single ticker, cached ~1h."""
    tk = (ticker or "").upper().strip()
    if not TICKER_RE.match(tk):
        return jsonify({"ticker": "", "metrics": {}, "available": False, "error": "Invalid ticker"})
    force = _coerce_bool(request.args.get("refresh"), False)
    now = time.time()
    cached = _FUND_CACHE.get(tk)
    if cached and not force and (now - cached[0] < _FUND_TTL):
        return jsonify(cached[1])
    data = get_fundamentals(tk)
    # Only cache successful lookups so transient errors retry.
    if data.get("available"):
        _FUND_CACHE[tk] = (now, data)
    return jsonify(data)

# -------------------
# Analysis settings (LLM chain + search chain)
# -------------------
@app.get("/api/settings")
def get_settings():
    return jsonify(SETTINGS.describe())

@app.put("/api/settings")
@require_admin
def put_settings():
    payload = request.get_json(silent=True) or {}
    try:
        SETTINGS.save(payload)
    except SettingsError as e:
        return jsonify({"error": "invalid", "message": str(e)}), 400
    return jsonify(SETTINGS.describe())

@app.get("/api/settings/models/<provider_id>")
@require_admin
def list_provider_models(provider_id):
    """Live model list from the provider (cached ~10 min)."""
    try:
        return jsonify({"provider": provider_id, "models": list_remote_models(provider_id, _get_personal_config_copy())})
    except Exception as e:
        return jsonify({"provider": provider_id, "models": [], "error": "provider_error",
                        "message": f"{type(e).__name__}: {str(e)[:200]}"}), 502

@app.post("/api/settings/search/reset")
@require_admin
def reset_search_cooldowns():
    """Clear search-provider cooldowns (e.g. after topping up a quota)."""
    payload = request.get_json(silent=True) or {}
    reset_cooldown(payload.get("provider") or None)
    return jsonify(SETTINGS.describe())

# -------------------
# Agent-friendly API (v1): resolve accounts by name and holdings by ticker so a
# script/agent can record activity without first looking up internal ids.
# -------------------
def _account_ledger(account: Dict[str, Any], holdings: List[Dict[str, Any]]) -> Dict[str, float]:
    """Python port of accountLedger() in static/app.js; keep the two in sync."""
    events = []
    for cf in account.get("cashFlows") or []:
        try:
            amt = float(cf.get("amount") or 0)
        except Exception:
            continue
        if amt <= 0:
            continue
        kind = cf.get("type")
        kind = ("withdraw" if kind == "withdrawal"
                else "dividend" if kind in ("dividend", "outside-gain")
                else "fee" if kind in ("fee", "outside-loss") else "deposit")
        events.append((str(cf.get("date") or ""), kind, amt))
    for p in holdings:
        for t in p.get("transactions") or []:
            try:
                shares, price, fee = float(t.get("shares") or 0), float(t.get("price") or 0), float(t.get("fee") or 0)
            except Exception:
                continue
            if t.get("type") not in ("buy", "sell") or shares <= 0:
                continue
            gross = shares * price
            events.append((str(t.get("date") or ""), t["type"], gross + fee if t["type"] == "buy" else gross - fee))
    events.sort(key=lambda e: e[0])
    cash = contributions = implied = 0.0
    for _, kind, amt in events:
        if kind == "deposit":
            cash += amt; contributions += amt
        elif kind == "withdraw":
            cash -= amt; contributions -= amt
        elif kind == "buy":
            if cash < amt - 1e-9:
                short = amt - cash
                cash += short; contributions += short; implied += short
            cash -= amt
        elif kind == "sell" or kind == "dividend":
            cash += amt
        elif kind == "fee":
            cash -= amt
    return {"cash": round(cash, 2), "contributions": round(contributions, 2), "impliedDeposits": round(implied, 2)}

def _holding_summary(p: Dict[str, Any]) -> Dict[str, Any]:
    ticker = (p.get("tickers") or [p.get("ticker")] or [""])[0] or ""
    pos = _position_from_transactions(p.get("transactions") or [])
    snap = (p.get("snapshot") or {}).get(ticker) or {}
    price = snap.get("current")
    ana = p.get("analysis") or {}
    rec = ((ana.get("per_ticker") or {}).get(ticker) or {}) if isinstance(ana, dict) else {}
    entry = _snapshot_entry(pos, price, None)
    return {
        "id": p.get("id"),
        "ticker": ticker,
        "title": p.get("title"),
        "note": p.get("note") or "",
        "shares": pos["shares"],
        "avgCost": pos["avgCost"],
        "price": price,
        "marketValue": entry["marketValue"],
        "unrealizedPnl": entry["unrealizedPnl"],
        "unrealizedPct": entry["pct"],
        "realizedPnl": pos["realizedPnl"],
        "dayChange": snap.get("dayChange"),
        "dayChangePct": snap.get("dayChangePct"),
        "signal": rec.get("suggestion"),
        "analysisCompletedAt": ana.get("completedAt") if isinstance(ana, dict) else None,
        "autoAnalyze": bool(p.get("autoAnalyze")),
        "transactionCount": len(p.get("transactions") or []),
        "pendingComments": sum(1 for c in (p.get("comments") or []) if c.get("status") == "pending"),
        "updatedAt": p.get("updatedAt"),
    }

def _resolve_account(ref: Any, accounts: List[Dict[str, Any]]):
    """Find an account by id or (case-insensitive) name. Returns (account, error_response)."""
    ref = str(ref or "").strip()
    if not ref:
        if len(accounts) == 1:
            return accounts[0], None
        return None, (jsonify({"error": "account_required", "message": "Specify 'account' (id or name).",
                               "accounts": [a.get("name") for a in accounts]}), 400)
    for a in accounts:
        if str(a.get("id")) == ref:
            return a, None
    matches = [a for a in accounts if str(a.get("name") or "").strip().lower() == ref.lower()]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, (jsonify({"error": "ambiguous_account", "message": f"Several accounts are named '{ref}'; use the id.",
                               "accounts": [{"id": a["id"], "name": a.get("name")} for a in matches]}), 409)
    return None, (jsonify({"error": "account_not_found", "message": f"No account '{ref}'.",
                           "accounts": [a.get("name") for a in accounts]}), 404)

def _v1_ticker(raw: Any):
    ticker = str(raw or "").strip().upper()
    return ticker if TICKER_RE.match(ticker) else None

@app.get("/api/v1")
def api_v1_index():
    return jsonify({
        "auth": "Authorization: Bearer <token>. Read tokens may only GET; write tokens may also POST/PUT/DELETE.",
        "endpoints": {
            "GET /api/v1/portfolio[?account=<id|name>][&refresh=1]": "Accounts with cash, totals and per-holding position/P&L/signal. refresh=1 re-fetches prices first (slow).",
            "GET /api/v1/holdings/<ticker>[?account=]": "One holding with its full transaction and comment history.",
            "POST /api/v1/trades": "{account, ticker, type: buy|sell, shares, price, date?, fee?, note?, id?} — creates the holding if needed. Repeating a request with the same id is a no-op.",
            "POST /api/v1/cashflows": "{account, type: deposit|withdrawal|dividend|fee|outside-gain|outside-loss, amount, date?, note?, id?}",
            "POST /api/v1/comments": "{account, ticker, text} — leave a note on a holding for the owner to accept/discard.",
            "POST /api/v1/analyze": "{account, ticker} — queue a TradingAgents analysis (uses LLM credits).",
        },
        "lowLevel": "The UI's /api/accounts, /api/stocks/<id>/..., /api/queue/... endpoints accept the same token.",
    })

@app.get("/api/v1/portfolio")
def api_v1_portfolio():
    accounts = _ensure_accounts()
    posts = _read()
    if _coerce_bool(request.args.get("refresh"), False):
        for p in posts:
            p["snapshot"] = _build_holding_snapshot(p)
            p["updatedAt"] = _utcnow_iso()
        _write(posts)
    if request.args.get("account"):
        acc, err = _resolve_account(request.args.get("account"), accounts)
        if err:
            return err
        accounts = [acc]
    out = []
    for acc in accounts:
        holdings = [p for p in posts if str(p.get("accountId")) == str(acc.get("id"))]
        rows = [_holding_summary(p) for p in holdings]
        rows.sort(key=lambda r: -(r["marketValue"] or 0))
        ledger = _account_ledger(acc, holdings) if acc.get("type") != "watchlist" else None
        invested = round(sum(r["marketValue"] or 0 for r in rows), 2)
        totals = {
            "marketValue": invested,
            "unrealizedPnl": round(sum(r["unrealizedPnl"] or 0 for r in rows), 2),
            "dayChange": round(sum(r["dayChange"] or 0 for r in rows), 2),
        }
        if ledger:
            totals["netWorth"] = round(ledger["cash"] + invested, 2)
            totals["totalReturn"] = round(totals["netWorth"] - ledger["contributions"], 2)
        out.append({
            "id": acc.get("id"), "name": acc.get("name"), "type": acc.get("type"),
            **({"cash": ledger["cash"], "contributions": ledger["contributions"]} if ledger else {}),
            "totals": totals,
            "holdings": rows,
        })
    return jsonify({"asOf": _utcnow_iso(), "accounts": out})

@app.get("/api/v1/holdings/<ticker>")
def api_v1_holding(ticker):
    tk = _v1_ticker(ticker)
    if not tk:
        return jsonify({"error": "invalid_ticker"}), 400
    posts = _read()
    matches = [p for p in posts if tk in (p.get("tickers") or [])]
    if request.args.get("account"):
        acc, err = _resolve_account(request.args.get("account"), _ensure_accounts())
        if err:
            return err
        matches = [p for p in matches if str(p.get("accountId")) == str(acc.get("id"))]
    if not matches:
        return jsonify({"error": "not_found", "message": f"No holding for {tk}."}), 404
    return jsonify([{**_holding_summary(p), "accountId": p.get("accountId"),
                     "transactions": p.get("transactions") or [], "comments": p.get("comments") or []} for p in matches])

def _find_or_create_holding(posts: List[Dict[str, Any]], acc: Dict[str, Any], ticker: str) -> tuple[Dict[str, Any], bool]:
    for p in posts:
        if str(p.get("accountId")) == str(acc["id"]) and ticker in (p.get("tickers") or []):
            return p, False
    now = _utcnow_iso()
    normalized = _normalize_post_for_storage({"ticker": ticker, "accountId": acc["id"]})
    p = {
        "id": str(uuid.uuid4()), "createdAt": now, "updatedAt": now,
        "accountId": acc["id"], "title": ticker, "description": "", "note": "",
        "ticker": ticker, "tickers": [ticker], "transactions": [],
        "options": normalized["options"], "purchases": {}, "autoAnalyze": False,
        "analysis": None, "snapshot": {},
    }
    posts.append(p)
    return p, True

@app.post("/api/v1/trades")
def api_v1_trade():
    payload = request.get_json(silent=True) or {}
    tk = _v1_ticker(payload.get("ticker"))
    if not tk:
        return jsonify({"error": "invalid_ticker", "message": "ticker is required."}), 400
    cleaned = _normalize_transactions([payload])
    if not cleaned:
        return jsonify({"error": "invalid_trade", "message": "Need type (buy|sell), shares > 0, price >= 0; date as YYYY-MM-DD."}), 400
    txn = cleaned[0]
    with DATA_LOCK:
        acc, err = _resolve_account(payload.get("account"), _ensure_accounts())
        if err:
            return err
        posts = _read()
        holding, created = _find_or_create_holding(posts, acc, tk)
        if payload.get("id") and any(str(t.get("id")) == str(payload["id"]) for t in holding.get("transactions") or []):
            return jsonify({"duplicate": True, "holding": _holding_summary(holding), "transaction": txn}), 200
        warning = None
        if txn["type"] == "sell":
            held = _position_from_transactions(holding.get("transactions") or [])["shares"]
            if txn["shares"] > held + 1e-9:
                warning = f"Selling {txn['shares']} but only {held} held; position floors at 0."
        holding.setdefault("transactions", []).append(txn)
        _save_holding_after_txn_change(holding["id"], holding, posts)
    body = {"createdHolding": created, "holding": _holding_summary(holding), "transaction": txn}
    if warning:
        body["warning"] = warning
    return jsonify(body), 201

@app.post("/api/v1/cashflows")
def api_v1_cashflow():
    payload = request.get_json(silent=True) or {}
    cleaned = _normalize_cashflows([payload])
    if not cleaned:
        return jsonify({"error": "invalid_cashflow", "message": "Need type (deposit|withdrawal|dividend|fee|outside-gain|outside-loss) and amount > 0."}), 400
    flow = cleaned[0]
    with DATA_LOCK:
        accounts = _read_accounts()
        acc, err = _resolve_account(payload.get("account"), accounts)
        if err:
            return err
        if payload.get("id") and any(str(c.get("id")) == str(payload["id"]) for c in acc.get("cashFlows") or []):
            return jsonify({"duplicate": True, "cashFlow": flow}), 200
        acc.setdefault("cashFlows", []).append(flow)
        acc["updatedAt"] = _utcnow_iso()
        _write_accounts(accounts)
        holdings = [p for p in _read() if str(p.get("accountId")) == str(acc["id"])]
    return jsonify({"cashFlow": flow, "account": acc.get("name"), **_account_ledger(acc, holdings)}), 201

def _v1_holding_from_payload(payload: Dict[str, Any]):
    tk = _v1_ticker(payload.get("ticker"))
    if not tk:
        return None, None, (jsonify({"error": "invalid_ticker"}), 400)
    acc, err = _resolve_account(payload.get("account"), _ensure_accounts())
    if err:
        return None, None, err
    posts = _read()
    for p in posts:
        if str(p.get("accountId")) == str(acc["id"]) and tk in (p.get("tickers") or []):
            return posts, p, None
    return None, None, (jsonify({"error": "not_found", "message": f"No {tk} holding in '{acc.get('name')}'."}), 404)

@app.post("/api/v1/comments")
def api_v1_comment():
    payload = request.get_json(silent=True) or {}
    with DATA_LOCK:
        posts, p, err = _v1_holding_from_payload(payload)
        if err:
            return err
        author = (getattr(g, "auth", None) or {}).get("name") or ""
        cleaned = _normalize_comments([{"text": payload.get("text"), "status": "pending", "author": author}])
        if not cleaned:
            return jsonify({"error": "invalid_comment", "message": "text is required."}), 400
        p.setdefault("comments", []).append(cleaned[0])
        p["updatedAt"] = _utcnow_iso()
        _write(posts)
    return jsonify({"comment": cleaned[0], "holding": _holding_summary(p)}), 201

@app.post("/api/v1/analyze")
def api_v1_analyze():
    payload = request.get_json(silent=True) or {}
    _, p, err = _v1_holding_from_payload(payload)
    if err:
        return err
    return enqueue_post(str(p["id"]))

# -------------------
# Frontend
# -------------------
@app.get("/")
def home():
    return redirect(url_for("serve_stock"))

@app.get("/static/<path:fn>")
def serve_static(fn):
    return send_from_directory(app.static_folder, fn)

# -------------------
# Daily auto-regeneration (market close)
# -------------------
def _sleep_until_next_run(now: datetime) -> float:
    target = now.replace(hour=DAILY_REGEN_HOUR, minute=DAILY_REGEN_MIN, second=0, microsecond=0)
    if now >= target:
        target = target + timedelta(days=1)
    delta = (target - now).total_seconds()
    return max(10.0, delta)

def auto_regen_loop():
    if not AUTO_REGEN_ENABLED:
        return
    while True:
        try:
            now_local = datetime.now(APP_TZ)
            wait = _sleep_until_next_run(now_local)
            time.sleep(wait)
            # Run after waking
            with app.app_context():
                try:
                    queued = _enqueue_auto_analyze()
                    print(f"[Auto] Market-close run at {datetime.now(APP_TZ)}: "
                          f"{queued} opted-in holding(s) queued")
                except Exception:
                    traceback.print_exc()
        except Exception:
            traceback.print_exc()
            time.sleep(60)

def start_regen_thread():
    t = threading.Thread(target=auto_regen_loop, daemon=True)
    t.start()

def _recover_orphaned_jobs():
    """Reset holdings left in a non-terminal state by a restart.

    The job queue lives only in memory, so after a restart it is empty — but a
    holding that was mid-analysis still has analysis.progress.state == 'running'
    (or 'queued') persisted in stocks.json. With no live worker behind it, that
    status is stuck forever (can't continue, can't stop). Flip any such orphan
    to 'stopped' on startup so the UI is usable again.
    """
    try:
        posts = _read()
        changed = False
        for p in posts:
            ana = p.get("analysis")
            if not isinstance(ana, dict):
                continue
            progress = ana.get("progress")
            if isinstance(progress, dict) and progress.get("state") in ("running", "queued"):
                progress["state"] = "stopped"
                progress["currentTicker"] = None
                progress["updatedAt"] = _utcnow_iso()
                ana["updatedAt"] = _utcnow_iso()
                p["updatedAt"] = _utcnow_iso()
                changed = True
        if changed:
            _write(posts)
    except Exception:
        pass

def job_worker_loop():
    while True:
        pid = None
        with JOB_LOCK:
            if CURRENT_JOB.get("pid") is None and JOB_QUEUE:
                pid = JOB_QUEUE.pop(0)
                CURRENT_JOB["pid"] = pid
                JOB_STATE[pid] = 'running'
        if pid:
            _set_state(pid, 'running')
        # Clear any existing report when job starts successfully
        if pid:
            def _clear_report(pp):
                ana = pp.get("analysis") or {}
                if not isinstance(ana, dict):
                    ana = {}
                # Clear old report files
                old_report_files = ana.get("report", [])
                if isinstance(old_report_files, list):
                    for filename in old_report_files:
                        try:
                            filepath = os.path.join(REPORTS_DIR, filename)
                            if os.path.exists(filepath):
                                os.remove(filepath)
                        except Exception:
                            pass
                ana["report"] = []  # Reset to empty array
                ana.setdefault("per_ticker", {})
                ana["progress"] = {
                    "state": "running",
                    "completed": 0,
                    "total": len(pp.get("tickers") or []),
                    "currentTicker": None,
                    "updatedAt": _utcnow_iso(),
                }
                ana["updatedAt"] = _utcnow_iso()
                # Remove any stale completion timestamp
                ana.pop("completedAt", None)
                pp["analysis"] = ana
                pp["updatedAt"] = _utcnow_iso()
            _update_post(pid, _clear_report)
        if not pid:
            time.sleep(0.2)
            continue
        
        job_completed_successfully = False
        try:
            perform_analysis(pid)
            job_completed_successfully = True
        except Exception as e:
            print(f"Analysis failed for {pid}: {e}")
            _set_state(pid, 'error')
        finally:
            # Always clear current job first
            with JOB_LOCK:
                if CURRENT_JOB.get("pid") == pid:
                    CURRENT_JOB["pid"] = None
            
            # Set done state only if job completed successfully and wasn't stopped
            if job_completed_successfully:
                with JOB_LOCK:
                    current_state = JOB_STATE.get(pid)
                    if current_state not in ('stopped', 'error'):
                        _set_state(pid, 'done')

def _asset_version() -> str:
    """A cache-busting stamp that changes whenever app.js/app.css change.

    Appended as ?v=... to the static asset URLs so a deploy is picked up
    immediately instead of the browser serving a stale cached bundle.
    """
    latest = 0.0
    for fn in ("app.js", "app.css"):
        try:
            latest = max(latest, os.path.getmtime(os.path.join(app.static_folder, fn)))
        except OSError:
            pass
    return str(int(latest))

# Stock page route
@app.route('/stock')
def serve_stock():
    return render_template('stock.html', asset_v=_asset_version())

@app.route('/stock.html')
def serve_stock_html():
    return render_template('stock.html', asset_v=_asset_version())

if __name__ == "__main__":
    _ensure_accounts()
    _recover_orphaned_jobs()
    start_regen_thread()
    threading.Thread(target=job_worker_loop, daemon=True).start()
    # Dev server only. Binds to localhost and keeps the Werkzeug debugger off unless
    # explicitly requested: the debugger console executes arbitrary Python.
    app.run(host=os.environ.get("TA_DEV_HOST", "127.0.0.1"), port=int(os.environ.get("TA_DEV_PORT", "5055")),
            debug=os.environ.get("TA_DEV_DEBUG") == "1", use_reloader=False)
else:
    # Running under gunicorn or other WSGI server — start background threads here
    _ensure_accounts()
    _recover_orphaned_jobs()
    start_regen_thread()
    threading.Thread(target=job_worker_loop, daemon=True).start()
