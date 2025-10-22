# ...existing code...
import os
import requests
from typing import Optional

try:
    from langchain_deepseek import ChatDeepSeek
    from langchain.schema import HumanMessage
except Exception:
    ChatDeepSeek = None
    HumanMessage = None


def test_deepseek_langchain(
    api_key: Optional[str] = None,
    model: str = "deepseek-chat",
    prompt: str = "Say hello from DeepSeek (test).",
    temperature: float = 0.2,
) -> bool:
    """
    Quick test: try creating a ChatDeepSeek LLM and generating a response.
    Falls back to a simple REST model-list check if LangChain class is unavailable or errors.
    Returns True on success, False on failure.
    """
    if api_key:
        os.environ["DEEPSEEK_API_KEY"] = api_key

    # Try LangChain integration first
    if ChatDeepSeek is not None and HumanMessage is not None:
        try:
            llm = ChatDeepSeek(model=model, temperature=temperature)
            msg = HumanMessage(content=prompt)
            # LangChain chat models typically accept generate(...) with nested lists of messages
            result = llm.generate([[msg]])
            text = None
            # extract text from common result shapes
            if hasattr(result, "generations"):
                gens = result.generations
                if len(gens) and len(gens[0]):
                    text = getattr(gens[0][0], "text", None) or getattr(gens[0][0], "message", None)
                    if hasattr(text, "content"):
                        text = text.content
            if text:
                print("DeepSeek (LangChain) response:", text)
                return True
            print("DeepSeek (LangChain) returned no text; result object:", result)
        except Exception as e:
            print("LangChain ChatDeepSeek error:", type(e).__name__, e)

    # Fallback: call DeepSeek REST models endpoint to verify key + reachability
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        print("No DEEPSEEK_API_KEY set in environment.")
        return False

    try:
        url = "https://api.deepseek.com/v1/models"
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=10)
        print("DeepSeek REST status:", r.status_code)
        try:
            print("DeepSeek REST response (truncated):", r.json())
        except Exception:
            print("DeepSeek REST response text (truncated):", r.text[:1000])
        return r.status_code == 200
    except Exception as e:
        print("DeepSeek REST check failed:", type(e).__name__, e)
        return False


# Example usage: the script runs both checks in the final __main__ block below


try:
    from langchain_openai import ChatOpenAI as LangchainChatOpenAI
    from langchain.schema import HumanMessage as OpenAIHumanMessage
except Exception:
    LangchainChatOpenAI = None
    OpenAIHumanMessage = None


def test_openai_langchain(
    api_key: Optional[str] = None,
    model: str = "gpt-4o-mini",
    prompt: str = "Say hello from OpenAI (test).",
    temperature: float = 0.2,
) -> bool:
    """
    Quick test: try creating a ChatOpenAI LLM and generating a response via LangChain.
    Falls back to the OpenAI REST models/list endpoint if the LangChain class is unavailable or errors.
    Returns True on success, False on failure.
    """
    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key

    # Try LangChain integration first
    if LangchainChatOpenAI is not None and OpenAIHumanMessage is not None:
        try:
            llm = LangchainChatOpenAI(model=model, temperature=temperature)
            msg = OpenAIHumanMessage(content=prompt)
            result = llm.generate([[msg]])
            text = None
            if hasattr(result, "generations"):
                gens = result.generations
                if len(gens) and len(gens[0]):
                    text = getattr(gens[0][0], "text", None) or getattr(gens[0][0], "message", None)
                    if hasattr(text, "content"):
                        text = text.content
            if text:
                print("OpenAI (LangChain) response:", text)
                return True
            print("OpenAI (LangChain) returned no text; result object:", result)
        except Exception as e:
            print("LangChain ChatOpenAI error:", type(e).__name__, e)

    # Fallback: call OpenAI REST models endpoint to verify key + reachability
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        print("No OPENAI_API_KEY set in environment.")
        return False

    try:
        url = "https://api.openai.com/v1/models"
        r = requests.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=10)
        print("OpenAI REST status:", r.status_code)
        try:
            print("OpenAI REST response (truncated):", r.json())
        except Exception:
            print("OpenAI REST response text (truncated):", r.text[:1000])
        return r.status_code == 200
    except Exception as e:
        print("OpenAI REST check failed:", type(e).__name__, e)
        return False


if __name__ == "__main__":
    # Run both checks when test.py is executed directly
    ds_ok = test_deepseek_langchain()
    oi_ok = test_openai_langchain()
    print("DeepSeek OK:", ds_ok, "OpenAI OK:", oi_ok)
# ...existing code...