---
title: Greek
slug: /
toc_max_heading_level: 3
---

# Greek

Greek turns options into plain ERC20 tokens. Writing an option locks collateral and mints two tokens: the **Option**, the right to exercise, and the **Receipt**, the claim on the locked collateral. Both transfer freely and trade like any other token through RFQ settlement.

Every option is fully collateralized, supports pairs of standard ERC20 tokens at any strike and expiry, and comes in **American** and **European** flavors. Fee-on-transfer and rebasing tokens are not supported. There is no oracle. The holder decides whether to exercise within the option's exercise window. Receipt redemption can carry a per-market protocol fee; exercise and pair-burning are fee-free.

- **[Setup](#setup).** Follow the holder or writer path from start to finish.
- **[How it works](#how-it-works).** Understand the tokens, permissions, exercise, and redemption.
- **[Deployed addresses](#deployed-addresses).** Find the factory on each supported chain.
- **[API reference](#api-reference).** Read the contract interface generated from the contracts.

## Setup

There are two ways in. A **holder** buys options with cash and may exercise them. A **writer** sells options against collateral and collects the premium. Each side needs a couple of one-time approvals; here is each path start to finish.

### Holder: buy, then exercise

**1. Approve your cash to the RFQ settlement contract.**

```solidity
IERC20(usdc).approve(rfqSettlement, type(uint256).max);
```

Read the RFQ settlement address from the quote response's `approvalTarget`.

**2. Buy.** Request and sign a quote. The option tokens arrive in your wallet after settlement.

**3. Exercise if it's in the money.** Approve the consideration token to the factory once (USDC for a call, WETH for a put), then exercise:

```solidity
IERC20(usdc).approve(address(factory), type(uint256).max);
option.exercise(amount);   // or exercise() for your whole balance
```

Nothing exercises for you. If you do not act before the deadline, the option expires worthless. American options can be exercised any time before the deadline. European options can be exercised only between expiration and the deadline. See [Exercise and redemption](#exercise-and-redemption).

**Selling back instead?** Grant the RFQ settlement contract once on the factory: `factory.setPermissions(rfqSettlement, 7)`.

### Writer: sell, then exit

**1. Approve the factory to spend your collateral.** Use WETH to write calls and USDC to write puts:

```solidity
IERC20(weth).approve(address(factory), type(uint256).max);
```

**2. Permit the RFQ settlement contract on the factory.** One call, one mask:

```solidity
// TRANSFER | MINT | BURN = 7
factory.setPermissions(rfqSettlement, 7);
```

This lets settlement move your option tokens (`TRANSFER`), mint options you haven't pre-minted at the moment of sale (`MINT`), and unwind your short when you buy options back (`BURN`). It can never exercise your options or touch redemptions. See [Permissions and Security](#permissions-and-security) for all six bits.

**3. Sell.** Request a quote through the RFQ. In one transaction, the sale pulls your collateral, mints the option, and pays you. You now hold Receipt tokens representing your short position.

**4. Exit the short.** Two ways out:

- **Buy back.** Options you buy back pair-burn against your Receipts on arrival, returning your collateral immediately.
- **Redeem.** `receipt.redeem()` pays exercised positions from the consideration pool when available, then pays any collateral-backed remainder after the window closes. See [Exercise and redemption](#exercise-and-redemption).

## How it works

### Options as ERC20 tokens

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

### Market creation

`Factory.createOption` is get-or-create. The factory keys a market by its collateral, consideration, expiration, strike, put/call label, American/European flavor, and window length. An identical call returns the existing Option without emitting a second `OptionCreated` event. Use `optionKey(params)` and `optionFor(key)` to look up the canonical market without creating it.

`createOption2` supports mined CREATE2 addresses. Salts are scoped to the caller, and the Option salt must be mined before the Receipt salt because the Receipt address depends on the resulting Option address. See the [Factory API](#factory) for the strict existing-market behavior and address formula.

### Mint and burn

Collateral goes in, an Option + Receipt pair comes out. Burning the pair reverses it:

```solidity
IERC20(collateral).approve(address(factory), type(uint256).max);   // once

option.mint(1e18);   // 1 collateral in → 1 Option + 1 Receipt out
option.burn(1e18);   // 1 Option + 1 Receipt in → 1 collateral back
```

Pair-burning works at any time, including after the exercise deadline. Fee-on-transfer tokens are rejected (`FeeOnTransferNotSupported`); do not use rebasing tokens as collateral.

#### Automatic minting and burning through permissions

Grant the `MINT` and `BURN` [permissions](#permissions-and-security) to your swap contract and minting and burning happen inside the transfer itself; the Setup grant (mask `7`) already includes them.

**Selling without minting.** The writer holds collateral but no options:

```solidity
option.transferFrom(writer, holder, 10e18);
```

The writer's balance is 0, so the factory pulls 10e18 collateral, mints 10e18 Option + Receipt, and the transfer delivers the Options to the holder. The writer ends up short 10 Receipt.

**Unwinding on receipt.** A writer who is short 10 Receipts buys 3 options back:

```solidity
option.transferFrom(holder, writer, 3e18);
```

The incoming 3e18 Option meets the writer's Receipts, 3e18 pairs burn, and 3e18 collateral returns to the writer.

### Permissions and security

The factory keeps one permission bitmask per (owner, operator) pair; a single grant covers every option the factory creates:

```solidity
// Bits from library Perm:
// TRANSFER = 1, MINT = 2, BURN = 4, REDEEM = 8,
// EXERCISE = 16, TRANSFER_RECEIPT = 32
factory.setPermissions(operator, mask);   // overwrite the operator's mask
factory.addPermissions(operator, mask);   // OR new bits into the existing mask
```

Every grant covers every option this factory has created or ever will create; there are no per-market grants. Revoke any grant with `factory.setPermissions(operator, 0)`; every change emits `PermissionsUpdated(owner, operator, mask)`, so grants are monitorable on-chain. Acting on your own position never needs a bit; the bits exist only to authorize *other* addresses.

**`TRANSFER` (1).** Treat this exactly like an ERC20 approval. Grant it only to trusted parties such as swap contracts.

- Gates one thing: `Option.transferFrom` skips the per-option ERC20 allowance when the caller holds this bit in the sender's mask.
- The grantee can move any of your option tokens in any market. That is full custody of your longs: it can move them to itself and exercise them as their own holder, capturing your in-the-money value without ever holding `EXERCISE`.
- It cannot touch your Receipt tokens, your collateral allowance, or anything it hasn't first taken custody of. Moving Receipts without a per-token allowance requires the separate `TRANSFER_RECEIPT` bit.

**`MINT` (2).** Grant this only to trusted parties that will not mint against your collateral allowance without authorization.

- Gates `Option.mint(account, amount)` and the auto-mint leg of transfers (which reads the *sender's* mask).
- The grantee can convert your entire factory collateral allowance into positions, in any market, at any strike: `token.approve(factory, X)` plus a `MINT` grant to A is functionally `token.approve(A, X)`. The minted Option + Receipt land in your account, not theirs, but paired with an ordinary ERC20 allowance on an option token the grantee can transfer more than you hold, auto-mint the deficit, and leave you a naked short.
- On your own address, `MINT` switches on auto-mint for transfers you initiate: an oversize transfer no longer reverts with insufficient balance, it pulls collateral and opens a short for the difference.

**`BURN` (4).** Proceeds return to you, but the grantee controls when the position is unwound.

- Gates `Option.burn(account, amount)` and the auto-burn leg of transfers (which reads the *receiver's* mask for the transfer initiator). It does not authorize `Option.expire`; only the holder can expire their own longs.
- The grantee can pair-burn your matched Option + Receipt (collateral returns to **you**, never to them) and net options it delivers into you against your short.
- The risk is timing, not theft: the grantee chooses the moment your hedge unwinds.

**`REDEEM` (8).** The grantee controls the timing, but the payout always goes to you.

- Gates `Receipt.redeemFor(holders)`; entries without the grant are skipped.
- The grantee can trigger redemption of your Receipts; the payout always lands in your wallet. It chooses the timing, and therefore whether you settle into consideration or collateral.

**`EXERCISE` (16).** Grant this only to parties that will exercise in good faith.

- Gates `Option.exerciseFor` (single and batch).
- The grantee burns your options, pays the strike itself, and **receives the collateral**; you get nothing on-chain. Nothing in the contract forces it to pass your surplus back; that settlement happens off-chain or not at all.
- Use it for exactly one thing: a keeper that exercises in-the-money options you would otherwise let lapse, and provably returns your share.

**`TRANSFER_RECEIPT` (32).** Treat this exactly like custody of your short positions.

- Gates `Receipt.transferFrom`, skipping the per-Receipt ERC20 allowance when the caller holds this bit in the sender's mask.
- The grantee can move any of your Receipts to itself and redeem them as the holder, capturing both collateral and consideration payouts without holding `REDEEM`.
- It does not grant custody of your Option tokens; that requires `TRANSFER`.

<img src="/img/permissions.svg" alt="RFQ settlement permissions" />

Treat protocol permissions with the same care as token approvals. Grant permissions only to verified contracts you trust. A permissionless market created with a malicious token cannot move your assets unless you interact with that market or authorize an operator to mint through your factory allowance. For RFQ settlement, verify the settlement address before granting `TRANSFER | MINT | BURN`. Review any other operator independently before granting it access.

#### What the protocol cannot do

- **Nothing is upgradeable or pausable.** No proxies anywhere: the Factory deploys the Option and Receipt templates in its own constructor, and there is no setter to swap them. Per-option instances are minimal clones of those templates.
- **An option's economic terms cannot change.** Strike, tokens, expiration, deadline, and flavor are baked into the Receipt clone's bytecode at creation. The redemption fee is separate and mutable.
- **The owner cannot withdraw holder backing.** The owner can set the default redemption fee for new markets, update a live Receipt's fee up to 1,000 basis points, collect accrued fees, and sweep residual tokens only after `totalSupply() == 0`. The owner cannot alter user permissions, block creation, pause the contracts, or spend anyone's allowance. Factory ownership cannot be renounced.
- **No oracle.** There is no price feed, no `settle()`, and no on-chain price comparison anywhere in the contracts; settlement is purely time-gated.

#### Your risk with zero grants

If all you ever do is `token.approve(factory, X)`, no third party can move anything of yours. Only Receipt contracts registered by the factory can pull that allowance, and only through calls you make yourself: `Option.mint(account, amount)` reverts without the `MINT` grant, `exerciseFor` reverts without `EXERCISE`, `redeemFor` skips holders who never granted `REDEEM`, and your Option and Receipt tokens move only with ordinary ERC20 allowances.

#### Grants that can put funds at risk

- **`EXERCISE` to the wrong party.** The grantee can exercise your in-the-money options at any time: they pay the strike, they receive the collateral, and you get nothing on-chain. Grant it only to a keeper that provably settles your share back to you.
- **`MINT` to the wrong party.** `token.approve(factory, X)` plus a `MINT` grant equals `token.approve(grantee, X)`: the grantee can open shorts against your entire factory allowance, in any market, at any strike. Combined with an ordinary ERC20 allowance on the option token, they can also transfer more options than you hold and leave you with a naked short.
- **`TRANSFER` to the wrong party.** Full custody of your long positions: the grantee can move your options to itself and exercise them as its own. This is not weaker than `EXERCISE`; it reaches the same value in two steps.
- **`TRANSFER_RECEIPT` to the wrong party.** Full custody of your short positions: the grantee can move your Receipts to itself and redeem the settlement claim as its own.
- **Mask `7` to an address that isn't really the settlement contract.** The grant is only as safe as the address. Verify you are granting to the RFQ settlement contract, exactly as you would verify a router before an unlimited approve.

#### Actions that do not create access

- **A stranger creates an option market on your token, or on a scam token.** Creation is permissionless, but a market existing touches nothing of yours. Your allowance only moves inside a mint or exercise that you, or a `MINT` grantee of yours, initiated.
- **Someone airdrops you Option or Receipt tokens.** They sit inert. Receiving tokens never pulls your funds and never burns anything unless you granted `BURN` to the party that initiated the transfer; even then, the burn returns collateral to you, not to them.
- **A keeper batch-calls `redeemFor` with your address in the list.** If you never granted `REDEEM`, you are skipped. If you did, the payout still lands in your wallet; the keeper cannot redirect a single token.
- **The factory holds an unlimited allowance from you.** Only Receipt contracts the factory itself deployed can pull it, and only inside your own (or your grantee's) calls. The factory owner has no path to it.
- **A site shows you an unfamiliar option token.** Verify it on-chain: `factory.receipts(option.receipt()) && Receipt(option.receipt()).option() == option`. True means the factory deployed the pair and its terms are fixed in bytecode.
- **Another holder exercises and takes collateral out of the pool.** Exercise pays the strike in at the same rate, so every Receipt stays backed 1:1 by collateral plus consideration; a writer is always owed full value at redemption.

#### Audit

These counts include protocol findings only.

| Report | Extreme | High | Medium | Low | Informational | Gas |
|---|---:|---:|---:|---:|---:|---:|
| [Cyfrin (PDF)](/audits/cyfrin-audit-report.pdf) | 0 | 0 | 1 | 4 | 9 | 3 |
| [Quantstamp (PDF)](/audits/quantstamp-final-report.pdf) | 0 | 0 | 0 | 6 | 4 | 0 |

### Exercise and redemption

**Exercise.** The holder pays `strike` in consideration and receives the collateral:

```solidity
IERC20(consideration).approve(address(factory), type(uint256).max);   // once
option.exercise(1e18);   // burn 1 Option, pay 1 × strike, receive 1 collateral
```

**Redemption.** This is the writer's exit. Exercised options leave consideration in the pool, while unexercised options leave collateral. `receipt.redeem()` burns the writer's Receipts and pays from that pool, first in consideration (strike × amount) and then in collateral at a 1:1 ratio:

```solidity
receipt.redeem();   // or redeem(amount)
```

Redemption is first-come-first-served, not pro rata. Each Receipt stores its own mutable `feeBps`, initialized from the factory default when the market is created. The factory owner can change it without a timelock, up to 1,000 basis points. The fee applies to each nonzero redemption payout and rounds up to a whole raw token unit. Anyone may call `collectFees(token)`, but accrued fees always go to the current factory owner. Exercise and pair-burning remain fee-free.

#### European

Exercise only during the exercise window, from expiration to the deadline. Redeem consideration as exercises happen; redeem collateral after the window closes.

#### American

Exercise any time from creation through the deadline, including the post-expiration exercise window. Redeem consideration after exercises; the collateral leg opens strictly after the exercise deadline.

American minting and consideration redemption can overlap before expiry. After an early exercise, a newly minted Receipt can redeem from the consideration pool before a standing writer because settlement is first-come-first-served. There is no on-chain pro-rata allocation. European markets do not have this pre-expiry overlap.

Nothing exercises for you; an option never exercised lapses worthless (`option.expire(holder, amount)` cleans up the dead tokens). A keeper granted `EXERCISE` can exercise on your behalf; a keeper granted `REDEEM` can trigger redemption, with payout always to you.

### Calls and puts

The contract represents a put as a call with the token pair reversed. A WETH call locks WETH and receives USDC when exercised. A WETH put locks USDC and receives WETH. The same settlement math handles both trades.

The contract always stores the strike as **consideration per unit of collateral**. This matches the familiar quote for a call: a $3,000 WETH call uses 3,000 USDC per WETH. For a put, USDC is the collateral and WETH is the consideration, so the stored ratio must be inverted to 1/3,000 WETH per USDC.

| | Collateral | Consideration | Strike (18 decimals) |
|---|---|---|---|
| **WETH call @ $3,000** | WETH | USDC | `3000e18` (USDC per WETH) |
| **WETH put @ $3,000** | USDC | WETH | `1e36 / 3000e18` (WETH per USDC) |

One put token represents one unit of its USDC collateral. Exercising 3,000 put tokens therefore reconstructs the familiar $3,000 put trade:

```
3,000 WETH put tokens
          +
        1 WETH  ────── exercise ──────▶  3,000 USDC
                   strike: 1/3,000 WETH per USDC
```

The user-facing strike remains $3,000 per WETH. Only the contract's stored ratio is inverted because the collateral and consideration tokens switch places.

## Deployed addresses

The active Ethereum and BNB Smart Chain deployments use the same frozen contract source and Factory address. This is the contract you approve and grant permissions on. Older factories remain on-chain but are not active targets.

| Network            | Chain ID | Factory | Deployment block |
|--------------------|---------:|---------|-----------------:|
| Ethereum (Mainnet) | 1        | `0x9999999999995aa18A8944e311ce792a9b90A8b1` | 25,911,928 |
| BNB Smart Chain    | 56       | `0x9999999999995aa18A8944e311ce792a9b90A8b1` | 120,154,298 |

Every option ever created is discoverable on-chain through the factory's `OptionCreated` event; see the [API Reference](#api-reference).

{/* API:BEGIN; generated by scripts/gen-reference.mjs, do not edit by hand */}

## API Reference

Auto-generated from the NatSpec in `foundry/contracts/`. Each contract is collapsible; reads
are listed before state-changing functions, with events and errors in their own collapsible.
Run `npm run gen-reference` from the docs checkout after generating the Forge docs to refresh.

### Option

The long side. Mint, transfer, exercise, and pair-burn.

<details>
<summary>Functions</summary>

##### receipt

```solidity
IReceipt public receipt
```

Paired short-side `IReceipt` contract that holds the collateral and handles
settlement math. The pairing is permanent; set once by `init`, no setter, no
upgrade path.

Doubles as the [init](#option) guard; non-zero means initialised.

---

##### factory()

```solidity
function factory() public view returns (IFactory);
```

- Returns `IFactory`

The `IFactory` that created this option.

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

Unix expiration timestamp.

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

Strike price (18-decimal fixed point, consideration per collateral; inverted for puts).

For puts, this stores the *inverse* of the human-readable strike (see [name](#option) for display).

---

##### isPut()

```solidity
function isPut() public view returns (bool);
```

- Returns `bool`

`true` if this is a put. A label only: it inverts the strike for display in `name`
and is part of the factory registry key, and nothing else; every settlement path
converts at `strike` exactly as stored and never reads this flag. Whether a market is
"really" a put is the creator's off-chain convention (tokens swapped, `strike =
1e36 / humanStrike`), unchecked on-chain; see `CreateParams.isPut` in `IFactory`.

---

##### isEuro()

```solidity
function isEuro() public view returns (bool);
```

- Returns `bool`

`true` if European-style (exercise only allowed in the post-expiry window). `false`
for American, which is exercisable at any time up to and including `exerciseDeadline`.

---

##### decimals()

```solidity
function decimals() public view override(ERC20, IOption) returns (uint8);
```

- Returns `uint8`

ERC20 decimals; matches `collateral.decimals()`, so 1 option token ↔ 1 collateral unit.

Read live from the collateral token on every call, not from the Receipt's cached
`decimals` immutable arg. The two agree for any supported (non-rebasing, standard)
ERC-20.

---

##### name()

```solidity
function name() public view override(ERC20, IOption) returns (string memory);
```

- Returns `string memory`

ERC20 name in the form `OPT[E/A]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`. The `OPTE-`
prefix flags European options, `OPTA-` American, and the date is the UTC day of
`expirationDate`, not of `exerciseDeadline`. For puts the displayed strike is the
human-readable form (`1e36 / strike`), not the stored inverse. If either token
implements ERC-8056/BEP-677 scaled UI amounts, the displayed strike uses its current
UI multiplier; tokens without that interface use 1x. The name carries no put/call
marker, so read `isPut` / `details`, never the name, to distinguish the markets.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form,
guarded on `strike() > 0` so a zero strike renders as `0` rather than dividing by zero.

---

##### symbol()

```solidity
function symbol() public view override(ERC20, IOption) returns (string memory);
```

- Returns `string memory`

ERC20 symbol; same as `name`. Matching name/symbol keeps wallets and explorers in sync.

---

##### balancesOf(address account)

```solidity
function balancesOf(address account) public view returns (Balances memory);
```

- `account` `address`: Address to query.
- Returns `Balances`: A `Balances` struct of raw `balanceOf` reads, each in its own token's decimals.

All four balances that matter for this option in one call: collateral token,
consideration token, long option, short receipt.

---

##### details()

```solidity
function details() public view returns (OptionInfo memory);
```

- Returns `OptionInfo`: An `OptionInfo` struct. The economic fields are sourced from the paired `IReceipt` (the token metadata is read live from the two token contracts), so the `strike` returned is the raw 18-decimal value, still inverted for puts.

Full option descriptor; addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.

---

##### mint(uint256 amount)

```solidity
function mint(uint256 amount) public nonReentrant;
```

- `amount` `uint256`: Collateral-denominated mint amount; this token shares the collateral's decimals.

Mint `amount` option tokens to the caller, collateralised 1:1 with the underlying.
The caller receives the matching `IReceipt` too; minting always opens both legs; and pays the collateral out of their ERC-20 allowance to the factory. Reverts
`ContractExpired` at or after `expirationDate` and `ZeroValue` on a zero `amount`;
the collateral pull reverts with the token's own allowance/balance error or
`IFactory.FeeOnTransferNotSupported`. Emits `Mint`.

---

##### mint(address account, uint256 amount)

```solidity
function mint(address account, uint256 amount) public nonReentrant;
```

- `account` `address`: Recipient of both Option and Receipt tokens. Pays the collateral.
- `amount` `uint256`: Collateral-denominated mint amount.

Mint `amount` options on behalf of `account`: `account` pays the collateral and receives
both the Option and the Receipt; the caller receives nothing. Caller must be `account`
or hold `Perm.MINT` in `account`'s factory permission mask, else `Unauthorized`;
without that gate any address holding a non-zero factory allowance could be
force-minted into unwanted positions. The authorisation check runs before the `ContractExpired` /
`ZeroValue` gates of `mint(uint256)`, which apply here too. Emits `Mint`.

`Perm.MINT` is an explicit, single-purpose grant: it lets the operator pull the
holder's factory collateral allowance into new positions (functionally a permit on
collateral). It is NOT implied by `Perm.TRANSFER` or any other bit.

---

##### transfer(address to, uint256 amount)

```solidity
function transfer(address to, uint256 amount) public override(ERC20, IOption) nonReentrant returns (bool);
```

- `to` `address`: Receiver, and the account whose Receipt balance auto-burn may net against.
- `amount` `uint256`: Options to move (collateral decimals); may exceed the caller's balance only under the caller's own MINT self entry.
- Returns `bool`: Always `true`; every failure reverts.

ERC20 transfer override; runs the auto-mint / auto-burn hooks, so this is NOT a plain
ERC-20 transfer: it may mint against the caller's collateral or net options out at the
receiver. Not gated on the clock; the long token circulates forever, including past
`exerciseDeadline`, so holders can always sell to keepers or to shorts unwinding via
pair `burn`. Auto-mint fires on `Perm.MINT` in `permissions(from, msg.sender)`;
auto-burn on `Perm.BURN` in `permissions(to, msg.sender)`; the receiver's grant to
the initiator, NOT the sender's row. The two are not symmetric. An `amount` above
`from`'s balance reverts `ERC20InsufficientBalance` without the MINT bit; with it, the
shortfall is minted (`Mint`), or the call reverts `ContractExpired` from
`expirationDate` onwards. An auto-burn emits `PairBurned` from this Option; the paired
Receipt emits nothing.
⚠ **Balance deltas are not `amount`.** When auto-burn fires, `to`'s option balance
rises by `amount - min(receipt.balanceOf(to), amount)` and `to` receives the
difference in collateral instead; and `receipt.balanceOf(to)` is a plain ERC-20
balance any third party can inflate by sending Receipt tokens to `to`, so the netted
size is not under the receiver's control. When auto-mint fires, `from` is charged
collateral for the shortfall and left holding Receipts. Integrators (vaults, routers,
AMMs) that hold a `BURN` grant to any initiator must read balances back after an
inbound transfer rather than assume `balanceAfter - balanceBefore == amount`. See
`IReceipt.redeemFor` for the full reasoning.

Always returns `true` or reverts. Not gated on the clock; the long token circulates
forever, including past `exerciseDeadline`, so holders can always sell to keepers or
to shorts unwinding via pair burn. See [_settledTransfer](#option) for the two hook legs.

---

##### transferFrom(address from, address to, uint256 amount)

```solidity
function transferFrom(address from, address to, uint256 amount) public override(ERC20, IOption) nonReentrant returns (bool);
```

- `from` `address`: Token owner, and the account charged for any auto-minted shortfall.
- `to` `address`: Receiver, and the account whose Receipt balance auto-burn may net against.
- `amount` `uint256`: Options to move (collateral decimals).
- Returns `bool`: Always `true`; every failure reverts.

ERC20 transferFrom override; same hooks (and the same balance-delta caveat) as
`transfer`, likewise open forever. The ERC20 allowance is skipped entirely when
`msg.sender` is `from` itself (unlike vanilla OZ ERC20, which would spend a
self-approval) or holds `Perm.TRANSFER` in `from`'s factory permission mask (a
blanket approval across every option this factory has created or will create);
otherwise it is spent as usual.

Skips `_spendAllowance` when [notAuthorized](#option) says it may; i.e. when `msg.sender` is
`from` itself, or holds `Perm.TRANSFER` in `from`'s factory permission mask. Otherwise the
ordinary per-option ERC-20 allowance is spent. Then runs the same
[_settledTransfer](#option) hook as [transfer](#option), and is likewise open forever.
Note the asymmetry with the hook: `Perm.TRANSFER` decides who may move the tokens,
while the hook's two legs key on `Perm.MINT` in `from`'s row and `Perm.BURN` in `to`'s
row. Holding TRANSFER alone reaches neither leg.

---

##### exercise()

```solidity
function exercise() public;
```

Exercise the caller's full Option balance: pay consideration, receive collateral; safe self-exercise (the caller pays AND receives). Reverts `ZeroValue` when the caller
holds nothing and the window is open; the window checks (`InvalidExercise`,
`ExerciseWindowClosed`) run first and take precedence. The balance is read at call
time, so this exercises everything held including unsolicited transfers. For a
deadline-sensitive exercise, use `exercise(uint256)` with a fixed amount so an added
balance cannot increase the required consideration and revert the call.

Delegates to `exerciseFor(address,uint256)` with `holder = msg.sender`, so msg.sender
pays AND msg.sender receives (no dangerous asymmetry).

---

##### exercise(uint256 amount)

```solidity
function exercise(uint256 amount) public;
```

- `amount` `uint256`: Collateral units to receive. Consideration paid is `IReceipt.toConsideration(amount, true)` (strike rate, rounded up), pulled from the caller's ERC-20 allowance to the factory.

Exercise `amount` of the caller's Options; safe self-exercise (the caller pays AND
receives). Same gates and reverts as `exerciseFor(address,uint256)` with
`holder = msg.sender`. Emits `Exercise`.

Delegates to `exerciseFor(address,uint256)` with `holder = msg.sender`, so msg.sender
pays AND msg.sender receives (no dangerous asymmetry).

---

##### exerciseFor(address holder, uint256 amount)

```solidity
function exerciseFor(address holder, uint256 amount) public canExercise nonReentrant nonZero(amount) returns (uint256);
```

- `holder` `address`: Option holder whose tokens will be burned. Receives nothing on-chain.
- `amount` `uint256`: Collateral units to exercise. Consideration collected from the caller is `IReceipt.toConsideration(amount, true)` (strike rate, rounded up); the caller receives the `amount` of collateral.
- Returns `uint256`: Collateral units exercised. Always exactly `amount`; the call reverts rather than partially filling, so the value is informational for on-chain callers.

**Dangerous keeper path.** Burn `amount` of `holder`'s Options; the caller pays the
consideration AND receives the collateral. The holder gets nothing on-chain. Use this
only when (a) the caller is a contract that will deliver the holder's economic surplus
off-band (e.g. a flash-loan router that sells the collateral, repays the flash loan
with the consideration cost, and pays the holder the spread), or (b) the holder
explicitly intends to gift the exercise value to the caller.
Authorisation: the caller must be `holder` themselves or hold `Perm.EXERCISE` in the
holder's factory permission mask. **Granting EXERCISE to a non-trusted operator is
equivalent to giving them a withdrawal right over your ITM value.** `Perm.TRANSFER`
does not gate this function, but it is not a weaker grant: an operator holding
TRANSFER can move your longs to itself and exercise them as their own holder,
reaching the same ITM value by a different route. Both bits are custody-grade; grant either only to a deployed, audited contract whose code you have read, never to
an EOA and never to an upgradeable proxy you do not control.
Allowed any time exercise itself is allowed (pre-expiry for American, plus the
post-expiry window through `exerciseDeadline` for both flavours). Reverts `ZeroValue`
on a zero `amount`, `Unauthorized` without the grant, and `ERC20InsufficientBalance`
if `holder` does not hold `amount`; this path never partially fills. The
consideration pull reverts with the consideration token's own allowance/balance
error or `IFactory.FeeOnTransferNotSupported`. Emits `Exercise`.

**NOT PRODUCTION READY:** This pseudocode omits required checks and must not be
deployed as written. Example of `IOption`'s legitimate-use case (a): a flash-loan
keeper that pays the holder the ITM spread. Illustrative: imports, the `lender` /
`dex` addresses and the
`SlippageExceeded` declaration are elided, and a real keeper must also check
`msg.sender == lender` in `onFlashLoan`.

Step 6 is the whole guarantee, and nothing in this contract enforces it. A keeper
that simply omits it keeps the entire ITM value and the holder has no on-chain
recourse; a revert there would at least undo the exercise. That is why
`Perm.EXERCISE` must only ever be granted to a deployed, audited contract whose code
you have read, never to an EOA and never to an upgradeable proxy you do not control.

---

##### exerciseFor(address[] calldata holders, uint256[] calldata amounts)

```solidity
function exerciseFor(address[] calldata holders, uint256[] calldata amounts) external canExercise nonReentrant;
```

- `holders` `address[]`: Option holders whose options will be exercised.
- `amounts` `uint256[]`: Per-holder collateral amounts to exercise; must align 1:1 with `holders` (unequal lengths revert `InvalidValue`).

Batch variant of `exerciseFor(address,uint256)`. Same dangerous semantics; the caller
pays consideration and receives collateral for every holder. Exercises `amounts[i]` of
`holders[i]` and emits one `Exercise` per processed entry.
Three classes of entry are skipped rather than reverting, so one stale row cannot
grief the sweep for everyone else: a zero `amounts[i]`, an `amounts[i]` greater than
`balanceOf(holders[i])` (a holder who has since sold), and a holder who has not
granted the caller `Perm.EXERCISE`. A batch in which every entry is skipped; an
empty array included; succeeds as a no-op. Skipping is the ONLY containment:
`InvalidValue` on a length mismatch, the window checks, and anything that makes the
Receipt-side exercise revert; notably the caller's own consideration balance or
factory allowance running out partway down the list; abort the whole batch and roll
back the holders already processed.

A repeated `holders[i]` is exercised once per occurrence, subject to the balance
check against the balance remaining after the earlier ones. Unlike
`exerciseFor(address,uint256)` this returns nothing, so on-chain callers cannot tell
which entries were skipped; read the balances back or watch the events.

---

##### burn(uint256 amount)

```solidity
function burn(uint256 amount) public;
```

- `amount` `uint256`: Collateral-denominated amount to burn from each side.

Pair-burn matched Option + Receipt to recover collateral. Shorthand for
`burn(msg.sender, amount)`. Available at any time; pair-burn nets both sides 1:1 so
it needs neither the exercise window nor the clock: it stays open past
`expirationDate` and past `exerciseDeadline`, alongside `IReceipt.redeem` /
`IReceipt.redeemFor` as a post-window short-side exit. The caller must hold at least
`amount` of BOTH sides; `amount` of each is burned and `amount` of collateral is
returned, with no fee. Reverts `ZeroValue` on a zero `amount` and
`ERC20InsufficientBalance` (raised on the Option first, then the Receipt) when
either side is short. Emits `PairBurned` from this Option; the paired Receipt emits
nothing.

Shorthand for `burn(msg.sender, amount)`. The caller must hold at least `amount` of
BOTH sides; the long burn happens first, so a caller holding only the short side
reverts `ERC20InsufficientBalance` on the option token.

---

##### burn(address account, uint256 amount)

```solidity
function burn(address account, uint256 amount) public nonReentrant nonZero(amount);
```

- `account` `address`: Holder of the matched Option + Receipt pair, and recipient of the collateral.
- `amount` `uint256`: Collateral-denominated amount to burn from each side.

Pair-burn `amount` of `account`'s matched Option + Receipt; collateral returns to
`account`. No timing gate; valid at any timestamp, before and after expiry. Caller
must be `account` or hold `Perm.BURN` in `account`'s factory permission mask, else
`Unauthorized`. Trigger-only grant; the recovered collateral always goes to
`account`, never to the caller, so a BURN operator can unwind a holder's matched
position but not extract value from it (it can still choose the *moment*). The
`ZeroValue` check runs before the authorisation check; balance and event behaviour
are as in `burn(uint256)`.

The real implementation; `burn(uint256)` is a wrapper. No timing gate; valid at any
timestamp, before and after expiry. Note that the auto-burn leg of
[_settledTransfer](#option) gives a BURN grantee a reach this function does not have,
because there the operator supplies the longs. See `Perm`.

---

##### expire(address holder, uint256 amount)

```solidity
function expire(address holder, uint256 amount) public nonReentrant nonZero(amount);
```

- `holder` `address`: Address of the long option holder. Must be `msg.sender`.
- `amount` `uint256`: Amount of long option tokens to burn. Above the holder's balance reverts `ERC20InsufficientBalance`.

Burn the caller's own expired long tokens (post-`exerciseDeadline` cleanup). Only
callable strictly after `exerciseDeadline`. Post-deadline a long can no longer be
exercised, but it still transfers and still pair-burns against a matching Receipt; it is NOT worthless, which is why this is **self-service only**: `msg.sender` must be
`holder`, and no permission bit reaches here (an operator destroying a long would
strip the holder's collateral claim instead of returning it via
`burn(address,uint256)`). Long side only; leaves the Receipt and collateral pool
untouched. Reverts `ZeroValue` on a zero `amount`, `Unauthorized` for any caller
other than `holder`, and `NotYetExpired` on or before the deadline, checked in that
order, so the authorisation check runs BEFORE the timestamp check. Emits `Expire`.

This is the one mutator that is barred *while* the option is live rather than after.
Post-deadline a long still transfers and still pair-burns against a matching
`Receipt`; it is NOT worthless, which is why this is **self-service only**: a
`Perm.BURN` grantee choosing this over `burn(address,uint256)` would destroy the
holder's collateral claim instead of returning it, so the bit deliberately does not
reach here. It touches neither collateral nor the paired `Receipt`, so it has no
effect on the redemption pool or the solvency invariant (short-side collateral is
recovered separately via `IReceipt.redeem`).

</details>

### Receipt

The short side. Holds settlement pools and redeems short positions.

<details>
<summary>Functions</summary>

##### factory

```solidity
IFactory public immutable factory
```

The `IFactory` that created this pair, used to pull tokens against their ERC-20
allowance to it. Its `IFactory.owner` is the `sweep` authority.

Set in the template constructor (= the factory that deployed it) and inherited by
every clone via the template's runtime bytecode.

---

##### STRIKEDEC

```solidity
uint8 public constant STRIKEDEC = 18
```

Decimal basis of the strike (always 18).

---

##### consBacked

```solidity
uint256 public consBacked
```

Receipt-units the consideration pool can still back at strike rate. Incremented on
`exercise` (cons inflow) and decremented by the cons leg of redemption (cons payout);
the collateral leg of `redeem` leaves it untouched. Equal to (total exercised − total
cons-redeemed), and never underflows; the cons leg caps its payout at this value.
Denominated in receipt/collateral units (the cons equivalent is `toConsideration`).

---

##### feeBps

```solidity
uint64 public feeBps
```

This market's redeem fee in basis points. Initialized from `Factory.feeBps()` at
creation and mutable by the Factory owner. Applied to both legs of `redeem`; never to
exercise or pair burn. Each non-zero fee rounds up to a whole raw token unit, so
splitting a redemption into dust amounts cannot avoid the fee.

---

##### feeAccrued

```solidity
mapping(address token => uint256 amount) public feeAccrued
```

Keyed by token address; only `collateral` and `consideration` are ever populated (the
two legs of redeem). The fee is NOT transferred on each redeem; it accrues here (a
cheap SSTORE instead of a per-redeem ERC20 transfer) and is paid out in one shot via
[collectFees](#receipt). Always pure surplus above the backing the remaining receipts require, so
collecting can never short the redemption pool. The tallied amount (floor included) is
physically held here, so it is the fee term of the solvency identity
`collateral.balanceOf(this) == totalSupply() - consBacked + feeAccrued[collateral]`
(plus any donation); only [sweep](#receipt), at zero supply, drains it, capping the tally at the
1-wei floor.
Gas: [collectFees](#receipt) leaves 1 wei behind rather than zeroing, so once the first accrual
has paid the one-time zero→non-zero SSTORE (~22k), the slot stays non-zero for the
option's life and every later accrual is a ~5k non-zero→non-zero write; even right
after a collect. Real pending fee for a token is therefore `feeAccrued[token] - 1`
once the floor is set (the stranded 1 wei is recovered by [sweep](#receipt) at end of life).

---

##### strike()

```solidity
function strike() public pure returns (uint256);
```

- Returns `uint256`

Strike price (18-decimal fixed point, consideration per collateral; inverted for puts).

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

Paired Option contract; the only address authorised to call `mint`/`burn`/`exercise`.

---

##### expirationDate()

```solidity
function expirationDate() public pure returns (uint40);
```

- Returns `uint40`

Unix timestamp at which the option expires and the post-expiry exercise window opens
(uint40). Minting stops strictly before this instant, and for a European option both
exercise and the consideration leg of `redeem` open at it.

---

##### exerciseDeadline()

```solidity
function exerciseDeadline() public pure returns (uint64);
```

- Returns `uint64`

Unix timestamp at which the post-expiry exercise window closes (uint64: the
expiration + window sum can exceed uint40).

Returned as `uint64`: the stored value is `expirationDate + windowSeconds`,
and that sum can exceed `type(uint40).max` even though each operand is uint40,
so reading the full 64-bit slot avoids silently truncating the deadline.

---

##### isPut()

```solidity
function isPut() public pure returns (bool);
```

- Returns `bool`

`true` if this is a put. A label only: it drives the strike inversion in `name` and
is part of the registry key, and nothing else; settlement (`toConsideration`,
`exercise`, `redeem`) uses `strike` as stored and never reads this flag. See
`IOption.isPut`.

---

##### isEuro()

```solidity
function isEuro() public pure returns (bool);
```

- Returns `bool`

`true` if European-style (exercise only allowed in the post-expiry window).

---

##### decimals()

```solidity
function decimals() public pure override(ERC20, IReceipt) returns (uint8);
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
- `round` `bool`: `true` rounds up, `false` floors.
- Returns `uint256`: Consideration units, in the consideration token's own decimals.

Strike-rate conversion of a collateral-denominated (equivalently receipt-denominated)
amount into the consideration due for it. `round=true` rounds UP (used when collecting
consideration on exercise); `round=false` floors (used for payouts); that pairing
(ceil in, floor out) is what keeps the consideration pool able to fund every
redemption it is asked for.

Evaluates `amount * strike * numer / (1e18 * denom)` as one `mulDiv`, so only
`strike * numer` can overflow; and `Factory` rejects at creation any strike that would.

---

##### toCollateral(uint256 consAmount)

```solidity
function toCollateral(uint256 consAmount) public pure returns (uint256);
```

- `consAmount` `uint256`
- Returns `uint256`

Inverse of `toConsideration`; how much collateral a given consideration amount is worth
(floor by design). Not used internally; exposed for off-chain indexers and
invariant tests.

Floors by design. Not used on any settlement path: [_redeem](#receipt) tracks cons-backed
receipt units in `consBacked` rather than converting consideration back. Same
`strike * numer` product as [toConsideration](#receipt), so the creation-time bound covers it.

---

##### name()

```solidity
function name() public view override(ERC20, IReceipt) returns (string memory);
```

- Returns `string memory`

ERC20 name in the form `RCT[E]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`. The `RCTE-`
prefix flags European options, `RCT-` American; note this differs from
`IOption.name`, which spells its flavours `OPTE-` / `OPTA-`. For puts the displayed
strike is the human-readable form (`1e36 / strike`), not the stored inverse. If either
token implements ERC-8056/BEP-677 scaled UI amounts, the displayed strike uses its
current UI multiplier; tokens without that interface use 1x. The name carries no
put/call marker, so read `isPut` (or `IOption.details`), never the name, to distinguish
the markets.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form.
`strike` is non-zero for every option `Factory` can create, so the division is safe.

---

##### symbol()

```solidity
function symbol() public view override(ERC20, IReceipt) returns (string memory);
```

- Returns `string memory`

ERC20 symbol; same as `name`. Matching name/symbol keeps wallets and explorers in sync.

---

##### setFee(uint64 feeBps_)

```solidity
function setFee(uint64 feeBps_) external;
```

- `feeBps_` `uint64`

Set this market's redeem fee. Callable by the creating Factory during deployment or
by the current Factory owner afterward. Reverts `InvalidFee` above 1000 bps (10%).
No timelock is applied.

---

##### transferFrom(address from, address to, uint256 amount)

```solidity
function transferFrom(address from, address to, uint256 amount) public override(ERC20, IReceipt) returns (bool);
```

- `from` `address`
- `to` `address`
- `amount` `uint256`
- Returns `bool`

ERC20 transferFrom override. The per-option ERC-20 allowance is skipped entirely when
`msg.sender` is `from` itself or holds `Perm.TRANSFER_RECEIPT` in `from`'s factory
permission mask; a blanket approval over the owner's receipts across every option
this factory has created or will create; otherwise the allowance is spent as usual.
The short-side mirror of `IOption.transferFrom`'s `Perm.TRANSFER` skip, minus the
hooks: no auto-mint / auto-burn leg and no deadline gate; a plain balance move, open
forever. Moving receipts moves the settlement claim itself (`redeem` pays the
*holder*), which is why the bit is custody-grade; see `Perm`.

Skips `_spendAllowance` when [notAuthorized](#receipt) says it may; i.e. when `msg.sender` is
`from` itself, or holds `Perm.TRANSFER_RECEIPT` in `from`'s factory permission mask (a
blanket approval over the owner's receipts across every option this factory has created
or will create). Otherwise the ordinary per-option ERC-20 allowance is spent. This is
the short-side mirror of `Option.transferFrom`'s `Perm.TRANSFER` skip, minus the hooks:
there is no auto-mint / auto-burn leg here and no deadline gate; a plain balance move,
open forever. Note that moving receipts moves the settlement claim itself (redeem pays
the *holder*), which is why the bit is custody-grade; see `Perm`.

---

##### redeem()

```solidity
function redeem() public nonReentrant;
```

Redeem the caller's full Receipt balance. Cons-first, FCFS: pays up to `consBacked`
receipt-units from the consideration pool at strike rate, callable any time the pool
can cover them (European: reverts `BeforeExerciseWindow` before `expirationDate`).
Any uncovered remainder is paid 1:1 in collateral **only after** `exerciseDeadline`;
pre-window, uncovered receipts stay in the caller's balance for later redemption.
With nothing cons-backed and the collateral leg still shut, the call reverts
`ExerciseWindowOpen`; pre-window redemption of an unexercised option is not possible.
The cons leg mirrors the equity-options "buy to close at strike" convention: the
writer sources consideration from previously-exercised counterparties sitting in the
pool. FCFS by design; a short who redeems early captures the cons premium earlier
exercisers paid in, leaving later post-window redeemers with collateral. That
asymmetry is intentional: it lets shorts lock in the strike-rate exchange the moment
the pool can fund it, rather than waiting for the window to close.
###### Dust: a floored consideration payout still burns the receipts
The consideration leg pays `floor(amount * strike)`. When that floors to ZERO; the
receipts being redeemed are worth less than one consideration atom; they are burned
and `consBacked` is still decremented, while NOTHING is transferred. And it is
forced: the legs are not selectable, so while `consBacked > 0` a redeemer cannot skip
the consideration leg to reach the collateral one. Redeeming a dust balance therefore
destroys it for no payout. The loss is bounded; what is destroyed is worth strictly
less than one consideration atom at the strike price; but it is real, and a caller
who splits a balance into dust-sized calls repeats it once per call. Redeem in
amounts that convert to at least one atom.
###### American options: the consideration pool can be taken by a fresh mint (read this if you write American)
The queue is keyed on a current receipt balance and nothing else; receipts carry no
mint timestamp and no assignment tag. For an American option the mint window
(`block.timestamp < expirationDate`), exercise and this consideration leg all
overlap. So after ANY pre-expiry exercise, while `consBacked > 0`, anyone can do
`Option.mint(N)` then `redeem(N)` in one transaction: deposit `N` collateral, take
`min(N, consBacked)` receipt-units of consideration at strike rate (net of `feeBps`),
and keep `N` freshly minted longs for no premium. Run as a same-block back-run of the
exercise it is atomic, and **proactive redemption by the assigned writer cannot beat
it**; the writer's own redeem lands in the same race, one transaction later. The
back-runner is weakly profitable at any spot (it has swapped collateral for
consideration at strike and holds free longs against the writer's collateral), so
every pre-expiry exercise on an American market is an opportunity of this shape
regardless of where spot goes afterwards. What the writer loses is the assignment
windfall of that exercise: their receipts back collateral again and are re-exposed to
the back-runner's longs, so their worst case is the short payoff they originally sold,
not principal. European options are structurally immune: minting stops at
`expirationDate` and neither exercise nor this leg opens before it, so the two windows
never overlap.
This is the cons-first FCFS design, documented rather than fixed, and it is the
residual risk of writing American on this protocol. There is no on-chain mitigation.
Writers who want a guaranteed exit should hold (or buy back) the matching longs and
pair-burn (`IOption.burn`), which is never queued; writers who manage a position
should monitor `consBacked` and `IOption.Exercise` and treat a pre-expiry assignment
as final only once their own redeem has settled.

---

##### redeem(uint256 amount)

```solidity
function redeem(uint256 amount) public nonReentrant;
```

- `amount` `uint256`: Receipt units to redeem. Before `exerciseDeadline`, the call burns and pays `min(amount, consBacked)`; if that value exceeds the caller's balance, the burn reverts `ERC20InsufficientBalance`. After the deadline, the call attempts to burn the full `amount`, so any over-balance request reaches the same ERC-20 error unless a defensive pool-balance check reverts `InsufficientPool` first. Integrators should bound `amount` by the caller's current balance.

Redeem `amount` of the caller's receipts. Same cons-first semantics as `redeem`,
dust rule included.

---

##### collectFees(address token)

```solidity
function collectFees(address token) external nonReentrant;
```

- `token` `address`: The token to collect (`collateral` or `consideration`).

Pay the accrued redeem fee for a single `token` to the factory owner, leaving a 1-wei
gas floor. Call once per token (`collateral` and `consideration`); per-token so one
token's transfer reverting can never strand the other's fee. Permissionless; funds
always go to the factory owner regardless of caller, so a keeper can poke it but no one
can redirect the fee. `token`s other than the pair's two are a harmless no-op (they
never accrue). Unlike `sweep`, callable at any time: accrued fees are pure surplus,
never part of the backing the outstanding receipts require. Paid to `factory.owner()`
at call time; the factory cannot be renounced, so there is always a payee.

Per-token so one token's transfer reverting (e.g. a paused/blocklisting leg) can never
strand the other's accrued fee. `token` is arbitrary but harmless: only `collateral` and
`consideration` ever carry a non-zero `feeAccrued`, so any other token is a no-op on the
virgin-slot guard below; no foreign slot is initialised. Leaving 1 wei behind rather than
zeroing keeps the slot non-zero so future accruals stay ~5k, not ~22k.

---

##### sweep(address token, address to)

```solidity
function sweep(address token, address to) external nonReentrant;
```

- `token` `address`: ERC20 to drain. Typically the option's collateral or consideration, but any token is accepted; a `token` this contract holds none of is a no-op (no event).
- `to` `address`: Recipient of the swept balance. Chosen by the factory owner; must be non-zero.

Factory-owner dust drain; sweeps this Receipt's whole residual `token` balance to
`to`, only once every receipt has been burned. Checks run in this order: reverts
`UnauthorizedCaller` for anyone but the factory owner, then `ZeroValue` for a zero
`to`, then `OutstandingReceipts` while `totalSupply() != 0`. It can therefore never
short a live redemption pool; it strictly cleans up rounding residue,
post-redemption donations, or stray ERC20s sent here by accident. Any uncollected
redeem fee for `token` leaves with the swept balance (to `to`, without a `Fee`
event) and `feeAccrued` for it is reset to the 1-wei floor. `FeeCleared` reports the
cleared amount; call `collectFees` first to pay the fee to the factory owner instead.

`totalSupply() == 0` is the whole guarantee, and it is stronger than it looks: the
solvency identity makes `consBacked <= totalSupply()`, so an empty supply also means
nothing is cons-backed and no holder has a claim on either pool. Everything left is
unowned.
Two consequences worth planning for. First, this is the one path that moves a token
other than the pair's own two, and it reports the move as `Swept`; see that event.
Second, the authority is the factory owner *at call time*, so transferring factory
ownership moves this right with it. (`Factory.renounceOwnership` is disabled precisely
because an ownerless factory would strand every sweepable balance forever.)

---

##### redeemFor(address[] calldata holders)

```solidity
function redeemFor(address[] calldata holders) external nonReentrant;
```

- `holders` `address[]`: Holders whose receipts to redeem in full.

Keeper-gated batch redeem. For each holder where the caller holds `Perm.REDEEM` in
the holder's factory permission mask (or `msg.sender == holder`), the holder's full
balance is redeemed under `redeem` semantics (cons-first; mix only post-window). The
resulting collateral / consideration go to the **holder**; never to the caller.
Unauthorised and zero-balance holders are skipped silently so a single stale entry
doesn't brick the batch.
Composability-safe by design: a Receipt held inside an ERC4626 vault, Morpho market,
or multisig CANNOT be force-redeemed by an unauthorised third party.
**Reverts are NOT contained.** Only unauthorised and zero-balance holders are
skipped. Anything that makes the redemption itself revert; `ExerciseWindowOpen`
when the consideration pool is empty pre-window, `BeforeExerciseWindow` on a
European option, or the defensive `InsufficientPool`; aborts the WHOLE batch and
rolls back the holders already processed. Because the cons leg is FCFS, the pool
empties partway down any long list, so a pre-window batch reverting is the ordinary
outcome rather than an edge case. Callers should size batches accordingly, or call
`redeem` per holder if partial progress matters.
Dust is not skipped, and is the one way this can destroy value: a holder whose
balance converts to zero consideration is burned for no payout, exactly as in
`redeem`. A keeper sweeping a long holder list pre-window will do that to every dust
holder on it.

The composability guarantee is why there is no permissionless `redeem(address)`:
one would let any caller change a vault's collateral balance out from under it. The
auto-burn leg of
`Option._settledTransfer` upholds the same principle for *triggering*: it fires only
when the receiver has granted `Perm.BURN` to the account that **initiated** the
transfer (`msg.sender`, not necessarily the token sender `from`), so an unauthorised
party cannot start an unwind of a held position.
**It does not control the size.** The guard decides *whether* auto-burn fires; the
amount is `Math.min(receipt.balanceOf(to), value)`, and `balanceOf` here is a plain
ERC-20 balance that ANY address can increase by transferring Receipt tokens to `to`; this contract has no transfer restriction and no opt-out for unsolicited shorts. A
stranger can therefore donate shorts to a vault so that the vault's next *authorised*
inbound Option transfer is fully netted: the vault receives collateral instead of the
long tokens, at a size the stranger chose. Integrators must NOT assume an inbound
`Option` transfer raises their option balance by the amount transferred; read the
balance back.
A repeated holder redeems their full balance on the first occurrence; post-window the
later occurrences hit the zero-balance skip. Pre-window the cons leg caps at
`consBacked`, so a first occurrence that leaves a remainder has also emptied the pool,
and the repeat then reverts `ExerciseWindowOpen` and aborts the whole batch.

</details>

### Factory

Creates options, routes token pulls, stores permissions, and sets the new-market fee.

<details>
<summary>Functions</summary>

##### DEFAULT_EXERCISE_WINDOW

```solidity
uint40 public constant DEFAULT_EXERCISE_WINDOW = 8 hours
```

Informational suggested-default window length (frontend convenience). The contract
does NOT consult this; `CreateParams.windowSeconds` is always taken literally.
Exposed so frontends can read a canonical "8 hours" without hardcoding it.

---

##### receipts

```solidity
mapping(address receipt => bool created) public receipts
```

---

##### optionFor

```solidity
mapping(bytes32 key => address option) public optionFor
```

Write-once: an entry is never cleared or overwritten. [createOption2](#factory) deduplicates the
same way [createOption](#factory) does but is strict about it; with a non-zero salt a registry
hit reverts `OptionExists` rather than returning an address the caller did not mine.

---

##### permissions

```solidity
mapping(address account => mapping(address operator => uint256 mask)) public permissions
```

---

##### feeBps

```solidity
uint64 public feeBps
```

Protocol fee in basis points, skimmed from both legs (consideration and collateral)
of `IReceipt.redeem` only; never on exercise and never on pair-burn. This is the
default used to initialize newly-created Receipts; each Receipt stores its own mutable
rate and can be repriced by `IReceipt.setFee`. `0` means no fee. Accrued fees are paid
to `owner` via `IReceipt.collectFees`. Capped at 1000 (10%) by `setFee`.

---

##### owner()

```solidity
function owner() public view override(Ownable, IFactory) returns (address);
```

- Returns `address`: The current owner; never `address(0)`.

The `Ownable` owner. Its reach into the protocol: `setFee` (≤ 10 %, used as the
default during market initialization; `IReceipt.setFee` can reprice a live market),
`IReceipt.sweep` (gated on `totalSupply() == 0`) and receiving `IReceipt.collectFees`.
It cannot withdraw holder backing. `renounceOwnership` is disabled
(`OwnershipNotRenounceable`) because an ownerless factory would strand every accrued
fee and sweepable balance in every Receipt it ever created.

---

##### renounceOwnership()

```solidity
function renounceOwnership() public pure override;
```

Disabled. `Receipt.collectFees` pays `owner()` and `Receipt.sweep` is gated on it, so
an ownerless factory would strand fees and residue in every Receipt it ever created.

---

##### optionKey(CreateParams calldata p)

```solidity
function optionKey(CreateParams calldata p) public pure returns (bytes32);
```

- `p` `CreateParams`: The params to key; not validated, so a key exists for params `createOption` would reject.
- Returns `bytes32`: `keccak256(abi.encode(...))` of the seven fields in declaration order.

Deterministic registry key for a set of economic params. Folds in all seven
`CreateParams` fields; differing in any field yields a different key (and therefore a
distinct option market).

`public pure` so off-chain callers and tests can compute the key and look up
`optionFor` without a creation tx.

---

##### createOption(CreateParams calldata p)

```solidity
function createOption(CreateParams calldata p) public returns (address);
```

- `p` `CreateParams`
- Returns `address`: The canonical Option address; either freshly deployed, or the existing option if an economically-identical one already exists.

Create a new Option + Receipt pair per the given parameters, or return the existing
canonical Option if one with economically-identical params already exists
(get-or-create; see `optionFor`). Emits `OptionCreated` on a fresh deploy only; a
registry hit returns the existing address with no event, so a script waiting on
`OptionCreated` for a market that already exists waits forever. The struct-field checks
(strike non-zero, tokens, expiry, European window) run BEFORE the registry lookup, so
naming an existing market whose `expirationDate` has passed reverts `InvalidValue`
rather than returning it; use `optionFor` with `optionKey` for a pure lookup. The
token-dependent checks (`decimals() <= 36`, the strike bound) run only on a fresh
deploy, since a registry hit already passed them.
⚠ `collateral` and `consideration` MUST be standard ERC-20 tokens with exact,
balance-preserving transfers. Fee-on-transfer and rebasing / elastic-supply tokens are
NOT supported and will corrupt the option's 1:1 accounting. There is no creation-time
guard against this; the caller is responsible for only pairing standard tokens.

Option is an EIP-1167 clone; Receipt is a clone-with-immutable-args (per-option
strike, decimals, dates, etc. baked into the clone's runtime bytecode). See
`CreateParams` for per-field validation and the contract-level "Supported tokens"
note for the token policy.

---

##### createOption2(CreateParams calldata p, bytes32 optionSalt, bytes32 receiptSalt)

```solidity
function createOption2(CreateParams calldata p, bytes32 optionSalt, bytes32 receiptSalt) public nonReentrant returns (address option_);
```

- `p` `CreateParams`
- `optionSalt` `bytes32`: CREATE2 salt for the Option clone, or `bytes32(0)` for plain CREATE.
- `receiptSalt` `bytes32`: CREATE2 salt for the Receipt clone, or `bytes32(0)` for plain CREATE.
- Returns `option_` `address`: The Option address: the freshly deployed clone, or the existing canonical Option when the salts permit returning it (both zero, or `optionSalt` resolving to it with a zero `receiptSalt`).

CREATE2 form of `createOption`: the Option and Receipt clones land at addresses derived
from `optionSalt` / `receiptSalt`, allowing vanity addresses mined off-chain. Mine
`optionSalt` first; the Receipt's init code embeds the resulting Option address.
Supplying a non-zero salt makes the call STRICT: it returns the address you mined or
reverts `OptionExists`; it never silently returns a pre-existing Option at some other
address. The Receipt leg of that check is blunt: ANY non-zero `receiptSalt` against
an existing market reverts `OptionExists`, even when `optionSalt` resolves to the
existing Option (the Receipt address is not re-derived on-chain). Pass zero salts (or
use `createOption`) to accept the canonical Option; a zero salt means "don't mine
this one" and selects plain CREATE for that clone. Mine both salts or neither: with
`optionSalt == 0` the Option lands at the factory's next CREATE nonce, which any
earlier creation shifts, and because the Receipt's init code embeds that address a
mined `receiptSalt` then resolves to a different address than predicted, with no
on-chain check.
Salts are namespaced by the caller: the effective CREATE2 salt is
`keccak256(msg.sender ‖ salt)`, so a salt one account mines cannot be occupied by
another. Address prediction is done off-chain (the factory exposes no prediction
helper and no init-code-hash view):
`address = keccak256(0xff ‖ factory ‖ keccak256(deployer ‖ salt) ‖ keccak256(initCode))[12:]`,
where the Option's init code is the EIP-1167 proxy for `OPTION_CLONE` and the
Receipt's is the clone-with-immutable-args creation code for `RECEIPT_CLONE` with the
112-byte packed args appended; which embed the resulting Option address (so mine the
Option salt first).

Naming mirrors the `clone` / `clone2` convention of the underlying clone library.
Identical to [createOption](#factory) except for the deploy opcode and the strictness a non-zero
salt adds on a registry hit; same validation, same registry, same event, same
`Option.init` wiring. With two zero salts the two functions are indistinguishable.
**Mine `optionSalt` first, then `receiptSalt`; the order is forced.** The Receipt's
immutable args embed the Option's address, so the Receipt's init code (and therefore its
address) depends on where the Option landed. The reverse is not true: the Option reaches
its Receipt through a storage pointer set by `Option.init`, which cannot affect the
Option's own address. The two searches cannot be parallelised.
Address prediction is done entirely off-chain (the factory exposes no prediction
helper and no init-code-hash view). The effective
CREATE2 salt is namespaced by the caller; `effSalt = keccak256(deployer ‖ salt)`; so
each attempt is `keccak256(0xff ‖ factory ‖ effSalt ‖ initCodeHash)`: hash
`deployer ‖ salt` first, then the 85-byte CREATE2 preimage over the clone's init code.
For the Option, `initCodeHash` is that of the EIP-1167 proxy for `OPTION_CLONE`
(OpenZeppelin `Clones.predictDeterministicAddress` computes it). For the Receipt,
tooling must rebuild `ClonesWithImmutableArgs.creation(RECEIPT_CLONE, args)` with
`args` packed exactly as [_receiptArgs](#factory) does (112 bytes: strike[32] coll[20] cons[20]
option[20] exp[8] deadline[8] isPut[1] isEuro[1] collDec[1] consDec[1]) and hash the
result. Vary the
32 salt bytes per attempt. Budget roughly 16^n attempts for an n-hex-char prefix
(65,536 expected for 4 chars).
**Supplying a salt makes this call STRICT.** Get-or-create still deduplicates markets,
but it will never silently hand back an address you did not mine. If an economically-
identical Option already exists and `optionSalt` does not resolve to it, the call reverts
`OptionExists`; any non-zero `receiptSalt` against an existing Option reverts likewise.
So with a non-zero `optionSalt` this function either returns the address you mined
(`keccak256(0xff ‖ factory ‖ keccak256(msg.sender ‖ optionSalt) ‖ optionInitCode)`) or
reverts; never anything else. To take the canonical Option instead, pass zero salts (or
call [createOption](#factory)); that path is unchanged. Check `optionFor`/[optionKey](#factory) first.
**Salts are namespaced by `msg.sender`.** The effective CREATE2 salt is
`keccak256(msg.sender ‖ salt)`, so a salt one account mines lives in that
account's own namespace and CANNOT be burned by anyone else: a different caller reusing
the same `salt` value resolves to a different address and never collides with yours.
(Within a single account, reusing a `salt` already deployed against the same template
still reverts; the address is occupied; re-mine and retry.) A front-runner on the *same*
params cannot silently take your address either; see the strictness note above.
⚠ **Mine BOTH salts or neither.** With `optionSalt == 0` the Option lands via plain CREATE
at the factory's next nonce, which any unrelated creation in an earlier transaction shifts; and since the Receipt's init code embeds the Option address, a mined `receiptSalt` then
silently lands elsewhere. That combination cannot be made strict on-chain; it is supported
only for callers who control transaction ordering.
**A zero salt means "don't mine this one".** `bytes32(0)` is a sentinel selecting plain
CREATE for that clone, exactly as [createOption](#factory) would. The two salts are independent, so
all four combinations are valid; vanity both, vanity neither (identical to
[createOption](#factory)), or vanity just the Option / just the Receipt. This costs you the ability
to use `bytes32(0)` as a real CREATE2 salt; that is a deliberate trade, since a mined
vanity salt is effectively random and will never be zero.

---

##### createOptions(CreateParams[] calldata params)

```solidity
function createOptions(CreateParams[] calldata params) external returns (address[] memory result);
```

- `params` `CreateParams[]`: Array of `CreateParams`.
- Returns `result` `address[]`: Option addresses aligned with `params`; newly deployed or pre-existing.

Batch form of `createOption`. Same ordering in → same ordering out. Get-or-create
applies per entry; entries are not isolated; one bad entry reverts the whole batch,
rolling back the entries already processed.

Each entry is a full [createOption](#factory) call, so an entry naming an existing market
yields that market's address and deploys nothing.

---

##### createOptions2(CreateParams[] calldata params, bytes32[] calldata optionSalts, bytes32[] calldata receiptSalts)

```solidity
function createOptions2(CreateParams[] calldata params, bytes32[] calldata optionSalts, bytes32[] calldata receiptSalts)
    external
    returns (address[] memory result);
```

- `params` `CreateParams[]`: Array of `CreateParams`.
- `optionSalts` `bytes32[]`: Option-clone CREATE2 salts, aligned with `params`.
- `receiptSalts` `bytes32[]`: Receipt-clone CREATE2 salts, aligned with `params`.
- Returns `result` `address[]`: Option addresses aligned with `params`; newly deployed or pre-existing.

Batch form of `createOption2`; salt arrays are positional and must match `params` length
(else `InvalidValue`). Each entry carries `createOption2`'s full strictness, and a revert
is not contained: one entry's `OptionExists` rolls back the WHOLE batch, including
entries already deployed. The salts are not consumed by such a revert. Check `optionFor`
against `optionKey` for every entry before submitting a large batch.

Mine each pair independently: within one batch, entry `i`'s Receipt salt depends only on
entry `i`'s Option address, not on any other entry.
Zero salts fall back to plain CREATE per-clone (see [createOption2](#factory)), so a single batch
can freely mix mined and unmined entries; pass `bytes32(0)` for any clone you don't want
a vanity address for, and that entry behaves exactly like [createOption](#factory).

---

##### setPermissions(address operator, uint256 mask)

```solidity
function setPermissions(address operator, uint256 mask) external nonZeroAddr(operator);
```

- `operator` `address`: Address being granted (or, for the caller's own address, the automation opt-in).
- `mask` `uint256`: Full replacement mask; must not contain bits outside `Perm.ALL`.

Set `operator`'s permission mask over the caller's positions, overwriting any
previous mask (`0` revokes everything). Bits: `Perm.TRANSFER` (1), `Perm.MINT` (2),
`Perm.BURN` (4), `Perm.REDEEM` (8), `Perm.EXERCISE` (16), `Perm.TRANSFER_RECEIPT`
(32). Reverts `InvalidAddress` for a zero `operator` and `InvalidValue` on bits outside
`Perm.ALL`; see `Perm` for what each bit authorises and its risk profile. Emits
`PermissionsUpdated` with the stored mask, including when it is unchanged.
`operator == msg.sender` sets the caller's own automation opt-ins (auto-mint, and
auto-burn only on transfers the caller both receives and initiates). That self entry
goes through this same function with no distinct shape, so `setPermissions(self,
Perm.ALL)` is not a harmless self-initialisation: its `MINT` bit arms auto-mint and
removes the ERC-20 insufficient-balance revert on every transfer; see `Perm`.

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
- `TRANSFER_RECEIPT` is the same custody as `TRANSFER`, over the caller's *short*
positions: `Receipt.transferFrom` skips the ERC-20 allowance for its holder, and
whoever holds a receipt owns its settlement claim; the operator can move receipts
to itself and redeem them as its own, without needing `REDEEM`.
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
- `mask` `uint256`: Bits to add; must not contain bits outside `Perm.ALL`. Zero is a no-op.

OR `mask` into `operator`'s existing permission mask (adds bits, never removes).
There is no `removePermissions`: the only revoke is `setPermissions(operator, 0)`
(or a full replacement mask via `setPermissions`). Reverts `InvalidAddress` for a zero
`operator` and `InvalidValue` on bits outside `Perm.ALL`. `mask == 0` is accepted as a
no-op that still emits `PermissionsUpdated` with the unchanged mask; do not read
that event as a revoke.

---

##### setFee(uint64 bps)

```solidity
function setFee(uint64 bps) external onlyOwner;
```

- `bps` `uint64`: New fee in basis points; `0` disables the fee.

Set the protocol redeem fee in basis points. Owner-only (any other caller reverts
`OwnableUnauthorizedAccount`); reverts `InvalidValue` above 1000 (10%). Emits `Fee`. Applies only to options created AFTER the call: each
market initializes its Receipt's storage fee from the current `feeBps`; the Receipt
owner can later change that market's rate with `IReceipt.setFee`.

</details>

### Perm

Permission bits for `Factory.setPermissions` / `Factory.addPermissions`, from `contracts/Permissions.sol`. Masks with bits outside `ALL` revert `InvalidValue`.

```solidity
uint256 constant TRANSFER = 1 << 0; // 1,  move the owner's Option tokens
uint256 constant MINT     = 1 << 1; // 2,  mint against the owner's collateral allowance
uint256 constant BURN     = 1 << 2; // 4,  pair-burn for the owner
uint256 constant REDEEM   = 1 << 3; // 8,  trigger redemption for the owner
uint256 constant EXERCISE = 1 << 4; // 16, exercise for the owner (caller pays strike, receives collateral)
uint256 constant TRANSFER_RECEIPT = 1 << 5; // 32, move the owner's Receipt tokens
uint256 constant ALL      = 63;     // validity bound, not a recommended grant
```

- `TRANSFER`: `Option.transferFrom` without a per-option ERC20 allowance.
- `MINT`: `Option.mint(account, amount)` and the auto-mint transfer leg.
- `BURN`: `Option.burn(account, amount)` and the auto-burn transfer leg.
- `REDEEM`: `Receipt.redeemFor(holders)`; payout always to the holder.
- `EXERCISE`: `Option.exerciseFor`; the caller pays the strike and receives the collateral.
- `TRANSFER_RECEIPT`: `Receipt.transferFrom` without a per-Receipt ERC20 allowance.

{/* API:END */}
