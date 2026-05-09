# Service Consolidation Plan

Merge `rfq`, `rfq-direct`, and `pricing` into a single `@greek/market-maker` package with mode-based execution.

## Current State (3 packages to merge)

| Package | Purpose | Ports |
|---------|---------|-------|
| **rfq** | Bebop PMM market maker | 3001 |
| **rfq-direct** | Standalone quote server | 3010, 3011 |
| **pricing** | Bebop price relay | 3004 |

> **Note:** `aggregator` package is being removed entirely—not needed for single market maker architecture.

## Target State (1 package)

```
@greek/market-maker    ← All 3 packages merged
```

**Run different services via yarn commands:**

```bash
yarn direct     # Standalone quote server (replaces rfq-direct)
yarn bebop      # Bebop PMM client (replaces rfq)
yarn relay      # Bebop price relay (replaces pricing)
yarn all        # Run everything
```

Or run multiple modes:
```bash
yarn direct:relay   # Quote server + price relay
```

---

## Why Full Merge?

1. **Single codebase** - One place for all pricing logic
2. **Shared dependencies** - No duplication of ws, express, viem, protobufjs
3. **Flexible deployment** - Run any combination via yarn command
4. **Simpler CI/CD** - One package to build, test, deploy
5. **Code reuse** - Black-Scholes, types, constants shared across modes

---

## Package Structure

```
market-maker/
├── src/
│   ├── index.ts                 # Entry point (mode router)
│   │
│   ├── modes/
│   │   ├── direct.ts            # yarn direct (from rfq-direct)
│   │   ├── bebop.ts             # yarn bebop (from rfq)
│   │   └── relay.ts             # yarn relay (from pricing)
│   │
│   ├── pricing/
│   │   ├── blackScholes.ts      # Unified BS implementation
│   │   ├── pricer.ts            # Pricing engine with Greeks
│   │   └── spotFeed.ts          # On-chain spot price feed
│   │
│   ├── servers/
│   │   ├── httpApi.ts           # Express quote server
│   │   ├── wsStream.ts          # WebSocket price broadcast
│   │   └── wsRelay.ts           # WebSocket relay server
│   │
│   ├── bebop/
│   │   ├── client.ts            # Bebop RFQ WebSocket client
│   │   ├── relay.ts             # Bebop pricing relay
│   │   ├── signing.ts           # Quote signing
│   │   └── proto/
│   │       ├── pricing.proto
│   │       └── pricing_pb.ts
│   │
│   ├── config/
│   │   ├── chains.ts            # Chain IDs, RPC URLs, block explorers
│   │   ├── tokens.ts            # Token addresses per chain
│   │   └── options.ts           # Option contract addresses
│   │
│   ├── constants.ts
│   └── types.ts
│
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Entry Point Design

```typescript
// market-maker/src/index.ts
import "dotenv/config";
import { Pricer } from "./pricing/pricer";
import { SpotFeed } from "./pricing/spotFeed";

const VALID_MODES = ["direct", "bebop", "relay", "all"] as const;
type Mode = typeof VALID_MODES[number];

const modes = (process.env.MODE || "direct").split(",").map(m => m.trim().toLowerCase());

// Validate modes
const invalidModes = modes.filter(m => !VALID_MODES.includes(m as Mode));
if (invalidModes.length > 0) {
  console.error(`Invalid mode(s): ${invalidModes.join(", ")}`);
  console.error(`Valid modes: ${VALID_MODES.join(", ")}`);
  process.exit(1);
}

// Shared instances (singleton pattern to avoid duplication)
let sharedPricer: Pricer | null = null;
let sharedSpotFeed: SpotFeed | null = null;

function getSharedPricer(): Pricer {
  if (!sharedPricer) {
    sharedSpotFeed = new SpotFeed();
    sharedPricer = new Pricer({ spotFeed: sharedSpotFeed });
    sharedSpotFeed.start();
  }
  return sharedPricer;
}

async function main() {
  console.log(`Starting market-maker in mode(s): ${modes.join(", ")}`);

  if (modes.includes("direct") || modes.includes("all")) {
    const { startDirectMode } = await import("./modes/direct");
    await startDirectMode(getSharedPricer());
  }

  if (modes.includes("bebop") || modes.includes("all")) {
    const { startBebopMode } = await import("./modes/bebop");
    await startBebopMode(getSharedPricer());
  }

  if (modes.includes("relay") || modes.includes("all")) {
    const { startRelayMode } = await import("./modes/relay");
    await startRelayMode();
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    sharedSpotFeed?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

---

## Environment Variables

```bash
# Mode selection (set via yarn command, or override with env var)
# MODE=direct              # Set automatically by yarn commands

# === COMMON ===
CHAIN_ID=8453            # Default chain (overridden by config/chains.ts)
MAKER_ADDRESS=0x...
PRIVATE_KEY=0x...        # For signing quotes

# === PRICING (direct & bebop modes) ===
DEFAULT_IV=0.8
RISK_FREE_RATE=0.05
BID_SPREAD=0.02
ASK_SPREAD=0.02
SPOT_POLL_INTERVAL=30000

# === DIRECT MODE ===
HTTP_PORT=3010
WS_PORT=3011
PRICE_BROADCAST_INTERVAL=5000

# === BEBOP MODE ===
BEBOP_MARKETMAKER=xxx
BEBOP_AUTHORIZATION=xxx
BEBOP_API_URL=https://api.bebop.xyz

# === RELAY MODE ===
RELAY_WS_PORT=3004
BEBOP_CHAINS=ethereum,base,arbitrum
```

---

## Master Chain & Token Configuration

### `config/chains.ts`

```typescript
// market-maker/src/config/chains.ts

export interface ChainConfig {
  id: number;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  // Price feed contracts (Chainlink or Uniswap TWAP)
  priceFeed: {
    ethUsd?: string;       // Chainlink ETH/USD
    uniV3Pool?: string;    // Uniswap V3 pool for TWAP
  };
}

export const CHAINS: Record<number, ChainConfig> = {
  // === MAINNETS ===
  1: {
    id: 1,
    name: "Ethereum",
    rpcUrl: process.env.RPC_ETHEREUM || "https://eth.llamarpc.com",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      ethUsd: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",  // Chainlink ETH/USD
    },
  },
  8453: {
    id: 8453,
    name: "Base",
    rpcUrl: process.env.RPC_BASE || "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      ethUsd: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",  // Chainlink ETH/USD on Base
    },
  },
  42161: {
    id: 42161,
    name: "Arbitrum One",
    rpcUrl: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
    blockExplorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      ethUsd: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",  // Chainlink ETH/USD on Arbitrum
    },
  },
  130: {
    id: 130,
    name: "Unichain",
    rpcUrl: process.env.RPC_UNICHAIN || "https://mainnet.unichain.org",
    blockExplorer: "https://uniscan.xyz",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      uniV3Pool: "0x...",  // WETH/USDC pool for TWAP (TBD)
    },
  },

  // === TESTNETS ===
  11155111: {
    id: 11155111,
    name: "Sepolia",
    rpcUrl: process.env.RPC_SEPOLIA || "https://rpc.sepolia.org",
    blockExplorer: "https://sepolia.etherscan.io",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      ethUsd: "0x694AA1769357215DE4FAC081bf1f309aDC325306",  // Chainlink ETH/USD Sepolia
    },
  },
  84532: {
    id: 84532,
    name: "Base Sepolia",
    rpcUrl: process.env.RPC_BASE_SEPOLIA || "https://sepolia.base.org",
    blockExplorer: "https://sepolia.basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {
      ethUsd: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",  // Chainlink ETH/USD Base Sepolia
    },
  },
  1301: {
    id: 1301,
    name: "Unichain Sepolia",
    rpcUrl: process.env.RPC_UNICHAIN_SEPOLIA || "https://sepolia.unichain.org",
    blockExplorer: "https://sepolia.uniscan.xyz",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {},  // No Chainlink on testnet - use fallback
  },
  31337: {
    id: 31337,
    name: "Anvil (Local)",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorer: "",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    priceFeed: {},  // Mock in tests
  },
};

export function getChain(chainId: number): ChainConfig {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unknown chain ID: ${chainId}`);
  return chain;
}

export function getChainByName(name: string): ChainConfig | undefined {
  return Object.values(CHAINS).find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}
```

### `config/tokens.ts`

```typescript
// market-maker/src/config/tokens.ts

export interface TokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

// Token addresses per chain
export const TOKENS: Record<number, Record<string, TokenConfig>> = {
  // === ETHEREUM MAINNET ===
  1: {
    WETH: {
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
    USDT: {
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      symbol: "USDT",
      decimals: 6,
      name: "Tether USD",
    },
    DAI: {
      address: "0x6B175474E89094C44Da98b954EescdeCB5BBCFA0",
      symbol: "DAI",
      decimals: 18,
      name: "Dai Stablecoin",
    },
    WBTC: {
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      symbol: "WBTC",
      decimals: 8,
      name: "Wrapped BTC",
    },
  },

  // === BASE MAINNET ===
  8453: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
    USDbC: {
      address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      symbol: "USDbC",
      decimals: 6,
      name: "USD Base Coin (Bridged)",
    },
    cbETH: {
      address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      symbol: "cbETH",
      decimals: 18,
      name: "Coinbase Wrapped Staked ETH",
    },
  },

  // === ARBITRUM ONE ===
  42161: {
    WETH: {
      address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
    "USDC.e": {
      address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
      symbol: "USDC.e",
      decimals: 6,
      name: "USD Coin (Bridged)",
    },
    ARB: {
      address: "0x912CE59144191C1204E64559FE8253a0e49E6548",
      symbol: "ARB",
      decimals: 18,
      name: "Arbitrum",
    },
  },

  // === UNICHAIN MAINNET ===
  130: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x078D888E40faAe0f32594342c85940AF0b45DA6D",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
  },

  // === SEPOLIA TESTNET ===
  11155111: {
    WETH: {
      address: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
  },

  // === BASE SEPOLIA ===
  84532: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
  },

  // === UNICHAIN SEPOLIA ===
  1301: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
  },

  // === ANVIL (LOCAL) ===
  31337: {
    WETH: {
      address: "0x...",  // Deployed by test setup
      symbol: "WETH",
      decimals: 18,
      name: "Wrapped Ether",
    },
    USDC: {
      address: "0x...",  // Deployed by test setup
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    },
  },
};

export function getToken(chainId: number, symbol: string): TokenConfig {
  const chainTokens = TOKENS[chainId];
  if (!chainTokens) throw new Error(`No tokens configured for chain ${chainId}`);
  const token = chainTokens[symbol];
  if (!token) throw new Error(`Token ${symbol} not found on chain ${chainId}`);
  return token;
}

export function getTokenByAddress(chainId: number, address: string): TokenConfig | undefined {
  const chainTokens = TOKENS[chainId];
  if (!chainTokens) return undefined;
  return Object.values(chainTokens).find(
    (t) => t.address.toLowerCase() === address.toLowerCase()
  );
}
```

### `config/options.ts`

```typescript
// market-maker/src/config/options.ts

export interface OptionDeployment {
  factory: string;
  options: string[];  // Deployed option contract addresses
}

// Option contract addresses per chain
export const OPTIONS: Record<number, OptionDeployment> = {
  // === BASE MAINNET ===
  8453: {
    factory: "0x...",  // OptionFactory address
    options: [
      // Add deployed option addresses here
    ],
  },

  // === UNICHAIN MAINNET ===
  130: {
    factory: "0x...",
    options: [],
  },

  // === UNICHAIN SEPOLIA ===
  1301: {
    factory: "0x...",
    options: [
      // Test options
    ],
  },

  // === ANVIL (LOCAL) ===
  31337: {
    factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3",  // Deterministic address
    options: [],
  },
};

export function getOptionFactory(chainId: number): string {
  const deployment = OPTIONS[chainId];
  if (!deployment) throw new Error(`No options deployed on chain ${chainId}`);
  return deployment.factory;
}

export function getOptionAddresses(chainId: number): string[] {
  return OPTIONS[chainId]?.options ?? [];
}

export function isOptionToken(chainId: number, address: string): boolean {
  const options = getOptionAddresses(chainId);
  return options.some((o) => o.toLowerCase() === address.toLowerCase());
}
```

---

## File Migration Map

### From `rfq/`

| Source | Destination | Notes |
|--------|-------------|-------|
| `client.ts` | `bebop/client.ts` | Bebop RFQ client |
| `blackScholes.ts` | `pricing/blackScholes.ts` | Merge with rfq-direct |
| `optionMetadata.ts` | `options/metadata.ts` | Keep |
| `optionsList.ts` | `options/registry.ts` | Merge |
| `pricing_pb.*` | `bebop/proto/` | Keep |
| `signing.ts` | `bebop/signing.ts` | Keep |
| `api.ts` | Remove | Replaced by servers/httpApi |
| `constants.ts` | `constants.ts` | Merge |
| `types.ts` | `types.ts` | Merge |

### From `rfq-direct/`

| Source | Destination | Notes |
|--------|-------------|-------|
| `blackScholes.ts` | `pricing/blackScholes.ts` | **Prefer** - has Greeks |
| `pricer.ts` | `pricing/pricer.ts` | Keep |
| `spotFeed.ts` | `pricing/spotFeed.ts` | Keep |
| `quoteServer.ts` | `servers/httpApi.ts` | Keep |
| `pricingStream.ts` | `servers/wsStream.ts` | Keep |
| `types.ts` | `types.ts` | Merge |

### From `pricing/`

| Source | Destination | Notes |
|--------|-------------|-------|
| `pricingRelay.ts` | `bebop/relay.ts` | Keep |
| `pricingServer.ts` | `servers/wsRelay.ts` | Keep |
| `takerPricing.proto` | `bebop/proto/` | Merge with pricing.proto |
| `takerPricing_pb.*` | `bebop/proto/` | Regenerate after merge |
| `optionTokens.ts` | `config/options.ts` | Merge |

### Aggregator Package

**Action:** Delete entirely. Not needed for single market maker architecture.


---

## Mode Implementations

### Direct Mode (from rfq-direct)

```typescript
// modes/direct.ts
import { Pricer } from "../pricing/pricer";
import { createHttpApi } from "../servers/httpApi";
import { createWsStream } from "../servers/wsStream";

export async function startDirectMode(pricer: Pricer) {
  // Start HTTP API
  const httpServer = createHttpApi(pricer);
  httpServer.listen(process.env.HTTP_PORT || 3010);
  console.log(`HTTP API listening on port ${process.env.HTTP_PORT || 3010}`);

  // Start WebSocket broadcast
  const wsServer = createWsStream(pricer);
  wsServer.listen(process.env.WS_PORT || 3011);
  console.log(`WebSocket stream on port ${process.env.WS_PORT || 3011}`);
}
```

### Bebop Mode (from rfq)

```typescript
// modes/bebop.ts
import { Pricer } from "../pricing/pricer";
import { BebopClient } from "../bebop/client";

export async function startBebopMode(pricer: Pricer) {
  // Connect to Bebop RFQ
  const bebopClient = new BebopClient({
    marketmaker: process.env.BEBOP_MARKETMAKER!,
    authorization: process.env.BEBOP_AUTHORIZATION!,
    apiUrl: process.env.BEBOP_API_URL || "https://api.bebop.xyz",
    onRfq: (rfq) => pricer.handleRfq(rfq),
  });

  await bebopClient.connect();
  console.log("Connected to Bebop RFQ");
}
```

### Relay Mode (from pricing)

```typescript
// modes/relay.ts
import { BebopRelay } from "../bebop/relay";
import { createWsRelay } from "../servers/wsRelay";

export async function startRelayMode() {
  const chains = (process.env.BEBOP_CHAINS || "ethereum").split(",");

  // Connect to Bebop pricing feeds
  const relay = new BebopRelay({ chains });
  await relay.connect();

  // Start local WebSocket server
  const wsServer = createWsRelay(relay);
  wsServer.listen(process.env.RELAY_WS_PORT || 3004);
  console.log(`Bebop relay listening on port ${process.env.RELAY_WS_PORT || 3004}`);
}
```

---

## Package.json

```json
{
  "name": "@greek/market-maker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "MODE=direct tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",

    "direct": "MODE=direct tsx src/index.ts",
    "bebop": "MODE=bebop tsx src/index.ts",
    "relay": "MODE=relay tsx src/index.ts",
    "all": "MODE=all tsx src/index.ts",

    "direct:relay": "MODE=direct,relay tsx src/index.ts",
    "bebop:relay": "MODE=bebop,relay tsx src/index.ts",

    "dev:direct": "MODE=direct tsx watch src/index.ts",
    "dev:bebop": "MODE=bebop tsx watch src/index.ts",
    "dev:relay": "MODE=relay tsx watch src/index.ts",
    "dev:all": "MODE=all tsx watch src/index.ts",

    "proto": "pbjs -t static-module -w es6 -o src/bebop/proto/pricing_pb.js src/bebop/proto/*.proto && pbts -o src/bebop/proto/pricing_pb.d.ts src/bebop/proto/pricing_pb.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^5.2.1",
    "protobufjs": "^8.0.0",
    "viem": "^2.44.1",
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5",
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "protobufjs-cli": "^2.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.9.3"
  }
}
```

---

## Implementation Notes & Resolutions

### 1. Shared Pricer Instance (Singleton Pattern)
**Issue:** When running `MODE=all`, both direct and bebop modes would create separate `Pricer` instances, causing duplicate spot price subscriptions and wasted resources.

**Resolution:** Use singleton pattern in `index.ts` to create one shared `Pricer` and `SpotFeed` instance. All modes receive the same instance via parameter.

### 2. Graceful Shutdown
**Issue:** Containerized deployments need proper cleanup on SIGTERM/SIGINT.

**Resolution:** Added shutdown handlers in main entry point to stop spot feed and exit cleanly.

### 3. Invalid Mode Validation
**Issue:** Typos in MODE env var (e.g., `MODE=typo`) would silently start nothing.

**Resolution:** Validate modes against `VALID_MODES` array and exit with error message if invalid.

### 4. Protobuf File Conflicts
**Issue:** Both `pricing.proto` (from rfq) and `takerPricing.proto` (from pricing) merge into `bebop/proto/`.

**Action Required:** Review both proto files for message name collisions before merging. Rename if needed.

### 5. Consistent Naming: Relay vs Feed
**Issue:** File migration shows `pricingRelay.ts` → `bebop/pricingFeed.ts` but code uses `BebopRelay` class.

**Resolution:** Use consistent "relay" terminology:
- File: `bebop/relay.ts`
- Class: `BebopRelay`

### 6. On-Chain Spot Price Source
**Preference:** Use on-chain price feeds (Chainlink or Uniswap TWAP) instead of CoinGecko API.

**Implementation:** `SpotFeed` class reads from Chainlink price feeds configured in `config/chains.ts`. Fallback to Uniswap V3 TWAP for chains without Chainlink.

### 7. Master Chain Configuration
All chain IDs, RPC URLs, token addresses, and price feed contracts centralized in `config/` directory for easy maintenance and deployment across networks.

---

## Migration Steps

### Phase 1: Create Package Structure

1. Create `market-maker/` directory
2. Create folder structure (modes/, pricing/, servers/, bebop/, options/)
3. Create package.json and tsconfig.json
4. Create .env.example

### Phase 2: Migrate Pricing Core

1. Copy rfq-direct's `blackScholes.ts` (has Greeks)
2. Copy rfq-direct's `pricer.ts` and `spotFeed.ts`
3. Merge type definitions from all packages
4. Test: `MODE=direct yarn dev` should price options

### Phase 3: Migrate Direct Mode

1. Copy rfq-direct's `quoteServer.ts` → `servers/httpApi.ts`
2. Copy rfq-direct's `pricingStream.ts` → `servers/wsStream.ts`
3. Create `modes/direct.ts` entry point
4. Test: HTTP and WebSocket should work

### Phase 4: Migrate Bebop Mode

1. Copy rfq's `client.ts` → `bebop/client.ts`
2. Copy rfq's protobuf files → `bebop/proto/`
3. Copy rfq's `signing.ts` → `bebop/signing.ts`
4. Create `modes/bebop.ts` entry point
5. Test: Should connect to Bebop (testnet)

### Phase 5: Migrate Relay Mode

1. Copy pricing's `pricingRelay.ts` → `bebop/pricingFeed.ts`
2. Copy pricing's `pricingServer.ts` → `servers/wsRelay.ts`
3. Copy pricing's protobuf files → `bebop/proto/`
4. Create `modes/relay.ts` entry point
5. Test: Should relay Bebop prices

### Phase 6: Cleanup

1. Remove old packages from root package.json workspaces
2. Delete `rfq/`, `rfq-direct/`, `pricing/`, `aggregator/` directories
3. Update root package.json scripts
4. Run `yarn install`
5. Update CLAUDE.md

---

## Final Workspace Structure

```
protocol/
├── foundry/           # Solidity contracts
├── core/              # Next.js frontend
├── market-maker/      # All pricing/quoting services
├── package.json
└── yarn.lock
```

**Root package.json workspaces:**
```json
{
  "workspaces": {
    "packages": [
      "foundry",
      "core",
      "market-maker"
    ]
  }
}
```

---

## Success Criteria

### Functionality Tests
- [ ] `yarn direct` - HTTP API serves quotes on port 3010
- [ ] `yarn direct` - WebSocket stream broadcasts prices on port 3011
- [ ] `yarn bebop` - Connects to Bebop RFQ successfully
- [ ] `yarn relay` - Relays Bebop prices on port 3004
- [ ] `yarn all` - All three modes run together without conflicts
- [ ] `yarn direct:relay` - Combination modes work
- [ ] Spot prices fetch correctly from on-chain sources (Chainlink)
- [ ] Black-Scholes calculations match rfq-direct implementation
- [ ] Greeks (delta, gamma, theta, vega) calculate correctly
- [ ] Option metadata fetches from factory contract events

### Integration Tests
- [ ] Frontend connects to market-maker WebSocket
- [ ] Frontend fetches quotes via HTTP API
- [ ] Bid/ask spreads apply correctly
- [ ] Put strike normalization works (1/strike)
- [ ] Multi-chain support works (Base, Unichain, etc.)

### Cleanup
- [ ] Old packages (`rfq/`, `rfq-direct/`, `pricing/`, `aggregator/`) deleted
- [ ] Root `package.json` workspaces updated
- [ ] `yarn install` succeeds with no errors
- [ ] TypeScript compilation passes (`yarn build`)
- [ ] Protobuf files regenerate correctly (`yarn proto`)
- [ ] CLAUDE.md updated with new structure
