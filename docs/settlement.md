---
title: Settlement
sidebar_label: Settlement
sidebar_position: 4
---

# Settlement

There is no oracle and no settlement transaction. **American** options exercise any time up to expiration; **European** options exercise during a window after expiration. The holder decides when to exercise and pays the strike — an option never exercised simply lapses.

## The exercise window

Two timestamps, set at creation:

- **`expirationDate`** — expiry.
- **`exerciseDeadline`** — expiry plus the option's `windowSeconds`; exercise, transfers, and pair-burns all stop here.

American options typically use `windowSeconds = 0`, so the deadline is expiration itself. European options always have a window.

```
   mint & trade              exercise window
 ──────────────●────────────────────────●────────────▶  time
          expirationDate          exerciseDeadline

 American: exercise any time up to the deadline
 European: exercise only between expiration and the deadline
```

## Exercise

Burns the Option, pays `amount × strike` in consideration, delivers the collateral:

```solidity
option.exercise(amount);   // or exercise() for your whole balance
```

Approve the consideration to the factory first (see [Fundamentals → Exercise](./fundamentals#exercise)). An option never exercised lapses worthless after the deadline; `option.expire(holder, amount)` burns the dead tokens if you want the wallet clean.

:::note Letting someone exercise for you
Exercise is manual. If you won't be watching the market, grant a keeper the `EXERCISE` permission — `factory.addPermissions(keeper, 16)` — and it can call `option.exerciseFor(holder, amount)` for you. The keeper pays the strike and receives the collateral, so grant it only to a party that settles with you off-chain.
:::

## Pair-burn: unwinding early

If you hold matched Option and Receipt of the same series, burn them together and take the collateral back:

```solidity
option.burn(amount);
```

Works any time up to the deadline. Buying back options you wrote does this automatically — see [auto-burn](./fundamentals#auto-mint--auto-burn).

## Redemption: the short side gets paid

After the window closes, Receipt holders redeem:

```solidity
receipt.redeem();   // or redeem(amount)
```

The pool holds collateral for the options never exercised and consideration for the ones that were. Redemption pays **consideration first** (strike × amount), then **collateral 1:1** for the rest — first come, first served on the consideration. You are owed the same value either way; timing only changes which token you're paid in.

A keeper can trigger redemption for you via the `REDEEM` permission (`factory.addPermissions(keeper, 8)`). Payout always goes to the holder, never the keeper.
