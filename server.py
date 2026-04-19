#!/usr/bin/env python3
"""
BNG Blaster UI — Flask Web Application
Proxies all /api/ and /metrics to the BNG Blaster Controller.
Manages server-side config templates in ./config-templates/.
Serves the Vue 3 SPA from ./static/.

Usage:
    python3 server.py [port] [backend_url]
Defaults: port=8080, backend=http://localhost:8001
"""

import json
import html
import os
import pathlib
import re
import secrets
import sys
import threading
import time
from urllib.parse import urlencode, urlsplit

try:
    from flask import Flask, abort, jsonify, request, send_from_directory, Response, redirect, session, url_for
    from authlib.integrations.flask_client import OAuth
    import requests as req_lib
except ImportError:
    print("Run first: pip install flask requests Authlib", file=sys.stderr)
    sys.exit(1)

# ─── Config ─────────────────────────────────────────────────────────────────

def _parse_backend_urls(raw: str) -> list[str]:
    items = [part.strip().rstrip("/") for part in (raw or "").split(",") if part.strip()]
    valid = [u for u in items if _is_allowed_backend_url(u)]
    if items and not valid:
        print("Warning: No valid BNGBLASTER_URL entries found; falling back to http://localhost:8001", file=sys.stderr)
    return valid or ["http://localhost:8001"]


def _is_allowed_backend_url(url: str) -> bool:
    """Allowlist backend targets to plain HTTP(S) URLs with a host component."""
    try:
        p = urlsplit(url)
    except Exception:
        return False
    if p.scheme not in {"http", "https"}:
        return False
    if not p.hostname:
        return False
    # Do not allow credentials in backend URLs.
    if p.username or p.password:
        return False
    # Keep target root-only; proxy appends specific paths itself.
    if p.path not in {"", "/"}:
        return False
    if p.query or p.fragment:
        return False
    return True


def _parse_external_http_url(raw: str) -> str:
    """Validate optional external URL for UI links (http/https, no credentials)."""
    value = (raw or "").strip()
    if not value:
        return ""
    try:
        p = urlsplit(value)
    except Exception:
        return ""
    if p.scheme not in {"http", "https"}:
        return ""
    if not p.hostname:
        return ""
    if p.username or p.password:
        return ""
    return value


def _is_truthy(raw: str, default: bool = False) -> bool:
    if raw is None:
        return default
    return str(raw).strip() not in {"", "0", "false", "False", "no", "NO", "off", "OFF"}


def _safe_next_path(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return "/"
    p = urlsplit(value)
    # Prevent open redirects to other hosts/schemes.
    if p.scheme or p.netloc:
        return "/"
    return value if value.startswith("/") else f"/{value}"


def _parse_csv_set(raw: str) -> set[str]:
    return {part.strip() for part in (raw or "").split(",") if part.strip()}


def _normalize_csv_input(raw) -> str:
    if raw is None:
        return ""
    if isinstance(raw, list):
        return ",".join(str(part).strip() for part in raw if str(part).strip())
    return str(raw)


def _extract_claim_value(payload: dict, claim_path: str):
    current = payload
    for part in (claim_path or "").split("."):
        key = part.strip()
        if not key:
            continue
        if not isinstance(current, dict) or key not in current:
            return None
        current = current.get(key)
    return current


def _load_app_version(base_dir: pathlib.Path) -> str:
    version_file = base_dir / "VERSION"
    try:
        value = version_file.read_text(encoding="utf-8").strip()
        return value or "dev"
    except OSError:
        return "dev"


def _load_json_config(path: pathlib.Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
        print(f"Warning: {path.name} must contain a JSON object; ignoring file", file=sys.stderr)
        return {}
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: failed to read {path.name}: {exc}", file=sys.stderr)
        return {}


def _parse_backends_from_config(raw) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return result

    for item in raw:
        if not isinstance(item, dict):
            continue
        controller = str(item.get("controller", "") or "").strip().rstrip("/")
        if not _is_allowed_backend_url(controller):
            continue
        grafana = _parse_external_http_url(item.get("grafana", ""))
        result.append({"controller": controller, "grafana": grafana})

    if raw and not result:
        print("Warning: No valid controller entries found in config.json:bngblaster", file=sys.stderr)
    return result


BASE_DIR = pathlib.Path(__file__).parent
_config_file_raw = (os.environ.get("CONFIG_FILE", "") or "").strip()
if _config_file_raw:
    _config_path = pathlib.Path(_config_file_raw)
    CONFIG_FILE = _config_path if _config_path.is_absolute() else (BASE_DIR / _config_path)
else:
    CONFIG_FILE = BASE_DIR / "config.json"
RUNTIME_CONFIG = _load_json_config(CONFIG_FILE)

_configured_backends = _parse_backends_from_config(RUNTIME_CONFIG.get("bngblaster"))
if _configured_backends:
    BACKEND_URLS = [entry["controller"] for entry in _configured_backends]
    BACKEND_GRAFANA_URLS = {entry["controller"]: entry["grafana"] for entry in _configured_backends}
else:
    BACKEND_URLS = _parse_backend_urls(os.environ.get("BNGBLASTER_URL", "http://localhost:8001"))
    _fallback_grafana = _parse_external_http_url(os.environ.get("METRIC_GRAFANA_URL", ""))
    BACKEND_GRAFANA_URLS = {url: _fallback_grafana for url in BACKEND_URLS}

BACKEND_URL = BACKEND_URLS[0]
TEMPLATES_DIR = BASE_DIR / "config-templates"
STATE_DIR = BASE_DIR / "state"
START_OPTIONS_FILE = STATE_DIR / "instance-start-options.json"
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR.mkdir(exist_ok=True)
STATE_DIR.mkdir(exist_ok=True)

START_OPTIONS_CLEANUP_ENABLED = os.environ.get("START_OPTIONS_CLEANUP_ENABLED", "1") not in {"0", "false", "False", "no", "NO"}
START_OPTIONS_CLEANUP_INTERVAL_SEC = max(30, int(os.environ.get("START_OPTIONS_CLEANUP_INTERVAL_SEC", "300")))
VERSION_CHECK_ENABLED = os.environ.get("VERSION_CHECK_ENABLED", "1") not in {"0", "false", "False", "no", "NO"}
VERSION_CHECK_CACHE_SEC = max(60, int(os.environ.get("VERSION_CHECK_CACHE_SEC", "3600")))
APP_VERSION = _load_app_version(BASE_DIR)
APP_VERSION_CHECK_ENABLED = os.environ.get("APP_VERSION_CHECK_ENABLED", "1") not in {"0", "false", "False", "no", "NO"}
APP_VERSION_CHECK_CACHE_SEC = max(60, int(os.environ.get("APP_VERSION_CHECK_CACHE_SEC", str(VERSION_CHECK_CACHE_SEC))))
APP_VERSION_CHECK_URL = os.environ.get(
    "APP_VERSION_CHECK_URL",
    "https://github.com/ChMG/BNGBlaster-UI/blob/main/VERSION",
)

_oidc_cfg = RUNTIME_CONFIG.get("oidc") if isinstance(RUNTIME_CONFIG.get("oidc"), dict) else {}
if "enabled" in _oidc_cfg:
    _oidc_enabled_raw = _oidc_cfg.get("enabled")
elif _oidc_cfg:
    _oidc_enabled_raw = True
else:
    _oidc_enabled_raw = os.environ.get("OIDC_ENABLED", "0")
OIDC_ENABLED = _oidc_enabled_raw if isinstance(_oidc_enabled_raw, bool) else _is_truthy(_oidc_enabled_raw, default=False)
OIDC_ISSUER_URL = str(_oidc_cfg.get("issuer_url", os.environ.get("OIDC_ISSUER_URL", "")) or "").strip().rstrip("/")
OIDC_CLIENT_ID = str(_oidc_cfg.get("client_id", os.environ.get("OIDC_CLIENT_ID", "")) or "").strip()
OIDC_CLIENT_SECRET = str(_oidc_cfg.get("client_secret", os.environ.get("OIDC_CLIENT_SECRET", "")) or "").strip()
OIDC_SCOPES = str(_oidc_cfg.get("scopes", os.environ.get("OIDC_SCOPES", "openid profile email")) or "openid profile email").strip()
OIDC_REDIRECT_URI = str(_oidc_cfg.get("redirect_uri", os.environ.get("OIDC_REDIRECT_URI", "")) or "").strip()
OIDC_POST_LOGOUT_REDIRECT_URI = str(
    _oidc_cfg.get("post_logout_redirect_uri", os.environ.get("OIDC_POST_LOGOUT_REDIRECT_URI", "")) or ""
).strip()
OIDC_GROUPS_CLAIM = str(_oidc_cfg.get("groups_claim", os.environ.get("OIDC_GROUPS_CLAIM", "groups")) or "groups").strip()
OIDC_ALLOWED_GROUPS = _parse_csv_set(
    _normalize_csv_input(_oidc_cfg.get("allowed_groups", os.environ.get("OIDC_ALLOWED_GROUPS", "")))
)
APP_SECRET_KEY = str(
    _oidc_cfg.get("app_secret_key", RUNTIME_CONFIG.get("app_secret_key", os.environ.get("APP_SECRET_KEY", ""))) or ""
).strip()

_HOP_BY_HOP = frozenset(
    {"connection", "keep-alive", "transfer-encoding", "te",
     "upgrade", "proxy-authorization", "proxy-authenticate",
     "host", "content-encoding"}
)

app = Flask(__name__, static_folder=str(STATIC_DIR))
app.secret_key = APP_SECRET_KEY or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)

if OIDC_ENABLED and (not OIDC_ISSUER_URL or not OIDC_CLIENT_ID):
    raise RuntimeError("OIDC is enabled, but OIDC_ISSUER_URL and OIDC_CLIENT_ID are not fully configured.")

oauth = OAuth(app)
oidc_client = None
if OIDC_ENABLED:
    register_kwargs = {
        "name": "oidc",
        "client_id": OIDC_CLIENT_ID,
        "server_metadata_url": f"{OIDC_ISSUER_URL}/.well-known/openid-configuration",
        "client_kwargs": {"scope": OIDC_SCOPES},
    }
    if OIDC_CLIENT_SECRET:
        register_kwargs["client_secret"] = OIDC_CLIENT_SECRET
    oidc_client = oauth.register(**register_kwargs)

_STATE_LOCK = threading.Lock()
_CLEANUP_START_LOCK = threading.Lock()
_cleanup_started = False
_VERSION_CACHE_LOCK = threading.Lock()
_version_cache: dict[str, dict] = {
    "controller": {"value": None, "ts": 0.0},
    "blaster": {"value": None, "ts": 0.0},
    "app-ui": {"value": None, "ts": 0.0},
}


def _oidc_is_authenticated() -> bool:
    if not OIDC_ENABLED:
        return True
    return bool(session.get("oidc_authenticated"))


def _request_next_path() -> str:
    qs = request.query_string.decode("utf-8", errors="replace") if request.query_string else ""
    return f"{request.path}?{qs}" if qs else request.path


def _build_login_url(next_path: str | None = None) -> str:
    target = _safe_next_path(next_path or "/")
    return f"/ui-api/auth/login?{urlencode({'next': target})}"


def _oidc_redirect_uri() -> str:
    if OIDC_REDIRECT_URI:
        return OIDC_REDIRECT_URI
    return url_for("oidc_callback", _external=True)


def _oidc_post_logout_redirect_uri() -> str:
    if OIDC_POST_LOGOUT_REDIRECT_URI:
        return OIDC_POST_LOGOUT_REDIRECT_URI
    return url_for("serve_spa", path="", _external=True)


def _oidc_extract_groups(userinfo: dict) -> set[str]:
    if not isinstance(userinfo, dict):
        return set()
    raw_groups = _extract_claim_value(userinfo, OIDC_GROUPS_CLAIM)
    if raw_groups is None:
        return set()
    if isinstance(raw_groups, str):
        return {raw_groups}
    if isinstance(raw_groups, list):
        return {str(v) for v in raw_groups if isinstance(v, (str, int, float))}
    if isinstance(raw_groups, (int, float)):
        return {str(raw_groups)}
    return set()


def _oidc_group_allowed(user_groups: set[str]) -> bool:
    if not OIDC_ALLOWED_GROUPS:
        return True
    return bool(user_groups & OIDC_ALLOWED_GROUPS)


def _is_public_path(path: str) -> bool:
    if path.startswith("/ui-api/auth/"):
        return True
    if path in {"/favicon.ico", "/favicon.svg", "/theme.css"}:
        return True
    if path.startswith("/vendor/"):
        return True
    return False


def _render_auth_error_page(title: str, message: str, details: list[str] | None = None, status: int = 403):
        details_html = ""
        if details:
                items = "".join(
                        f"<li class=\"text-sm text-base-content/70 mono break-all\">{html.escape(item)}</li>"
                        for item in details
                        if item
                )
                if items:
                        details_html = f"""
                        <div class=\"mt-4\">
                            <p class=\"text-xs uppercase tracking-wider text-base-content/50\">Debug Details</p>
                            <ul class=\"mt-2 space-y-1\">{items}</ul>
                        </div>
                        """

        page = f"""<!doctype html>
<html lang=\"en\" data-theme=\"light\">
    <head>
        <meta charset=\"UTF-8\" />
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
        <title>{html.escape(title)} - BNG Blaster Controller UI</title>
        <link rel=\"icon\" type=\"image/x-icon\" href=\"/favicon.ico\" sizes=\"any\" />
        <link rel=\"icon\" type=\"image/svg+xml\" href=\"/favicon.svg\" />
        <link rel=\"shortcut icon\" href=\"/favicon.ico\" />
        <link href=\"/vendor/daisyui-full.min.css\" rel=\"stylesheet\" />
        <script src=\"/vendor/tailwindcss-cdn.js?v=2\"></script>
        <link href=\"/theme.css\" rel=\"stylesheet\" />
    </head>
    <body class=\"page-bg text-base-content min-h-screen\">
        <main class=\"min-h-screen flex items-center justify-center p-4\">
            <section class=\"w-full max-w-2xl card bg-base-200 border border-base-300 shadow-lg\">
                <div class=\"card-body\">
                    <div class=\"badge badge-warning text-xs\">Authentication</div>
                    <h1 class=\"card-title text-2xl mt-2\">{html.escape(title)}</h1>
                    <p class=\"text-base text-base-content/70 mt-1\">{html.escape(message)}</p>
                    {details_html}
                    <div class=\"card-actions justify-end mt-6\">
                        <a class=\"btn btn-primary\" href=\"/ui-api/auth/login?next=/&prompt=login\">Try Login Again</a>
                    </div>
                </div>
            </section>
        </main>
    </body>
</html>
"""
        return Response(page, status=status, mimetype="text/html")


@app.before_request
def require_authentication_if_enabled():
    if not OIDC_ENABLED:
        return None

    path = request.path or "/"
    if _is_public_path(path):
        return None

    if _oidc_is_authenticated():
        return None

    login_url = _build_login_url(_request_next_path())
    if path.startswith("/api/") or path == "/metrics" or path.startswith("/ui-api/"):
        return jsonify({"error": "authentication required", "login_url": login_url}), 401
    return redirect(login_url)


# ─── Proxy ──────────────────────────────────────────────────────────────────

def _proxy(path: str) -> Response:
    target = _resolve_selected_target(request.headers.get("X-Bngblaster-Target", ""), strict=True)
    if target is None:
        return Response("Invalid X-Bngblaster-Target", status=400, mimetype="text/plain")

    url = target + path
    if request.query_string:
        url += "?" + request.query_string.decode("utf-8", errors="replace")

    fwd_headers = {k: v for k, v in request.headers if k.lower() not in _HOP_BY_HOP}

    try:
        up = req_lib.request(
            method=request.method,
            url=url,
            headers=fwd_headers,
            data=request.get_data(cache=False),
            timeout=30,
            allow_redirects=False,
            stream=True,
        )
    except req_lib.exceptions.ConnectionError:
        return Response("Backend not reachable", status=502, mimetype="text/plain")
    except req_lib.exceptions.Timeout:
        return Response("Backend timeout", status=504, mimetype="text/plain")

    resp_headers = {k: v for k, v in up.headers.items() if k.lower() not in _HOP_BY_HOP}
    return Response(up.content, status=up.status_code, headers=resp_headers)


def _resolve_selected_target(selected: str, strict: bool = False) -> str | None:
    selected = (selected or "").strip()
    target = BACKEND_URL
    if selected:
        if selected.isdigit():
            idx = int(selected)
            if 0 <= idx < len(BACKEND_URLS):
                target = BACKEND_URLS[idx]
            elif strict:
                return None
        elif selected in BACKEND_URLS:
            target = selected
        elif strict:
            return None
    return target


@app.route("/metrics", methods=["GET"])
def proxy_metrics():
    return _proxy("/metrics")


@app.route("/api/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
def proxy_api(path: str):
    return _proxy(f"/api/{path}")


# ─── Templates API ───────────────────────────────────────────────────────────

_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _resolve_template(name: str) -> pathlib.Path:
    if not _NAME_RE.match(name):
        abort(400, description="Invalid template name")
    candidate = (TEMPLATES_DIR / name).with_suffix(".json")
    # Ensure path stays inside TEMPLATES_DIR (path traversal guard)
    try:
        candidate.relative_to(TEMPLATES_DIR)
    except ValueError:
        abort(400, description="Invalid template name")
    return candidate


def _load_start_options() -> dict:
    if not START_OPTIONS_FILE.exists():
        return {}
    try:
        raw = json.loads(START_OPTIONS_FILE.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_start_options(data: dict) -> None:
    START_OPTIONS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _fetch_backend_instances(target: str) -> set[str] | None:
    """Return set of instance names for a backend URL, or None if backend is unreachable."""
    try:
        r = req_lib.get(f"{target}/api/v1/instances", timeout=10)
        if not r.ok:
            return None
        payload = r.json()
        if not isinstance(payload, list):
            return None
        return {name for name in payload if isinstance(name, str)}
    except Exception:
        return None


def cleanup_orphan_start_options_once() -> int:
    """Remove stored start-options entries for instances that no longer exist."""
    data = _load_start_options()
    if not data:
        return 0

    backend_instances: dict[str, set[str]] = {}
    for target in BACKEND_URLS:
        names = _fetch_backend_instances(target)
        if names is not None:
            backend_instances[target] = names

    # If no backend responded successfully, do nothing (safe default).
    if not backend_instances:
        return 0

    removed = 0
    keys_to_delete: list[str] = []

    for key in list(data.keys()):
        if "::" in key:
            target, instance_name = key.split("::", 1)
            # Only evaluate keys for backends that responded; skip unreachable backends.
            if target in backend_instances and instance_name not in backend_instances[target]:
                keys_to_delete.append(key)
        elif len(BACKEND_URLS) <= 1:
            # Legacy single-backend keys: only safe to clean in single-backend mode.
            target = BACKEND_URLS[0]
            names = backend_instances.get(target)
            if names is not None and key not in names:
                keys_to_delete.append(key)

    for key in keys_to_delete:
        if key in data:
            del data[key]
            removed += 1

    if removed:
        _save_start_options(data)
    return removed


def _cleanup_worker_loop() -> None:
    while True:
        try:
            with _STATE_LOCK:
                removed = cleanup_orphan_start_options_once()
            if removed:
                app.logger.info("Start-options cleanup removed %s orphan entries", removed)
        except Exception as exc:
            app.logger.warning("Start-options cleanup failed: %s", exc)
        time.sleep(START_OPTIONS_CLEANUP_INTERVAL_SEC)


def start_cleanup_worker() -> None:
    global _cleanup_started
    if not START_OPTIONS_CLEANUP_ENABLED:
        return
    with _CLEANUP_START_LOCK:
        if _cleanup_started:
            return
        thread = threading.Thread(target=_cleanup_worker_loop, name="start-options-cleanup", daemon=True)
        thread.start()
        _cleanup_started = True


def _start_options_key(instance_name: str) -> str:
    target = _resolve_selected_target(request.headers.get("X-Bngblaster-Target", ""), strict=True)
    if target is None:
        abort(400, description="Invalid X-Bngblaster-Target")
    return f"{target}::{instance_name}"


def _parse_version_tuple(raw: str) -> tuple[int, ...]:
    if not raw:
        return tuple()
    # Accept versions like v1.2.3, 1.2.3-rc1, 1.2
    nums = [int(p) for p in re.findall(r"\d+", str(raw))]
    return tuple(nums)


def _is_up_to_date(current: str, latest: str) -> bool | None:
    cur_t = _parse_version_tuple(current)
    lat_t = _parse_version_tuple(latest)
    if not cur_t or not lat_t:
        return None
    return cur_t >= lat_t


def _fetch_latest_release_tag(repo: str) -> str | None:
    try:
        r = req_lib.get(
            f"https://api.github.com/repos/{repo}/releases/latest",
            headers={"Accept": "application/vnd.github+json"},
            timeout=10,
        )
        if not r.ok:
            return None
        payload = r.json()
        tag = payload.get("tag_name")
        return str(tag) if tag else None
    except Exception:
        return None


def _get_cached_latest_release(which: str, repo: str) -> str | None:
    now = time.time()
    with _VERSION_CACHE_LOCK:
        slot = _version_cache.get(which, {"value": None, "ts": 0.0})
        if now - float(slot.get("ts", 0.0)) < VERSION_CHECK_CACHE_SEC:
            return slot.get("value")

    fresh = _fetch_latest_release_tag(repo)
    with _VERSION_CACHE_LOCK:
        _version_cache[which] = {"value": fresh, "ts": now}
    return fresh


def _github_blob_to_raw_url(url: str) -> str:
    m = re.match(r"^https://github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$", (url or "").strip())
    if not m:
        return url
    owner, repo, ref, path = m.group(1), m.group(2), m.group(3), m.group(4)
    return f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}"


def _fetch_remote_app_version(url: str) -> str | None:
    try:
        raw_url = _github_blob_to_raw_url(url)
        r = req_lib.get(raw_url, timeout=10)
        if not r.ok:
            return None
        line = (r.text or "").strip().splitlines()
        if not line:
            return None
        value = line[0].strip()
        return value or None
    except Exception:
        return None


def _get_cached_remote_app_version(url: str) -> str | None:
    now = time.time()
    with _VERSION_CACHE_LOCK:
        slot = _version_cache.get("app-ui", {"value": None, "ts": 0.0})
        if now - float(slot.get("ts", 0.0)) < APP_VERSION_CHECK_CACHE_SEC:
            return slot.get("value")

    fresh = _fetch_remote_app_version(url)
    with _VERSION_CACHE_LOCK:
        _version_cache["app-ui"] = {"value": fresh, "ts": now}
    return fresh


def _fetch_current_backend_versions(target: str) -> tuple[str | None, str | None]:
    try:
        r = req_lib.get(f"{target}/api/v1/version", timeout=10)
        if not r.ok:
            return None, None
        data = r.json()
        if not isinstance(data, dict):
            return None, None
        ctrl = data.get("bngblasterctrl-version") or data.get("controller-version")
        blaster = data.get("bngblaster-version") or data.get("blaster-version")
        return (str(ctrl) if ctrl else None, str(blaster) if blaster else None)
    except Exception:
        return None, None


def _backend_request(target: str, method: str, path: str, body: dict | None = None) -> req_lib.Response | None:
    try:
        return req_lib.request(
            method=method,
            url=f"{target}{path}",
            json=body,
            timeout=30,
            allow_redirects=False,
        )
    except Exception:
        return None


def _backend_instance_status(target: str, name: str) -> str | None:
    r = _backend_request(target, "GET", f"/api/v1/instances/{name}")
    if r is None or not r.ok:
        return None
    try:
        data = r.json()
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    status = data.get("status")
    return str(status) if status else None


def _wait_for_status(target: str, name: str, desired: str, attempts: int = 20, delay_sec: float = 0.35) -> bool:
    for _ in range(attempts):
        s = _backend_instance_status(target, name)
        if s == desired:
            return True
        time.sleep(delay_sec)
    return False


def _get_saved_start_options_for_target(target: str, name: str) -> dict:
    key = f"{target}::{name}"
    with _STATE_LOCK:
        data = _load_start_options()
    value = data.get(key)
    if isinstance(value, dict):
        return value
    # Legacy fallback in single-backend mode.
    if len(BACKEND_URLS) <= 1 and isinstance(data.get(name), dict):
        return data.get(name)
    return {}


@app.route("/ui-api/templates", methods=["GET"])
def list_templates():
    result = []
    for f in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
            preview = json.dumps(raw, separators=(",", ":"))[:160]
        except (json.JSONDecodeError, OSError):
            preview = "(unreadable)"
        result.append({"name": f.stem, "preview": preview})
    return jsonify(result)


@app.route("/ui-api/templates/<name>", methods=["GET"])
def get_template(name: str):
    path = _resolve_template(name)
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    return Response(path.read_text(encoding="utf-8"), status=200, mimetype="application/json")


@app.route("/ui-api/templates/<name>", methods=["PUT"])
def put_template(name: str):
    path = _resolve_template(name)
    body = request.get_json(force=True, silent=True)
    if body is None:
        return jsonify({"error": "body must be valid JSON"}), 400
    path.write_text(json.dumps(body, indent=2, ensure_ascii=False), encoding="utf-8")
    return jsonify({"ok": True})


@app.route("/ui-api/templates/<name>", methods=["DELETE"])
def delete_template(name: str):
    path = _resolve_template(name)
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return jsonify({"ok": True})


@app.route("/ui-api/backend-info", methods=["GET"])
def backend_info():
    target = _resolve_selected_target(request.headers.get("X-Bngblaster-Target", ""), strict=True)
    metric_grafana_url = BACKEND_GRAFANA_URLS.get(target or BACKEND_URL, "")

    result = {
        "backend_url": BACKEND_URL,
        "backend_urls": BACKEND_URLS,
        "multi_backend": len(BACKEND_URLS) > 1,
        "version_check_enabled": VERSION_CHECK_ENABLED,
        "app_version": APP_VERSION,
        "app_version_check_enabled": APP_VERSION_CHECK_ENABLED,
        "metric_grafana_url": metric_grafana_url,
        "oidc_enabled": OIDC_ENABLED,
        "oidc_authenticated": _oidc_is_authenticated(),
        "oidc_groups_claim": OIDC_GROUPS_CLAIM,
        "oidc_allowed_groups": sorted(OIDC_ALLOWED_GROUPS),
    }
    if OIDC_ENABLED:
        result["oidc_user"] = session.get("oidc_user", {})

    if APP_VERSION_CHECK_ENABLED:
        latest_app = _get_cached_remote_app_version(APP_VERSION_CHECK_URL)
        result["app_version_status"] = {
            "current": APP_VERSION,
            "latest": latest_app,
            "up_to_date": _is_up_to_date(APP_VERSION, latest_app or ""),
            "source_url": APP_VERSION_CHECK_URL,
        }

    if VERSION_CHECK_ENABLED:
        if target is not None:
            current_ctrl, current_blaster = _fetch_current_backend_versions(target)
            latest_ctrl = _get_cached_latest_release("controller", "rtbrick/bngblaster-controller")
            latest_blaster = _get_cached_latest_release("blaster", "rtbrick/bngblaster")

            result["version_status"] = {
                "controller": {
                    "current": current_ctrl,
                    "latest": latest_ctrl,
                    "up_to_date": _is_up_to_date(current_ctrl or "", latest_ctrl or ""),
                    "release_url": "https://github.com/rtbrick/bngblaster-controller/releases",
                },
                "blaster": {
                    "current": current_blaster,
                    "latest": latest_blaster,
                    "up_to_date": _is_up_to_date(current_blaster or "", latest_blaster or ""),
                    "release_url": "https://github.com/rtbrick/bngblaster/releases",
                },
            }

    return jsonify(result)


@app.route("/ui-api/auth/status", methods=["GET"])
def oidc_status():
    return jsonify(
        {
            "enabled": OIDC_ENABLED,
            "authenticated": _oidc_is_authenticated(),
            "user": session.get("oidc_user", {}) if OIDC_ENABLED else {},
            "groups_claim": OIDC_GROUPS_CLAIM,
            "allowed_groups": sorted(OIDC_ALLOWED_GROUPS),
            "login_url": _build_login_url("/"),
            "logout_url": "/ui-api/auth/logout",
        }
    )


@app.route("/ui-api/auth/login", methods=["GET"])
def oidc_login():
    if not OIDC_ENABLED:
        return jsonify({"error": "OIDC is not enabled"}), 404
    if oidc_client is None:
        return jsonify({"error": "OIDC client not initialized"}), 500

    next_path = _safe_next_path(request.args.get("next", "/"))
    session["oidc_next"] = next_path
    prompt = (request.args.get("prompt", "") or "").strip()
    if prompt:
        return oidc_client.authorize_redirect(_oidc_redirect_uri(), prompt=prompt)
    return oidc_client.authorize_redirect(_oidc_redirect_uri())


@app.route("/ui-api/auth/callback", methods=["GET"])
def oidc_callback():
    if not OIDC_ENABLED:
        return jsonify({"error": "OIDC is not enabled"}), 404
    if oidc_client is None:
        return jsonify({"error": "OIDC client not initialized"}), 500

    try:
        token = oidc_client.authorize_access_token()
        userinfo = token.get("userinfo") if isinstance(token, dict) else None
        if not isinstance(userinfo, dict):
            # Fall back to UserInfo endpoint if available.
            userinfo = oidc_client.userinfo(token=token)
            if not isinstance(userinfo, dict):
                userinfo = {}

        app.logger.debug(
            "OIDC userinfo claims: %s",
            {k: v for k, v in userinfo.items()},
        )
        user_groups = _oidc_extract_groups(userinfo)
        app.logger.debug(
            "OIDC group check — extracted groups: %r  allowed: %r  claim: %r",
            sorted(user_groups),
            sorted(OIDC_ALLOWED_GROUPS),
            OIDC_GROUPS_CLAIM,
        )
        if not _oidc_group_allowed(user_groups):
            session.clear()
            return _render_auth_error_page(
                title="Access Denied",
                message="Your account is authenticated, but not assigned to an allowed group.",
                details=[
                    f"Your groups: {sorted(user_groups)}",
                    f"Allowed groups: {sorted(OIDC_ALLOWED_GROUPS)}",
                    f"Groups claim used: {OIDC_GROUPS_CLAIM!r}",
                    f"Available claims in userinfo: {sorted(userinfo.keys()) if isinstance(userinfo, dict) else []}",
                ],
                status=403,
            )

        session["oidc_authenticated"] = True
        session["oidc_user"] = {
            "sub": userinfo.get("sub"),
            "name": userinfo.get("name") or userinfo.get("preferred_username") or userinfo.get("email") or "user",
            "email": userinfo.get("email", ""),
            "preferred_username": userinfo.get("preferred_username", ""),
            "groups": sorted(user_groups),
        }
        if isinstance(token, dict) and token.get("id_token"):
            session["oidc_id_token"] = token.get("id_token")
    except Exception as exc:
        return jsonify({"error": f"oidc callback failed: {exc}"}), 401

    return redirect(_safe_next_path(session.pop("oidc_next", "/")))


@app.route("/ui-api/auth/logout", methods=["GET"])
def oidc_logout():
    if not OIDC_ENABLED:
        return redirect("/")

    id_token_hint = session.get("oidc_id_token")
    session.clear()

    if oidc_client is not None:
        try:
            metadata = oidc_client.load_server_metadata()
            end_session_endpoint = metadata.get("end_session_endpoint") if isinstance(metadata, dict) else None
            if end_session_endpoint:
                params = {"post_logout_redirect_uri": _oidc_post_logout_redirect_uri()}
                if id_token_hint:
                    params["id_token_hint"] = id_token_hint
                return redirect(f"{end_session_endpoint}?{urlencode(params)}")
        except Exception:
            pass

    return redirect(_oidc_post_logout_redirect_uri())


@app.route("/ui-api/instance-start-options/<name>", methods=["GET"])
def get_instance_start_options(name: str):
    with _STATE_LOCK:
        data = _load_start_options()

    # New format: backend-target namespaced key to avoid collisions across backends.
    key = _start_options_key(name)
    value = data.get(key)

    # Legacy fallback (single-backend only): keep backward compatibility for existing data.
    if not isinstance(value, dict) and len(BACKEND_URLS) <= 1:
        value = data.get(name)

    if not isinstance(value, dict):
        return jsonify({}), 200
    return jsonify(value), 200


@app.route("/ui-api/instance-start-options/<name>", methods=["PUT"])
def put_instance_start_options(name: str):
    body = request.get_json(force=True, silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "body must be valid JSON object"}), 400

    allowed = {"logging", "logging_flags", "metric_flags", "report", "report_flags", "pcap", "session_count"}
    cleaned = {k: v for k, v in body.items() if k in allowed}

    with _STATE_LOCK:
        data = _load_start_options()
        data[_start_options_key(name)] = cleaned
        _save_start_options(data)
    return jsonify({"ok": True})


@app.route("/ui-api/instance-start-options/<name>", methods=["DELETE"])
def delete_instance_start_options(name: str):
    with _STATE_LOCK:
        data = _load_start_options()

        changed = False
        key = _start_options_key(name)
        if key in data:
            del data[key]
            changed = True

        # Legacy cleanup only in single-backend setups.
        if len(BACKEND_URLS) <= 1 and name in data:
            del data[name]
            changed = True

        if changed:
            _save_start_options(data)
    return jsonify({"ok": True})


@app.route("/ui-api/instance-start-options/_cleanup", methods=["POST"])
def cleanup_instance_start_options():
    with _STATE_LOCK:
        removed = cleanup_orphan_start_options_once()
    return jsonify({"ok": True, "removed": removed})


@app.route("/ui-api/instances/<name>/reconfigure", methods=["PUT"])
def reconfigure_instance(name: str):
    target = _resolve_selected_target(request.headers.get("X-Bngblaster-Target", ""), strict=True)
    if target is None:
        return jsonify({"error": "Invalid X-Bngblaster-Target"}), 400

    body = request.get_json(force=True, silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "body must be valid JSON object"}), 400

    status = _backend_instance_status(target, name)
    if status is None:
        return jsonify({"error": "instance status unavailable"}), 502

    # Stop first if running.
    if status == "started":
        r_stop = _backend_request(target, "POST", f"/api/v1/instances/{name}/_stop")
        if r_stop is None or not r_stop.ok:
            msg = r_stop.text if r_stop is not None else "backend not reachable"
            code = r_stop.status_code if r_stop is not None else 502
            return jsonify({"error": f"stop failed: {msg}"}), code
        if not _wait_for_status(target, name, "stopped"):
            return jsonify({"error": "timeout waiting for instance to stop"}), 504

    # Apply new config.
    r_put = _backend_request(target, "PUT", f"/api/v1/instances/{name}", body)
    if r_put is None or not r_put.ok:
        msg = r_put.text if r_put is not None else "backend not reachable"
        code = r_put.status_code if r_put is not None else 502
        return jsonify({"error": f"config apply failed: {msg}"}), code

    # Restart with saved params (or empty object if none).
    start_body = _get_saved_start_options_for_target(target, name)
    r_start = _backend_request(target, "POST", f"/api/v1/instances/{name}/_start", start_body)
    if r_start is None or not r_start.ok:
        msg = r_start.text if r_start is not None else "backend not reachable"
        code = r_start.status_code if r_start is not None else 502
        return jsonify({"error": f"start failed: {msg}"}), code

    if not _wait_for_status(target, name, "started"):
        return jsonify({"error": "timeout waiting for instance to start"}), 504

    return jsonify({"ok": True, "used_start_options": start_body})


# ─── SPA fallback ────────────────────────────────────────────────────────────

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path: str):
    candidate = STATIC_DIR / path
    if path and candidate.is_file():
        return send_from_directory(str(STATIC_DIR), path)
    return send_from_directory(str(STATIC_DIR), "index.html")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if len(sys.argv) > 2:
        BACKEND_URLS = _parse_backend_urls(sys.argv[2])
        BACKEND_URL = BACKEND_URLS[0]
        BACKEND_GRAFANA_URLS = {url: "" for url in BACKEND_URLS}
    start_cleanup_worker()
    app.logger.setLevel("DEBUG")
    print(f"UI:      http://localhost:{port}")
    print(f"Backend: {', '.join(BACKEND_URLS)}  (proxied)")
    print("Stop with Ctrl+C")
    app.run(host="0.0.0.0", port=port, debug=False)
else:
    # Also run under WSGI servers like Gunicorn.
    start_cleanup_worker()
