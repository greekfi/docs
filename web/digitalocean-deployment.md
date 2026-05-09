# DigitalOcean Deployment - Findings & Setup

## Why Move from Railway

Railway charges per-resource usage and gets expensive for always-on services.
A single DigitalOcean Droplet ($6/mo, 1GB RAM) can run both bebop and relay.

## Services to Deploy

### 1. Bebop (`yarn bebop` / `node dist/bebop.mjs`)
- **Purpose**: Connects to Bebop RFQ WebSocket, sends signed quotes + pricing stream
- **Ports**: None exposed (outbound WebSocket only)
- **Dependencies**: SpotFeed, Pricer, option metadata, signing key
- **Env vars needed**: CHAIN_ID, MAKER_ADDRESS, PRIVATE_KEY, BEBOP_MARKETMAKER, BEBOP_AUTHORIZATION, BEBOP_API_URL, CHAIN, DEFAULT_IV, RISK_FREE_RATE, BID_SPREAD, ASK_SPREAD, SPOT_POLL_INTERVAL, RPC_ETHEREUM

### 2. Relay (`yarn relay` / `node dist/relay.mjs`)
- **Purpose**: Connects to Bebop pricing feeds, re-broadcasts to local WebSocket clients (frontend)
- **Ports**: 3004 (WebSocket server, listens on 0.0.0.0)
- **Dependencies**: Bebop credentials only (no pricer/spot feed)
- **Env vars needed**: BEBOP_MARKETMAKER, BEBOP_AUTHORIZATION, BEBOP_CHAINS, RELAY_WS_PORT

## Current Build Pipeline

- **Bundler**: tsup (outputs ESM to `dist/`)
- **Entry points**: `dist/bebop.mjs`, `dist/relay.mjs`, `dist/direct.mjs`
- **Runtime deps needed**: viem, ws, protobufjs, express, cors, dotenv
- **`skipNodeModulesBundle: true`** means dist files import from node_modules at runtime
- **Cached metadata**: `data/metadata-1.json` (Ethereum chain options, used by bebop for fast startup)

## Architecture on DigitalOcean

```
┌─────────────────────────────────────────┐
│  $6/mo Droplet (1GB RAM, Ubuntu 24.04)  │
│                                         │
│  ┌─────────────────┐  ┌──────────────┐  │
│  │  bebop container │  │ relay container│ │
│  │  (outbound only) │  │ :3004 → :3004 │ │
│  └─────────────────┘  └──────────────┘  │
│                                         │
│  Docker Compose manages both            │
│  .env file shared between services      │
└─────────────────────────────────────────┘
```

## Files Created

- `market-maker/Dockerfile` - Multi-stage build (node:25-alpine)
- `market-maker/docker-compose.yml` - Both services, shared .env, log rotation
- `market-maker/.dockerignore` - Excludes node_modules, dist, .env from build context

## Key Design Decisions

1. **Single Dockerfile, two services** - Both share the same image, different CMD
2. **`restart: unless-stopped`** - Auto-restart on crash, survives reboot
3. **Log rotation** - 10MB max per file, 3 files max (prevents disk fill)
4. **node:25-alpine** - Latest Node, smallest image
5. **No nginx/reverse proxy** - Relay serves WebSocket directly on 3004. Add Caddy later if you need TLS.

## Port Exposure

| Service | Container Port | Host Port | Protocol | Public? |
|---------|---------------|-----------|----------|---------|
| bebop   | none          | none      | -        | No      |
| relay   | 3004          | 3004      | WS       | Yes     |

## Relay Security Note

The relay WebSocket on port 3004 is open to the internet. It's read-only price data
so the risk is low, but if you want to restrict access:
- Use DigitalOcean firewall to allowlist IPs
- Or add Caddy with basic auth for WebSocket upgrade
