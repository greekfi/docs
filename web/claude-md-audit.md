# CLAUDE.md Audit - Stale & Wrong Sections

Audited 2025-02-05 against actual codebase.

## WRONG - Should Be Removed Entirely

These sections describe infrastructure that **does not exist** in this repo:

### 1. Smart Contract Folders section
```
<Root>/protocol/foundry/contracts
<Root>/protocol/foundry/test
<Root>/protocol/foundry/script
<Root>/protocol/core
```
**Reality**: No `protocol/` or `foundry/` directories exist. No `.sol` source files.
Contracts were likely deployed from a different repo. Only compiled ABIs exist in `/abi/` and `/out/`.

### 2. Local Development (Three Terminal Setup)
```bash
yarn chain    # DOES NOT EXIST
yarn deploy   # DOES NOT EXIST
yarn start    # exists but not in this context
```
These commands are not in the root `package.json`.

### 3. Smart Contract Development Commands
```bash
forge build         # NOT AVAILABLE
forge test          # NOT AVAILABLE
forge clean         # NOT AVAILABLE
forge fmt           # NOT AVAILABLE
yarn foundry:lint   # NOT AVAILABLE
```
No Foundry tooling in this repo.

### 4. Testing Specific Contracts section
All `forge test --match-*` examples reference non-existent files.

### 5. Account Management section
```bash
yarn account              # NOT AVAILABLE
yarn account:generate     # NOT AVAILABLE
yarn account:import       # NOT AVAILABLE
```

### 6. Deployment to Networks section
```bash
yarn deploy --network unichain   # NOT AVAILABLE
yarn deploy --network sepolia    # NOT AVAILABLE
yarn deploy:verify               # NOT AVAILABLE
```

### 7. "Architecture Overview > Core Smart Contracts" section
Entire section (~500 lines) documents Solidity contracts that don't exist in this repo.
The contract *behavior* documentation is useful context, but framed as if source is here.

### 8. Deployment Process section
References `foundry/script/Deploy.s.sol`, `foundry/broadcast/`, and deployment workflows
that don't exist here.

### 9. Compiler Configuration section
References `foundry.toml` with `via_ir = true` - file does not exist.

### 10. Configuration Files section (partially wrong)
- `foundry.toml` - DOES NOT EXIST
- `scaffold.config.ts` - EXISTS (correct)
- `remappings.txt` - DOES NOT EXIST

### 11. Key Dependencies section (partially wrong)
- OpenZeppelin, Foundry, Permit2 - not direct deps of this repo
- Next.js, Moment-timezone - correct

---

## STALE - Needs Updating

### 1. Bebop proto files
CLAUDE.md documents only `pricing_pb.js`. Missing:
- `takerPricing_pb.js` / `takerPricing_pb.d.ts` (used by `src/bebop/relay.ts`)

### 2. Frontend routes
CLAUDE.md only documents `/trade/`. Missing pages:
- `/core/app/options/page.tsx` - Alternative trading interface
- `/core/app/mint/page.tsx` - Minting interface
- `/core/app/_opswap/page.tsx` - Experimental page

### 3. Frontend hooks
Missing from docs:
- `core/app/options/hooks/useRfqPricingStream.ts`
- `core/app/options/hooks/useRfqQuote.ts`
- `core/app/trade/hooks/useBebopQuote.ts`
- `core/app/trade/hooks/useBebopTrade.ts`

### 4. Frontend lib directory
Not documented at all:
- `core/app/lib/WebSocketManager.ts`
- `core/app/lib/PricingStreamManager.ts`
- `core/app/lib/RfqPricingStreamManager.ts`

### 5. Contexts directory
Not documented:
- `core/app/contexts/PricingContext.tsx`

### 6. Duplicate OptionsGrid components
Two exist: `trade/components/OptionsGrid.tsx` and `options/components/OptionsGrid.tsx`

### 7. Railway deployment configs
CLAUDE.md doesn't mention the Railway configs that exist:
- `market-maker/railway.json`
- `market-maker/railway-bebop.toml`
- `market-maker/railway-relay.toml`

---

## CORRECT - No Changes Needed

- Market-maker package structure and scripts
- `src/modes/` directory (direct.ts, bebop.ts, relay.ts)
- `src/servers/` directory (httpApi.ts, wsStream.ts, wsRelay.ts)
- `src/pricing/` directory (blackScholes.ts, pricer.ts, spotFeed.ts, types.ts)
- `src/bebop/` core files (client.ts, pricingStream.ts, signing.ts, types.ts)
- `src/config/` directory (all files match)
- `scaffold.config.ts` description
- `abi/` directory structure
- Market-maker environment variables
- Strike price encoding / put normalization docs
- Black-Scholes pricing documentation
- Bebop integration documentation

---

## Recommendation

The CLAUDE.md is ~1000 lines. Roughly **40% describes Solidity infrastructure that isn't in this repo**.
Options:
1. **Strip it** - Remove all foundry/protocol/contract-source sections. Keep contract *behavior* docs as "Protocol Reference" (no file paths).
2. **Split it** - Move contract docs to a separate `PROTOCOL.md` reference doc.
3. **Keep for context** - If the contracts were recently moved out, keep as protocol reference but clearly mark "contracts deployed separately".
