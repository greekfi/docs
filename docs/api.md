---
title: API Reference
sidebar_label: API Reference
sidebar_position: 5
description: "Auto-generated per-contract reference rendered from NatSpec via forge doc."
---

# API Reference

Auto-generated from the NatSpec in `foundry/contracts/`. Each contract is collapsible; reads
are listed before state-changing functions, with events and errors in their own collapsible.
Run `yarn docs:gen` from the repo root to refresh.

## Option

<details>
<summary>Functions</summary>

**Inherits:**
ERC20, ReentrancyGuardTransient

**Title:**
Option — long-side ERC20

**Author:**
Greek.fi

One half of a Greek option pair. Holding this token grants the *right* (not obligation)
to buy the collateral at the strike price — a standard call — or, for puts, the right
to sell. Its paired `Receipt` contract holds the short side of the same option.
Settlement is purely time-gated, no oracle is consulted at any point. Two flavours
coexist, chosen at creation by `isEuro`:
| Mode      | `isEuro` | Pre-expiry exercise | In-window exercise | Post-window short exit     |
| --------- | -------- | ------------------- | ------------------ | -------------------------- |
| American  | `false`  | allowed             | allowed            | `redeem` — cons-first FCFS |
| European  | `true`   | reverts             | allowed            | `redeem` — cons-first FCFS |
Short-side settlement is **NOT pro-rata**. `Receipt.redeem` pays consideration first, on a
first-come-first-served basis, and only then collateral 1:1 — so redemption *order*
decides which asset a writer ends up with. See `Receipt.redeem` for the full semantics
and the writer strategy that follows from it.
The post-expiry exercise window is `[expirationDate, exerciseDeadline]` — **both bounds
inclusive** — where `exerciseDeadline = expirationDate + windowSeconds`. `windowSeconds`
is set per option at creation and taken literally; the contract applies no default
(`Factory.DEFAULT_EXERCISE_WINDOW` = 8 hours is informational, for frontends), and an
American option may be created with `windowSeconds == 0`, collapsing the window to the
single instant `expirationDate`. The holder decides off-chain whether ITM is profitable
and pays strike to exercise; the protocol just enforces timing and the 1:1 collateral
invariant.
Minting stops earlier than everything else: [mint](#option) is barred from `expirationDate`
onwards ([notExpired](#option) tests `>=`), while transfer and pair `burn` stay open through the
whole window, up to and including `exerciseDeadline`. Once the window closes, the
remaining exits are `redeem` (short side, cons-first FCFS) and [expire](#option) (long-side dust
burn).
#### Auto-mint / auto-burn
Two transfer-time conveniences, each gated on a `Perm` bit in the factory permission
table. They are **not** symmetric — the two legs read different rows:
- **Auto-mint** — if the sender tries to transfer more `Option` than they hold,
the contract pulls enough collateral from the sender and mints the deficit. Gated on
`Perm.MINT` in `permissions(from, msg.sender)`, which is the sender's own **self entry**
(`factory.setPermissions(self, Perm.MINT)`) when they move their own tokens.
- **Auto-burn** — if the receiver already holds the matching `Receipt` ("short")
token, incoming `Option` is immediately burned pair-wise, returning collateral. Gated on
`Perm.BURN` in `permissions(to, msg.sender)` — the **receiver's** grant to whoever
initiated* the transfer. The self entry therefore applies only where the receiver is
also the initiator; on an ordinary outbound transfer to a third party the receiver's own
self BURN bit is never read.
Both make it possible to treat `Option` and its underlying collateral as interchangeable
for power users (e.g. vaults).
Neither is risk-free, and the risks differ. `MINT` on self removes the ERC-20 safety net:
a transfer larger than your balance no longer reverts, it silently pulls your collateral
and opens a new short. `BURN` is scoped per initiator rather than blanket — an inbound
transfer only nets if you granted `BURN` to the account that initiated it, and a self bit
on its own nets nothing beyond your own self-transfers and pull-ins (see [_settledTransfer](#option)).
#### Supported tokens
Standard ERC-20 collateral/consideration only, with exact, balance-preserving transfers.
Fee-on-transfer and rebasing / elastic-supply tokens are NOT supported — they break the
protocol's 1:1 accounting (deposits, exercise, redemption, solvency). See `Factory` and
`Receipt` for the full policy.

Deployed once as a template; the factory produces per-option instances via
EIP-1167 minimal proxy clones. `init()` is used instead of a constructor.


#### FACTORY
Factory that created this option. Set in the template constructor (= the factory
that deployed it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable FACTORY
```


#### receipt
Paired short-side ERC20 (collateral receipt) that holds the collateral and handles
settlement math. Doubles as the [init](#option) guard — non-zero means initialised.


```solidity
Receipt public receipt
```


#### factory()

Address of the `Factory` that created this option.

The one getter in this block that is NOT a `Receipt` passthrough: it returns this
contract's own `FACTORY` immutable and never touches the Receipt. Every other view
below forwards to the paired Receipt, where the per-option terms actually live.


```solidity
function factory() public view returns (address);
```

#### collateral()

Underlying collateral token (e.g. WETH for a WETH/USDC call).


```solidity
function collateral() public view returns (address);
```

#### consideration()

Consideration / quote token (e.g. USDC for a WETH/USDC call).


```solidity
function consideration() public view returns (address);
```

#### expirationDate()

Unix timestamp at which the option expires.


```solidity
function expirationDate() public view returns (uint40);
```

#### exerciseDeadline()

Unix timestamp at which the post-expiry exercise window closes.


```solidity
function exerciseDeadline() public view returns (uint64);
```

#### strike()

Strike price in 18-decimal fixed point, encoded as "consideration per collateral".

For puts, this stores the *inverse* of the human-readable strike (see [name](#option) for display).


```solidity
function strike() public view returns (uint256);
```

#### isPut()

`true` if this is a put option; `false` for calls.


```solidity
function isPut() public view returns (bool);
```

#### isEuro()

`true` for European-style options (exercise barred before `expirationDate`; only the
post-expiry window is exercisable). `false` for American, which is exercisable at any
time up to and including `exerciseDeadline`.


```solidity
function isEuro() public view returns (bool);
```

#### decimals()

Option token shares the collateral's decimals so 1 option token ↔ 1 collateral unit.

Read live from the collateral token on every call, not from the Receipt's cached
`decimals` immutable arg. The two agree for any supported (non-rebasing, standard)
ERC-20.


```solidity
function decimals() public view override returns (uint8);
```

#### name()

Human-readable token name in the form `OPT[E/A]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `OPTE-` prefix flags European options, `OPTA-` flags American options, and the
date is the UTC day of `expirationDate`, not of `exerciseDeadline`.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form,
guarded on `strike() > 0` so a zero strike renders as `0` rather than dividing by zero.


```solidity
function name() public view override returns (string memory);
```

#### symbol()

Same as [name](#option). Matching name/symbol keeps wallets and explorers in sync.


```solidity
function symbol() public view override returns (string memory);
```

#### balancesOf(address account)

All four balances that matter for this option in one call.


```solidity
function balancesOf(address account) public view returns (Balances memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Address to query.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`Balances`|A `Balances` struct: collateral token, consideration token, long option, short receipt.|


#### details()

Full option descriptor — addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.


```solidity
function details() public view returns (OptionInfo memory);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`OptionInfo`|An `OptionInfo` struct. Every field is sourced from the paired `Receipt`, so the `strike` returned is the raw 18-decimal value, still inverted for puts.|


#### constructor

Template constructor. Never called for user-facing instances; each clone goes
through [init](#option) instead. Captures the deployer as `FACTORY` and sets `receipt` to
the non-zero sentinel `0xdead`, so the template itself permanently fails the [init](#option)
guard and can never be initialised or used as an option.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`name_`|`string`|  Stored by the ERC20 base but never read back — [name](#option) is overridden to render the option's terms instead. Deploy-time label only.|
|`symbol_`|`string`|Likewise inert; [symbol](#option) is overridden to mirror [name](#option).|


#### init(address receipt_)

Initialises a freshly-cloned Option. Called exactly once, by the factory, before the
clone is handed out. Reverts `AlreadyInitialized` if `receipt` is already set,
`Unauthorized` if the caller is not `FACTORY`, and `ZeroValue` on a zero `receipt_`.
The pairing is permanent: there is no setter and no upgrade path.


```solidity
function init(address receipt_) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`receipt_`|`address`|Address of the paired `Receipt` contract — immutable for this option.|


#### mint(uint256 amount)

Mint `amount` option tokens to the caller, collateralised 1:1 with the underlying.
The caller receives the matching `Receipt` too, and pays the collateral out of their
ERC-20 allowance to the `Factory`. Barred from `expirationDate` onwards ([notExpired](#option)).


```solidity
function mint(uint256 amount) public nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral-denominated mint amount, in collateral decimals.|


#### mint(address account, uint256 amount)

Mint `amount` option tokens to `account`. Collateral is pulled from `account` via
the factory's centralised allowance, so the caller must be `account` itself or hold
`Perm.MINT` in `account`'s factory permission mask — otherwise any address holding
a non-zero factory allowance could be force-minted into unwanted positions.

`Perm.MINT` is an explicit, single-purpose grant: it lets the operator pull the
holder's factory collateral allowance into new positions (functionally a permit on
collateral). It is NOT implied by `Perm.TRANSFER` or any other bit.


```solidity
function mint(address account, uint256 amount) public nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of both `Option` and `Receipt` tokens. Pays the collateral.|
|`amount`|`uint256`| Collateral-denominated mint amount.|


#### transfer(address to, uint256 amount)

Overridden to run the auto-mint / auto-burn hook, so this is NOT a plain ERC-20
transfer: it may mint against the caller's collateral or net options out at the
receiver, and it always returns `true` or reverts. Reverts `ExerciseWindowClosed` once
`block.timestamp > exerciseDeadline` — the long token keeps circulating through the
window so holders can still sell to keepers. See [_settledTransfer](#option) for the two legs.


```solidity
function transfer(address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

#### transferFrom(address from, address to, uint256 amount)

Skips `_spendAllowance` when [notAuthorized](#option) says it may — i.e. when `msg.sender` is
`from` itself, or holds `Perm.TRANSFER` in `from`'s factory permission mask (a blanket
approval across every option this factory has created or will create). Otherwise the
ordinary per-option ERC-20 allowance is spent. Then runs the same
[_settledTransfer](#option) hook as [transfer](#option), and is likewise gated by [beforeDeadline](#option).
Note the asymmetry with the hook: `Perm.TRANSFER` decides who may move the tokens,
while the hook's two legs key on `Perm.MINT` in `from`'s row and `Perm.BURN` in `to`'s
row. Holding TRANSFER alone reaches neither leg.


```solidity
function transferFrom(address from, address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

#### exercise()

Exercise the caller's entire Option balance: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to `exerciseFor(address,uint256)` with
`holder = msg.sender`, so msg.sender pays AND msg.sender receives (no dangerous
asymmetry). Reverts `ZeroValue` when the caller holds nothing; the balance is read at
call time, so this exercises everything held including options received earlier in
the same transaction.


```solidity
function exercise() public;
```

#### exercise(uint256 amount)

Exercise `amount` of the caller's own options: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to `exerciseFor(address,uint256)` with
`holder = msg.sender`, so msg.sender pays AND msg.sender receives (no dangerous
asymmetry).


```solidity
function exercise(uint256 amount) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral units to receive. Consideration paid = `ceil(amount * strike)`, pulled from the caller's ERC-20 allowance to the `Factory`.|


#### settle(Option opt, address holder, uint256 amount, uint256 minSurplus)

**Dangerous keeper path** — burn `amount` of `holder`'s options; `msg.sender` pays
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
value by a different route. Both bits are custody-grade — see `Perm`.
Allowed any time exercise itself is allowed ([canExercise](#option): pre-expiry for American,
plus the post-expiry window through `exerciseDeadline` for both flavours). Reverts
`ZeroValue` on a zero `amount`, `Unauthorized` without the grant, and
`ERC20InsufficientBalance` if `holder` does not hold `amount` — this path never
partially fills.
Example (a) — flash-loan keeper that pays the holder the ITM spread. Illustrative:
imports, the `lender` / `dex` addresses and the `SlippageExceeded` declaration are
elided, and a real keeper must also check `msg.sender == lender` in `onFlashLoan`.
```solidity
Keeper contract (audited, allowlisted off-chain). Holder authorises once:
factory.setPermissions(address(keeper), Perm.EXERCISE);
contract FlashExerciseKeeper is IERC3156FlashBorrower {
function settle(Option opt, address holder, uint256 amount, uint256 minSurplus)
external
{
1. Flash-borrow `ceil(amount * strike)` of consideration from any provider
(Aave / Maker / Morpho). The callback is `onFlashLoan` below.
bytes memory cb = abi.encode(address(opt), holder, amount, minSurplus);
IReceipt r = IReceipt(address(opt.receipt()));
IERC20 cons = r.consideration();
uint256 strikeCost = r.toConsideration(amount, true);
IERC3156FlashLender(lender).flashLoan(this, address(cons), strikeCost, cb);
}
function onFlashLoan(address, address, uint256 loaned, uint256 fee, bytes calldata data)
external returns (bytes32)
{
(address optAddr, address holder, uint256 amount, uint256 minSurplus) =
abi.decode(data, (address, address, uint256, uint256));
Option opt = Option(optAddr);
2. Approve the FACTORY — not the Option — to pull the consideration we just
borrowed: Receipt.exercise collects it through Factory.transferFrom.
IReceipt r = IReceipt(address(opt.receipt()));
r.consideration().approve(opt.factory(), loaned);
3. Exercise on behalf of the holder. Collateral lands here.
opt.exerciseFor(holder, amount);
4. Swap collateral → consideration on a DEX (router omitted for brevity).
uint256 proceeds = dex.swapExactIn(address(r.collateral()), address(r.consideration()), amount);
5. Approve the lender to pull loan + fee back (how ERC-3156 repays).
r.consideration().approve(lender, loaned + fee);
6. Pay the holder the surplus on-chain. Enforce a floor so the holder is
never settled at a worse price than they asked for.
uint256 surplus = proceeds - loaned - fee;
if (surplus < minSurplus) revert SlippageExceeded();
r.consideration().transfer(holder, surplus);
return keccak256("ERC3156FlashBorrower.onFlashLoan");
}
}
```
Step 6 is the whole guarantee, and nothing in this contract enforces it. A keeper
that simply omits it keeps the entire ITM value and the holder has no on-chain
recourse — a revert there would at least undo the exercise. That is why
`Perm.EXERCISE` must only ever be granted to a deployed, audited contract whose code
you have read, never to an EOA and never to an upgradeable proxy you do not control.


```solidity
function exerciseFor(address holder, uint256 amount) public canExercise nonReentrant nonZero(amount) returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holder`|`address`|Option holder whose tokens will be burned. Receives nothing on-chain.|
|`amount`|`uint256`|Collateral units to exercise. Consideration collected from `msg.sender` is `ceil(amount * strike)`; `msg.sender` receives the `amount` of collateral.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Collateral units exercised. Always exactly `amount` — the call reverts rather than partially filling, so the value is informational for on-chain callers.|


#### exerciseFor(address[] calldata holders, uint256[] calldata amounts)

Batch variant of `exerciseFor(address,uint256)`. Same dangerous semantics — the
caller pays consideration and receives collateral for every holder. Exercises
`amounts[i]` of `holders[i]` and emits one [Exercise](#option) per processed entry.
Three classes of entry are skipped rather than reverting, so one bad row cannot
grief the sweep for everyone else: a zero `amounts[i]`, an `amounts[i]` greater than
`balanceOf(holders[i])` (a holder who has since sold), and a holder who has not
granted the caller `Perm.EXERCISE`. A batch in which every entry is skipped — an
empty array included — succeeds as a no-op.

Skipping is the ONLY containment. `InvalidValue` on a length mismatch, the
[canExercise](#option) window checks, and anything that makes `Receipt.exercise` revert —
notably the caller's own consideration balance or factory allowance running out
partway down the list — abort the whole batch and roll back the holders already
processed. A repeated `holders[i]` is exercised once per occurrence, subject to the
balance check against the balance remaining after the earlier ones.
Unlike `exerciseFor(address,uint256)` this returns nothing, so on-chain callers
cannot tell which entries were skipped; read the balances back or watch the events.


```solidity
function exerciseFor(address[] calldata holders, uint256[] calldata amounts) external canExercise nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holders`|`address[]`|Option holders whose options will be exercised.|
|`amounts`|`uint256[]`|Per-holder collateral amounts to exercise; must align 1:1 with `holders` (unequal lengths revert `InvalidValue`).|


#### burn(uint256 amount)

Burn matched `Option` + `Receipt` pairs to recover the underlying collateral.

Shorthand for `burn(msg.sender, amount)`. Available up to and including
`exerciseDeadline` (boundary inclusive — same as transfer/exercise). Pair-burn nets
both sides 1:1 so it does not require the exercise window to be closed, and unlike
minting it stays open past `expirationDate`. Once `block.timestamp >
exerciseDeadline` it reverts `ExerciseWindowClosed` and short-side exits must route
through `Receipt.redeem` / `Receipt.redeemFor`. The caller must hold at least
`amount` of BOTH sides — the long burn happens first, so a caller holding only the
short side reverts `ERC20InsufficientBalance` on the option token.


```solidity
function burn(uint256 amount) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral-denominated amount to burn from each side.|


#### burn(address account, uint256 amount)

Burn `amount` matched `Option` + `Receipt` pairs held by `account`, returning the
underlying collateral to `account`.

The real implementation; `burn(uint256)` is a wrapper. Same timing rules — gated by
[beforeDeadline](#option), so valid up to and including `exerciseDeadline`. The caller must be
`account` itself or hold `Perm.BURN` in `account`'s factory permission mask, else
`Unauthorized`. Trigger-only grant: the recovered collateral always goes to `account`
(via `Receipt.burn`), never to the caller, so a BURN operator can unwind a holder's
matched position but not extract value from it. It can still choose the *moment* —
and note that the auto-burn leg of [_settledTransfer](#option) gives a BURN grantee a reach
this function does not have, because there the operator supplies the longs. See `Perm`.


```solidity
function burn(address account, uint256 amount) public nonReentrant nonZero(amount) beforeDeadline;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Holder of the matched Option + Receipt pair, and recipient of the collateral.|
|`amount`|`uint256`| Collateral-denominated amount to burn from each side.|


#### expire(address holder, uint256 amount)

Burn expired long option tokens to clean up dust.

Only callable strictly after `exerciseDeadline` — this is the one mutator that is
barred *while* the option is live rather than after. Past the deadline an unexercised
long token is inert: it can no longer be exercised ([canExercise](#option)), transferred or
pair-burned ([beforeDeadline](#option)), so it would otherwise sit in the holder's wallet
forever. This burns the long side only; it touches neither collateral nor the paired
`Receipt`, so it has no effect on the redemption pool or the solvency invariant
(short-side collateral is recovered separately via `Receipt.redeem`). Reverts
`NotYetExpired` on or before the deadline — use `burn(address,uint256)` or the
[exercise](#option) paths while live.
Caller must be `holder` or hold `Perm.BURN` in the holder's factory permission mask
(reverts `Unauthorized` otherwise) — BURN, not EXERCISE, because this is a pure
cleanup burn: the tokens are already worthless, so a keeper gains nothing here. The
authorisation check runs BEFORE the timestamp check, so an unauthorised caller sees
`Unauthorized` even while the option is still live.


```solidity
function expire(address holder, uint256 amount) public nonReentrant nonZero(amount);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holder`|`address`|Address of the long option holder.|
|`amount`|`uint256`|Amount of long option tokens to burn. Must not exceed the holder's balance.|




</details>

<details>
<summary>Events & Errors</summary>

#### Mint
Emitted when new options are minted against fresh collateral — by either [mint](#option)
overload or by the auto-mint leg of [_settledTransfer](#option), which routes through the
same `mint_`. A matching `Receipt` is always minted to `holder` alongside.


```solidity
event Mint(address longOption, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`holder`|`address`|     The account credited with the new tokens, and the account whose collateral is pulled to back them.|
|`amount`|`uint256`|     Collateral-denominated amount (same decimals as the collateral token).|

#### Exercise
Emitted once per exercised holder — by `exerciseFor(address,uint256)`, by the
[exercise](#option) overloads that delegate to it, and once per processed entry of the batch
`exerciseFor(address[],uint256[])`.


```solidity
event Exercise(address longOption, address caller, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`caller`|`address`|     The account that initiated the exercise: it pays the consideration and receives the collateral. Equal to `holder` only on the self-exercise paths.|
|`holder`|`address`|     The account whose options were burned. Receives nothing on-chain when `caller != holder`.|
|`amount`|`uint256`|     Collateral units delivered to `caller` (consideration collected from `caller` is `toConsideration(amount, true)`, ceil).|

#### Expire
Emitted **only** by an explicit [expire](#option) call — the sole site that emits this event.
An option passing `exerciseDeadline` emits nothing on its own; expiry is a timestamp
comparison, not a transaction. Indexers must not treat this as "the option expired",
only as "someone burned already-worthless long tokens".


```solidity
event Expire(address longOption, address caller, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`caller`|`address`|     The account that called [expire](#option) — the holder themselves, or an operator holding `Perm.BURN` in the holder's factory permission mask.|
|`holder`|`address`|     The account whose options were burned.|
|`amount`|`uint256`|     Amount of options burned.|

#### ContractExpired
Thrown by [notExpired](#option) — the only minting gate — when `block.timestamp >=
expirationDate`. Reached from both [mint](#option) overloads and from the auto-mint leg of
[_settledTransfer](#option), so an over-balance transfer between `expirationDate` and
`exerciseDeadline` reverts with this even though plain transfers are still open.


```solidity
error ContractExpired();
```

#### ZeroValue
Thrown by [nonZero](#option) when `amount == 0` — it guards `mint_` (so both [mint](#option)
overloads), `exerciseFor(address,uint256)`, `burn(address,uint256)` and [expire](#option) —
and by [init](#option) when `receipt_` is the zero address. The batch
`exerciseFor(address[],uint256[])` skips zero entries instead of reverting.


```solidity
error ZeroValue();
```

#### InvalidValue
Thrown when batch `exerciseFor(address[],uint256[])` is given `holders`/`amounts`
arrays of unequal length. Not used anywhere else.


```solidity
error InvalidValue();
```

#### ExerciseWindowClosed
Thrown once `block.timestamp > exerciseDeadline`, by every path that stays open
through the window: the exercise paths via [canExercise](#option), and [transfer](#option),
[transferFrom](#option) and `burn(address,uint256)` via [beforeDeadline](#option).


```solidity
error ExerciseWindowClosed();
```

#### InvalidExercise
Thrown by [canExercise](#option) when exercise is attempted on a European option before
`expirationDate`. American options never produce it.


```solidity
error InvalidExercise();
```

#### AlreadyInitialized
Thrown when [init](#option) is called on a clone that has already been initialised, or on
the template (whose `receipt` is set to a sentinel by the constructor).


```solidity
error AlreadyInitialized();
```

#### Unauthorized
Thrown whenever the caller lacks the required grant: [init](#option) called by anyone other
than the factory, and `mint(address,uint256)`, `exerciseFor(address,uint256)`,
`burn(address,uint256)` and [expire](#option) called by someone who is neither the owner of
the position nor a holder of the matching `Perm` bit. The batch
`exerciseFor(address[],uint256[])` skips such entries instead of reverting.


```solidity
error Unauthorized();
```

#### NotYetExpired
Thrown when [expire](#option) is called on or before `exerciseDeadline` (the option is still live).


```solidity
error NotYetExpired();
```



</details>

## Receipt

<details>
<summary>Functions</summary>

**Inherits:**
ERC20, ReentrancyGuardTransient, Clone

**Title:**
Receipt — short-side ERC20 (collateral receipt)

**Author:**
Greek.fi

The short side of a Greek option pair. Holding this token is a receipt for the
collateral you deposited when minting: you received the premium (off-chain) and now
bear the obligation of the exercise payoff. It holds all collateral for the pair and
receives the consideration paid on exercise.
No oracle is consulted at any point. Settlement is purely time-gated:
| Mode      | `isEuro` | Pre-expiry exercise | In-window exercise | Post-window short exit                |
| --------- | -------- | ------------------- | ------------------ | ------------------------------------- |
| American  | `false`  | allowed             | allowed            | `redeem` (cons-first, then coll 1:1)  |
| European  | `true`   | reverts             | allowed            | `redeem` (cons-first, then coll 1:1)  |
The last column is the *collateral* leg of `redeem`; its consideration leg opens earlier and is
capped at `consBacked` — see [redeem](#receipt) for the full schedule.
The exercise window is `[expirationDate, exerciseDeadline]` where
`exerciseDeadline = expirationDate + windowSeconds`. The deadline itself is still IN-window:
exercise and pair-burn ([burn](#receipt), called by Option) fail only once `block.timestamp >
exerciseDeadline`, and the collateral leg of [redeem](#receipt) opens strictly after that instant.
#### Rounding
- Collections from users (exercise): round UP (`toConsideration(amount, true)`).
- Payouts to users (redeem): round DOWN (floor).
- That pairing (ceil in, floor out) is what keeps the consideration pool able to fund every
redemption it is asked for; see [InsufficientPool](#receipt).
- Floor-out has a dust edge: a consideration payout that floors to zero still burns the
receipts it was computed from. See [_redeem](#receipt).
#### Supported tokens
This contract physically holds every collateral and consideration token for the pair and
tracks them 1:1 against its accounting, so the collateral/consideration MUST be standard
ERC-20 tokens with exact, balance-preserving transfers. Fee-on-transfer and rebasing /
elastic-supply tokens are NOT supported: any drift between `balanceOf` and the recorded
amounts breaks the redemption math and the solvency invariant. Fee-on-transfer pulls are
rejected at `Factory.transferFrom`; rebasing is undetectable on-chain and must be avoided
at option-creation time. See `Factory` for the full token policy.

Deployed once as a template; per-option instances are clones produced by
`ClonesWithImmutableArgs`. Every per-option value (strike, collateral, consideration, option,
expirationDate, exerciseDeadline, isPut, isEuro and both tokens' decimals) is appended to the
clone's runtime bytecode at deploy time, re-appended to calldata on every call, and read via
the `Clone._getArg*` helpers (CALLDATALOAD, ~3 gas). There is no `init` function — the clone
is fully configured the moment its bytecode is written.
#### Immutable args layout (packed, 112 bytes)
Written by `Factory._receiptArgs`; the two must agree byte for byte. Names in parentheses are
the ones that builder uses.
offset  0   strike            uint256  (32B)
offset 32   collateral        address  (20B)
offset 52   consideration     address  (20B)
offset 72   option            address  (20B)
offset 92   expirationDate    uint64   (8B, holds a uint40)
offset 100  exerciseDeadline  uint64   (8B, = expirationDate + windowSeconds; can exceed uint40)
offset 108  isPut             uint8    (1B, 0 or 1)
offset 109  isEuro            uint8    (1B, 0 or 1)
offset 110  decimals          uint8    (1B, `collateral.decimals()`; `collDec` in the factory)
offset 111  consDecimals      uint8    (1B, `consideration.decimals()`; `consDec` in the factory)


#### redeem

Redeem the caller's full Receipt balance. Reverts [ZeroValue](#receipt) if that balance is zero.

Cons-first, FCFS: pays up to `consBacked` receipt-units from the
consideration pool at strike rate, callable any time the pool can cover them
(European: not before `expirationDate` — reverts [BeforeExerciseWindow](#receipt)).
Any uncovered remainder is paid 1:1 in collateral **only after** `exerciseDeadline`;
pre-window, uncovered receipts stay in the caller's balance for later redemption.
The cons leg mirrors the equity-options "buy to close at strike" convention:
the writer sources consideration from previously-exercised counterparties sitting
in the pool. FCFS by design — a short who redeems early captures the cons premium
earlier exercisers paid in, leaving later post-window redeemers with collateral.
That asymmetry is intentional: it lets shorts lock in the strike-rate exchange
the moment the pool can fund it, rather than waiting for the window to close.
#### Dust: a floored consideration payout still burns the receipts
The consideration leg pays `floor(amount * strike)`. When that floors to ZERO — the
receipts being redeemed are worth less than one consideration atom — they are burned and
`consBacked` is still decremented, while NOTHING is transferred. And it is forced: the
legs are not selectable, so while `consBacked > 0` a redeemer cannot skip the
consideration leg to reach the collateral one. Redeeming a dust balance therefore
destroys it for no payout. The loss is bounded by the definition of that window — what
is destroyed is worth strictly less than one consideration atom at the strike price —
but it is real, and a caller who splits a balance into dust-sized calls repeats it once
per call. Redeem in amounts that convert to at least one atom. Note [exercise](#receipt) guards
the mirror case explicitly (`consAmount == 0` reverts [ZeroValue](#receipt)); this path does not.
#### factory
Factory that created this option, used to pull tokens against their ERC-20
allowance to the factory. Set in the template constructor (= the factory that
deployed it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable factory
```


#### STRIKEDEC
Decimal basis of the strike — fixed at 18 and independent of token decimals.


```solidity
uint8 public constant STRIKEDEC = 18
```


#### consBacked
Receipt-units the consideration pool can still back at strike rate. Incremented on
[exercise](#receipt) (cons inflow) and decremented by the cons leg of [_redeem](#receipt) (cons payout);
the collateral leg of redeem leaves it untouched. Equal to (total exercised − total
cons-redeemed), and never underflows — the cons leg caps its payout at this value.
Denominated in receipt/collateral units (the cons equivalent is `toConsideration`).


```solidity
uint256 public consBacked
```


#### strike()

Strike price, 18-decimal fixed point (consideration per collateral; inverted for puts).


```solidity
function strike() public pure returns (uint256);
```

#### collateral()

Underlying collateral token (e.g. WETH). All collateral sits here.


```solidity
function collateral() public pure returns (IERC20);
```

#### consideration()

Consideration / quote token (e.g. USDC). Accrues here from exercise payments.


```solidity
function consideration() public pure returns (IERC20);
```

#### option()

The paired `Option` contract. Only this address can call mint / burn / exercise.


```solidity
function option() public pure returns (address);
```

#### expirationDate()

Unix timestamp at which the option expires and the post-expiry exercise window opens.

Minting stops strictly before this instant (`Option.mint_`'s `notExpired`), and for a
European option both exercise and the consideration leg of [redeem](#receipt) open at it.


```solidity
function expirationDate() public pure returns (uint40);
```

#### exerciseDeadline()

Unix timestamp at which the post-expiry exercise window closes.

Returned as `uint64`: the stored value is `expirationDate + windowSeconds`,
and that sum can exceed `type(uint40).max` even though each operand is uint40,
so reading the full 64-bit slot avoids silently truncating the deadline.


```solidity
function exerciseDeadline() public pure returns (uint64);
```

#### isPut()

`true` if put, `false` if call.


```solidity
function isPut() public pure returns (bool);
```

#### isEuro()

`true` if European-style.


```solidity
function isEuro() public pure returns (bool);
```

#### decimals()

This Receipt's own ERC-20 decimals: the cached `collateral.decimals()`, so one receipt
unit is exactly one collateral unit. Also the collateral side of the conversion scaling.


```solidity
function decimals() public pure override returns (uint8);
```

#### consDecimals()

Cached `consideration.decimals()` used in conversion math.


```solidity
function consDecimals() public pure returns (uint8);
```

#### toConsideration(uint256 amount, bool round)

Convert a collateral-denominated (equivalently receipt-denominated) amount into the
consideration due for it at the strike price.

Evaluates `amount * strike * numer / (1e18 * denom)` as one `mulDiv`, so only
`strike * numer` can overflow — and `Factory` rejects at creation any strike that would.


```solidity
function toConsideration(uint256 amount, bool round) public pure returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral units.|
|`round`|`bool`| `true` rounds UP, `false` floors. UP for collections from users ([exercise](#receipt)), DOWN for payouts to users (the consideration leg of [_redeem](#receipt)) — inverting that pairing is what would let the pool run short. See the Rounding section on the contract.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Consideration units, in the consideration token's own decimals.|


#### toCollateral(uint256 consAmount)

Convert a consideration amount to the matching collateral-denominated receipt count.

Floors by design. No longer used internally — `_redeem` now tracks cons-backed
receipt-units via the `consBacked` counter — but exposed for off-chain
indexers and invariant tests that need the inverse of [toConsideration](#receipt).


```solidity
function toCollateral(uint256 consAmount) public pure returns (uint256);
```

#### name()

Human-readable token name in the form `RCT[E]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `RCTE-` prefix flags European options, `RCT-` American — note this differs from
`Option.name`, which spells its flavours `OPTE-` / `OPTA-`.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form.
`strike` is non-zero for every option `Factory` can create, so the division is safe.


```solidity
function name() public view override returns (string memory);
```

#### symbol()

Same as [name](#receipt). Matching name/symbol keeps wallets and explorers in sync.


```solidity
function symbol() public view override returns (string memory);
```

#### constructor

Template constructor. Never called for user-facing instances; clones are produced
by `ClonesWithImmutableArgs.clone(template, args)` and never delegate the
constructor. `factory` is captured from the deployer (the Factory that deployed
the template) so every clone-via-delegatecall reads the same FACTORY immutable.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```

#### mint(address account, uint256 amount)

Mint `amount` Receipt tokens to `account`, pulling the matching amount of
underlying collateral via the factory (against `account`'s ERC-20 allowance to it).

Only callable by the paired `Option` contract, and trusts Option's own gating: every
route in (direct `mint`, the operator `mint(address,uint256)`, and the auto-mint branch
of `Option._settledTransfer`) funnels through `Option.mint_`, which carries `notExpired`
and `nonZero`. So no receipt is ever minted at or after `expirationDate`, and Receipt
re-checks neither the clock nor the caller's authority to spend `account`'s allowance.


```solidity
function mint(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of the newly-minted Receipt tokens, and the address the collateral is pulled from — never the Option-level caller.|
|`amount`|`uint256`| Collateral-denominated amount.|


#### burn(address account, uint256 amount)

Burn matched Option + Receipt pair, return collateral. Only callable by Option.

Trusts Option's own gating: `Option.burn(address,uint256)` carries `beforeDeadline`
directly, and the auto-burn leg of `Option._settledTransfer` inherits it from the
`transfer` / `transferFrom` that reached it — so both are open up to and including
`exerciseDeadline`. Once `block.timestamp > exerciseDeadline` no caller can reach this
function and every short-side exit must go through [_redeem](#receipt). Option burns its own side
first, so the pair stays matched; Receipt checks nothing beyond the caller's identity.


```solidity
function burn(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Holder whose receipts are burned, and recipient of the collateral — never the Option-level caller, so a `Perm.BURN` operator cannot redirect the proceeds.|
|`amount`|`uint256`| Amount of Receipt tokens to burn.|


#### exercise(address account, uint256 amount)

Exercise path invoked by Option. `account` both pays the consideration and receives
the collateral — the two sides are coupled at this boundary so Receipt never has to
settle "pay-for-someone-else" semantics.

Trusts Option's own gating: both `exerciseFor` overloads carry `canExercise` (European
reverts before `expirationDate`, both flavours revert past `exerciseDeadline`) and both
check `Perm.EXERCISE` in the holder's row before calling, so Receipt re-checks neither
the clock nor the authorisation. The `consAmount == 0` guard is belt-and-braces — ceil
rounding turns any `amount > 0` into at least one consideration atom, and Option already
rejects `amount == 0` — but note the asymmetry: [_redeem](#receipt) has no such guard on its
floor-rounded payout, and settles dust for nothing rather than reverting.


```solidity
function exercise(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The address paying consideration and receiving collateral: Option's `msg.sender`, which for a keeper call is NOT the holder whose long tokens were burned.|
|`amount`|`uint256`| Collateral units to deliver; consideration collected is `ceil(amount * strike)`, and `consBacked` rises by `amount` (receipt units, not consideration units).|


#### redeem()
The queue is keyed on a current receipt balance and nothing else — receipts carry no
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
strike within the option's remaining life — and since early exercise is only rational
close to expiry, that remaining life is usually short and the swing correspondingly
small.
**The mitigation is proactive redemption, and it is available to you at all times.**
You already hold receipts, so you are ahead of anyone who must mint first. If spot
weakens back through the strike after an exercise, redeem — that is precisely the
"buy to close at strike" trade this leg exists to give you, and taking it both locks
in your settled cash and empties the pool a latecomer would otherwise draw on.
Writers who intend to manage a position rather than hold it passively should monitor
`consBacked` and redeem when the consideration leg is the leg they want.


```solidity
function redeem() public nonReentrant;
```

#### redeem(uint256 amount)

Redeem `amount` of the caller's Receipt. Same semantics as [redeem](#receipt), dust rule included.


```solidity
function redeem(uint256 amount) public nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Receipt units to redeem. Reverts `ERC20InsufficientBalance` above the caller's balance — there is no implicit cap to it.|


#### sweep(address token, address to)

Sweep any residual `token` balance held by this Receipt to `to`. Callable only by
the factory owner, and only once every receipt has been burned (`totalSupply == 0`),
so this can never short the redemption pool — it strictly cleans up rounding
residue, post-redemption donations, or stray ERC20s sent here by accident.

`totalSupply() == 0` is the whole guarantee, and it is stronger than it looks: the
solvency identity makes `consBacked <= totalSupply()`, so an empty supply also means
nothing is cons-backed and no holder has a claim on either pool. Everything left is
unowned.
Two consequences worth planning for. First, this is the one path that moves a token
other than the pair's own two, and it reports the move as [Redeemed](#receipt) — see that event.
Second, the authority is the factory owner *at call time*: `Ownable.renounceOwnership`
on the `Factory` sets the owner to `address(0)`, and since no call can arrive from that
address, every sweepable balance in every Receipt this factory ever created is stranded
permanently. Renouncing is a decision about this function, not just about the factory.


```solidity
function sweep(address token, address to) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`|ERC20 to drain. Typically the option's collateral or consideration, but any token is accepted; a `token` this contract holds none of is a no-op (no event).|
|`to`|`address`|   Recipient of the swept balance. Chosen by the factory owner; must be non-zero.|


#### redeemFor(address[] calldata holders)

Keeper-triggered batch redeem. For each holder where the caller holds `Perm.REDEEM`
in the holder's factory permission mask (or `msg.sender == holder`), the
holder's full balance is redeemed under [redeem](#receipt) semantics (cons-first; mix only
post-window). The resulting collateral / consideration go to the **holder** —
never to the caller. Unauthorised and zero-balance holders are skipped silently
so a single stale entry doesn't brick the batch.
Composability-safe by design: a Receipt held inside an ERC4626 vault, Morpho
market, or multisig CANNOT be force-*redeemed* by an unauthorised third party
(the previous permissionless `redeem(address)` variants were removed for exactly
this reason — they let any caller change a vault's collateral balance out from
under it). The auto-burn leg of `Option._settledTransfer` upholds the same principle
for *triggering*: it fires only when the receiver has granted `Perm.BURN` to the
account that **initiated** the transfer (`msg.sender`, not necessarily the token
sender `from`), so an unauthorised party cannot start an unwind of a held position.
**It does not control the size.** The guard decides *whether* auto-burn fires; the
amount is `Math.min(receipt.balanceOf(to), value)`, and `balanceOf` here is a plain
ERC-20 balance that ANY address can increase by transferring Receipt tokens to `to` —
this contract has no transfer restriction and no opt-out for unsolicited shorts. A
stranger can therefore donate shorts to a vault so that the vault's next *authorised*
inbound Option transfer is fully netted: the vault receives collateral instead of the
long tokens, at a size the stranger chose. Integrators must NOT assume an inbound
`Option` transfer raises their option balance by the amount transferred; read the
balance back.
**Reverts are NOT contained.** Only unauthorised and zero-balance holders are skipped.
Anything that makes `_redeem` itself revert — [ExerciseWindowOpen](#receipt) when the consideration
pool is empty pre-window, [BeforeExerciseWindow](#receipt) on a European option, or the defensive
[InsufficientPool](#receipt) — aborts the WHOLE batch and rolls back the holders already
processed. Because the cons leg is FCFS, the pool empties partway down any long list, so
a pre-window batch reverting is the ordinary outcome rather than an edge case. Callers
should size batches accordingly, or call [redeem](#receipt) per holder if partial progress matters.
Dust is not skipped, and is the one way this can destroy value: a holder whose balance
converts to zero consideration is burned for no payout, exactly as in [redeem](#receipt). A keeper
sweeping a long holder list pre-window will do that to every dust holder on it.
A repeated holder redeems their full balance on the first occurrence; post-window the
later occurrences hit the zero-balance skip. Pre-window the cons leg caps at
`consBacked` and can leave a remainder, so a repeat may still redeem again there.


```solidity
function redeemFor(address[] calldata holders) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holders`|`address[]`|Holders whose receipts to redeem in full.|




</details>

<details>
<summary>Events & Errors</summary>

#### Redeemed
Emitted on every path that pays tokens OUT of this contract except [exercise](#receipt), whose
collateral delivery is reported by `Option.Exercise` instead: [burn](#receipt), both legs of
[_redeem](#receipt) (one event per leg, so a mixed redemption emits twice), and [sweep](#receipt).


```solidity
event Redeemed(address option, address token, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`option`|`address`|The paired Option contract.|
|`token`|`address`| The token actually transferred out. Usually `collateral` or `consideration`, but [sweep](#receipt) takes an arbitrary ERC20 and emits this event for it, so an indexer must read this field rather than assume the pair's two tokens — a swept stray token will otherwise be mis-parsed as a redemption in collateral or consideration.|
|`holder`|`address`|Recipient of the payout: the redeeming/burning holder, or [sweep](#receipt)'s `to`, which is chosen by the factory owner and need not have held anything.|
|`amount`|`uint256`|Token units sent, in `token`'s own decimals.|

#### UnauthorizedCaller
Thrown when a privileged path is called by anyone other than the paired `Option`.


```solidity
error UnauthorizedCaller();
```

#### ContractExpired
Never thrown by Receipt itself — the pre-expiry mint gate is enforced by the paired
`Option` (`notExpired` on `mint_`). Declared for ABI/tooling parity.


```solidity
error ContractExpired();
```

#### ZeroValue
Thrown on `amount == 0` (or any derived zero-amount the invariant requires to be positive).


```solidity
error ZeroValue();
```

#### ExerciseWindowClosed
Never thrown by Receipt itself — the exercise-deadline gate is enforced by the
paired `Option` (`canExercise` / `beforeDeadline`). Declared for ABI/tooling parity.


```solidity
error ExerciseWindowClosed();
```

#### ExerciseWindowOpen
Thrown when a post-window-only path is called before the window closes.


```solidity
error ExerciseWindowOpen();
```

#### BeforeExerciseWindow
Thrown when short-side redemption is attempted on a European option before its
exercise window opens (`block.timestamp < expirationDate`). Mirrors the long-side
European pre-expiry guard so the revert reason states the schedule explicitly.


```solidity
error BeforeExerciseWindow();
```

#### OutstandingReceipts
Thrown when [sweep](#receipt) is called while receipts are still outstanding.


```solidity
error OutstandingReceipts();
```

#### InsufficientPool
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


```solidity
error InsufficientPool();
```



</details>

## Factory

<details>
<summary>Functions</summary>

**Inherits:**
Ownable, ReentrancyGuardTransient, IERC20Errors

**Title:**
Factory — deployer, transfer hub, permission registry

**Author:**
Greek.fi

The only on-chain contract users need to interact with to *create* options. Once deployed,
every Option + Receipt pair runs off pre-compiled template clones, so creation is
cheap and the factory is never an upgradeable rug vector (the templates are immutable).
The factory also plays two lasting roles post-creation:
1. **Single allowance point.** Users `approve(factory, amount)` on the *token* once
(standard ERC-20 approval), and every `Receipt` this factory created pulls against that
same allowance via [transferFrom](#factory) — collateral on mint, consideration on exercise. No
need to approve every new option individually. The flip side: that allowance is one
shared pot reachable by every market this factory has created or ever will create, so
size it accordingly (see `Perm` for how a permission grant turns it into a permit).
2. **Permission registry.** [setPermissions](#factory) / [addPermissions](#factory) maintain a per-
(owner, operator) bitmask of `Perm` flags — TRANSFER, MINT, BURN, REDEEM, EXERCISE —
covering every option this factory has created. One row replaces the ERC-1155-style
"setApprovalForAll" plus per-action allowances. The self entry
`permissions[account][account]` holds the account's own auto-mint opt-in
(MINT = auto-mint on transfer shortfall). Auto-burn is keyed on the *receiver's* BURN
grant to whoever initiated the transfer, so the self entry reaches it only where the
receiver is also the initiator — see `Perm`.
#### Exercise window
There is no oracle. Settlement is purely time-gated:
- `isEuro = false` (American) — exercise allowed from creation through `exerciseDeadline`.
- `isEuro = true`  (European) — exercise allowed only between `expirationDate` and
`exerciseDeadline`.
`windowSeconds` on `CreateParams` sets how long after expiration the window stays open;
it is taken literally — the contract NEVER substitutes a default. American options may
pass `0` for "no post-expiry extension" (window collapses to `expirationDate`).
European options must pass `windowSeconds > 0` (else [InvalidValue](#factory)). The deadline is
INCLUSIVE: exercise at `block.timestamp == exerciseDeadline` still succeeds. Past it,
exercise reverts for both flavours and the only long-side action left is `Option.expire`,
a cleanup burn of now-worthless longs.
Short-side exit is NOT gated on that same boundary, and is never pro-rata. `Receipt.redeem`
pays the consideration leg first-come-first-served whenever the pool can fund it (American:
at any time; European: from `expirationDate` onward); only the collateral leg waits for
`block.timestamp > exerciseDeadline`. Redemption *order* therefore decides which asset a
writer ends up holding — see `Receipt.redeem`.
`DEFAULT_EXERCISE_WINDOW` is an informational constant the frontend may use as a suggested
default; the contract does not consult it.
#### Supported tokens (IMPORTANT)
Collateral and consideration MUST be standard ERC-20 tokens with **exact, balance-preserving
transfers**. The protocol tracks balances 1:1 internally; any token whose `balanceOf` can
diverge from the amounts actually moved will corrupt that accounting (deposits, redemptions,
share/conversion math, and the solvency invariant). Non-standard mechanics are NOT supported:
- **Fee-on-transfer** (a cut is skimmed on transfer) — actively rejected: [transferFrom](#factory)
checks the delivered balance delta and reverts [FeeOnTransferNotSupported](#factory) when a pull
lands short, so options on such tokens cannot be minted or exercised.
- **Rebasing / elastic-supply** (balances change with no transfer) — NOT detectable on-chain
and NOT supported: the collateral/consideration held by a `Receipt` can silently drift
from the recorded amounts, breaking redemption and solvency. There is no on-chain guard;
such tokens must simply not be used.
- **Tokens whose transfers can stop working** (pausable, blocklist/blacklist, or any token
that becomes non-transferable after some date) — NOT supported, and there is no rescue.
Every exit path (`burn`, `exercise`, `redeem`) ends in a `safeTransfer`, so if either leg
becomes non-transferable the pair's funds are stuck permanently; `Receipt.sweep` cannot
help, because it requires `totalSupply() == 0` and that requires the very redemptions
that are now reverting. Note the consideration leg is redeemed FIRST, so a frozen
consideration* token also blocks withdrawal of perfectly good collateral.
Concretely: **a Greek `Option` token is not valid collateral** for another Greek option —
`Option.transfer` reverts permanently once its own `exerciseDeadline` passes.
Creation is permissionless and cannot inspect transfer semantics, so the token pair is the
creator's responsibility: do NOT create an option whose collateral or consideration has any
of the behaviours above — its accounting will not operate correctly — and frontends MUST
surface that at creation time.
#### What creation actually validates
[createOption](#factory) / [createOption2](#factory) enforce exactly these, and nothing more:
1. `collateral != consideration` — else [InvalidTokens](#factory).
2. Neither token is `address(0)` — else [InvalidAddress](#factory).
3. `strike != 0` — else [InvalidValue](#factory).
4. `expirationDate > block.timestamp` — else [InvalidValue](#factory).
5. `isEuro` ⇒ `windowSeconds > 0` — else [InvalidValue](#factory).
6. Both tokens answer `decimals()` with a value `<= 36` — else [InvalidValue](#factory).
7. When `consDec > collDec`: `strike <= type(uint256).max / 10**(consDec - collDec)` — else
[InvalidValue](#factory). This is the one that surprises people: it silently couples the maximum
strike to the *decimals gap*, so a wide-gap pair (say 6-decimal collateral against
18-decimal consideration) rejects strikes an 18/18 pair accepts. Frontends should compute
the bound and validate against it rather than let the revert land on the user.
Everything else — transfer semantics, liquidity, whether the strike is economically sane —
is out of scope for the contract.


#### RECEIPT_CLONE
Template Receipt contract. Per-option instances are clones-with-immutable-args of this
— an EIP-1167-style proxy with the pair's economic params appended to its runtime code,
so its init code (and CREATE2 address) differs per option. See [receiptInitCodeHash](#factory).


```solidity
address public immutable RECEIPT_CLONE
```


#### OPTION_CLONE
Template Option contract; per-option instances are bare EIP-1167 clones of this, with no
immutable args — every economic getter forwards to the paired Receipt.


```solidity
address public immutable OPTION_CLONE
```


#### DEFAULT_EXERCISE_WINDOW
Informational suggested-default for the post-expiry exercise window. The contract
NEVER substitutes this value — `CreateParams.windowSeconds` is taken literally.
Exposed so frontends can read a canonical "8 hours" without hardcoding it.


```solidity
uint40 public constant DEFAULT_EXERCISE_WINDOW = 8 hours
```


#### receipts
`true` if the address is a Receipt clone this factory created. Doubles as the auth
gate for [transferFrom](#factory) — only registered Receipts can pull collateral/consideration.
Validate an Option by reading its `receipt()` and confirming
`factory.receipts(rec) && Receipt(rec).option() == opt`.


```solidity
mapping(address => bool) public receipts
```


#### optionFor
Canonical Option address for a given set of economic params, keyed by [optionKey](#factory).
`address(0)` means no option with those params exists yet. [createOption](#factory) is
get-or-create: a second call with economically-identical params returns the existing
Option instead of deploying a duplicate, so identical markets stay canonical/deduped
and existence is queryable on-chain. [createOption2](#factory) deduplicates the same way but is
strict about it — with a non-zero salt a registry hit reverts [OptionExists](#factory) rather
than returning an address the caller did not mine.
Write-once: an entry is never cleared or overwritten, so the canonical address for a
given key is fixed for the life of the factory.


```solidity
mapping(bytes32 => address) public optionFor
```


#### permissions
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


```solidity
mapping(address => mapping(address => uint256)) public permissions
```


#### optionInitCodeHash()

`keccak256` of the Option clone's CREATE2 init code — the value to mine `optionSalt`
against for [createOption2](#factory).

The Option clone is a bare EIP-1167 proxy over `OPTION_CLONE` with no immutable args
(it carries no economic params of its own — every getter forwards to its Receipt), so
this hash does not depend on `CreateParams` and takes no arguments.
Off-chain: `address = keccak256(0xff ‖ factory ‖ salt ‖ optionInitCodeHash)[12:]`.


```solidity
function optionInitCodeHash() public view returns (bytes32);
```

#### receiptInitCodeHash(CreateParams memory p, address option_)

`keccak256` of the Receipt clone's CREATE2 init code — the value to mine `receiptSalt`
against for [createOption2](#factory).

Unlike [optionInitCodeHash](#factory) this is NOT constant: the Receipt's immutable args bake in
`option_` plus every economic param, so it must be recomputed per option and can only be
derived once the Option's address is known (i.e. after `optionSalt` is mined — pass
`addressOfOption2(optionSalt)`). Reads `decimals()` from both tokens, hence `view`.


```solidity
function receiptInitCodeHash(CreateParams memory p, address option_) public view returns (bytes32);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|      The params the option will be created with.|
|`option_`|`address`|The Option address that `optionSalt` resolves to.|


#### addressOfOption2(bytes32 salt)

Address the Option clone will land at for `salt` under [createOption2](#factory).


```solidity
function addressOfOption2(bytes32 salt) public view returns (address);
```

#### addressOfReceipt2(CreateParams memory p, address option_, bytes32 salt)

Address the Receipt clone will land at for `salt` under [createOption2](#factory), given the
Option address `option_` that the Option salt resolves to.


```solidity
function addressOfReceipt2(CreateParams memory p, address option_, bytes32 salt) public view returns (address);
```

#### optionKey(CreateParams memory p)

Deterministic registry key for a set of economic params. All seven `CreateParams`
fields are economic identity, so every one is folded into the hash — two params that
differ in any field produce different keys (and therefore distinct option markets).

`public pure` so off-chain callers and tests can compute the key and look up
`optionFor` without a creation tx.


```solidity
function optionKey(CreateParams memory p) public pure returns (bytes32);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|The `CreateParams` to key.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes32`|The `keccak256` registry key.|


#### constructor

Deploys the Option and Receipt templates internally so they record this factory
as their immutable `factory` (used to gate `init` and skip per-clone storage).

The deployer becomes `Ownable` owner. That role's only reach into the protocol is
`Receipt.sweep`, which drains a Receipt's residual balances and is itself gated on
`totalSupply() == 0` — so ownership cannot touch a live position or a funded pool.


```solidity
constructor() Ownable(msg.sender);
```

#### createOption(CreateParams memory p)

Deploy a new Option + Receipt pair. Emits [OptionCreated](#factory).

Option is an EIP-1167 clone; Receipt is a clone-with-immutable-args (per-option
strike, decimals, dates, etc. baked into the clone's runtime bytecode).
⚠ `collateral` and `consideration` MUST be standard ERC-20 tokens with exact,
balance-preserving transfers. Fee-on-transfer and rebasing / elastic-supply tokens are
NOT supported and will corrupt the option's 1:1 accounting (see the contract-level
"Supported tokens" note). There is no creation-time guard against this — the caller is
responsible for only pairing standard tokens.


```solidity
function createOption(CreateParams memory p) public nonReentrant nonZero(p.strike) returns (address option_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|See `CreateParams`: - `collateral`, `consideration`: ERC20 addresses; must differ. Standard ERC-20 only — no fee-on-transfer or rebasing tokens. - `expirationDate`: unix timestamp; must be strictly greater than `block.timestamp`. - `strike`: 18-decimal fixed point (consideration per collateral, inverted for puts). Must be non-zero, and when `consDec > collDec` must also satisfy the GRK-3 bound `strike <= type(uint256).max / 10**(consDec - collDec)`. - `isPut`: option flavour. - `isEuro`: `true` for European (no pre-expiry exercise), `false` for American. - `windowSeconds`: post-expiry exercise window length in seconds; taken literally (no contract-side default). American allows `0` (no extension); European requires `> 0`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`option_`|`address`|The canonical `Option` address — either freshly deployed, or the existing option if an economically-identical one already exists (get-or-create; see `optionFor`).|


#### createOption2(CreateParams memory p, bytes32 optionSalt, bytes32 receiptSalt)

CREATE2 variant of [createOption](#factory): deploys the Option and Receipt clones at addresses
derived from caller-supplied salts, so both can be mined off-chain for a vanity prefix
(e.g. an Option at `0x0000…` and its Receipt at `0xffff…`).

Naming mirrors the `clone` / `clone2` convention of the underlying clone library.
Identical to [createOption](#factory) except for the deploy opcode and the strictness a non-zero
salt adds on a registry hit (below) — same validation, same registry, same event, same
`Option.init` wiring. With two zero salts the two functions are indistinguishable.
**Mine `optionSalt` first, then `receiptSalt` — the order is forced.** The Receipt's
immutable args embed the Option's address, so the Receipt's init code (and therefore its
address) depends on where the Option landed. The reverse is not true: the Option reaches
its Receipt through a storage pointer set by `Option.init`, which cannot affect the
Option's own address. The two searches cannot be parallelised.
Off-chain, mine against [optionInitCodeHash](#factory) then [receiptInitCodeHash](#factory); both are plain
`keccak256(0xff ‖ factory ‖ salt ‖ initCodeHash)` searches over a fixed 85-byte preimage,
where only the 32 salt bytes change per attempt. Budget roughly 16^n attempts for an
n-hex-char prefix (~84k for 4 chars — well under a second in a browser).
**Supplying a salt makes this call STRICT.** Get-or-create still deduplicates markets,
but it will never silently hand back an address you did not mine. If an economically-
identical Option already exists and `optionSalt` does not resolve to it, the call reverts
[OptionExists](#factory); any non-zero `receiptSalt` against an existing Option reverts likewise.
So with a non-zero `optionSalt` this function either returns [addressOfOption2](#factory)`(optionSalt)`
or reverts — never anything else. To take the canonical Option instead, pass zero salts
(or call [createOption](#factory)); that path is unchanged. Check `optionFor`/[optionKey](#factory) before
spending time mining.
**Salts are a first-come-first-served global namespace.** A salt already used against the
same template (by anyone) reverts the deploy — the address is occupied. Re-mine and retry.
Salts are NOT namespaced by `msg.sender`, so anyone can burn a mined `optionSalt` by
creating a *different* market with it (the Option clone's init code is param-independent);
that forces a re-mine, and it is loud. A front-runner on the *same* params cannot silently
take your address either — see the strictness note above.
⚠ **Mine BOTH salts or neither.** With `optionSalt == 0` the Option lands via plain CREATE
at the factory's next nonce, which any unrelated creation in an earlier transaction shifts
— and since the Receipt's init code embeds the Option address, a mined `receiptSalt` then
silently lands elsewhere. That combination cannot be made strict on-chain; it is supported
only for callers who control transaction ordering.
**A zero salt means "don't mine this one".** `bytes32(0)` is a sentinel selecting plain
CREATE for that clone, exactly as [createOption](#factory) would. The two salts are independent, so
all four combinations are valid — vanity both, vanity neither (identical to
[createOption](#factory)), or vanity just the Option / just the Receipt. This costs you the ability
to use `bytes32(0)` as a real CREATE2 salt; that is a deliberate trade, since a mined
vanity salt is effectively random and will never be zero.


```solidity
function createOption2(CreateParams memory p, bytes32 optionSalt, bytes32 receiptSalt)
    public
    nonReentrant
    nonZero(p.strike)
    returns (address option_);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`p`|`CreateParams`|          See `CreateParams` — identical semantics to [createOption](#factory).|
|`optionSalt`|`bytes32`| CREATE2 salt for the Option clone, or `bytes32(0)` for plain CREATE. Mine against [optionInitCodeHash](#factory).|
|`receiptSalt`|`bytes32`|CREATE2 salt for the Receipt clone, or `bytes32(0)` for plain CREATE. Mine against [receiptInitCodeHash](#factory), which requires the Option address implied by `optionSalt`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`option_`|`address`|The canonical `Option` address. With both salts zero: freshly deployed, or the pre-existing economically-identical option (exactly [createOption](#factory)). With a non-zero `optionSalt`: always [addressOfOption2](#factory)`(optionSalt)` — freshly deployed there, or the pre-existing option when it already sits at that address — otherwise the call reverts [OptionExists](#factory). A non-zero `receiptSalt` against a pre-existing option always reverts.|


#### createOptions(CreateParams[] memory params)

Batch form of [createOption](#factory). Same ordering in → same ordering out.

Each entry is a full [createOption](#factory) call, so get-or-create applies per entry: an entry
naming an existing market yields that market's address and deploys nothing. Entries are
not isolated — one invalid entry reverts the whole batch, including entries already
processed.


```solidity
function createOptions(CreateParams[] memory params) external returns (address[] memory result);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`params`|`CreateParams[]`|Array of `CreateParams`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`result`|`address[]`|Option addresses aligned with `params` — newly deployed or pre-existing.|


#### createOptions2(CreateParams[] memory params, bytes32[] memory optionSalts, bytes32[] memory receiptSalts)

Batch form of [createOption2](#factory). Same ordering in → same ordering out.

Salt arrays are positional and must be the same length as `params` (else [InvalidValue](#factory)).
Mine each pair independently: within one batch, entry `i`'s Receipt salt depends only on
entry `i`'s Option address, not on any other entry.
Zero salts fall back to plain CREATE per-clone (see [createOption2](#factory)), so a single batch
can freely mix mined and unmined entries — pass `bytes32(0)` for any clone you don't want
a vanity address for, and that entry behaves exactly like [createOption](#factory).
**Strictness is per entry, failure is not.** Every entry carries [createOption2](#factory)'s full
strictness: a non-zero salt on an entry whose market already exists reverts
[OptionExists](#factory). That revert is NOT contained — it rolls back the WHOLE batch, including
entries already deployed earlier in the loop, so a single stale entry costs the entire
transaction (the mined salts survive; nothing was consumed). Check `optionFor` against
[optionKey](#factory) for every entry before submitting a large batch.


```solidity
function createOptions2(CreateParams[] memory params, bytes32[] memory optionSalts, bytes32[] memory receiptSalts)
    external
    returns (address[] memory result);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`params`|`CreateParams[]`|      Array of `CreateParams`.|
|`optionSalts`|`bytes32[]`| Option-clone CREATE2 salts, aligned with `params`.|
|`receiptSalts`|`bytes32[]`|Receipt-clone CREATE2 salts, aligned with `params`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`result`|`address[]`|Option addresses aligned with `params` — newly deployed or pre-existing.|


#### transferFrom(address from, address to, uint256 amount, address token)

Pull `amount` of `token` from `from` to `to`. Only callable by Receipt clones that this
factory has created — any other caller reverts [InvalidAddress](#factory).

Authorisation and accounting ride entirely on the underlying ERC-20 allowance:
`from` grants `token.approve(factory, amount)` once and every Receipt clone this
factory created can pull against it (gated here by the `receipts[]` registry).
`safeTransferFrom` decrements that allowance normally (or leaves it untouched at
`type(uint256).max`). A balance-delta check rejects fee-on-transfer / short-delivery
tokens, which would otherwise corrupt the 1:1 collateral accounting.
The check is **short-delivery only** — `balanceOf(to) < balanceBefore + amount`, i.e.
`delivered < amount` — deliberately not an exact equality. An exact check is
grief-able: anything that lands even 1 wei in `to` between
the two `balanceOf` reads makes the delta exceed `amount` and reverts an entirely
honest pull, bricking every mint and exercise on the pair for as long as it can be
repeated. Accepting a surplus is safe because the surplus is inert — no payout is
computed from `balanceOf`, so an over-delivery is an untracked donation that the
accounting never distributes (it becomes `Receipt.sweep` residue), while the pull
itself still delivered the full `amount` the caller is about to credit.
Comparing against `balanceBefore + amount` rather than subtracting also means a
balance that *decreased* mid-call (a negative rebase) reverts with
[FeeOnTransferNotSupported](#factory) rather than an arithmetic panic.


```solidity
function transferFrom(address from, address to, uint256 amount, address token) external nonReentrant returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`from`|`address`|  Token owner.|
|`to`|`address`|    Recipient (typically the calling Receipt contract).|
|`amount`|`uint256`|Token amount to transfer.|
|`token`|`address`| Token to move.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|success Always `true` on success; reverts otherwise.|


#### setPermissions(address operator, uint256 mask)

Set `operator`'s permission mask over the caller's positions, overwriting any
previous mask. `0` revokes everything. Bits: `Perm.TRANSFER` (1), `Perm.MINT` (2),
`Perm.BURN` (4), `Perm.REDEEM` (8), `Perm.EXERCISE` (16) — see `Perm` for what each
bit authorises and its risk profile.

**Intended for audited swap / keeper / vault contracts.** Each bit is an independent
grant; nothing is implied by another bit. In particular:
- `MINT` lets the operator pull the caller's factory collateral allowance to mint
new positions — functionally a permit on collateral. Never grant to EOAs or
unaudited integrations.
- `EXERCISE` lets the operator burn the caller's options, pay the consideration and
keep the collateral — a withdrawal right over the caller's ITM value.
- `TRANSFER` is full custody of the caller's long positions: the operator can move
them to itself and exercise them as their own holder, taking the ITM value without
ever needing `EXERCISE`. Alongside `MINT` it also reaches auto-mint, so it is not
limited to balance the caller actually holds.
- `BURN` / `REDEEM` return their proceeds to the caller, but the operator picks the
moment — and for `REDEEM` the moment determines which leg the caller is settled
into, and can strand them in a naked long. Neither is risk-free. `BURN` also
authorises the auto-burn leg on transfers the operator initiates into the caller,
which closes even a **naked short** because the operator supplies the longs; grant
it only to contracts that do not let third parties pick a transfer's recipient.
`operator == msg.sender` is the **self entry**: `MINT` opts into auto-mint on
transfer shortfall; `BURN` opts into auto-burn only on transfers the caller both
receives and initiates, since that leg reads the receiver's grant to the initiator —
netting an inbound transfer from anyone else requires a `BURN` grant to that
initiator (see `Perm`). The other bits are meaningless on self (self action is
always allowed directly).


```solidity
function setPermissions(address operator, uint256 mask) external nonZeroAddr(operator);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address being granted (or, for the caller's own address, the automation opt-in).|
|`mask`|`uint256`|    Full replacement mask; must not contain bits outside `Perm.ALL`.|


#### addPermissions(address operator, uint256 mask)

OR `mask` into `operator`'s existing permission mask (adds bits, never removes).
Use [setPermissions](#factory) to remove bits or revoke outright.


```solidity
function addPermissions(address operator, uint256 mask) external nonZeroAddr(operator);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address being granted.|
|`mask`|`uint256`|    Bits to add; must not contain bits outside `Perm.ALL`.|




</details>

<details>
<summary>Events & Errors</summary>

#### OptionCreated
Emitted for every newly-created option. NOT emitted when get-or-create returns an
existing Option — a market's creation event fires exactly once, ever.


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

#### PermissionsUpdated
Emitted whenever `owner`'s permission mask for `operator` changes ([setPermissions](#factory)
[addPermissions](#factory)). `mask` is the full resulting mask, not a delta.


```solidity
event PermissionsUpdated(address indexed owner, address indexed operator, uint256 mask);
```

#### InvalidAddress
Thrown when a zero address is supplied where a real one is required (either token at
creation, `operator` in [setPermissions](#factory) / [addPermissions](#factory)) — and also by
[transferFrom](#factory) when the caller is not a Receipt this factory registered.


```solidity
error InvalidAddress();
```

#### InvalidTokens
Thrown when `collateral == consideration` (no real option pair).


```solidity
error InvalidTokens();
```

#### InvalidValue
Thrown when a value param is invalid: strike (zero, or over the GRK-3 decimals-gap
bound), expiration, window, a token's `decimals()` above 36, a salt array in
[createOptions2](#factory) whose length does not match `params`, or a permission mask carrying
bits outside `Perm.ALL`.


```solidity
error InvalidValue();
```

#### OptionExists
Thrown by [createOption2](#factory) / [createOptions2](#factory) when a CREATE2 salt was supplied but an
economically-identical Option already exists at an address that salt does not resolve
to. Carries the occupying address so the caller can either accept it (re-submit with
zero salts, or call [createOption](#factory)) or change the option's economic params. The mined
salt is NOT consumed by this revert — it stays usable on a different market.


```solidity
error OptionExists(address existing);
```

#### FeeOnTransferNotSupported
Thrown when a token's transferFrom delivers less than `amount` (fee-on-transfer / rebasing).


```solidity
error FeeOnTransferNotSupported();
```



</details>

## Perm

<details>
<summary>Functions</summary>

**Title:**
Perm — permission bit flags for the Factory's operator registry

**Author:**
Greek.fi

Each (owner, operator) pair in `Factory.permissions` carries a bitmask of these flags.
Grant with `Factory.setPermissions` (overwrite) or `Factory.addPermissions` (OR-in).
The **self entry** `permissions[account][account]` configures the account's own
transfer-time automation in `Option`:
- `MINT` on self  → auto-mint on transfer shortfall (pulls collateral via the
factory allowance to cover the missing balance). The auto-mint leg reads
`permissions[from][msg.sender]` — the **sender's** row — so the self entry is what applies
when you move your own tokens; a third party moving them reads their own grant instead.
This **removes the ERC-20 safety net**: a transfer larger than your balance no longer
reverts with `ERC20InsufficientBalance`, it silently opens a new short against your
collateral allowance. A fat-fingered amount becomes a position, not an error.
- `BURN` on self  → auto-burn on a transfer you both **receive and initiate**, when you
also hold the matching Receipt (pair-burns them back into collateral). The auto-burn leg
reads `permissions[to][msg.sender]` — the **receiver's** grant to whoever *initiated* the
transfer — so the self entry is reached only where those two are the same account: a
self-transfer, or a `transferFrom` that pulls options into `msg.sender`. On an ordinary
outbound transfer to a third party the recipient's row is consulted and your own self BURN
bit is never read, so it burns nothing. To have *inbound* options netted against your
short you grant `BURN` to each account whose transfers you want netted, and that grant
carries more power than it looks — see the `BURN` operator bullet below.
Neither self bit is a mere convenience flag, and note the self entry is read with the
same lookup as an operator grant, so setting `permissions[self][self]` is what enables
these; `setPermissions(self, Perm.ALL)` is **not** the harmless self-initialisation it
looks like. `TRANSFER`, `REDEEM` and `EXERCISE` really are no-ops on self — every site that
reads them goes through a `notAuthorized` helper that short-circuits on `operator == owner_`,
so acting on yourself was already allowed and the bit changes nothing. `MINT` and `BURN` are
the exception precisely because the two transfer-time legs bypass that helper and read the
mask directly, which is the only way an opt-in can be distinguished from self-action.
#### ⚠ EVERY BIT IS DANGEROUS — GRANT ONLY TO AUDITED, TRUSTED CONTRACTS
There is no "safe" bit in this table. Each one hands a third party real power over your
position, and several of them compose into more than the sum of their parts. Treat any
grant the way you would treat an unlimited ERC-20 approval: only to contracts you have
audited, and revoke with `Factory.setPermissions``(operator, 0)` when you are done.
#### The one-line version
token.approve(factory, X)  +  factory.addPermissions(actor, Perm.MINT)
==  token.approve(actor, X)
Read that as an identity, because it is one. Your token allowance to the factory is a
single shared pot that every option this factory has ever created — or ever will create —
can draw on. Handing an actor `MINT` hands that actor the pot. It does not matter that the
factory is the named spender: the actor decides when, in which market, and at what strike.
So the safe way to size a grant is to ask what you have approved to the factory, not what
you think the actor will do with it.
The same reading applies to the other bits with the *positions* those tokens became:
`TRANSFER` and `EXERCISE` are `approve(actor, yourLongs)`, and `BURN` and `REDEEM` hand the
actor the timing of your exit. If you would not write the `approve` on the right-hand side,
do not write the grant on the left.
Granted to a third-party operator:
- `TRANSFER` → move the owner's Option tokens without a per-option ERC20 allowance
(`Option.transferFrom` skips `_spendAllowance`). **This is full custody of the owner's
long positions.** The operator can move the longs to itself and then exercise them as
their own holder, capturing the entire in-the-money value — it does not need
`EXERCISE` to do so. Combined with `MINT` it also reaches the auto-mint branch, which
manufactures balance the owner never held out of their collateral allowance. Scope note:
this bit covers the *long* token only — `Receipt` is a plain ERC-20 with no permission
hook, so receipts always move under an ordinary allowance and never under this bit.
- `MINT`     → mint new positions against the owner's factory collateral allowance
(`Option.mint(address,uint256)` and the auto-mint branch of transfers). This IS a permit
on the owner's collateral: see the identity above. Paired with `TRANSFER`, `EXERCISE` or
`REDEEM` it is an unbounded drain of everything the owner has approved to the factory,
across every market that exists or will ever exist.
**`MINT` alone is not safe either, and one ordinary ERC-20 approval is enough to prove
it.** The auto-mint branch is reached whenever the operator moves more Option than the
owner holds — and to move it the operator needs only a plain `approve` on the *option*
token, which is not a `Perm` bit and is exactly what any router-shaped integration asks
for. `transferFrom(owner, operator, N)` against a zero balance then mints `N` out of the
owner's collateral allowance and delivers the longs to the operator. The owner is left
holding `N` receipts and no longs — a **naked short** they cannot pair-burn out of. The
collateral is not stolen outright, but it stops being theirs to withdraw: they carry the
assignment risk until settlement, and the only exit is `Receipt.redeem`, which pays
consideration first and returns collateral 1:1 only after `exerciseDeadline`. So
`MINT` + `approve` reaches the same place `MINT` + `TRANSFER` does, and the only grant
that appears on-chain is the one that looks harmless.
- `BURN`     → pair-burn the owner's matched Option+Receipt back into collateral
(`Option.burn(address,uint256)`), clean up expired longs (`Option.expire`), **and** net
any Option transfer the operator initiates *into* the owner against the owner's Receipt
balance (the auto-burn leg of `Option._settledTransfer`, keyed on
`permissions[to][msg.sender]`).
That third power reaches a position the first two cannot. `Option.burn(address,uint256)`
calls `_burn` on the *option* token first, so it reverts against a writer who has sold
their longs; the auto-burn leg has no such requirement, because the **operator supplies
the longs** and `Math.min(receiptBal, value)` closes the short at par. A `BURN` grantee
can therefore unwind a **naked short** that `Option.burn` cannot touch. In particular, an
account that deliberately left its self BURN bit unset but granted `BURN` to a keeper for
cleanup is auto-burnable by that keeper.
Collateral always returns to the owner, but the operator chooses *when* — it can
unwind a hedge at a moment of its choosing. Grant `BURN` only to contracts that do not
let third parties choose the recipient of an option transfer: a generic router or
multicall holding this bit re-opens the bystander-unwind that the per-sender scoping of
the auto-burn leg closes.
- `REDEEM`   → trigger redemption via `Receipt.redeemFor` under `Receipt.redeem` semantics
(consideration-first FCFS; the collateral leg only opens after `exerciseDeadline`),
whenever a redemption would succeed at all — European options not before `expirationDate`,
and a pre-window call needs a non-empty consideration pool. There is in particular **no
post-window restriction** on this bit. The payout always goes to the owner, but the
operator chooses the timing and therefore which leg the owner is settled into — and
settling the short leg of a matched position before `exerciseDeadline` leaves the owner
holding a naked long they can no longer pair-burn out of. A `REDEEM` grantee can also
destroy value outright, in one narrow case: a receipt balance that converts to zero
consideration is burned for no payout (see `Receipt.redeem` on dust), and `redeemFor`
does not skip it. This is a trusted-keeper mechanism: grant it to a keeper you have
instructed to collect your consideration on your behalf, not to an arbitrary address.
- `EXERCISE` → burn the owner's options via `Option.exerciseFor`: the operator pays
consideration and RECEIVES THE COLLATERAL. This is a withdrawal right over the owner's ITM
value — the most direct of the custody-grade bits, though not a worse one than `TRANSFER`,
which reaches the same value in two steps and without this bit.




</details>
