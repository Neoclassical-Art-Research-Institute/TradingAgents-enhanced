#!/usr/bin/env python3
"""Server administration: login password and API tokens.

  venv/bin/python manage_server.py set-password
  venv/bin/python manage_server.py token create --name "my agent" --scope write [--expires-days 90]
  venv/bin/python manage_server.py token list
  venv/bin/python manage_server.py token revoke <id>
  venv/bin/python manage_server.py logout-all

Changes take effect immediately; no restart needed.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from server_auth import TOKEN_SCOPES, AuthStore

DATA_DIR = os.environ.get("TA_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("set-password", help="Set or change the web login password (signs out all sessions)")
    sub.add_parser("logout-all", help="Sign out every browser session")
    tok = sub.add_parser("token", help="Manage API tokens")
    tsub = tok.add_subparsers(dest="action", required=True)
    create = tsub.add_parser("create")
    create.add_argument("--name", required=True)
    create.add_argument("--scope", choices=TOKEN_SCOPES, default="read")
    create.add_argument("--expires-days", type=int, default=None)
    tsub.add_parser("list")
    revoke = tsub.add_parser("revoke")
    revoke.add_argument("id")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    store = AuthStore(DATA_DIR)

    if args.cmd == "set-password":
        pw = getpass.getpass("New password: ")
        if pw != getpass.getpass("Repeat password: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
        try:
            store.set_password(pw)
        except ValueError as e:
            print(e, file=sys.stderr)
            return 1
        print("Password set. Existing browser sessions were signed out.")
    elif args.cmd == "logout-all":
        store.bump_session_epoch()
        print("All browser sessions signed out.")
    elif args.action == "create":
        token, rec = store.create_token(args.name, args.scope, args.expires_days)
        print(f"Created {rec['scope']} token '{rec['name']}' (id {rec['id']}).")
        print("Copy it now; it will not be shown again:\n")
        print(f"  {token}\n")
    elif args.action == "list":
        tokens = store.list_tokens()
        if not tokens:
            print("No tokens.")
        for t in tokens:
            print(f"{t['id']}  {t['scope']:<5}  {t['name']:<24}  {t['hint']}…  created {t['createdAt'][:10]}"
                  f"  last used {(t.get('lastUsedAt') or 'never')[:16]}  expires {(t.get('expiresAt') or 'never')[:10]}")
    elif args.action == "revoke":
        print("Revoked." if store.revoke_token(args.id) else "No such token.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
