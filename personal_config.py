from tradingagents.default_config import DEFAULT_CONFIG


# Base config for the server. The LLM chain and search chain set here are only the
# *defaults*: once you save Menu → Models & search in the UI, data/settings.json wins.
PERSONAL_CONFIG = DEFAULT_CONFIG.copy()
PERSONAL_CONFIG["llm_provider"] = "deepseek"
PERSONAL_CONFIG["backend_url"] = "https://api.deepseek.com"
PERSONAL_CONFIG["deep_think_llm"] = "deepseek-flash"  # DeepSeek-V4.1-Flash; "deepseek-v4-flash" is a retired alias for it
PERSONAL_CONFIG["quick_think_llm"] = "deepseek-flash"
PERSONAL_CONFIG["max_debate_rounds"] = 1
PERSONAL_CONFIG["default_backup"] = "backup_local"
PERSONAL_CONFIG["embedding_provider"] = "local"  # chromadb's bundled ONNX MiniLM: no API calls/quota whatever the LLM provider
# Web search fallback order. Providers without an API key are skipped; one that hits
# a quota/rate limit is paused for a while and the next is used. [] disables search.
PERSONAL_CONFIG["search_providers"] = ["deepseek", "tavily", "google"]
