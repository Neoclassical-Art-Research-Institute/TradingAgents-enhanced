from .embedding_providers import (
    EmbeddingProvider,
    OpenAIEmbeddingProvider,
    GeminiEmbeddingProvider,
    OllamaEmbeddingProvider
)


class EmbeddingProviderFactory:
    @staticmethod
    def create_provider(config : dict[str, any])->EmbeddingProvider:
        backend_url = config["backend_url"]

        if  "deepseek" in backend_url: # Deepseek does not currently have its own embedding model, Lets just use backup for now
            model = config[config["default_backup"]]["quick_think_llm"]
            backend_url = config[config["default_backup"]]["backend_url"]

        if "generativelanguage.googleapis.com" in backend_url:
            return GeminiEmbeddingProvider(backend_url)
        elif "localhost:11434" in backend_url:
            return OllamaEmbeddingProvider(backend_url)
        else:
            return OpenAIEmbeddingProvider(backend_url)
        