# TA Watch API (for agents and scripts)

Base URL: `https://remoteapps.ngantech.net`
Every request needs a token: `Authorization: Bearer ta_...`

Create a token in the UI (**Menu → API access**) or on the server:

```bash
venv/bin/python manage_server.py token create --name "my agent" --scope write --expires-days 90
```

| Scope | Can do |
|---|---|
| `read` | Any `GET` |
| `write` | Also `POST` / `PUT` / `DELETE` on portfolio data and queue analyses |

No token can manage tokens or change model/search settings. Those need a signed-in browser.
Every write is recorded in the audit log under the token's name.

## Endpoints

`GET /api/v1` returns this list as JSON.

### Read the portfolio

```
GET /api/v1/portfolio                     all accounts
GET /api/v1/portfolio?account=Individual  one account, by name (case-insensitive) or id
GET /api/v1/portfolio?refresh=1           re-fetch live prices first (slow: about 1 s per holding)
```

Response:

```json
{
  "asOf": "2026-10-20T08:30:56Z",
  "accounts": [{
    "id": "…", "name": "Individual", "type": "account",
    "cash": 1234.56, "contributions": 50000.0,
    "totals": {"marketValue": 61000.0, "unrealizedPnl": 9000.0, "dayChange": -120.5,
               "netWorth": 62234.56, "totalReturn": 12234.56},
    "holdings": [{
      "id": "…", "ticker": "NVDA", "shares": 10, "avgCost": 120.5, "price": 181.2,
      "marketValue": 1812.0, "unrealizedPnl": 607.0, "unrealizedPct": 50.37,
      "realizedPnl": 0, "dayChange": 12.3, "dayChangePct": 0.68,
      "signal": "Hold", "analysisCompletedAt": "…", "pendingComments": 0, "…": "…"
    }]
  }]
}
```

Watchlist accounts have no `cash`, `contributions`, `netWorth` or `totalReturn`.
Prices come from the last stored snapshot unless you pass `refresh=1`.

```
GET /api/v1/holdings/NVDA[?account=…]   holding(s) with full transaction and comment history
```

### Record a trade

```
POST /api/v1/trades
{"account": "Individual", "ticker": "NVDA", "type": "buy", "shares": 10, "price": 181.20,
 "date": "2026-10-20", "fee": 0, "note": "added on dip", "id": "agent-2026-10-20-nvda-1"}
```

- Creates the holding if the account doesn't have one for that ticker yet.
- `date` defaults to today (US Pacific). `fee`, `note` and `id` are optional.
- **Always send an `id`** that is unique to the real-world trade. If a request is retried with the
  same `id`, nothing changes and you get `200 {"duplicate": true}`.
- Selling more shares than are held still records the sell, but adds a `warning` to the response.
- Returns `201` with the updated holding.

### Record cash

```
POST /api/v1/cashflows
{"account": "Individual", "type": "deposit", "amount": 500, "date": "2026-10-20", "note": "", "id": "…"}
```

`type` is one of `deposit`, `withdrawal`, `dividend`, `fee`, `outside-gain` or `outside-loss`.
`amount` is always positive. Same `id` rule as trades. The response includes the account's new `cash`.

### Leave a note for the owner

```
POST /api/v1/comments
{"account": "Individual", "ticker": "NVDA", "text": "Earnings on 11/19; consider trimming before."}
```

The note shows on the holding as *pending* until the owner accepts or discards it.

### Run an analysis

```
POST /api/v1/analyze
{"account": "Individual", "ticker": "NVDA"}
```

This queues a TradingAgents run, which spends LLM credits and takes several minutes. Check
progress with `GET /api/queue/status`. The result shows up as `signal` in the portfolio.

## Errors

Errors are JSON: `{"error": "<code>", "message": "…"}`.

| Status | Meaning |
|---|---|
| 400 | Invalid input. The message says which field. |
| 401 | Missing, invalid, revoked or expired token |
| 403 | Token is read-only, or the endpoint needs a browser session |
| 404 | Account or holding not found. For accounts, the response lists the valid names. |
| 409 | Several accounts share that name. Use the id from the response. |
| 429 | Too many bad tokens from this IP. Wait for `retryAfter` seconds. |

## Lower-level endpoints

The UI's own endpoints accept the same tokens. They are useful for edits the v1 endpoints don't cover:

```
GET    /api/accounts                      PUT /api/accounts/<id>   (name, cashFlows, …)
GET    /api/stocks                        GET /api/stocks/<id>
PUT    /api/stocks/<id>/transactions/<txid>     DELETE /api/stocks/<id>/transactions/<txid>
PUT    /api/stocks/<id>/comments/<cid>          DELETE /api/stocks/<id>/comments/<cid>
POST   /api/refresh-snapshots             re-fetch all prices
GET    /api/settings                      current LLM and search chains, plus provider status
```
