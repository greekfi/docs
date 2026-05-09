# Build Infrastructure Simplification Analysis

Analysis of the yarn/npm/make infrastructure after restructuring from `packages/*` to root-level packages.

## Current State Summary

| Package | Name | Runtime | Build Tool |
|---------|------|---------|------------|
| foundry | `@se-2/foundry` | Node + Foundry | Makefile + package.json |
| opswap | `@se-2/opswap` | Next.js | package.json |
| rfq | `rfq` | ts-node | package.json |
| rfq-direct | `rfq-direct` | ts-node | package.json |
| aggregator | `@greek/aggregator` | tsx | package.json |
| pricing | `pricing` | ts-node | package.json |

---

## Issues Identified

### 1. Duplicate `resolutions` and `overrides` in Root package.json

**Problem**: The root package.json has nearly identical entries in both `resolutions` (Yarn) and `overrides` (npm).

```json
"resolutions": {
  "next": "16.0.10",
  "@walletconnect/ethereum-provider": "2.23.0",
  // ... 12 more entries
},
"overrides": {
  // ... same entries minus "next"
}
```

**Solution**: Remove `overrides` entirely. This project uses Yarn 4 (via `packageManager: "yarn@4.12.0"`), so only `resolutions` is needed. npm's `overrides` is redundant.

**Impact**: -14 lines from root package.json

---

### 2. Inconsistent Package Naming

**Problem**: Three different naming conventions:
- `@se-2/*` - Scaffold-ETH 2 legacy (foundry, opswap)
- `@greek/*` - New namespace (aggregator)
- Bare names - No namespace (rfq, rfq-direct, pricing)

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| A: All `@greek/*` | Consistent, professional | Need to update all references |
| B: All bare names | Simple, less typing | Less organization for larger projects |
| C: Keep mixed | No work needed | Confusing, unprofessional |

Let's go with Option A

**Recommendation**: Option A - Rename to `@greek/*` for consistency. Update:
- `@se-2/foundry` → `@greek/foundry`
- `@se-2/opswap` → `@greek/opswap`
- `rfq` → `@greek/rfq`
- `rfq-direct` → `@greek/rfq-direct`
- `pricing` → `@greek/pricing`

---

### 3. Makefile Indirection in Foundry

**Problem**: foundry/package.json has scripts that just call Makefile targets:

```json
"scripts": {
  "chain": "make chain",
  "compile": "make compile",
  "flatten": "make flatten",
  "format": "make format",
  "lint": "make lint"
}
```

This creates unnecessary indirection: `yarn chain` → `make chain` → `anvil`

**Analysis of Makefile targets**:

| Target | Complexity | Keep? |
|--------|------------|-------|
| `chain` | Has `setup-anvil-wallet` dependency | Keep in Makefile |
| `fork` | Has `setup-anvil-wallet` dependency | Keep in Makefile |
| `setup-anvil-wallet` | Multi-step cleanup + import | Keep in Makefile |
| `deploy` | Complex conditional logic | Keep in Makefile |
| `compile` | Just `forge compile` | Inline to package.json |
| `flatten` | Just `forge flatten` | Inline to package.json |
| `format` | Just `forge fmt && prettier ...` | Inline to package.json |
| `lint` | Just `forge fmt --check && prettier ...` | Inline to package.json |
| `test` | Just `forge test` | Inline to package.json |

**Recommendation**: Keep Makefile for targets with dependencies or complex logic. Inline trivial wrappers:

```json
"scripts": {
  "chain": "make chain",
  "compile": "forge compile",
  "format": "forge fmt && prettier --write ./scripts-js/**/*.js",
  "lint": "forge fmt --check && prettier --check ./scripts-js/**/*.js",
  "test": "forge test"
}
```

**Trade-off**: The `setup-anvil-wallet` dependency chain is valuable - it ensures the wallet is configured before anvil starts. Keep that in the Makefile.

---

### 4. Duplicate TypeScript Versions

**Problem**: Four different TypeScript versions across packages:

| Package | TypeScript Version |
|---------|-------------------|
| opswap | `^5.9.3` |
| rfq | `^5.7.2` |
| rfq-direct | `^5.7.2` |
| aggregator | `^5.3.3` |
| pricing | `^5.7.2` |

**Solution**: Add to root package.json `resolutions`:

```json
"resolutions": {
  "typescript": "~5.9.3"
}
```

Then remove `typescript` from individual packages' devDependencies.

---

### 5. Duplicate Dependencies Across Service Packages

**Problem**: rfq, rfq-direct, pricing, aggregator share many deps but with version inconsistencies:

| Dependency | rfq | rfq-direct | pricing | aggregator | foundry |
|------------|-----|------------|---------|------------|---------|
| dotenv | ^16.4.5 | ^16.4.5 | ^16.4.5 | ^16.3.1 | ~17.2.3 |
| ws | ^8.19.0 | ^8.19.0 | ^8.19.0 | ^8.18.0 | - |
| @types/node | ^22.10.2 | ^22.10.2 | ^22.10.2 | ^20.10.6 | - |
| @types/ws | ^8.5.13 | ^8.5.13 | ^8.5.13 | ^8.5.10 | - |
| nodemon | ^3.1.9 | ^3.1.9 | ^3.1.9 | - | - |
| ts-node | ^10.9.2 | ^10.9.2 | ^10.9.2 | - | - |
| typescript | ^5.7.2 | ^5.7.2 | ^5.7.2 | ^5.3.3 | - |

Note: opswap has `@types/node: ~24.10.4` (even newer).

**Solution**: Use `resolutions` to pin versions and let Yarn hoist:

```json
"resolutions": {
  "dotenv": "^16.4.5",
  "ws": "^8.19.0",
  "@types/node": "^22.10.2",
  "@types/ws": "^8.5.13"
}
```

Note: foundry's `dotenv: ~17.2.3` is intentionally newer - evaluate if other packages should upgrade or if foundry should downgrade.

---

### 6. Express Version Inconsistency

**Problem**:
- aggregator: `express@^4.18.2` (v4) with `@types/express@^4.17.21`
- rfq: `express@^5.2.1` (v5) with `@types/express@^5`
- rfq-direct: `express@^5.2.1` (v5) with `@types/express@^5`

**Solution**: Standardize on Express 5 (it's stable now):

```json
"resolutions": {
  "express": "^5.2.1"
}
```

Update aggregator to use Express 5 patterns and `@types/express@^5`.

---

### 7. Different Dev Runners (nodemon vs tsx)

**Problem**:
- rfq, rfq-direct, pricing use `nodemon` + `ts-node`
- aggregator uses `tsx`

`tsx` is newer, faster, and simpler (no separate nodemon needed for watch mode).

**Recommendation**: Standardize on `tsx` for all TypeScript services:

```json
"scripts": {
  "dev": "tsx watch src/index.ts",
  "start": "tsx src/index.ts"
}
```

This removes `nodemon` and `ts-node` dependencies.

---

### 8. Redundant `packageManager` Declarations

**Problem**: The root package.json declares `"packageManager": "yarn@4.12.0"`, but so do:
- rfq/package.json
- rfq-direct/package.json
- pricing/package.json

In a Yarn workspace, child packages inherit the package manager from the root.

**Solution**: Remove `packageManager` from all child package.json files.

**Impact**: -3 lines across packages, clearer hierarchy

---

### 9. viem Version Inconsistency

**Problem**:
- opswap: `viem@2.42.1` (exact, older)
- rfq: `viem@^2.44.1` (caret, newer)
- rfq-direct: `viem@^2.44.1` (caret, newer)

**Solution**: Standardize via resolutions:

```json
"resolutions": {
  "viem": "^2.44.1"
}
```

Or update opswap to match.

---

### 10. @types/cors Inconsistency

**Problem**:
- rfq, rfq-direct: `@types/cors@^2`
- aggregator: `@types/cors@^2.8.17`

**Solution**: Use explicit version everywhere or add to resolutions:

```json
"resolutions": {
  "@types/cors": "^2.8.17"
}
```

---

### 11. Vestigial/Rarely-Used Scripts

**Problem**: Several scripts exist that are rarely or never used:

| Script | Package | Usage |
|--------|---------|-------|
| `vercel:yolo` | opswap | Bypasses build errors - dangerous for production |
| `flatten` | foundry | Rarely needed |
| `faucet` | foundry | Development convenience only |
| `account:reveal-pk` | foundry | Rare security operation |
| `ipfs` | opswap | IPFS deployment - likely unused |

**Recommendation**: Consider removing or documenting these. At minimum, add comments explaining when to use `vercel:yolo`.

---

### 12. shx Dependency Only for postinstall

**Problem**: foundry has `shx` as a devDependency solely for:

```json
"postinstall": "shx cp -n .env.example .env"
```

**Options**:

| Option | Command | Works On |
|--------|---------|----------|
| Keep shx | `shx cp -n .env.example .env` | All platforms |
| Use cp directly | `cp -n .env.example .env 2>/dev/null \|\| true` | Unix/Mac |
| Node script | `node -e "..."` | All platforms |

**Recommendation**: If Windows support isn't needed, remove `shx` and use:
```json
"postinstall": "cp -n .env.example .env 2>/dev/null || true"
```

---

## Recommended Changes Summary

### Quick Wins (Low Risk)

| Change | Lines Saved | Risk |
|--------|-------------|------|
| Remove `overrides` from root package.json | ~14 | None |
| Remove `packageManager` from child packages | ~3 | None |
| Add TypeScript to resolutions | ~4 lines per package | Low |
| Standardize ws/dotenv/@types versions | 0 (just consistency) | Low |

### Medium Effort

| Change | Benefit | Risk |
|--------|---------|------|
| Rename packages to `@greek/*` | Consistency | Medium (update imports) |
| Migrate to tsx from nodemon+ts-node | Faster dev, fewer deps | Low |
| Inline trivial Makefile targets | Simpler, fewer tools | Low |
| Update aggregator to Express 5 | Consistency | Medium (API changes) |

### Optional

| Change | Benefit | Risk |
|--------|---------|------|
| Remove vestigial scripts | Cleaner package.json | Low |
| Remove shx dependency | One fewer dep | Low (Unix-only) |
| Consolidate service packages | Fewer packages to maintain | High (major refactor) |

---

## Proposed Cleaned Root package.json

```json
{
  "name": "greek-protocol",
  "version": "0.0.1",
  "private": true,
  "workspaces": {
    "packages": [
      "foundry",
      "opswap",
      "rfq",
      "rfq-direct",
      "aggregator",
      "pricing"
    ]
  },
  "scripts": {
    "chain": "yarn workspace @greek/foundry chain",
    "deploy": "yarn workspace @greek/foundry deploy",
    "start": "yarn workspace @greek/opswap dev",
    "build": "yarn workspace @greek/opswap build",
    "test": "yarn workspace @greek/foundry test",
    "lint": "yarn workspaces foreach -A run lint",
    "format": "yarn workspaces foreach -A run format",
    "postinstall": "husky install"
  },
  "devDependencies": {
    "husky": "~9.1.7",
    "lint-staged": "~16.2.7"
  },
  "packageManager": "yarn@4.12.0",
  "engines": {
    "node": ">=20.18.3"
  },
  "resolutions": {
    "typescript": "~5.9.3",
    "viem": "^2.44.1",
    "dotenv": "^16.4.5",
    "ws": "^8.19.0",
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "@types/cors": "^2.8.17",
    "express": "^5.2.1",
    "next": "16.0.10",
    "fast-redact": "3.5.0",
    "esbuild": "0.25.12",
    "path-to-regexp": "8.3.0",
    "undici": "7.16.0",
    "@walletconnect/ethereum-provider": "2.23.0",
    "@walletconnect/universal-provider": "2.23.0",
    "@walletconnect/sign-client": "2.23.0",
    "@walletconnect/core": "2.23.0",
    "@walletconnect/utils": "2.23.0",
    "@walletconnect/types": "2.23.0",
    "@reown/appkit": "1.8.12",
    "@noble/curves": "^1.7.0",
    "@noble/hashes": "^1.6.1"
  }
}
```

**Changes from current**:
- Removed `overrides` (redundant with `resolutions`)
- Removed individual `account:*`, `compile`, etc. scripts (rarely used from root)
- Added `yarn workspaces foreach` for lint/format
- Consolidated resolutions with version standardization
- Added typescript, viem, express, @types/* to resolutions

---

## Decision Matrix

| Issue | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Remove `overrides` | 5 min | Low | Do now |
| Remove child `packageManager` | 5 min | Low | Do now |
| Standardize resolutions | 30 min | Medium | Do now |
| Rename packages | 1 hour | High | Later |
| Inline trivial Makefile targets | 15 min | Low | Consider |
| Migrate to tsx | 30 min | Medium | Consider |
| Update aggregator to Express 5 | 30 min | Medium | Consider |
