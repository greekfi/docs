---
title: Greek
slug: /
sidebar_position: 0
---

# Greek

Greek is an options infrastructure on EVM (live on Ethereum, Base, Arbitrum, and Ink). It provides the capability to produce and trade unique, universal ERC20 option tokens for any underlying collateral (and [consideration](./fundamentals#consideration)), expiration date and strike price.

Greek has partnered with [Bebop](https://bebop.xyz) to provide [options trades](./trading) through their RFQ system, settling as plain ERC20 transfers on-chain.

## What the protocol does

Greek provides the ability to create tokens and smart contracts for:

1. **American options** — exercisable any time up to the deadline.
2. **European options** — exercisable only during the post-expiry window.

Both are fully collateralized and settle by **manual, time-gated exercise** — there is no
oracle and no on-chain price comparison (see [Settlement](./settlement)). Every token is
ERC20, making it fungible and transferable hence swappable.

## Where to start

- **[Fundamentals](./fundamentals)** — Option Token + Receipt Token; minting, exercise, redemption; auto-mint/burn.
- **[Trading](./trading)** — RFQ flows via Bebop, buying and shorting, market-makers, market takers.
- **[Settlement](./settlement)** — time-gated exercise, pair-burn, post-window redemption.
- **[API Reference](./api)** — full contract surface, generated from smart contract code.

## Deployed Addresses

The factory is the single entry point per chain — it deploys every Option + Receipt pair
and serves as the shared approval hub.

| Network            | Chain ID | Factory |
|--------------------|---------:|---------|
| Ethereum (Mainnet) | 1        | `0x0000000000008aF0c21B3099857341B3E2D41E39` |
| Optimism           | 10       | `0x0000000000008aF0c21B3099857341B3E2D41E39` |
| Base               | 8453     | `0x0000000000008aF0c21B3099857341B3E2D41E39` |
| Arbitrum           | 42161    | `0x0000000000008aF0c21B3099857341B3E2D41E39` |
| Ink                | 57073    | `0x0000000000008aF0c21B3099857341B3E2D41E39` |

:::info
Unichain (130) and HyperEVM (999) are registered in the frontend; factory deployments
there are pending. Always confirm the current address against the app before interacting.
:::

### Programmatic discovery

Once deployed, options can be discovered by listening for the factory's event:

```solidity
event OptionCreated(
    address indexed collateral,
    address indexed consideration,
    uint40 expirationDate,
    uint96 strike,
    bool isPut,
    bool isEuro,
    uint40 windowSeconds,
    address indexed option,
    address receipt
);
```

Filter by `collateral` or `consideration` to enumerate all options on a given pair.

The web frontend maintains an indexed list via `useOptionsList` — see `core/app/book/hooks/useOptionsList.ts`.
