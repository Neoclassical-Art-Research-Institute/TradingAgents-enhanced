import os
from tradingagents.dataflows.interface import get_stock_news, get_global_news
from tradingagents.dataflows.config import set_config
from datetime import datetime

def run_test():
    """
    Runs a test of the online, grounded news search functions and writes the
    output to a file.
    """
    # --- IMPORTANT ---
    # Make sure your GOOGLE_API_KEY is set as an environment variable
    # before running this script.
    print("Step 1: Setting configuration to use online tools with Gemini grounding...")
    set_config({
        "online_tools": True,
        # This backend_url is crucial. It tells the factory to use the
        # GoogleSearchProvider which leverages Gemini's grounding feature.
        "backend_url": "https://generativelanguage.googleapis.com/v1beta/",
        "quick_think_llm": "gemini-2.0-flash"
    })

    # --- Test Parameters ---
    ticker = "NVDA"
    # We'll use today's date for the search.
    trade_date = datetime.now().strftime("%Y-%m-%d")
    output_filename = "news_search_results.txt"

    print(f"Step 2: Searching for stock-specific ('{ticker}') and global news up to {trade_date}...")

    # --- Calling the Functions ---
    try:
        stock_news_results = get_stock_news(
            ticker=ticker,
            curr_date=trade_date
        )

        global_news_results = get_global_news(
            curr_date=trade_date
        )
    except Exception as e:
        print(f"\nAn error occurred during the search: {e}")
        print("Please ensure your GOOGLE_API_KEY is correctly set in your environment variables.")
        return

    # --- Writing to File ---
    print(f"Step 3: Writing results to '{output_filename}'...")
    all_results = (
        f"--- STOCK-SPECIFIC NEWS RESULTS FOR {ticker} ---\n\n"
        f"{stock_news_results}\n\n"
        "--- GLOBAL MACROECONOMIC NEWS RESULTS ---\n\n"
        f"{global_news_results}\n"
    )

    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(all_results)

    print("\nTest complete!")
    print(f"Check the file '{output_filename}' to see the grounded search results.")

if __name__ == "__main__":
    run_test()
