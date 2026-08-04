---
title: Fundamentals
sidebar_label: Fundamentals
---

# Fundamentals


## Overview

Greek offers a mechanism for someone to write options to receive two tokens, an **Option** (OPT) and a **Receipt** (RCT), in return for depositing collateral:

```
           deposit collateral
                   │
                   ▼
 ┌──────────────┐      ┌──────────────┐
 │    Option    │      │   Receipt    |
 |              │◀....▶|              |
 │  (long side) │      │ (short side) │
 └──────────────┘      └──────────────┘
```

Both tokens are standard ERC20. The **Option** holder has the right to receive collateral; the **Receipt** holder backs that right and keeps the premium / post-expiry residual.

Options are fully-collateralized, meaning any option created has collateral in the protocol backing that option in the event it gets exercised.

To enable capital efficiency of that collateral, Greek provides the option writer a Receipt token (RCT) which represents the short side and lets the writer reclaim the collateral after the exercise window closes. Let's dig into this system.

## Option & Receipt Tokens

Both sides of an option are standard ERC20s, deployed as clones per option pair (the Option via EIP-1167, the Receipt via clones-with-immutable-args so every per-option field is baked into bytecode). Same decimals as the underlying collateral token.

### Option Token (OPT)

- Minted on deposit, burned on `exercise` or pair-`burn`.
- Transferable. Standard `approve` / `transferFrom` semantics, plus factory permission grants (see [Permissions](#permissions)).
- Time-gated: `mint` reverts at/after expiry; `transfer`, `exercise`, and pair-`burn` revert after the exercise deadline. There is no oracle/settle/claim step — settlement is manual exercise (see [Settlement](./settlement)).

### Receipt Token (RCT)

- Minted 1:1 with the Option on deposit; the Receipt contract physically escrows the collateral.
- Transferable. Burned on pair-`burn` (pre-deadline) or `redeem` (after the exercise window).
- Holders unwind via pair-`burn` while they also hold matched Options, or via `redeem` (cons-first, then collateral 1:1) once the window closes.
- Accessed via `Option.receipt()`.

### Names & symbols

Auto-generated at deploy time from the option's parameters:

```
OPTA-WETH-USDC-3000-2026-06-27     // American call (A for American)
OPTE-WETH-USDC-3000-2026-06-27     // European call (E for Euro)
RCT-WETH-USDC-3000-2026-06-27      // Receipt (short) side, American
RCTE-WETH-USDC-3000-2026-06-27     // Receipt (short) side, European
```

Name format: `<prefix>-<collateralSymbol>-<considerationSymbol>-<strike>-<YYYY-MM-DD>`.

Put options display the human-readable strike (inverse of on-chain storage); see the [Put example](#put-example) below.

### Invariants

- **1:1 backing** — on mint, the number of Option tokens equals Receipt tokens equals deposited collateral. No inflation.
- **Available collateral equals option supply** — while the option is active. Exercise swaps collateral out in return for consideration in; pair-burn burns matched pairs 1:1.
- **Solvency** — every outstanding receipt is backed 1:1 by some mix of collateral and consideration: `available_collateral + toCollateral(available_consideration) >= totalSupply`.
- **Decimals equal to collateral decimals** — the Option and Receipt `decimals()` match the underlying collateral. This simplifies every downstream calculation.

### No protocol fees

Mint, exercise, pair-burn, and redeem are 1:1 — what you put in is what comes out. Revenue is earned at the trading layer (market-maker spread, vault yield).

## Mint & Collateralize

To open an option position, you deposit collateral through the `Option` contract. The protocol mints an equal amount of `Option` + `Receipt` tokens to your address and holds the collateral in escrow until the option is exercised, pair-burned, or redeemed after the window.

### Approvals

Users approve the **factory** once, not each option. The factory is the single transfer authority — it's the only contract that pulls your underlying tokens, and it does so only when a registered Receipt contract asks it to.

```solidity
// One-time setup
IERC20(collateral).approve(address(factory), type(uint256).max);
```

That standard ERC20 allowance to the factory is the only gate: any Receipt contract created by the factory can ask the factory to pull against it. There is no separate factory-side allowance to register.

### Minting

```solidity
// Mint 1 option backed by 1 unit of collateral
option.mint(1e18);

// Or mint to someone else
option.mint(recipient, 1e18);
```

Under the hood:

1. `Option.mint` calls `Receipt.mint(account, amount)`.
2. Receipt calls `factory.transferFrom(account, this, amount)` to pull the deposit.
3. The factory verifies the balance increased by exactly `amount` (fee-on-transfer tokens are rejected with `FeeOnTransferNotSupported`).
4. `Option` and `Receipt` tokens are minted 1:1 to `account`.

After mint, the Receipt contract holds the collateral. Its balance equals the outstanding Option supply.

### Key contracts

- `Option.sol` — long-side entry point. `mint(amount)`, `mint(to, amount)`, `exercise`, `burn` (pair-burn), `expire` (burn expired longs after the window).
- `Receipt.sol` — short side. Holds escrow, enforces 1:1, handles `redeem`. Only mintable/burnable by its paired Option.
- `Factory.sol` — clone factory, single transfer hub, and permission registry (`setPermissions` / `addPermissions`, one bitmask per owner and operator pair).

See the [API Reference](./api) for full surface.

## Transferring and Swapping

### Permissions

The factory keeps a single permission bitmask per (owner, operator) pair. One grant covers every option the factory has created or ever will create, similar to an ERC-1155 universal approval, but split into per-action bits so you grant only what the operator needs:

```solidity
// Bits from library Perm:
// TRANSFER = 1, MINT = 2, BURN = 4, REDEEM = 8, EXERCISE = 16
factory.setPermissions(operator, mask);   // overwrite the operator's mask
factory.addPermissions(operator, mask);   // OR new bits into the existing mask
```

- **`TRANSFER`** — the operator can call `option.transferFrom(you, to, amount)` on any option from this factory without per-option ERC20 allowances. This is full custody of your long positions.
- **`MINT`** — the operator can mint against your token allowance to the factory. This powers [auto-mint](#auto-mint--auto-burn) on transfer shortfalls.
- **`BURN`** — transfers the operator initiates into you pair-burn against your matching Receipts ([auto-burn](#auto-mint--auto-burn)), and the operator can pair-burn and clean up expired longs for you.
- **`REDEEM`** — the operator can trigger `receipt.redeemFor` on your behalf. Payout always goes to you; the operator only picks the timing.
- **`EXERCISE`** — the operator can exercise your options, paying the strike and **receiving the collateral**. Only for a trusted keeper: this is a withdrawal right over your in-the-money value.

The RFQ settlement contract gets `TRANSFER | MINT | BURN` (mask `7`) as one grant. Revoke any grant with `factory.setPermissions(operator, 0)`. Every bit is dangerous in its own way; see [Perm](./api#perm) for the full read.

## Auto-Mint & Auto-Burn

Standard ERC20 transfers assume the sender has tokens and the receiver just credits them. For an options protocol, that's inflexible — a market maker often wants to sell options they haven't minted yet, and it would be unscalable to pre-mint 100 variations of options (strikes, expirations).

Similarly, when receiving options to close a position an option writer wants that collateral back atomically.

Greek offers **opt-in** capabilities for both:

- **Auto-mint** — automatically mint options as they are transferred by collateralizing the underlying collateral.
- **Auto-burn** — receiving options while holding matched Receipt tokens pair-burns and returns collateral.

### Opting in

Both behaviours are driven by the [permission bitmask](#permissions), scoped to whoever initiates the transfer:

```solidity
// Let the RFQ settlement contract mint on shortfall and burn on buy-back
factory.addPermissions(settlement, 2 | 4);   // Perm.MINT | Perm.BURN

// Or enable both for transfers you initiate yourself
factory.addPermissions(msg.sender, 2 | 4);   // the self entry
```

Disabled by default. **Auto-mint** fires when the transfer initiator holds `MINT` in the *sender's* mask; **auto-burn** fires when the initiator holds `BURN` in the *receiver's* mask. Each side is independent.

### Auto-mint: sell-without-minting

```solidity
// Maker hasn't minted yet, but holds collateral (approved to the factory).
// Maker grants MINT to the settlement contract, then signs a quote.
factory.addPermissions(settlement, 2);   // Perm.MINT (with TRANSFER for RFQ: mask 7)

// Settlement pulls options via transferFrom
option.transferFrom(maker, taker, 10e18);
```

On the transfer:

1. Maker's option balance is 0, requested amount is 10e18.
2. Since the settlement contract holds `MINT` in the maker's mask, the deficit (`10e18 - 0`) is minted — the factory pulls 10e18 collateral from the maker and mints 10e18 Option + 10e18 Receipt to the maker.
3. Then the standard transfer moves the 10e18 Option tokens to the taker.

Net: maker holds 10 Receipt, taker holds 10 Option, collateral is locked in the Receipt contract. Same outcome as `mint` + `transfer`, one tx.

### Auto-burn: unwind-on-receive

```solidity
// Writer holds 10 Receipt (short from an earlier sale) and grants BURN
// to the settlement contract.
factory.addPermissions(settlement, 4);   // Perm.BURN

// Buying options back: settlement delivers 3e18 Option to the writer.
option.transferFrom(taker, writer, 3e18);
```

On receive:

1. Writer's Receipt balance is 10e18, incoming 3e18.
2. Since the initiator holds `BURN` in the writer's mask, `min(3e18, 10e18) = 3e18` pairs are burned.
3. 3e18 collateral is released back to the writer.

### When it fires

Both transfer entry points apply auto-settling: `transfer(to, amount)` and `transferFrom(from, to, amount)`. Auto-mint reads the initiator's bit in the **sender's** mask; auto-burn reads it in the **receiver's** mask. The self entry covers the cases where you are that initiator: sending your own tokens (auto-mint), or pulling options into your own wallet via `transferFrom` (auto-burn). Inbound transfers initiated by someone else consult *their* grant, not your self entry.

### Why this matters

- Market makers using RFQ can commit to a quote without pre-minting, then let the taker's settlement trigger the mint.
- Pair holders can unwind a position just by receiving their matched tokens — no separate `burn` call needed.

## Exercise

An option is simply a swap of K units of Token A (Consideration) for 1 Token B (Collateral) at any time the option holder wants before expiry. Typically the swap is performed when the price (A for B) is well above the strike price, K.

### Collateral

Any asset can be collateral, as long as it's an ERC20 token and its value does not change because of fees on swapping or anything similar. Examples include WETH, WBTC, UNI, AAVE.

This is pretty standard in the world of options. But the consideration is a different story.

### Consideration

The term "consideration" is rarely used in the options world because in nearly all options markets, the US Dollar is used as the consideration for every option swap. In on-chain finance, we re-introduce the consideration for two reasons:

1. There are several tokens that can be used as US Dollar denominations for the consideration side (USDC, USDT, DAI, etc.).
2. We can open the market to not only other currencies (Euro, K-Won) but also non-fiat pairs: WETH-WBTC, WBTC-OIL, and so on.

### Exercising on-chain

An **American** option can be exercised on-chain at any time up to and including the exercise deadline. A **European** option can only be exercised during the post-expiry window (between `expirationDate` and `exerciseDeadline`). See [Settlement](./settlement) for the window mechanics. Prior to exercising, you need to allow the Factory to call `transferFrom()` to transfer your consideration tokens in for the swap. 

```solidity
// One-time setup
IERC20(consideration).approve(address(factory), type(uint256).max);
```


Then, call `exercise` with an amount (X) that you want to exercise:

```solidity
uint256 amountX = 1e18;
IOption option = IOption(optionAddress);
option.exercise(amountX);
```

1. The option is burned.
2. X × Strike of Consideration is transferred into the Receipt contract (rounded up).
3. X of Collateral is transferred to your wallet.

### Call example

A WETH call at $3,000 strike:

| Role          | Token |
|---------------|-------|
| Collateral    | WETH  |
| Consideration | USDC  |
| Strike        | `3000e18` (USDC per WETH) |

- Minting deposits WETH.
- Exercising pays USDC → gets WETH.
- It's worth exercising when spot `USDC/WETH > 3000` — the holder decides off-chain; there is no on-chain price check.

### Put example

A WETH put at $3,000 strike is just a call written on the swapped pair:

| Role          | Token |
|---------------|-------|
| Collateral    | USDC  |
| Consideration | WETH  |
| Strike        | `1e36 / 3000e18` (WETH per USDC, in 18-dec units) |

- Minting deposits USDC.
- Exercising pays WETH → gets USDC.
- The `isPut` flag on the option is display-only; the contract math is identical to a call.

### Is a Put really the same as a Call?
Yes, from the example above, you can see that the swap is simply reversed. The only difference is that the option labels that it is a Put through a boolean flag. The only impact this has is on the price on the front end. Rather than saying swap .0005 WETH to receive one USDC, the flag tells us instead "swap in 1 WETH for 2000 USDC". 

### Important Notes

- All strike prices are 18-decimal notation.
- **American** options can be exercised any time up to and including the exercise deadline.
- **European** options cannot be exercised before expiry — only during the post-expiry window.
- Once `exerciseDeadline` passes, no exercise is possible for either mode. There is no oracle and no auto-settlement: a holder who never exercises an ITM option forfeits that value. The short side then reclaims collateral/consideration via `Receipt.redeem` (see [Settlement](./settlement)).
