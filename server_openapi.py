"""OpenAPI 3 description of the agent API (/api/v1), served at /api/v1/openapi.json.

Agents usually look for a machine-readable spec before guessing endpoints; keep
this in step with the /api/v1 routes in serverStock.py and with API.md.
"""
from __future__ import annotations

from typing import Any, Dict

_ACCOUNT = {"type": "string", "description": "Account id, or its name (case-insensitive). Optional if there is only one account."}
_TICKER = {"type": "string", "example": "NVDA"}
_DATE = {"type": "string", "format": "date", "description": "YYYY-MM-DD; defaults to today (US Pacific)."}
_IDEMPOTENCY = {"type": "string", "description": "Unique id for this real-world event. Retrying with the same id is a no-op (200, duplicate: true)."}

_ERROR = {
    "description": "Error",
    "content": {"application/json": {"schema": {"type": "object", "properties": {
        "error": {"type": "string"}, "message": {"type": "string"}}}}},
}


def _json_body(props: Dict[str, Any], required: list) -> Dict[str, Any]:
    return {"required": True, "content": {"application/json": {"schema": {
        "type": "object", "properties": props, "required": required}}}}


def _ok(description: str) -> Dict[str, Any]:
    return {"description": description, "content": {"application/json": {"schema": {"type": "object"}}}}


def build_spec(base_url: str) -> Dict[str, Any]:
    write = [{"bearerAuth": []}]
    errors = {"400": _ERROR, "401": _ERROR, "403": _ERROR, "404": _ERROR, "409": _ERROR}
    trade = {
        "summary": "Record a buy or sell (creates the holding if needed)",
        "description": "Requires a write-scope token. Always send `id` so retries can't double-record.",
        "security": write,
        "requestBody": _json_body({
            "account": _ACCOUNT, "ticker": _TICKER,
            "type": {"type": "string", "enum": ["buy", "sell"]},
            "shares": {"type": "number", "exclusiveMinimum": 0},
            "price": {"type": "number", "minimum": 0, "description": "Price per share"},
            "date": _DATE, "fee": {"type": "number", "minimum": 0}, "note": {"type": "string"},
            "id": _IDEMPOTENCY,
        }, ["ticker", "type", "shares", "price"]),
        "responses": {"201": _ok("Recorded; returns the updated holding"), "200": _ok("Duplicate id; nothing changed"), **errors},
    }
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "TA Watch portfolio API",
            "version": "1",
            "description": (
                "Read and update a personal stock portfolio. Authenticate with "
                "`Authorization: Bearer <token>`. Read tokens may only GET; write tokens may also POST. "
                "GET /api/v1 reports which access the current token has."
            ),
        },
        "servers": [{"url": base_url.rstrip("/")}],
        "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}},
        "security": write,
        "paths": {
            "/api/v1": {"get": {"summary": "Endpoint index and the caller's current access level",
                                "responses": {"200": _ok("Index")}}},
            "/api/v1/portfolio": {"get": {
                "summary": "Accounts with cash, totals and every holding's position, P&L and signal",
                "parameters": [
                    {"name": "account", "in": "query", "schema": _ACCOUNT},
                    {"name": "refresh", "in": "query", "schema": {"type": "boolean"},
                     "description": "Re-fetch live prices first (slow; write access only)"},
                ],
                "responses": {"200": _ok("Portfolio"), **errors}}},
            "/api/v1/accounts": {"get": {"summary": "Accounts (id, name, type, cash, contributions)",
                                         "responses": {"200": _ok("Accounts")}}},
            "/api/v1/holdings": {"get": {
                "summary": "All holdings (flat list)",
                "parameters": [{"name": "account", "in": "query", "schema": _ACCOUNT}],
                "responses": {"200": _ok("Holdings"), **errors}}},
            "/api/v1/holdings/{ticker}": {"get": {
                "summary": "One ticker's holding(s) with full transaction and comment history",
                "parameters": [{"name": "ticker", "in": "path", "required": True, "schema": _TICKER},
                               {"name": "account", "in": "query", "schema": _ACCOUNT}],
                "responses": {"200": _ok("Holding detail"), **errors}}},
            "/api/v1/trades": {"post": trade},
            "/api/v1/transactions": {"post": {**trade, "summary": "Alias of POST /api/v1/trades"}},
            "/api/v1/cashflows": {"post": {
                "summary": "Record cash in or out of an account",
                "security": write,
                "requestBody": _json_body({
                    "account": _ACCOUNT,
                    "type": {"type": "string", "enum": ["deposit", "withdrawal", "dividend", "fee", "outside-gain", "outside-loss"]},
                    "amount": {"type": "number", "exclusiveMinimum": 0, "description": "Always positive"},
                    "date": _DATE, "note": {"type": "string"}, "id": _IDEMPOTENCY,
                }, ["type", "amount"]),
                "responses": {"201": _ok("Recorded; returns new cash balance"), "200": _ok("Duplicate id"), **errors}}},
            "/api/v1/comments": {"post": {
                "summary": "Leave a note on a holding for the owner to accept or discard",
                "security": write,
                "requestBody": _json_body({"account": _ACCOUNT, "ticker": _TICKER, "text": {"type": "string"}},
                                          ["ticker", "text"]),
                "responses": {"201": _ok("Comment added"), **errors}}},
            "/api/v1/analyze": {"post": {
                "summary": "Queue a TradingAgents analysis (spends LLM credits, takes minutes)",
                "security": write,
                "requestBody": _json_body({"account": _ACCOUNT, "ticker": _TICKER}, ["ticker"]),
                "responses": {"200": _ok("Queue state"), **errors}}},
        },
    }
