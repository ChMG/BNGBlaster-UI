# BNGBlaster Prometheus + Grafana Monitoring Setup

⚠️ **NOTICE**: This is an **example setup** with **example dashboards** for demonstration purposes. For production environments, configurations should be adapted to your infrastructure, security requirements, and monitoring policies.

## Overview

This setup provides a complete monitoring system for BNGBlaster metrics based on:
- **Prometheus**: Metrics collection and storage (http://localhost:9090)
- **Grafana**: Visualization and dashboards (http://localhost:3000)

BNGBlaster exports metrics in Prometheus text format via HTTP endpoint `/metrics` (default: port 8001).

## Quick Start

### Requirements
- Docker and Docker Compose
- BNGBlaster running and exporting metrics at http://localhost:8001/metrics

### Start
```bash
cd metrics-grafana
docker-compose up -d
```

Access:
- **Grafana**: http://localhost:3000 (Default login: admin/admin)
- **Prometheus**: http://localhost:9090

### Stop
```bash
docker-compose down
```

## Available Dashboards

All dashboards are automatically registered in Grafana via the provisioning infrastructure:

| Dashboard | Metrics Flag | Focus |
|-----------|-------------|-------|
| **BNGBlaster Standard Metrics** | `--metrics-flag standard-metrics` | Overview (instances, availability) |
| **BNGBlaster Session Counters** | `--metrics-flag session_counters` | Sessions, setup rate, traffic flows |
| **BNGBlaster Interfaces Counters** | `--metrics-flag interfaces` | Basic interface metrics (RX/TX bytes/packets) |
| **BNGBlaster Access Interfaces Counters** | `--metrics-flag access_interfaces` | Access interface dedicated (with loss packets, session/stream counters) |
| **BNGBlaster Network Interfaces Counters** | `--metrics-flag network_interfaces` | Network interface dedicated (template, ready for data) |
| **BNGBlaster A10NSP Interfaces Counters** | `--metrics-flag a10nsp_interfaces` | A10NSP interface dedicated (specialized metrics) |
| **BNGBlaster Streams Counters** | `--metrics-flag streams` | Stream traffic, loss packets, flow activity |

## Directory Structure

```
metrics-grafana/
├── README.md                                    # This file
├── docker-compose.yml                           # Orchestration (Prometheus + Grafana)
├── prometheus/
│   └── prometheus.yml                          # Scrape configuration for BNGBlaster
└── grafana/
    └── provisioning/
        ├── datasources/
        │   └── datasource.yml                  # Prometheus datasource
        └── dashboards/
            ├── default.yml                     # Provider config (auto-discovery)
            ├── bngblaster-standard-metrics.json
            ├── bngblaster-session-counters.json
            ├── bngblaster-interfaces-counters.json
            ├── bngblaster-access-interfaces-counters.json
            ├── bngblaster-network-interfaces-counters.json
            ├── bngblaster-a10nsp-interfaces-counters.json
            └── bngblaster-streams-counters.json
```

## Configuration

### Prometheus (`prometheus/prometheus.yml`)
- **Scrape interval**: 15s
- **BNGBlaster target**: http://localhost:8001/metrics
- **Evaluation interval**: 15s

To change BNGBlaster port or hostname:
```yaml
scrape_configs:
  - job_name: 'bngblaster'
    static_configs:
      - targets: ['localhost:8001']  # Update as needed
```

### Grafana (`grafana/provisioning/datasources/datasource.yml`)
- **Prometheus URL**: http://prometheus:9090
- **Read timeout**: 30s

## Dashboard Variables

All dashboards support dynamic filtering based on live metrics:

### Common Variables
- `instance_name`: BNGBlaster instance name (via label_values)
- `hostname`: System hostname

### Metrics-Specific Variables
- **Access/Network/A10NSP Interfaces**: `interface_name`, `interface_type`
- **Streams**: `stream_direction` (upstream/downstream), `stream_type` (e.g., unicast)
- **Sessions**: No additional filters

## Metrics Label Structure

BNGBlaster exports metrics with the following labels:

```
{
  hostname: "CHRIS-ROG",
  instance_name: "test1",
  interface_name: "vethA",      # Only for interface metrics
  interface_type: "Access",     # "Interface", "Access", "A10NSP", "Network"
  flow_id: "1",                 # Only for stream metrics
  stream_direction: "upstream", # "upstream", "downstream"
  ...
}
```

## Metrics Families

### Session Metrics (`session_counters`)
- `sessions`, `sessions_established`, `sessions_flapped`
- `dhcp_sessions`, `dhcpv6_sessions`
- `setup_rate`, `setup_time`
- `session_traffic_flows`, `stream_traffic_flows`

### Interface Metrics
- `interfaces_rx_bytes`, `interfaces_rx_packets`, `interfaces_rx_kbps`, `interfaces_rx_pps`
- `interfaces_tx_bytes`, `interfaces_tx_packets`, `interfaces_tx_kbps`, `interfaces_tx_pps`
- `interfaces_rx_loss_packets_*` (sub-metrics per protocol)
- `interfaces_rx/tx_packets_session_*` (session counters per protocol)
- `interfaces_rx/tx_packets_streams` (stream counters)

### Stream Metrics (`streams`)
- `stream_rx_bytes`, `stream_rx_packets`, `stream_rx_loss`
- `stream_tx_bytes`, `stream_tx_packets`
- Labels: `flow_id`, `stream_direction`, `stream_name`, `stream_type`, `stream_sub_type`

## Troubleshooting

### "No Data" in Grafana
1. Check if BNGBlaster is reachable at http://localhost:8001/metrics:
   ```bash
   curl http://localhost:8001/metrics
   ```
2. Check Prometheus targets: http://localhost:9090/targets
3. Ensure the metrics flag is enabled (e.g., `--metrics-flag session_counters`)

### Prometheus Scrape Errors
1. Check container logs:
   ```bash
   docker-compose logs prometheus
   ```
2. Verify hostname/port in `prometheus/prometheus.yml`

### Dashboard Not Visible
1. Reload Grafana or restart containers:
   ```bash
   docker-compose restart grafana
   ```
2. Check provisioning logs:
   ```bash
   docker-compose logs grafana | grep -i provisioning
   ```

## Production Adaptations

For production use, the following is recommended:

1. **Security**:
   - Change default passwords in `docker-compose.yml`
   - Enable HTTPS/TLS
   - Restrict network access

2. **Persistence**:
   - Define volumes for Prometheus (`storage/`) and Grafana (`/var/lib/grafana`)
   - Implement backup strategy for Grafana dashboards

3. **Scaling**:
   - Increase `--storage.tsdb.retention.time` in Prometheus for longer retention
   - Adjust `scrape_interval` as needed

4. **Monitoring**:
   - Configure alerting rules for Prometheus
   - Set up Grafana alerts for critical metrics

## References & Documentation

- **Prometheus**: https://prometheus.io/docs/prometheus/latest/
- **Grafana**: https://grafana.com/docs/grafana/latest/
- **BNGBlaster**: See BNGBlaster documentation

---

**Date**: April 2026  
**Status**: Example setup  
**Last Update**: Dashboard suite complete (7 dashboards)
