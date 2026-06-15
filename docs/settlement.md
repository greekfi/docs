---
title: Settlement
sidebar_label: Settlement
sidebar_position: 2
---

# Settlement

Greek settlement is **purely time-gated** — there is no oracle, no `settle()`, no
on-chain price comparison. The holder watches spot off-chain and decides whether the
option is in-the-money. If it is, they exercise during the window and pay strike; if it
isn't, they let it lapse. This eliminates the entire oracle attack surface (price
spoofing, feed staleness, TWAP manipulation, oracle bricking) at the cost of holder UX:
a passive holder who never exercises forfeits ITM value once the window closes.

Two flavours coexist, chosen at creation by the `isEuro` flag:

| Mode      | `isEuro` | Pre-expiry exercise | In-window exercise | Short-side exit after window           |
|-----------|:--------:|---------------------|--------------------|----------------------------------------|
| American  | `false`  | allowed             | allowed            | `Receipt.redeem` (cons-first, then collateral 1:1) |
| European  | `true`   | reverts             | allowed            | `Receipt.redeem` (cons-first, then collateral 1:1) |

## The exercise window

Every option has two timestamps, both baked in at creation:

- **`expirationDate`** — when the option "expires" in the classical sense.
- **`exerciseDeadline = expirationDate + windowSeconds`** — when exercise actually closes
  for everyone.

`windowSeconds` is taken **literally** — the contract never substitutes a default.
American options may pass `0` (no post-expiry extension — the deadline collapses onto
`expirationDate`). European options require `windowSeconds > 0`. The factory exposes
`DEFAULT_EXERCISE_WINDOW = 8 hours` as an *informational* suggested default for
frontends; the contract itself does not consult it.

The window boundary is **inclusive**: `block.timestamp == exerciseDeadline` is still
in-window. Exercise, `transfer`/`transferFrom`, and pair-`burn` all stop at the same
boundary. The collateral leg of short-side redemption only opens *strictly after*
`exerciseDeadline`.

```
   mint window            exercise window
 ──────────────●────────────────────────●────────────▶  time
          expirationDate          exerciseDeadline
                                  (= expiry + windowSeconds)

 American: exercise allowed across the whole line up to exerciseDeadline (inclusive)
 European: exercise allowed only between expirationDate and exerciseDeadline
```

## Exercise

Exercising burns Options, pays `amount × strike` in consideration (rounded **up**), and
delivers `amount` of collateral.

```solidity
option.exercise(amount);   // or exercise() for the caller's full balance
```

- `exercise()` / `exercise(amount)` — **self-exercise**, always safe: the caller pays
  consideration and receives collateral.
- For **American** options this works any time up to and including `exerciseDeadline`.
- For **European** options it reverts before `expirationDate`; only the post-expiry
  window is exercisable.

Before exercising you must let the factory pull your consideration — the same one-time
approval pattern used for minting (see [Fundamentals → Exercise](./fundamentals#exercising-on-chain)).

### Keeper exercise (`exerciseFor`)

```solidity
option.exerciseFor(holder, amount);   // single holder
option.exerciseFor(holders);          // batch — skips unauthorised / zero-balance entries
```

`exerciseFor` is the **dangerous keeper path**: the caller pays strike *and* receives the
collateral, while the holder gets nothing on-chain. It's authorised only when
`msg.sender == holder` or the holder has granted `factory.allowExercise(keeper, true)`.

Granting `allowExercise` to a non-trusted address is equivalent to handing it a
withdrawal right over your ITM value — use it only with contracts that compensate you
off-band. Note that `approveOperator` is **not** enough: that gates *transfer*, this
gates *consumption*. The batch form silently skips entries that fail the per-holder
allowance check or have a zero balance, so one stale entry can't grief the whole sweep.

## Pair-burn (unwinding before the deadline)

Pair-burn is the "I changed my mind" unwind. If you hold matched Option **and** Receipt
for the same series, burn them together and get your collateral back 1:1:

```solidity
option.burn(amount);
```

- Allowed up to and **including** `exerciseDeadline` (the same `beforeDeadline` boundary
  as transfer and exercise).
- Collateral-neutral: it's the exact inverse of minting a pair. It nets out both sides
  without touching the redemption pool, so it never needs the window to be closed and
  never short-changes other holders.
- No price lookup — pure 1:1 collateral conservation.

If you've opted into auto-mint/burn, receiving Option tokens while holding the matching
Receipt fires this automatically — see
[Fundamentals → Auto-Mint & Auto-Burn](./fundamentals#auto-mint--auto-burn).

## Short-side redemption (after the window)

Once the exercise window has run, the short side (Receipt holders) reclaims value via
redemption. The contract holds whatever mix of collateral and consideration the option
ended with — collateral for the portion never exercised, consideration for the portion
that was — and pays it out **cons-first, then collateral 1:1**:

```solidity
receipt.redeem(amount);   // or redeem() for the caller's full balance
```

1. **Consideration leg** — pays up to the receipt-units the consideration pool can still
   back at the strike rate (`toConsideration(amount, false)`, floor-rounded). This leg
   has **no window gate** — it's callable any time the pool can cover it (reverts
   `InsufficientPool` if the consideration balance is short). It exists because exercised
   options have already swapped collateral out for consideration in.
2. **Collateral leg** — any remainder the consideration pool can't cover is paid 1:1 in
   collateral, but **only after** `block.timestamp > exerciseDeadline`. Pre-deadline, the
   uncovered receipt-units stay in your balance for later redemption.

This is **first-come-first-served by design**: an early redeemer captures the
consideration premium, leaving later post-window redeemers with collateral. There is no
pro-rata split and no oracle-based payout — every receipt is always backed 1:1 by some
mix of collateral and consideration.

### Keeper redemption (`redeemFor`)

```solidity
receipt.redeemFor(holders);   // batch — skips unauthorised entries
```

`redeemFor` is **composability-safe**, unlike `exerciseFor`: funds always flow to the
holder, never to the keeper. The keeper is a pure trigger, authorised per holder by
`factory.allowRedeem(keeper, true)` (or `msg.sender == holder`). A Receipt sitting inside
an ERC-4626 vault or a Morpho market can't be force-unwound by an unauthorised third
party.

### Dust sweep

```solidity
receipt.sweep(token, to);
```

Factory-owner-only, and callable **only once `totalSupply() == 0`** so it can never short
the redemption pool. It cleans up rounding residue and stray tokens after every receipt
has been redeemed.

## No protocol fees

Mint, exercise, pair-burn, and redeem are all 1:1 — what goes in comes out. The protocol
is "free like WETH wrapping." Rounding policy: collections from users round **up**
(`toConsideration(amount, true)` on exercise), payouts to users round **down**; the dust
stays in the contract and is recoverable via `sweep` once the pool is empty.

## Why no oracle?

A time-gated, holder-driven model trades UX for a dramatically smaller attack surface:

- **No price feed to manipulate** — the protocol never reads spot on-chain, so there is
  nothing to spoof, stale, or brick.
- **No settlement transaction to censor** — there is no `settle()` step that a negligent
  or adversarial party can strand.
- **Cost:** passive holders forfeit ITM value if they don't exercise before the deadline.
  Mitigate by authorising a trusted keeper via `factory.allowExercise`, or by exercising
  yourself during the window.
