from abc import ABC, abstractmethod
from openai import OpenAI
from google import genai
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

_EMBEDDING_MAX_TOKENS = 8192


def _truncate_to_token_limit(text: str, max_tokens: int = _EMBEDDING_MAX_TOKENS) -> str:
    """Truncate text to fit within the embedding model's token limit.

    Uses tiktoken when available (transitively installed via langchain-openai),
    falling back to a conservative character-based estimate (4 chars/token).
    """
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return enc.decode(tokens[:max_tokens])
    except Exception:
        char_limit = max_tokens * 4
        return text[:char_limit]


class EmbeddingProvider(ABC):
    @abstractmethod
    def get_embedding(self, text: str)->list[float]:
        pass

    @property
    @abstractmethod
    def model_name(self)->str:
        pass

class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self, backend_url: str, embedding_model: str = "text-embedding-3-small"):
        self.client = OpenAI(base_url=backend_url)
        self._embedding_model = embedding_model

    
    def get_embedding(self, text: str)->list[float]:
        response = self.client.embeddings.create(
            model=self._embedding_model,
            input=_truncate_to_token_limit(text)
        )
        return response.data[0].embedding
    
    @property
    def model_name(self)->str:
        return self._embedding_model
    

class GeminiEmbeddingProvider(EmbeddingProvider):
    def __init__(self, backend_url: str, embedding_model: str = "gemini-embedding-exp-03-07"):
        self.client = genai.Client()
        self._embedding_model = embedding_model

    def get_embedding(self, text: str)->list[float]:
        response = self.client.models.embed_content(
            model=self._embedding_model,
            contents=text
        )
        return response.embeddings[0].values
    
    @property
    def model_name(self)->str:
        return self._embedding_model
    
class LocalEmbeddingProvider(EmbeddingProvider):
    """Fully local embeddings via chromadb's bundled ONNX MiniLM model — no API calls or keys needed."""

    def __init__(self):
        self._fn = DefaultEmbeddingFunction()

    def get_embedding(self, text: str) -> list[float]:
        vec = self._fn([_truncate_to_token_limit(text)])[0]
        return vec.tolist() if hasattr(vec, "tolist") else list(vec)

    @property
    def model_name(self) -> str:
        return "all-MiniLM-L6-v2"


class OllamaEmbeddingProvider(EmbeddingProvider):
    def __init__(self, backend_url: str, embedding_model: str = "nomic-embed-text"):
        self.client = OpenAI(base_url=backend_url)
        self._embedding_model = embedding_model

    def get_embedding(self, text: str)->list[float]:
        response = self.client.embeddings.create(
            model=self._embedding_model,
            input=text
        )
        return response.data[0].embedding
    
    @property
    def model_name(self)->str:
        return self._embedding_model
    