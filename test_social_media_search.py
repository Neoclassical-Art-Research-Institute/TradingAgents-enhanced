import os
from tradingagents.dataflows.interface import get_reddit_company_news, get_twitter_stock_info
from tradingagents.dataflows.config import set_config
from datetime import datetime

def run_test():
    """
    Runs a test of the online social media search functions and writes the
    output to a file.
    """
    # --- IMPORTANT ---
    # Make sure your search provider API key (e.g., TAVILY_API_KEY) is set as an
    # environment variable before running this script.
    print("Step 1: Setting configuration to use online tools...")
    # This configuration ensures our script uses the web search provider.
    set_config({
        "online_tools": True,
        # This backend_url is crucial. It tells the factory to use the
        # GoogleSearchProvider which leverages Gemini's grounding feature.
        "backend_url": "https://generativelanguage.googleapis.com/v1beta/",
        "quick_think_llm": "gemini-2.0-flash"
    })

    # --- Test Parameters ---
    ticker = "NVDA"
    # We'll use yesterday's date for the search end date.
    trade_date = datetime.now().strftime("%Y-%m-%d")
    output_filename = "social_media_search_results.txt"

    print(f"Step 2: Searching Reddit and Twitter for '{ticker}' discussions up to {trade_date}...")

    # --- Calling the Functions ---
    try:
        reddit_results = get_reddit_company_news(
            ticker=ticker,
            start_date=trade_date,
            look_back_days=7
        )

        twitter_results = get_twitter_stock_info(
            ticker=ticker,
            start_date=trade_date,
            look_back_days=7
        )
    except Exception as e:
        print(f"\nAn error occurred during the search: {e}")
        print("Please ensure your TAVILY_API_KEY (or other search provider key) is correctly set in your environment variables.")
        return

    # --- Writing to File ---
    print(f"Step 3: Writing results to '{output_filename}'...")
    all_results = (
        "--- REDDIT SEARCH RESULTS ---\n\n"
        f"{reddit_results}\n\n"
        "--- TWITTER/X SEARCH RESULTS ---\n\n"
        f"{twitter_results}\n"
    )

    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(all_results)

    print("\nTest complete!")
    print(f"Check the file '{output_filename}' to see the search results.")

if __name__ == "__main__":
    run_test()
