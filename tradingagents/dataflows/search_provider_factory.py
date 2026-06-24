from .search_provider import (
    SearchProvider,
    GoogleSearchProvider,
    OpenAISearchProvider,
    TavilySearchProvider,
    NoSearchProvider
)
import hashlib
import json


class SearchProviderFactory:
    _cache = {}  # Cache to store created providers
    
    @staticmethod
    def create_provider(config: dict[str, any]) -> SearchProvider:
        """
        Create a SearchProvider with caching to avoid creating new instances.
        Uses config hash as cache key for efficient reuse.
        """
        # Create cache key from relevant config values
        cache_key_data = {
            "backend_url": config["backend_url"],
            "model": config["quick_think_llm"],
            "search_provider": config.get("search_provider")
        }
        cache_key = hashlib.md5(json.dumps(cache_key_data, sort_keys=True).encode()).hexdigest()

        # Return cached instance if exists
        if cache_key in SearchProviderFactory._cache:
            return SearchProviderFactory._cache[cache_key]

        # Explicit override: bypass the LLM-backend-based selection below entirely
        if config.get("search_provider") == "none":
            provider = NoSearchProvider()
            SearchProviderFactory._cache[cache_key] = provider
            return provider

        if config.get("search_provider") == "tavily":
            provider = TavilySearchProvider()
            SearchProviderFactory._cache[cache_key] = provider
            return provider

        # Create new instance
        backend_url = config["backend_url"]
        model = config["quick_think_llm"]

        if  "deepseek" in backend_url: # DeepSeek can't do web search, use Google Search instead
            google_model = config.get("backup_google", {}).get("quick_think_llm", "gemini-2.5-flash-lite")
            provider = GoogleSearchProvider(google_model)
            SearchProviderFactory._cache[cache_key] = provider
            return provider

        if "generativelanguage.googleapis.com" in backend_url:
            provider = GoogleSearchProvider(model)
        else:
            provider = OpenAISearchProvider(model, backend_url)
        
        # Cache and return
        SearchProviderFactory._cache[cache_key] = provider
        return provider
    
    @staticmethod
    def clear_cache():
        """Clear the provider cache (useful for testing or config changes)."""
        SearchProviderFactory._cache.clear()

