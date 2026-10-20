from .search_provider import SearchChain, SearchProvider, chain_from_config


class SearchProviderFactory:
    @staticmethod
    def create_provider(config: dict[str, any]) -> SearchProvider:
        """Build the ordered search fallback chain for this config. Provider
        instances and health/cooldown state are shared process-wide, so this is cheap."""
        return SearchChain(chain_from_config(config), config.get("search_models") or {})

    @staticmethod
    def clear_cache():
        """Kept for backwards compatibility; provider instances are cached in search_provider."""
