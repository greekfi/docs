---
title: Trading
sidebar_position: 3
---

# Trading

Greek options are plain ERC20 tokens. You can move them through any DEX/AMM/CLOB that speaks ERC20 — but for real price discovery on options, RFQ (request-for-quote) against a professional market maker is the right tool. Greek has partnered with [Bebop](https://bebop.xyz) for the production trading path.

Bebop's docs are the source of truth for the swap mechanics. Start here:

- [RFQ API — Introduction](https://docs.bebop.xyz/rfq-api/introduction)
- [Settlement & smart contracts](https://docs.bebop.xyz/core-concepts/settlement-smart-contracts)
- [Token approvals](https://docs.bebop.xyz/core-concepts/token-approvals)
- [Quote endpoint](https://docs.bebop.xyz/rfq-api/api-reference/quote) · [Order endpoint](https://docs.bebop.xyz/rfq-api/api-reference/order)

## Why RFQ (and not an AMM)

Options have high dimensionality — strike × expiry × underlying × call/put — and each series has vastly different liquidity needs. An AMM per series would fragment capital badly. RFQ lets one maker quote the entire book using their own risk engine, and Greek's [auto-minting](./fundamentals#auto-mint--auto-redeem) means they don't need to pre-inventory every strike × expiry: options are minted at the moment of sale.

## How Greek + Bebop fit

Bebop's settlement flow is entirely standard ERC20 — maker's tokens are pulled via `transferFrom` and delivered to the taker, atomically, in one tx. Because Greek's `Option` contract overrides `transferFrom` with an auto-mint hook, nothing special has to happen on Bebop's side:

```
Bebop settlement  ──▶  option.transferFrom(maker, taker, amount)
                             │
                             ▼
                  Greek auto-mint fires (if maker opted in):
                    pulls collateral → mints option+coll → transfers option
```

Net: the MM holds collateral, signs a quote, and the option materializes at the exact moment the taker pays for it.

## Buy flow (taker's perspective)

1. `GET /quote` on Bebop → signed EIP-712 order from the maker.
2. Approve cash to Bebop's `approvalTarget` (returned by the quote — **don't hardcode**).
3. Call settlement with the received quote.

```solidity
// After receiving a signed quote from the MM:
IBebopSettlement(bebopContract).swapSingle(order, makerSig, filledAmount);
```

Result: cash leaves you, option tokens arrive at `receiver`.

## Sell / write flow (maker-side setup)

One-time setup so your wallet can sell Greek options through Bebop with auto-mint:

```solidity
// Approve collateral to the factory (ERC20 + factory's internal book)
IERC20(collateral).approve(address(factory), type(uint256).max);
factory.approve(collateral, type(uint256).max);

// Opt into auto-mint (one flag for all options from this factory)
factory.enableAutoMintRedeem(true);

// Let Bebop's settlement pull option tokens on your behalf
// (one operator approval covers every option in the factory)
factory.approveOperator(bebopApprovalTarget, true);
```

Now every RFQ sale signed by your wallet atomically:
1. Pulls `amount` collateral from you,
2. Mints `amount` Option + `amount` Collateral Tokens to you,
3. Delivers the Options to the taker,
4. Pays you the cash.

You end up short (holding Collateral tokens). The original collateral is locked in the Collateral contract backing that short — unwound by buying options back, or settled at expiry.


## Pricing

The Greek market maker may use a Black-Scholes formula to price their option. Most MMs use sophisticated strategies off-chain to price and deliver a quote when requested. Typically to price you need the following pieces of information.

- **Spot** from Chainlink (primary) with Uniswap v3 TWAP as fallback.
- **Volatility** from a per-underlying surface (ATM-anchored, quadratic skew optional).
- **Inventory skew** — widens asks and tightens bids when the MM is net short, to pull back toward flat.
- **Base spread** configurable per venue.

{/* ## Vault flows

Liquidity providers can route through a vault (`YieldVault.sol`) that holds collateral and lets an authorized operator sign RFQ orders via EIP-1271 contract signatures. The vault becomes Bebop's `maker_address`; everything downstream (including auto-mint) is identical to the EOA case. */}
