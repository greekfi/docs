---
title: Trading
sidebar_position: 3
---

# Trading

Greek options trade through [Bebop](https://bebop.xyz)'s RFQ system: you request a quote, a market maker signs a price, and the swap settles as ordinary ERC20 transfers in one transaction. Bebop's docs are the source of truth for the swap mechanics: [RFQ API](https://docs.bebop.xyz/rfq-api/introduction) · [Settlement contracts](https://docs.bebop.xyz/core-concepts/settlement-smart-contracts) · [Token approvals](https://docs.bebop.xyz/core-concepts/token-approvals).

The approvals each side needs are in [Setup](./setup).

## Why RFQ

Options fragment liquidity — strike × expiry × underlying × call/put. Instead of an AMM pool per series, one market maker quotes the whole book, and [auto-mint](./fundamentals#auto-mint--auto-burn) lets them mint options at the moment of sale instead of pre-inventorying every strike.

## Buying

1. `GET /quote` from Bebop — returns an order signed by the maker.
2. Approve your cash to the `approvalTarget` carried in the quote.
3. Submit the settlement transaction. Cash leaves, option tokens arrive.

## Selling / writing

Do the writer setup once ([Setup](./setup#im-a-writer-sell-then-exit)). After that, every sale settles itself:

```
Bebop settlement  ──▶  option.transferFrom(maker, taker, amount)
                             │
                             ▼
                  auto-mint pulls collateral → mints Option + Receipt
                  → delivers the Options to the taker, pays you cash
```

You end up short, holding Receipts. Unwind by buying back, or redeem after the window closes ([Settlement](./settlement)).

## Pricing

Quotes come from the maker's own model — typically Black-Scholes over an off-chain spot feed, a volatility surface, and spread/inventory adjustments. Nothing on-chain constrains the price: a quote is a bilateral offer you accept or decline.
