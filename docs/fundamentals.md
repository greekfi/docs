---
title: Fundamentals
sidebar_label: Fundamentals
---

# Fundamentals


## Overview

Greek offers a mechanism for someone to write options to receive two tokens, OPT and CLT, in return for depositing collateral:

```
           deposit collateral
                   │
                   ▼
 ┌──────────────┐      ┌──────────────┐
 │    Option    │      │  Collateral  |
 |              │◀....▶|    Token     |
 │  (long side) │      │ (short side) │
 └──────────────┘      └──────────────┘
```

Both tokens are standard ERC20. The **Option** holder has the right to receive collateral; the **Collateral** holder backs that right and keeps the premium / post-expiry residual.

Options are fully-collateralized, meaning any option created has collateral in the protocol backing that option in the event it gets exercised/settled.

To enable capital efficiency of that collateral, Greek provides the option writer a Collateral Token (CLT) which allows the writer to redeem the collateral after expiration. Let's dig into this system.

## Option & Collateral Tokens

Both sides of an option are standard ERC20s, deployed as EIP-1167 clones per option pair. Same decimals as the underlying collateral token.

### Option Token (OPT)

- Minted on deposit, burned on `exercise`, `redeem` (pair), or `claim` (settled).
- Transferable. Standard `approve` / `transferFrom` semantics, plus operator approvals via the factory (see below).
- Expiration-gated: `mint`, `transfer`, `exercise`, pair-`redeem` all revert after expiry. Post-expiry, only `settle` and `claim` work (and only in settled modes).

### Collateral Token (CLT)

- Minted 1:1 with Option on deposit.
- Transferable. Burned on pair-`redeem` (pre-expiry) or `redeem` / `redeemConsideration` (post-expiry).
- No expiration gate — Collateral holders can unwind pre- or post-expiry depending on path.
- Accessed via `Option.coll()`.

### Names & symbols

Auto-generated at deploy time from the option's parameters:

```
OPT-WETH-USDC-3000-2026-06-27      // American call
OPTE-WETH-USDC-3000-2026-06-27     // European call (E for Euro)
CLL-WETH-USDC-3000-2026-06-27      // Collateral side
```

Name format: `<prefix>-<collateralSymbol>-<considerationSymbol>-<strike>-<YYYY-MM-DD>`.

Put options display the human-readable strike (inverse of on-chain storage); see the [Put example](#put-example) below.

### Invariants

- **1:1 backing** — on mint, the number of Option tokens equals Collateral tokens equals deposited collateral. No inflation.
- **Available collateral equals option supply** — while the option is active. Exercise swaps collateral out in return for consideration in; pair-redeem burns matched pairs 1:1.
- **Collateral conservation at expiry** — total payouts to Option + Collateral holders equal the contract's collateral + consideration balance.
- **Decimals equal to collateral decimals** — The option and Collateral Token `decimals()` match the underlying collateral. This simplifies every downstream calculation.

### No protocol fees

Mint, exercise, pair-redeem, and post-expiry claim are 1:1 — what you put in is what comes out. Revenue is earned at the trading layer (market-maker spread, vault yield).

## Mint & Collateralize

To open an option position, you deposit collateral through the `Option` contract. The protocol mints an equal amount of `Option` + `Collateral` tokens to your address and holds the collateral in escrow until the option is exercised, pair-redeemed, or settled at expiry.

### Approvals

Users approve the **factory** once, not each option. The factory is the single transfer authority — it's the only contract that pulls your underlying tokens, and it does so only when a registered Collateral contract asks it to.

```solidity
// One-time setup
IERC20(collateral).approve(address(factory), type(uint256).max);
factory.approve(collateral, type(uint256).max);
```

The first line is a standard ERC20 approval to the factory. The second registers the allowance in the factory's internal book, which is what Collateral contracts check on mint.

### Minting

```solidity
// Mint 1 option backed by 1 unit of collateral
option.mint(1e18);

// Or mint to someone else
option.mint(recipient, 1e18);
```

Under the hood:

1. `Option.mint` calls `Collateral.mint(account, amount)`.
2. Collateral calls `factory.transferFrom(account, this, amount, collateralToken)` to pull the deposit.
3. Collateral verifies the balance increased by exactly `amount` (fee-on-transfer tokens are rejected).
4. `Option` and `Collateral` tokens are minted 1:1 to `account`.

After mint, the Collateral contract holds the collateral. Its balance equals the outstanding Option supply.

### Key contracts

- `Option.sol` — public entry point. `mint(amount)`, `mint(to, amount)`.
- `Collateral.sol` — holds escrow, enforces 1:1. Only callable by its paired Option.
- `Factory.sol` — clone factory, allowance registry, blocklist.

See the [API Reference](./api) for full surface.

## Transferring and Swapping

### Operator approvals
To allow a contract to transfer/swap (`transferFrom()`) on your behalf, similar to `token.approve()`, you must permit that contract through the following approval method, that's similar to an ERC-1155-style universal approval:

```solidity
// Grant operator transfer rights across ALL options created by this factory
factory.approveOperator(operator, true);
```

When approved, `operator` can call `option.transferFrom(owner, to, amount)` on any option created by that factory without needing individual ERC20 approvals. Used by the RFQ settlement contract and other trading venues.

 If the sender has opted into auto-mint / auto-redeem (next section), the transfer can additionally mint or burn pairs on the fly, assuming the sender has enough collateral.

## Auto-Mint & Auto-Redeem

Standard ERC20 transfers assume the sender has tokens and the receiver just credits them. For an options protocol, that's inflexible — a market maker often wants to sell options they haven't minted yet, and it would be unscalable to pre-mint 100 variations of options (strikes, expirations).

Similarly, when receiving options to close a position an option writer wants that collateral back atomically.

Greek offers **opt-in** capabilities for both:

- **Auto-mint** — automatically mint options as they are transferred by collateralizing the underlying collateral.
- **Auto-redeem** — receiving options while holding matched Collateral tokens burns the pair and returns collateral.

### Opting in

```solidity
factory.enableAutoMintRedeem(true);
```

By enabling this flag for your wallet, every option in that factory can have auto-mint and auto-redeem. This is disabled by default. Both directions fire based on the sender's / receiver's opt-in independently.

### Auto-mint: sell-without-minting

```solidity
// Maker hasn't minted yet, but holds collateral.
// Maker opts in, then signs a transfer.
factory.enableAutoMintRedeem(true);

// Taker pulls options via transferFrom
option.transferFrom(maker, taker, 10e18);
```

On the transfer:

1. Maker's option balance is 0, requested amount is 10e18.
2. Since maker opted in, the deficit (`10e18 - 0`) is minted — factory pulls 10e18 collateral from the maker and mints 10e18 Option + 10e18 Collateral to the maker.
3. Then the standard transfer moves the 10e18 Option tokens to the taker.

Net: maker holds 10 Collateral, taker holds 10 Option, collateral is locked in the Collateral contract. Same outcome as `mint` + `transfer`, one tx.

### Auto-redeem: unwind-on-receive

```solidity
// Taker holds 10 Option + 10 Collateral (e.g. from a pair position).
// Taker opts in.
factory.enableAutoMintRedeem(true);

// Any further Option arriving at taker burns matched pairs.
IERC20(option).transfer(taker, 3e18);
```

On receive:

1. Taker's Collateral balance is 10e18, incoming 3e18.
2. Since taker opted in, `min(3e18, 10e18) = 3e18` pairs are burned.
3. 3e18 collateral is released back to taker.

### When it fires

Both transfer entry points apply auto-settling: `transfer(to, amount)` and `transferFrom(from, to, amount)`. Auto-mint checks the **sender's** opt-in flag; auto-redeem checks the **receiver's**. Each side is independent.

Auto-mint and auto-redeem are gated by `notExpired` — after expiry, neither fires and transfers follow normal ERC20 semantics.

### Why this matters

- Market makers using RFQ can commit to a quote without pre-minting, then let the taker's settlement trigger the mint.
- Pair holders can unwind a position just by receiving their matched tokens — no separate `redeem` call needed.
- The CLOBAMM / NuAMMv2 on-chain books rely on this to deliver options from pooled collateral without per-level minting.

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

An option can be exercised on-chain at any time (e.g. any block). Prior to exercising, you need to allow the Factory to call `transferFrom()` to transfer your consideration tokens in for the swap. 

```solidity
// One-time setup
IERC20(consideration).approve(address(factory), type(uint256).max);
factory.approve(consideration, type(uint256).max);
```


Then, call `exercise` with an amount (X) that you want to exercise:

```solidity
uint256 amountX = 1e18;
IOption option = IOption(optionAddress);
option.exercise(amountX);
```

1. The option is burned.
2. X × Strike of Consideration is transferred to the Option + Collateral contracts.
3. X of Collateral will be transferred to your wallet.

### Call example

A WETH call at $3,000 strike:

| Role          | Token |
|---------------|-------|
| Collateral    | WETH  |
| Consideration | USDC  |
| Strike        | `3000e18` (USDC per WETH) |

- Minting deposits WETH.
- Exercising pays USDC → gets WETH.
- At expiry (settled), ITM means `spotUSDC/WETH > 3000`.

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
- `exercise` can only be called on American options.
- European options cannot be exercised before the expiration date.
- After the expiration date, no exercise is possible — if the option has a settlement-price oracle, settlement auto-delivers the amount above the strike at expiration.
