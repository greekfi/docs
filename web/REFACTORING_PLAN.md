# 🎯 Market-Maker Code Simplification Plan

## Executive Summary

The market-maker codebase is well-structured with good separation of concerns, but contains **moderate code duplication** across WebSocket implementations, lifecycle management, and configuration. This plan identifies **9 major refactoring opportunities** that will reduce ~300+ lines of code and improve maintainability.

---

## 📊 Duplication Analysis

### High-Priority Duplications (Most Impact)

#### 1. **WebSocket Heartbeat Pattern** (3× duplicated)
**Location**:
- `bebop/client.ts:85-98`
- `servers/wsStream.ts:202-214`
- `servers/wsRelay.ts:323-331`

**Duplication**: ~40 lines × 3 = **120 lines**

**Pattern**:
```typescript
// All three files have nearly identical code:
private heartbeatInterval: NodeJS.Timeout | null = null;

private startHeartbeat(): void {
  this.heartbeatInterval = setInterval(() => {
    // ping logic (varies slightly)
  }, 30000);
}

private stopHeartbeat(): void {
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }
}
```

**Recommended Solution**: Create `utils/heartbeat.ts`
```typescript
export class HeartbeatManager {
  private interval: NodeJS.Timeout | null = null;

  start(callback: () => void, intervalMs: number = 30000): void {
    this.stop();
    this.interval = setInterval(callback, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
```

**Usage**:
```typescript
// In BebopClient, PricingStream, PricingServer
private heartbeat = new HeartbeatManager();
this.heartbeat.start(() => this.ws?.ping());
this.heartbeat.stop();
```

---

#### 2. **Exponential Backoff Reconnection** (2× duplicated)
**Location**:
- `bebop/client.ts:100-113`
- `bebop/pricingStream.ts:189-202`

**Duplication**: ~35 lines × 2 = **70 lines**

**Pattern**:
```typescript
private reconnectAttempts = 0;
private maxReconnectAttempts = 10;
private reconnectDelay = 1000;

private scheduleReconnect(): void {
  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
    console.error("Max reconnect attempts reached");
    return;
  }
  const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
  setTimeout(() => {
    this.reconnectAttempts++;
    this.connect().catch(console.error);
  }, delay);
}
```

**Recommended Solution**: Create `utils/reconnection.ts`
```typescript
export class ReconnectionManager {
  private attempts = 0;

  constructor(
    private maxAttempts: number = 10,
    private baseDelay: number = 1000
  ) {}

  schedule(reconnectFn: () => Promise<void> | void): boolean {
    if (this.attempts >= this.maxAttempts) {
      console.error("Max reconnect attempts reached");
      return false;
    }

    const delay = this.baseDelay * Math.pow(2, this.attempts);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.attempts + 1}/${this.maxAttempts})`);

    setTimeout(() => {
      this.attempts++;
      Promise.resolve(reconnectFn()).catch(console.error);
    }, delay);

    return true;
  }

  reset(): void {
    this.attempts = 0;
  }
}
```

---

#### 3. **WebSocket Client Subscription Management** (2× duplicated)
**Location**:
- `servers/wsStream.ts:11-16, 41-146`
- `servers/wsRelay.ts:12-34, 83-202`

**Duplication**: ~100 lines × 2 = **200 lines**

**Pattern**: Both implement:
- Client tracking with `Map<WebSocket, ClientState>`
- Subscribe/unsubscribe message handling
- Subscription filtering logic

**Recommended Solution**: Create `servers/BaseWebSocketServer.ts`
```typescript
export abstract class BaseWebSocketServer<TSubscription> {
  protected wss: WebSocketServer;
  protected clients: Map<WebSocket, TSubscription> = new Map();
  protected heartbeat = new HeartbeatManager();

  constructor(port: number, host: string = "0.0.0.0") {
    this.wss = new WebSocketServer({ port, host });
    this.setupServer();
    this.startHeartbeat();
  }

  private setupServer(): void {
    this.wss.on("connection", (ws) => {
      const subscription = this.createSubscription();
      this.clients.set(ws, subscription);
      this.onClientConnected(ws, subscription);

      ws.on("message", (data) => this.handleMessage(ws, data));
      ws.on("close", () => this.onClientDisconnected(ws));
      ws.on("error", (err) => this.onClientError(ws, err));
    });
  }

  protected abstract createSubscription(): TSubscription;
  protected abstract handleMessage(ws: WebSocket, data: Buffer): void;
  protected abstract onClientConnected(ws: WebSocket, sub: TSubscription): void;

  protected send(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  protected broadcast(message: object, filter?: (sub: TSubscription) => boolean): void {
    for (const [ws, subscription] of this.clients) {
      if (!filter || filter(subscription)) {
        this.send(ws, message);
      }
    }
  }

  public shutdown(): void {
    this.heartbeat.stop();
    for (const ws of this.clients.keys()) {
      ws.close(1000, "Server shutdown");
    }
    this.wss.close();
  }
}
```

**Usage**:
```typescript
// servers/wsStream.ts becomes:
export class PricingStream extends BaseWebSocketServer<ClientConnection> {
  protected createSubscription(): ClientConnection {
    return {
      subscribedOptions: new Set(),
      subscribedUnderlyings: new Set(),
      isAlive: true,
    };
  }

  protected handleMessage(ws: WebSocket, data: Buffer): void {
    // Handle subscribe/unsubscribe specific to pricing stream
  }

  // Only implement pricing-specific logic
}
```

---

#### 4. **Environment Variable Parsing** (Scattered throughout)
**Location**:
- `bebop/client.ts:16`
- `modes/bebop.ts:14-17`
- `servers/wsStream.ts:295`
- `servers/wsRelay.ts:356`
- Multiple other files

**Problem**: `parseInt(process.env.X || "default")` repeated everywhere

**Recommended Solution**: Create `config/env.ts`
```typescript
export const ENV = {
  // Chain config
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "1"),
  CHAIN_NAME: process.env.CHAIN || "ethereum",

  // Maker config
  MAKER_ADDRESS: process.env.MAKER_ADDRESS || "0x0000000000000000000000000000000000000000",
  PRIVATE_KEY: process.env.PRIVATE_KEY,

  // Bebop config
  BEBOP_MARKETMAKER: process.env.BEBOP_MARKETMAKER || "",
  BEBOP_AUTHORIZATION: process.env.BEBOP_AUTHORIZATION || "",
  BEBOP_API_URL: process.env.BEBOP_API_URL || "https://api.bebop.xyz",

  // Server ports
  HTTP_PORT: parseInt(process.env.HTTP_PORT || "3010"),
  WS_PORT: parseInt(process.env.WS_PORT || "3011"),
  RELAY_WS_PORT: parseInt(process.env.RELAY_WS_PORT || "3004"),

  // Pricing config
  DEFAULT_IV: parseFloat(process.env.DEFAULT_IV || "0.8"),
  RISK_FREE_RATE: parseFloat(process.env.RISK_FREE_RATE || "0.05"),
  BID_SPREAD: parseFloat(process.env.BID_SPREAD || "0.02"),
  ASK_SPREAD: parseFloat(process.env.ASK_SPREAD || "0.02"),

  // Intervals
  SPOT_POLL_INTERVAL: parseInt(process.env.SPOT_POLL_INTERVAL || "30000"),
  WS_UPDATE_INTERVAL: parseInt(process.env.WS_UPDATE_INTERVAL || "5000"),
  PRICE_BROADCAST_INTERVAL: parseInt(process.env.PRICE_BROADCAST_INTERVAL || "5000"),
} as const;
```

**Usage**: Replace all `process.env.X` with `ENV.X`

---

#### 5. **Entry Point Initialization** (3× duplicated)
**Location**:
- `direct.ts:7-31`
- `bebop.ts:7-70`
- `relay.ts:5-23`

**Duplication**: Similar patterns for dotenv, initialization, shutdown

**Recommended Solution**: Create `utils/lifecycle.ts`
```typescript
export async function initializeMarketMaker<T>(
  mode: string,
  init: () => Promise<T>,
  shutdown: (instance: T) => Promise<void>
): Promise<void> {
  console.log(`Starting market-maker in ${mode.toUpperCase()} mode`);

  const instance = await init();

  const handleShutdown = async () => {
    console.log("\nShutting down...");
    await shutdown(instance);
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}
```

**Usage**:
```typescript
// direct.ts becomes:
import { initializeMarketMaker } from "./utils/lifecycle";

initializeMarketMaker(
  "direct",
  async () => {
    const spotFeed = new SpotFeed();
    const pricer = new Pricer({ spotFeed });
    spotFeed.start();
    await startDirectMode(pricer);
    return { spotFeed, pricer };
  },
  async ({ spotFeed }) => {
    spotFeed.stop();
  }
).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

---

### Medium-Priority Duplications

#### 6. **USDC Addresses Hardcoded** (Should be in config)
**Location**: `modes/bebop.ts:7-11`

**Problem**: Hardcoded token addresses that exist in `config/tokens.ts`

**Recommended Solution**:
```typescript
// Delete lines 7-11 from modes/bebop.ts
// Replace with:
import { getToken } from "../config/tokens";

const usdcAddress = getToken(chainId, "USDC").address;
```

---

#### 7. **Interval Management Pattern** (5× implementations)
**Problem**: Each class manually manages intervals

**Recommended Solution**: Create `utils/interval.ts`
```typescript
export class IntervalManager {
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  start(name: string, callback: () => void, intervalMs: number): void {
    this.stop(name);
    const interval = setInterval(callback, intervalMs);
    this.intervals.set(name, interval);
  }

  stop(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  stopAll(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}
```

**Usage**:
```typescript
private intervals = new IntervalManager();

// Instead of:
this.updateInterval = setInterval(() => { ... }, 5000);
this.heartbeatInterval = setInterval(() => { ... }, 30000);

// Use:
this.intervals.start("updates", () => { ... }, 5000);
this.intervals.start("heartbeat", () => { ... }, 30000);

// Cleanup:
this.intervals.stopAll();
```

---

#### 8. **WebSocket Send Pattern** (3× duplicated)
**Location**:
- `servers/wsStream.ts:180-184`
- `servers/wsRelay.ts:316-320`

**Solution**: Extract to `BaseWebSocketServer` (covered in #3)

---

#### 9. **Graceful Shutdown Logic** (Duplicated in modes + entry points)
**Location**: All mode files and entry points

**Solution**: Covered by lifecycle manager in #5

---

## 📋 Implementation Order

### Phase 1: Utilities (No Breaking Changes)
1. ✅ Create `utils/heartbeat.ts` - HeartbeatManager
2. ✅ Create `utils/reconnection.ts` - ReconnectionManager
3. ✅ Create `utils/interval.ts` - IntervalManager
4. ✅ Create `utils/lifecycle.ts` - initializeMarketMaker
5. ✅ Create `config/env.ts` - Centralized environment variables

### Phase 2: Refactor Existing Classes (Use utilities)
6. ✅ Refactor `bebop/client.ts` to use HeartbeatManager + ReconnectionManager
7. ✅ Refactor `bebop/pricingStream.ts` to use ReconnectionManager
8. ✅ Refactor all classes to use ENV instead of process.env
9. ✅ Remove USDC_ADDRESSES from `modes/bebop.ts`, use `config/tokens.ts`

### Phase 3: Base Classes (Bigger refactor)
10. ✅ Create `servers/BaseWebSocketServer.ts`
11. ✅ Refactor `servers/wsStream.ts` to extend BaseWebSocketServer
12. ✅ Refactor `servers/wsRelay.ts` to extend BaseWebSocketServer

### Phase 4: Entry Points (Final cleanup)
13. ✅ Refactor `direct.ts`, `bebop.ts`, `relay.ts` to use lifecycle manager

---

## 📈 Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Lines of Code | ~2,800 | ~2,400 | **-14%** |
| Duplicated Patterns | 9 major | 0 | **-100%** |
| Utility Modules | 0 | 5 | **+5** |
| Base Classes | 0 | 1 | **+1** |
| Maintainability | Medium | High | **↑** |
| Test Coverage Needed | Low | Medium | **↑** |

---

## ⚠️ Risks & Considerations

1. **Breaking Changes**: Phase 3 (BaseWebSocketServer) requires careful testing
2. **Testing**: Defer unit tests until later (per discussion)
3. **Backwards Compatibility**: Maintain all existing functionality
4. **Type Safety**: Ensure TypeScript types are preserved throughout
5. **Performance**: No performance impact expected (same runtime behavior)

---

## 🎯 Quick Wins (Can be done immediately)

These have **zero risk** and immediate benefit:

1. **Create `config/env.ts`** → Replace scattered env parsing (~50 lines saved)
2. **Create `utils/heartbeat.ts`** → Immediate reuse in 3 files (~80 lines saved)
3. **Remove USDC hardcode** → Use existing `config/tokens.ts` (~5 lines saved)
4. **Create `utils/reconnection.ts`** → Reuse in 2 files (~50 lines saved)

**Total quick wins**: ~185 lines removed with minimal risk

---

## 🔍 Additional Observations

### Superfluous Code Found:

1. **`servers/wsStream.ts:294-300`** - Factory function `createWsStream`
   - Only used in one place, could be inlined
   - **Recommendation**: Remove factory, instantiate directly

2. **`servers/wsRelay.ts:350-358`** - Duplicate factory functions
   - Two factory functions (`startPricingServer` and `createWsRelay`) for same thing
   - **Recommendation**: Keep one, remove the other

3. **`bebop/client.ts:158-173`** - Legacy message handling
   - Has both new Bebop format and "legacy support"
   - **Status**: Keep legacy format (still in use)

4. **`bebop/pricingStream.ts:151`** - Decimals comment misleading
   - Says "Option tokens have 6 decimals" but depends on collateral token
   - Could be USDC (6 decimals) or WETH (18 decimals)
   - **Recommendation**: Update comment to clarify it varies by collateral

5. **Unused imports/exports** - Would need full linting to find
   - **Recommendation**: Run `eslint` with `no-unused-vars` rule (defer for later)

---

## 📝 Clarifications from Discussion

1. **Legacy Bebop message format** (`bebop/client.ts:158-173`) - **KEEP** (still in use)
2. **Option token decimals** - Varies based on collateral token (USDC=6, WETH=18)
3. **Backwards compatibility** - Maintain all existing functionality
4. **Unit tests** - Defer until later
5. **Bundled index.ts** - Shelve for later (not high priority)

---

## 🚀 Next Steps

Recommended implementation order:
1. Start with **Phase 1** (utility modules) - zero risk, immediate value
2. Progress to **Phase 2** (adopt utilities in existing code)
3. Tackle **Phase 3** (base classes) with careful testing
4. Complete with **Phase 4** (entry point cleanup)

Estimated effort: 2-3 days for full implementation
