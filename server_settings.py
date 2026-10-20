"""Runtime analysis settings (LLM chain + search chain), persisted to data/settings.json.

personal_config.py stays the base config; these settings are layered on top and
are editable from the UI (Menu → Models & search) or PUT /api/settings.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, List, Optional

from tradingagents.llm_providers import (
    MAX_CHAIN_LENGTH,
    catalog as llm_catalog,
    chain_from_config,
    get_providers,
    normalize_chain_entry,
    valid_model_name,
)
from tradingagents.dataflows.search_provider import (
    DEFAULT_SEARCH_CHAIN,
    SEARCH_PROVIDERS,
    chain_from_config as search_chain_from_config,
    search_provider_available,
    search_status,
)

_LOCK = threading.RLock()


class SettingsError(ValueError):
    pass


class SettingsStore:
    def __init__(self, data_dir: str, base_config_fn):
        self.path = os.path.join(data_dir, "settings.json")
        self._base_config_fn = base_config_fn

    # -- defaults ---------------------------------------------------------
    def defaults(self) -> Dict[str, Any]:
        base = self._base_config_fn()
        llm_chain = chain_from_config(base) or [{"provider": "deepseek", "deep": "deepseek-flash", "quick": "deepseek-flash"}]
        search = search_chain_from_config(base)
        if base.get("search_provider") == "none" and "search_providers" not in base:
            # personal_config disabled search only because Tavily ran dry; with a
            # fallback chain there is no reason to start with search off.
            search = list(DEFAULT_SEARCH_CHAIN)
        return {
            "llm_chain": llm_chain,
            "search_chain": search,
            "search_models": {k: v["default_model"] for k, v in SEARCH_PROVIDERS.items() if v.get("default_model")},
        }

    # -- persistence ------------------------------------------------------
    def load(self) -> Dict[str, Any]:
        with _LOCK:
            settings = self.defaults()
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    stored = json.load(f)
                if isinstance(stored, dict):
                    settings.update({k: v for k, v in stored.items() if k in settings})
            except FileNotFoundError:
                pass
            except Exception as e:
                print(f"[settings] Ignoring unreadable {self.path}: {e}")
            # Re-validate what was stored (it may be hand-edited or reference a
            # provider that no longer exists); fall back to defaults per field.
            defaults = self.defaults()
            base = self._base_config_fn()
            chain = [e for e in (normalize_chain_entry(x, base) for x in settings.get("llm_chain") or []) if e]
            settings["llm_chain"] = chain[:MAX_CHAIN_LENGTH] or defaults["llm_chain"]
            try:
                settings["search_chain"] = self.validate_search_chain(settings.get("search_chain"))
            except SettingsError:
                settings["search_chain"] = defaults["search_chain"]
            if not isinstance(settings.get("search_models"), dict):
                settings["search_models"] = defaults["search_models"]
            return settings

    def save(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with _LOCK:
            current = self.load()
            merged = dict(current)
            if "llm_chain" in payload:
                merged["llm_chain"] = self.validate_llm_chain(payload["llm_chain"])
            if "search_chain" in payload:
                merged["search_chain"] = self.validate_search_chain(payload["search_chain"])
            if "search_models" in payload:
                merged["search_models"] = self.validate_search_models(payload["search_models"], current["search_models"])
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(merged, f, indent=2)
            os.replace(tmp, self.path)
            return merged

    # -- validation -------------------------------------------------------
    def validate_llm_chain(self, raw: Any) -> List[Dict[str, str]]:
        if not isinstance(raw, list) or not raw:
            raise SettingsError("llm_chain must be a non-empty list of {provider, deep, quick}.")
        if len(raw) > MAX_CHAIN_LENGTH:
            raise SettingsError(f"llm_chain can have at most {MAX_CHAIN_LENGTH} entries.")
        base = self._base_config_fn()
        out: List[Dict[str, str]] = []
        for i, item in enumerate(raw):
            entry = normalize_chain_entry(item, base)
            if not entry:
                pid = (item or {}).get("provider") if isinstance(item, dict) else item
                raise SettingsError(f"llm_chain[{i}] is invalid (provider '{pid}' unknown, or bad model name).")
            if entry not in out:
                out.append(entry)
        return out

    @staticmethod
    def validate_search_chain(raw: Any) -> List[str]:
        if not isinstance(raw, list):
            raise SettingsError("search_chain must be a list of provider ids (empty disables web search).")
        out: List[str] = []
        for name in raw:
            name = str(name or "").strip().lower()
            if name not in SEARCH_PROVIDERS:
                raise SettingsError(f"Unknown search provider '{name}'. Options: {', '.join(SEARCH_PROVIDERS)}.")
            if name not in out:
                out.append(name)
        return out

    @staticmethod
    def validate_search_models(raw: Any, current: Dict[str, str]) -> Dict[str, str]:
        if not isinstance(raw, dict):
            raise SettingsError("search_models must be an object.")
        out = dict(current)
        for name, model in raw.items():
            if name not in SEARCH_PROVIDERS or not SEARCH_PROVIDERS[name].get("default_model"):
                continue
            model = str(model or "").strip() or SEARCH_PROVIDERS[name]["default_model"]
            if not valid_model_name(model):
                raise SettingsError(f"Invalid model name for {name}.")
            out[name] = model
        return out

    # -- applying to a run ------------------------------------------------
    def apply(self, cfg: Dict[str, Any], override: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Write the LLM/search chains into a run config. `override` (a validated
        per-holding {provider, deep, quick}) becomes the primary; the global chain
        follows as fallbacks."""
        settings = self.load()
        chain = list(settings["llm_chain"])
        if override:
            chain = [override] + [e for e in chain if e != override]
        chain = chain[:MAX_CHAIN_LENGTH]
        providers = get_providers(cfg)
        primary = chain[0]
        cfg["llm_chain"] = chain
        cfg["llm_provider"] = primary["provider"]
        cfg["deep_think_llm"] = primary["deep"]
        cfg["quick_think_llm"] = primary["quick"]
        cfg["backend_url"] = providers[primary["provider"]].get("backend_url") or ""
        cfg["search_providers"] = list(settings["search_chain"])
        cfg["search_models"] = dict(settings["search_models"])
        return cfg

    # -- UI payload -------------------------------------------------------
    def describe(self) -> Dict[str, Any]:
        base = self._base_config_fn()
        status = search_status()
        return {
            "settings": self.load(),
            "llmProviders": llm_catalog(base),
            "searchProviders": [
                {
                    "id": name,
                    "label": spec["label"],
                    "apiKeyEnv": spec["api_key_env"],
                    "available": search_provider_available(name),
                    "usesModel": bool(spec.get("default_model")),
                    "defaultModel": spec.get("default_model") or "",
                    "status": status.get(name, {}),
                }
                for name, spec in SEARCH_PROVIDERS.items()
            ],
        }

    def summary(self) -> Dict[str, Any]:
        s = self.load()
        primary = s["llm_chain"][0]
        return {
            "llm_provider": primary["provider"],
            "deep_think_llm": primary["deep"],
            "quick_think_llm": primary["quick"],
            "llm_fallbacks": [e["provider"] for e in s["llm_chain"][1:]],
            "search_chain": s["search_chain"],
        }
