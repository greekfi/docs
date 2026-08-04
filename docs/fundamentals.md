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

Approve the factory once and every option it creates can pull against that allowance.

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

The factory keeps one permission bitmask per (owner, operator) pair. A single grant covers every option the factory creates:

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

The RFQ settlement contract gets `TRANSFER | MINT | BURN` (mask `7`). Revoke with `factory.setPermissions(operator, 0)`. See [Perm](./api#perm) for the per-bit details.

## Auto-Mint & Auto-Burn

A market maker often sells options it hasn't minted yet, and a writer buying options back wants the collateral returned in the same transaction. Greek handles both inside the transfer:

- **Auto-mint** — selling an option you haven't minted pulls your collateral and mints it during the transfer.
- **Auto-burn** — receiving an option while you hold the matching Receipt pair-burns the two and returns your collateral.

Both are off by default. One grant to the contract that settles your trades enables them:

```solidity
factory.addPermissions(settlement, 6);   // MINT | BURN
```

### Auto-mint: sell-without-minting

```solidity
// Maker holds collateral (approved to the factory) but no options.
option.transferFrom(maker, taker, 10e18);
```

1. The maker's option balance is 0, so the factory pulls 10e18 collateral from the maker and mints 10e18 Option + 10e18 Receipt.
2. The transfer then delivers the 10e18 Option to the taker.

Net: maker holds 10 Receipt (short), taker holds 10 Option. Same outcome as `mint` + `transfer`, one tx.

### Auto-burn: unwind-on-receive

```solidity
// Writer is short 10 Receipt. Buying 3 options back:
option.transferFrom(taker, writer, 3e18);
```

1. The incoming 3e18 Option meets the writer's 10e18 Receipt.
2. 3e18 pairs burn and 3e18 collateral returns to the writer.

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
