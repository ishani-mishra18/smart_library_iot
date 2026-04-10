# Smart Library IoT Simulation

Smart Library Noise and Comfort Monitor for the **IoT Architecture and Protocol** subject.

This repository is now fully simulation-first and split into independent apps managed by `pnpm` workspaces.

## Project Architecture

- `apps/backend`: Express + WebSocket backend, alert engine, protocol metrics, REST APIs
- `apps/simulator`: virtual IoT sensor fleet with scenario-aware behavior and mixed protocol publishing
- `apps/frontend`: Astro + Vite dashboard for live monitoring and command publication
- `report/report.tex`: LaTeX project report following `report_format.md`

## Protocol Model (Simulation)

- **REST/HTTP**: simulated sensors publish readings to `/api/sensor-data`
- **MQTT style simulation**: simulator publishes topic + payload to `/api/mqtt-sim/publish`
- **WebSocket**: backend pushes real-time updates (`snapshot`, `sensor_data`, `new_alert`) to dashboard

Backend keeps protocol counters and average latency at `/api/protocol-stats`.

## Workspace Setup

Requirements:

- Node.js 18+
- pnpm 10+

Install dependencies:

```bash
pnpm install
```

## Run (Full System)

Start backend + simulator + frontend together:

```bash
pnpm dev
```

Open dashboard:

- `http://localhost:4321`

Backend APIs:

- `http://localhost:3000/api/snapshot`
- `http://localhost:3000/api/protocol-stats`
- `http://localhost:3000/api/telemetry-log`

## Run Services Individually

```bash
pnpm dev:backend
pnpm dev:sim
pnpm dev:frontend
```

## Simulator Controls

Environment variables (`apps/simulator`):

- `PUBLISH_MODE=http|mqtt|mixed` (default: `mixed`)
- `SCENARIO=normal|exam-time|kids-hour|hvac-failure` (default: `normal`)
- `BACKEND_HOST` (default: `localhost`)
- `BACKEND_PORT` (default: `3000`)

Example:

```bash
SCENARIO=hvac-failure PUBLISH_MODE=mqtt pnpm dev:sim
```

## Build Frontend

```bash
pnpm build
pnpm preview
```

## Simulation Features Added

- mixed HTTP and MQTT-style topic publishing
- protocol throughput and average latency tracking
- telemetry stream API for frontend observability
- scenario-based behavior modeling for exam, kids-hour, and HVAC-failure conditions
- Astro + Vite dashboard with command panel and protocol table

## Report

The report is provided in:

- `report/report.tex`

It follows the exact required section flow from `report_format.md`:

1. Abstract
2. Introduction
3. Problem formulation
4. Implementation
5. Conclusion
