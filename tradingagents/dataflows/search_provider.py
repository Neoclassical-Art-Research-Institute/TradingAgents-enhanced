"""Web search providers and the fallback chain that drives them.

Two flavours of provider:
  * search engines (DeepSeek Search, Tavily) take a short keyword query plus
    optional date range / site filter and return ranked results;
  * grounded LLMs (Gemini + Google Search, OpenAI web_search) take a natural
    language prompt and return a written answer.

Every analyst search goes through a `SearchChain`, which tries the configured
providers in order. A provider that fails with a quota / rate-limit / auth
error is put on cooldown so later searches skip it immediately instead of
burning time on retries; the chain never raises into the agent graph.
"""
from __future__ import annotations

import os
import re
import threading
import time
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx


class SearchProvider(ABC):
    label = "search"

    @abstractmethod
    def search(
        self,
        query: str,
        keywords: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        site: Optional[str] = None,
    ) -> str:
        """`query` is a natural-language prompt; `keywords` a short engine query.
        Dates are YYYY-MM-DD; `site` restricts to one domain (e.g. reddit.com)."""


class NoSearchProvider(SearchProvider):
    """Stub used when no search provider is configured or all of them failed, so
    news/social/fundamentals analysts still finish from whatever data they have."""

    label = "none"

    def __init__(self, reason: str = "Web search is disabled."):
        self.reason = reason

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        return (
            f"{self.reason} No live search results are available for this query — "
            "do not retry; proceed with the analysis using only the data already available to you."
        )


class SearchHTTPError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


class DeepSeekSearchProvider(SearchProvider):
    """DeepSeek Search API (POST /v1/tools/search). Queries are capped at 128 chars
    and support site:/after:/before: operators."""

    label = "DeepSeek Search"
    URL = "https://api.deepseek.com/v1/tools/search"
    MAX_QUERY = 128

    def __init__(self, count: int = 8, lang: str = "en", max_chars_per_result: int = 1200):
        self.api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        self.count = count
        self.lang = lang
        self.max_chars = max_chars_per_result

    def _build_query(self, query, keywords, start_date, end_date, site) -> str:
        ops = []
        if self.lang:
            ops.append(f"lang:{self.lang}")
        if site:
            ops.append(f"site:{site}")
        if start_date:
            ops.append(f"after:{start_date}")
        if end_date:
            # before: is exclusive; shift a day so results from end_date itself are kept.
            day_after = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
            ops.append(f"before:{day_after}")
        suffix = (" " + " ".join(ops)) if ops else ""
        base = (keywords or query or "").strip()
        room = self.MAX_QUERY - len(suffix)
        if len(base) > room:
            base = base[:room].rsplit(" ", 1)[0] or base[:room]
        return (base + suffix).strip()

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        q = self._build_query(query, keywords, start_date, end_date, site)
        body: Dict[str, Any] = {"query": q, "count": self.count}
        if keywords and query and query != keywords:
            body["ori_question"] = query[: self.MAX_QUERY]
        resp = httpx.post(
            self.URL,
            json=body,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=30,
        )
        if resp.status_code != 200:
            try:
                msg = resp.json().get("error", {}).get("message") or resp.text
            except Exception:
                msg = resp.text
            raise SearchHTTPError(resp.status_code, str(msg)[:300])
        results = (resp.json() or {}).get("results") or []
        chunks = []
        for item in results:
            text = (item.get("summary") or item.get("snippet") or "").strip()
            if len(text) > self.max_chars:
                text = text[: self.max_chars].rsplit(" ", 1)[0] + " …"
            date = item.get("date") or ""
            head = f"### {item.get('title', '')}"
            meta = " · ".join(x for x in [item.get("site_name") or "", date[:10]] if x)
            chunks.append(f"{head}\n{item.get('url', '')}{(' — ' + meta) if meta else ''}\n{text}")
        return "\n\n".join(chunks).strip()


class TavilySearchProvider(SearchProvider):
    label = "Tavily"

    def __init__(self, max_results: int = 5):
        from tavily import TavilyClient
        self.client = TavilyClient()  # reads TAVILY_API_KEY from the environment
        self.max_results = max_results

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        kwargs: Dict[str, Any] = {
            "query": (keywords or query)[:400],
            "search_depth": "advanced",
            "topic": "finance",
            "max_results": self.max_results,
            "include_answer": True,
        }
        if start_date:
            kwargs["start_date"] = start_date
        if end_date:
            kwargs["end_date"] = end_date
        if site:
            kwargs["include_domains"] = [site]
        response = self.client.search(**kwargs)

        result_text = ""
        if response.get("answer"):
            result_text += response["answer"] + "\n\n"
        for item in response.get("results", []):
            result_text += f"### {item.get('title', '')}\n{item.get('url', '')}\n{item.get('content', '')}\n\n"
        return result_text.strip()


class GoogleSearchProvider(SearchProvider):
    """Gemini with Google Search grounding. Fails fast on 429 so the chain can move on."""

    label = "Google (Gemini grounding)"

    def __init__(self, model: str):
        from google import genai
        self.client = genai.Client()
        self.model = model

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        from google.genai.types import GenerateContentConfig, GoogleSearch, Tool
        prompt = query
        if site and site not in prompt:
            prompt += f" Only use results from {site}."
        config = GenerateContentConfig(tools=[Tool(google_search=GoogleSearch())])
        response = self.client.models.generate_content(model=self.model, contents=prompt, config=config)
        result_text = ""
        for part in response.candidates[0].content.parts:
            if getattr(part, "text", None):
                result_text += part.text
        return result_text


class OpenAISearchProvider(SearchProvider):
    label = "OpenAI web search"

    def __init__(self, model: str):
        from openai import OpenAI
        self.client = OpenAI(timeout=120)
        self.model = model

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        prompt = query
        if site and site not in prompt:
            prompt += f" Only use results from {site}."
        response = self.client.responses.create(
            model=self.model,
            input=prompt,
            tools=[{"type": "web_search", "search_context_size": "low"}],
            max_output_tokens=4096,
            store=False,
        )
        return response.output_text or ""


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
SEARCH_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "deepseek": {"label": "DeepSeek Search", "api_key_env": "DEEPSEEK_API_KEY", "kind": "engine"},
    "tavily": {"label": "Tavily", "api_key_env": "TAVILY_API_KEY", "kind": "engine"},
    "google": {"label": "Google (Gemini grounding)", "api_key_env": "GOOGLE_API_KEY", "kind": "llm",
               "default_model": "gemini-flash-lite-latest"},
    "openai": {"label": "OpenAI web search", "api_key_env": "OPENAI_API_KEY", "kind": "llm",
               "default_model": "gpt-4.1-mini"},
}
DEFAULT_SEARCH_CHAIN = ["deepseek", "tavily", "google"]


def search_provider_available(name: str) -> bool:
    spec = SEARCH_PROVIDERS.get(name)
    return bool(spec and os.environ.get(spec["api_key_env"]))


# ---------------------------------------------------------------------------
# Health tracking (process-wide, shared by every run)
# ---------------------------------------------------------------------------
_HEALTH_LOCK = threading.Lock()
_HEALTH: Dict[str, Dict[str, Any]] = {}

_QUOTA_RE = re.compile(r"quota|insufficient|balance|billing|exceeded|usage limit|credit|RESOURCE_EXHAUSTED|plan", re.I)
_RATE_RE = re.compile(r"\b429\b|rate.?limit|too many requests", re.I)
_AUTH_RE = re.compile(r"\b40[123]\b|unauthori[sz]ed|invalid api key|forbidden|permission", re.I)


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _cooldown_for(err: BaseException) -> tuple[float, str]:
    """Seconds to skip a provider after this error, and a short reason."""
    status = getattr(err, "status", None) or getattr(err, "status_code", None) or getattr(err, "code", None)
    text = f"{status} {err}"
    if status in (401, 403) or (status is None and _AUTH_RE.search(text)):
        return 6 * 3600, "auth"
    if status == 402 or _QUOTA_RE.search(text):
        return 6 * 3600, "quota"
    if status == 429 or _RATE_RE.search(text):
        return 15 * 60, "rate-limit"
    return 120, "error"


def _record(name: str, ok: bool, err: Optional[BaseException] = None) -> None:
    now = time.time()
    with _HEALTH_LOCK:
        h = _HEALTH.setdefault(name, {"successes": 0, "failures": 0})
        if ok:
            h["successes"] += 1
            h["lastSuccessAt"] = _utc_iso(now)
            h.pop("cooldownUntilTs", None)
        else:
            secs, reason = _cooldown_for(err) if err else (120, "error")
            h["failures"] += 1
            h["lastError"] = f"{type(err).__name__}: {str(err)[:300]}" if err else "empty result"
            h["lastErrorKind"] = reason
            h["lastErrorAt"] = _utc_iso(now)
            h["cooldownUntilTs"] = now + secs


def _cooling_down(name: str) -> bool:
    with _HEALTH_LOCK:
        until = (_HEALTH.get(name) or {}).get("cooldownUntilTs")
    return bool(until and until > time.time())


def reset_cooldown(name: Optional[str] = None) -> None:
    with _HEALTH_LOCK:
        for key, h in _HEALTH.items():
            if name is None or key == name:
                h.pop("cooldownUntilTs", None)


def search_status() -> Dict[str, Dict[str, Any]]:
    now = time.time()
    out = {}
    with _HEALTH_LOCK:
        for name in SEARCH_PROVIDERS:
            h = dict(_HEALTH.get(name) or {"successes": 0, "failures": 0})
            until = h.pop("cooldownUntilTs", None)
            h["coolingDown"] = bool(until and until > now)
            if h["coolingDown"]:
                h["cooldownUntil"] = _utc_iso(until)
            h["available"] = search_provider_available(name)
            out[name] = h
    return out


# ---------------------------------------------------------------------------
# Chain
# ---------------------------------------------------------------------------
_INSTANCES: Dict[tuple, SearchProvider] = {}
_INSTANCES_LOCK = threading.Lock()


def _instance(name: str, models: Dict[str, str]) -> SearchProvider:
    model = models.get(name) or SEARCH_PROVIDERS[name].get("default_model") or ""
    key = (name, model)
    with _INSTANCES_LOCK:
        inst = _INSTANCES.get(key)
        if inst is None:
            if name == "deepseek":
                inst = DeepSeekSearchProvider()
            elif name == "tavily":
                inst = TavilySearchProvider()
            elif name == "google":
                inst = GoogleSearchProvider(model)
            elif name == "openai":
                inst = OpenAISearchProvider(model)
            else:
                raise ValueError(f"Unknown search provider: {name}")
            _INSTANCES[key] = inst
        return inst


class SearchChain(SearchProvider):
    label = "chain"

    def __init__(self, order: List[str], models: Optional[Dict[str, str]] = None):
        self.order = [n for n in order if n in SEARCH_PROVIDERS]
        self.models = dict(models or {})

    def search(self, query, keywords=None, start_date=None, end_date=None, site=None) -> str:
        skipped: List[str] = []
        for name in self.order:
            if not search_provider_available(name):
                skipped.append(f"{name} (no API key)")
                continue
            if _cooling_down(name):
                skipped.append(f"{name} (cooling down)")
                continue
            try:
                text = _instance(name, self.models).search(
                    query, keywords=keywords, start_date=start_date, end_date=end_date, site=site
                )
            except Exception as e:  # never let a search failure kill the analysis
                print(f"[search] {name} failed: {type(e).__name__}: {str(e)[:300]}")
                _record(name, False, e)
                skipped.append(f"{name} (failed)")
                continue
            if text and text.strip():
                _record(name, True)
                return f"{text.strip()}\n\n_(via {SEARCH_PROVIDERS[name]['label']})_"
            # An empty result is a valid answer, not a provider fault: try the next
            # provider but don't put this one on cooldown.
            skipped.append(f"{name} (no results)")
        if not self.order:
            return NoSearchProvider("Web search is disabled in settings.").search(query)
        return NoSearchProvider(f"Web search unavailable — {', '.join(skipped)}.").search(query)


def chain_from_config(config: Dict[str, Any]) -> List[str]:
    """Ordered provider names. Honors config["search_providers"]; falls back to the
    legacy single-value config["search_provider"] ("none" | "tavily" | "auto")."""
    order = config.get("search_providers")
    if isinstance(order, list):
        return [str(n) for n in order if str(n) in SEARCH_PROVIDERS]
    legacy = config.get("search_provider") or "auto"
    if legacy == "none":
        return []
    if legacy in SEARCH_PROVIDERS:
        return [legacy]
    return list(DEFAULT_SEARCH_CHAIN)


def date_window(curr_date: str, days: int) -> tuple[str, str]:
    end = datetime.strptime(curr_date, "%Y-%m-%d")
    return (end - timedelta(days=days)).strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
