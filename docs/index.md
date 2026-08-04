---
title: Greek
slug: /
sidebar_position: 0
---

# Greek

Greek turns options into plain ERC20 tokens. Writing an option locks collateral and mints two tokens: the **Option**, the right to exercise, and the **Receipt**, the claim on the locked collateral. Both transfer freely and trade like any other token — production trading runs through [Bebop](https://bebop.xyz)'s RFQ system.

Every option is fully collateralized, works on any ERC20 pair at any strike and expiry, and comes in **American** and **European** flavours. There is no oracle: the holder decides when to exercise during a time-gated window. There are no protocol fees.

## Where to start

- **[Setup](./setup)** — start here: the holder and writer paths, start to finish.
- **[Fundamentals](./fundamentals)** — the two tokens, minting, permissions, exercise.
- **[Trading](./trading)** — RFQ flows via Bebop.
- **[Settlement](./settlement)** — exercise windows, pair-burn, redemption.
- **[API Reference](./api)** — full contract surface, generated from the contracts.

## Deployed addresses

The factory is the single entry point per chain: it deploys every Option + Receipt pair and is the one contract you approve.

| Network            | Chain ID | Factory |
|--------------------|---------:|---------|
| Ethereum (Mainnet) | 1        | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Optimism           | 10       | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| HyperEVM           | 999      | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Robinhood          | 4663     | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Base               | 8453     | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Arbitrum           | 42161    | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Hemi               | 43111    | `0x999999999997b2396a5e589BFA7E8e46bDc26977` |
| Hedera             | 295      | `0x20677001aFbAa8F28baebEa0b10bF96490Eb45ab` |

Every option ever created is discoverable on-chain through the factory's `OptionCreated` event — filter by `collateral` or `consideration` to enumerate a pair:

```solidity
event OptionCreated(
    address indexed collateral,
    address indexed consideration,
    uint40 expirationDate,
    uint256 strike,
    bool isPut,
    bool isEuro,
    uint40 windowSeconds,
    address indexed option,
    address receipt
);
```
