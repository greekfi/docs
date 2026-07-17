---
title: Setup
sidebar_position: 4
---

# Setup

Greek options are plain ERC20 tokens, traded through [Bebop](https://bebop.xyz)'s RFQ system and settled as ordinary ERC20 transfers on-chain. Before your wallet can trade, exercise, or redeem, a handful of approvals have to be in place.

Which approvals you need depend on which side of the trade you're on. A **holder** buys options with cash and may exercise them; a **writer** sells options against collateral and redeems the collateral afterwards.

Use this page as the checklist; follow the links for the mechanics behind each row.

✅ required · --- not applicable

| Step | Read | Holder | Writer |
|---|---|:---:|:---:|
| Approve cash (USDC) to swap on Bebop's settlement contract | [Bebop Approvals](#bebop-approvals) | ✅ | ✅ |
| Approve Options to swap on Bebop's settlement contract | [Bebop Approvals](#bebop-approvals) · [approveOperator](#approveoperator) | ✅ | ✅ |
| Approve collateral  WETH [Call] to write Options | [weth.approve + factory.approve](#tokenapprove--factoryapprove) | --- | ✅ |
| Approve collateral  USDC [Put] to write Options | [usdc.approve + factory.approve](#tokenapprove--factoryapprove) | --- | ✅ |
| Approve consideration  WETH [Put] to exercise | [weth.approve + factory.approve](#tokenapprove--factoryapprove) | ✅ | --- |
| Approve consideration  USDC [Call] to exercise | [usdc.approve + factory.approve](#tokenapprove--factoryapprove) | ✅ | --- |
| Approve Auto-mint & auto-burn - mint on sale, unwind on buy-back | [enableAutoMintBurn](#enableautomintburn) | --- | ✅ |
| Exercise before the settlement deadline | [option.exercise](#optionexercise) | ✅ | --- |
| Redeem after the settlement window closes | [receipt.redeem](#receiptredeem) | --- | ✅ |

## Bebop Approvals

Bebop's settlement contract pulls both legs of the swap with a standard ERC20 `transferFrom`, so whatever you're giving up - cash if you're buying, option tokens if you're selling - needs an allowance to Bebop's `approvalTarget`.

```solidity
IERC20(usdc).approve(bebopContract, type(uint256).max);
```

The `bebopContract` is `0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`. The quote response carries the settlement target for the chain you're on, so prefer reading it off the quote over pinning a constant. See Bebop's [token approvals](https://docs.bebop.xyz/core-concepts/token-approvals) for more info.

**Note** - for **option tokens** specifically: [`factory.approveOperator`](#approveoperator) (see below) authorises Bebop across every option the factory has ever created, similar to ERC1155, reducing excessive redundancy.

## approveOperator

Greek options are minted per strike × expiry × underlying, so approving each one individually doesn't scale. The factory offers an ERC-1155-style blanket approval instead:

```solidity
// One grant covers every option created by this factory
factory.approveOperator(bebopSettlement, true);
```

Once granted, `bebopSettlement` can call `option.transferFrom(you, taker, amount)` on any option from that factory without a per-option ERC20 allowance. This is what makes a market maker's setup a one-time job rather than a per-series one.

Scope note: this authorises **transfers** of your options and nothing else. It does not let the operator exercise them or touch your collateral directly.

## token.approve + factory.approve

Anything the protocol pulls from you is pulled by the **factory**, which is the single transfer authority:

- collateral when you **write**
- consideration when you **exercise**

It's a two-step approval:

```solidity
// 1. Standard ERC20 allowance to the factory
IERC20(token).approve(address(factory), type(uint256).max);

// 2. Register that allowance in the factory's internal book
factory.approve(token, type(uint256).max);
```

Both are required. The first lets the factory move your tokens at all; the second is what Receipt contracts actually check before asking the factory to pull. Approving the factory once covers every option it creates - you never approve an individual Option or Receipt.

Which token goes here depends on the leg and the flavour:

| | Collateral (to write) | Consideration (to exercise) |
|---|---|---|
| **Call** | WETH | USDC |
| **Put** | USDC | WETH |

A put is the mirror of a call: the collateral and consideration swap places. See [Fundamentals](./fundamentals#approvals) for the full mint path.

:::note
Fee-on-transfer tokens are rejected outright - the factory checks the balance delta and reverts with `FeeOnTransferNotSupported`. Rebasing tokens are unsupported and have no on-chain guard; don't use them as collateral.
:::

## enableAutoMintBurn

```solidity
factory.enableAutoMintBurn(true);
```

Off by default, and the single flag enables two behaviours (AutoMint, AutoBurn) across all options during `transfer`/`transferFrom` for Option Writers:

- **Auto-mint (you're the sender).** Selling an option you haven't minted pulls your collateral, mints the Option + Receipt pair, and delivers the Option to the buyer, all inside the `transfer`. This is what lets a maker quote a hundred strikes without pre-inventorying any of them.
- **Auto-burn (you're the receiver).** Receiving an option while you hold the matching Receipt pair-burns them on arrival and returns your collateral, instead of leaving you sitting on both legs.

Auto-mint requires the collateral approval from [token.approve + factory.approve](#tokenapprove--factoryapprove) to already be in place - it's the allowance the mint pulls against.

Both directions only do something once you're short, since auto-burn needs the matching Receipt in your wallet. That's why this is a writer's flag: a pure holder never holds a Receipt, so neither behaviour ever fires for them. See [Auto-mint & auto-burn](./fundamentals#auto-mint--auto-burn).

## option.exercise

```solidity
option.exercise();            // your whole balance
option.exercise(1e18);        // a specific amount
```

You pay the consideration and receive the collateral, which means the consideration approval must be in place first. Exercise is **manual and time-gated** - there's no oracle and no on-chain price check, so nothing exercises on your behalf. If an option is in-the-money and you don't act, you forfeit that value when the window closes.

When you can exercise depends on the flavour:

| | Before expiry | In the window | After the deadline |
|---|---|---|---|
| **American** | ✅ | --- | --- |
| **European** | --- | ✅ | --- |

American passes `windowSeconds = 0`, so the window collapses to `expirationDate` and there is nothing after it. European requires `windowSeconds > 0`, and its window runs from `expirationDate` to `exerciseDeadline` (`expirationDate + windowSeconds`). The deadline is **inclusive**, so a transaction landing exactly on it still exercises. See [Settlement](./settlement#exercise).

## receipt.redeem

```solidity
receipt.redeem();             // your whole balance
receipt.redeem(1e18);         // a specific amount
```

Redemption is how a writer gets paid out. It pays **consideration first (strike x amount), then collateral 1:1** - no pro-rata:

- The **consideration leg** has no window gate. It's callable any time the pool can cover it, and it pays out the premium accumulated from holders who exercised against the series.
- The **collateral leg** covers whatever the consideration pool couldn't, and only unlocks **strictly after** `exerciseDeadline`.

This is first-come-first-served by design: an early redeemer takes the consideration, leaving later ones with collateral. You're owed the same amount either way, since receipts back 1:1. What changes is which asset you're paid in, and that depends on when you redeem rather than on what you're owed.

If you want out before the deadline instead, buy the option back and pair-burn it rather than waiting to redeem. See [Short-side redemption](./settlement#short-side-redemption-after-the-window).
