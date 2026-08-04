---
title: Setup
sidebar_position: 1
---

# Setup

Greek options are plain ERC20 tokens traded through [Bebop](https://bebop.xyz)'s RFQ system. There are two ways in. A **holder** buys options with cash and may exercise them. A **writer** sells options against collateral and collects the premium. Each side needs a couple of one-time approvals; here is each path start to finish.

## I'm a holder: buy, then exercise

**1. Approve your cash to Bebop.** Bebop's settlement contract pulls the cash leg with a standard `transferFrom`:

```solidity
IERC20(usdc).approve(bebopContract, type(uint256).max);
```

Read the settlement address off the quote response — it carries the `approvalTarget` for your chain. See Bebop's [RFQ API](https://docs.bebop.xyz/rfq-api/introduction) for the quote flow.

**2. Buy.** Request a quote, sign, done — the option tokens arrive in your wallet.

**3. Exercise if it's in the money.** You pay the strike in consideration tokens and receive the collateral, so approve the consideration to the factory once (USDC for a call, WETH for a put):

```solidity
IERC20(usdc).approve(address(factory), type(uint256).max);
option.exercise(amount);   // or exercise() for your whole balance
```

Exercise is manual — there is no oracle, and nothing exercises for you. If you don't act before the deadline, the value is forfeited. When you can exercise depends on the flavour:

| | Before expiry | In the window | After the deadline |
|---|---|:---:|:---:|
| **American** | ✅ | --- | --- |
| **European** | --- | ✅ | --- |

See [Settlement](./settlement#exercise) for the window mechanics.

**Selling back instead?** Grant Bebop's settlement contract once on the factory — `factory.setPermissions(bebopSettlement, 7)` — and it can move your option tokens with no per-option approvals. Details in the writer path below.

## I'm a writer: sell, then exit

**1. Approve your collateral to the factory.** The factory is the single contract that pulls tokens from you — WETH to write calls, USDC to write puts:

```solidity
IERC20(weth).approve(address(factory), type(uint256).max);
```

**2. Permit Bebop's settlement contract on the factory.** One call, one mask:

```solidity
// TRANSFER | MINT | BURN = 7
factory.setPermissions(bebopSettlement, 7);
```

This lets settlement move your option tokens (`TRANSFER`), mint options you haven't pre-minted at the moment of sale (`MINT`), and unwind your short when you buy options back (`BURN`). It can never exercise your options or touch redemptions. See [Permissions](./fundamentals#permissions) for all five bits.

**3. Sell.** Quote through the RFQ and the sale settles itself: your collateral is pulled, the option mints, and the buyer pays you — one transaction. You now hold Receipt tokens: your short position and claim on the escrowed collateral.

**4. Exit the short.** Two ways out:

- **Buy back** — options you buy back pair-burn against your Receipts on arrival and your collateral returns immediately.
- **Redeem** — after the exercise window closes, `receipt.redeem()` pays out what you're owed: consideration first (strike × amount, from holders who exercised), then collateral 1:1 for the rest.

```solidity
receipt.redeem();          // your whole balance
receipt.redeem(1e18);      // a specific amount
```

Redemption is first-come-first-served on the consideration pool: an early redeemer is paid in consideration, later ones in collateral. The amount you're owed is the same either way. See [Settlement](./settlement#redemption-the-short-side-gets-paid).
