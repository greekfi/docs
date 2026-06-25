---
title: API Reference
sidebar_label: API Reference
sidebar_position: 2
description: "Auto-generated per-contract reference rendered from NatSpec via forge doc."
---

# API Reference

Auto-generated from the NatSpec in `foundry/contracts/`. Edit the Solidity source and run
`yarn docs:gen` from the repo root to refresh this page.

## Core Contracts

### Option

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
##### Auto-mint / auto-burn
Addresses that have opted in via `factory.enableAutoMintBurn(true)` get two
transfer-time conveniences:
- **Auto-mint** — if the sender tries to transfer more `Option` than they hold,
the contract pulls enough collateral from the sender and mints the deficit.
- **Auto-burn** — if the receiver already holds the matching `Receipt` ("short")
token, incoming `Option` is immediately burned pair-wise, returning collateral.
Both behaviours are opt-in per-account and make it possible to treat `Option` and
its underlying collateral as interchangeable for power users (e.g. vaults).
##### Supported tokens
Standard ERC-20 collateral/consideration only, with exact, balance-preserving transfers.
Fee-on-transfer and rebasing / elastic-supply tokens are NOT supported — they break the
protocol's 1:1 accounting (deposits, exercise, redemption, solvency). See `Factory` and
`Receipt` for the full policy.

Deployed once as a template; the factory produces per-option instances via
EIP-1167 minimal proxy clones. `init()` is used instead of a constructor.


#### Constants
##### FACTORY
Factory that created this option. Set in the template constructor (= the factory
that deployed it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable FACTORY
```


#### State Variables
##### receipt
Paired short-side ERC20 (collateral receipt) that holds the collateral and handles
settlement math. Doubles as the [init](#init) guard — non-zero means initialised.


```solidity
Receipt public receipt
```


#### Functions
##### notExpired

Blocks `mint_` once the option has expired — no new options past expiration.


```solidity
modifier notExpired() ;
```

##### beforeDeadline

Blocks transfer paths once the exercise window has closed; the long token remains
circulating throughout the window so holders can still sell to keepers.
`block.timestamp == exerciseDeadline` is still IN-window — boundary is inclusive.


```solidity
modifier beforeDeadline() ;
```

##### canExercise

Gates exercise paths. European reverts pre-expiry with the specific reason; both
flavours revert with `ExerciseWindowClosed` past `exerciseDeadline`.


```solidity
modifier canExercise() ;
```

##### nonZero

Rejects zero-amount mutations to keep accounting clean and events meaningful.


```solidity
modifier nonZero(uint256 amount) ;
```

##### constructor

Template constructor. Never called for user-facing instances; each clone goes
through [init](#init) instead. Sets `receipt` to a non-zero sentinel so the template
itself fails the [init](#init) guard.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```

##### init

Initialises a freshly-cloned Option. Called exactly once by the factory.


```solidity
function init(address receipt_) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`receipt_`|`address`|Address of the paired `Receipt` contract — immutable for this option.|


##### factory

Address of the `Factory` that created this option. Read from the paired Receipt.


```solidity
function factory() public view returns (address);
```

##### collateral

Underlying collateral token (e.g. WETH for a WETH/USDC call).


```solidity
function collateral() public view returns (address);
```

##### consideration

Consideration / quote token (e.g. USDC for a WETH/USDC call).


```solidity
function consideration() public view returns (address);
```

##### expirationDate

Unix timestamp at which the option expires.


```solidity
function expirationDate() public view returns (uint40);
```

##### exerciseDeadline

Unix timestamp at which the post-expiry exercise window closes.


```solidity
function exerciseDeadline() public view returns (uint64);
```

##### strike

Strike price in 18-decimal fixed point, encoded as "consideration per collateral".

For puts, this stores the *inverse* of the human-readable strike (see [name](#name) for display).


```solidity
function strike() public view returns (uint256);
```

##### isPut

`true` if this is a put option; `false` for calls.


```solidity
function isPut() public view returns (bool);
```

##### isEuro

`true` for European-style options (exercise barred pre-expiry; only the post-expiry
window is exercisable). `false` for American (any time before `exerciseDeadline`).


```solidity
function isEuro() public view returns (bool);
```

##### decimals

Option token shares the collateral's decimals so 1 option token ↔ 1 collateral unit.


```solidity
function decimals() public view override returns (uint8);
```

##### name

Human-readable token name in the form `OPT[E/A]-<coll>-<cons>-<strike>-<YYYY-MM-DD>`.
The `OPTE-` prefix flags European options, `OPTA-` flags American options.

For puts the displayed strike is inverted back (`1e36 / strike`) to the human form.


```solidity
function name() public view override returns (string memory);
```

##### symbol

Same as [name](#name). Matching name/symbol keeps wallets and explorers in sync.


```solidity
function symbol() public view override returns (string memory);
```

##### mint

Mint `amount` option tokens to the caller, collateralised 1:1 with the underlying.


```solidity
function mint(uint256 amount) public nonReentrant;
```

##### mint

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


##### mint_

Internal mint path shared by `mint` and auto-mint-on-transfer.


```solidity
function mint_(address account, uint256 amount) internal notExpired nonZero(amount);
```

##### _settledTransfer

Auto-mint (sender) + auto-burn (receiver) hook around the underlying ERC20 transfer.
Both legs are gated on each party's `autoMintBurn` opt-in held on the factory.
Not an override of OZ's `_transfer` (which is non-virtual) — callable from the public
transfer paths only, so mint/burn don't trigger it.
**⚠ Operator-mint surface.** The auto-mint branch keys on `from`'s opt-in flag, not on
whether `msg.sender == from`. When `from` has both granted `factory.approveOperator`
to some operator AND opted into `factory.enableAutoMintBurn`, the operator can call
`Option.transferFrom(from, recipient, amount)` for an amount `from` doesn't currently
hold — auto-mint then pulls `from`'s factory collateral allowance to manufacture the
missing balance. Combined, the two grants are equivalent to a permit on `from`'s
collateral. The Factory NatSpec on `approveOperator` and `enableAutoMintBurn` warns
about this loudly; the surface lives here.


```solidity
function _settledTransfer(address from, address to, uint256 value) internal;
```

##### transfer

Overridden to run the auto-mint / auto-burn hook. Reverts post-expiry —
the long token stops circulating once expiration passes.


```solidity
function transfer(address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

##### transferFrom

Skips `_spendAllowance` when `msg.sender` is a factory-approved operator for `from`
(ERC-1155 style blanket approval across every option in the protocol).


```solidity
function transferFrom(address from, address to, uint256 amount) public override beforeDeadline nonReentrant returns (bool);
```

##### exercise

Exercise all of the caller's own options: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to [exerciseFor](#exercisefor) with `holder = msg.sender`,
so msg.sender pays AND msg.sender receives (no dangerous asymmetry).


```solidity
function exercise() public;
```

##### exercise

Exercise `amount` of the caller's own options: pay consideration, receive collateral.

Self-exercise — the safe path. Delegates to [exerciseFor](#exercisefor) with `holder = msg.sender`,
so msg.sender pays AND msg.sender receives (no dangerous asymmetry).


```solidity
function exercise(uint256 amount) public;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`amount`|`uint256`|Collateral units to receive. Consideration paid = `ceil(amount * strike)`.|


##### exerciseFor

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


##### exerciseFor

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


##### burn

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


##### expire

Burn expired long option tokens to clean up dust.

Only callable strictly after `exerciseDeadline`. Past the deadline an unexercised
long token is inert — it can no longer be exercised ([canExercise](#canexercise)), transferred or
pair-burned ([beforeDeadline](#beforedeadline)) — so it would otherwise sit in the holder's wallet
forever. This burns the long side only; it touches neither collateral nor the paired
`Receipt`, so it has no effect on the redemption pool or the solvency invariant
(short-side collateral is recovered separately via `Receipt.redeem`). Reverts with
`NotYetExpired` on or before the deadline — use [burn](#burn) or [exercise](#exercise) while live.
Caller must be `holder` or authorised via `factory.allowExercise(holder, true)`
(reverts `Unauthorized` otherwise); unlike [exerciseFor](#exercisefor) this is harmless — the
tokens are already worthless, so a keeper gains nothing by burning them.


```solidity
function expire(address holder, uint256 amount) public nonReentrant nonZero(amount);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holder`|`address`|Address of the long option holder.|
|`amount`|`uint256`|Amount of long option tokens to burn.|


##### balancesOf

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


##### details

Full option descriptor — addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.


```solidity
function details() public view returns (OptionInfo memory);
```

#### Events
##### Mint
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

##### Exercise
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

##### Expire
Emitted when a holder burns expired (post-deadline) long option tokens via [expire](#expire).


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

#### Errors
##### ContractExpired
Thrown when a call that requires a live option is made after expiration.


```solidity
error ContractExpired();
```

##### ZeroValue
Thrown when `amount == 0`.


```solidity
error ZeroValue();
```

##### InvalidValue
Thrown when batch `exerciseFor` is given `holders`/`amounts` arrays of unequal length.


```solidity
error InvalidValue();
```

##### ExerciseWindowClosed
Thrown when exercise is attempted after `exerciseDeadline`.


```solidity
error ExerciseWindowClosed();
```

##### InvalidExercise
Thrown when pre-expiry exercise is attempted on a European option.


```solidity
error InvalidExercise();
```

##### AlreadyInitialized
Thrown when [init](#init) is called on a clone that has already been initialised, or on
the template (whose `receipt` is set to a sentinel by the constructor).


```solidity
error AlreadyInitialized();
```

##### Unauthorized
Thrown when [init](#init) is called by anyone other than the factory.


```solidity
error Unauthorized();
```

##### NotYetExpired
Thrown when [expire](#expire) is called on or before `exerciseDeadline` (the option is still live).


```solidity
error NotYetExpired();
```



### Receipt

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
The exercise window closes for everyone at `exerciseDeadline = expirationDate + windowSeconds`.
Pair-redeem (`burn`, called by Option) stays available pre-deadline.
##### Rounding
- Collections from users (exercise): round UP (`toConsideration(amount, true)`).
- Payouts to users (redeem): round DOWN (floor).
##### Supported tokens
This contract physically holds every collateral and consideration token for the pair and
tracks them 1:1 against its accounting, so the collateral/consideration MUST be standard
ERC-20 tokens with exact, balance-preserving transfers. Fee-on-transfer and rebasing /
elastic-supply tokens are NOT supported: any drift between `balanceOf` and the recorded
amounts breaks the redemption math and the solvency invariant. Fee-on-transfer pulls are
rejected at `Factory.transferFrom`; rebasing is undetectable on-chain and must be avoided
at option-creation time. See `Factory` for the full token policy.

Deployed once as a template; per-option instances are clones produced by
`ClonesWithImmutableArgs`. Every per-option value (strike, collateral, consideration,
expirationDate, exerciseDeadline, isPut, isEuro, decimals, option) is appended to the
clone's runtime bytecode at deploy time and read via `Clone._getArg*` helpers
(CALLDATALOAD, ~3 gas). There is no `init` function — the clone is fully configured
the moment its bytecode is written.
##### Immutable args layout (packed, 112 bytes)
offset  0   strike            uint256  (32B)
offset 32   collateral        address  (20B)
offset 52   consideration     address  (20B)
offset 72   option            address  (20B)
offset 92   expirationDate    uint64   (8B, holds a uint40)
offset 100  exerciseDeadline  uint64   (8B, = expirationDate + windowSeconds; can exceed uint40)
offset 108  isPut             uint8    (1B, 0 or 1)
offset 109  isEuro            uint8    (1B, 0 or 1)
offset 110  decimals      uint8    (1B)
offset 111  consDecimals      uint8    (1B)


#### Constants
##### factory
Factory that created this option, used to pull tokens through its Permit2-style
allowance registry. Set in the template constructor (= the factory that deployed
it) and inherited by every clone via the template's runtime bytecode.


```solidity
IFactory public immutable factory
```


##### STRIKEDEC
Decimal basis of the strike — fixed at 18 and independent of token decimals.


```solidity
uint8 public constant STRIKEDEC = 18
```


#### State Variables
##### consBacked
Receipt-units the consideration pool can still back at strike rate. Incremented on
[exercise](#exercise) (cons inflow) and decremented by the cons leg of [_redeem](#_redeem) (cons payout);
the collateral leg of redeem leaves it untouched. Equal to (total exercised − total
cons-redeemed), and never underflows — the cons leg caps its payout at this value.
Denominated in receipt/collateral units (the cons equivalent is `toConsideration`).


```solidity
uint256 public consBacked
```


#### Functions
##### onlyOption

Restricts a privileged call to the paired `Option` contract only.


```solidity
modifier onlyOption() ;
```

##### nonZero

Rejects zero-amount mutations.


```solidity
modifier nonZero(uint256 amount) ;
```

##### constructor

Template constructor. Never called for user-facing instances; clones are produced
by `ClonesWithImmutableArgs.clone(template, args)` and never delegate the
constructor. `factory` is captured from the deployer (the Factory that deployed
the template) so every clone-via-delegatecall reads the same FACTORY immutable.


```solidity
constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_);
```

##### strike

Strike price, 18-decimal fixed point (consideration per collateral; inverted for puts).


```solidity
function strike() public pure returns (uint256);
```

##### collateral

Underlying collateral token (e.g. WETH). All collateral sits here.


```solidity
function collateral() public pure returns (IERC20);
```

##### col


```solidity
function col() internal pure returns (IERC20Metadata);
```

##### consideration

Consideration / quote token (e.g. USDC). Accrues here from exercise payments.


```solidity
function consideration() public pure returns (IERC20);
```

##### con


```solidity
function con() internal pure returns (IERC20Metadata);
```

##### option

The paired `Option` contract. Only this address can call mint / burn / exercise.


```solidity
function option() public pure returns (address);
```

##### expirationDate

Unix timestamp at which the option expires.


```solidity
function expirationDate() public pure returns (uint40);
```

##### exerciseDeadline

Unix timestamp at which the post-expiry exercise window closes.

Returned as `uint64`: the stored value is `expirationDate + windowSeconds`,
and that sum can exceed `type(uint40).max` even though each operand is uint40,
so reading the full 64-bit slot avoids silently truncating the deadline.


```solidity
function exerciseDeadline() public pure returns (uint64);
```

##### isPut

`true` if put, `false` if call.


```solidity
function isPut() public pure returns (bool);
```

##### isEuro

`true` if European-style.


```solidity
function isEuro() public pure returns (bool);
```

##### decimals

Cached `collateral.decimals()` used in conversion math.


```solidity
function decimals() public pure override returns (uint8);
```

##### consDecimals

Cached `consideration.decimals()` used in conversion math.


```solidity
function consDecimals() public pure returns (uint8);
```

##### mint

Mint `amount` Receipt tokens to `account`, pulling the matching amount of
underlying collateral through the factory's allowance registry.

Only callable by the paired `Option` contract.


```solidity
function mint(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of the newly-minted Receipt tokens.|
|`amount`|`uint256`| Collateral-denominated amount.|


##### burn

Burn matched Option + Receipt pair, return collateral. Only callable by Option.

Trusts Option's own gating: direct `Option.burn` enforces `notExpired`
(pre-expiration only), while the auto-burn leg of `Option._settledTransfer` runs
under `beforeDeadline` (pre-`exerciseDeadline`). Once everyone is post-settlement,
all short-side exits must go through `_redeem`.


```solidity
function burn(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|Recipient of the collateral.|
|`amount`|`uint256`| Amount of Receipt tokens to burn.|


##### exercise

Exercise path invoked by Option. `account` both pays the consideration and receives
the collateral — the two sides are coupled at this boundary so Receipt never has to
settle "pay-for-someone-else" semantics. Option enforces the matching authorisation
(self-exercise or `factory.allowExercise`) before calling.


```solidity
function exercise(address account, uint256 amount) public onlyOption nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`account`|`address`|The address paying consideration and receiving collateral.|
|`amount`|`uint256`| Collateral units to deliver; consideration collected is `ceil(amount * strike)`.|


##### redeem

Redeem the caller's full Receipt balance.

Cons-first, FCFS: pays up to `consBacked` receipt-units from the
consideration pool at strike rate, callable any time the pool can cover them.
Any uncovered remainder is paid 1:1 in collateral **only after** `exerciseDeadline`;
pre-window, uncovered receipts stay in the caller's balance for later redemption.
The cons leg mirrors the equity-options "buy to close at strike" convention:
the writer sources consideration from previously-exercised counterparties sitting
in the pool. FCFS by design — a short who redeems early captures the cons premium
earlier exercisers paid in, leaving later post-window redeemers with collateral.
That asymmetry is intentional: it lets shorts lock in the strike-rate exchange
the moment the pool can fund it, rather than waiting for the window to close.


```solidity
function redeem() public nonReentrant;
```

##### redeem

Redeem `amount` of the caller's Receipt. Same semantics as [redeem](#redeem).


```solidity
function redeem(uint256 amount) public nonReentrant;
```

##### _redeem


```solidity
function _redeem(address account, uint256 amount_) internal nonZero(amount_);
```

##### sweep

Sweep any residual `token` balance held by this Receipt to `to`. Callable only by
the factory owner, and only once every receipt has been burned (`totalSupply == 0`),
so this can never short the redemption pool — it strictly cleans up rounding
residue, post-redemption donations, or stray ERC20s sent here by accident.


```solidity
function sweep(address token, address to) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`|ERC20 to drain. Typically the option's collateral or consideration.|
|`to`|`address`|   Recipient of the swept balance.|


##### redeemFor

Keeper-triggered batch redeem. For each holder where the caller is authorised via
`factory.allowRedeem(holder, msg.sender, true)` (or `msg.sender == holder`), the
holder's full balance is redeemed under [redeem](#redeem) semantics (cons-first; mix only
post-window). The resulting collateral / consideration go to the **holder** —
never to the caller. Unauthorised and zero-balance holders are skipped silently
so a single stale entry doesn't brick the batch.
Composability-safe by design: a Receipt held inside an ERC4626 vault, Morpho
market, or multisig CANNOT be force-unwound by an unauthorised third party
(the previous permissionless `redeem(address)` variants were removed for exactly
this reason — they let any caller change a vault's collateral balance out from
under it).


```solidity
function redeemFor(address[] calldata holders) external nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`holders`|`address[]`|Holders whose receipts to redeem in full.|


##### numer


```solidity
function numer() internal pure returns (uint256);
```

##### denom


```solidity
function denom() internal pure returns (uint256);
```

##### toConsideration


```solidity
function toConsideration(uint256 amount, bool round) public pure returns (uint256);
```

##### toCollateral

Convert a consideration amount to the matching collateral-denominated receipt count.

Floors by design. No longer used internally — `_redeem` now tracks cons-backed
receipt-units via the `consBacked` counter — but exposed for off-chain
indexers and invariant tests that need the inverse of [toConsideration](#toconsideration).


```solidity
function toCollateral(uint256 consAmount) public pure returns (uint256);
```

##### name


```solidity
function name() public view override returns (string memory);
```

##### symbol


```solidity
function symbol() public view override returns (string memory);
```

#### Events
##### Redeemed
Emitted on every path that returns collateral or consideration to a user.


```solidity
event Redeemed(address option, address token, address holder, uint256 amount);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`option`|`address`|The paired Option contract.|
|`token`|`address`| The token actually transferred out (`collateral` or `consideration`).|
|`holder`|`address`|Recipient of the payout.|
|`amount`|`uint256`|Token units sent.|

#### Errors
##### UnauthorizedCaller
Thrown when a privileged path is called by anyone other than the paired `Option`.


```solidity
error UnauthorizedCaller();
```

##### ContractExpired
Thrown when a pre-expiry-only path (mint) runs after expiration.


```solidity
error ContractExpired();
```

##### ZeroValue
Thrown on `amount == 0` (or any derived zero-amount the invariant requires to be positive).


```solidity
error ZeroValue();
```

##### ExerciseWindowClosed
Thrown when exercise is attempted after `exerciseDeadline`.


```solidity
error ExerciseWindowClosed();
```

##### ExerciseWindowOpen
Thrown when a post-window-only path is called before the window closes.


```solidity
error ExerciseWindowOpen();
```

##### BeforeExerciseWindow
Thrown when short-side redemption is attempted on a European option before its
exercise window opens (`block.timestamp < expirationDate`). Mirrors the long-side
European pre-expiry guard so the revert reason states the schedule explicitly.


```solidity
error BeforeExerciseWindow();
```

##### OutstandingReceipts
Thrown when [sweep](#sweep) is called while receipts are still outstanding.


```solidity
error OutstandingReceipts();
```

##### InsufficientPool
Thrown when neither the consideration nor the collateral pool can fully fund the
requested redemption — caller should split into smaller amounts.


```solidity
error InsufficientPool();
```



### Factory

**Inherits:**
Ownable, ReentrancyGuardTransient, IERC20Errors

**Title:**
Factory — deployer, allowance hub, operator registry

**Author:**
Greek.fi

The only on-chain contract users need to interact with to *create* options. Once deployed,
every Option + Receipt pair runs off pre-compiled template clones, so creation is
cheap and the factory is never an upgradeable rug vector (the templates are immutable).
The factory also plays three lasting roles post-creation:
1. **Single allowance point.** Users `approve(collateralToken, amount)` on the factory once,
and any Option / Receipt pair created by this factory can pull from that allowance
via [transferFrom](#transferfrom). No need to approve every new option individually.
2. **Operator registry.** [approveOperator](#approveoperator) gives an address blanket authority to move
any Option produced by this factory on your behalf — the ERC-1155-style "setApprovalForAll"
pattern. Used by trading venues and aggregators.
3. **Auto-mint / auto-redeem opt-in.** [enableAutoMintBurn](#enableautomintburn) flips a per-account flag that
Option consults on transfer to auto-mint deficits and auto-redeem matched Option+Receipt
on the receiving side.
##### Exercise window
There is no oracle. Settlement is purely time-gated:
- `isEuro = false` (American) — exercise allowed from creation through `exerciseDeadline`.
- `isEuro = true`  (European) — exercise allowed only between `expirationDate` and
`exerciseDeadline`.
`windowSeconds` on `CreateParams` sets how long after expiration the window stays open;
it is taken literally — the contract NEVER substitutes a default. American options may
pass `0` for "no post-expiry extension" (window collapses to `expirationDate`).
European options must pass `windowSeconds > 0` (else `InvalidValue`). After
`expirationDate + windowSeconds`, exercise reverts (for both flavours) and short-side
redemption opens. `DEFAULT_EXERCISE_WINDOW` is an informational constant the frontend
may use as a suggested default; the contract does not consult it.
##### Supported tokens (IMPORTANT)
Collateral and consideration MUST be standard ERC-20 tokens with **exact, balance-preserving
transfers**. The protocol tracks balances 1:1 internally; any token whose `balanceOf` can
diverge from the amounts actually moved will corrupt that accounting (deposits, redemptions,
share/conversion math, and the solvency invariant). Non-standard mechanics are NOT supported:
- **Fee-on-transfer** (a cut is skimmed on transfer) — actively rejected: [transferFrom](#transferfrom)
checks the delivered balance delta and reverts [FeeOnTransferNotSupported](#feeontransfernotsupported) when a pull
lands short, so options on such tokens cannot be minted or exercised.
- **Rebasing / elastic-supply** (balances change with no transfer) — NOT detectable on-chain
and NOT supported: the collateral/consideration held by a `Receipt` can silently drift
from the recorded amounts, breaking redemption and solvency. There is no on-chain guard;
such tokens must simply not be used.
Do NOT create an option whose collateral or consideration implements either behaviour — its
accounting will not operate correctly. Frontends MUST surface this when users create options.


#### Constants
##### RECEIPT_CLONE
Template Receipt contract; per-option instances are EIP-1167 clones of this.


```solidity
address public immutable RECEIPT_CLONE
```


##### OPTION_CLONE
Template Option contract; per-option instances are EIP-1167 clones of this.


```solidity
address public immutable OPTION_CLONE
```


##### DEFAULT_EXERCISE_WINDOW
Informational suggested-default for the post-expiry exercise window. The contract
NEVER substitutes this value — `CreateParams.windowSeconds` is taken literally.
Exposed so frontends can read a canonical "8 hours" without hardcoding it.


```solidity
uint40 public constant DEFAULT_EXERCISE_WINDOW = 8 hours
```


#### State Variables
##### receipts
`true` if the address is a Receipt clone this factory created. Doubles as the auth
gate for [transferFrom](#transferfrom) — only registered Receipts can pull from factory allowances.
Validate an Option by reading its `receipt()` and confirming
`factory.receipts(rec) && Receipt(rec).option() == opt`.


```solidity
mapping(address => bool) public receipts
```


##### optionFor
Canonical Option address for a given set of economic params, keyed by [optionKey](#optionkey).
`address(0)` means no option with those params exists yet. [createOption](#createoption) is
get-or-create: a second call with economically-identical params returns the existing
Option instead of deploying a duplicate, so identical markets stay canonical/deduped
and existence is queryable on-chain.


```solidity
mapping(bytes32 => address) public optionFor
```


##### _allowances
Per-token allowance table: `_allowances[token][owner] -> amount`.


```solidity
mapping(address => mapping(address => uint256)) private _allowances
```


##### _approvedOperators
Operator approval table: `_approvedOperators[owner][operator] -> bool`.


```solidity
mapping(address => mapping(address => bool)) private _approvedOperators
```


##### _exerciseAllowed
Exercise-allowance table: `_exerciseAllowed[holder][operator] -> bool`. Lets `operator`
burn `holder`'s options via the on-behalf `Option.exercise` overload.


```solidity
mapping(address => mapping(address => bool)) private _exerciseAllowed
```


##### _redeemAllowed
Redeem-allowance table: `_redeemAllowed[holder][redeemer] -> bool`. Lets `redeemer`
trigger `Receipt.redeemFor` on `holder`'s post-window position. Funds always go to
the holder — the redeemer is a pure trigger. Composability-safe: a Receipt sitting
inside an ERC4626 vault / Morpho market / multisig cannot be force-unwound by an
unauthorised third party.


```solidity
mapping(address => mapping(address => bool)) private _redeemAllowed
```


##### autoMintBurn
Per-account opt-in for auto-mint on transfer and auto-redeem on receive in `Option`.


```solidity
mapping(address => bool) public autoMintBurn
```


#### Functions
##### nonZeroAddr


```solidity
modifier nonZeroAddr(address addr) ;
```

##### nonZero


```solidity
modifier nonZero(uint256 value) ;
```

##### constructor

Deploys the Option and Receipt templates internally so they record this factory
as their immutable `factory` (used to gate `init` and skip per-clone storage).


```solidity
constructor() Ownable(msg.sender);
```

##### createOption

Deploy a new Option + Receipt pair. Emits [OptionCreated](#optioncreated).

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
|`p`|`CreateParams`|See `CreateParams`: - `collateral`, `consideration`: ERC20 addresses; must differ. Standard ERC-20 only — no fee-on-transfer or rebasing tokens. - `expirationDate`: unix timestamp; must be in the future. - `strike`: 18-decimal fixed point (consideration per collateral, inverted for puts). - `isPut`: option flavour. - `isEuro`: `true` for European (no pre-expiry exercise), `false` for American. - `windowSeconds`: post-expiry exercise window length in seconds; taken literally (no contract-side default). American allows `0` (no extension); European requires `> 0`.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`option_`|`address`|The canonical `Option` address — either freshly deployed, or the existing option if an economically-identical one already exists (get-or-create; see `optionFor`).|


##### createOptions

Batch form of [createOption](#createoption). Same ordering in → same ordering out.


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
|`result`|`address[]`|Array of newly-created Option addresses, aligned with `params`.|


##### optionKey

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


##### transferFrom

Pull `amount` of `token` from `from` to `to`. Only callable by Receipt clones
that this factory has created.

Decrements `_allowances[token][from]` (unless it is `type(uint256).max`).
This is the mechanism by which a single user approval on the factory flows to every
option pair it creates, rather than requiring approvals on each Receipt clone.


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


##### allowance

Factory-level allowance lookup: how much of `token` can the factory pull from `owner_`?


```solidity
function allowance(address token, address owner_) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`| Token.|
|`owner_`|`address`|Token owner.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Current allowance.|


##### approve

Permit2-style allowance: caller authorises the factory to pull up to `amount` of
`token` (collateral or consideration) on their behalf when any Option / Receipt
pair created by this factory needs to move it. The user must also have granted the
underlying `token.approve(factory, ...)` so `safeTransferFrom` can land.

The allowance fans out to every Receipt clone (gated by the `receipts[]` registry)
and is consumed by `mint`, `exercise`, and — if [enableAutoMintBurn](#enableautomintburn) is `true` —
the auto-mint leg of Option transfers triggered by approved operators. Granting
a large allowance here while also holding active [approveOperator](#approveoperator) grants with
[enableAutoMintBurn](#enableautomintburn) on is functionally equivalent to a permit on the underlying
token in favour of those operators.


```solidity
function approve(address token, uint256 amount) public nonZeroAddr(token);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`token`|`address`| ERC20 to be approved.|
|`amount`|`uint256`|Allowance to grant (use `type(uint256).max` for infinite, `0` to revoke).|


##### approveOperator

Grant or revoke `operator` blanket authority to move any of the caller's Option tokens
across every option this factory has created (ERC-1155-style `setApprovalForAll`).

**Intended for audited swap / trading-venue contracts** — Uniswap-style routers,
RFQ market makers, vault adapters, anything that needs to pull a holder's Option as
part of a settlement flow without requiring a per-option ERC20 `approve`. Approved
operators skip the per-transfer `_spendAllowance` step on `Option.transferFrom`.
**⚠ Combination danger.** If the holder has also called `enableAutoMintBurn(true)`,
an approved operator gains the right to *mint new Option positions* against the
holder's factory collateral allowance, not just move existing balance. Path:
operator calls `Option.transferFrom(holder, recipient, amount)` for an amount the
holder doesn't currently hold → auto-mint pulls collateral via `factory.transferFrom`
→ minted Option lands at `recipient`. Functionally this combination is a permit on
collateral. Only grant [approveOperator](#approveoperator) to entities you trust to also have
minting rights over your collateral allowance — i.e. audited protocol contracts,
never EOAs and never unaudited integrations.
[approveOperator](#approveoperator) does NOT grant exercise rights ([allowExercise](#allowexercise) is separate) and
does NOT grant redeem rights ([allowRedeem](#allowredeem) is separate). Defaults to `false`;
revoke by passing `approved = false`.


```solidity
function approveOperator(address operator, bool approved) external nonZeroAddr(operator);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`operator`|`address`|Address being approved/revoked (must differ from `msg.sender`).|
|`approved`|`bool`|`true` to grant, `false` to revoke.|


##### approvedOperator

Is `operator` an approved operator for `owner_`?


```solidity
function approvedOperator(address owner_, address operator) external view returns (bool);
```

##### allowExercise

Authorise `exercisor` to exercise the caller's options on their behalf.

Consumed by the on-behalf `Option.exercise(address,uint256)` overloads, which burn
the holder's option tokens, pull consideration from `exercisor`, and deliver the
collateral to `exercisor`. Distinct from [approveOperator](#approveoperator): that grants transfer
authority over the holder's option tokens, this grants the right to *consume* them
(burn). Defaults to `false`; revoke by passing `allowed = false`.


```solidity
function allowExercise(address exercisor, bool allowed) external nonZeroAddr(exercisor);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`exercisor`|`address`|Account being authorised (must differ from `msg.sender`).|
|`allowed`|`bool`|  `true` to grant, `false` to revoke.|


##### exerciseAllowed

Is `exercisor` authorised to burn `holder`'s options on their behalf? Set/cleared
only via [allowExercise](#allowexercise) — independent of [approveOperator](#approveoperator), which grants transfer
(not burn) authority.


```solidity
function exerciseAllowed(address holder, address exercisor) external view returns (bool);
```

##### allowRedeem

Authorise `redeemer` to trigger post-window pro-rata redeem on the caller's behalf
via `Receipt.redeemFor`.

Unlike [allowExercise](#allowexercise), this grant carries no value-extraction risk: the redeemer
can only burn the holder's receipts; the collateral / consideration payout always
goes to the holder. Use this to wire a keeper that sweeps dust post-window, or to
let a vault-management contract unwind its own positions via a worker.


```solidity
function allowRedeem(address redeemer, bool allowed) external nonZeroAddr(redeemer);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`redeemer`|`address`|Account being authorised (must differ from `msg.sender`).|
|`allowed`|`bool`| `true` to grant, `false` to revoke.|


##### redeemAllowed

Is `redeemer` authorised to trigger `Receipt.redeemFor` on behalf of `holder`?


```solidity
function redeemAllowed(address holder, address redeemer) external view returns (bool);
```

##### enableAutoMintBurn

Opt in to `Option`'s auto-mint-on-send and auto-redeem-on-receive transfer behaviour.

Quality-of-life flag for active holders. When `true`:
- On `Option.transfer` / `transferFrom` *from* the holder where balance is short,
the missing amount is auto-minted by pulling collateral via the factory's
allowance registry (saves a separate `mint` tx before sending).
- On `Option.transfer` / `transferFrom` *to* the holder where the holder already
holds the matching Receipt, the incoming Option is immediately pair-burned and
collateral is returned (avoids dangling matched positions).
**⚠ Combination danger.** When combined with [approveOperator](#approveoperator), this flag promotes
the operator's transfer right into a *minting* right against the holder's factory
collateral allowance — see the warning on [approveOperator](#approveoperator). The flag is per-account
and applies to every option pair this factory has created. Treat it like a permit:
enable it only while you have collateral approvals out to operators you trust to
also have minting rights over those approvals.
Defaults to `false`; revoke by passing `enabled = false`.


```solidity
function enableAutoMintBurn(bool enabled) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`enabled`|`bool`|`true` to opt in, `false` to opt out.|


#### Events
##### OptionCreated
Emitted for every newly-created option.


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

##### OperatorApproval
Emitted on [approveOperator](#approveoperator).


```solidity
event OperatorApproval(address indexed owner, address indexed operator, bool approved);
```

##### ExerciseApproval
Emitted on [allowExercise](#allowexercise).


```solidity
event ExerciseApproval(address indexed holder, address indexed exercisor, bool allowed);
```

##### RedeemApproval
Emitted on [allowRedeem](#allowredeem).


```solidity
event RedeemApproval(address indexed holder, address indexed redeemer, bool allowed);
```

##### AutoMintBurnUpdated
Emitted on [enableAutoMintBurn](#enableautomintburn).


```solidity
event AutoMintBurnUpdated(address indexed account, bool enabled);
```

##### Approval
Emitted on [approve](#approve) (factory-level allowance set by token owner).


```solidity
event Approval(address indexed token, address indexed owner, uint256 amount);
```

#### Errors
##### InvalidAddress
Thrown when a zero address is supplied where a real contract is required.


```solidity
error InvalidAddress();
```

##### InvalidTokens
Thrown when `collateral == consideration` (no real option pair).


```solidity
error InvalidTokens();
```

##### InvalidValue
Thrown when a value param (strike, expiration, window) is invalid.


```solidity
error InvalidValue();
```

##### FeeOnTransferNotSupported
Thrown when a token's transferFrom delivers less than `amount` (fee-on-transfer / rebasing).


```solidity
error FeeOnTransferNotSupported();
```



### OptionUtils

**Title:**
OptionUtils

**Author:**
Greek.fi

Pure-function library used by `Option` and `Collateral` to render human-readable
token names ("OPT-WETH-USDC-3000-2025-12-26") without blowing up the clone deployment cost.

Contains no state. All functions are `internal pure`. Two concerns:
- `strike2str`    — 18-decimal fixed point → human string, with sensible rounding and
scientific notation for very small values (e.g. inverted put strikes).
- `epoch2str`     — unix timestamp → `YYYY-MM-DD` (UTC).
Integer → decimal ASCII delegates to OpenZeppelin's `Strings.toString`.
The helpers live here (not inline in Option / Receipt) so every option-pair clone
shares a single deployed copy of the rendering logic.


#### Functions
##### strike2str

Render an 18-decimal fixed-point strike as a compact, human-readable string.

Rules applied, in order:
1. No fractional part → print the integer.
2. Whole > 0 with ≥4 leading fractional zeros → drop the noise (e.g. floating-point
artifacts from `1e36 / strike` on puts) and print only the integer.
3. Whole == 0 and >8 leading zeros → scientific notation (`"1e-9"`).
4. Otherwise → decimal, rounded half-up to 4 significant fractional digits, with
trailing zeros trimmed. Rounding overflow into the whole part (e.g. `0.99995 → 1`)
is handled.


```solidity
function strike2str(uint256 _i) internal pure returns (string memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_i`|`uint256`|Strike price in 18-decimal fixed-point.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string`|Human-readable strike (e.g. `"3000"`, `"0.0005"`, `"1e-9"`).|


##### zeroPad


```solidity
function zeroPad(uint256 _i) internal pure returns (string memory);
```

##### epoch2str

Convert a unix timestamp to a `YYYY-MM-DD` (UTC) string.

Uses Howard Hinnant's branchless date algorithm
(https://howardhinnant.github.io/date_algorithms.html#civil_from_days), which
encodes the full Gregorian leap-year rules (÷4 except centuries, ÷400) without
per-year loops. block.timestamp is UTC, so no timezone handling is needed.


```solidity
function epoch2str(uint256 _i) internal pure returns (string memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_i`|`uint256`|Unix timestamp (seconds since 1970-01-01).|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`string`|Date string (e.g. `1704067200 → "2024-01-01"`).|


##### name


```solidity
function name(
    string memory type_,
    string memory collSymbol,
    string memory consSymbol,
    uint256 _strike,
    uint256 _expirationDate
) internal pure returns (string memory);
```

##### balancesOf

All four balances that matter for this option in one call.


```solidity
function balancesOf(address receipt_, address account) public view returns (Balances memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`receipt_`|`address`||
|`account`|`address`|Address to query.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`Balances`|A `Balances` struct: collateral token, consideration token, long option, short receipt.|


##### details

Full option descriptor — addresses, token metadata, strike, expiry, deadline.
Convenient one-shot read for frontends.


```solidity
function details(address receipt_) public view returns (OptionInfo memory);
```



## Interfaces

### IOption

**Title:**
IOption — long-side option token interface

**Author:**
Greek.fi

ERC20 with option-specific extensions. Exercise is allowed pre-expiry (American only)
and during the post-expiry window (`exerciseDeadline = expirationDate + windowSeconds`),
after which only short-side redemption is permitted. Pair-burn is valid up to and
including `exerciseDeadline` (boundary inclusive).


#### Functions
##### receipt

Paired short-side Receipt contract.


```solidity
function receipt() external view returns (address);
```

##### init

One-time initialisation (factory-only for clones).


```solidity
function init(address receipt_) external;
```

##### name

ERC20 name (rendered `OPT[A|E]-coll-cons-strike-YYYY-MM-DD`).


```solidity
function name() external view returns (string memory);
```

##### symbol

ERC20 symbol (matches `name`).


```solidity
function symbol() external view returns (string memory);
```

##### decimals

ERC20 decimals (matches `collateral.decimals()`).


```solidity
function decimals() external view returns (uint8);
```

##### factory

Address of the Factory that created this option.


```solidity
function factory() external view returns (address);
```

##### collateral

Underlying collateral token.


```solidity
function collateral() external view returns (address);
```

##### consideration

Consideration / quote token.


```solidity
function consideration() external view returns (address);
```

##### expirationDate

Unix expiration timestamp.


```solidity
function expirationDate() external view returns (uint40);
```

##### exerciseDeadline

Unix timestamp at which the post-expiry exercise window closes.


```solidity
function exerciseDeadline() external view returns (uint64);
```

##### strike

Strike price (18-decimal fixed point; inverted for puts).


```solidity
function strike() external view returns (uint256);
```

##### isPut

`true` if this is a put.


```solidity
function isPut() external view returns (bool);
```

##### isEuro

`true` if European-style (exercise only allowed in the post-expiry window).


```solidity
function isEuro() external view returns (bool);
```

##### balanceOf

ERC20 balance.


```solidity
function balanceOf(address account) external view returns (uint256);
```

##### balancesOf

All four balances that matter for this option (collateral, consideration, option, receipt).


```solidity
function balancesOf(address account) external view returns (Balances memory);
```

##### details

Full option descriptor.


```solidity
function details() external view returns (OptionInfo memory);
```

##### mint

Mint `amount` options to the caller.


```solidity
function mint(uint256 amount) external;
```

##### mint

Mint `amount` options on behalf of `account`. Caller must be `account` or have been
granted `factory.approveOperator(account, msg.sender)`.


```solidity
function mint(address account, uint256 amount) external;
```

##### transfer

ERC20 transfer override — runs auto-mint / auto-burn hooks; reverts past `exerciseDeadline`.


```solidity
function transfer(address to, uint256 amount) external returns (bool);
```

##### transferFrom

ERC20 transferFrom override — runs auto-mint / auto-burn hooks; reverts past `exerciseDeadline`.


```solidity
function transferFrom(address from, address to, uint256 amount) external returns (bool);
```

##### exercise

Exercise the caller's full Option balance — safe self-exercise.


```solidity
function exercise() external;
```

##### exercise

Exercise `amount` of the caller's Options — safe self-exercise.


```solidity
function exercise(uint256 amount) external;
```

##### exerciseFor

**Dangerous keeper path.** Burn `amount` of `holder`'s Options; caller pays the
consideration AND receives the collateral. Holder gets nothing on-chain. Caller must
be `holder` or have been authorised via `factory.allowExercise(holder, true)`.


```solidity
function exerciseFor(address holder, uint256 amount) external returns (uint256);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Amount actually exercised (`== amount` on success).|


##### exerciseFor

Batch variant of `exerciseFor(address,uint256)`. Exercises `amounts[i]` of `holders[i]`
(arrays must be equal length). Entries that fail the per-holder allowance check, carry a
zero amount, or request more than the holder's balance (`balanceOf(holder) < amount`) are
skipped rather than reverting, so one stale entry can't grief the whole sweep.


```solidity
function exerciseFor(address[] calldata holders, uint256[] calldata amounts) external;
```

##### burn

Pair-burn matched Option + Receipt to recover collateral. Allowed up to and including
`exerciseDeadline` (boundary inclusive). Caller must hold both sides in equal amount.


```solidity
function burn(uint256 amount) external;
```

##### expire

Burn `holder`'s expired long tokens (post-`exerciseDeadline` cleanup). Caller must be
`holder` or authorised via `factory.allowExercise(holder, true)`. Long side only —
leaves the Receipt and collateral pool untouched. Reverts `NotYetExpired` on or before
the deadline, `Unauthorized` if the caller lacks the holder's grant.


```solidity
function expire(address holder, uint256 amount) external;
```

#### Events
##### Mint
Emitted on `IOption.mint`.


```solidity
event Mint(address longOption, address holder, uint256 amount);
```

##### Exercise
Emitted on any `exercise*` path. `caller` is the consideration payer and (for the
dangerous `exerciseFor` overloads) the collateral recipient; `holder`'s options are
burned.


```solidity
event Exercise(address longOption, address caller, address holder, uint256 amount);
```

##### Expire
Emitted on `IOption.expire` when a holder burns expired (post-deadline) long tokens.
`caller == holder` (you can only expire your own options).


```solidity
event Expire(address longOption, address caller, address holder, uint256 amount);
```

#### Errors
##### ContractExpired
A path that requires a live option was called after expiration.


```solidity
error ContractExpired();
```

##### ZeroValue
Zero-amount mutation rejected.


```solidity
error ZeroValue();
```

##### ExerciseWindowClosed
Exercise / transfer / burn attempted past the exercise-window boundary.


```solidity
error ExerciseWindowClosed();
```

##### InvalidExercise
Pre-expiry exercise attempted on a European option, or other window violation.


```solidity
error InvalidExercise();
```

##### AlreadyInitialized
`init` called twice (or on the template itself, which carries the `0xdead` sentinel).


```solidity
error AlreadyInitialized();
```

##### Unauthorized
Caller is not authorised for the requested operation.


```solidity
error Unauthorized();
```

##### NotYetExpired
[expire](#expire) called on or before `exerciseDeadline` — the option is still live.


```solidity
error NotYetExpired();
```



### IReceipt

**Title:**
IReceipt — short-side token interface (collateral receipt)

**Author:**
Greek.fi

ERC20 extension for the short-side position: holds underlying collateral, receives
consideration on exercise, and handles post-window redemption math (cons-first, then
collateral 1:1 for any remainder).


#### Functions
##### strike

Strike price (18-decimal fixed point, consideration per collateral; inverted for puts).


```solidity
function strike() external view returns (uint256);
```

##### collateral

Underlying collateral token.


```solidity
function collateral() external view returns (IERC20);
```

##### consideration

Consideration / quote token.


```solidity
function consideration() external view returns (IERC20);
```

##### expirationDate

Unix expiration timestamp (uint40).


```solidity
function expirationDate() external view returns (uint40);
```

##### exerciseDeadline

Unix timestamp at which the post-expiry exercise window closes (uint64: the
expiration + window sum can exceed uint40).


```solidity
function exerciseDeadline() external view returns (uint64);
```

##### isPut

`true` if this is a put.


```solidity
function isPut() external view returns (bool);
```

##### isEuro

`true` if European-style (exercise only allowed in the post-expiry window).


```solidity
function isEuro() external view returns (bool);
```

##### decimals

Cached `collateral.decimals()`.


```solidity
function decimals() external view returns (uint8);
```

##### consDecimals

Cached `consideration.decimals()`.


```solidity
function consDecimals() external view returns (uint8);
```

##### STRIKEDEC

Decimal basis of the strike (always 18).


```solidity
function STRIKEDEC() external view returns (uint8);
```

##### name

ERC20 name (rendered `RCT[E]-coll-cons-strike-YYYY-MM-DD`).


```solidity
function name() external view returns (string memory);
```

##### symbol

ERC20 symbol (matches `name`).


```solidity
function symbol() external view returns (string memory);
```

##### option

Paired Option contract — the only address authorised to call `mint`/`burn`/`exercise`.


```solidity
function option() external view returns (address);
```

##### factory

Factory that created this pair.


```solidity
function factory() external view returns (address);
```

##### toConsideration

Strike-rate conversion. `round=true` rounds up (used when collecting consideration on exercise);
`round=false` rounds down (used for payouts).


```solidity
function toConsideration(uint256 amount, bool round) external pure returns (uint256);
```

##### toCollateral

Inverse of [toConsideration](#toconsideration) — how much collateral a given consideration amount is worth
(floor by design; used by `_redeem` to compute the receipt count fully covered by the
current cons balance).


```solidity
function toCollateral(uint256 consAmount) external pure returns (uint256);
```

##### mint

Mint (Option-only). Pulls collateral from `account` via the factory.


```solidity
function mint(address account, uint256 amount) external;
```

##### burn

Pair-burn helper (Option-only). Valid up to and including `exerciseDeadline`.


```solidity
function burn(address account, uint256 amount) external;
```

##### exercise

Exercise path invoked by the paired Option. `account` is both the consideration payer
and the collateral recipient (the Option contract forwards `msg.sender` here).


```solidity
function exercise(address account, uint256 amount) external;
```

##### redeem

Redeem the caller's full receipt balance. Cons-first, then collateral 1:1 for any
remainder. Cons leg has no time gate; collateral leg requires
`block.timestamp > exerciseDeadline`.


```solidity
function redeem() external;
```

##### redeem

Redeem `amount` of the caller's receipts. Same cons-first semantics as `redeem()`.


```solidity
function redeem(uint256 amount) external;
```

##### redeemFor

Keeper-gated batch redeem. Per-holder authorisation via `factory.allowRedeem`; payouts
always go to the holder, never to the caller.


```solidity
function redeemFor(address[] calldata holders) external;
```

##### sweep

Factory-owner dust drain. Reverts if any receipt is outstanding.


```solidity
function sweep(address token, address to) external;
```

##### balanceOf

ERC20 balance.


```solidity
function balanceOf(address account) external view returns (uint256);
```

#### Events
##### Redeemed
Emitted whenever collateral or consideration is returned to a holder.


```solidity
event Redeemed(address option, address token, address holder, uint256 amount);
```

#### Errors
##### UnauthorizedCaller
Caller is not the paired Option (or, for `sweep`, not the factory owner).


```solidity
error UnauthorizedCaller();
```

##### ContractExpired
A path that requires a live option was called after expiration.


```solidity
error ContractExpired();
```

##### ZeroValue
Zero-amount (or derived-zero) mutation rejected.


```solidity
error ZeroValue();
```

##### ExerciseWindowClosed
Exercise / burn attempted after `exerciseDeadline`.


```solidity
error ExerciseWindowClosed();
```

##### ExerciseWindowOpen
Post-window-only path called while the exercise window is still open.


```solidity
error ExerciseWindowOpen();
```

##### BeforeExerciseWindow
Short-side redemption attempted on a European option before its exercise window opens.


```solidity
error BeforeExerciseWindow();
```

##### OutstandingReceipts
`sweep` called while receipts are still outstanding.


```solidity
error OutstandingReceipts();
```

##### InsufficientPool
`_redeem` cannot pay the collateral leg — pool short of `collPay`.


```solidity
error InsufficientPool();
```



### IFactory

**Title:**
IFactory — option pair deployer + allowance hub

**Author:**
Greek.fi

Deploys Option + Receipt pairs via EIP-1167 clones, serves as the single ERC20 approval
point for every option pair it creates, and holds an operator + auto-mint-redeem registry.


#### Functions
##### RECEIPT_CLONE

Receipt template clone.


```solidity
function RECEIPT_CLONE() external view returns (address);
```

##### OPTION_CLONE

Option template clone.


```solidity
function OPTION_CLONE() external view returns (address);
```

##### DEFAULT_EXERCISE_WINDOW

Informational suggested-default window length (frontend convenience). The contract
does NOT consult this — `CreateParams.windowSeconds` is always taken literally.


```solidity
function DEFAULT_EXERCISE_WINDOW() external view returns (uint40);
```

##### receipts

`true` if `rec` is a Receipt produced by this factory. Validate an Option `opt` by
checking `receipts(opt.receipt()) && IReceipt(opt.receipt()).option() == opt`.


```solidity
function receipts(address rec) external view returns (bool);
```

##### optionFor

Canonical Option address for the params identified by `key` (see [optionKey](#optionkey)), or
`address(0)` if no such option exists. [createOption](#createoption) is get-or-create against this
registry, so economically-identical markets are deduped and existence is queryable.


```solidity
function optionFor(bytes32 key) external view returns (address);
```

##### optionKey

Deterministic registry key for a set of economic params. Folds in all seven
`CreateParams` fields; differing in any field yields a different key.


```solidity
function optionKey(CreateParams memory p) external pure returns (bytes32);
```

##### allowance

Factory-level allowance: how much of `token` the factory may pull from `owner`.


```solidity
function allowance(address token, address owner) external view returns (uint256);
```

##### autoMintBurn

`true` if `account` has opted into Option's auto-mint / auto-redeem transfer hooks.


```solidity
function autoMintBurn(address account) external view returns (bool);
```

##### approvedOperator

`true` if `operator` has blanket authority over `owner`'s Option tokens.


```solidity
function approvedOperator(address owner, address operator) external view returns (bool);
```

##### exerciseAllowed

`true` if `exercisor` may burn `holder`'s options via `exerciseFor`.


```solidity
function exerciseAllowed(address holder, address exercisor) external view returns (bool);
```

##### redeemAllowed

`true` if `redeemer` may trigger `Receipt.redeemFor` on behalf of `holder`.


```solidity
function redeemAllowed(address holder, address redeemer) external view returns (bool);
```

##### createOption

Create a new Option + Receipt pair per the given parameters, or return the existing
canonical Option if one with economically-identical params already exists (get-or-create).


```solidity
function createOption(CreateParams memory params) external returns (address);
```

##### createOptions

Batch form of [createOption](#createoption).


```solidity
function createOptions(CreateParams[] memory params) external returns (address[] memory);
```

##### transferFrom

Pull tokens via the factory-level allowance. Only callable by Collateral clones.


```solidity
function transferFrom(address from, address to, uint256 amount, address token) external returns (bool success);
```

##### approve

Set the caller's factory-level allowance for `token`.


```solidity
function approve(address token, uint256 amount) external;
```

##### enableAutoMintBurn

Opt-in / opt-out of Option's auto-mint-on-transfer / auto-redeem-on-receive behaviour.


```solidity
function enableAutoMintBurn(bool enabled) external;
```

##### approveOperator

Grant / revoke blanket operator authority over the caller's options.


```solidity
function approveOperator(address operator, bool approved) external;
```

##### allowExercise

Authorise / revoke `exercisor` for `Option.exerciseFor` on the caller's options.


```solidity
function allowExercise(address exercisor, bool allowed) external;
```

##### allowRedeem

Authorise / revoke `redeemer` for `Receipt.redeemFor` on the caller's receipts.


```solidity
function allowRedeem(address redeemer, bool allowed) external;
```

#### Events
##### OptionCreated
Emitted for every newly-created option.


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

##### OperatorApproval
Emitted on [approveOperator](#approveoperator).


```solidity
event OperatorApproval(address indexed owner, address indexed operator, bool approved);
```

##### AutoMintBurnUpdated
Emitted on [enableAutoMintBurn](#enableautomintburn).


```solidity
event AutoMintBurnUpdated(address indexed account, bool enabled);
```

##### Approval
Emitted on [approve](#approve) (factory-level allowance set).


```solidity
event Approval(address indexed token, address indexed owner, uint256 amount);
```

#### Errors
##### InvalidAddress
Zero address supplied where a contract is required.


```solidity
error InvalidAddress();
```

##### InvalidTokens
Collateral and consideration were the same address.


```solidity
error InvalidTokens();
```

##### FeeOnTransferNotSupported
Token transferFrom delivered less than `amount` — fee-on-transfer / rebasing tokens are not supported.


```solidity
error FeeOnTransferNotSupported();
```


