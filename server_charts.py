"""Price-history cache for the chart endpoints.

Charts used to hit Yahoo for every request (with a 60 s in-memory cache that a
restart wiped), and the net-worth chart makes one request per holding. This
store keeps each (ticker, period, interval) series:

  * in memory (bounded LRU) and on disk under data/chart_cache/, so restarts
    and repeat views don't refetch;
  * with a freshness window that matches the bar size, and is much longer while
    the US market is closed (bars can't change then);
  * never served stale: an entry that is requested late in its freshness
    window is refreshed in the background ahead of expiry, so busy charts stay
    current without waiting on Yahoo. Only if Yahoo fails is older data used.

Prices are rounded to 4 decimals, which removes float noise like
346.4200134277344 and roughly halves the JSON.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, Optional, Tuple
from zoneinfo import ZoneInfo

FIELDS = ("timestamps", "opens", "highs", "lows", "closes", "volumes")
MARKET_TZ = ZoneInfo("America/New_York")
REFRESH_AHEAD = 0.75           # refresh in the background once 75% of the freshness window has passed
MAX_DISK_AGE_S = 14 * 86400    # pruned at startup
EMPTY_RETRY_S = 120            # don't re-ask Yahoo for a ticker that just returned nothing


def market_open(now: Optional[datetime] = None) -> bool:
    """Regular US session, Mon–Fri 9:30–16:00 ET (holidays not modelled)."""
    now = (now or datetime.now(MARKET_TZ)).astimezone(MARKET_TZ)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return 9 * 60 + 30 <= minutes < 16 * 60 + 5  # a few minutes' grace for the closing bar


def freshness_s(interval: str) -> int:
    """How long a cached series counts as fresh."""
    if not market_open():
        return 6 * 3600
    if interval in ("1m", "2m", "5m"):
        return 120
    if interval in ("15m", "30m"):
        return 300
    if interval in ("60m", "90m", "1h", "4h"):
        return 900
    if interval in ("1d", "5d"):
        return 1800
    return 3 * 3600


def _compact(data: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"timestamps": [int(t) for t in data.get("timestamps") or []]}
    for key in ("opens", "highs", "lows", "closes"):
        out[key] = [round(float(v), 4) if v is not None else None for v in data.get(key) or []]
    out["volumes"] = [int(v) if v is not None else 0 for v in data.get("volumes") or []]
    return out


class ChartStore:
    def __init__(self, data_dir: str, fetch: Callable[[str, str, str], Dict[str, Any]], max_memory: int = 800):
        self.dir = os.path.join(data_dir, "chart_cache")
        os.makedirs(self.dir, mode=0o700, exist_ok=True)
        self._fetch = fetch
        self._mem: "OrderedDict[Tuple[str, str, str], Tuple[float, Dict[str, Any]]]" = OrderedDict()
        self._max = max_memory
        self._lock = threading.Lock()
        self._inflight: Dict[Tuple[str, str, str], Future] = {}
        # Separate pools: request fan-out vs background refreshes, so a request
        # never waits on a queue that background work is clogging.
        self._request_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="chart-req")
        self._refresh_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="chart-bg")
        self._prune_disk()

    # -- storage ----------------------------------------------------------
    def _path(self, key: Tuple[str, str, str]) -> str:
        # Tickers are validated against TICKER_RE and period/interval are whitelisted
        # by the caller, so the name is safe; '^' (index tickers) is kept as is.
        return os.path.join(self.dir, "{}__{}__{}.json".format(*key))

    def _prune_disk(self) -> None:
        cutoff = time.time() - MAX_DISK_AGE_S
        try:
            for name in os.listdir(self.dir):
                path = os.path.join(self.dir, name)
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
        except OSError:
            pass

    def _remember(self, key, fetched_at: float, data: Dict[str, Any]) -> None:
        with self._lock:
            self._mem[key] = (fetched_at, data)
            self._mem.move_to_end(key)
            while len(self._mem) > self._max:
                self._mem.popitem(last=False)

    def _lookup(self, key) -> Optional[Tuple[float, Dict[str, Any]]]:
        with self._lock:
            hit = self._mem.get(key)
            if hit:
                self._mem.move_to_end(key)
                return hit
        try:
            with open(self._path(key), "r", encoding="utf-8") as f:
                blob = json.load(f)
            hit = (float(blob["fetchedAt"]), blob["data"])
        except (OSError, ValueError, KeyError):
            return None
        self._remember(key, *hit)
        return hit

    def _store(self, key, data: Dict[str, Any]) -> None:
        now = time.time()
        self._remember(key, now, data)
        if not data.get("timestamps"):
            return  # keep empties in memory only (short retry), never on disk
        tmp = self._path(key) + ".tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"fetchedAt": now, "data": data}, f, separators=(",", ":"))
            os.replace(tmp, self._path(key))
        except OSError as e:
            print(f"[charts] cache write failed for {key}: {e}")

    # -- fetching ---------------------------------------------------------
    def _fetch_now(self, key) -> Dict[str, Any]:
        """Fetch from Yahoo, deduplicating concurrent requests for the same key."""
        with self._lock:
            fut = self._inflight.get(key)
            owner = fut is None
            if owner:
                fut = Future()
                self._inflight[key] = fut
        if not owner:
            return fut.result(timeout=120)
        try:
            data = _compact(self._fetch(*key))
            if data.get("timestamps"):
                self._store(key, data)
            else:
                prev = self._lookup(key)
                if prev and prev[1].get("timestamps"):
                    data = prev[1]  # Yahoo hiccup: keep serving what we had
                else:
                    self._remember(key, time.time() - freshness_s(key[2]) + EMPTY_RETRY_S, data)
            fut.set_result(data)
            return data
        except Exception as e:  # never leave waiters hanging
            fut.set_exception(e)
            raise
        finally:
            with self._lock:
                self._inflight.pop(key, None)

    def _refresh_later(self, key) -> None:
        with self._lock:
            if key in self._inflight:
                return
        self._refresh_pool.submit(self._safe_fetch, key)

    def _safe_fetch(self, key) -> None:
        try:
            self._fetch_now(key)
        except Exception as e:
            print(f"[charts] background refresh failed for {key}: {e}")

    # -- public -----------------------------------------------------------
    def get(self, ticker: str, period: str, interval: str) -> Dict[str, Any]:
        key = (ticker, period, interval)
        hit = self._lookup(key)
        now = time.time()
        if hit:
            age, fresh = now - hit[0], freshness_s(interval)
            if age < fresh:
                if age > fresh * REFRESH_AHEAD and hit[1].get("timestamps"):
                    self._refresh_later(key)
                return hit[1]
        try:
            return self._fetch_now(key)
        except Exception:
            # Yahoo unreachable: the last known history beats an empty chart.
            return hit[1] if hit else {k: [] for k in FIELDS}

    def get_many(self, tickers: Iterable[str], period: str, interval: str) -> Dict[str, Dict[str, Any]]:
        tickers = list(dict.fromkeys(tickers))
        futures = {tk: self._request_pool.submit(self.get, tk, period, interval) for tk in tickers}
        out: Dict[str, Dict[str, Any]] = {}
        for tk, fut in futures.items():
            try:
                out[tk] = fut.result(timeout=150)
            except Exception:
                out[tk] = {k: [] for k in FIELDS}
        return out
