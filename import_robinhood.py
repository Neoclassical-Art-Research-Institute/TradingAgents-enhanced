#!/usr/bin/env python3
"""Import a Robinhood activity CSV export into the tracker's data files.

Maps CSV rows onto the app's data model (data/accounts.json + data/stocks.json):
  - Buy/Sell rows        -> holding transactions (one holding per ticker)
  - deposits/withdrawals -> account cashFlows (deposit / withdrawal)
  - dividends & income   -> account cashFlows (dividend)
  - taxes/fees/losses    -> account cashFlows (fee)

Rows *before* --cutoff can be "flattened" (--flatten): the pre-cutoff history is
collapsed into one opening buy per still-held ticker (at average cost, dated the
day before the cutoff) plus one opening deposit covering the opening cash
balance + the cost of those opening positions. Rows on/after the cutoff are
imported faithfully, one transaction per CSV row.

Every generated transaction/cashflow gets a *deterministic* id derived from the
row's content, so re-running the import on a newer export that overlaps an
already-imported period will not create duplicates (idempotent sync). Use
--replace to rebuild an account's transactions/cashFlows from scratch instead
of merging.

Typical usage:
  # First-time faithful rebuild of an account (flatten pre-May-2026 history):
  python3 import_robinhood.py data/imports/individual.csv \
      --account-id 56429927-... --rename "Individual" --flatten --replace

  # Future periodic sync (export only needs to cover dates >= cutoff):
  python3 import_robinhood.py newexport.csv --account-name "Individual"
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
STOCKS_FILE = os.path.join(DATA_DIR, "stocks.json")
ACCOUNTS_FILE = os.path.join(DATA_DIR, "accounts.json")

NS = uuid.uuid5(uuid.NAMESPACE_URL, "tradingagents-enhanced/robinhood-import")

# Cash-event trans codes -> (cashflow type by sign, note builder)
DEPOSIT_CODES = {"ACH", "ICWIRE", "DCF", "CFIR", "PFIR", "MTCH", "RTP", "XENT_CC", "ITRF"}
INCOME_CODES = {"CDIV", "SCAP", "MDIV", "INT", "SLIP"}
CHARGE_CODES = {"DTAX", "DFEE"}
SHARE_EVENT_CODES = {"REC", "SOFF"}  # zero-cost share deliveries
SKIP_CODES = {"SXCH"}  # same-ticker corporate exchange: no position/cash effect

DEPOSIT_NOTES = {
    "ACH": ("ACH Deposit", "ACH Withdrawal"),
    "ICWIRE": ("Wire Deposit", "Wire Withdrawal"),
    "DCF": ("Debit Card Transfer In", "Debit Card Transfer Out"),
    "CFIR": ("IRA Contribution (Current Year)", "IRA Contribution Reversal"),
    "PFIR": ("IRA Contribution (Prior Year)", "IRA Contribution Reversal"),
    "MTCH": ("IRA Match", "IRA Match Reversal"),
    "RTP": ("Instant Bank Transfer In", "Instant Bank Transfer Out"),
    "XENT_CC": ("Credit Card Refund", "Credit Card Payment"),
    "ITRF": ("Internal Transfer In", "Transfer to Roth IRA"),
}


def parse_money(raw: str) -> float | None:
    s = (raw or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        val = float(s)
    except ValueError:
        return None
    return -val if neg else val


def parse_qty(raw: str) -> float | None:
    s = re.sub(r"[^0-9.]", "", (raw or "").strip())
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        m, d, y = s.split("/")
        return date(int(y), int(m), int(d)).isoformat()
    except Exception:
        return None


def load_rows(path: str) -> List[Dict[str, str]]:
    """Read the CSV and return rows in chronological order (export is newest-first)."""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if parse_date(r.get("Activity Date", ""))]
    rows.reverse()
    return rows


def det_id(*parts: Any) -> str:
    return str(uuid.uuid5(NS, "|".join(str(p) for p in parts)))


def first_line(desc: str) -> str:
    return (desc or "").split("\n")[0].strip()


def cdiv_note(ticker: str, desc: str, label: str) -> str:
    m = re.search(r"-\s*([\d.]+)\s+shares?\s+at\s+([\d.]+)", desc or "")
    if m:
        return f"{ticker} {label} ({m.group(1)}sh @ ${m.group(2)})"
    return f"{ticker} {label}".strip()


def build_events(rows: List[Dict[str, str]], account_key: str) -> Dict[str, Any]:
    """Convert chronological CSV rows into trade events + cash events.

    Returns {"trades": [...], "cash": [...], "skipped": [...]}. Deterministic ids
    include an occurrence counter so identical rows (which Robinhood exports do
    contain legitimately) stay distinct yet reproducible across re-imports.
    """
    trades: List[Dict[str, Any]] = []
    cash: List[Dict[str, Any]] = []
    skipped: List[str] = []
    slip_by_date: Dict[str, float] = defaultdict(float)
    seen: Dict[str, int] = defaultdict(int)

    for row in rows:
        code = (row.get("Trans Code") or "").strip()
        ticker = (row.get("Instrument") or "").strip().upper()
        d = parse_date(row.get("Activity Date", ""))
        desc = row.get("Description") or ""
        qty = parse_qty(row.get("Quantity", ""))
        price = parse_money(row.get("Price", ""))
        amount = parse_money(row.get("Amount", ""))

        sig = f"{account_key}|{d}|{code}|{ticker}|{row.get('Quantity','')}|{row.get('Price','')}|{row.get('Amount','')}"
        seen[sig] += 1
        rid = det_id(sig, seen[sig])

        if code in SKIP_CODES:
            skipped.append(f"{d} {ticker} {code} qty={row.get('Quantity')} (no position/cash effect)")
            continue

        if code in ("Buy", "Sell") and ticker and qty and price is not None:
            # The Amount column is authoritative; the Price column is display-rounded
            # (e.g. a $4.745 fill shows as $4.74). Derive the effective price/fee so
            # shares*price +/- fee reproduces Amount exactly (cash stays penny-true).
            fee = 0.0
            if amount is not None:
                def gap(p):  # positive == extra cost on buys / haircut on sells
                    return (abs(amount) - qty * p) if code == "Buy" else (qty * p - amount)
                diff = gap(price)
                if abs(diff) > 1.0 or diff <= -0.005:  # display-rounded price: recover from Amount
                    price = round(abs(amount) / qty, 4)
                    diff = gap(price)
                if diff >= 0.005:  # remainder is a real (SEC/TAF) fee
                    fee = round(diff, 4)
            trades.append({
                "id": rid, "date": d, "type": code.lower(), "ticker": ticker,
                "shares": round(qty, 6), "price": round(price, 4), "fee": fee,
            })
            continue

        if code in SHARE_EVENT_CODES and ticker and qty:
            label = "Spin-off shares received" if code == "SOFF" else "Shares received"
            trades.append({
                "id": rid, "date": d, "type": "buy", "ticker": ticker,
                "shares": round(qty, 6), "price": 0.0, "fee": 0.0, "note": label,
            })
            continue

        if amount is None:
            skipped.append(f"{d} {ticker} {code} (no amount)")
            continue

        if code == "SLIP":
            slip_by_date[d] += amount
            continue

        if code in INCOME_CODES:
            if code == "CDIV":
                note = cdiv_note(ticker, desc, "Cash Dividend")
            elif code == "SCAP":
                note = cdiv_note(ticker, desc, "Capital Gains Distribution")
            elif code == "MDIV":
                note = cdiv_note(ticker, desc, "Manufactured Dividend")
            else:
                note = first_line(desc) or "Interest Payment"
            kind = "dividend" if amount > 0 else "fee"
            cash.append({"id": rid, "date": d, "type": kind, "amount": round(abs(amount), 2), "note": note})
            continue

        if code in CHARGE_CODES:
            note = f"{ticker} {first_line(desc)}".strip()
            kind = "fee" if amount < 0 else "dividend"
            cash.append({"id": rid, "date": d, "type": kind, "amount": round(abs(amount), 2), "note": note})
            continue

        if code == "FUTSWP":
            # P&L realized outside tracked holdings (event contracts / futures):
            # its own cashflow type so it isn't mistaken for equity income.
            is_event = "event" in desc.lower()
            if amount >= 0:
                note = "Event Contracts Gain" if is_event else "Futures Gain"
                cash.append({"id": rid, "date": d, "type": "outside-gain", "amount": round(amount, 2), "note": note})
            else:
                note = "Event Contracts Loss" if is_event else "Futures Loss"
                cash.append({"id": rid, "date": d, "type": "outside-loss", "amount": round(-amount, 2), "note": note})
            continue

        if code in DEPOSIT_CODES:
            pos_note, neg_note = DEPOSIT_NOTES.get(code, (first_line(desc), first_line(desc)))
            if amount >= 0:
                cash.append({"id": rid, "date": d, "type": "deposit", "amount": round(amount, 2), "note": pos_note})
            else:
                cash.append({"id": rid, "date": d, "type": "withdrawal", "amount": round(-amount, 2), "note": neg_note})
            continue

        skipped.append(f"{d} {ticker} {code} amount={amount} (unrecognized code)")

    for d, total in sorted(slip_by_date.items()):
        if total > 0:
            cash.append({
                "id": det_id(account_key, d, "SLIP-DAY", round(total, 2)),
                "date": d, "type": "dividend", "amount": round(total, 2),
                "note": "Stock Lending Income",
            })

    cash.sort(key=lambda c: c["date"])
    return {"trades": trades, "cash": cash, "skipped": skipped}


def simulate_positions(trades: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Average-cost simulation per ticker (mirrors serverStock._position_from_transactions).

    Reorders buys before sells within a (ticker, date) when a sell would
    otherwise exceed the held share count, and records clamp warnings.
    """
    by_ticker: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in trades:
        by_ticker[t["ticker"]].append(t)

    out: Dict[str, Dict[str, Any]] = {}
    for ticker, txns in by_ticker.items():
        ordered = sorted(txns, key=lambda t: t["date"])  # stable: keeps csv order in-day

        def run(seq):
            shares = avg = realized = 0.0
            clamps = []
            for t in seq:
                if t["type"] == "buy":
                    ns = shares + t["shares"]
                    if ns > 0:
                        avg = (avg * shares + t["price"] * t["shares"]) / ns
                    shares = ns
                else:
                    if t["shares"] > shares + 1e-9:
                        clamps.append(f"{t['date']} sell {t['shares']} > held {round(shares, 6)}")
                    sell_qty = min(t["shares"], shares)
                    realized += (t["price"] - avg) * sell_qty - t.get("fee", 0.0)
                    shares = max(0.0, shares - t["shares"])
                    if shares <= 1e-9:
                        shares = 0.0
            return shares, avg, realized, clamps

        shares, avg, realized, clamps = run(ordered)
        if clamps:
            # retry with buys-first inside each date
            reordered = sorted(ordered, key=lambda t: (t["date"], 0 if t["type"] == "buy" else 1))
            s2, a2, r2, c2 = run(reordered)
            if len(c2) < len(clamps):
                ordered, shares, avg, realized, clamps = reordered, s2, a2, r2, c2
        out[ticker] = {
            "txns": ordered, "shares": round(shares, 6),
            "avgCost": round(avg, 4) if shares > 0 else None,
            "realized": round(realized, 2), "clamps": clamps,
        }
    return out


def read_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json_atomic(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


DEFAULT_OPTIONS = {
    "preset": "balanced",
    "selected_analysts": ["market", "social", "news", "fundamentals"],
    "debug": False,
    "online_tools": True,
    "max_debate_rounds": 1,
    "date": None,
    "config": {},
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path")
    ap.add_argument("--account-id", help="Target an existing account by id")
    ap.add_argument("--account-name", help="Find (or create) the account by name")
    ap.add_argument("--rename", help="Rename the target account")
    ap.add_argument("--keyword", help="Set the account's soft-lock keyword")
    ap.add_argument("--cutoff", default="2026-05-01", help="Rows before this date are flattened/ignored (default 2026-05-01)")
    ap.add_argument("--flatten", action="store_true", help="Collapse pre-cutoff rows into an opening position + opening deposit")
    ap.add_argument("--replace", action="store_true", help="Rebuild the account's cashFlows and holdings' transactions from this import (instead of merge-sync)")
    ap.add_argument("--dry-run", action="store_true", help="Print the summary without writing anything")
    ap.add_argument("--calibrate-cash", type=float, metavar="TARGET",
                    help="After import, add an outside-gain/loss entry so derived cash equals TARGET "
                         "(covers activity Robinhood omits from exports: crypto, prediction markets, spending)")
    ap.add_argument("--calibrate-date", default=None, help="Date for the calibration entry (default: today)")
    args = ap.parse_args()

    if not args.account_id and not args.account_name:
        ap.error("provide --account-id and/or --account-name")

    accounts = read_json(ACCOUNTS_FILE, [])
    stocks = read_json(STOCKS_FILE, [])

    account = None
    if args.account_id:
        account = next((a for a in accounts if str(a.get("id")) == args.account_id), None)
        if account is None:
            print(f"error: no account with id {args.account_id}", file=sys.stderr)
            return 1
    else:
        account = next((a for a in accounts if a.get("name") == args.account_name), None)

    now = utcnow_iso()
    created_account = False
    if account is None:
        account = {
            "id": str(uuid.uuid4()), "name": args.account_name, "type": "account",
            "order": max([a.get("order", 0) for a in accounts], default=0) + 1,
            "collapsed": False, "keyword": "", "cashFlows": [],
            "createdAt": now, "updatedAt": now,
        }
        accounts.append(account)
        created_account = True
    if args.rename:
        account["name"] = args.rename
    if args.keyword is not None:
        account["keyword"] = args.keyword

    acct_id = str(account["id"])
    cutoff = args.cutoff
    flatten_date = (date.fromisoformat(cutoff) - timedelta(days=1)).isoformat()

    rows = load_rows(args.csv_path)
    pre = [r for r in rows if parse_date(r["Activity Date"]) < cutoff]
    post = [r for r in rows if parse_date(r["Activity Date"]) >= cutoff]

    new_trades: List[Dict[str, Any]] = []
    new_cash: List[Dict[str, Any]] = []
    warnings: List[str] = []

    # ---- flatten pre-cutoff history ------------------------------------------------
    if args.flatten and pre:
        pre_ev = build_events(pre, acct_id)
        positions = simulate_positions(pre_ev["trades"])
        opening_cash = round(sum((parse_money(r.get("Amount", "")) or 0.0) for r in pre), 2)
        opening_cost = 0.0
        for ticker, pos in sorted(positions.items()):
            for c in pos["clamps"]:
                warnings.append(f"[pre-cutoff {ticker}] {c}")
            if 0 < pos["shares"] < 1e-4:
                warnings.append(f"[pre-cutoff {ticker}] dust position {pos['shares']} sh dropped")
                continue
            if pos["shares"] > 0:
                cost = round(pos["shares"] * (pos["avgCost"] or 0.0), 2)
                opening_cost += cost
                new_trades.append({
                    "id": det_id(acct_id, "opening", cutoff, ticker),
                    "date": flatten_date, "type": "buy", "ticker": ticker,
                    "shares": pos["shares"], "price": pos["avgCost"] or 0.0, "fee": 0.0,
                    "note": f"Opening position (history before {cutoff} flattened)",
                })
        opening_deposit = round(opening_cash + opening_cost, 2)
        if opening_deposit > 0:
            new_cash.append({
                "id": det_id(acct_id, "opening-deposit", cutoff),
                "date": flatten_date, "type": "deposit", "amount": opening_deposit,
                "note": f"Opening balance (history before {cutoff} flattened: "
                        f"${opening_cash:,.2f} cash + ${opening_cost:,.2f} positions at cost)",
            })
        else:
            warnings.append(f"opening deposit non-positive ({opening_deposit}); not recorded")
        print(f"Flatten @ {flatten_date}: cash ${opening_cash:,.2f} + positions ${opening_cost:,.2f} "
              f"-> opening deposit ${opening_deposit:,.2f}")
        held = {t: p for t, p in sorted(positions.items()) if p["shares"] > 0}
        for t, p in held.items():
            print(f"   opening {t:6s} {p['shares']:>12} sh @ {p['avgCost']}")
    elif pre:
        print(f"note: {len(pre)} pre-cutoff rows ignored (run with --flatten to fold them into an opening position)")

    # ---- faithful post-cutoff import ----------------------------------------------
    post_ev = build_events(post, acct_id)
    new_trades.extend(post_ev["trades"])
    new_cash.extend(post_ev["cash"])
    for s in post_ev["skipped"]:
        print(f"   skipped: {s}")

    # sanity-simulate combined trades (opening + faithful)
    combined = simulate_positions(new_trades)
    for ticker, pos in sorted(combined.items()):
        for c in pos["clamps"]:
            warnings.append(f"[{ticker}] {c}")

    # ---- merge into data files ------------------------------------------------------
    if args.replace:
        account["cashFlows"] = new_cash
    else:
        have = {cf.get("id") for cf in account.get("cashFlows", [])}
        account["cashFlows"] = account.get("cashFlows", []) + [c for c in new_cash if c["id"] not in have]
        account["cashFlows"].sort(key=lambda c: str(c.get("date", "")))
    account["updatedAt"] = now

    by_ticker_txns: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in sorted(new_trades, key=lambda t: t["date"]):
        by_ticker_txns[t["ticker"]].append({
            "id": t["id"], "type": t["type"], "shares": t["shares"], "price": t["price"],
            "fee": t.get("fee", 0.0), "date": t["date"], "note": t.get("note", ""),
        })

    holdings_by_ticker = {
        str(h.get("ticker") or "").upper(): h
        for h in stocks if str(h.get("accountId")) == acct_id
    }
    def avg_cost_of(txns: List[Dict[str, Any]]) -> float | None:
        """Average cost of the remaining position over a full transaction list."""
        shares = avg = 0.0
        for t in sorted(txns, key=lambda t: str(t.get("date", ""))):
            qty = float(t.get("shares") or 0)
            if t.get("type") == "buy":
                ns = shares + qty
                if ns > 0:
                    avg = (avg * shares + float(t.get("price") or 0) * qty) / ns
                shares = ns
            else:
                shares = max(0.0, shares - qty)
        return round(avg, 4) if shares > 1e-9 and avg > 0 else None

    created, updated = [], []
    for ticker, txns in sorted(by_ticker_txns.items()):
        pos = combined[ticker]
        purchases = {ticker: pos["avgCost"]} if pos["avgCost"] else {}
        holding = holdings_by_ticker.get(ticker)
        if holding is None:
            stocks.append({
                "id": det_id(acct_id, "holding", ticker),
                "createdAt": now, "updatedAt": now, "accountId": acct_id,
                "title": ticker, "description": "", "note": "",
                "ticker": ticker, "tickers": [ticker],
                "transactions": txns, "options": dict(DEFAULT_OPTIONS), "purchases": purchases,
            })
            created.append(ticker)
        else:
            if args.replace:
                holding["transactions"] = txns
                holding["purchases"] = purchases
            else:
                have = {t.get("id") for t in holding.get("transactions", [])}
                fresh = [t for t in txns if t["id"] not in have]
                if not fresh:
                    continue  # nothing new for this holding
                holding["transactions"] = holding.get("transactions", []) + fresh
                holding["transactions"].sort(key=lambda t: str(t.get("date", "")))
                ac = avg_cost_of(holding["transactions"])
                holding["purchases"] = {ticker: ac} if ac else {}
            holding["updatedAt"] = now
            updated.append(ticker)

    untouched = sorted(set(holdings_by_ticker) - set(by_ticker_txns))
    if args.replace and untouched:
        warnings.append(f"holdings with no rows in this import left untouched: {', '.join(untouched)}")

    # ---- derived cash (full post-merge state) & optional calibration ---------------
    def ledger_cash_now() -> float:
        total = sum(
            c["amount"] * (1 if c["type"] in ("deposit", "dividend", "outside-gain") else -1)
            for c in account["cashFlows"]
        )
        for h in stocks:
            if str(h.get("accountId")) != acct_id:
                continue
            for t in h.get("transactions", []):
                qty, pr = float(t.get("shares") or 0), float(t.get("price") or 0)
                fe = float(t.get("fee") or 0)
                total += -(qty * pr + fe) if t.get("type") == "buy" else (qty * pr - fe)
        return round(total, 2)

    ledger_cash = ledger_cash_now()
    if args.calibrate_cash is not None:
        delta = round(args.calibrate_cash - ledger_cash, 2)
        if abs(delta) >= 0.01:
            cdate = args.calibrate_date or datetime.now().date().isoformat()
            account["cashFlows"].append({
                "id": det_id(acct_id, "calibrate", cdate, delta),
                "date": cdate,
                "type": "outside-gain" if delta > 0 else "outside-loss",
                "amount": abs(delta),
                "note": "Cash true-up vs Robinhood (activity not in export: crypto/prediction markets/spending)",
            })
            account["cashFlows"].sort(key=lambda c: str(c.get("date", "")))
            print(f"Calibration: outside {'gain' if delta > 0 else 'loss'} of ${abs(delta):,.2f} on {cdate} "
                  f"-> cash ${args.calibrate_cash:,.2f}")
            ledger_cash = ledger_cash_now()
        else:
            print("Calibration: derived cash already matches target")

    # ---- report ---------------------------------------------------------------------
    print(f"\nAccount: {account['name']} ({acct_id}){' [created]' if created_account else ''}")
    print(f"Cash flows: {len(account['cashFlows'])} total after import")
    print(f"Holdings: {len(created)} created ({', '.join(created) or '-'}), {len(updated)} updated ({', '.join(updated) or '-'})")
    print("\nFinal positions:")
    for ticker, pos in sorted(combined.items()):
        if pos["shares"] > 0:
            print(f"   {ticker:6s} {pos['shares']:>12} sh @ avg {pos['avgCost']:<10} realized {pos['realized']:>10,.2f}")
        else:
            print(f"   {ticker:6s} {'closed':>12}    realized {pos['realized']:>10,.2f}")
    print(f"\nDerived cash after import: ${ledger_cash:,.2f}")
    if warnings:
        print("\nWARNINGS:")
        for w in warnings:
            print(f"   ! {w}")

    if args.dry_run:
        print("\n(dry run: nothing written)")
        return 0

    ts = int(time.time())
    for path in (ACCOUNTS_FILE, STOCKS_FILE):
        if os.path.exists(path):
            with open(path, "rb") as src, open(f"{path}.bak-import-{ts}", "wb") as dst:
                dst.write(src.read())
    write_json_atomic(ACCOUNTS_FILE, accounts)
    write_json_atomic(STOCKS_FILE, stocks)
    print(f"\nWrote {ACCOUNTS_FILE} and {STOCKS_FILE} (backups *.bak-import-{ts})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
