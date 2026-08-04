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
| Permit Bebop's settlement contract on the factory - transfer, mint on sale, unwind on buy-back | [factory.setPermissions](#factorysetpermissions) | ✅ | ✅ |
| Approve collateral  WETH [Call] to write Options | [weth.approve](#tokenapprove) | --- | ✅ |
| Approve collateral  USDC [Put] to write Options | [usdc.approve](#tokenapprove) | --- | ✅ |
| Approve consideration  WETH [Put] to exercise | [weth.approve](#tokenapprove) | ✅ | --- |
| Approve consideration  USDC [Call] to exercise | [usdc.approve](#tokenapprove) | ✅ | --- |
| Exercise before the settlement deadline | [option.exercise](#optionexercise) | ✅ | --- |
| Redeem after the settlement window closes | [receipt.redeem](#receiptredeem) | --- | ✅ |

## Bebop Approvals

Bebop's settlement contract pulls both legs of the swap with a standard ERC20 `transferFrom`, so whatever you're giving up - cash if you're buying, option tokens if you're selling - needs an allowance to Bebop's `approvalTarget`.

```solidity
IERC20(usdc).approve(bebopContract, type(uint256).max);
```

The `bebopContract` is `0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`. The quote response carries the settlement target for the chain you're on, so prefer reading it off the quote over pinning a constant. See Bebop's [token approvals](https://docs.bebop.xyz/core-concepts/token-approvals) for more info.

**Note** - for **option tokens** specifically: [`factory.setPermissions`](#factorysetpermissions) (see below) authorises Bebop across every option the factory has ever created, similar to ERC1155, reducing excessive redundancy.

## factory.setPermissions

Greek options are minted per strike × expiry × underlying, so approving each one individually doesn't scale. The factory keeps a permission bitmask per (owner, operator) pair instead - one grant covers every option it has created or ever will. The bits come from `library Perm`: `TRANSFER = 1`, `MINT = 2`, `BURN = 4`, `REDEEM = 8`, `EXERCISE = 16`.

The trading grant is one call:

```solidity
// TRANSFER | MINT | BURN = 7
factory.setPermissions(bebopSettlement, 7);
```

What each bit does in the trade:

- **`TRANSFER`** - settlement can call `option.transferFrom(you, taker, amount)` on any option from the factory, no per-option ERC20 allowance needed.
- **`MINT`** - selling an option you haven't minted auto-mints it inside the transfer, pulling collateral against your factory allowance from [token.approve](#tokenapprove). This is what lets a writer quote without pre-inventorying strikes.
- **`BURN`** - buying an option back while you hold the matching Receipt pair-burns them on arrival and returns your collateral.

A pure holder only strictly needs `TRANSFER`; `MINT` and `BURN` only ever fire once you're short, so the combined mask `7` is safe to grant either way. Revoke with `factory.setPermissions(bebopSettlement, 0)`.

Scope note: this grant does **not** include `EXERCISE` or `REDEEM` - the settlement contract can never exercise your options or trigger your redemptions. See [Perm](./api#perm) for the full per-bit read.

## token.approve

Anything the protocol pulls from you is pulled by the **factory**, which is the single transfer authority:

- collateral when you **write**
- consideration when you **exercise**

It's a standard ERC20 allowance to the factory:

```solidity
IERC20(token).approve(address(factory), type(uint256).max);
```

That allowance is the only gate - Receipt contracts pull through the factory against it. Approving the factory once covers every option it creates - you never approve an individual Option or Receipt.

Which token goes here depends on the leg and the flavour:

| | Collateral (to write) | Consideration (to exercise) |
|---|---|---|
| **Call** | WETH | USDC |
| **Put** | USDC | WETH |

A put is the mirror of a call: the collateral and consideration swap places. See [Fundamentals](./fundamentals#approvals) for the full mint path.

:::note
Fee-on-transfer tokens are rejected outright - the factory checks the balance delta and reverts with `FeeOnTransferNotSupported`. Rebasing tokens are unsupported and have no on-chain guard; don't use them as collateral.
:::

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

Exercise happens before expiration for American, and during the window after expiration for European. See [Settlement](./settlement#exercise).

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
