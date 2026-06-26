---
title: Option
sidebar_label: Option
sidebar_position: 1
slug: /api/option
---
# Option

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
| Mode      | `isEuro` | Pre-expiry exercise | In-window exercise | Post-window      |
| --------- | -------- | ------------------- | ------------------ | ---------------- |
| American  | `false`  | allowed             | allowed            | short pro-rata   |
| European  | `true`   | reverts             | allowed            | short pro-rata   |
The exercise window is `[expirationDate, exerciseDeadline)` where
`exerciseDeadline = expirationDate + windowSeconds` (default 8 hours, settable per
option). The holder decides off-chain whether ITM is profitable and pays strike to
exercise; the protocol just enforces timing and the 1:1 collateral invariant.
Pair `burn` (matched long+short burn) is available **pre-expiration only**: once the
option enters settlement, the only exits are `exercise` (window) and pro-rata `redeem`
(post-window).
## Auto-mint / auto-burn
Addresses that have opted in via `factory.enableAutoMintBurn(true)` get two
transfer-time conveniences:
- **Auto-mint** — if the sender tries to transfer more `Option` than they hold,
the contract pulls enough collateral from the sender and mints the deficit.
- **Auto-burn** — if the receiver already holds the matching `Receipt` ("short")
token, incoming `Option` is immediately burned pair-wise, returning collateral.
Both behaviours are opt-in per-account and make it possible to treat `Option` and
its underlying collateral as interchangeable for power users (e.g. vaults).
## Supported tokens
Standard ERC-20 collateral/consideration only, with exact, balance-preserving transfers.
Fee-on-transfer and rebasing / elastic-supply tokens are NOT supported — they break the
protocol's 1:1 accounting (deposits, exercise, redemption, solvency). See `Factory` and
`Receipt` for the full policy.

Deployed once as a template; the factory produces per-option instances via
EIP-1167 minimal proxy clones. `init()` is used instead of a constructor.


## FACTORY
Factory that created this option. Set in the template constructor (= the factory
that deployed it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable FACTORY
```


## receipt
Paired short-side ERC20 (collateral receipt) that holds the collateral and handles
settlement math. Doubles as the [init](/api/option) guard — non-zero means initialised.


```solidity
Receipt public receipt
```


## constructor

Template constructor. Never called for user-facing instances; each clone goes
through [init](/api/option) instead. Sets `receipt` to a non-zero sentinel so the template
itself fails the [init](/api/option) guard.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```

## init(address receipt_)

Initialises a freshly-cloned Option. Called exactly once by the factory.


```solidity
function init(address receipt_) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`receipt_`|`address`|Address of the paired `Receipt` contract — immutable for this option.|


## factory()

Address of the `Factory` that created this option. Read from the paired Receipt.


```solidity
function factory() public view returns (address);
```

## collateral()

Underlying collateral token (e.g. WETH for a WETH/USDC call).


```solidity
function collateral() public view returns (address);
```

## consideration()

Consideration / quote token (e.g. USDC for a WETH/USDC call).


```solidity
function consideration() public view returns (address);
```

## expirationDate()

Unix timestamp at which the option expires.


```solidity
function expirationDate() public view returns (uint40);
```

## exerciseDeadline()

Unix timestamp at which the post-expiry exercise window closes.


```solidity
function exerciseDeadline() public view returns (uint64);
```

## strike()

Strike price in 18-decimal fixed point, encoded as "consideration per collateral".

For puts, this stores the *inverse* of the human-readable strike (see [name](/api/option) for display).


```solidity
function strike() public view returns (uint256);
```

## isPut()

`true` if this is a put option; `false` for calls.


```solidity
function isPut() public view returns (bool);
```

## isEuro()

`true` for European-style options (exercise barred pre-expiry; only the post-expiry
window is exercisable). `false` for American (any time before `exerciseDeadline`).


```solidity
function isEuro() public view returns (bool);
```

## decimals()

Option token shares the collateral's decimals so 1 option token ↔ 1 collateral unit.


```solidity
function decimals() public view override returns (uint8);
```

## name()

Human-readable token name in the form `OPT[E/A]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `OPTE-` prefix flags European options, `OPTA-` flags American options.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form.


```solidity
function name() public view override returns (string memory);
```

## symbol()

Same as [name](/api/option). Matching name/symbol keeps wallets and explorers in sync.


```solidity
function symbol() public view override returns (string memory);
```

## mint(uint256 amount)

Mint `amount` option tokens to the caller, collateralised 1:1 with the underlying.


```solidity
function mint(uint256 amount) public nonReentrant;
```

## mint(address account, uint256 amount)

Mint `amount` option tokens to `account`. Collateral is pulled from `account` via
the factory's centralised allowance, so the caller must be `account` itself or a
factory-approved operator for `account` — otherwise any address holding a non-zero
factory allowance could be force-minted into unwanted positions.


```solidity
function mint(address account, uint256 amount) public nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of both `Option` and `Receipt` tokens. Pays the collateral.|
|`amount`|`uint256`| Collateral-denominated mint amount.|


## transfer(address to, uint256 amount)

Overridden to run the auto-mint / auto-burn hook. Reverts post-expiry —
the long token stops circulating once expiration passes.


```solidity
function transfer(address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

## transferFrom(address from, address to, uint256 amount)

Skips `_spendAllowance` when `msg.sender` is a factory-approved operator for `from`
(ERC-1155 style blanket approval across every option in the protocol).


```solidity
function transferFrom(address from, address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

## exercise()

Exercise all of the caller's own options: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to [exerciseFor](/api/option) with `holder = msg.sender`,
so msg.sender pays AND msg.sender receives (no dangerous asymmetry).


```solidity
function exercise() public;
```

## exercise(uint256 amount)

Exercise `amount` of the caller's own options: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to [exerciseFor](/api/option) with `holder = msg.sender`,
so msg.sender pays AND msg.sender receives (no dangerous asymmetry).


```solidity
function exercise(uint256 amount) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral units to receive. Consideration paid = `ceil(amount * strike)`.|


## settle(Option opt, address holder, uint256 amount, uint256 minSurplus)

**Dangerous keeper path** — burn `amount` of `holder`'s options; `msg.sender` pays
the consideration and receives the collateral. The holder gets nothing on-chain.
Use this only when:
(a) `msg.sender` is a contract that will deliver the holder's economic surplus
off-band (e.g. a flash-loan router that sells the collateral, repays the
flash loan with the consideration cost, and pays the holder the spread), or
(b) the holder explicitly intends to gift the exercise value to `msg.sender`.
Authorisation: `msg.sender` must be `holder` themselves or have been authorised
via `factory.allowExercise(msg.sender, true)`. **Authorising a non-trusted
exercisor is equivalent to giving them a withdrawal right over your ITM value.**
`factory.approveOperator` does NOT grant exercise rights — it gates ERC20
transfer of option tokens only.
Allowed any time exercise itself is allowed (pre-expiry for American, plus the
post-expiry window for both flavours).
Example (a) — flash-loan keeper that pays the holder the ITM spread:
```solidity
Keeper contract (audited, allowlisted off-chain). Holder authorises once:
factory.allowExercise(address(keeper), true);
contract FlashExerciseKeeper is IERC3156FlashBorrower {
function settle(Option opt, address holder, uint256 amount, uint256 minSurplus)
external
{
1. Flash-borrow `ceil(amount * strike)` of consideration from any provider
(Aave / Maker / Morpho). The callback is `onFlashLoan` below.
bytes memory cb = abi.encode(opt, holder, amount, minSurplus);
IReceipt r = IReceipt(opt.receipt());
IERC20 cons = r.consideration();
uint256 strikeCost = r.toConsideration(amount, true);
IERC3156FlashLender(lender).flashLoan(this, address(cons), strikeCost, cb);
}
function onFlashLoan(address, address, uint256 loaned, uint256 fee, bytes calldata data)
external returns (bytes32)
{
(Option opt, address holder, uint256 amount, uint256 minSurplus) =
abi.decode(data, (Option, address, uint256, uint256));
2. Approve the factory to pull the consideration we just borrowed.
IReceipt r = IReceipt(opt.receipt());
IERC20(r.consideration()).approve(factory, loaned);
factory.approve(address(r.consideration()), loaned);
3. Exercise on behalf of the holder. Collateral lands here.
opt.exerciseFor(holder, amount);
4. Swap collateral → consideration on a DEX (router omitted for brevity).
uint256 proceeds = dex.swapExactIn(address(r.collateral()), address(r.consideration()), amount);
5. Repay the flash loan + fee.
IERC20(r.consideration()).approve(lender, loaned + fee);
6. Pay the holder the surplus on-chain. Enforce a floor so the holder is
never settled at a worse price than they asked for.
uint256 surplus = proceeds - loaned - fee;
if (surplus < minSurplus) revert SlippageExceeded();
IERC20(r.consideration()).transfer(holder, surplus);
return keccak256("ERC3156FlashBorrower.onFlashLoan");
}
}
```
The holder bears no smart-contract risk beyond trusting `FlashExerciseKeeper` not
to revert on step 6 — which is why `allowExercise` should only ever be granted to
a deployed, audited keeper address, never an EOA.


```solidity
function exerciseFor(address holder, uint256 amount) public canExercise nonReentrant nonZero(amount) returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holder`|`address`|Option holder whose tokens will be burned.|
|`amount`|`uint256`|Collateral units to exercise.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|The amount of collateral units actually exercised (== `amount` on success).|


## exerciseFor(address[] calldata holders, uint256[] calldata amounts)

Batch variant of `exerciseFor(address,uint256)`. Same dangerous semantics — the
caller pays consideration and receives collateral for every holder. Exercises
`amounts[i]` of `holders[i]`. Entries that fail the per-holder allowance check or
carry a zero amount are skipped rather than reverting, so a stale or unauthorised
address in the holder list does not abort the sweep. An `amounts[i]` greater than the
holder's balance is also skipped (rather than reverting the whole call), so a holder
who has since reduced their balance cannot grief the sweep for everyone else.


```solidity
function exerciseFor(address[] calldata holders, uint256[] calldata amounts) external canExercise nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holders`|`address[]`|Option holders whose options will be exercised.|
|`amounts`|`uint256[]`|Per-holder collateral amounts to exercise; must align 1:1 with `holders`.|


## burn(uint256 amount)

Burn matched `Option` + `Receipt` pairs to recover the underlying collateral.

Available up to and including `exerciseDeadline` (boundary inclusive — same as
transfer/exercise). Pair-burn nets both sides 1:1 so it does not require the
exercise window to be closed. Once `block.timestamp > exerciseDeadline`, short-side
exits must route through `Receipt._redeem`. Caller must hold both sides in equal amount.


```solidity
function burn(uint256 amount) public nonReentrant nonZero(amount) beforeDeadline;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral-denominated amount to burn from each side.|


## expire(address holder, uint256 amount)

Burn expired long option tokens to clean up dust.

Only callable strictly after `exerciseDeadline`. Past the deadline an unexercised
long token is inert — it can no longer be exercised ([canExercise](/api/option)), transferred or
pair-burned ([beforeDeadline](/api/option)) — so it would otherwise sit in the holder's wallet
forever. This burns the long side only; it touches neither collateral nor the paired
`Receipt`, so it has no effect on the redemption pool or the solvency invariant
(short-side collateral is recovered separately via `Receipt.redeem`). Reverts with
`NotYetExpired` on or before the deadline — use [burn](/api/option) or [exercise](/api/option) while live.
Caller must be `holder` or authorised via `factory.allowExercise(holder, true)`
(reverts `Unauthorized` otherwise); unlike [exerciseFor](/api/option) this is harmless — the
tokens are already worthless, so a keeper gains nothing by burning them.


```solidity
function expire(address holder, uint256 amount) public nonReentrant nonZero(amount);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holder`|`address`|Address of the long option holder.|
|`amount`|`uint256`|Amount of long option tokens to burn.|


## balancesOf(address account)

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


## details()

Full option descriptor — addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.


```solidity
function details() public view returns (OptionInfo memory);
```

## Mint
Emitted when new options are minted against fresh collateral.


```solidity
event Mint(address longOption, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`holder`|`address`|     The account credited with the new tokens.|
|`amount`|`uint256`|     Collateral-denominated amount (same decimals as the collateral token).|

## Exercise
Emitted when an option is exercised.


```solidity
event Exercise(address longOption, address caller, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`caller`|`address`|     The account that initiated the exercise.|
|`holder`|`address`|     The account whose options were burned.|
|`amount`|`uint256`|     Collateral units delivered (consideration paid is `toConsideration(amount, true)`, ceil).|

## Expire
Emitted when a holder burns expired (post-deadline) long option tokens via [expire](/api/option).


```solidity
event Expire(address longOption, address caller, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`longOption`|`address`| The Option contract (always `address(this)`).|
|`caller`|`address`|     The account that initiated the expiration (always the holder).|
|`holder`|`address`|     The account whose options were burned (== `caller`).|
|`amount`|`uint256`|     Amount of options burned.|

## ContractExpired
Thrown when a call that requires a live option is made after expiration.


```solidity
error ContractExpired();
```

## ZeroValue
Thrown when `amount == 0`.


```solidity
error ZeroValue();
```

## InvalidValue
Thrown when batch `exerciseFor` is given `holders`/`amounts` arrays of unequal length.


```solidity
error InvalidValue();
```

## ExerciseWindowClosed
Thrown when exercise is attempted after `exerciseDeadline`.


```solidity
error ExerciseWindowClosed();
```

## InvalidExercise
Thrown when pre-expiry exercise is attempted on a European option.


```solidity
error InvalidExercise();
```

## AlreadyInitialized
Thrown when [init](/api/option) is called on a clone that has already been initialised, or on
the template (whose `receipt` is set to a sentinel by the constructor).


```solidity
error AlreadyInitialized();
```

## Unauthorized
Thrown when [init](/api/option) is called by anyone other than the factory.


```solidity
error Unauthorized();
```

## NotYetExpired
Thrown when [expire](/api/option) is called on or before `exerciseDeadline` (the option is still live).


```solidity
error NotYetExpired();
```


