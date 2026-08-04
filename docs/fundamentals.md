---
title: Fundamentals
sidebar_label: Fundamentals
sidebar_position: 2
---

# Fundamentals

## The two tokens

Writing an option means depositing collateral and receiving two ERC20 tokens back:

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

The **Option** is the long side: the right to pay the strike and take the collateral. The **Receipt** is the short side: the claim on that collateral once the option expires or is exercised. The Receipt contract itself escrows every deposit, so each option is fully collateralized from the moment it exists — there is nothing to margin and nothing to liquidate.

Both tokens transfer freely and use the collateral token's decimals. Minting is always 1:1: one unit of collateral backs one Option and one Receipt, with no fees at mint, exercise, or redemption.

### Names & symbols

Generated from the option's parameters, `<prefix>-<collateral>-<consideration>-<strike>-<YYYY-MM-DD>`:

```
OPTA-WETH-USDC-3000-2026-06-27     // American call
OPTE-WETH-USDC-3000-2026-06-27     // European call
RCT-WETH-USDC-3000-2026-06-27      // Receipt, American
RCTE-WETH-USDC-3000-2026-06-27     // Receipt, European
```

## Minting

Approve the factory once — it is the only contract that ever pulls tokens from you, and one approval covers every option it creates:

```solidity
IERC20(collateral).approve(address(factory), type(uint256).max);

option.mint(1e18);              // 1 collateral in, 1 Option + 1 Receipt out
option.mint(recipient, 1e18);   // or mint to someone else
```

The Receipt contract pulls the deposit through the factory and holds it; you receive Option and Receipt tokens 1:1. Fee-on-transfer tokens are rejected (`FeeOnTransferNotSupported`), and rebasing tokens must not be used as collateral.

## Permissions

The factory keeps one permission bitmask per (owner, operator) pair. A single grant covers every option the factory creates:

```solidity
// Bits from library Perm:
// TRANSFER = 1, MINT = 2, BURN = 4, REDEEM = 8, EXERCISE = 16
factory.setPermissions(operator, mask);   // overwrite the operator's mask
factory.addPermissions(operator, mask);   // OR new bits into the existing mask
```

- **`TRANSFER`** — the operator can move your option tokens without per-option ERC20 allowances. This is full custody of your long positions.
- **`MINT`** — the operator can mint against your collateral allowance. Powers [auto-mint](#auto-mint--auto-burn).
- **`BURN`** — the operator's transfers into you pair-burn against your Receipts ([auto-burn](#auto-mint--auto-burn)).
- **`REDEEM`** — the operator can trigger redemption for you. Payout always goes to you.
- **`EXERCISE`** — the operator can exercise your options, paying the strike and **receiving the collateral**. Only for a trusted keeper.

The RFQ settlement contract gets `TRANSFER | MINT | BURN` (mask `7`). Revoke with `factory.setPermissions(operator, 0)`.

## Auto-mint & auto-burn

A market maker often sells options it hasn't minted yet, and a writer buying options back wants the collateral returned in the same transaction. Greek handles both inside the transfer:

- **Auto-mint** — selling an option you haven't minted pulls your collateral and mints it during the transfer.
- **Auto-burn** — receiving an option while you hold the matching Receipt pair-burns the two and returns your collateral.

Both are off by default. One grant to the contract that settles your trades enables them:

```solidity
factory.addPermissions(settlement, 6);   // MINT | BURN
```

**Selling without minting** — the maker holds collateral but no options; the sale mints them on the way out:

```solidity
option.transferFrom(maker, taker, 10e18);
```

The maker's balance is 0, so the factory pulls 10e18 collateral, mints 10e18 Option + Receipt, and the transfer delivers the Options to the taker. The maker ends up short 10 Receipt — same outcome as `mint` + `transfer`, one transaction.

**Unwinding on receive** — a writer short 10 Receipt buys 3 options back:

```solidity
option.transferFrom(taker, writer, 3e18);
```

The incoming 3e18 Option meets the writer's Receipts, 3e18 pairs burn, and 3e18 collateral returns to the writer.

## Exercise

An option is a swap: pay `strike` units of the **consideration** token, receive one unit of the **collateral** token. A WETH call at $3,000 is the right to swap 3,000 USDC for 1 WETH; the holder exercises when spot is above the strike.

Any standard ERC20 can be collateral (WETH, WBTC, UNI, ...). The consideration is usually a dollar token (USDC, USDT, DAI), but any ERC20 works — WETH-WBTC and other non-dollar pairs are valid markets.

Approve the consideration to the factory once, then exercise:

```solidity
IERC20(consideration).approve(address(factory), type(uint256).max);

option.exercise(1e18);   // burn 1 Option, pay 1 × strike, receive 1 collateral
```

**American** options exercise any time up to the deadline; **European** options only during the post-expiry window. There is no oracle and no auto-settlement — a holder who never exercises an in-the-money option forfeits that value. See [Settlement](./settlement) for the window mechanics.

### Calls and puts

A put is a call on the swapped pair — collateral and consideration trade places, and the contract math is identical. The `isPut` flag only changes how the strike is displayed:

| | Collateral | Consideration | Strike (18 decimals) |
|---|---|---|---|
| **WETH call @ $3,000** | WETH | USDC | `3000e18` (USDC per WETH) |
| **WETH put @ $3,000** | USDC | WETH | `1e36 / 3000e18` (WETH per USDC) |

Minting a call deposits WETH; minting a put deposits USDC. Exercising a put pays WETH and receives USDC — the same swap, reversed.
