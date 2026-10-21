"""Server-side net-worth series, delivered progressively.

The chart used to download every holding's price history and build the series
in the browser (~58 KB for a 3-month chart with 44 holdings). Here the server
builds it once and sends it in passes: level 0 is 64 evenly spaced points
covering the whole range, and each further level fills the gaps between the
points already sent (+64, +128, +256, ...) until the series is complete. Every
level of one build shares a `version`, so a chart only ever gains detail; it
never mixes two builds.

The range/interval selection and series maths are a direct port of
nwRangeConfig() and computeNetworthSeries() from static/app.js (see git
history); they must produce identical points.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
from collections import OrderedDict
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from server_charts import freshness_s

RANGE_DAYS = {"1d": 1, "5d": 5, "1mo": 30, "3mo": 91, "6mo": 182, "1y": 365, "2y": 730}
RANGES = (*RANGE_DAYS, "all")
RANGE_INTERVAL = {"1d": "2m", "5d": "15m", "1mo": "1h", "3mo": "1h", "6mo": "1d", "1y": "1d", "2y": "1wk"}
# (interval, bar minutes, max lookback days Yahoo serves), in the same order as the UI.
INTERVALS = [
    ("1m", 1, 7), ("2m", 2, 60), ("5m", 5, 60), ("15m", 15, 60), ("30m", 30, 60),
    ("1h", 60, 730), ("90m", 90, 60), ("1d", 1440, math.inf), ("1wk", 10080, math.inf), ("1mo", 43200, math.inf),
]
BASE_POINTS = 64
DAY_MS = 86_400_000


def _js_round(x: float) -> int:
    """JavaScript Math.round: halves go up (Python's round() goes to even)."""
    return math.floor(x + 0.5)


def is_intraday(interval: str) -> bool:
    return interval == "1h" or bool(re.fullmatch(r"\d+m", interval))


def interval_minutes(interval: str) -> int:
    return next((m for k, m, _ in INTERVALS if k == interval), 1440)


def interval_for_days(days: int) -> str:
    target = days * 1440 / 100
    best, best_diff = "1d", math.inf
    for key, minutes, max_days in INTERVALS:
        if days > max_days:
            continue
        diff = abs(minutes - target)
        if diff < best_diff:
            best, best_diff = key, diff
    return best


def period_for_days(days: int) -> str:
    for limit, period in ((5, "5d"), (30, "1mo"), (91, "3mo"), (182, "6mo"), (365, "1y"), (730, "2y"), (1825, "5y"), (3650, "10y")):
        if days <= limit:
            return period
    return "max"


def first_activity_date(account: Dict[str, Any], holdings: List[Dict[str, Any]]) -> Optional[str]:
    dates = [str(cf.get("date") or "")[:10] for cf in account.get("cashFlows") or []]
    for p in holdings:
        for t in p.get("transactions") or []:
            if t and t.get("type") in ("buy", "sell") and float(t.get("shares") or 0) > 0:
                dates.append(str(t.get("date") or "")[:10])
    dates = [d for d in dates if d]
    return min(dates) if dates else None


def days_since(date_str: str, now_ms: int, tz_offset_min: int) -> int:
    """Whole days from the viewer's local midnight on date_str to now (daysSinceDate)."""
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        return 0
    local_midnight_ms = datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000 + tz_offset_min * 60_000
    return max(0, _js_round((now_ms - local_midnight_ms) / DAY_MS))


def range_config(key: str, account, holdings, now_ms: int, tz_offset_min: int) -> Dict[str, Any]:
    if key == "all":
        first = first_activity_date(account, holdings)
        days = days_since(first, now_ms, tz_offset_min) + 1 if first else 30
        return {"key": "all", "days": days, "interval": interval_for_days(days), "fetch": period_for_days(days)}
    days = RANGE_DAYS.get(key, 30)
    interval = RANGE_INTERVAL.get(key) or interval_for_days(days)
    fetch = "5d" if is_intraday(interval) and days <= 5 else key
    return {"key": key, "days": days, "interval": interval, "fetch": fetch}


def _iso(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M")


def bucket_key(ts: int, interval: str) -> str:
    if not is_intraday(interval):
        return _iso(ts)[:10]
    step = interval_minutes(interval) * 60_000
    return _iso((ts // step) * step)


def _num(x: Any) -> float:
    try:
        return float(x) if x not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def compute_series(entries: List[Tuple[Dict[str, Any], str, Optional[Dict[str, Any]]]],
                   cash_flows: List[Dict[str, Any]], interval: str, today: str) -> Dict[str, Any]:
    """Per-bucket net worth (cash + holdings at close) and contributions.
    entries: (holding, ticker, price history with timestamps/closes) per holding."""
    date_set = set()
    close_maps: Dict[str, Dict[str, float]] = {}
    for _, tk, hist in entries:
        m: Dict[str, float] = {}
        if hist and isinstance(hist.get("timestamps"), list):
            for ts, close in zip(hist["timestamps"], hist.get("closes") or []):
                ds = bucket_key(ts, interval)
                m[ds] = close
                date_set.add(ds)
        close_maps[tk] = m
    tx_by_tk: Dict[str, List[Dict[str, Any]]] = {}
    for p, tk, _ in entries:
        txs = [t for t in p.get("transactions") or [] if t and t.get("type") in ("buy", "sell") and _num(t.get("shares")) > 0]
        tx_by_tk[tk] = sorted(txs, key=lambda t: str(t.get("date") or ""))

    events = []
    for cf in cash_flows or []:
        amt = _num(cf.get("amount"))
        if amt > 0:
            kind = cf.get("type")
            kind = ("withdraw" if kind == "withdrawal" else "dividend" if kind in ("dividend", "outside-gain")
                    else "fee" if kind in ("fee", "outside-loss") else "deposit")
            events.append((str(cf.get("date") or ""), kind, amt))
    for p, _, _ in entries:
        for t in p.get("transactions") or []:
            if not t or t.get("type") not in ("buy", "sell") or not _num(t.get("shares")) > 0:
                continue
            gross = _num(t.get("shares")) * _num(t.get("price"))
            fee = _num(t.get("fee"))
            events.append((str(t.get("date") or ""), t["type"], gross + fee if t["type"] == "buy" else gross - fee))
    events.sort(key=lambda e: e[0])

    intraday = is_intraday(interval)
    if not intraday:
        date_set.update(e[0] for e in events if e[0])
        date_set.add(today)
    dates = sorted(date_set)
    if not dates:
        return {"points": [], "contributions": 0, "netNow": 0, "hasData": False}

    cash = contributions = 0.0
    evi = 0
    last_close: Dict[str, Optional[float]] = {tk: None for _, tk, _ in entries}
    points = []
    for ds in dates:
        while evi < len(events) and events[evi][0] <= ds:
            _, kind, amt = events[evi]
            evi += 1
            if kind == "deposit":
                cash += amt; contributions += amt
            elif kind == "withdraw":
                cash -= amt; contributions -= amt
            elif kind == "buy":
                cash -= amt
            elif kind in ("sell", "dividend"):
                cash += amt
            elif kind == "fee":
                cash -= amt
        holdings_value = 0.0
        for _, tk, _ in entries:
            c = close_maps[tk].get(ds)
            if c is not None:
                last_close[tk] = c
            close = last_close[tk]
            if close is None:
                continue
            sh = 0.0
            for t in tx_by_tk[tk]:
                if str(t.get("date") or "") <= ds:
                    sh += (1 if t["type"] == "buy" else -1) * _num(t.get("shares"))
                else:
                    break
            if sh > 0:
                holdings_value += sh * close
        points.append({"date": ds, "value": cash + holdings_value, "contributions": contributions})

    # Keep the span before the first activity, flattened to the first real value and
    # flagged noData, so the chart draws it as a gray lead-in rather than a drop to zero.
    first_event = events[0][0][:10] if events else None
    if first_event:
        first_real = next((i for i, p in enumerate(points) if p["date"][:10] >= first_event), len(points) - 1)
        seed = points[first_real] if points else None
        if seed:
            for i in range(first_real):
                points[i] = {**points[i], "value": seed["value"], "contributions": seed["contributions"], "noData": True}
    return {"points": points, "contributions": contributions,
            "netNow": points[-1]["value"] if points else 0, "hasData": True}


def clip(series: Dict[str, Any], cfg: Dict[str, Any], now_ms: int) -> Dict[str, Any]:
    """Frame the series to [now - days, now]; keep it whole if that would leave ≤1 point."""
    if not series.get("hasData"):
        return series
    cutoff = now_ms - cfg["days"] * DAY_MS
    clip_from = _iso(cutoff) if is_intraday(cfg["interval"]) else _iso(cutoff)[:10]
    clipped = [p for p in series["points"] if p["date"] >= clip_from]
    return {**series, "points": clipped} if len(clipped) > 1 else series


def level_indices(n: int, level: int) -> Tuple[List[int], bool]:
    """Point indices first sent at `level`, and whether the series is complete after it.
    Level 0: every s0-th point (s0 = smallest power of two giving ≤64 points) plus
    the last; level k: the points halfway between those already sent."""
    if n <= BASE_POINTS:
        return (list(range(n)) if level == 0 else []), True
    s0 = 1
    while math.ceil(n / s0) > BASE_POINTS:
        s0 *= 2
    if level == 0:
        idx = list(range(0, n, s0))
        if idx[-1] != n - 1:
            idx.append(n - 1)
        return idx, False
    step = s0 >> level
    if step < 1:
        return [], True
    return [i for i in range(step, n - 1, step * 2)], step == 1


def _fingerprint(account: Dict[str, Any], holdings: List[Dict[str, Any]]) -> str:
    blob = json.dumps([account.get("cashFlows") or [], [(p.get("id"), p.get("ticker"), p.get("tickers"), p.get("transactions") or []) for p in holdings]],
                      sort_keys=True, default=str)
    return hashlib.sha1(blob.encode()).hexdigest()


class NetworthService:
    def __init__(self, charts, ledger: Callable[[Dict[str, Any], List[Dict[str, Any]]], Dict[str, float]]):
        self._charts = charts
        self._ledger = ledger
        self._versions: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._latest: Dict[tuple, Tuple[str, float, str]] = {}  # (acct, range, today, tz) -> (version, built_at, fingerprint)
        self._lock = threading.Lock()

    def _build(self, account, holdings, range_key: str, now_ms: int, tz: int, today: str) -> Dict[str, Any]:
        cfg = range_config(range_key, account, holdings, now_ms, tz)
        with_tx = [p for p in holdings if p.get("transactions")]
        if not with_tx:
            ledger = self._ledger(account, holdings)
            series = {"points": [], "contributions": ledger["contributions"], "netNow": ledger["cash"], "hasData": False}
        else:
            tickers = [((p.get("ticker") or (p.get("tickers") or [""])[0]) or "").upper() for p in with_tx]
            history = self._charts.get_many(tickers, cfg["fetch"], cfg["interval"])
            entries = [(p, tk, history.get(tk)) for p, tk in zip(with_tx, tickers)]
            series = clip(compute_series(entries, account.get("cashFlows") or [], cfg["interval"], today), cfg, now_ms)
        r2 = lambda x: round(x, 2)
        series = {
            "hasData": series["hasData"],
            "contributions": r2(series["contributions"]),
            "netNow": r2(series["netNow"]),
            "interval": cfg["interval"],
            "points": [[p["date"], r2(p["value"]), r2(p["contributions"]), 1 if p.get("noData") else 0] for p in series["points"]],
        }
        series["version"] = hashlib.sha1(json.dumps(series, separators=(",", ":")).encode()).hexdigest()[:16]
        return series

    def level(self, account, holdings, range_key: str, level: int, version: Optional[str],
              now_ms: int, tz: int, today: str) -> Dict[str, Any]:
        if level > 0:
            with self._lock:
                series = self._versions.get(version or "")
            if series is None:
                return {"restart": True}  # that build was evicted or superseded
        else:
            key = (account.get("id"), range_key, today, tz)
            fp = _fingerprint(account, holdings)
            with self._lock:
                latest = self._latest.get(key)
                series = self._versions.get(latest[0]) if latest else None
            if not (series and latest[2] == fp and time.time() - latest[1] < freshness_s(series["interval"])):
                series = self._build(account, holdings, range_key, now_ms, tz, today)
                with self._lock:
                    self._versions[series["version"]] = series
                    self._versions.move_to_end(series["version"])
                    while len(self._versions) > 96:
                        self._versions.popitem(last=False)
                    self._latest[key] = (series["version"], time.time(), fp)
        pts = series["points"]
        idx, done = level_indices(len(pts), level)
        out = {
            "version": series["version"], "level": level, "done": done, "total": len(pts),
            "interval": series["interval"],
            "points": [[i, *pts[i]] for i in idx],
        }
        if level == 0:
            out.update(hasData=series["hasData"], contributions=series["contributions"], netNow=series["netNow"])
        return out
