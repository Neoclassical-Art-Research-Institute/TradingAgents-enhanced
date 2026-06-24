import os

DEFAULT_CONFIG = {
    "project_dir": os.path.abspath(os.path.join(os.path.dirname(__file__), ".")),
    "results_dir": os.getenv("TRADINGAGENTS_RESULTS_DIR", "./results"),
    "data_dir": "/Users/yluo/Documents/Code/ScAI/FR1-data",
    "data_cache_dir": os.path.join(
        os.path.abspath(os.path.join(os.path.dirname(__file__), ".")),
        "dataflows/data_cache",
    ),
    # LLM settings
    "llm_provider": "openai",
    "deep_think_llm": "o4-mini",
    "quick_think_llm": "gpt-4o-mini",
    "backend_url": "https://api.openai.com/v1",
    # Debate and discussion settings
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1,
    "max_recur_limit": 100,
    # Tool settings
    "online_tools": True,
    # Used when the main backend (e.g. DeepSeek) has no embedding model of its own.
    # "backup_local" uses chromadb's bundled ONNX MiniLM (fully local, no API calls);
    # "backup_openai" / "backup_google" route embedding calls to those providers.
    "default_backup": "backup_openai",
    # Search provider override: "auto" picks Google/OpenAI search based on backend_url,
    # "tavily" always uses Tavily Search (requires TAVILY_API_KEY env var), or "none" to
    # skip web search entirely (news/social/fundamentals analysts get an instant "search
    # disabled" stub instead of a live call — zero quota usage; market data is unaffected
    # since the market analyst's online tools call yfinance directly, never the search provider).
    "search_provider": "auto",
    # Backup LLM settings
    "backup_google" : {
        "deep_think_llm": "gemini-pro-latest",
        "quick_think_llm": "gemini-flash-lite-latest",
        "backend_url": "https://generativelanguage.googleapis.com/v1beta",
    },
    "backup_openai" : {
        "deep_think_llm": "gpt-4.1",
        "quick_think_llm": "gpt-4.1-mini",
        "backend_url": "https://api.openai.com/v1",
    }
}
