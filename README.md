# Lattice

The observer for Polymorph service meshes. Lattice provides real-time topology visualization and monitoring through a gossip-based discovery mesh and a web UI.

Services running in [Polymorph](../polymorph/) automatically register with Lattice via Serf, and Lattice renders the live service graph -- showing services, their dependencies, resource schemas, and request logs.

## Quick Start

```bash
# Start Lattice
lattice server -c examples/lattice.hcl

# In another terminal, start Polymorph services that join the mesh
polymorph server -c examples/multi-service-mesh.hcl
```

Open `http://localhost:9000` to see the topology UI.

## Configuration

Lattice uses HCL configuration:

```hcl
server {
  listen = "0.0.0.0:7946"   # Serf gossip mesh port
  ui     = "0.0.0.0:9000"   # Web UI + Connect-RPC API port
}
```

Polymorph services join the mesh by referencing Lattice's gossip address:

```hcl
# In a Polymorph config
lattice {
  address = "localhost:7946"
}
```

## Architecture

```
                    +-----------+
                    |  Web UI   |  React + React Flow
                    |  :9000    |  topology graph, service panel
                    +-----+-----+
                          |
                    Connect-RPC (streaming)
                          |
                    +-----+-----+
                    | Lattice   |  Go server
                    |  API      |  ObserverService
                    +-----+-----+
                          |
                    Serf gossip mesh (:7946)
                          |
              +-----------+-----------+
              |           |           |
         +----+----+ +---+---+ +-----+----+
         | user-   | | order | | api-     |
         | service | | -svc  | | gateway  |
         +---------+ +-------+ +----------+
                 Polymorph services
```

**Serf Mesh**: Services join the gossip mesh on startup and advertise metadata (name, type, address, upstreams) via Serf tags. Lattice watches for member join/leave events and rebuilds the topology.

**Connect-RPC API**: The UI connects over Connect-RPC with streaming support for real-time topology updates. Resource metadata and request logs are fetched on demand by routing requests through the mesh to target Polymorph services.

**Web UI**: React app with an interactive node graph (React Flow + ELK layout). Services are grouped by host, color-coded by status, and clickable to inspect resources and live request logs.

## API

Lattice exposes a Connect-RPC API at `/observer.v1.ObserverService/`.

### GetTopology

Returns a snapshot of the current service mesh topology.

```bash
curl -X POST http://localhost:9000/observer.v1.ObserverService/GetTopology \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### WatchTopology

Server-streaming RPC that pushes topology updates in real-time. The first message is a full snapshot; subsequent messages are incremental updates on member join/leave.

### GetServiceResources

Fetches resource metadata (schemas, row counts, field definitions) from a Polymorph service by routing through the mesh.

```bash
curl -X POST http://localhost:9000/observer.v1.ObserverService/GetServiceResources \
  -H 'Content-Type: application/json' \
  -d '{"serviceName": "user-service"}'
```

### GetRequestLogs

Fetches recent HTTP request logs from a Polymorph service. Supports pagination via `afterSequence` and `limit`.

```bash
curl -X POST http://localhost:9000/observer.v1.ObserverService/GetRequestLogs \
  -H 'Content-Type: application/json' \
  -d '{"serviceName": "user-service", "limit": 50}'
```

## Web UI

The UI shows:

- **Topology graph** -- services as nodes, dependencies as edges, grouped by host
- **Service panel** -- click a service to see:
  - **Overview**: name, type, address, upstreams, status, tags
  - **Resources**: schema definitions (fields, types, row counts)
  - **Request Logs**: live stream of recent HTTP requests with method, path, status, and duration

Services are auto-laid out using ELK's hierarchical algorithm and support drag, zoom, and pan.

### Running the UI in development

```bash
cd ui
npm install
npm run dev          # Vite dev server with HMR
npm run build        # Production build
npm run typecheck    # TypeScript check
npm run generate     # Regenerate Connect-RPC client from protos
```

## Project Structure

```
lattice/
├── cmd/lattice/               Entry point
├── internal/
│   ├── api/                   ObserverService implementation
│   ├── cli/                   CLI commands (server)
│   ├── config/                HCL config parsing
│   ├── serf/                  Gossip mesh wrapper and event handling
│   └── topology/              Graph with BFS pathfinding for mesh routing
├── api/observer/v1/           Protocol Buffers (source of truth)
├── pkg/api/observer/v1/       Generated Go + Connect-RPC code
├── ui/
│   ├── src/
│   │   ├── components/        TopologyGraph, ServicePanel, ServiceNode, GroupNode
│   │   ├── hooks/             useTopology, useServiceResources, useRequestLogs
│   │   ├── gen/               Generated Connect-RPC TypeScript client
│   │   └── catalyst/          Reusable UI components (Headless UI)
│   ├── package.json
│   └── vite.config.ts
├── examples/                  Configuration examples
├── buf.yaml                   Buf protobuf module config
└── buf.gen.yaml               Code generation (Go + TypeScript)
```
