from .embedding_providers import (
    EmbeddingProvider,
    OpenAIEmbeddingProvider,
    GeminiEmbeddingProvider,
    OllamaEmbeddingProvider,
    LocalEmbeddingProvider,
)


class EmbeddingProviderFactory:
    @staticmethod
    def create_provider(config : dict[str, any])->EmbeddingProvider:
        # Explicit override: fully local embeddings regardless of the LLM provider.
        if config.get("embedding_provider") == "local":
            return LocalEmbeddingProvider()

        backend_url = config["backend_url"]

        if  "deepseek" in backend_url: # Deepseek does not currently have its own embedding model, Lets just use backup for now
            backup = config["default_backup"]
            if backup == "backup_local":
                return LocalEmbeddingProvider()
            backend_url = config[backup]["backend_url"]

        if "generativelanguage.googleapis.com" in backend_url:
            return GeminiEmbeddingProvider(backend_url)
        elif "localhost:11434" in backend_url:
            return OllamaEmbeddingProvider(backend_url)
        else:
            return OpenAIEmbeddingProvider(backend_url)
        