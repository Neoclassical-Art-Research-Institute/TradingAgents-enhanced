from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG



# Create a custom config
PERSONAL_CONFIG = DEFAULT_CONFIG.copy()
PERSONAL_CONFIG["llm_provider"] = "deepseek"  # Use a different model
PERSONAL_CONFIG["backend_url"] = "https://api.deepseek.com"  # Use a different backend
PERSONAL_CONFIG["deep_think_llm"] = "deepseek-reasoner"  # Use a different model
PERSONAL_CONFIG["quick_think_llm"] = "deepseek-chat"  # Use a different model
PERSONAL_CONFIG["max_debate_rounds"] = 1  # Increase debate rounds
PERSONAL_CONFIG["online_tools"] = True  # Increase debate rounds