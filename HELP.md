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
Runs on http://127.0.0.1:5055 with the Flask dev server. For plain-HTTP testing, set
`TA_COOKIE_SECURE=0` or login cookies won't stick. `TA_DEV_DEBUG=1` turns on the Werkzeug
debugger. Never use it on a reachable host: its console runs arbitrary Python.

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

## First-time setup after the security update

The site now requires a login. Set a password **before** restarting the service:

```bash
venv/bin/python manage_server.py set-password     # at least 10 characters
sudo systemctl restart stockserver
```

Without a password, the login page just shows this instruction. Agents use API tokens instead
of the password. See [API.md](API.md).

```bash
venv/bin/python manage_server.py token create --name "my agent" --scope write --expires-days 90
venv/bin/python manage_server.py token list
venv/bin/python manage_server.py token revoke <id>
venv/bin/python manage_server.py logout-all       # sign out every browser
venv/bin/python manage_server.py public-read on   # anyone can view; editing needs sign-in (off = login to view)
```

With public read on, visitors who aren't signed in see everything read-only, with a "Sign in to
edit" button. They can't change data, run analyses (including `/api/analyze-stream`), or open
Models & search, API access, or the audit log.

Tokens can also be created and revoked in the UI under **Menu → API access**, which also shows
recent changes from the audit log (`data/audit.log`).

---

## Configuration

**Models & web search:** UI → **Menu → Models & search**, saved to `data/settings.json`.
- **Analysis models** is an ordered list. The first entry whose API key is set is the primary.
  If a call fails (quota, low balance, outage, bad model name), the next entry takes over for
  that call, even partway through an analysis.
- **Web search** is an ordered list of DeepSeek Search, Tavily, Google (Gemini grounding) and
  OpenAI. A provider that hits a rate limit is skipped for 15 min; one with a quota or auth error
  is skipped for 6 h. "Clear cooldowns" resets that. If every provider fails, analysts continue
  without search instead of failing.
- A single holding can override the primary model through the API with `options.llm_provider`,
  `deep_think_llm` and `quick_think_llm`. The global list stays behind it as fallbacks.

**Base config:** `personal_config.py` (used as defaults until settings are saved in the UI)
**Framework defaults:** `tradingagents/default_config.py`
**Provider registry (endpoints, key env vars, suggested models):** `tradingagents/llm_providers.py`

| Setting | Value |
|---|---|
| Default LLM | DeepSeek `deepseek-flash` (V4.1 Flash) for both roles |
| Other DeepSeek model | `deepseek-v4-pro` |
| Default search order | DeepSeek Search → Tavily → Google |
| Embeddings | Local chromadb MiniLM (`embedding_provider = "local"`), no API calls |

**DeepSeek Search pricing:** free until 2026-11-01 00:00 Beijing time, then $0.75 per 1,000
successful searches. A full analysis makes roughly 5–10 searches.

### Server environment variables (optional, in `.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TA_SECRET_KEY` | random, stored in `data/.secret_key` | Signs session cookies |
| `TA_SESSION_DAYS` | `30` | How long a browser stays signed in |
| `TA_COOKIE_SECURE` | `1` | Set to `0` only for plain-HTTP testing on a LAN |
| `TA_TRUST_PROXY` | `1` | Trust nginx's `X-Forwarded-*` headers (one hop) |
| `TA_DATA_DIR` | `./data` | Data directory (useful for testing) |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | none | Enable those LLM providers |

---

## API Keys

Stored in `.env` (loaded by systemd):

```
DEEPSEEK_API_KEY=...   # LLM + DeepSeek Search
OPENAI_API_KEY=...     # optional LLM fallback / search
GOOGLE_API_KEY=...     # optional LLM fallback / Google search
TAVILY_API_KEY=...     # optional search
FINNHUB_API_KEY=...    # for market data tools
```

A provider without a key shows "(no key)" in Models & search and is skipped.

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
- **Cause:** Reasoning models return hidden chain-of-thought that must be echoed back; LangChain drops it
- **Fix:** `ChatDeepSeekFixed` in `tradingagents/llm_providers.py` re-injects it. If v4-pro still fails,
  keep `deepseek-flash` behind it in the model list and calls will fall back automatically.

### "Web search unavailable" in reports
- **Cause:** Every enabled search provider is missing a key, cooling down, or failing
- **Fix:** Menu → Models & search shows each provider's last error. Top up or add a key, then
  click "Clear cooldowns".

### Locked out / forgot password
- Run `venv/bin/python manage_server.py set-password` on the server. No restart is needed.

---

## Adding a New Server / App

See `~/HELP.md` for the full Nginx + systemd pattern.
