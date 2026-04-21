# BNG Blaster UI

Python-based web application for the BNG Blaster Controller with a modern single-page UI.

> Note: This application was largely generated with AI support. Please review and test all functionality before production use.

## Features

- Instances as a table with automatically updated status
- Start, stop, kill, delete, create, and edit actions for instances
- Start dialog with optional logging/metric/report flags (each with conditional visibility)
- **Server-side configuration templates with placeholder substitution** ($IF1, $IF2, ... for interfaces and $VAR1, $VAR2, ... for free text; optional filter hint via $IF1:eth syntax)
- Metrics page for Prometheus text format
- Metrics Charts page (ECharts) with instance filter and selectable time window
- Technical API explorer based on the OpenAPI file
- Command dialog and file downloads per instance
- Stop-apply-restart workflow for updating running instances' configuration
- Restart-after-edit reuses last start options per instance (persisted server-side)
- Manual start dialog pre-fills last saved start options per instance
- Instance scheduler for timed start/stop (explicit stop time or runtime-based stop)
- Deleting an instance also removes its saved start options from server state
- In multi-backend mode, saved start options are namespaced per backend target and instance name
- Orphaned start-option entries are cleaned up periodically server-side if instances were deleted outside the UI

## Project Structure

- `server.py`: Flask entry point, API/metrics proxy, templates API, SPA file serving
- `gunicorn.conf.py`: Gunicorn runtime settings (bind, workers, threads, timeouts, logs)
- `requirements.txt`: Python dependencies
- `config-templates/`: persisted server-side JSON templates
- `state/`: persisted server-side runtime state (e.g. per-instance last start options)
- `static/index.html`: SPA shell
- `static/theme.css`: global UI theme and style tokens
- `static/js/app.js`: Vue app bootstrap, router, sidebar layout
- `static/js/api.js`: shared HTTP client, poller helper, Prometheus parser
- `static/js/pages/instances.js`: instance lifecycle + session management UI
- `static/js/pages/interfaces.js`: interfaces overview page
- `static/js/pages/metrics.js`: metrics dashboard
- `static/js/pages/metrics-charts.js`: ECharts-based metrics visualization (instance/time-window filters)
- `static/js/pages/templates.js`: templates CRUD + apply to instance
- `static/js/pages/explorer.js`: OpenAPI endpoint explorer
- `static/bngblaster-controler-swagger.yaml`: OpenAPI spec consumed by explorer
- `static/ui-api-swagger.yaml`: OpenAPI spec for internal `/ui-api/*` endpoints
- `static/vendor/`: vendored frontend runtime dependencies
	- Includes `echarts.min.js` for offline chart rendering (no CDN dependency)
- `.vscode/launch.json`: VS Code debug configurations
- `STYLE_GUIDE.md`: theming and rebranding guide (token-based color customization)

## Local Development with WSL (Ubuntu 24.04)

For local development on Windows, use WSL2 with Ubuntu 24.04.

Install guides for required backend components:

- BNG Blaster installation: https://rtbrick.github.io/bngblaster/install.html
- BNG Blaster Controller installation: https://rtbrick.github.io/bngblaster/controller.html#installation

### Create Virtual Test Interfaces in WSL

The following example creates a Linux bridge plus 4 veth pairs that can be used for BNG Blaster tests:

```bash
sudo ip link add br0 type bridge
sudo ip link set br0 up
sudo ip link add vethA type veth peer name x-vethA
sudo ip link add vethB type veth peer name x-vethB
sudo ip link add vethC type veth peer name x-vethC
sudo ip link add vethD type veth peer name x-vethD
sudo ip link set x-vethA master br0
sudo ip link set x-vethB master br0
sudo ip link set x-vethC master br0
sudo ip link set x-vethD master br0
sudo ip link set vethA up
sudo ip link set x-vethA up
sudo ip link set vethB up
sudo ip link set x-vethB up
sudo ip link set vethC up
sudo ip link set x-vethC up
sudo ip link set vethD up
sudo ip link set x-vethD up
sudo sysctl -w net.ipv6.conf.br0.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethA.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.x-vethA.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethB.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.x-vethB.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethC.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.x-vethC.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.vethD.disable_ipv6=1
sudo sysctl -w net.ipv6.conf.x-vethD.disable_ipv6=1
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
CONFIG_FILE=./config.json gunicorn -c gunicorn.conf.py server:app
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

Optional (external config path):

```bash
BNGBLASTER_UI_CONFIG=/path/to/config.json docker compose up --build -d
```

Multi-backend mode is configured via the `bngblaster` array in `config.json`.

In multi-backend mode, the UI shows a backend selector and routes API calls to the selected target.

### Proxy Target Selection (Multi-Backend)

The Flask proxy forwards `/api/*` and `/metrics` to one selected backend target.

- Default (no header): resolved default target (`backend_url` from `GET /ui-api/backend-info`)
- Explicit target by URL: set header `X-Bngblaster-Target: http://bng2:8001`
- Explicit target by index: set header `X-Bngblaster-Target: 1` (0-based index in `backend_urls` from `GET /ui-api/backend-info`)

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

Optionally with custom port or config path:

```bash
CONFIG_FILE=./config.json python3 server.py 8080
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
- `APP_VERSION_CHECK_ENABLED` (default: `1`)
- `APP_VERSION_CHECK_CACHE_SEC` (default: `3600`, minimum: `60`)
- `APP_VERSION_CHECK_URL` (default: `https://github.com/ChMG/BNGBlaster-UI/blob/main/VERSION`)
- `INSTANCE_SCHEDULER_ENABLED` (default: `1`)
- `INSTANCE_SCHEDULER_INTERVAL_SEC` (default: `1`, minimum: `0.5`)
- `INSTANCE_SCHEDULER_ARTIFACT_INITIAL_DELAY_SEC` (default: `30`, minimum: `0`)
- `INSTANCE_SCHEDULER_ARTIFACT_WAIT_SEC` (default: `30`, minimum: `0`)
- `INSTANCE_SCHEDULER_ARTIFACT_POLL_SEC` (default: `2`, minimum: `0.2`)
- `CONFIG_FILE` (optional, default: `./config.json`)

Controller, Grafana and OIDC settings are loaded from `config.json`.
Legacy env vars (`BNGBLASTER_URL`, `METRIC_GRAFANA_URL`, `OIDC_*`) are only used as fallback when no valid values are present in `config.json`.
If the `oidc` block exists in `config.json`, OIDC is enabled automatically unless `"enabled": false` is set.

Application version is read from the `VERSION` file in project root (shown in sidebar Backend section).

Then open in the browser:

```text
http://localhost:8080
```

## Runtime Configuration File

Use `config.json` in project root for runtime configuration:

```json
{
	"bngblaster": [
		{
			"controller": "http://localhost:8001",
			"grafana": "http://localhost:3000"
		},
		{
			"controller": "http://127.0.0.1:8001",
			"grafana": ""
		}
	],
	"oidc": {
		"enabled": true,
		"issuer_url": "http://localhost:8090/realms/master",
		"client_id": "bngblaster-ui",
		"client_secret": "change-me",
		"bearer_enforce_audience": true,
		"bearer_allowed_audiences": "bngblaster-ui",
		"scopes": "openid profile email",
		"groups_claim": "groups",
		"allowed_groups": "bngblaster-user",
		"app_secret_key": "change-me-long-random-dev-secret",
		"redirect_uri": "http://localhost:8080/ui-api/auth/callback",
		"post_logout_redirect_uri": "http://localhost:8080/"
	}
}
```

VS Code launch configurations use this file via `CONFIG_FILE=${workspaceFolder}/config.json`.

Docker Compose binds the runtime config read-only into the container:

```yaml
volumes:
	- ${BNGBLASTER_UI_CONFIG:-./config.json}:/app/config.json:ro
```

Set `BNGBLASTER_UI_CONFIG` if the external config file lives outside the project root.

Per-controller Grafana behavior:

- Grafana URL is selected by active controller in the UI.
- If a controller `grafana` value is empty, the `Metric Grafana` menu entry is hidden.

## Optional OpenID Connect Login

You can protect the UI and all proxied endpoints with OpenID Connect.

Behavior when enabled:

- Unauthenticated users are redirected to the OIDC login flow.
- API requests without session return `401` including a login URL.
- After successful login, users are redirected back to the original page.
- A logout link is shown in the sidebar backend section.
- Optional group-based or role-based restriction can be enforced with `OIDC_ALLOWED_GROUPS` and `OIDC_ALLOWED_ROLES`.
- Bearer tokens are validated against expected audience/client binding (`bearer_allowed_audiences` or fallback to `client_id`) when `bearer_enforce_audience` is enabled.

Minimal config example:

```json
"oidc": {
	"enabled": true,
	"issuer_url": "https://your-idp.example.com/realms/main",
	"client_id": "bngblaster-ui",
	"client_secret": "your-client-secret",
	"bearer_enabled": true,
	"bearer_enforce_audience": true,
	"bearer_allowed_audiences": "bngblaster-ui",
	"groups_claim": "groups",
	"allowed_groups": "/bngblaster-admin",
	"roles_claim": "realm_access.roles",
	"allowed_roles": "bngblaster-ui-user",
	"jwks_cache_sec": 3600,
	"app_secret_key": "change-me-to-a-long-random-secret"
}
```

Authorization restriction notes:

- If `OIDC_ALLOWED_GROUPS` is empty, every successfully authenticated OIDC user is allowed.
- If `OIDC_ALLOWED_GROUPS` is set, the user must have at least one matching group.
- If `OIDC_ALLOWED_ROLES` is set, the user must have at least one matching role.
- If both are set, a matching group or a matching role is sufficient.
- For Keycloak, configure a mapper of type `Group Membership` so groups are included in the selected claim.
- For Keycloak roles, the default roles claim path is `realm_access.roles`.
- For client roles, use a nested claim path like `resource_access.bngblaster-ui.roles` in `roles_claim`.
- For script/API usage without browser session, send `Authorization: Bearer <access-token>` and keep `bearer_enabled` set to `true`.
- Bearer authentication is evaluated for all `/api/*` and `/ui-api/*` requests.
- Ensure required group/role claims are available in the UserInfo response (`Add to userinfo = ON`).
- In large production realms, avoid putting massive group/role lists into ID tokens (`Add to ID token = OFF` where possible) to prevent callback size/parser errors.
- If Keycloak mapper option `Full group path` is enabled, use values like `/bngblaster-user` in `OIDC_ALLOWED_GROUPS`.
- If `Full group path` is disabled, use values like `bngblaster-user` (without leading slash).

Script example (no browser login):

```bash
# 1) Obtain access token (client credentials example)
TOKEN=$(curl -sS \
	-d "grant_type=client_credentials" \
	-d "client_id=bngblaster-ui" \
	-d "client_secret=your-client-secret" \
	"https://your-idp.example.com/realms/main/protocol/openid-connect/token" \
	| python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

# 2) Call protected UI API endpoint with Bearer token
curl -sS \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-X PUT "http://localhost:8080/ui-api/instances/<name>/reconfigure" \
	-d '{"interfaces": []}'
```

Important for Keycloak + `client_credentials`:

- The token represents the client service account, not an end-user.
- If `allowed_roles` is configured, assign the required role to the client service account in Keycloak.
- Keycloak path: `Clients` -> `<client-id>` -> `Service account roles`.
- Without matching service-account roles, bearer-token calls return `403 forbidden`.

Access denied behavior:

- If a user is authenticated but not in an allowed group, the UI shows a styled `Access Denied` page.
- The page includes a `Try Login Again` button, which triggers a fresh IdP login (`prompt=login`) so another user can sign in.

Auth endpoints:

- `GET /ui-api/auth/login`
- `GET /ui-api/auth/callback`
- `GET /ui-api/auth/logout`
- `GET /ui-api/auth/status`

## Offline Mode

- All frontend dependencies are loaded locally from `static/vendor/`.
- There are no CDN, font, or JavaScript imports required for the UI.
- You only need the local Python server and a reachable BNG Blaster Controller.

## Monitoring with Prometheus + Grafana

This project includes an optional **example monitoring setup** in the `metrics-grafana/` directory that provides:

- **Prometheus**: Scrapes BNG Blaster metrics from the `/metrics` endpoint
- **Grafana**: Visualizes metrics with pre-built dashboards for:
  - Session counters (setup rate, established sessions, traffic flows)
  - Interface counters (RX/TX bytes, packets, throughput, loss packets)
  - Stream counters (per-flow traffic, loss, activity)
  - And more...

### Quick Start

```bash
cd metrics-grafana
docker-compose up -d
```

Then access:
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090

⚠️ **Note**: This is an example setup for demonstration purposes. For production use, refer to the `metrics-grafana/README.md` for security, persistence, and scalability recommendations.

For details, see [metrics-grafana/README.md](./metrics-grafana/README.md).

## Notes

- The Flask server proxies `/api/` and `/metrics` to the BNG Blaster Controller, which avoids CORS issues in the browser.
- Outbound proxy targets are allowlisted to configured controller entries from `config.json` (HTTP/HTTPS, no credentials).
- Invalid `X-Bngblaster-Target` values are rejected with HTTP 400 (no silent fallback).
- Optional version check compares backend-reported versions with latest GitHub releases:
	- Controller: https://github.com/rtbrick/bngblaster-controller/releases
	- BNG Blaster: https://github.com/rtbrick/bngblaster/releases
	- Sidebar coloring under Backend: green = current, red = outdated
- App version check compares local `VERSION` with the remote version file at `APP_VERSION_CHECK_URL`.
- Template files are stored server-side in `config-templates/`.
- Template apply dialogs can preview the configuration and highlight `$IF...` / `$VAR...` placeholders before substitution.
- Interface selectors support a pre-filter hint embedded in the placeholder: `$IF1:eth` pre-fills the search with `eth`, narrowing the list immediately.
- Applying a template to a running instance uses the same stop -> apply -> restart workflow as editing a running instance.
- Runtime state is stored server-side in `state/` (Docker Compose mounts this directory to the host).
- A periodic server-side cleanup removes orphaned start-option entries when instances no longer exist.
- Manual cleanup trigger is available via `POST /ui-api/instance-start-options/_cleanup`.
- Reconfigure endpoint is available via `PUT /ui-api/instances/{name}/reconfigure`.
- The API explorer reads the OpenAPI spec from `static/bngblaster-controler-swagger.yaml`.
- The API explorer can switch between controller spec and UI API spec (`static/ui-api-swagger.yaml`).
- The `Metrics Charts` page supports filtering by `instance_name` label and a selectable visible time window.
- `instances_running` and `instances_total` are always shown in Metrics Charts, independent of instance filter.

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

Schedule example (start and stop at explicit times):

```bash
curl -X POST \
	-H "Content-Type: application/json" \
	-H "X-Bngblaster-Target: http://localhost:8001" \
	-d '{
		"instance": "sample",
		"start_time": "2026-04-21T20:00:00Z",
		"stop_time": "2026-04-21T22:00:00Z"
	}' \
	http://localhost:8080/ui-api/instance-schedules
```

Schedule example (stop derived from runtime):

```bash
curl -X POST \
	-H "Content-Type: application/json" \
	-d '{
		"instance": "sample",
		"start_time": "2026-04-21T20:00:00Z",
		"runtime_seconds": 3600
	}' \
	http://localhost:8080/ui-api/instance-schedules
```

List schedules:

```bash
curl "http://localhost:8080/ui-api/instance-schedules?active=1"
```

Scheduler API notes:

- `?active=1` returns only schedules with status `scheduled`, `running`, or `waiting for artifacts`.
- If both `stop_time` and `runtime_seconds` are sent, `stop_time` takes precedence.
- After scheduler stop/cancel, the UI backend downloads available instance files
	(`config.json`, `run.json`, `run.log`, `run_report.json`, `run.pcap`,
	`run.stdout`, `run.stderr`) and stores them as a ZIP artifact per schedule.
- Artifact collection waits `INSTANCE_SCHEDULER_ARTIFACT_INITIAL_DELAY_SEC`
	before the first download attempt, then polls for up to
	`INSTANCE_SCHEDULER_ARTIFACT_WAIT_SEC` (in steps of
	`INSTANCE_SCHEDULER_ARTIFACT_POLL_SEC`) to catch files that are generated
	shortly after stop/cancel.

Delete schedule:

```bash
curl -X DELETE http://localhost:8080/ui-api/instance-schedules/<schedule-id>
```

Cancel running schedule early:

```bash
curl -X POST http://localhost:8080/ui-api/instance-schedules/<schedule-id>/cancel
```

Download scheduler artifact ZIP:

```bash
curl -L -o schedule-artifact.zip \
	http://localhost:8080/ui-api/instance-schedules/<schedule-id>/artifact
```

## VS Code Debugging

- Install the VS Code Python extension.
- Use the launch configuration `Python: Flask UI (server.py)` for breakpoint debugging.
- Keep `config.json` aligned with your backend and OIDC setup.
- For process behavior close to production, use `Python: Gunicorn (single worker)`.
