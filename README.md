# BNG Blaster UI

Python-based web application for the BNG Blaster Controller with a modern single-page UI.

> Note: This application was largely generated with AI support. Please review and test all functionality before production use.

## Features

- Instances as a table with automatically updated status
- Start, stop, kill, delete, create, and edit actions for instances
- **Server-side configuration templates with interface variable substitution** ($IF1, $IF2, ...)
- Metrics page for Prometheus text format
- Technical API explorer based on the OpenAPI file
- Command dialog and file downloads per instance
- Stop-apply-restart workflow for updating running instances' configuration
- Restart-after-edit reuses last start options per instance (persisted server-side)
- Manual start dialog pre-fills last saved start options per instance
- Deleting an instance also removes its saved start options from server state
- In multi-backend mode, saved start options are namespaced per backend target and instance name
- Orphaned start-option entries are cleaned up periodically server-side if instances were deleted outside the UI

## Project Structure

- `server.py`: Flask entry point, API/metrics proxy, templates API, SPA file serving
- `gunicorn.conf.py`: Gunicorn runtime settings (bind, workers, threads, timeouts, logs)
- `requirements.txt`: Python dependencies
- `config-templates/`: persisted server-side JSON templates
- `state/`: persisted server-side runtime state (e.g. per-instance last start options)
- `static/index.html`: SPA shell and global UI styles
- `static/js/app.js`: Vue app bootstrap, router, sidebar layout
- `static/js/api.js`: shared HTTP client, poller helper, Prometheus parser
- `static/js/pages/instances.js`: instance lifecycle + session management UI
- `static/js/pages/interfaces.js`: interfaces overview page
- `static/js/pages/metrics.js`: metrics dashboard
- `static/js/pages/templates.js`: templates CRUD + apply to instance
- `static/js/pages/explorer.js`: OpenAPI endpoint explorer
- `static/bngblaster-controler-swagger.yaml`: OpenAPI spec consumed by explorer
- `static/ui-api-swagger.yaml`: OpenAPI spec for internal `/ui-api/*` endpoints
- `static/vendor/`: vendored frontend runtime dependencies
- `.vscode/launch.json`: VS Code debug configurations
- `STYLE_GUIDE.md`: theming and rebranding guide (token-based color customization)

## Local Development with WSL (Ubuntu 24.04)

For local development on Windows, use WSL2 with Ubuntu 24.04.

Install guides for required backend components:

- BNG Blaster installation: https://rtbrick.github.io/bngblaster/install.html
- BNG Blaster Controller installation: https://rtbrick.github.io/bngblaster/controller.html#installation

### Create Virtual Test Interfaces in WSL

The following example creates a Linux bridge plus two veth pairs that can be used for BNG Blaster tests:

```bash
sudo ip link add br0 type bridge
sudo ip link set br0 up
sudo ip link add vethA type veth peer name vethA-peer
sudo ip link add vethB type veth peer name vethB-peer
sudo ip link set vethA-peer master br0
sudo ip link set vethB-peer master br0
sudo ip link set vethA up
sudo ip link set vethA-peer up
sudo ip link set vethB up
sudo ip link set vethB-peer up
sudo sysctl -w net.ipv6.conf.br0.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethA.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethA-peer.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethB.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethB-peer.disable_ipv6=1
```

Notes:

- Re-run this setup after WSL restart/reboot if interfaces are missing.
- Verify with `ip link show` and use the created names in your BNG Blaster config.

## Start

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the server:

```bash
python3 server.py
```

Run with Gunicorn (recommended for non-debug usage):

```bash
BNGBLASTER_URL=http://localhost:8001 gunicorn -c gunicorn.conf.py server:app
```

Run with Docker Compose:

```bash
docker compose up --build -d
```

Show container logs:

```bash
docker compose logs -f bngblaster-ui
```

Check health status:

```bash
docker compose ps
```

Optional (custom backend URL):

```bash
BNGBLASTER_URL=http://your-backend:8001 docker compose up --build -d
```

Multi-backend mode (comma-separated list):

```bash
BNGBLASTER_URL=http://bng1:8001,http://bng2:8001 python3 server.py
```

In multi-backend mode, the UI shows a backend selector and routes API calls to the selected target.

### Proxy Target Selection (Multi-Backend)

The Flask proxy forwards `/api/*` and `/metrics` to one selected backend target.

- Default (no header): resolved default target (`backend_url` from `GET /ui-api/backend-info`)
- Explicit target by URL: set header `X-Bngblaster-Target: http://bng2:8001`
- Explicit target by index: set header `X-Bngblaster-Target: 1` (0-based index in `BNGBLASTER_URL` list)

Examples:

```bash
# Uses resolved default backend (see GET /ui-api/backend-info -> backend_url)
curl http://localhost:8080/api/v1/instances

# Route request to a specific backend by full URL
curl -H "X-Bngblaster-Target: http://bng2:8001" \
	http://localhost:8080/api/v1/instances

# Route request to backend by index (0-based)
curl -H "X-Bngblaster-Target: 1" \
	http://localhost:8080/api/v1/instances

# Same mechanism also works for /metrics
curl -H "X-Bngblaster-Target: 1" \
	http://localhost:8080/metrics
```

Tip: `GET /ui-api/backend-info` returns `backend_urls` and helps map index → URL.

Development mode with live reload (bind-mount source):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Optionally with custom port or backend URL:

```bash
python3 server.py 8080 http://localhost:8001
```

Gunicorn runtime options can be customized via environment variables:

- `BIND` (default: `0.0.0.0:8080`)
- `GUNICORN_WORKERS` (default: `2`)
- `GUNICORN_THREADS` (default: `2`)
- `GUNICORN_TIMEOUT` (default: `30`)
- `GUNICORN_LOGLEVEL` (default: `info`)
- `VERSION_CHECK_ENABLED` (default: `1`)
- `VERSION_CHECK_CACHE_SEC` (default: `3600`, minimum: `60`)
- `START_OPTIONS_CLEANUP_ENABLED` (default: `1`)
- `START_OPTIONS_CLEANUP_INTERVAL_SEC` (default: `300`, minimum: `30`)

Then open in the browser:

```text
http://localhost:8080
```

## Offline Mode

- All frontend dependencies are loaded locally from `static/vendor/`.
- There are no CDN, font, or JavaScript imports required for the UI.
- You only need the local Python server and a reachable BNG Blaster Controller.

## Notes

- The Flask server proxies `/api/` and `/metrics` to the BNG Blaster Controller, which avoids CORS issues in the browser.
- Outbound proxy targets are allowlisted to configured `BNGBLASTER_URL` entries only (HTTP/HTTPS, no credentials).
- Invalid `X-Bngblaster-Target` values are rejected with HTTP 400 (no silent fallback).
- Optional version check compares backend-reported versions with latest GitHub releases:
	- Controller: https://github.com/rtbrick/bngblaster-controller/releases
	- BNG Blaster: https://github.com/rtbrick/bngblaster/releases
	- Sidebar coloring under Backend: green = current, red = outdated
- Template files are stored server-side in `config-templates/`.
- Runtime state is stored server-side in `state/` (Docker Compose mounts this directory to the host).
- A periodic server-side cleanup removes orphaned start-option entries when instances no longer exist.
- Manual cleanup trigger is available via `POST /ui-api/instance-start-options/_cleanup`.
- Reconfigure endpoint is available via `PUT /ui-api/instances/{name}/reconfigure`.
- The API explorer reads the OpenAPI spec from `static/bngblaster-controler-swagger.yaml`.
- The API explorer can switch between controller spec and UI API spec (`static/ui-api-swagger.yaml`).

Manual cleanup example:

```bash
curl -X POST http://localhost:8080/ui-api/instance-start-options/_cleanup
```

Reconfigure instance example (stop -> apply config -> restart with saved params):

```bash
curl -X PUT \
	-H "Content-Type: application/json" \
	-H "X-Bngblaster-Target: http://bng2:8001" \
	-d '{"interfaces": {"network": {"interface": "eth1"}}}' \
	http://localhost:8080/ui-api/instances/sample/reconfigure
```

## VS Code Debugging

- Install the VS Code Python extension.
- Use the launch configuration `Python: Flask UI (server.py)` for breakpoint debugging.
- Keep `BNGBLASTER_URL` in the launch config aligned with your backend.
- For process behavior close to production, use `Python: Gunicorn (single worker)`.
