---
title: Settlement
sidebar_label: Settlement
sidebar_position: 2
---

# Settlement

How an option ends depends on its mode, which is set at creation and baked in:

| Mode                    | `isEuro` | `oracle`   | Pre-expiry                        | Post-expiry                                           |
|-------------------------|:--------:|:----------:|------------------------------------|--------------------------------------------------------|
| American, non-settled   | false    | `0x0`      | `exercise` + pair-`redeem`         | `redeem` (pro-rata) + `redeemConsideration`           |
| American, settled       | false    | non-zero   | `exercise` + pair-`redeem`         | `redeem` (oracle split) + `redeemConsideration` + `claim` |
| European                | true     | non-zero   | pair-`redeem` only                 | `settle` + `claim` + `redeem` (oracle split)          |

Invalid combo: `isEuro=true, oracle=0` — rejected at creation.

## Always available

Regardless of mode, these are always callable pre-expiry:

- **`mint(amount)`** — open new pairs from collateral.
- **`option.redeem(amount)`** (pair-redeem) — burn matched Option + Collateral, recover collateral. No price lookup; always 1:1. See [Pair Redeem](#pair-redeem) below.
- **`transfer` / `transferFrom`** — trade options. Auto-mint / auto-redeem fire if opted in.

## American-specific (pre-expiry)

- **`exercise(amount)`** — burn Options, pay strike × amount in consideration, receive collateral. Reverts in European mode. See [Fundamentals → Exercise](./fundamentals#exercise).

## Post-expiry

This is where modes diverge.

### Non-settled (American only)

No oracle, so no spot lookup. Collateral holders redeem pro-rata against whatever collateral + consideration is in the contract:

- `redeem(amount)` — pro-rata split of remaining collateral + consideration.
- `redeemConsideration(amount)` — alternative path, takes consideration at strike rate.

### Settled (American or European)

Anyone can call `settle(hint)` post-expiry to latch the oracle price. Then:

- `option.claim(amount)` — option holder burns and receives the ITM payout (`amount × (spot - strike) / spot`).
- `coll.redeem(amount)` — collateral holder takes pro-rata of `(collateralBalance - optionReserve, considerationBalance)` — where `optionReserve` is the un-exercised collateral earmarked for option holders.
- `coll.redeemConsideration(amount)` — still works in American-settled (pulls from consideration pot); meaningless in European (no consideration ever entered).

See [Oracle Settlement](#oracle-settlement) below for the math and conservation proof.

## Permissionless triggers

`settle` and `sweep` (for batching post-expiry redemptions) are **permissionless** — anyone can pay the gas to finalize a contract, including bots. This is deliberate: no stakeholder can block settlement.

## Pair Redeem

Pair-redeem is the universal "I changed my mind" unwind. You hold both Option and Collateral for the same pair, you burn them together, and you get your collateral back.

```solidity
option.redeem(amount);
```

Works pre-expiry, in every mode (American, European, settled or not).

### Semantics

1. `amount` Option tokens burned from caller.
2. `amount` Collateral tokens burned from caller.
3. `amount` collateral returned to caller.

The caller must hold at least `amount` of both tokens. Otherwise reverts with `InsufficientBalance`.

### Why it always works

Pair-redeem is collateral-neutral. Burning a matched pair is the exact inverse of minting a pair — it doesn't take anything from un-paired holders or change the option/collateral supply relationship for anyone else.

### Post-expiry

Pair-redeem is gated by `notExpired`. Post-expiry, you use:

- `coll.redeem(amount)` — post-expiry unwind. Pays pro-rata or oracle split depending on mode. Does NOT require matched Option tokens.
- `option.claim(amount)` — option-holder ITM payout (settled modes only).

The pair-redeem mechanism is specifically pre-expiry because post-expiry the terms are different — the option holder has a well-defined ITM or zero payout, and the collateral holder gets the rest. Burning a matched pair post-expiry would short-change one side or the other.

### When is this useful?

- **Market maker unwinding a position** — you're short via auto-mint, you bought back the same amount of options, you burn the matched pair and re-claim collateral.
- **Liquidity provider adjusting exposure** — pair-redeem and re-mint into a different strike/expiry.
- **Auto-redeem on receive** — if you opted into auto-mint/redeem, receiving Options while holding Collateral auto-triggers pair-redeem for matched amounts. See [Fundamentals → Auto-Mint & Auto-Redeem](./fundamentals#auto-mint--auto-redeem).

### No oracle required

Pair-redeem doesn't care about spot, strike, or expiry state. It's pure collateral conservation: in, out, 1:1. The only way it can fail is if something has corrupted the 1:1 invariant — in which case the contract has bigger problems than your unwind.

## Oracle Settlement

When an option has an attached oracle, post-expiry settlement is mechanical: latch the spot, then split the remaining collateral between Option and Collateral holders according to ITM/OTM.

### Three steps

1. **`settle(hint)`** — permissionless, idempotent. Calls the oracle to latch spot and initialize `optionReserveRemaining`.
2. **`option.claim(amount)`** — option holder burns Options, receives ITM payout.
3. **`coll.redeem(amount)`** — collateral holder burns Collateral, receives pro-rata of remaining.

`hint` is oracle-specific: empty bytes for Uniswap TWAP, `abi.encode(roundId)` for Chainlink.

### Math

Given settled spot `S`, strike `K`, option supply at settlement `O`:

#### ITM (`S > K`)

```
optionReserve = O × (S - K) / S

option.claim(a)     = a × (S - K) / S           collateral (floor-rounded)
coll.redeem(a)      = pro-rata of:
                        - collateral: (C − liveOptionReserve) × (a / N)
                        - consideration: V × (a / N)
```

Where:

- `C` = current collateral balance
- `V` = current consideration balance (non-zero only if exercised pre-expiry)
- `N` = current Collateral token supply
- `liveOptionReserve` = `optionReserveRemaining` (starts at `O × (S-K)/S`, decrements on each claim)

#### OTM (`S ≤ K`)

```
optionReserve = 0

option.claim(a)     = 0   (burns Options, no payout)
coll.redeem(a)      = pro-rata of full remaining balances
```

### Conservation

For any sequence of claim/redeem calls in any order:

```
Σ (option payouts) + Σ (coll payouts, collateral)    = initial collateral balance
                   + Σ (coll payouts, consideration) = initial consideration balance
```

Both sums hold within rounding (floor on all payouts; dust stays in contract).

### Why a reserve?

The reserve decouples claim order from redeem order. Without it:

- If Collateral redeems first, it grabs all remaining collateral.
- Later Option claims have nothing to pay from.

With `optionReserveRemaining`:

- At settle, we snapshot exactly how much collateral option holders are collectively entitled to.
- Collateral redemptions see `collateralBalance - optionReserveRemaining` as their available pool, leaving option holders' share untouched.
- Each claim decrements the reserve, and the claim payout leaves the collateral pool, so the subtraction stays consistent.

### When settle fires automatically

- `option.claim` — if not yet settled, calls `coll.settle("")` before burn.
- `coll.redeem` — if `oracle != 0`, calls `_settle("")` internally.
- `coll.sweep` — same, for batched redemption.

You can also pre-settle manually with `option.settle(hint)` or `coll.settle(hint)`, useful when the oracle requires a non-empty hint (Chainlink roundId).

### Permissionless

`settle` has no access control — anyone can call post-expiry. Bots, keepers, or any interested party can pay the gas to finalize an option. This is by design so a negligent owner can't strand settlement.

### What Option holders lose if they forget

Option holders who never call `claim` leave their ITM share locked in `optionReserveRemaining`. It's recoverable any time — no deadline. But nothing auto-pays it out; you have to call `claim` or `claimFor(holder)`.

`claimFor` is permissionless too, so a bot/keeper can claim on behalf of a holder if incentivized.

## Oracles

An oracle is any contract implementing `IPriceOracle`:

```solidity
interface IPriceOracle {
    function expiration() external view returns (uint256);
    function isSettled() external view returns (bool);
    function settle(bytes calldata hint) external returns (uint256);
    function price() external view returns (uint256);
}
```

- `expiration()` — the timestamp this oracle settles against. Must match the option's expiration.
- `settle(hint)` — idempotent latch. First call post-expiry stores the settlement price; subsequent calls are no-ops.
- `price()` — reverts before `settle`, returns the latched price after.

Output is 18-decimal fixed-point, **consideration per collateral**. Same convention as strike.

### Per-option, pinned to expiry

Each option gets its own oracle instance. The factory deploys the appropriate wrapper at creation time, bound to the option's expiration timestamp. This means:

- Two options with different expiries have independent oracles, even if they point at the same underlying pool/feed.
- The oracle's `expiration()` is immutable — you can't accidentally settle against a different time.

### Supported sources

#### Uniswap v3 TWAP (shipping today)

The factory accepts a Uniswap v3 pool address as `oracleSource`. It deploys a `UniV3Oracle` wrapper that, on `settle()`, reads the pool's observation buffer over a configurable window ending at expiry:

```solidity
CreateParams({
    collateral: address(weth),
    consideration: address(usdc),
    expirationDate: exp,
    strike: 3000e18,
    isPut: false,
    isEuro: false,         // or true
    oracleSource: address(wethUsdcPool),
    twapWindow: 1800       // 30-minute TWAP
});
```

Semi-strict timing: `settle()` works any time after expiry, as long as the observations covering `[expiration - twapWindow, expiration]` are still in the pool's ring buffer. For high-traffic pools this is days; for quieter ones it can be much shorter — be careful with long settlement delays.

Call `settle("")` with empty hint; Uniswap doesn't need any external input.

#### Pre-deployed IPriceOracle

You can also pass any pre-deployed `IPriceOracle` directly as `oracleSource`. The factory detects this via the `expiration()` match and uses the contract as-is. This enables:

- Oracle reuse across multiple options with the same expiry (deploy once, attach to many).
- Custom oracle implementations without factory changes.

#### Chainlink (planned)

Chainlink's round-based model is a natural fit: take a `roundId` hint, verify it was the earliest round after expiry, latch that answer. No buffer-lifetime concerns.

### Permissionless settlement

`oracle.settle(hint)` has no access control. Any EOA or contract can pay the gas to latch the price. This is by design — settlement should never be held up waiting for a specific party.

In practice:

- Bots will settle high-value options automatically after expiry.
- Option holders can self-serve via `option.settle(hint)` if no one has settled yet (convenience forwarder).

### Caveats

- Oracle must be pre-verified at creation — the factory checks `expiration()` matches, but doesn't inspect the oracle's implementation. Use oracles you trust.
- Settlement price is one number. For options that need volatility or path-dependent settlement, this model doesn't fit.
- If the oracle reverts on `settle()` (e.g. Uniswap observations rolled off, Chainlink feed paused), the option can't be settled. Users can still pair-redeem pre-expiry to avoid this risk.
