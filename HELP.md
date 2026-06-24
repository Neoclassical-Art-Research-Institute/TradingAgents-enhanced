# TradingAgents Enhanced — Help

## Running the Server

```bash
# Start (managed by systemd automatically on boot)
sudo systemctl start stockserver

# Restart after code changes
sudo systemctl restart stockserver

# Live logs (filtered)
sudo journalctl -u stockserver -f | grep -v "report-file"
```

**URL:** http://remoteapps.ngantech.net  
**Direct port:** http://136.109.65.147:5055 (if Nginx is down)

---

## Development — Run Locally

```bash
cd ~/projects/TradingAgents-enhanced
source venv/bin/activate
python serverStock.py
```
Runs on http://localhost:5055 with Flask dev server (debug mode, do not expose publicly).

---

## Virtual Environment

```bash
# Activate
source ~/projects/TradingAgents-enhanced/venv/bin/activate

# Install a new dependency
venv/bin/pip install <package>

# Add it to requirements.txt after installing
echo "<package>>=x.x" >> requirements.txt

# Reinstall everything from scratch
venv/bin/pip install -r requirements.txt
```

---

## Configuration

**Main config:** `personal_config.py`  
**Defaults:** `tradingagents/default_config.py`

| Setting | Current Value | File |
|---|---|---|
| LLM provider | `deepseek` | `personal_config.py` |
| Deep thinking model | `deepseek-v4-flash` | `personal_config.py` |
| Quick thinking model | `deepseek-v4-flash` | `personal_config.py` |
| Embedding provider | OpenAI (fallback) | `default_config.py` |
| Embedding model | `text-embedding-3-large` | `embedding_providers.py` |
| Backup LLM | `gpt-4.1` / `gpt-4.1-mini` | `default_config.py` |

**Why two providers?** DeepSeek handles all LLM calls but has no embedding model.
OpenAI `text-embedding-3-large` is used for vector memory (ChromaDB).

---

## API Keys

Stored in `.env` (loaded by systemd):

```
DEEPSEEK_API_KEY=...
OPENAI_API_KEY=...
FINNHUB_API_KEY=...    # for market data tools
```

To check which keys are loaded:
```bash
cat ~/projects/TradingAgents-enhanced/.env
```

After editing `.env`:
```bash
sudo systemctl restart stockserver
```

---

## Check Available Models

```bash
source venv/bin/activate

# DeepSeek models
python3 -c "
from openai import OpenAI; import os
c = OpenAI(base_url='https://api.deepseek.com', api_key=os.environ['DEEPSEEK_API_KEY'])
[print(m.id) for m in c.models.list()]
"

# OpenAI models
python3 -c "
from openai import OpenAI
[print(m.id) for m in OpenAI().models.list()]
"
```

---

## Data & Reports

| Path | Contents |
|---|---|
| `data/stocks.json` | All stock entries and analysis state |
| `data/reports/` | Per-ticker markdown report files |
| `data/.ta_runs/` | TradingAgents intermediate run artifacts |

Reports are generated per analysis run. If no analysis has been run yet for a ticker, report-file warnings in logs are normal and harmless.

---

## Known Issues & Fixes

### Analysis jobs queue but never run
- **Cause:** Background worker thread not started (e.g. after a bad restart)
- **Fix:** `sudo systemctl restart stockserver`

### `TemplateNotFound: index.html`
- **Cause:** Root route `/` had wrong template name
- **Fix:** Already patched — `/` redirects to `/stock`

### `TypeError: 'NoneType' ... p["analysis"]["summary"]`
- **Cause:** `analysis` field is `None` on new entries
- **Fix:** Already patched in `summarize_post()`

### DeepSeek `reasoning_content` error (v4-pro)
- **Cause:** Reasoning models return hidden chain-of-thought that must be echoed back; LangChain doesn't handle this
- **Fix:** Use `deepseek-v4-flash` for both roles (current config)

### `OPENAI_API_KEY` error even when using DeepSeek
- **Cause:** Embeddings fall back to OpenAI since DeepSeek has no embedding model
- **Fix:** Add `OPENAI_API_KEY` to `.env`

---

## Adding a New Server / App

See `~/HELP.md` for the full Nginx + systemd pattern.
