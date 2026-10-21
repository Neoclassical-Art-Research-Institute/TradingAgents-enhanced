"""LLM provider registry + chat-model construction with ordered fallbacks.

A provider is identified by a short id ("deepseek", "openai", ...). Its endpoint
and API-key env var are fixed here (server-side), so callers can only choose a
provider id and a model name — never a URL that would receive the API key.

An analysis run uses an *LLM chain*: an ordered list of
    {"provider": <id>, "deep": <model>, "quick": <model>}
entries. The first entry with a configured API key is the primary; the rest are
fallbacks tried in order when a call fails (quota, 402 balance, outage, ...).
"""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import LanguageModelInput
from langchain_deepseek import ChatDeepSeek


class ChatDeepSeekFixed(ChatDeepSeek):
    """Patched ChatDeepSeek that re-injects reasoning_content into the API payload.

    DeepSeek thinking models return reasoning_content in responses. In multi-turn
    conversations, the DeepSeek API requires that field to be passed back verbatim
    in the assistant message. LangChain's base OpenAI message converter silently
    drops it, causing:
        'The reasoning_content in the thinking mode must be passed back to the API.'
    """

    def _get_request_payload(
        self,
        input_: LanguageModelInput,
        *,
        stop=None,
        **kwargs,
    ) -> dict:
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        try:
            original_messages = self._convert_input(input_).to_messages()
            payload_msgs = payload["messages"]
            # Walk both lists in lock-step and re-inject reasoning_content
            for orig_msg, payload_msg in zip(original_messages, payload_msgs):
                if payload_msg.get("role") == "assistant":
                    rc = getattr(orig_msg, "additional_kwargs", {}).get(
                        "reasoning_content"
                    )
                    if rc:
                        payload_msg["reasoning_content"] = rc
        except Exception:
            pass
        return payload


# `models` are suggestions shown in the UI; any model name matching MODEL_RE is
# accepted, so a provider shipping a new model doesn't need a code change.
LLM_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "deepseek": {
        "label": "DeepSeek",
        "kind": "deepseek",
        "backend_url": "https://api.deepseek.com",
        "api_key_env": "DEEPSEEK_API_KEY",
        # The API has no dated names: "deepseek-flash" is whatever Flash release is
        # current (DeepSeek-V4.1-Flash-1017 since 2026-10-17). The legacy name
        # deepseek-v4-flash is still accepted but routed to the same model.
        "models": ["deepseek-flash", "deepseek-v4-pro"],
        "model_notes": {
            "deepseek-flash": "DeepSeek-V4.1-Flash-1017 · thinking",
            "deepseek-v4-pro": "DeepSeek-V4-Pro-0813 · thinking",
        },
        "default_deep": "deepseek-flash",
        "default_quick": "deepseek-flash",
        "list_models": True,
    },
    "openai": {
        "label": "OpenAI",
        "kind": "openai",
        "backend_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "models": ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
        "default_deep": "gpt-4.1",
        "default_quick": "gpt-4.1-mini",
        "list_models": True,
    },
    "google": {
        "label": "Google Gemini",
        "kind": "google",
        "backend_url": "https://generativelanguage.googleapis.com/v1beta",
        "api_key_env": "GOOGLE_API_KEY",
        "models": ["gemini-pro-latest", "gemini-flash-latest", "gemini-flash-lite-latest"],
        "default_deep": "gemini-pro-latest",
        "default_quick": "gemini-flash-latest",
        "list_models": True,
    },
    "anthropic": {
        "label": "Anthropic",
        "kind": "anthropic",
        "backend_url": "https://api.anthropic.com",
        "api_key_env": "ANTHROPIC_API_KEY",
        "models": ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
        "default_deep": "claude-sonnet-5-5",
        "default_quick": "claude-haiku-5-5",
        "list_models": True,
    },
    "openrouter": {
        "label": "OpenRouter",
        "kind": "openai",
        "backend_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "models": [],
        "default_deep": "",
        "default_quick": "",
        "list_models": True,
    },
    "ollama": {
        "label": "Ollama (local)",
        "kind": "openai",
        "backend_url": "http://localhost:11434/v1",
        "api_key_env": None,
        "models": [],
        "default_deep": "",
        "default_quick": "",
        "list_models": True,
        "local": True,
    },
}

MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$")
MAX_CHAIN_LENGTH = 6
LLM_TIMEOUT_S = 180
LLM_MAX_RETRIES = 2


def get_providers(config: Optional[Dict[str, Any]] = None) -> Dict[str, Dict[str, Any]]:
    """Built-in providers plus any server-side extras from config["custom_llm_providers"]
    (e.g. a local Ollama endpoint defined in personal_config.py)."""
    providers = dict(LLM_PROVIDERS)
    extra = (config or {}).get("custom_llm_providers")
    if isinstance(extra, dict):
        for pid, spec in extra.items():
            if isinstance(spec, dict) and spec.get("backend_url"):
                providers[str(pid)] = {"kind": "openai", "models": [], "list_models": True, **spec}
    return providers


def provider_available(provider_id: str, config: Optional[Dict[str, Any]] = None) -> bool:
    spec = get_providers(config).get(provider_id)
    if not spec:
        return False
    env = spec.get("api_key_env")
    if not env:  # keyless endpoint (e.g. local Ollama); only offered when explicitly enabled
        cfg = config or {}
        return (
            not spec.get("local")
            or cfg.get("llm_provider") == provider_id  # legacy/CLI single-provider configs
            or bool(cfg.get("enable_local_llm") or os.environ.get("TA_ENABLE_OLLAMA"))
        )
    return bool(os.environ.get(env))


def valid_model_name(name: Any) -> bool:
    return isinstance(name, str) and bool(MODEL_RE.match(name))


def normalize_chain_entry(raw: Any, config: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, str]]:
    """Validate one {"provider","deep","quick"} entry; fill missing models from the
    provider defaults. Returns None when invalid."""
    if not isinstance(raw, dict):
        return None
    providers = get_providers(config)
    pid = str(raw.get("provider") or "").strip().lower()
    spec = providers.get(pid)
    if not spec:
        return None
    deep = str(raw.get("deep") or "").strip() or spec.get("default_deep") or ""
    quick = str(raw.get("quick") or "").strip() or spec.get("default_quick") or deep
    if not valid_model_name(deep) or not valid_model_name(quick):
        return None
    return {"provider": pid, "deep": deep, "quick": quick}


def chain_from_config(config: Dict[str, Any]) -> List[Dict[str, str]]:
    """The LLM chain for a run. Uses config["llm_chain"] when present, otherwise
    the legacy single-provider keys (llm_provider / deep_think_llm / quick_think_llm)."""
    chain: List[Dict[str, str]] = []
    raw = config.get("llm_chain")
    if isinstance(raw, list) and raw:
        for item in raw:
            entry = normalize_chain_entry(item, config)
            if entry and entry not in chain:
                chain.append(entry)
    if not chain:
        entry = normalize_chain_entry({
            "provider": config.get("llm_provider"),
            "deep": config.get("deep_think_llm"),
            "quick": config.get("quick_think_llm"),
        }, config)
        if entry:
            chain.append(entry)
    return chain[:MAX_CHAIN_LENGTH]


class _FallbackLogger(BaseCallbackHandler):
    """Prints a line when a model in the chain errors, so the journal shows why a
    run moved to the next provider."""

    def __init__(self, label: str):
        self.label = label

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> Any:
        print(f"[llm] {self.label} failed ({type(error).__name__}: {str(error)[:300]}); trying next provider if any")


def build_chat_model(provider_id: str, model: str, config: Optional[Dict[str, Any]] = None):
    spec = get_providers(config).get(provider_id)
    if not spec:
        raise ValueError(f"Unknown LLM provider: {provider_id}")
    env = spec.get("api_key_env")
    api_key = os.environ.get(env) if env else "not-needed"
    kind = spec.get("kind")
    common = {
        "model": model,
        "timeout": LLM_TIMEOUT_S,
        "max_retries": LLM_MAX_RETRIES,
        "callbacks": [_FallbackLogger(f"{provider_id}/{model}")],
    }
    if kind == "deepseek":
        return ChatDeepSeekFixed(base_url=spec["backend_url"], api_key=api_key, **common)
    if kind == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(base_url=spec["backend_url"], api_key=api_key, **common)
    if kind == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(base_url=spec["backend_url"], api_key=api_key, max_tokens=8192, **common)
    if kind == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(google_api_key=api_key, **common)
    raise ValueError(f"Unsupported provider kind: {kind}")


def build_llms(config: Dict[str, Any]) -> Tuple[Any, Any, List[Dict[str, str]]]:
    """Return (deep_llm, quick_llm, active_chain). Entries whose API key is missing
    are skipped; remaining entries become `.with_fallbacks()` in order. Bound tools
    propagate to every fallback (RunnableWithFallbacks forwards .bind_tools)."""
    chain = [e for e in chain_from_config(config) if provider_available(e["provider"], config)]
    if not chain:
        wanted = ", ".join(e["provider"] for e in chain_from_config(config)) or "none"
        raise ValueError(f"No usable LLM provider (configured: {wanted}). Set the provider's API key in .env.")
    deep_models = [build_chat_model(e["provider"], e["deep"], config) for e in chain]
    quick_models = [build_chat_model(e["provider"], e["quick"], config) for e in chain]
    deep = deep_models[0].with_fallbacks(deep_models[1:]) if len(deep_models) > 1 else deep_models[0]
    quick = quick_models[0].with_fallbacks(quick_models[1:]) if len(quick_models) > 1 else quick_models[0]
    return deep, quick, chain


_MODEL_LIST_CACHE: Dict[str, Tuple[float, List[str]]] = {}
_MODEL_LIST_LOCK = threading.Lock()
_MODEL_LIST_TTL = 600.0


def list_remote_models(provider_id: str, config: Optional[Dict[str, Any]] = None) -> List[str]:
    """Ask the provider which models it currently serves (cached 10 min)."""
    spec = get_providers(config).get(provider_id)
    if not spec or not spec.get("list_models"):
        return []
    if not provider_available(provider_id, config):
        raise RuntimeError(f"{spec.get('api_key_env')} is not set")
    with _MODEL_LIST_LOCK:
        cached = _MODEL_LIST_CACHE.get(provider_id)
        if cached and time.time() - cached[0] < _MODEL_LIST_TTL:
            return cached[1]
    env = spec.get("api_key_env")
    api_key = os.environ.get(env) if env else "not-needed"
    kind = spec.get("kind")
    if kind in ("openai", "deepseek"):
        from openai import OpenAI
        client = OpenAI(base_url=spec["backend_url"], api_key=api_key, timeout=20)
        names = [m.id for m in client.models.list()]
    elif kind == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=api_key, timeout=20)
        names = [m.id for m in client.models.list(limit=100)]
    elif kind == "google":
        from google import genai
        client = genai.Client(api_key=api_key)
        names = []
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            if actions and "generateContent" not in actions:
                continue
            names.append(str(m.name).removeprefix("models/"))
    else:
        names = []
    names = sorted({n for n in names if valid_model_name(n)})
    with _MODEL_LIST_LOCK:
        _MODEL_LIST_CACHE[provider_id] = (time.time(), names)
    return names


def catalog(config: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Public (secret-free) description of providers for the settings UI."""
    out = []
    for pid, spec in get_providers(config).items():
        out.append({
            "id": pid,
            "label": spec.get("label") or pid,
            "available": provider_available(pid, config),
            "apiKeyEnv": spec.get("api_key_env"),
            "models": list(spec.get("models") or []),
            "modelNotes": dict(spec.get("model_notes") or {}),
            "defaultDeep": spec.get("default_deep") or "",
            "defaultQuick": spec.get("default_quick") or "",
            "canListModels": bool(spec.get("list_models")),
        })
    return out
