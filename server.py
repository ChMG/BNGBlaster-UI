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
import os
import pathlib
import re
import sys
import threading
import time
from urllib.parse import urlsplit

try:
    from flask import Flask, abort, jsonify, request, send_from_directory, Response
    import requests as req_lib
except ImportError:
    print("Run first: pip install flask requests", file=sys.stderr)
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


def _load_app_version(base_dir: pathlib.Path) -> str:
    version_file = base_dir / "VERSION"
    try:
        value = version_file.read_text(encoding="utf-8").strip()
        return value or "dev"
    except OSError:
        return "dev"


BACKEND_URLS = _parse_backend_urls(os.environ.get("BNGBLASTER_URL", "http://localhost:8001"))
BACKEND_URL = BACKEND_URLS[0]
BASE_DIR = pathlib.Path(__file__).parent
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

_HOP_BY_HOP = frozenset(
    {"connection", "keep-alive", "transfer-encoding", "te",
     "upgrade", "proxy-authorization", "proxy-authenticate",
     "host", "content-encoding"}
)

app = Flask(__name__, static_folder=str(STATIC_DIR))

_STATE_LOCK = threading.Lock()
_CLEANUP_START_LOCK = threading.Lock()
_cleanup_started = False
_VERSION_CACHE_LOCK = threading.Lock()
_version_cache: dict[str, dict] = {
    "controller": {"value": None, "ts": 0.0},
    "blaster": {"value": None, "ts": 0.0},
    "app-ui": {"value": None, "ts": 0.0},
}


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
    result = {
        "backend_url": BACKEND_URL,
        "backend_urls": BACKEND_URLS,
        "multi_backend": len(BACKEND_URLS) > 1,
        "version_check_enabled": VERSION_CHECK_ENABLED,
        "app_version": APP_VERSION,
        "app_version_check_enabled": APP_VERSION_CHECK_ENABLED,
    }

    if APP_VERSION_CHECK_ENABLED:
        latest_app = _get_cached_remote_app_version(APP_VERSION_CHECK_URL)
        result["app_version_status"] = {
            "current": APP_VERSION,
            "latest": latest_app,
            "up_to_date": _is_up_to_date(APP_VERSION, latest_app or ""),
            "source_url": APP_VERSION_CHECK_URL,
        }

    if VERSION_CHECK_ENABLED:
        target = _resolve_selected_target(request.headers.get("X-Bngblaster-Target", ""), strict=True)
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
    start_cleanup_worker()
    print(f"UI:      http://localhost:{port}")
    print(f"Backend: {', '.join(BACKEND_URLS)}  (proxied)")
    print("Stop with Ctrl+C")
    app.run(host="0.0.0.0", port=port, debug=False)
else:
    # Also run under WSGI servers like Gunicorn.
    start_cleanup_worker()
