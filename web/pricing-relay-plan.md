# Bebop Pricing Relay - Implementation Plan

## Goal

Create a **standalone server** that:
1. Connects to Bebop's taker pricing WebSocket feed as a client
2. Receives real-time price updates (protobuf format)
3. Relays prices to the web frontend via WebSocket

## Architecture

```
Bebop Pricing Feeds          Pricing Relay Server           Frontend
(7 chains)                   (rfq)                 (opswap)

wss://api.bebop.xyz/         ┌──────────────────┐          ┌─────────────┐
  pmm/ethereum/v3/pricing ──>│                  │          │             │
  pmm/arbitrum/v3/pricing ──>│  pricing-server  │ ws:3004  │  React App  │
  pmm/base/v3/pricing ──────>│     .ts          │<────────>│  usePricing │
  pmm/optimism/v3/pricing ──>│                  │          │  hook       │
  pmm/polygon/v3/pricing ───>│  - pricingRelay  │          │             │
  pmm/bsc/v3/pricing ───────>│  - pricingServer │          └─────────────┘
  pmm/avalanche/v3/pricing ─>│                  │
                             └──────────────────┘
```

## Files to Create/Modify

### Server Side (rfq/)

| File | Status | Description |
|------|--------|-------------|
| `src/pricing-server.ts` | EXISTS | Standalone entry point |
| `src/pricingRelay.ts` | EXISTS | Connects to Bebop feeds, parses protobuf |
| `src/pricingServer.ts` | EXISTS | WebSocket server for frontends |
| `src/takerPricing.proto` | EXISTS | Protobuf schema for Bebop taker feed |
| `src/takerPricing_pb.js` | EXISTS | Generated protobuf code |
| `src/takerPricing_pb.d.ts` | EXISTS | Generated TypeScript types |
| `package.json` | MODIFIED | Added `dev:pricing` and `start:pricing` scripts |
| `.env.example` | MODIFIED | Added pricing relay config vars |

### Frontend (opswap/)

| File | Status | Description |
|------|--------|-------------|
| `app/hooks/usePricingStream.ts` | EXISTS | WebSocket hook with reconnection |
| `app/contexts/PricingContext.tsx` | EXISTS | Shared pricing provider |
| `app/providers.tsx` | MODIFIED | Added PricingProvider wrapper |
| `.env.example` | MODIFIED | Added `NEXT_PUBLIC_PRICING_WS_URL` |

## Configuration

### Server (.env)
```bash
# Bebop taker pricing credentials (request from Bebop)
BEBOP_PRICING_NAME=your-name
BEBOP_PRICING_AUTH=your-auth-token

# Chains to connect to (comma-separated)
BEBOP_CHAINS=ethereum,arbitrum,base,optimism,polygon,bsc,avalanche

# WebSocket server port for frontend connections
PRICING_WS_PORT=3004
```

### Frontend (.env.local)
```bash
# Pricing relay WebSocket URL
NEXT_PUBLIC_PRICING_WS_URL=ws://localhost:3004

# Enable/disable pricing stream (default: true)
NEXT_PUBLIC_ENABLE_PRICING_STREAM=true
```

## Running

### Start Pricing Relay Server
```bash
cd rfq
yarn dev:pricing
```

### Start Frontend
```bash
cd opswap
yarn dev
```

## WebSocket Protocol

### Client -> Server

**Subscribe to prices:**
```json
{
  "type": "subscribe",
  "chains": [1, 8453],
  "pairs": ["0xWETH.../0xUSDC..."]
}
```
- Empty `chains` array = subscribe to all chains
- Empty `pairs` array = subscribe to all pairs

**Ping:**
```json
{ "type": "ping" }
```

### Server -> Client

**Price update:**
```json
{
  "type": "price",
  "chainId": 1,
  "chain": "ethereum",
  "pair": "0x.../0x...",
  "base": "0x...",
  "quote": "0x...",
  "lastUpdateTs": 1706000000,
  "bids": [[0.366, 272.7], [0.365, 1363.6]],
  "asks": [[0.367, 272.7], [0.368, 1363.6]]
}
```

**Status:**
```json
{
  "type": "status",
  "connections": { "ethereum": true, "base": true },
  "subscribedChains": [1, 8453],
  "subscribedPairs": []
}
```

## Frontend Usage

```tsx
import { usePricing, useTokenPrice } from "@/app/contexts/PricingContext";

// Get connection status and all prices
const { prices, isConnected, connectionStatus } = usePricing();

// Get specific token price
const { bestBid, bestAsk } = useTokenPrice(1, "0xWETH...", "0xUSDC...");
```

## TODO

- [ ] Test Bebop connection with real credentials
- [ ] Verify protobuf parsing works correctly
- [ ] Test frontend WebSocket connection
- [ ] Add error handling for auth failures
- [ ] Consider adding HTTP fallback endpoint for initial price snapshot
