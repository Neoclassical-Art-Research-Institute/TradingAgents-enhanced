"""Authentication, CSRF, rate limiting, audit logging and security headers.

Two ways in:
  * Browser: password login → signed session cookie (HttpOnly, Secure, SameSite=Lax).
    Every state-changing request must also carry the session's CSRF token in the
    X-CSRF-Token header. Browser sessions are "admin": they may also manage API
    tokens and analysis settings.
  * Agents/scripts: `Authorization: Bearer ta_...` API tokens. Scope "read" allows
    GET only; scope "write" also allows changing portfolio data. Tokens can never
    manage tokens or settings. Only a SHA-256 hash of each token is stored.
  * Optional public read ("public_read" in auth.json): anonymous visitors may view
    pages and GET the API, but never edit, run analyses, or see settings/tokens/audit.

State lives in data/auth.json (password hash, tokens, session epoch). Manage it
with `python manage_server.py ...` or from the UI (Menu → API access).
"""
from __future__ import annotations

import functools
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from flask import Flask, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

TOKEN_PREFIX = "ta_"
TOKEN_SCOPES = ("read", "write")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
MIN_PASSWORD_LENGTH = 10
PUBLIC_ENDPOINTS = {"login", "static", "serve_static", "health"}
# GET endpoints that never count as "viewing": anonymous visitors can't call them
# even with public read on (settings/token/audit pages, live model listing).
PRIVATE_GET_ENDPOINTS = {"get_settings", "auth_list_tokens", "audit_tail", "list_provider_models"}
AUDIT_MAX_BYTES = 5 * 1024 * 1024


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Persistent auth state
# ---------------------------------------------------------------------------
class AuthStore:
    def __init__(self, data_dir: str):
        self.path = os.path.join(data_dir, "auth.json")
        self._lock = threading.RLock()
        self._last_used_flush: Dict[str, float] = {}

    def _load(self) -> Dict[str, Any]:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    data.setdefault("tokens", [])
                    data.setdefault("session_epoch", 1)
                    return data
        except FileNotFoundError:
            pass
        return {"password_hash": None, "session_epoch": 1, "tokens": []}

    def _save(self, data: Dict[str, Any]) -> None:
        tmp = self.path + ".tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, self.path)

    # -- password ---------------------------------------------------------
    def has_password(self) -> bool:
        with self._lock:
            return bool(self._load().get("password_hash"))

    def set_password(self, password: str) -> None:
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        with self._lock:
            data = self._load()
            data["password_hash"] = generate_password_hash(password, method="scrypt")
            # Changing the password signs out every existing browser session.
            data["session_epoch"] = int(data.get("session_epoch") or 1) + 1
            self._save(data)

    def check_password(self, password: str) -> bool:
        with self._lock:
            stored = self._load().get("password_hash")
        if not stored:
            return False
        return check_password_hash(stored, password)

    def public_read(self) -> bool:
        with self._lock:
            return bool(self._load().get("public_read"))

    def set_public_read(self, enabled: bool) -> None:
        with self._lock:
            data = self._load()
            data["public_read"] = bool(enabled)
            self._save(data)

    def session_epoch(self) -> int:
        with self._lock:
            return int(self._load().get("session_epoch") or 1)

    def bump_session_epoch(self) -> int:
        with self._lock:
            data = self._load()
            data["session_epoch"] = int(data.get("session_epoch") or 1) + 1
            self._save(data)
            return data["session_epoch"]

    # -- tokens -----------------------------------------------------------
    @staticmethod
    def _public(rec: Dict[str, Any]) -> Dict[str, Any]:
        return {k: v for k, v in rec.items() if k != "hash"}

    def list_tokens(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [self._public(t) for t in self._load()["tokens"]]

    def create_token(self, name: str, scope: str, expires_in_days: Optional[int] = None) -> Tuple[str, Dict[str, Any]]:
        name = str(name or "").strip()[:60]
        if not name:
            raise ValueError("Token name is required.")
        if scope not in TOKEN_SCOPES:
            raise ValueError(f"Scope must be one of: {', '.join(TOKEN_SCOPES)}.")
        token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        now = _utcnow()
        rec = {
            "id": secrets.token_hex(6),
            "name": name,
            "scope": scope,
            "hint": token[: len(TOKEN_PREFIX) + 6],
            "hash": _hash_token(token),
            "createdAt": _iso(now),
            "expiresAt": _iso(now + timedelta(days=int(expires_in_days))) if expires_in_days else None,
            "lastUsedAt": None,
        }
        with self._lock:
            data = self._load()
            data["tokens"].append(rec)
            self._save(data)
        return token, self._public(rec)

    def revoke_token(self, token_id: str) -> bool:
        with self._lock:
            data = self._load()
            remaining = [t for t in data["tokens"] if t.get("id") != token_id]
            if len(remaining) == len(data["tokens"]):
                return False
            data["tokens"] = remaining
            self._save(data)
            return True

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        if not token or not token.startswith(TOKEN_PREFIX) or len(token) > 200:
            return None
        digest = _hash_token(token)
        with self._lock:
            data = self._load()
            match = None
            for rec in data["tokens"]:
                if hmac.compare_digest(rec.get("hash", ""), digest):
                    match = rec
            if not match:
                return None
            exp = match.get("expiresAt")
            if exp and datetime.fromisoformat(exp.replace("Z", "+00:00")) < _utcnow():
                return None
            # Record last use, but write at most once a minute per token.
            now = time.time()
            if now - self._last_used_flush.get(match["id"], 0) > 60:
                match["lastUsedAt"] = _iso(_utcnow())
                self._last_used_flush[match["id"]] = now
                self._save(data)
            return self._public(match)


def load_secret_key(data_dir: str) -> bytes:
    """TA_SECRET_KEY from the environment, else a random key persisted (0600) in data/."""
    env = os.environ.get("TA_SECRET_KEY")
    if env:
        return env.encode("utf-8")
    path = os.path.join(data_dir, ".secret_key")
    try:
        with open(path, "rb") as f:
            key = f.read().strip()
            if len(key) >= 32:
                return key
    except FileNotFoundError:
        pass
    key = secrets.token_hex(32).encode("ascii")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    return key


# ---------------------------------------------------------------------------
# Rate limiting (in-process; the service runs a single gunicorn worker)
# ---------------------------------------------------------------------------
class FailureLimiter:
    """Blocks a key after `limit` failures inside `window` seconds."""

    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self._events: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> Deque[float]:
        q = self._events[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked_for(self, key: str) -> float:
        now = time.time()
        with self._lock:
            q = self._prune(key, now)
            if len(q) >= self.limit:
                return max(1.0, self.window - (now - q[0]))
            return 0.0

    def fail(self, key: str) -> None:
        with self._lock:
            self._events[key].append(time.time())

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
class AuditLog:
    def __init__(self, data_dir: str):
        self.path = os.path.join(data_dir, "audit.log")
        self._lock = threading.Lock()

    def write(self, **fields: Any) -> None:
        line = json.dumps({"ts": _iso(_utcnow()), **fields}, ensure_ascii=False)
        with self._lock:
            try:
                if os.path.exists(self.path) and os.path.getsize(self.path) > AUDIT_MAX_BYTES:
                    os.replace(self.path, self.path + ".1")
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                with os.fdopen(fd, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except Exception as e:
                print(f"[audit] write failed: {e}")

    def tail(self, limit: int = 100) -> List[Dict[str, Any]]:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                lines = deque(f, maxlen=limit)
        except FileNotFoundError:
            return []
        out = []
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except Exception:
                continue
        return out


# ---------------------------------------------------------------------------
# Flask wiring
# ---------------------------------------------------------------------------
def _safe_next(target: Optional[str]) -> str:
    """Only allow same-site relative redirects after login (no open redirect)."""
    if not target:
        return "/stock"
    parts = urlsplit(target)
    if parts.scheme or parts.netloc or not target.startswith("/") or target.startswith("//") or "\\" in target:
        return "/stock"
    return target


def _csp(nonce: str) -> str:
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' 'nonce-{nonce}'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def require_admin(fn):
    """Endpoint decorator: browser session only (API tokens are rejected)."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if (getattr(g, "auth", None) or {}).get("kind") != "session":
            return jsonify({"error": "forbidden", "message": "This action requires a signed-in browser session, not an API token."}), 403
        return fn(*args, **kwargs)

    return wrapper


def init_auth(app: Flask, data_dir: str, costly_get_endpoints: frozenset = frozenset()) -> AuthStore:
    """`costly_get_endpoints`: GET routes with real side effects (e.g. running an LLM
    analysis). They require write access: a write token or a browser session."""
    store = AuthStore(data_dir)
    audit = AuditLog(data_dir)
    login_limiter = FailureLimiter(limit=5, window=15 * 60)
    global_login_limiter = FailureLimiter(limit=100, window=15 * 60)
    token_limiter = FailureLimiter(limit=20, window=15 * 60)

    app.secret_key = load_secret_key(data_dir)
    app.config.update(
        SESSION_COOKIE_NAME="ta_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("TA_COOKIE_SECURE", "1") != "0",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.environ.get("TA_SESSION_DAYS", "30"))),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
    )
    app.extensions["ta_auth"] = store
    app.extensions["ta_audit"] = audit

    def client_ip() -> str:
        return request.remote_addr or "?"

    def unauthorized(message: str, status: int = 401):
        if request.path.startswith("/api/"):
            resp = jsonify({"error": "unauthorized" if status == 401 else "forbidden", "message": message})
            resp.status_code = status
            if status == 401:
                resp.headers["WWW-Authenticate"] = 'Bearer realm="tradingagents"'
            return resp
        return redirect(url_for("login", next=request.full_path.rstrip("?")))

    @app.before_request
    def _authenticate():
        g.csp_nonce = secrets.token_urlsafe(16)
        g.auth = None
        if request.endpoint in PUBLIC_ENDPOINTS:
            return None

        header = request.headers.get("Authorization", "")
        if header:
            scheme, _, value = header.partition(" ")
            if scheme.lower() != "bearer" or not value.strip():
                return unauthorized("Use 'Authorization: Bearer <token>'.")
            ip = client_ip()
            wait = token_limiter.blocked_for(ip)
            if wait:
                return jsonify({"error": "rate_limited", "retryAfter": int(wait)}), 429
            rec = store.verify_token(value.strip())
            if not rec:
                token_limiter.fail(ip)
                audit.write(event="token_rejected", ip=ip, method=request.method, path=request.path)
                return unauthorized("Invalid, revoked or expired API token.")
            if rec["scope"] != "write" and (request.method not in SAFE_METHODS or request.endpoint in costly_get_endpoints):
                return unauthorized("This token is read-only.", status=403)
            g.auth = {"kind": "token", "name": rec["name"], "scope": rec["scope"], "id": rec["id"]}
            return None

        sess = session.get("auth")
        if isinstance(sess, dict) and sess.get("epoch") == store.session_epoch():
            if request.method not in SAFE_METHODS:
                sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token") or ""
                if not hmac.compare_digest(str(sent), str(sess.get("csrf", ""))):
                    return jsonify({"error": "csrf", "message": "Missing or invalid CSRF token. Reload the page."}), 403
            g.auth = {"kind": "session", "name": "browser", "scope": "admin"}
            return None

        if (
            store.public_read()
            and request.method in SAFE_METHODS
            and request.endpoint not in costly_get_endpoints
            and request.endpoint not in PRIVATE_GET_ENDPOINTS
        ):
            g.auth = {"kind": "anonymous", "name": "viewer", "scope": "view"}
            return None

        if not store.has_password() and not request.path.startswith("/api/"):
            return redirect(url_for("login"))
        return unauthorized("Sign in to make changes." if store.public_read() else "Sign in, or send an API token.")

    @app.after_request
    def _finish(resp):
        auth = getattr(g, "auth", None)
        if auth and request.method not in SAFE_METHODS:
            actor = "browser" if auth["kind"] == "session" else f"token:{auth['name']}"
            audit.write(event="request", actor=actor, ip=client_ip(), method=request.method,
                        path=request.path, status=resp.status_code)
        h = resp.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        if request.is_secure:
            h.setdefault("Strict-Transport-Security", "max-age=31536000")
        if resp.mimetype == "text/html":
            h.setdefault("Content-Security-Policy", _csp(getattr(g, "csp_nonce", "")))
        if request.path.startswith("/api/") and "Cache-Control" not in h:
            h["Cache-Control"] = "no-store"
        return resp

    @app.context_processor
    def _template_vars():
        sess = session.get("auth") or {}
        auth = getattr(g, "auth", None) or {}
        # "admin" (browser session), "write"/"read" (API token) or "view" (anonymous)
        viewer = "admin" if auth.get("kind") == "session" else auth.get("scope", "view")
        return {"csp_nonce": getattr(g, "csp_nonce", ""), "csrf_token": sess.get("csrf", ""), "viewer": viewer}

    # -- routes -----------------------------------------------------------
    @app.route("/login", methods=["GET", "POST"])
    def login():
        configured = store.has_password()
        nxt = _safe_next(request.values.get("next"))
        error = None
        if request.method == "POST":
            ip = client_ip()
            form_csrf = request.form.get("csrf_token", "")
            wait = max(login_limiter.blocked_for(ip), global_login_limiter.blocked_for("*"))
            if not hmac.compare_digest(form_csrf, session.get("login_csrf", "")):
                error = "Your login form expired. Please try again."
            elif wait:
                error = f"Too many failed attempts. Try again in {int(wait // 60) + 1} min."
            elif configured and store.check_password(request.form.get("password", "")):
                login_limiter.reset(ip)
                session.clear()
                session.permanent = True
                session["auth"] = {"epoch": store.session_epoch(), "csrf": secrets.token_urlsafe(32)}
                audit.write(event="login", ip=ip)
                return redirect(nxt)
            else:
                login_limiter.fail(ip)
                global_login_limiter.fail("*")
                audit.write(event="login_failed", ip=ip)
                error = "Incorrect password."
        session["login_csrf"] = secrets.token_urlsafe(32)
        status = 200 if not error else 401
        return render_template("login.html", configured=configured, error=error, next=nxt,
                               login_csrf=session["login_csrf"], public_read=store.public_read()), status

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True})

    @app.get("/api/auth/me")
    def auth_me():
        return jsonify(g.auth)

    @app.get("/api/auth/tokens")
    @require_admin
    def auth_list_tokens():
        return jsonify(store.list_tokens())

    @app.post("/api/auth/tokens")
    @require_admin
    def auth_create_token():
        payload = request.get_json(silent=True) or {}
        try:
            days = payload.get("expiresInDays")
            days = int(days) if days not in (None, "", 0, "0") else None
            if days is not None and not (1 <= days <= 3650):
                raise ValueError("expiresInDays must be between 1 and 3650.")
            token, rec = store.create_token(payload.get("name"), str(payload.get("scope") or "read"), days)
        except (ValueError, TypeError) as e:
            return jsonify({"error": "invalid", "message": str(e)}), 400
        audit.write(event="token_created", actor="browser", ip=client_ip(), token=rec["name"], scope=rec["scope"])
        return jsonify({**rec, "token": token}), 201

    @app.delete("/api/auth/tokens/<token_id>")
    @require_admin
    def auth_revoke_token(token_id):
        if not store.revoke_token(token_id):
            return jsonify({"message": "Not found"}), 404
        return jsonify({"message": "revoked"})

    @app.post("/api/auth/logout-all")
    @require_admin
    def auth_logout_all():
        store.bump_session_epoch()
        session.clear()
        return jsonify({"message": "All browser sessions signed out."})

    @app.get("/api/audit")
    @require_admin
    def audit_tail():
        try:
            limit = max(1, min(500, int(request.args.get("limit", 100))))
        except ValueError:
            limit = 100
        return jsonify(audit.tail(limit))

    return store
