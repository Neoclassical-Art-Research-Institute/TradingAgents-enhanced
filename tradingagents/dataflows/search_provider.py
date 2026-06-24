from google import genai
from google.genai.types import Tool, GenerateContentConfig, GoogleSearch
from openai import OpenAI
from tavily import TavilyClient
from abc import ABC, abstractmethod
import time
import random



class SearchProvider(ABC):
    @abstractmethod
    def search(self, query: str, ticker: str, curr_date: str) -> str:
        pass


class NoSearchProvider(SearchProvider):
    """No-op provider for search_provider="none": skips the web search entirely so
    news/social/fundamentals analysts can still run (and write a report from whatever
    other analysts produced) without making any external search request or burning quota."""

    def search(self, query: str) -> str:
        return (
            "Web search is disabled (search_provider=\"none\"). No live search results "
            "are available for this query — do not retry; proceed with the analysis "
            "using only the data already available to you."
        )


class GoogleSearchProvider(SearchProvider):
    def __init__(self, model: str):
        self.client = genai.Client()
        self.model = model
    
    def search(self, query: str) -> str:
        grounding_tool = Tool(google_search=GoogleSearch())
        config = GenerateContentConfig(tools=[grounding_tool])

        max_retries = 5
        delay = 15  # seconds before first retry
        for attempt in range(max_retries):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=query,
                    config=config
                )
                result_text = ""
                for part in response.candidates[0].content.parts:
                    if hasattr(part, 'text'):
                        result_text += part.text
                return result_text
            except Exception as e:
                err = str(e)
                if "429" in err or "RESOURCE_EXHAUSTED" in err:
                    if attempt < max_retries - 1:
                        wait = delay * (2 ** attempt) + random.uniform(0, 5)
                        print(f"[GoogleSearch] Rate limited (429), retrying in {wait:.1f}s (attempt {attempt+1}/{max_retries})...")
                        time.sleep(wait)
                    else:
                        raise
                else:
                    raise
    

class TavilySearchProvider(SearchProvider):
    def __init__(self, max_results: int = 5):
        self.client = TavilyClient()  # reads TAVILY_API_KEY from the environment
        self.max_results = max_results

    def search(self, query: str) -> str:
        response = self.client.search(
            query=query,
            search_depth="advanced",
            topic="finance",
            max_results=self.max_results,
            include_answer=True,
        )

        result_text = ""
        if response.get("answer"):
            result_text += response["answer"] + "\n\n"

        for item in response.get("results", []):
            result_text += f"### {item.get('title', '')}\n{item.get('url', '')}\n{item.get('content', '')}\n\n"

        return result_text.strip()


class OpenAISearchProvider(SearchProvider):
    def __init__(self, model: str, backend_url: str):
        self.client = OpenAI(base_url=backend_url)
        self.model = model
    
    def search(self, query: str) -> str:
        response = self.client.responses.create(
            model=self.model,
            input=[
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": query
                        }
                    ],
                }
            ],
            text={"format": {"type": "text"}},
            reasoning={},
            tools=[
                {
                    "type": "web_search_preview",
                    "user_location": {"type": "approximate"},
                    "search_context_size": "low",
                }
            ],
            temperature=1,
            max_output_tokens=4096,
            top_p=1,
            store=True,
        )

        return response.output[1].content[0].text