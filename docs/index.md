---
title: Greek
slug: /
sidebar_position: 0
---

# Greek

Greek is a options infrastructure on EVM (Mainnet, Base, Arbitrum). It provides the capability to produce and trade unique, universal ERC20 option tokens for any underlying collateral (and [consideration](./fundamentals#consideration)), expiration date and strike price.

Greek has partnered with [Bebop](https://bebop.xyz) to provide [options trades](./trading) through their RFQ system with on-chain settlement.

## What the protocol does

Greek provides the ability to create tokens and smart contracts for:

1. European Options with Settlement
2. American Options with Settlement
3. American Options without Settlement

Every token is ERC20, making it fungible and transferable hence swappable.

## Where to start

- **[Fundamentals](./fundamentals)** — Option Token + Collateral Token; exercise, settlement, collateral redemption; auto-mint/redeem.
- **[Trading](./trading)** — RFQ flows via Bebop, buying and shorting, market-makers, market takers.
- **[Settlement](./settlement)** — pair-redeem, oracle settlement, post-expiry paths.
- **[API Reference](./api)** — full contract surface, generated from smart contract code.

## Deployed Addresses

:::info
Addresses are not yet finalized for this refactor. This page will be populated as deployments go live.
:::

### Mainnet (Ethereum)

| Contract | Address |
|----------|---------|
| Factory  | _TBD_ |

### Base

| Contract | Address |
|----------|---------|
| Factory  | _TBD_ |

### Unichain

| Contract | Address |
|----------|---------|
| Factory  | _TBD_ |

### Test networks

| Network  | Factory |
|----------|---------|
| Sepolia  | _TBD_ |

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
    address oracle,
    address indexed option,
    address coll
);
```

Filter by `collateral` or `consideration` to enumerate all options on a given pair.

The web frontend maintains an indexed list via `useOptionsList` — see `core/app/book/hooks/useOptionsList.ts`.
