from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG



# Create a custom config
PERSONAL_CONFIG = DEFAULT_CONFIG.copy()
PERSONAL_CONFIG["llm_provider"] = "deepseek"  # Use a different model
PERSONAL_CONFIG["backend_url"] = "https://api.deepseek.com"  # Use a different backend
PERSONAL_CONFIG["deep_think_llm"] = "deepseek-v4-flash"  # v4-pro causes reasoning_content errors in multi-turn; use flash for both
PERSONAL_CONFIG["quick_think_llm"] = "deepseek-v4-flash"  # Latest DeepSeek fast model
PERSONAL_CONFIG["max_debate_rounds"] = 1  # Increase debate rounds
PERSONAL_CONFIG["default_backup"] = "backup_local"  # DeepSeek has no embedding model; use chromadb's local ONNX MiniLM (no API calls/quota)
PERSONAL_CONFIG["search_provider"] = "none"  # Tavily quota exhausted; skip web search entirely (news/social/fundamentals analysts get an instant stub, no quota used). Set back to "tavily" to re-enable.