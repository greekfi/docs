---
title: Greek
slug: /
toc_max_heading_level: 3
---

# Greek

Greek turns options into plain ERC20 tokens. Writing an option locks collateral and mints two tokens: the **Option**, the right to exercise, and the **Receipt**, the claim on the locked collateral. Both transfer freely and trade like any other token; production trading runs through [Bebop](https://bebop.xyz)'s RFQ system.

Every option is fully collateralized, works on any ERC20 pair at any strike and expiry, and comes in **American** and **European** flavours. There is no oracle and no protocol fee: the holder decides when to exercise, inside a time-gated window.

- **[Setup](#setup)**; start here: the holder and writer paths, start to finish.
- **[How It Works](#how-it-works)**; ERC20 option tokens, mint and burn, permissions, exercise and redemption.
- **[Deployed Addresses](#deployed-addresses)**; the factory on every chain.
- **[API Reference](#api-reference)**; full contract surface, generated from the contracts.

## Setup

There are two ways in. A **holder** buys options with cash and may exercise them. A **writer** sells options against collateral and collects the premium. Each side needs a couple of one-time approvals; here is each path start to finish.

### I'm a Holder: Buy, Then Exercise

**1. Approve your cash to Bebop's settlement contract.**

```solidity
IERC20(usdc).approve(bebopContract, type(uint256).max);
```

Read the settlement address off the quote response's `approvalTarget`. See Bebop's [RFQ API](https://docs.bebop.xyz/rfq-api/introduction) for the quote flow.

**2. Buy.** Request a quote, sign, done; the option tokens arrive in your wallet.

**3. Exercise if it's in the money.** Approve the consideration token to the factory once (USDC for a call, WETH for a put), then exercise:

```solidity
IERC20(usdc).approve(address(factory), type(uint256).max);
option.exercise(amount);   // or exercise() for your whole balance
```

Nothing exercises for you: if you don't act before the deadline, the value is forfeited. American options exercise any time up to the deadline, European only in the window after expiration; see [Exercise and Redemption](#exercise-and-redemption).

**Selling back instead?** Grant Bebop's settlement contract once on the factory: `factory.setPermissions(bebopSettlement, 7)`.

### I'm a Writer: Sell, Then Exit

**1. Approve your collateral to the factory**; WETH to write calls, USDC to write puts:

```solidity
IERC20(weth).approve(address(factory), type(uint256).max);
```

**2. Permit Bebop's settlement contract on the factory.** One call, one mask:

```solidity
// TRANSFER | MINT | BURN = 7
factory.setPermissions(bebopSettlement, 7);
```

This lets settlement move your option tokens (`TRANSFER`), mint options you haven't pre-minted at the moment of sale (`MINT`), and unwind your short when you buy options back (`BURN`). It can never exercise your options or touch redemptions. See [Permissions and Security](#permissions-and-security) for all five bits.

**3. Sell.** Quote through the RFQ. The sale pulls your collateral, mints the option, and pays you in one transaction; you now hold Receipt tokens (your short).

**4. Exit the short.** Two ways out:

- **Buy back**; options you buy back pair-burn against your Receipts on arrival and your collateral returns immediately.
- **Redeem**; after the window closes, `receipt.redeem()` pays out what you're owed. See [Exercise and Redemption](#exercise-and-redemption).

## How It Works

### Options as ERC20 Tokens

An option on Greek is a pair of ERC20 tokens. Depositing collateral into the protocol mints both:

```
                        ┌──────────────────┐
  deposit collateral ─▶ │  Greek Protocol  │ ─▶  Option + Receipt
                        └──────────────────┘
```

The **Option** is the long side: the right to pay the strike and take the collateral. The **Receipt** is the short side: the claim on that collateral once the option is exercised or expires. Both are standard ERC20s; transfer, approve, and trade them like any other token. They use the collateral token's decimals, and names come from the option's parameters:

```
OPTA-WETH-USDC-3000-2026-06-27     // American call
OPTE-WETH-USDC-3000-2026-06-27     // European call
RCT-WETH-USDC-3000-2026-06-27      // Receipt, American
RCTE-WETH-USDC-3000-2026-06-27     // Receipt, European
```

### Mint and Burn

Collateral goes in, an Option + Receipt pair comes out. Burning the pair reverses it:

```solidity
IERC20(collateral).approve(address(factory), type(uint256).max);   // once

option.mint(1e18);   // 1 collateral in → 1 Option + 1 Receipt out
option.burn(1e18);   // 1 Option + 1 Receipt in → 1 collateral back
```

Burning works any time up to the exercise deadline. Fee-on-transfer tokens are rejected (`FeeOnTransferNotSupported`); do not use rebasing tokens as collateral.

#### Auto Mint & Burn via Permissions

Grant the `MINT` and `BURN` [permissions](#permissions-and-security) to your swap contract and minting and burning happen inside the transfer itself; the Setup grant (mask `7`) already includes them.

**Selling without minting**; the writer holds collateral but no options:

```solidity
option.transferFrom(writer, holder, 10e18);
```

The writer's balance is 0, so the factory pulls 10e18 collateral, mints 10e18 Option + Receipt, and the transfer delivers the Options to the holder. The writer ends up short 10 Receipt.

**Unwinding on receive**; a writer short 10 Receipt buys 3 options back:

```solidity
option.transferFrom(holder, writer, 3e18);
```

The incoming 3e18 Option meets the writer's Receipts, 3e18 pairs burn, and 3e18 collateral returns to the writer.

### Permissions and Security

The factory keeps one permission bitmask per (owner, operator) pair; a single grant covers every option the factory creates:

```solidity
// Bits from library Perm:
// TRANSFER = 1, MINT = 2, BURN = 4, REDEEM = 8, EXERCISE = 16
factory.setPermissions(operator, mask);   // overwrite the operator's mask
factory.addPermissions(operator, mask);   // OR new bits into the existing mask
```

Every grant covers every option this factory has created or ever will create; there are no per-market grants. Revoke any grant with `factory.setPermissions(operator, 0)`; every change emits `PermissionsUpdated(owner, operator, mask)`, so grants are monitorable on-chain. Acting on your own position never needs a bit; the bits exist only to authorize *other* addresses.

**`TRANSFER` (1)**; treat exactly like an ERC20 approval: grant only to trusted parties such as swap contracts.

- Gates one thing: `Option.transferFrom` skips the per-option ERC20 allowance when the caller holds this bit in the sender's mask.
- The grantee can move any of your option tokens in any market. That is full custody of your longs: it can move them to itself and exercise them as their own holder, capturing your in-the-money value without ever holding `EXERCISE`.
- It cannot touch your Receipt tokens (plain ERC20, no permission hook), your collateral allowance, or anything it hasn't first taken custody of.

**`MINT` (2)**; trusted parties only, ones that won't mint against your collateral allowance.

- Gates `Option.mint(account, amount)` and the auto-mint leg of transfers (which reads the *sender's* mask).
- The grantee can convert your entire factory collateral allowance into positions, in any market, at any strike: `token.approve(factory, X)` plus a `MINT` grant to A is functionally `token.approve(A, X)`. The minted Option + Receipt land in your account, not theirs, but paired with an ordinary ERC20 allowance on an option token the grantee can transfer more than you hold, auto-mint the deficit, and leave you a naked short.
- On your own address, `MINT` switches on auto-mint for transfers you initiate: an oversize transfer no longer reverts with insufficient balance, it pulls collateral and opens a short for the difference.

**`BURN` (4)**; safe on the value axis, timing is the grantee's.

- Gates `Option.burn(account, amount)`, `Option.expire(holder, amount)`, and the auto-burn leg of transfers (which reads the *receiver's* mask for the transfer initiator).
- The grantee can pair-burn your matched Option + Receipt (collateral returns to **you**, never to them), net options it delivers into you against your short, and burn your worthless expired longs.
- The risk is timing, not theft: the grantee chooses the moment your hedge unwinds.

**`REDEEM` (8)**; the low-stakes bit.

- Gates `Receipt.redeemFor(holders)`; entries without the grant are skipped.
- The grantee can trigger redemption of your Receipts; the payout always lands in your wallet. It chooses the timing, and therefore whether you settle into consideration or collateral.

**`EXERCISE` (16)**; the highest-trust bit: grant only to parties that will exercise in good faith.

- Gates `Option.exerciseFor` (single and batch).
- The grantee burns your options, pays the strike itself, and **receives the collateral**; you get nothing on-chain. Nothing in the contract forces it to pass your surplus back; that settlement happens off-chain or not at all.
- Use it for exactly one thing: a keeper that exercises in-the-money options you would otherwise let lapse, and provably returns your share.

<img src="/img/permissions.svg" alt="Permission grants" />

Your favorite LLM may raise concerns about attack vectors in this protocol. Rest assured: follow the same practices you use to protect your spot tokens, as in the diagram, and your assets here are protected the same way. Never grant permissions to anyone you would not normally trust with your tokens. An LLM might also raise malicious collateral tokens. If someone creates an option on a malicious token, that's fine, because you will never interact with it: 1) you will not be swapping those tokens, 2) you never granted anyone permissions to mint options on them, and 3) a trusted swapping party (Bebop) will not deal in them. The two enablements, `token.approve(factory, ...)` and `factory.setPermissions(bebop, TRANSFER | MINT | BURN)`, are all you need. If there's another party you want to enable, that risk is on you.

#### What the Protocol Cannot Do

- **Nothing is upgradeable or pausable.** No proxies anywhere: the Factory deploys the Option and Receipt templates in its own constructor, and there is no setter to swap them. Per-option instances are minimal clones of those templates.
- **An option's terms can never change.** Strike, tokens, expiration, deadline, and flavour are baked into the Receipt clone's bytecode at creation; nothing about a live option is mutable.
- **The owner cannot touch user funds.** The factory owner's entire reach is `Receipt.sweep(token, to)`, and it reverts unless `totalSupply() == 0`; it can only ever move rounding dust after every position has exited. The owner cannot alter permissions, block creation, or spend anyone's allowance.
- **No oracle.** There is no price feed, no `settle()`, and no on-chain price comparison anywhere in the contracts; settlement is purely time-gated.

#### Your Risk With Zero Grants

If all you ever do is `token.approve(factory, X)`, no third party can move anything of yours. Only Receipt contracts registered by the factory can pull that allowance, and only through calls you make yourself: `Option.mint(account, amount)` reverts without the `MINT` grant, `exerciseFor` reverts without `EXERCISE`, `redeemFor` skips holders who never granted `REDEEM`, and your option tokens move only with an ordinary ERC20 allowance.

#### The Grants That Can Hurt You

- **`EXERCISE` to the wrong party.** The grantee can exercise your in-the-money options at any time: they pay the strike, they receive the collateral, and you get nothing on-chain. Grant it only to a keeper that provably settles your share back to you.
- **`MINT` to the wrong party.** `token.approve(factory, X)` plus a `MINT` grant equals `token.approve(grantee, X)`: the grantee can open shorts against your entire factory allowance, in any market, at any strike. Combined with an ordinary ERC20 allowance on the option token, they can also transfer more options than you hold and leave you with a naked short.
- **`TRANSFER` to the wrong party.** Full custody of your long positions: the grantee can move your options to itself and exercise them as its own. This is not weaker than `EXERCISE`; it reaches the same value in two steps.
- **Mask `7` to an address that isn't really the settlement contract.** The grant is only as safe as the address. Verify you are granting to Bebop's actual settlement contract, exactly as you would verify a router before an unlimited approve.

#### Looks Dangerous, Isn't

- **A stranger creates an option market on your token, or on a scam token.** Creation is permissionless, but a market existing touches nothing of yours. Your allowance only moves inside a mint or exercise that you, or a `MINT` grantee of yours, initiated.
- **Someone airdrops you Option or Receipt tokens.** They sit inert. Receiving tokens never pulls your funds and never burns anything unless you granted `BURN` to the party that initiated the transfer; even then, the burn returns collateral to you, not to them.
- **A keeper batch-calls `redeemFor` with your address in the list.** If you never granted `REDEEM`, you are skipped. If you did, the payout still lands in your wallet; the keeper cannot redirect a single token.
- **The factory holds an unlimited allowance from you.** Only Receipt contracts the factory itself deployed can pull it, and only inside your own (or your grantee's) calls. The factory owner has no path to it.
- **A site shows you an unfamiliar option token.** Verify it on-chain: `factory.receipts(option.receipt()) && Receipt(option.receipt()).option() == option`. True means the factory deployed the pair and its terms are fixed in bytecode.
- **Another holder exercises and takes collateral out of the pool.** Exercise pays the strike in at the same rate, so every Receipt stays backed 1:1 by collateral plus consideration; a writer is always owed full value at redemption.

#### Audit

The protocol was audited by [Quantstamp](https://github.com/greekfi/greekfi/tree/main/audit) in June 2026: 0 high, 0 medium, 6 low, and 4 informational findings, against a test suite Quantstamp rated High quality.

### Exercise and Redemption

**Exercise**; the holder pays `strike` in consideration and receives the collateral:

```solidity
IERC20(consideration).approve(address(factory), type(uint256).max);   // once
option.exercise(1e18);   // burn 1 Option, pay 1 × strike, receive 1 collateral
```

**Redemption**; the writer's exit. Exercised options leave consideration in the pool; unexercised options leave collateral. `receipt.redeem()` burns the writer's Receipts and pays out of that pool, consideration first (strike × amount), then collateral 1:1:

```solidity
receipt.redeem();   // or redeem(amount)
```

#### European

Exercise only during the exercise window, from expiration to the deadline. Redeem consideration as exercises happen; redeem collateral after the window closes.

#### American

Exercise any time prior to expiration. Redeem consideration after exercises; redeem collateral after expiration.

Nothing exercises for you; an option never exercised lapses worthless (`option.expire(holder, amount)` cleans up the dead tokens). A keeper granted `EXERCISE` can exercise on your behalf; a keeper granted `REDEEM` can trigger redemption, with payout always to you.

### Calls and Puts

A put is a call on the swapped pair; collateral and consideration trade places, and the contract math is identical. The `isPut` flag only changes how the strike is displayed:

| | Collateral | Consideration | Strike (18 decimals) |
|---|---|---|---|
| **WETH call @ $3,000** | WETH | USDC | `3000e18` (USDC per WETH) |
| **WETH put @ $3,000** | USDC | WETH | `1e36 / 3000e18` (WETH per USDC) |

Minting a call deposits WETH; minting a put deposits USDC. Exercising a put pays WETH and receives USDC; the same swap, reversed.

*TODO: puts are backed by USDC (or similar), so the strike denomination is inverted and the units read strangely. Introduce the concept of a "block" of put options that, when exercised, needs 1 ETH-equivalent.*

## Deployed Addresses

One factory per chain; the contract you approve and grant permissions on.

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

Every option ever created is discoverable on-chain through the factory's `OptionCreated` event; see the [API Reference](#api-reference).

{/* API:BEGIN; generated by scripts/gen-reference.mjs, do not edit by hand */}

## API Reference

Auto-generated from the NatSpec in `foundry/contracts/`. Each contract is collapsible; reads
are listed before state-changing functions, with events and errors in their own collapsible.
Run `yarn docs:gen` from the repo root to refresh.

### Option

The long side. Mint, transfer, exercise, and pair-burn.

<details>
<summary>Functions</summary>

##### receipt

```solidity
Receipt public receipt
```

Paired short-side ERC20 (collateral receipt) that holds the collateral and handles
settlement math. Doubles as the [init](#option) guard; non-zero means initialised.

---

##### factory()

```solidity
function factory() public view returns (address);
```

- Returns `address`

Address of the `Factory` that created this option.

The one getter in this block that is NOT a `Receipt` passthrough: it returns this
contract's own `FACTORY` immutable and never touches the Receipt. Every other view
below forwards to the paired Receipt, where the per-option terms actually live.

---

##### collateral()

```solidity
function collateral() public view returns (address);
```

- Returns `address`

Underlying collateral token (e.g. WETH for a WETH/USDC call).

---

##### consideration()

```solidity
function consideration() public view returns (address);
```

- Returns `address`

Consideration / quote token (e.g. USDC for a WETH/USDC call).

---

##### expirationDate()

```solidity
function expirationDate() public view returns (uint40);
```

- Returns `uint40`

Unix timestamp at which the option expires.

---

##### exerciseDeadline()

```solidity
function exerciseDeadline() public view returns (uint64);
```

- Returns `uint64`

Unix timestamp at which the post-expiry exercise window closes.

---

##### strike()

```solidity
function strike() public view returns (uint256);
```

- Returns `uint256`

Strike price in 18-decimal fixed point, encoded as "consideration per collateral".

For puts, this stores the *inverse* of the human-readable strike (see [name](#option) for display).

---

##### isPut()

```solidity
function isPut() public view returns (bool);
```

- Returns `bool`

`true` if this is a put option; `false` for calls.

---

##### isEuro()

```solidity
function isEuro() public view returns (bool);
```

- Returns `bool`

`true` for European-style options (exercise barred before `expirationDate`; only the
post-expiry window is exercisable). `false` for American, which is exercisable at any
time up to and including `exerciseDeadline`.

---

##### decimals()

```solidity
function decimals() public view override returns (uint8);
```

- Returns `uint8`

Option token shares the collateral's decimals so 1 option token ↔ 1 collateral unit.

Read live from the collateral token on every call, not from the Receipt's cached
`decimals` immutable arg. The two agree for any supported (non-rebasing, standard)
ERC-20.

---

##### name()

```solidity
function name() public view override returns (string memory);
```

- Returns `string memory`

Human-readable token name in the form `OPT[E/A]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `OPTE-` prefix flags European options, `OPTA-` flags American options, and the
date is the UTC day of `expirationDate`, not of `exerciseDeadline`.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form,
guarded on `strike() > 0` so a zero strike renders as `0` rather than dividing by zero.

---

##### symbol()

```solidity
function symbol() public view override returns (string memory);
```

- Returns `string memory`

Same as [name](#option). Matching name/symbol keeps wallets and explorers in sync.

---

##### balancesOf(address account)

```solidity
function balancesOf(address account) public view returns (Balances memory);
```

- `account` `address`: Address to query.
- Returns `Balances`: A `Balances` struct: collateral token, consideration token, long option, short receipt.

All four balances that matter for this option in one call.

---

##### details()

```solidity
function details() public view returns (OptionInfo memory);
```

- Returns `OptionInfo`: An `OptionInfo` struct. Every field is sourced from the paired `Receipt`, so the `strike` returned is the raw 18-decimal value, still inverted for puts.

Full option descriptor; addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.

---

##### mint(uint256 amount)

```solidity
function mint(uint256 amount) public nonReentrant;
```

- `amount` `uint256`: Collateral-denominated mint amount, in collateral decimals.

Mint `amount` option tokens to the caller, collateralised 1:1 with the underlying.
The caller receives the matching `Receipt` too, and pays the collateral out of their
ERC-20 allowance to the `Factory`. Barred from `expirationDate` onwards ([notExpired](#option)).

---

##### mint(address account, uint256 amount)

```solidity
function mint(address account, uint256 amount) public nonReentrant;
```

- `account` `address`: Recipient of both `Option` and `Receipt` tokens. Pays the collateral.
- `amount` `uint256`: Collateral-denominated mint amount.

Mint `amount` option tokens to `account`. Collateral is pulled from `account` via
the factory's centralised allowance, so the caller must be `account` itself or hold
`Perm.MINT` in `account`'s factory permission mask; otherwise any address holding
a non-zero factory allowance could be force-minted into unwanted positions.

`Perm.MINT` is an explicit, single-purpose grant: it lets the operator pull the
holder's factory collateral allowance into new positions (functionally a permit on
collateral). It is NOT implied by `Perm.TRANSFER` or any other bit.

---

##### transfer(address to, uint256 amount)

```solidity
function transfer(address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

- `to` `address`
- `amount` `uint256`
- Returns `bool`

Overridden to run the auto-mint / auto-burn hook, so this is NOT a plain ERC-20
transfer: it may mint against the caller's collateral or net options out at the
receiver, and it always returns `true` or reverts. Reverts `ExerciseWindowClosed` once
`block.timestamp > exerciseDeadline`; the long token keeps circulating through the
window so holders can still sell to keepers. See [_settledTransfer](#option) for the two legs.

---

##### transferFrom(address from, address to, uint256 amount)

```solidity
function transferFrom(address from, address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

- `from` `address`
- `to` `address`
- `amount` `uint256`
- Returns `bool`

Skips `_spendAllowance` when [notAuthorized](#option) says it may; i.e. when `msg.sender` is
`from` itself, or holds `Perm.TRANSFER` in `from`'s factory permission mask (a blanket
approval across every option this factory has created or will create). Otherwise the
ordinary per-option ERC-20 allowance is spent. Then runs the same
[_settledTransfer](#option) hook as [transfer](#option), and is likewise gated by [beforeDeadline](#option).
Note the asymmetry with the hook: `Perm.TRANSFER` decides who may move the tokens,
while the hook's two legs key on `Perm.MINT` in `from`'s row and `Perm.BURN` in `to`'s
row. Holding TRANSFER alone reaches neither leg.

---

##### exercise()

```solidity
function exercise() public;
```

Exercise the caller's entire Option balance: pay consideration, receive collateral.

Self-exercise; the safe path. Delegates to `exerciseFor(address,uint256)` with
`holder = msg.sender`, so msg.sender pays AND msg.sender receives (no dangerous
asymmetry). Reverts `ZeroValue` when the caller holds nothing; the balance is read at
call time, so this exercises everything held including options received earlier in
the same transaction.

---

##### exercise(uint256 amount)

```solidity
function exercise(uint256 amount) public;
```

- `amount` `uint256`: Collateral units to receive. Consideration paid = `ceil(amount * strike)`, pulled from the caller's ERC-20 allowance to the `Factory`.

Exercise `amount` of the caller's own options: pay consideration, receive collateral.

Self-exercise; the safe path. Delegates to `exerciseFor(address,uint256)` with
`holder = msg.sender`, so msg.sender pays AND msg.sender receives (no dangerous
asymmetry).

---

##### exerciseFor(address holder, uint256 amount)

```solidity
function exerciseFor(address holder, uint256 amount) public canExercise nonReentrant nonZero(amount) returns (uint256);
```

- `holder` `address`: Option holder whose tokens will be burned. Receives nothing on-chain.
- `amount` `uint256`: Collateral units to exercise. Consideration collected from `msg.sender` is `ceil(amount * strike)`; `msg.sender` receives the `amount` of collateral.
- Returns `uint256`: Collateral units exercised. Always exactly `amount`; the call reverts rather than partially filling, so the value is informational for on-chain callers.

**Dangerous keeper path**; burn `amount` of `holder`'s options; `msg.sender` pays
the consideration and receives the collateral. The holder gets nothing on-chain.
Use this only when:
(a) `msg.sender` is a contract that will deliver the holder's economic surplus
off-band (e.g. a flash-loan router that sells the collateral, repays the
flash loan with the consideration cost, and pays the holder the spread), or
(b) the holder explicitly intends to gift the exercise value to `msg.sender`.
Authorisation: `msg.sender` must be `holder` themselves or hold `Perm.EXERCISE`
in the holder's factory permission mask (`factory.setPermissions(keeper,
Perm.EXERCISE)`). **Granting EXERCISE to a non-trusted operator is equivalent to
giving them a withdrawal right over your ITM value.** `Perm.TRANSFER` does not gate
*this function*, but it is not a weaker grant: an operator holding TRANSFER can move
your longs to itself and exercise them as their own holder, reaching the same ITM
value by a different route. Both bits are custody-grade; see `Perm`.
Allowed any time exercise itself is allowed ([canExercise](#option): pre-expiry for American,
plus the post-expiry window through `exerciseDeadline` for both flavours). Reverts
`ZeroValue` on a zero `amount`, `Unauthorized` without the grant, and
`ERC20InsufficientBalance` if `holder` does not hold `amount`; this path never
partially fills.

---

##### exerciseFor(address[] calldata holders, uint256[] calldata amounts)

```solidity
function exerciseFor(address[] calldata holders, uint256[] calldata amounts) external canExercise nonReentrant;
```

- `holders` `address[]`: Option holders whose options will be exercised.
- `amounts` `uint256[]`: Per-holder collateral amounts to exercise; must align 1:1 with `holders` (unequal lengths revert `InvalidValue`).

Batch variant of `exerciseFor(address,uint256)`. Same dangerous semantics; the
caller pays consideration and receives collateral for every holder. Exercises
`amounts[i]` of `holders[i]` and emits one [Exercise](#option) per processed entry.
Three classes of entry are skipped rather than reverting, so one bad row cannot
grief the sweep for everyone else: a zero `amounts[i]`, an `amounts[i]` greater than
`balanceOf(holders[i])` (a holder who has since sold), and a holder who has not
granted the caller `Perm.EXERCISE`. A batch in which every entry is skipped; an
empty array included; succeeds as a no-op.

Skipping is the ONLY containment. `InvalidValue` on a length mismatch, the
[canExercise](#option) window checks, and anything that makes `Receipt.exercise` revert; notably the caller's own consideration balance or factory allowance running out
partway down the list; abort the whole batch and roll back the holders already
processed. A repeated `holders[i]` is exercised once per occurrence, subject to the
balance check against the balance remaining after the earlier ones.
Unlike `exerciseFor(address,uint256)` this returns nothing, so on-chain callers
cannot tell which entries were skipped; read the balances back or watch the events.

---

##### burn(uint256 amount)

```solidity
function burn(uint256 amount) public;
```

- `amount` `uint256`: Collateral-denominated amount to burn from each side.

Burn matched `Option` + `Receipt` pairs to recover the underlying collateral.

Shorthand for `burn(msg.sender, amount)`. Available up to and including
`exerciseDeadline` (boundary inclusive; same as transfer/exercise). Pair-burn nets
both sides 1:1 so it does not require the exercise window to be closed, and unlike
minting it stays open past `expirationDate`. Once `block.timestamp >
exerciseDeadline` it reverts `ExerciseWindowClosed` and short-side exits must route
through `Receipt.redeem` / `Receipt.redeemFor`. The caller must hold at least
`amount` of BOTH sides; the long burn happens first, so a caller holding only the
short side reverts `ERC20InsufficientBalance` on the option token.

---

##### burn(address account, uint256 amount)

```solidity
function burn(address account, uint256 amount) public nonReentrant nonZero(amount) beforeDeadline;
```

- `account` `address`: Holder of the matched Option + Receipt pair, and recipient of the collateral.
- `amount` `uint256`: Collateral-denominated amount to burn from each side.

Burn `amount` matched `Option` + `Receipt` pairs held by `account`, returning the
underlying collateral to `account`.

The real implementation; `burn(uint256)` is a wrapper. Same timing rules; gated by
[beforeDeadline](#option), so valid up to and including `exerciseDeadline`. The caller must be
`account` itself or hold `Perm.BURN` in `account`'s factory permission mask, else
`Unauthorized`. Trigger-only grant: the recovered collateral always goes to `account`
(via `Receipt.burn`), never to the caller, so a BURN operator can unwind a holder's
matched position but not extract value from it. It can still choose the *moment*; and note that the auto-burn leg of [_settledTransfer](#option) gives a BURN grantee a reach
this function does not have, because there the operator supplies the longs. See `Perm`.

---

##### expire(address holder, uint256 amount)

```solidity
function expire(address holder, uint256 amount) public nonReentrant nonZero(amount);
```

- `holder` `address`: Address of the long option holder.
- `amount` `uint256`: Amount of long option tokens to burn. Must not exceed the holder's balance.

Burn expired long option tokens to clean up dust.

Only callable strictly after `exerciseDeadline`; this is the one mutator that is
barred *while* the option is live rather than after. Past the deadline an unexercised
long token is inert: it can no longer be exercised ([canExercise](#option)), transferred or
pair-burned ([beforeDeadline](#option)), so it would otherwise sit in the holder's wallet
forever. This burns the long side only; it touches neither collateral nor the paired
`Receipt`, so it has no effect on the redemption pool or the solvency invariant
(short-side collateral is recovered separately via `Receipt.redeem`). Reverts
`NotYetExpired` on or before the deadline; use `burn(address,uint256)` or the
[exercise](#option) paths while live.
Caller must be `holder` or hold `Perm.BURN` in the holder's factory permission mask
(reverts `Unauthorized` otherwise); BURN, not EXERCISE, because this is a pure
cleanup burn: the tokens are already worthless, so a keeper gains nothing here. The
authorisation check runs BEFORE the timestamp check, so an unauthorised caller sees
`Unauthorized` even while the option is still live.

</details>

<details>
<summary>Events & Errors</summary>

##### Mint

```solidity
event Mint(address longOption, address holder, uint256 amount);
```

- `longOption` `address`: The Option contract (always `address(this)`).
- `holder` `address`: The account credited with the new tokens, and the account whose collateral is pulled to back them.
- `amount` `uint256`: Collateral-denominated amount (same decimals as the collateral token).

Emitted when new options are minted against fresh collateral; by either [mint](#option)
overload or by the auto-mint leg of [_settledTransfer](#option), which routes through the
same `mint_`. A matching `Receipt` is always minted to `holder` alongside.

---

##### Exercise

```solidity
event Exercise(address longOption, address caller, address holder, uint256 amount);
```

- `longOption` `address`: The Option contract (always `address(this)`).
- `caller` `address`: The account that initiated the exercise: it pays the consideration and receives the collateral. Equal to `holder` only on the self-exercise paths.
- `holder` `address`: The account whose options were burned. Receives nothing on-chain when `caller != holder`.
- `amount` `uint256`: Collateral units delivered to `caller` (consideration collected from `caller` is `toConsideration(amount, true)`, ceil).

Emitted once per exercised holder; by `exerciseFor(address,uint256)`, by the
[exercise](#option) overloads that delegate to it, and once per processed entry of the batch
`exerciseFor(address[],uint256[])`.

---

##### Expire

```solidity
event Expire(address longOption, address caller, address holder, uint256 amount);
```

- `longOption` `address`: The Option contract (always `address(this)`).
- `caller` `address`: The account that called [expire](#option); the holder themselves, or an operator holding `Perm.BURN` in the holder's factory permission mask.
- `holder` `address`: The account whose options were burned.
- `amount` `uint256`: Amount of options burned.

Emitted **only** by an explicit [expire](#option) call; the sole site that emits this event.
An option passing `exerciseDeadline` emits nothing on its own; expiry is a timestamp
comparison, not a transaction. Indexers must not treat this as "the option expired",
only as "someone burned already-worthless long tokens".

---

##### ContractExpired

```solidity
error ContractExpired();
```

Thrown by [notExpired](#option); the only minting gate; when `block.timestamp >=
expirationDate`. Reached from both [mint](#option) overloads and from the auto-mint leg of
[_settledTransfer](#option), so an over-balance transfer between `expirationDate` and
`exerciseDeadline` reverts with this even though plain transfers are still open.

---

##### ZeroValue

```solidity
error ZeroValue();
```

Thrown by [nonZero](#option) when `amount == 0`; it guards `mint_` (so both [mint](#option)
overloads), `exerciseFor(address,uint256)`, `burn(address,uint256)` and [expire](#option); and by [init](#option) when `receipt_` is the zero address. The batch
`exerciseFor(address[],uint256[])` skips zero entries instead of reverting.

---

##### InvalidValue

```solidity
error InvalidValue();
```

Thrown when batch `exerciseFor(address[],uint256[])` is given `holders`/`amounts`
arrays of unequal length. Not used anywhere else.

---

##### ExerciseWindowClosed

```solidity
error ExerciseWindowClosed();
```

Thrown once `block.timestamp > exerciseDeadline`, by every path that stays open
through the window: the exercise paths via [canExercise](#option), and [transfer](#option),
[transferFrom](#option) and `burn(address,uint256)` via [beforeDeadline](#option).

---

##### InvalidExercise

```solidity
error InvalidExercise();
```

Thrown by [canExercise](#option) when exercise is attempted on a European option before
`expirationDate`. American options never produce it.

---

##### AlreadyInitialized

```solidity
error AlreadyInitialized();
```

Thrown when [init](#option) is called on a clone that has already been initialised, or on
the template (whose `receipt` is set to a sentinel by the constructor).

---

##### Unauthorized

```solidity
error Unauthorized();
```

Thrown whenever the caller lacks the required grant: [init](#option) called by anyone other
than the factory, and `mint(address,uint256)`, `exerciseFor(address,uint256)`,
`burn(address,uint256)` and [expire](#option) called by someone who is neither the owner of
the position nor a holder of the matching `Perm` bit. The batch
`exerciseFor(address[],uint256[])` skips such entries instead of reverting.

---

##### NotYetExpired

```solidity
error NotYetExpired();
```

Thrown when [expire](#option) is called on or before `exerciseDeadline` (the option is still live).

</details>

### Receipt

The short side. Escrows the collateral; redeem after the window.

<details>
<summary>Functions</summary>

##### factory

```solidity
IFactory public immutable factory
```

Factory that created this option, used to pull tokens against their ERC-20
allowance to the factory. Set in the template constructor (= the factory that
deployed it) and inherited by every clone via the template's runtime bytecode.

---

##### STRIKEDEC

```solidity
uint8 public constant STRIKEDEC = 18
```

Decimal basis of the strike; fixed at 18 and independent of token decimals.

---

##### consBacked

```solidity
uint256 public consBacked
```

Receipt-units the consideration pool can still back at strike rate. Incremented on
[exercise](#receipt) (cons inflow) and decremented by the cons leg of [_redeem](#receipt) (cons payout);
the collateral leg of redeem leaves it untouched. Equal to (total exercised − total
cons-redeemed), and never underflows; the cons leg caps its payout at this value.
Denominated in receipt/collateral units (the cons equivalent is `toConsideration`).

---

##### strike()

```solidity
function strike() public pure returns (uint256);
```

- Returns `uint256`

Strike price, 18-decimal fixed point (consideration per collateral; inverted for puts).

---

##### collateral()

```solidity
function collateral() public pure returns (IERC20);
```

- Returns `IERC20`

Underlying collateral token (e.g. WETH). All collateral sits here.

---

##### consideration()

```solidity
function consideration() public pure returns (IERC20);
```

- Returns `IERC20`

Consideration / quote token (e.g. USDC). Accrues here from exercise payments.

---

##### option()

```solidity
function option() public pure returns (address);
```

- Returns `address`

The paired `Option` contract. Only this address can call mint / burn / exercise.

---

##### expirationDate()

```solidity
function expirationDate() public pure returns (uint40);
```

- Returns `uint40`

Unix timestamp at which the option expires and the post-expiry exercise window opens.

Minting stops strictly before this instant (`Option.mint_`'s `notExpired`), and for a
European option both exercise and the consideration leg of [redeem](#receipt) open at it.

---

##### exerciseDeadline()

```solidity
function exerciseDeadline() public pure returns (uint64);
```

- Returns `uint64`

Unix timestamp at which the post-expiry exercise window closes.

Returned as `uint64`: the stored value is `expirationDate + windowSeconds`,
and that sum can exceed `type(uint40).max` even though each operand is uint40,
so reading the full 64-bit slot avoids silently truncating the deadline.

---

##### isPut()

```solidity
function isPut() public pure returns (bool);
```

- Returns `bool`

`true` if put, `false` if call.

---

##### isEuro()

```solidity
function isEuro() public pure returns (bool);
```

- Returns `bool`

`true` if European-style.

---

##### decimals()

```solidity
function decimals() public pure override returns (uint8);
```

- Returns `uint8`

This Receipt's own ERC-20 decimals: the cached `collateral.decimals()`, so one receipt
unit is exactly one collateral unit. Also the collateral side of the conversion scaling.

---

##### consDecimals()

```solidity
function consDecimals() public pure returns (uint8);
```

- Returns `uint8`

Cached `consideration.decimals()` used in conversion math.

---

##### toConsideration(uint256 amount, bool round)

```solidity
function toConsideration(uint256 amount, bool round) public pure returns (uint256);
```

- `amount` `uint256`: Collateral units.
- `round` `bool`: `true` rounds UP, `false` floors. UP for collections from users ([exercise](#receipt)), DOWN for payouts to users (the consideration leg of [_redeem](#receipt)); inverting that pairing is what would let the pool run short. See the Rounding section on the contract.
- Returns `uint256`: Consideration units, in the consideration token's own decimals.

Convert a collateral-denominated (equivalently receipt-denominated) amount into the
consideration due for it at the strike price.

Evaluates `amount * strike * numer / (1e18 * denom)` as one `mulDiv`, so only
`strike * numer` can overflow; and `Factory` rejects at creation any strike that would.

---

##### toCollateral(uint256 consAmount)

```solidity
function toCollateral(uint256 consAmount) public pure returns (uint256);
```

- `consAmount` `uint256`
- Returns `uint256`

Convert a consideration amount to the matching collateral-denominated receipt count.

Floors by design. No longer used internally; `_redeem` now tracks cons-backed
receipt-units via the `consBacked` counter; but exposed for off-chain
indexers and invariant tests that need the inverse of [toConsideration](#receipt).

---

##### name()

```solidity
function name() public view override returns (string memory);
```

- Returns `string memory`

Human-readable token name in the form `RCT[E]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `RCTE-` prefix flags European options, `RCT-` American; note this differs from
`Option.name`, which spells its flavours `OPTE-` / `OPTA-`.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form.
`strike` is non-zero for every option `Factory` can create, so the division is safe.

---

##### symbol()

```solidity
function symbol() public view override returns (string memory);
```

- Returns `string memory`

Same as [name](#receipt). Matching name/symbol keeps wallets and explorers in sync.

---

##### redeem()

```solidity
function redeem() public nonReentrant;
```

The queue is keyed on a current receipt balance and nothing else; receipts carry no
mint timestamp and no assignment tag. For an American option the mint window
(`block.timestamp < expirationDate`) and this consideration leg overlap, so while
`consBacked > 0` **anyone** may mint fresh receipts and join the front of the queue,
including someone who never wrote the option and bore no assignment risk. European
options are structurally immune: minting stops at `expirationDate` and exercise
cannot happen before it, so the two windows never overlap.
In practice the exposure is small and self-limiting, because it needs all of:
1. a *pre-expiry* exercise (the bulk of exercise happens in the post-expiry window,
where minting is already closed by `notExpired`, so this attack cannot run);
2. only partial exercise (if everyone exercised, the pool is fully claimed anyway);
3. spot then falling back below the strike before `expirationDate`.
The value a latecomer can take is bounded by how far spot round-trips below the
strike within the option's remaining life; and since early exercise is only rational
close to expiry, that remaining life is usually short and the swing correspondingly
small.
**The mitigation is proactive redemption, and it is available to you at all times.**
You already hold receipts, so you are ahead of anyone who must mint first. If spot
weakens back through the strike after an exercise, redeem; that is precisely the
"buy to close at strike" trade this leg exists to give you, and taking it both locks
in your settled cash and empties the pool a latecomer would otherwise draw on.
Writers who intend to manage a position rather than hold it passively should monitor
`consBacked` and redeem when the consideration leg is the leg they want.

---

##### redeem(uint256 amount)

```solidity
function redeem(uint256 amount) public nonReentrant;
```

- `amount` `uint256`: Receipt units to redeem. Reverts `ERC20InsufficientBalance` above the caller's balance; there is no implicit cap to it.

Redeem `amount` of the caller's Receipt. Same semantics as [redeem](#receipt), dust rule included.

---

##### sweep(address token, address to)

```solidity
function sweep(address token, address to) external nonReentrant;
```

- `token` `address`: ERC20 to drain. Typically the option's collateral or consideration, but any token is accepted; a `token` this contract holds none of is a no-op (no event).
- `to` `address`: Recipient of the swept balance. Chosen by the factory owner; must be non-zero.

Sweep any residual `token` balance held by this Receipt to `to`. Callable only by
the factory owner, and only once every receipt has been burned (`totalSupply == 0`),
so this can never short the redemption pool; it strictly cleans up rounding
residue, post-redemption donations, or stray ERC20s sent here by accident.

`totalSupply() == 0` is the whole guarantee, and it is stronger than it looks: the
solvency identity makes `consBacked <= totalSupply()`, so an empty supply also means
nothing is cons-backed and no holder has a claim on either pool. Everything left is
unowned.
Two consequences worth planning for. First, this is the one path that moves a token
other than the pair's own two, and it reports the move as [Redeemed](#receipt); see that event.
Second, the authority is the factory owner *at call time*: `Ownable.renounceOwnership`
on the `Factory` sets the owner to `address(0)`, and since no call can arrive from that
address, every sweepable balance in every Receipt this factory ever created is stranded
permanently. Renouncing is a decision about this function, not just about the factory.

---

##### redeemFor(address[] calldata holders)

```solidity
function redeemFor(address[] calldata holders) external nonReentrant;
```

- `holders` `address[]`: Holders whose receipts to redeem in full.

Keeper-triggered batch redeem. For each holder where the caller holds `Perm.REDEEM`
in the holder's factory permission mask (or `msg.sender == holder`), the
holder's full balance is redeemed under [redeem](#receipt) semantics (cons-first; mix only
post-window). The resulting collateral / consideration go to the **holder**; never to the caller. Unauthorised and zero-balance holders are skipped silently
so a single stale entry doesn't brick the batch.
Composability-safe by design: a Receipt held inside an ERC4626 vault, Morpho
market, or multisig CANNOT be force-*redeemed* by an unauthorised third party
(the previous permissionless `redeem(address)` variants were removed for exactly
this reason; they let any caller change a vault's collateral balance out from
under it). The auto-burn leg of `Option._settledTransfer` upholds the same principle
for *triggering*: it fires only when the receiver has granted `Perm.BURN` to the
account that **initiated** the transfer (`msg.sender`, not necessarily the token
sender `from`), so an unauthorised party cannot start an unwind of a held position.
**It does not control the size.** The guard decides *whether* auto-burn fires; the
amount is `Math.min(receipt.balanceOf(to), value)`, and `balanceOf` here is a plain
ERC-20 balance that ANY address can increase by transferring Receipt tokens to `to`; this contract has no transfer restriction and no opt-out for unsolicited shorts. A
stranger can therefore donate shorts to a vault so that the vault's next *authorised*
inbound Option transfer is fully netted: the vault receives collateral instead of the
long tokens, at a size the stranger chose. Integrators must NOT assume an inbound
`Option` transfer raises their option balance by the amount transferred; read the
balance back.
**Reverts are NOT contained.** Only unauthorised and zero-balance holders are skipped.
Anything that makes `_redeem` itself revert; [ExerciseWindowOpen](#receipt) when the consideration
pool is empty pre-window, [BeforeExerciseWindow](#receipt) on a European option, or the defensive
[InsufficientPool](#receipt); aborts the WHOLE batch and rolls back the holders already
processed. Because the cons leg is FCFS, the pool empties partway down any long list, so
a pre-window batch reverting is the ordinary outcome rather than an edge case. Callers
should size batches accordingly, or call [redeem](#receipt) per holder if partial progress matters.
Dust is not skipped, and is the one way this can destroy value: a holder whose balance
converts to zero consideration is burned for no payout, exactly as in [redeem](#receipt). A keeper
sweeping a long holder list pre-window will do that to every dust holder on it.
A repeated holder redeems their full balance on the first occurrence; post-window the
later occurrences hit the zero-balance skip. Pre-window the cons leg caps at
`consBacked` and can leave a remainder, so a repeat may still redeem again there.

</details>

<details>
<summary>Events & Errors</summary>

##### Redeemed

```solidity
event Redeemed(address option, address token, address holder, uint256 amount);
```

- `option` `address`: The paired Option contract.
- `token` `address`: The token actually transferred out. Usually `collateral` or `consideration`, but [sweep](#receipt) takes an arbitrary ERC20 and emits this event for it, so an indexer must read this field rather than assume the pair's two tokens; a swept stray token will otherwise be mis-parsed as a redemption in collateral or consideration.
- `holder` `address`: Recipient of the payout: the redeeming/burning holder, or [sweep](#receipt)'s `to`, which is chosen by the factory owner and need not have held anything.
- `amount` `uint256`: Token units sent, in `token`'s own decimals.

Emitted on every path that pays tokens OUT of this contract except [exercise](#receipt), whose
collateral delivery is reported by `Option.Exercise` instead: [burn](#receipt), both legs of
[_redeem](#receipt) (one event per leg, so a mixed redemption emits twice), and [sweep](#receipt).

---

##### UnauthorizedCaller

```solidity
error UnauthorizedCaller();
```

Thrown when a privileged path is called by anyone other than the paired `Option`.

---

##### ContractExpired

```solidity
error ContractExpired();
```

Never thrown by Receipt itself; the pre-expiry mint gate is enforced by the paired
`Option` (`notExpired` on `mint_`). Declared for ABI/tooling parity.

---

##### ZeroValue

```solidity
error ZeroValue();
```

Thrown on `amount == 0` (or any derived zero-amount the invariant requires to be positive).

---

##### ExerciseWindowClosed

```solidity
error ExerciseWindowClosed();
```

Never thrown by Receipt itself; the exercise-deadline gate is enforced by the
paired `Option` (`canExercise` / `beforeDeadline`). Declared for ABI/tooling parity.

---

##### ExerciseWindowOpen

```solidity
error ExerciseWindowOpen();
```

Thrown when a post-window-only path is called before the window closes.

---

##### BeforeExerciseWindow

```solidity
error BeforeExerciseWindow();
```

Thrown when short-side redemption is attempted on a European option before its
exercise window opens (`block.timestamp < expirationDate`). Mirrors the long-side
European pre-expiry guard so the revert reason states the schedule explicitly.

---

##### OutstandingReceipts

```solidity
error OutstandingReceipts();
```

Thrown when [sweep](#receipt) is called while receipts are still outstanding.

---

##### InsufficientPool

```solidity
error InsufficientPool();
```

Thrown when the consideration or collateral pool cannot fully fund its leg of the
requested redemption. Both branches are defensive: neither can fire for a caller
redeeming at most their own balance. The collateral leg is bounded exactly by the
solvency identity `collateral.balanceOf(this) == totalSupply() - consBacked` (plus any
donation), and the leg only ever asks for `amount_ - consBacked`. The consideration leg
pays `floor(k·amount)` with `amount` capped at `consBacked`, out of a pool filled by
ceil-rounded collections, and `Σceil(k·aᵢ) − Σfloor(k·bⱼ) ≥ floor(k·(Σaᵢ − Σbⱼ))` holds
identically. What does reach this error is an over-sized request: past
`exerciseDeadline`, an `amount_` exceeding `totalSupply()` (plus any donated collateral)
reverts here rather than with `ERC20InsufficientBalance`, because the pool check runs
before the burn. Redeem no more than `balanceOf(you)`; splitting into smaller amounts is
not a remedy for anything else.

</details>

### Factory

Creates options; holds token approvals and permission grants.

<details>
<summary>Functions</summary>

##### DEFAULT_EXERCISE_WINDOW

```solidity
uint40 public constant DEFAULT_EXERCISE_WINDOW = 8 hours
```

Informational suggested-default for the post-expiry exercise window. The contract
NEVER substitutes this value; `CreateParams.windowSeconds` is taken literally.
Exposed so frontends can read a canonical "8 hours" without hardcoding it.

---

##### receipts

```solidity
mapping(address => bool) public receipts
```

`true` if the address is a Receipt clone this factory created. Doubles as the auth
gate for [transferFrom](#factory); only registered Receipts can pull collateral/consideration.
Validate an Option by reading its `receipt()` and confirming
`factory.receipts(rec) && Receipt(rec).option() == opt`.

---

##### optionFor

```solidity
mapping(bytes32 => address) public optionFor
```

Canonical Option address for a given set of economic params, keyed by [optionKey](#factory).
`address(0)` means no option with those params exists yet. [createOption](#factory) is
get-or-create: a second call with economically-identical params returns the existing
Option instead of deploying a duplicate, so identical markets stay canonical/deduped
and existence is queryable on-chain. [createOption2](#factory) deduplicates the same way but is
strict about it; with a non-zero salt a registry hit reverts [OptionExists](#factory) rather
than returning an address the caller did not mine.
Write-once: an entry is never cleared or overwritten, so the canonical address for a
given key is fixed for the life of the factory.

---

##### permissions

```solidity
mapping(address => mapping(address => uint256)) public permissions
```

Permission table: `permissions[owner][operator] -> bitmask` of `Perm` flags.
One row per (owner, operator) pair covering every option this factory created:
TRANSFER (1), MINT (2), BURN (4), REDEEM (8), EXERCISE (16). The self entry
`permissions[account][account]` holds the account's own auto-mint opt-in
(MINT = auto-mint on shortfall); auto-burn reads `permissions[to][msg.sender]`, the
receiver's grant to the transfer's initiator, so the self entry applies there only
when the two are the same account. See `Perm` for the full semantics and risk notes
per bit.
Testing a grant: for a multi-bit `mask` the ALL and ANY forms differ, and picking the
wrong one fails open. Spell out whichever you mean:
holds every bit: `permissions(o, op) & mask == mask`
holds any bit:   `permissions(o, op) & mask != 0`

---

##### optionKey(CreateParams memory p)

```solidity
function optionKey(CreateParams memory p) public pure returns (bytes32);
```

- `p` `CreateParams`: The `CreateParams` to key.
- Returns `bytes32`: The `keccak256` registry key.

Deterministic registry key for a set of economic params. All seven `CreateParams`
fields are economic identity, so every one is folded into the hash; two params that
differ in any field produce different keys (and therefore distinct option markets).

`public pure` so off-chain callers and tests can compute the key and look up
`optionFor` without a creation tx.

---

##### createOption(CreateParams memory p)

```solidity
function createOption(CreateParams memory p) public nonReentrant nonZero(p.strike) returns (address option_);
```

- `p` `CreateParams`: See `CreateParams`: - `collateral`, `consideration`: ERC20 addresses; must differ. Standard ERC-20 only; no fee-on-transfer or rebasing tokens. - `expirationDate`: unix timestamp; must be strictly greater than `block.timestamp`. - `strike`: 18-decimal fixed point (consideration per collateral, inverted for puts). Must be non-zero, and when `consDec > collDec` must also satisfy the GRK-3 bound `strike <= type(uint256).max / 10**(consDec - collDec)`. - `isPut`: option flavour. - `isEuro`: `true` for European (no pre-expiry exercise), `false` for American. - `windowSeconds`: post-expiry exercise window length in seconds; taken literally (no contract-side default). American allows `0` (no extension); European requires `> 0`.
- Returns `option_` `address`: The canonical `Option` address; either freshly deployed, or the existing option if an economically-identical one already exists (get-or-create; see `optionFor`).

Deploy a new Option + Receipt pair. Emits [OptionCreated](#factory).

Option is an EIP-1167 clone; Receipt is a clone-with-immutable-args (per-option
strike, decimals, dates, etc. baked into the clone's runtime bytecode).
⚠ `collateral` and `consideration` MUST be standard ERC-20 tokens with exact,
balance-preserving transfers. Fee-on-transfer and rebasing / elastic-supply tokens are
NOT supported and will corrupt the option's 1:1 accounting (see the contract-level
"Supported tokens" note). There is no creation-time guard against this; the caller is
responsible for only pairing standard tokens.

---

##### createOptions(CreateParams[] memory params)

```solidity
function createOptions(CreateParams[] memory params) external returns (address[] memory result);
```

- `params` `CreateParams[]`: Array of `CreateParams`.
- Returns `result` `address[]`: Option addresses aligned with `params`; newly deployed or pre-existing.

Batch form of [createOption](#factory). Same ordering in → same ordering out.

Each entry is a full [createOption](#factory) call, so get-or-create applies per entry: an entry
naming an existing market yields that market's address and deploys nothing. Entries are
not isolated; one invalid entry reverts the whole batch, including entries already
processed.

---

##### setPermissions(address operator, uint256 mask)

```solidity
function setPermissions(address operator, uint256 mask) external nonZeroAddr(operator);
```

- `operator` `address`: Address being granted (or, for the caller's own address, the automation opt-in).
- `mask` `uint256`: Full replacement mask; must not contain bits outside `Perm.ALL`.

Set `operator`'s permission mask over the caller's positions, overwriting any
previous mask. `0` revokes everything. Bits: `Perm.TRANSFER` (1), `Perm.MINT` (2),
`Perm.BURN` (4), `Perm.REDEEM` (8), `Perm.EXERCISE` (16); see `Perm` for what each
bit authorises and its risk profile.

**Intended for audited swap / keeper / vault contracts.** Each bit is an independent
grant; nothing is implied by another bit. In particular:
- `MINT` lets the operator pull the caller's factory collateral allowance to mint
new positions; functionally a permit on collateral. Never grant to EOAs or
unaudited integrations.
- `EXERCISE` lets the operator burn the caller's options, pay the consideration and
keep the collateral; a withdrawal right over the caller's ITM value.
- `TRANSFER` is full custody of the caller's long positions: the operator can move
them to itself and exercise them as their own holder, taking the ITM value without
ever needing `EXERCISE`. Alongside `MINT` it also reaches auto-mint, so it is not
limited to balance the caller actually holds.
- `BURN` / `REDEEM` return their proceeds to the caller, but the operator picks the
moment; and for `REDEEM` the moment determines which leg the caller is settled
into, and can strand them in a naked long. Neither is risk-free. `BURN` also
authorises the auto-burn leg on transfers the operator initiates into the caller,
which closes even a **naked short** because the operator supplies the longs; grant
it only to contracts that do not let third parties pick a transfer's recipient.
`operator == msg.sender` is the **self entry**: `MINT` opts into auto-mint on
transfer shortfall; `BURN` opts into auto-burn only on transfers the caller both
receives and initiates, since that leg reads the receiver's grant to the initiator; netting an inbound transfer from anyone else requires a `BURN` grant to that
initiator (see `Perm`). The other bits are meaningless on self (self action is
always allowed directly).

---

##### addPermissions(address operator, uint256 mask)

```solidity
function addPermissions(address operator, uint256 mask) external nonZeroAddr(operator);
```

- `operator` `address`: Address being granted.
- `mask` `uint256`: Bits to add; must not contain bits outside `Perm.ALL`.

OR `mask` into `operator`'s existing permission mask (adds bits, never removes).
Use [setPermissions](#factory) to remove bits or revoke outright.

</details>

<details>
<summary>Events & Errors</summary>

##### OptionCreated

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

Emitted for every newly-created option. NOT emitted when get-or-create returns an
existing Option; a market's creation event fires exactly once, ever.

---

##### PermissionsUpdated

```solidity
event PermissionsUpdated(address indexed owner, address indexed operator, uint256 mask);
```

Emitted whenever `owner`'s permission mask for `operator` changes ([setPermissions](#factory)
[addPermissions](#factory)). `mask` is the full resulting mask, not a delta.

---

##### InvalidAddress

```solidity
error InvalidAddress();
```

Thrown when a zero address is supplied where a real one is required (either token at
creation, `operator` in [setPermissions](#factory) / [addPermissions](#factory)); and also by
[transferFrom](#factory) when the caller is not a Receipt this factory registered.

---

##### InvalidTokens

```solidity
error InvalidTokens();
```

Thrown when `collateral == consideration` (no real option pair).

---

##### InvalidValue

```solidity
error InvalidValue();
```

Thrown when a value param is invalid: strike (zero, or over the GRK-3 decimals-gap
bound), expiration, window, a token's `decimals()` above 36, a salt array in
[createOptions2](#factory) whose length does not match `params`, or a permission mask carrying
bits outside `Perm.ALL`.

---

##### OptionExists

```solidity
error OptionExists(address existing);
```

Thrown by [createOption2](#factory) / [createOptions2](#factory) when a CREATE2 salt was supplied but an
economically-identical Option already exists at an address that salt does not resolve
to. Carries the occupying address so the caller can either accept it (re-submit with
zero salts, or call [createOption](#factory)) or change the option's economic params. The mined
salt is NOT consumed by this revert; it stays usable on a different market.

---

##### FeeOnTransferNotSupported

```solidity
error FeeOnTransferNotSupported();
```

Thrown when a token's transferFrom delivers less than `amount` (fee-on-transfer / rebasing).

</details>

### Perm

Permission bits for `Factory.setPermissions` / `Factory.addPermissions`, from `contracts/Permissions.sol`. Masks with bits outside `ALL` revert `InvalidValue`.

```solidity
uint256 constant TRANSFER = 1 << 0; // 1,  move the owner's Option tokens
uint256 constant MINT     = 1 << 1; // 2,  mint against the owner's collateral allowance
uint256 constant BURN     = 1 << 2; // 4,  pair-burn for the owner; burn expired longs
uint256 constant REDEEM   = 1 << 3; // 8,  trigger redemption for the owner
uint256 constant EXERCISE = 1 << 4; // 16, exercise for the owner (caller pays strike, receives collateral)
uint256 constant ALL      = 31;     // validity bound, not a recommended grant
```

- `TRANSFER`: `Option.transferFrom` without a per-option ERC20 allowance.
- `MINT`: `Option.mint(account, amount)` and the auto-mint transfer leg.
- `BURN`: `Option.burn(account, amount)`, `Option.expire`, and the auto-burn transfer leg.
- `REDEEM`: `Receipt.redeemFor(holders)`; payout always to the holder.
- `EXERCISE`: `Option.exerciseFor`; the caller pays the strike and receives the collateral.

{/* API:END */}
